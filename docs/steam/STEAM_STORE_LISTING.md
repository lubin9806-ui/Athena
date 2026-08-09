# Athena Steam 1.0 Store Listing Source

> Source copy only. Not uploaded or approved. It contains no external links and only describes the intended Steam launch boundary.

## Short description

一位住在本机里的 AI 陪伴者与创作搭档。用本地模型聊天、创作、推理，并由你掌握记忆与数据。

## About this software

Athena 是一款面向 Windows 的本地优先 AI 桌面应用。默认助手人格保持中性可靠，也支持用户通过本地角色卡自定义交流风格；在创作与推理模式中，她能帮助你发展想法、整理判断。

首发包含：

- 陪伴、创作与推理三种对话模式
- 用户可查看、检索、编辑、导出和删除的本机记忆
- 本地 Whisper 语音识别与 Windows 本地朗读
- 日间/夜间界面与可调整的个性化设置
- 受限的文件执行档；不包含 Full Execute、命令行、终端、程序启动或任意网络请求
- Steam 启动、所有权校验与 SteamPipe 更新

Athena 的聊天与记忆默认保存在本机。Steam 1.0 首发不上传聊天、记忆或数据库，也不包含 Steam Cloud 同步。网页搜索、云账号、跨设备同步、Mobile、macOS、Linux 与 Steam Deck 支持不在首发版本中。

运行时回复由用户配置的本地 Ollama 模型生成。Steam 安装包不包含大语言模型；首次使用前需要安装兼容的本地 Ollama 运行时和模型。

## Supported platform

- Windows x64 only
- Do not select Linux, macOS, or Steam Deck compatibility before real platform testing.

## Candidate system requirements

These values require clean-machine validation before upload:

- OS: Windows 10/11 64-bit
- Memory: 16 GB minimum; 32 GB recommended for the default 14B local model
- Storage: 2 GB for Athena, plus the separately installed local model (approximately 10 GB for the current default quantization)
- Additional: Steam client, Ollama, and a compatible local model

Valve requires the store page to show only launch-ready features, screenshots from the actual product, no external links in the description, and a near-final build. See the [Steam review process](https://partner.steamgames.com/doc/store/review_process).
