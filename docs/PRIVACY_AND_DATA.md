# Athena 隐私与数据地图

> 窗口 03 证据文件。适用范围仅为 Desktop 本机 Alpha；未实现账号、Athena Cloud、Steam Cloud 或 Mobile。

## 数据地图

| 数据类别 | 保存位置 | 是否离开设备 | 保留/清除 |
|---|---|---|---|
| 聊天消息 | SQLite `messages`、`memory_index` | 默认本地 Ollama 端点；联网搜索同意后查询词会发往第三方搜索 | `saveHistory=false` 后不再保存；`historyRetentionDays` 自动清理；一键清除删除 |
| 长期记忆 | SQLite `profile`、`events`、`project_notes`、`memory_index` | 不自动上传；仅作为本地模型上下文 | 历史关闭后停止自动提取；记忆面板或一键清除删除 |
| 设置与个性化 | `config/settings.json`、`config/model.json` | 不自动上传 | 用户修改或删除配置目录；导出包含脱敏副本 |
| 搜索查询 | SQLite `data_activity_records` 的最小活动记录 | 同意后发往 Sogou/Bing/DuckDuckGo 和结果网页 | 历史关闭时不记录；历史保留期自动清理；一键清除删除 |
| 语音文件 | `%TEMP%\athena\voice` 或 `ATHENA_VOICE_TEMP_DIR` | 在线 STT 发送音频；在线 TTS 发送朗读文本，均需分别同意 | 录音转写后删除；TTS 缓存按小时清理；一键清除删除 |
| 工具记录 | SQLite 最小活动记录；执行面板内存态详细记录 | 外部 HTTP/TCP 需外网工具同意和逐次确认；localhost 不算外部网络 | 历史关闭时不记录；历史保留期自动清理；当前窗口执行记录不持久化 |
| 日志 | stdout/stderr；应用 Logger 不主动写持久日志 | 不自动上传 | 已有 `logs/` 来源不明文件不由窗口 03 删除；Logger 脱敏由回归测试覆盖 |
| 临时文件 | 语音缓存、导出目录、数据库迁移备份 | 不自动上传 | 语音缓存自动清理；迁移备份用于失败恢复；导出文件由用户管理 |

## 联网能力与首次同意

所有下列能力默认为未同意。设置抽屉的“隐私与数据中心”显示说明并保存同意状态。

| 能力 | 发送内容 | 目的地 | 同意键 |
|---|---|---|---|
| 联网搜索和网页深读 | 搜索词、结果 URL、网页请求元数据 | Sogou、Bing、DuckDuckGo、结果网页域名 | `privacy.networkConsent.webSearch` |
| 在线语音识别 | 用户选择或录制的音频片段 | `speech_recognition` 使用的 Google 在线识别服务 | `privacy.networkConsent.onlineSpeechToText` |
| 在线语音合成 | 要朗读的助手回复文本 | Edge TTS 在线语音服务 | `privacy.networkConsent.onlineTextToSpeech` |
| 执行模式外部网络工具 | 用户确认的 HTTP/TCP 目标、请求头和正文 | 用户指定的外部网络地址 | `privacy.networkConsent.externalToolNetwork` |

未同意时，主进程会拒绝相应能力；不是只在 UI 隐藏。

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
