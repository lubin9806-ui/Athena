# Athena 可见设置运行时审计

> 审计日期：2026-07-16；原则：发布 UI 中每个 `setting-*` 控件必须保存并驱动行为，否则移除。

| 类别 | 真实运行路径 |
|---|---|
| 启动/托盘/通知/模型连接 | `DesktopSettings` 写 Windows 登录项；主窗口 close 动态读取 close-to-tray；提醒读取通知开关；启动探测读取 auto-connect |
| 外观/UI | renderer 立即应用 theme、animation、glass、compact、startup intro |
| 对话 | Enter/Ctrl+Enter、stream IPC、时间戳、历史持久化均读取设置 |
| Execute | mode permission、轮数和命令超时进入 ToolRuntime；其他模式强制 Off |
| 搜索 | enabled/mode/result/page/deep-read/secondary 与独立同意同时进入主进程搜索计划 |
| 个性化/记忆 | PromptBuilder、检索类别/深度、自动提取和重要度门读取设置 |
| 语音 | 本地 STT/TTS/自动朗读/停顿/声音名均有运行路径；旧 auto/Google STT 和不可用在线语音同意控件已移除 |
| 数据 | 删除确认、历史保留、语音缓存保留和导出格式均有执行路径 |
| 模型 | Ollama URL/model/temperature/maxTokens/numCtx 进入 LLMClient |

`npm.cmd run test:window05:reliability` 会枚举所有可见设置 ID、验证 renderer wiring，并用隔离配置往返验证代表值；Electron smoke 继续验证 preload/DOM/模式和设置桥。
