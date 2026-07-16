# Athena 产品矩阵

> 基线日期：2026-07-15  
> 本矩阵定义“现在有什么”和“各商业平台允许承诺什么”。任何商店页、官网、报价单和发布说明必须与本矩阵一致。

当前技术版本：`0.8.0`；商业阶段：Commercial Baseline C0 / Internal Alpha。

## 1. 状态图例

| 标记 | 含义 |
|---|---|
| GA | 该平台正式承诺并通过发布门 |
| Beta | 可发布但明确标注 Beta/高级功能，有独立安全边界 |
| Partial | 当前实现不完整或依赖外部环境，不能作为无条件卖点 |
| Planned | 属于目标版本，但尚未实现 |
| Excluded | 明确不属于该平台版本 |
| N/A | 不是该平台职责 |

当前仓库列只描述实况；平台列描述目标 SKU 边界，不表示已经实现。

## 2. 功能分配

| 能力 | 当前仓库 | Desktop Direct 1.0 | Steam 1.0 | Mobile 1.0 | Cloud 1.0 | 备注 |
|---|---|---|---|---|---|---|
| Windows Electron 桌面壳 | 已实现 | GA | GA | Excluded | N/A | 当前只验证 Windows x64 |
| Create / Companion / Reason | 已实现 | GA | GA | GA | API 支撑 | 三个平台保持语义一致 |
| Execute 电脑操作 | 已实现，高风险 | Beta，默认 Off | Excluded（首发） | Excluded | Excluded | Desktop 需显式授权、高危确认和审计 |
| Ollama 本地推理 | 已实现 | GA | Planned/可选 | Excluded | Excluded | Steam 是否捆绑模型取决于许可和 Depot 策略 |
| 云端模型推理 | 未实现 | 可选后续 | 可选后续 | GA | GA | 需账号、配额、计费、内容安全 |
| DeepSeek/fallback | 仅配置 | Excluded，直至真实实现 | Excluded | Planned | Planned | 不得把配置项写成能力 |
| SQLite 本地聊天历史 | 已实现 | GA | GA | Excluded | N/A | 需保留/导出/清除和加密决策 |
| 画像/事件/项目长期记忆 | 已实现 | GA | GA | GA（同步视图） | GA（加密服务） | Mobile 不直连 SQLite |
| 记忆管理与 JSON 导入 | 已实现 | GA | GA | Partial | API | 导入内容需明确本地/云去向 |
| 跨设备记忆同步 | 未实现 | Planned | Planned | GA | GA | Cloud 1.0 是 Mobile 1.0 前置 |
| 数据导出 | 未实现（只有设置） | GA | GA | GA | GA | JSON/Markdown 必须真能导出 |
| 一键清除/账号删除 | 仅逐条删除 | GA（本机数据清除） | GA | GA | GA | 账号平台同时删除关联云数据 |
| 搜索 + 来源卡片 | 已实现 | GA，可关闭 | GA，可关闭 | GA（云代理） | GA（服务） | 披露查询发送至第三方 |
| 深读与二次搜索 | 已实现 | GA | GA | Beta | GA | provider 稳定性和速率限制前置 |
| 麦克风录音 | 已实现 | GA | GA | GA | N/A | 最小权限、拒绝后仍可打字 |
| STT | Partial | GA（固定架构后） | GA（固定架构后） | GA | 可选服务 | 当前会用 Google 或本地 Whisper |
| TTS | Partial | GA（固定架构后） | GA（固定架构后） | GA | 可选服务 | 当前 Edge TTS 会发送文本 |
| 提醒 | 进程内 Partial | GA（持久化后） | GA（持久化后） | GA | 同步 API | 当前重启会丢失 |
| 固定工作流模板 | 已实现有界 start/next/cancel/complete 会话 | Beta | Beta | Beta | N/A | 不是持久化或第三方自动化引擎 |
| Skills 生命周期 | 骨架 | Excluded 首发 | Excluded | Excluded | Excluded | 无商业插件协议和沙箱 |
| 第三方插件市场 | 未实现 | Excluded | Excluded | Excluded | Planned 后续 | 不进入 1.0 承诺 |
| Live2D/动态角色 | 未实现 | Excluded 首发 | Excluded 首发 | Excluded 首发 | N/A | 旧 roadmap 愿景，不是现有功能 |
| 本地文件管理 | 已实现 | Beta，显式授权 | Excluded 首发 | Excluded | Excluded | 不属于聊天默认能力 |
| PowerShell/CMD/程序启动 | 已实现 | Beta，最高风险 | Excluded 首发 | Excluded | Excluded | 必须有确认、停止和审计 |
| HTTP/端口工具 | 已实现 | Beta，显式授权 | Excluded 首发 | Excluded | Excluded | 与搜索研究是不同权限域 |
| 设置中心 | 已实现但部分无效 | GA（清理后） | GA | GA | 管理台 | 无效设置必须实现或移除 |
| 主题/玻璃动效/四模式 UI | 已实现 | GA | GA | 重新适配 | N/A | Mobile 不直接缩放桌面布局 |
| 账号与身份 | 未实现 | Excluded 首发/购买许可另定 | Steam 身份 | GA | GA | Desktop 1.0 可保持无登录本地优先 |
| 许可证/权益 | 未实现 | GA（商业策略选定后） | Steam 所有权 | 商店收据 | GA | 各平台权益不能互相假定 |
| 订阅/支付/恢复购买 | 未实现 | Planned 后续 | Steam Wallet（若使用） | GA | GA | Steam 不得引流非 Wallet 内购 |
| 自动更新/回滚 | 未实现 | GA | Steam 更新 | 商店更新 | GA（滚动/回滚） | 每个平台独立机制 |
| 崩溃诊断 | 未实现 | GA（最小化、可退出） | GA | GA | GA | 隐私同意和数据最小化 |
| 离线安装包 | 已实现但未核验 | GA（许可通过后） | Excluded | Excluded | N/A | 当前脚本复制整个用户 Ollama 模型目录，不可直接发布 |
| Steam Cloud | 未实现 | N/A | Planned/受限 | N/A | N/A | 仅同步白名单小文件；需加密和冲突策略 |
| 多租户、配额、审计 | 未实现 | N/A | N/A | 消费方 | GA | Cloud 的核心职责 |
| 备份恢复、SLO、事件响应 | 未实现 | 本机备份 | 平台/本机 | 消费方 | GA | Cloud 发布硬门 |

## 3. 平台 SKU 定义

### Desktop Direct 1.0

- 目标用户：需要本地优先、长期记忆和可选桌面自动化的 Windows 个人用户。
- 核心承诺：本地对话、三种普通模式、可管理记忆、可关闭联网搜索、透明语音数据路径。
- 高级承诺：Execute 作为 Beta 独立入口，默认关闭，不进入首次启动的默认权限。
- 商业形式：一次性许可证优先；云订阅不作为 1.0 必需条件。
- 系统范围：Windows 10/11 x64 的明确最低版本；其他系统不展示支持。

### Steam 1.0

- 目标用户：通过 Steam 获取和更新的 Windows 创作/陪伴软件用户。
- 核心承诺：Desktop 的非高风险核心 + Steam 所有权/更新。
- 安全裁剪：首发不提供 Full 终端、程序启动、任意 HTTP 和任意文件写删。
- 数据：本地记忆默认留在本机；Steam Cloud 只能同步经过加密、大小限制和冲突处理的白名单数据。
- 商店表述：只展示当前 build；生成式 AI、开发期 AI 素材和 live-generated guardrail 如实填写内容问卷。

### Mobile 1.0

- 目标用户：随身聊天、语音和查看/延续记忆的 iOS/Android 用户。
- 核心承诺：Create/Companion/Reason、云推理、同步记忆、语音、通知、订阅恢复、数据权利。
- 明确排除：Desktop Execute、本地 14B、任意文件、终端、托盘和桌面常驻。
- 架构前置：必须使用 Cloud 1.0 的公开版本化 API；不能直接暴露桌面数据库格式。

### Cloud 1.0

- 目标客户：Athena 自有 Desktop/Mobile 客户端，不在首版开放任意第三方调用。
- 核心承诺：身份、同步、模型路由、配额/权益、审计、备份、导出/删除、可观测性和安全响应。
- 数据原则：本地优先是默认；只有用户明确开启同步的数据才上传；提示、语音和工具日志按最小化策略处理。
- 明确排除：远程控制个人电脑、无边界插件执行、无同意遥测。

## 4. 当前不可用于营销的表述

- “完全离线”或“所有数据都不离开设备”：搜索、Google STT、Edge TTS 会联网。
- “支持云同步/手机端/Steam/跨平台”：当前没有实现。
- “完整工作流/插件生态/Live2D”：当前为骨架或缺失。
- “企业级安全”或“数据已加密”：当前没有静态加密与商业安全证明。
- “1.0 正式版”：`package.json` 的 `1.0.0` 只是技术元数据，未通过商业发布门。

允许的当前描述是：**Windows 本地优先 AI 桌面 Alpha；Ollama 推理、本地记忆、可选联网搜索和受控电脑工具已具备可运行原型。**
