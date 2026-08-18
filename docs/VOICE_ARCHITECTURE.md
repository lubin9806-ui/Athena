# Athena Desktop 1.0 语音架构决策

> 决策日期：2026-07-16；交付验证更新：2026-07-22。

## 固定方案

- STT：本地 `faster-whisper==1.2.1`，CPython 3.11.9 Windows x64 受管 sidecar，模型必须作为审核过的本地目录预置。`HF_HUB_OFFLINE=1`、`TRANSFORMERS_OFFLINE=1` 和 `local_files_only=True` 三层禁止运行时下载。
- TTS：Windows SAPI (`System.Speech`) 本地合成 WAV；使用用户系统已安装声音，不捆绑或转售声音资源。
- 播放：Windows `System.Media.SoundPlayer` 本地播放 Athena 生成的 WAV，不依赖 Python。
- 在线 STT/TTS：当前没有 provider、设置或入口，不进入 Desktop/Steam 1.0 宣传。未来签约适配器必须分别复用窗口 03 的 `onlineSpeechToText` / `onlineTextToSpeech` 同意门，禁止隐式 fallback。

顶层依赖约束记录在 `requirements-voice.txt`，完整可重复依赖闭包锁在 `requirements-voice.lock.txt`。`npm.cmd run prepare:voice-runtime` 从 Python 官方来源生成 CPython 3.11.9 Windows x64 sidecar，并从固定提交生成 `Systran/faster-whisper-tiny` 本地模型。输出位于被 Git 忽略的 `resources/voice-runtime`，每个交付文件记录在 `voice-runtime-manifest.json` 中并使用 SHA-256 验证。

正式打包不会联网生成运行时。`scripts/build-desktop.js` 在调用 `electron-builder` 前执行 `scripts/verify-voice-runtime.js`；运行时缺失、文件大小变化、哈希不一致或 Python 导入失败都会中止打包。`electron-builder.yml` 只把验证通过的生成目录复制到安装包的 `resources/voice`。

受管运行时只保留语音执行所需的 `python.exe`。pip 生成的转换器、测试器、控制台入口和 `pythonw.exe` 会在生成阶段删除；候选包要求 `python.exe` 保持 Python Software Foundation 的有效签名与时间戳，任何额外 EXE 都会被发布门阻断。

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

验证：

- `npm.cmd run test:voice-runtime`：逐文件哈希、受管 Python 导入和 SAPI WAV 输出。
- `npm.cmd run test:voice:e2e`：SAPI 中文合成后由内置 Whisper 离线转写。
- `npm.cmd run smoke:electron`：Electron UI、IPC 和麦克风权限边界。
- 临时目录静默安装验证：确认安装后的 `resources/voice/python`、`resources/voice/models/whisper-tiny` 和 `Athena.exe --smoke-test`，完成后卸载并删除测试目录。
