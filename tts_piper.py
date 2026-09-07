"""Athena offline neural TTS. A local voice model is mandatory; downloads are forbidden.

Two modes, matching stt_whisper.py:

  tts_piper.py <text-file> <model> <out.wav> [rate] [volume]   one shot
  tts_piper.py --serve <model>                                 resident worker

Windows SAPI is pre-neural and cannot be tuned into sounding like a person, so
this exists to be the voice people actually hear (ATH-VOICE-010). SAPI stays as
the fallback for machines without the packaged voice.

Text arrives in a file rather than on the command line: a reply can be long and
is not ASCII, and neither survives a Windows command line reliably.
"""
from pathlib import Path
import json
import os
import sys
import wave

DEFAULT_NOISE_SCALE = 0.667
DEFAULT_NOISE_W_SCALE = 0.8


def fail(category: str, message: str, exit_code: int) -> int:
    print(f"[{category}] {message}", file=sys.stderr)
    return exit_code


def length_scale_for(rate: float) -> float:
    """Map the SAPI-shaped -10..10 rate onto piper's length multiplier.

    Symmetric around zero by construction: +10 halves the duration, -10 doubles
    it, 0 leaves the voice at its own pace. A linear map would have made the
    slow end unusable long before it reached -10.
    """
    clamped = max(-10.0, min(10.0, rate))
    return 2.0 ** (-clamped / 10.0)


def load_voice(model_path: str):
    from piper import PiperVoice

    return PiperVoice.load(model_path)


def synthesize(voice, text: str, out_path: str, rate: float, volume: float,
               noise_scale: float, noise_w_scale: float) -> None:
    from piper import SynthesisConfig

    config = SynthesisConfig(
        length_scale=length_scale_for(rate),
        volume=max(0.0, min(1.0, volume / 100.0)),
        noise_scale=noise_scale,
        # Variation in phoneme duration. This is the knob that decides whether a
        # reading sounds even or spoken; it is the one worth tuning if delivery
        # is reported as flat.
        noise_w_scale=noise_w_scale,
    )
    with wave.open(out_path, "wb") as handle:
        voice.synthesize_wav(text, handle, syn_config=config)


def read_text(text_path: Path) -> str:
    return text_path.read_text(encoding="utf-8").strip()


def emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def handle_request(voice, request: dict) -> dict:
    text_path = Path(str(request.get("textFile", "")))
    out_path = str(request.get("out", ""))
    if not text_path.is_file():
        return {"ok": False, "code": "INPUT_ERROR", "message": "Text file does not exist."}
    if not out_path:
        return {"ok": False, "code": "INPUT_ERROR", "message": "Output path is required."}
    text = read_text(text_path)
    if not text:
        return {"ok": False, "code": "INPUT_ERROR", "message": "There is no text to speak."}
    try:
        synthesize(
            voice,
            text,
            out_path,
            float(request.get("rate", 0)),
            float(request.get("volume", 100)),
            float(request.get("noiseScale", DEFAULT_NOISE_SCALE)),
            float(request.get("noiseWScale", DEFAULT_NOISE_W_SCALE)),
        )
    except Exception as error:
        return {"ok": False, "code": "TTS_ERROR", "message": f"{type(error).__name__}: {error}"}
    return {"ok": True, "path": out_path}


def serve(model_path: Path) -> int:
    if not model_path.is_file():
        return fail("MODEL_MISSING", "The preinstalled local voice is missing; runtime download is disabled.", 3)
    try:
        voice = load_voice(str(model_path))
    except ImportError as error:
        return fail("DEPENDENCY_ERROR", f"Managed voice dependency is unavailable: {error}", 4)
    except Exception as error:
        return fail("TTS_ERROR", f"{type(error).__name__}: {error}", 1)

    # Nothing may reach stdout before this line: the caller reads it as the
    # handshake and keeps using the one-shot path until it arrives.
    emit({"ready": True})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        request_id = None
        try:
            request = json.loads(line)
            request_id = request.get("id")
            response = handle_request(voice, request)
        except json.JSONDecodeError as error:
            response = {"ok": False, "code": "USAGE_ERROR", "message": f"Malformed request: {error}"}
        if request_id is not None:
            response["id"] = request_id
        emit(response)
    return 0


def main() -> int:
    if len(sys.argv) == 3 and sys.argv[1] == "--serve":
        return serve(Path(sys.argv[2]))
    if not 4 <= len(sys.argv) <= 6:
        return fail("USAGE_ERROR", "Expected text file, voice model, output path and optional rate and volume.", 2)

    text_path = Path(sys.argv[1])
    model_path = Path(sys.argv[2])
    out_path = sys.argv[3]
    try:
        rate = float(sys.argv[4]) if len(sys.argv) >= 5 else 0.0
        volume = float(sys.argv[5]) if len(sys.argv) == 6 else 100.0
    except ValueError as error:
        return fail("USAGE_ERROR", f"Rate and volume must be numbers: {error}", 2)

    if not text_path.is_file():
        return fail("INPUT_ERROR", "Text file does not exist.", 2)
    if not model_path.is_file():
        return fail("MODEL_MISSING", "The preinstalled local voice is missing; runtime download is disabled.", 3)
    text = read_text(text_path)
    if not text:
        return fail("INPUT_ERROR", "There is no text to speak.", 2)

    try:
        synthesize(load_voice(str(model_path)), text, out_path, rate, volume,
                   DEFAULT_NOISE_SCALE, DEFAULT_NOISE_W_SCALE)
        print(f"OK:{out_path}")
        return 0
    except ImportError as error:
        return fail("DEPENDENCY_ERROR", f"Managed voice dependency is unavailable: {error}", 4)
    except Exception as error:
        return fail("TTS_ERROR", f"{type(error).__name__}: {error}", 1)


if __name__ == "__main__":
    sys.exit(main())
