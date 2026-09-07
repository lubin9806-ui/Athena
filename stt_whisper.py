"""Athena offline STT. A local model directory is mandatory; downloads are forbidden.

Two modes:

  stt_whisper.py <audio> <model> [language]   one shot; loads the model, decodes,
                                              exits. Used by the packaging probe
                                              and as the fallback path.
  stt_whisper.py --serve <model>              resident worker; loads the model
                                              once, then answers one JSON request
                                              per line on stdin.

Loading the model costs far more than decoding a short utterance, so the resident
mode exists to stop paying it per sentence (ATH-VOICE-005). One shot stays
because it is the honest way to verify the runtime and to recover when the worker
cannot start.
"""
from pathlib import Path
import json
import os
import sys

def fail(category: str, message: str, exit_code: int) -> int:
    print(f"[{category}] {message}", file=sys.stderr)
    return exit_code


AUTO_LANGUAGE = "auto"


def normalize_language(value: str) -> str:
    """Accept 'auto' or an ISO 639-1 code; reject anything else before decoding.

    The code is passed straight to faster-whisper, so it is validated by shape
    here rather than trusted. Region suffixes ('zh-CN') are dropped because
    Whisper identifies languages, not locales.
    """
    cleaned = (value or "").strip().lower()
    if not cleaned or cleaned == AUTO_LANGUAGE:
        return AUTO_LANGUAGE
    base = cleaned.split("-")[0]
    if not base.isalpha() or not 2 <= len(base) <= 3:
        raise ValueError(f"Unsupported language code: {value}")
    return base


def load_model(model_path: str):
    from faster_whisper import WhisperModel

    return WhisperModel(
        model_path,
        device="cpu",
        compute_type="int8",
        cpu_threads=max(1, min(2, os.cpu_count() or 1)),
        num_workers=1,
        local_files_only=True,
    )


def run_transcription(model, audio_path: str, language: str) -> str:
    # None asks faster-whisper to detect the language from the audio. A pinned
    # code skips detection, which is faster and steadier when the speaker's
    # language is known - and produces confident nonsense when it is wrong.
    segments, info = model.transcribe(
        audio_path,
        language=None if language == AUTO_LANGUAGE else language,
        beam_size=3,
        vad_filter=True,
        vad_parameters=dict(
            threshold=0.5,
            min_speech_duration_ms=200,
            max_speech_duration_s=30,
        ),
    )

    return " ".join(seg.text for seg in segments).strip()


def transcribe(audio_path: str, model_path: str, language: str) -> str:
    return run_transcription(load_model(model_path), audio_path, language)


def emit(payload: dict) -> None:
    """One JSON object per line; the caller reads line by line."""
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def handle_request(model, request: dict) -> dict:
    audio_path = Path(str(request.get("audio", "")))
    if not audio_path.is_file():
        return {"ok": False, "code": "INPUT_ERROR", "message": "Audio file does not exist."}
    try:
        language = normalize_language(str(request.get("language", AUTO_LANGUAGE)))
    except ValueError as error:
        return {"ok": False, "code": "USAGE_ERROR", "message": str(error)}
    try:
        text = run_transcription(model, str(audio_path), language)
    except Exception as error:
        return {"ok": False, "code": "STT_ERROR", "message": f"{type(error).__name__}: {error}"}
    if not text:
        return {"ok": False, "code": "NO_SPEECH", "message": "No recognizable speech was found."}
    return {"ok": True, "text": text}


def serve(model_path: Path) -> int:
    if not model_path.is_dir():
        return fail("MODEL_MISSING", "The preinstalled local Whisper model is missing; runtime download is disabled.", 3)
    try:
        model = load_model(str(model_path))
    except ImportError as error:
        return fail("DEPENDENCY_ERROR", f"Managed voice dependency is unavailable: {error}", 4)
    except Exception as error:
        return fail("STT_ERROR", f"{type(error).__name__}: {error}", 1)

    # The caller waits for this line before sending work, and keeps using the one
    # shot path until it arrives. Anything printed before it would be read as the
    # handshake, so nothing else may write to stdout.
    emit({"ready": True})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        request_id = None
        try:
            request = json.loads(line)
            request_id = request.get("id")
            response = handle_request(model, request)
        except json.JSONDecodeError as error:
            response = {"ok": False, "code": "USAGE_ERROR", "message": f"Malformed request: {error}"}
        # Echoing the id lets the caller reject a reply that does not belong to
        # the request it is waiting on, instead of returning someone else's text.
        if request_id is not None:
            response["id"] = request_id
        emit(response)
    return 0


def main() -> int:
    if len(sys.argv) == 3 and sys.argv[1] == "--serve":
        return serve(Path(sys.argv[2]))
    if not 3 <= len(sys.argv) <= 4:
        return fail("USAGE_ERROR", "Expected audio path, local Whisper model directory and an optional language.", 2)
    audio_path = Path(sys.argv[1])
    model_path = Path(sys.argv[2])
    # Omitting the language keeps the pre-existing callers working.
    try:
        language = normalize_language(sys.argv[3] if len(sys.argv) == 4 else AUTO_LANGUAGE)
    except ValueError as error:
        return fail("USAGE_ERROR", str(error), 2)
    if not audio_path.is_file():
        return fail("INPUT_ERROR", "Audio file does not exist.", 2)
    if not model_path.is_dir():
        return fail("MODEL_MISSING", "The preinstalled local Whisper model is missing; runtime download is disabled.", 3)
    try:
        text = transcribe(str(audio_path), str(model_path), language)
        if not text:
            return fail("NO_SPEECH", "No recognizable speech was found.", 5)
        print(text)
        return 0
    except ImportError as error:
        return fail("DEPENDENCY_ERROR", f"Managed voice dependency is unavailable: {error}", 4)
    except Exception as e:
        return fail("STT_ERROR", f"{type(e).__name__}: {e}", 1)


if __name__ == "__main__":
    sys.exit(main())
