# Athena Desktop 1.0 语音架构决策

> 决策日期：2026-07-16；交付验证更新：2026-07-22。

## 固定方案

- STT：本地 `faster-whisper==1.2.1`，CPython 3.11.9 Windows x64 受管 sidecar，模型必须作为审核过的本地目录预置。`HF_HUB_OFFLINE=1`、`TRANSFORMERS_OFFLINE=1` 和 `local_files_only=True` 三层禁止运行时下载。
- STT 进程模型：`--serve` 常驻 sidecar 复用已加载模型（实测短句 1439ms→608ms），空闲 5 分钟回收，stdin EOF 自退。**常驻是优化不是依赖**——握手完成前、忙碌时、以及 worker 崩溃时一律回落一次性 spawn，起不来只是慢。`ATHENA_STT_WORKER=0` 关闭。
- STT 语言：`auto`（默认，由 Whisper 从音频判定）或钉死一个 ISO 639-1 码。默认不钉死是因为钉错语言会把语音解成通顺的胡话——实测英文按 `zh` 解码为 0% 且慢 2.7 倍，而 `auto` 在中英素材上与钉死同语言准确率相同。
- TTS：默认 **Piper 本地神经语音**（`zh_CN-huayan-medium`，ONNX，MIT，与 faster-whisper 共用同一份 `onnxruntime`）。选它是因为 SAPI 是神经网络之前的拼接式引擎，参数怎么调都不像人在说话；而 Piper 的发音引擎是 Python 扩展模块（`espeakbridge.pyd`）而非独立 exe，能通过「受管运行时只允许 `python.exe`」那条发布门。
- TTS 回退：Windows SAPI (`System.Speech`)，用于没有打包神经音色的构建；使用用户系统已安装声音，不捆绑或转售声音资源。
- 音色档：语速(-10..10) 与音量(0..100) 两个引擎都支持——Piper 侧语速映射为 `length_scale = 2^(-rate/10)`（关于 0 对称，线性映射会让慢的一端早早不可用）。**音高只有 SAPI 有**（经 `SpeakSsml` 的 `<prosody>`，`xml:lang` 必须取实际选中声音的 culture，否则 SAPI 会整段换声）；Piper 没有音高参数，该控件在其下禁用而非假装可调。
- **已知不足**：Piper 的韵律是固定的，`noise_w_scale` 调的是随机性不是意图，因此**不会随说话内容改变语气**。要做到那样需要指令/情感可控的 TTS（体积与算力都高一个量级）或语音到语音模型，均未实现也不进宣传。**不含声音克隆**。
- 播放：Windows `System.Media.SoundPlayer` 本地播放 Athena 生成的 WAV，不依赖 Python。**开启打断时改用应用内播放**——浏览器回声消除只对本页播放的音频有参考信号，交给 PowerShell 播放就等于让 Athena 听见自己。
- 打断（barge-in）：默认关闭。开启后朗读期间常开麦克风做响度判定（不录制、不落盘、不转写），残余回声成为检测器测得的本底，人声须显著高于它。判定门槛比听写更严（绝对下限 0.02、需高出本底 4 倍、连续 ~340ms），因为误打断比漏打断更扰人。
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
- `npm.cmd run prepare:voice-scripts`：只重新拷贝六个语音脚本并重新固定 manifest。改 `stt_whisper.py` 或任一 `.ps1` 后必须执行，否则哈希失配。它不是绕过完整性门：其余文件必须逐一匹配旧 manifest，且目录内不得出现未登记文件，任一条不满足就退回完整 `prepare:voice-runtime`。
- `npm.cmd run test:voice-input`：分段度量（能力探测/解释器/import/模型加载/解码）、中英素材准确率下限、听写热路径 150ms 预算，以及「把设置钉成错误语言后准确率必须下降」的端到端断言。
- `npm.cmd run test:voice-output`：直接对合成音频断言音色档生效——语速改变时长、音量改变峰值、音高走 SSML 后不换声。
- `npm.cmd run test:voice-activity`：纯函数端点检测的 13 个合成场景，含听写与打断两套参数。
- `npm.cmd run smoke:electron:voice`：真实录音下的动画契约守卫（`data-voice-state`、`#input-aura` 不透明度、两个 glow 变量的写入与清空）。
- `npm.cmd run test:voice:e2e`：SAPI 中文合成后由内置 Whisper 离线转写。
- `npm.cmd run smoke:electron`：Electron UI、IPC 和麦克风权限边界。
- 临时目录静默安装验证：确认安装后的 `resources/voice/python`、`resources/voice/models/whisper-tiny` 和 `Athena.exe --smoke-test`，完成后卸载并删除测试目录。
