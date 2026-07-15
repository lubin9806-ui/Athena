"""TTS 语音合成 — 支持从文件读取文本"""
import sys, asyncio
from edge_tts import Communicate

async def main():
    # 参数：text 或 @filepath, voice, output
    text_or_file = sys.argv[1] if len(sys.argv) > 1 else "你好"
    
    # 如果以 @ 开头，从文件读取
    if text_or_file.startswith('@'):
        with open(text_or_file[1:], 'r', encoding='utf-8') as f:
            text = f.read().strip()
    else:
        text = text_or_file
    
    voice = sys.argv[2] if len(sys.argv) > 2 else "zh-CN-XiaoxiaoNeural"
    out = sys.argv[3] if len(sys.argv) > 3 else "tts_out.mp3"
    
    communicate = Communicate(text, voice)
    await communicate.save(out)
    print(f"OK:{out}")

if __name__ == "__main__":
    asyncio.run(main())