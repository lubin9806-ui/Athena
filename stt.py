"""Transcribe Chinese speech with SpeechRecognition's Google backend."""

from pathlib import Path
import sys


def fail(category: str, message: str, exit_code: int) -> int:
    """Write diagnostics to stderr without contaminating transcription stdout."""
    print(f"[{category}] {message}", file=sys.stderr)
    return exit_code


def main() -> int:
    if len(sys.argv) != 2:
        return fail("USAGE_ERROR", "Expected exactly one audio file path.", 2)

    audio_path = Path(sys.argv[1])
    if not audio_path.is_file():
        return fail("INPUT_ERROR", f"Audio file does not exist: {audio_path}", 2)

    try:
        import speech_recognition as sr
    except ImportError as error:
        return fail("DEPENDENCY_ERROR", f"speech_recognition is unavailable: {error}", 3)

    recognizer = sr.Recognizer()
    try:
        with sr.AudioFile(str(audio_path)) as source:
            audio = recognizer.record(source)
    except (OSError, ValueError, EOFError) as error:
        return fail("AUDIO_ERROR", f"Could not read the audio file: {error}", 4)
    except Exception as error:
        return fail("AUDIO_ERROR", f"{type(error).__name__}: {error}", 4)

    try:
        text = recognizer.recognize_google(audio, language="zh-CN").strip()
    except sr.UnknownValueError:
        return fail("NO_SPEECH", "Speech was not recognized.", 5)
    except sr.RequestError as error:
        return fail("SERVICE_ERROR", f"Speech recognition service request failed: {error}", 6)
    except Exception as error:
        return fail("STT_ERROR", f"{type(error).__name__}: {error}", 1)

    if not text:
        return fail("NO_SPEECH", "Speech recognition returned no text.", 5)

    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
