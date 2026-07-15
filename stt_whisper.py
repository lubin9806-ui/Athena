"""语音识别 — faster-whisper 本地方案"""
import sys, os

def transcribe(audio_path):
    """用 faster-whisper 识别音频（支持 WebM/WAV/MP3 等）"""
    from faster_whisper import WhisperModel
    
    # 用 tiny 模型（速度快，中文够用）
    # 模型会在首次运行时自动下载到 ~/.cache/huggingface/hub/
    model = WhisperModel(
        "tiny",
        device="cpu",
        compute_type="int8",  # 减少内存占用
        cpu_threads=4,
        num_workers=2,
    )
    
    segments, info = model.transcribe(
        audio_path,
        language="zh",
        beam_size=3,
        vad_filter=True,          # 过滤静音段
        vad_parameters=dict(
            threshold=0.5,
            min_speech_duration_ms=200,
            max_speech_duration_s=30,
        ),
    )
    
    text = " ".join(seg.text for seg in segments)
    return text.strip()

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("")
        sys.exit(0)
    
    audio_path = sys.argv[1]
    if not os.path.exists(audio_path):
        print("")
        sys.exit(0)
    
    try:
        text = transcribe(audio_path)
        print(text)
    except Exception as e:
        print(f"[ERROR] {e}", file=sys.stderr)
        print("")