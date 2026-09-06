# Athena 隐私与数据地图

> 窗口 03 证据文件。适用范围仅为 Desktop 本机 Alpha；未实现账号、Athena Cloud、Steam Cloud 或 Mobile。

## 数据地图

| 数据类别 | 保存位置 | 是否离开设备 | 保留/清除 |
|---|---|---|---|
| 聊天消息 | SQLite `chat_messages`、`chat_windows`（滚动摘要与工作状态含消息文本）、`context_snapshots`（上下文预览含消息文本）、旧全局 `messages`、`memory_index` | Ollama 默认只发往本机；选择远程 Provider 并同意后，请求和相关上下文会发往配置的 API 地址 | `saveHistory=false` 后：不写 `messages`、不折入窗口摘要与工作状态、不写 `context_snapshots`、不提取长期记忆、不进云同步；`chat_messages` 标记为 `ephemeral` 仅供当前会话使用，在下次启动或历史重新开启时删除（含其附件文件）。`historyRetentionDays` 到期后清理旧 `messages` 与窗口聊天 `chat_messages`（含其附件文件、上下文快照，并从窗口滚动摘要中剔除）；一键清除删除全部 |
| 长期记忆 | SQLite `profile`、`events`、`project_notes`、`memory_index` | 不自动上传；远程模型同意开启后，当前请求所需的相关记忆可能随上下文发送 | 历史关闭后停止自动提取；记忆面板或一键清除删除 |
| 设置与个性化 | `config/settings.json`、`config/model.json` | 不自动上传 | 用户修改或删除配置目录；导出包含脱敏副本 |
| 搜索查询 | SQLite `data_activity_records` 的最小活动记录 | 同意后发往 Sogou/Bing/DuckDuckGo 和结果网页 | 历史关闭时不记录；历史保留期自动清理；一键清除删除 |
| 语音文件 | `%TEMP%\athena\voice` 或 `ATHENA_VOICE_TEMP_DIR` | Desktop 当前 Whisper STT 与 Windows SAPI TTS 均在本机处理 | 录音转写后删除；WAV TTS 缓存按小时清理；一键清除删除 |
| 工具记录 | SQLite 最小活动记录；执行面板内存态详细记录 | 外部 HTTP/TCP 需外网工具同意和逐次确认；localhost 不算外部网络 | 历史关闭时不记录；历史保留期自动清理；当前窗口执行记录不持久化 |
| 任务产物文件 | 当前 Project 根目录下的 `.athena/artifacts/<task-id>` | 文档生成完全本地；本地生图不外发，云端生图仅在独立同意与逐次审批后向当前所选 Provider 发送提示词 | 任务数据库记录可一键清除；实际文件由用户在 Project 中保留或删除 |
| 日志/崩溃诊断 | stdout/stderr；`%TEMP%\athena\diagnostics\crash-diagnostics.jsonl` | 不自动上传 | 诊断脱敏、单文件 1 MB、最多 3 个轮转文件；隐私中心可导出无聊天内容的支持包或只删除已知诊断文件 |
| 临时文件 | 语音缓存、导出目录、数据库迁移备份 | 不自动上传 | 语音缓存自动清理；迁移备份用于失败恢复；导出文件由用户管理 |

### 关闭“保存聊天历史”的准确含义

关闭该开关后，对话在当前会话内仍然正常工作——消息要能显示、多轮上下文要能成立，因此这些消息**确实会写入本机 SQLite**，只是被标记为 `ephemeral`，并在下次启动或历史被重新开启时连同附件文件一起删除。

这不等于“完全不落盘”。做到真正不触碰磁盘需要一套内存态消息存储，检索与界面都要改，属于尚未开始的独立工作。在那之前，此处不使用“不保存”的说法。

已经存在的历史不会因为关闭开关而被删除；关闭的含义是“从现在起不再保留新内容”，删除与保留期是另外的控件。

## 联网能力与首次同意

所有下列能力默认为未同意。设置抽屉的“隐私与数据中心”显示说明并保存同意状态。

| 能力 | 发送内容 | 目的地 | 同意键 |
|---|---|---|---|
| 远程模型服务 | 当前请求、系统提示、相关对话、检索到的记忆上下文和工具规划内容 | 用户明确选择并配置的 OpenAI、DeepSeek、Athena Cloud 或自定义 API 地址 | `privacy.networkConsent.remoteModel` |
| 联网搜索和网页深读 | 搜索词、结果 URL、网页请求元数据 | Sogou、Bing、DuckDuckGo、结果网页域名 | `privacy.networkConsent.webSearch` |
| 云端生图服务 | 用户逐次批准的提示词、输出设置；编辑时还包括明确选择的参考图 | 用户在设置中明确选择的 OpenAI、Google、Stability、BFL、火山方舟、通义万相、Replicate、fal.ai 或自定义 API 地址 | `privacy.networkConsent.imageGeneration`；Athena 本地引擎不需要该联网授权 |
| 在线语音识别 | 当前没有 provider/入口 | 不发送 | 未来适配器必须复用 `privacy.networkConsent.onlineSpeechToText`，不能从本地失败静默回退 |
| 在线语音合成 | 当前没有 provider/入口 | 不发送 | 未来适配器必须复用 `privacy.networkConsent.onlineTextToSpeech`，不能从本地失败静默回退 |
| 执行模式外部网络工具 | 用户确认的 HTTP/TCP 目标、请求头和正文 | 用户指定的外部网络地址 | `privacy.networkConsent.externalToolNetwork` |

未同意时，主进程会拒绝相应能力；不是只在 UI 隐藏。API Key 使用 Electron `safeStorage` 绑定当前 Windows 用户加密保存，不写入 `config/model.json`、源码或安装包，也不会回显到渲染进程。

## 静态保护决策

当前 SQLite 数据库仍为明文。窗口 03 不宣称“已加密存储”。

威胁评估：

- 可抵御：应用内导出、清除、保留期执行，迁移失败导致的数据损坏，以及误把在线能力当成本地能力。
- 不可抵御：同一 Windows 账户下的恶意软件、具备磁盘读取权限的本地用户、离线复制数据库文件后的读取。
- 当前补偿控制：日志脱敏、执行权限默认关闭、高风险逐次确认、联网能力逐类同意、数据库迁移前备份与失败恢复。

决策：本窗口不引入 SQLCipher/DPAPI 包装，避免在缺少密钥管理、升级矩阵和恢复演练时制造不可恢复风险。Desktop Beta 前必须重新评估 Windows DPAPI 保护密钥或 SQLCipher。

## 验证

```powershell
npm.cmd run test:privacy
```

通过标记：`ATHENA_PRIVACY_DATA_OK`。
