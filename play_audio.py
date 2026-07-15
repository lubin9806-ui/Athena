"""Play an audio file through the Windows default output device."""

from pathlib import Path
import sys


def main() -> int:
    if len(sys.argv) != 2:
        print("[USAGE_ERROR] Expected one audio file path.", file=sys.stderr)
        return 2

    audio_path = Path(sys.argv[1])
    if not audio_path.is_file():
        print(f"[INPUT_ERROR] Audio file does not exist: {audio_path}", file=sys.stderr)
        return 2

    try:
        import av
        import numpy as np
        import sounddevice as sd

        sample_rate = 48_000
        container = av.open(str(audio_path))
        resampler = av.audio.resampler.AudioResampler(
            format="fltp",
            layout="mono",
            rate=sample_rate,
        )
        chunks = []
        for frame in container.decode(audio=0):
            for converted in resampler.resample(frame):
                chunks.append(converted.to_ndarray().reshape(-1).astype(np.float32, copy=False))
        for converted in resampler.resample(None):
            chunks.append(converted.to_ndarray().reshape(-1).astype(np.float32, copy=False))

        if not chunks:
            print("[PLAYBACK_ERROR] Audio file contained no samples.", file=sys.stderr)
            return 3

        audio = np.concatenate(chunks)
        device = sd.query_devices(kind="output")
        sd.play(audio, sample_rate, blocking=True)
        print(f"OK:{device['name']}")
        return 0
    except Exception as error:
        print(f"[PLAYBACK_ERROR] {type(error).__name__}: {error}", file=sys.stderr)
        return 4


if __name__ == "__main__":
    sys.exit(main())
