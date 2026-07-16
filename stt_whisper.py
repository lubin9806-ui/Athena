"""Athena offline STT. A local model directory is mandatory; downloads are forbidden."""
from pathlib import Path
import os
import sys

def fail(category: str, message: str, exit_code: int) -> int:
    print(f"[{category}] {message}", file=sys.stderr)
    return exit_code


def transcribe(audio_path: str, model_path: str) -> str:
    from faster_whisper import WhisperModel

    model = WhisperModel(
        model_path,
        device="cpu",
        compute_type="int8",
        cpu_threads=max(1, min(2, os.cpu_count() or 1)),
        num_workers=1,
        local_files_only=True,
    )
    
    segments, info = model.transcribe(
        audio_path,
        language="zh",
        beam_size=3,
        vad_filter=True,
        vad_parameters=dict(
            threshold=0.5,
            min_speech_duration_ms=200,
            max_speech_duration_s=30,
        ),
    )
    
    return " ".join(seg.text for seg in segments).strip()


def main() -> int:
    if len(sys.argv) != 3:
        return fail("USAGE_ERROR", "Expected audio path and local Whisper model directory.", 2)
    audio_path = Path(sys.argv[1])
    model_path = Path(sys.argv[2])
    if not audio_path.is_file():
        return fail("INPUT_ERROR", "Audio file does not exist.", 2)
    if not model_path.is_dir():
        return fail("MODEL_MISSING", "The preinstalled local Whisper model is missing; runtime download is disabled.", 3)
    try:
        text = transcribe(str(audio_path), str(model_path))
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
