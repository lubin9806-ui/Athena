# Athena Desktop 1.0 语音架构决策

> 决策日期：2026-07-16；状态：窗口 05 冻结。

## 固定方案

- STT：本地 `faster-whisper==1.2.1`，CPython 3.11.9 Windows x64 受管 sidecar，模型必须作为审核过的本地目录预置。`HF_HUB_OFFLINE=1`、`TRANSFORMERS_OFFLINE=1` 和 `local_files_only=True` 三层禁止运行时下载。
- TTS：Windows SAPI (`System.Speech`) 本地合成 WAV；使用用户系统已安装声音，不捆绑或转售声音资源。
- 播放：Windows `System.Media.SoundPlayer` 本地播放 Athena 生成的 WAV，不依赖 Python。
- 在线 STT/TTS：当前没有 provider、设置或入口，不进入 Desktop/Steam 1.0 宣传。未来签约适配器必须分别复用窗口 03 的 `onlineSpeechToText` / `onlineTextToSpeech` 同意门，禁止隐式 fallback。

精确 Python 运行依赖锁在 `requirements-voice.txt`：`faster-whisper==1.2.1`、`av==17.1.0`、`numpy==2.4.6`。正式包还必须记录 Python sidecar、wheel 与 Whisper 模型的 SHA-256/许可；当前仓库未包含这些二进制 payload，因此缺少时功能会禁用而不是下载。

## 故障行为

| 场景 | 行为 |
|---|---|
| 无 Python/sidecar | `runtime_missing`，设置显示“本地语音运行时未安装”，STT 禁用 |
| Python 包缺失 | `dependency_missing`，建议修复语音组件 |
| Whisper 模型缺失 | `model_missing`，明确说明不会自动下载 |
| 断网/弱网 | 本地语音不依赖网络；未来在线适配器不可绕过独立同意 |
| 超时/资源不足 | 90 秒硬超时；CPU 线程最多 2、worker 1；提示缩短录音 |
| 磁盘不足 | 写入前保留至少 32 MB，返回可释放空间的提示 |
| Windows 声音缺失 | TTS 就绪检查失败或 SAPI 返回可理解错误，不切换 Edge TTS |

验证：`npm.cmd run test:window05:reliability` 覆盖无 Python、无模型、禁止联网/下载、本地 SAPI 输出、磁盘不足与资源上限；打包资源路径由 `electron-builder.yml` 固定。
