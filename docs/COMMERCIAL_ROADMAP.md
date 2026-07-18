# Athena 商业化总路线图

> 基线日期：2026-07-15  
> 适用仓库：`G:\Athena`  
> 文档角色：商业化范围、优先级和 Go/No-Go 的唯一总路线图。问题状态以 `docs/ISSUE_REGISTER.md` 为准，协作规则以 `docs/WORK_PROTOCOL.md` 为准。旧的 `docs/roadmap.md` 仅保留为产品愿景，不再作为版本承诺。

## 1. 结论

Athena 当前是一个**可运行的 Windows Desktop 0.9 Private Beta 候选工程**，不是可直接公开销售的 1.0。仓库元数据已统一为 `0.9.0-beta.1`；在代码签名证书、安装矩阵和真实 20–50 人受控测试完成前仍为 **No-Go**。

当前判定：

- Desktop Direct：**No-Go**。窗口 11 于 2026-07-18 刷新确认 typecheck、迁移/回滚、供应链、故障降级、商业边界、开发 smoke 与 npm audit 可重复，但发行配置已漂移为 Execute=`full` 且部分联网同意=true，安全/隐私门实际失败并重开 ATH-SEC-003、ATH-PRIV-001；当前 installer 为完整大小但 `NotSigned`，正式签名、干净候选、安装/升级矩阵和商业外部依赖仍缺失。
- Steam：**Blocked / No-Go**。窗口 08 已落地独立 SKU、Steamworks 启动/所有权 fail-closed 边界、SteamPipe 模板、Cloud 空白名单协议、AI 申报草案与商店素材；缺少真实合作方账号、AppID/DepotID、上传分支、签名 near-final build 和 Valve review。
- iOS：**Blocked / No-Go**。没有 iOS 工程、Bundle ID、Apple 账号/证书、TestFlight/App Review、隐私表单或商店材料，且 Cloud 生产前置未满足。
- Android：**Blocked / No-Go**。没有 Android 工程、package ID、Play 账号/签名、AAB/internal track、Data safety 或商店材料，且 Cloud 生产前置未满足。
- Cloud：**Engineering Complete / Blocked / No-Go**。窗口 09 已建立独立服务端、API v1、认证隔离、加密同步、模型/计费/区域可替换接口、数据权利与安全运维基线；真实供应商、区域、计费、生产部署、外部渗透和运营签字未完成。

窗口 11 独立复核与运营政策见 `WINDOW_11_RELEASE_REVIEW.md` 和 `ops/RELEASE_OPERATIONS.md`。五个平台均命中未关闭 P0、缺失外部账号/证书或不可重复证据中的至少一项，因此总发布结论为 **No-Go**；ATH-OPS-001 在真实人员、状态页和平台演练前为 Blocked。

窗口交接判定与商业发布判定必须分开：窗口 01 的 Blocker 已清零，**窗口 02可以开始**；但上述四个平台仍保持 No-Go/Not Started，不能把交接放行解释为产品发布放行。

2026-07-15 的本地验证通过：TypeScript 类型检查、人格、四模式、主题、日志管道、搜索单测、电脑工具权限/撤销/取消测试、Electron 烟测（`ATHENA_SMOKE_READY_TO_SHOW`、`ATHENA_SMOKE_DOM_OK`）和数据库统计。验证证明当前桌面主链路能运行，不代表满足商业发布要求。

## 2. 风险等级

| 等级 | 定义 | 发布规则 |
|---|---|---|
| P0 / Blocker | 可导致安全事件、隐私/许可违规、安装信任失败或商店直接拒绝 | 目标平台不可发布；必须清零 |
| P1 / High | 高概率造成故障、退款、数据丢失、口碑损害或难以维护 | 公开 Beta 前清零；仅可在受控测试中接受 |
| P2 / Medium | 限制体验、规模或效率，但有明确绕行方案 | 进入版本承诺并设负责人/截止点 |
| P3 / Low | 优化、愿景或非核心扩展 | 不阻塞当前平台发布，不得写成首发能力 |

## 3. 现有能力审计

| 模块 | 当前状态 | 审计结论 |
|---|---|---|
| Electron 桌面主链路 | 已实现 | 单实例、托盘、预加载桥、IPC 发送者校验、窗口烟测存在；仅验证 Windows |
| 本地模型 | 已实现 | Ollama + `qwen2.5:14b` 是唯一真实推理路径；DeepSeek/fallback 仅有配置，没有客户端实现 |
| 四种对话模式 | 已实现 | Create、Companion、Reason、Execute 有真实提示词、UI 与工具隔离 |
| 人格与样式 | 已实现 | PromptBuilder、Personality、StyleEngine 和回归测试覆盖核心身份链 |
| 长期记忆 | 已实现 | SQLite 消息、画像、事件、项目、索引、检索、编辑、删除和聊天记录导入可用 |
| 搜索研究 | 已实现 | 搜狗移动、必应中国、DuckDuckGo 回退，正文提取、二次搜索、引用和来源卡片可用 |
| 电脑工具 | 已实现，高风险 Beta | 文件、终端、程序、HTTP、端口等是真实能力；Execute 默认 Off，升权、逐次确认、撤权和取消有回归测试 |
| 语音 | 本地架构已固定 | STT 只接受受管 Python 3.11 + 预置 Whisper 模型，禁止下载/在线回退；TTS 使用 Windows SAPI；缺组件时 UI 禁用并解释 |
| 提醒 | 部分实现 | 仅进程内定时器；重启后丢失，无系统通知持久化保证 |
| 工作流 | Beta 已实现 | 四个固定模板支持 start/next/cancel/complete；不宣称持久化或第三方自动化引擎 |
| 技能/插件 | 骨架或关闭 | SkillManager 只有注册生命周期；PluginManager 与 Planner 明确关闭；`skills/actions.js` 是旧式入口 |
| Live2D/头像/音乐/日历等 | 未实现 | 旧愿景文档有描述，当前运行时没有可售实现 |
| Windows 安装包 | 已实现但未签名 | NSIS 安装器和 9GB 级离线包可生成；正式签名被显式关闭 |
| 更新、回滚、崩溃上报 | 部分实现 | beta/stable updater、签名门、暂停/回滚 fixture 和迁移恢复已实现；真实签名 HTTPS feed 与崩溃上报仍未完成 |
| 账号、订阅、权益 | 商业边界与本地接口已定义 | Desktop 1.0 冻结为无账号的一次性个人许可证，最多 2 台设备、覆盖 1.x；生产支付/许可证平台、公钥、价格和 UI 尚未接入 |
| Mobile / Cloud / Steamworks | Steam 与 Cloud 本地工程边界已实现；Mobile 未实现 | Steam 无真实平台证据；Cloud 无真实供应商/区域/计费/生产部署与外部测试，均不可发布；Mobile 无客户端工程 |

## 4. 风险总览与唯一台账

具体证据、状态、负责窗口和验收条件只维护在 `docs/ISSUE_REGISTER.md`。本路线图只保留风险域和商业影响，避免出现第二套问题状态。

| 风险域 | 台账编号 | 最高等级 | 负责窗口 | 当前影响 |
|---|---|---|---|---|
| 依赖与 Electron 安全 | ATH-SEC-001～003 | P0 | 02 | Desktop/Steam 不可公开发布 |
| 隐私、数据权利与本地保护 | ATH-PRIV-001、ATH-DATA-001 | P0 | 03 | 所有联网/账号平台不可发布 |
| 许可、模型与供应链 | ATH-LEGAL-001、ATH-REPO-001 | P0 | 04 | 离线包和商业素材不可发行 |
| 语音、搜索、设置真实性 | ATH-VOICE-001、ATH-WEB-001、ATH-CONFIG-001 | P1 | 05 | 不可进入公开 Beta |
| 签名、更新、CI 与 Desktop Beta | ATH-REL-001、ATH-DESKTOP-001 | P0 | 06 | Desktop 0.9 不可放行 |
| Desktop 商业运营 | ATH-DESKTOP-002、ATH-PRODUCT-001 | P1 | 07 | Desktop 1.0 不可放行 |
| Steam | ATH-STEAM-001 | P0 | 08 | Steam 不可提交 |
| Cloud | ATH-CLOUD-001 | P0 | 09 | Cloud 与 Mobile 前置不可发布 |
| Mobile | ATH-MOBILE-001 | P0 | 10 | App Store/Google Play 不可提交 |
| 总发布与事件响应 | ATH-OPS-001 | P1 | 11 | 多平台总发布不可签字 |

## 5. 商业版本定义

版本号只在对应发布门通过后提升，不以 UI 完成度或安装包能生成作为依据。

| 版本 | 定义 | 必须达到 | 明确不承诺 |
|---|---|---|---|
| C0 Internal Alpha（当前） | 开发机可运行基线 | 当前非 live 测试与烟测通过 | 安全、隐私、签名、更新、跨平台 |
| Desktop 0.9 Private Beta | 小规模邀请测试 | Desktop P0 清零；签名测试包；隐私/EULA；数据导出/删除；默认工具安全；更新 beta 通道 | Steam、Mobile、Cloud 同步 |
| Desktop 1.0 Direct | Windows x64 正式直售 | 所有通用、Desktop 清单通过；安装/升级/卸载/回滚矩阵；支持和退款流程 | macOS/Linux、账号同步、移动端 |
| Steam 1.0 | Steam Windows 独立 SKU | Desktop 1.0 核心成熟；Steamworks、Depot、所有权、内容问卷、商店页/build review 通过 | Full 终端工具、外部支付、未核验的大模型离线包 |
| Cloud 1.0 | 多租户商业后端 | 账号、加密同步、模型网关、配额计费、审计、导出删除、SLO/备份/事件响应 | 桌面电脑控制、客户端 UI |
| Mobile 1.0 | iOS/Android Companion | Cloud 1.0 先行；移动端聊天、语音、同步记忆、订阅/恢复、隐私标签和商店审核 | 本地 14B、终端/任意文件工具、桌面托盘 |

## 6. 平台边界

### Desktop Direct

包含：Windows x64；本地 Ollama；Create/Companion/Reason；本地记忆与管理；可选联网搜索；经过显式授权的高级 Execute；可验证的语音方案；轻量在线安装包和经许可核验的离线包。

不包含：Steam 权益、跨设备同步、移动客户端、多租户云、macOS/Linux 首发、默认 Full 权限。

### Steam

包含：Windows x64 桌面核心、Steam 所有权与启动、Steam Depot/分支、Steam Cloud 的小型配置/导出文件（仅在加密和冲突策略完成后）、平台合规商店素材。

不包含：首发 Full 终端/任意 HTTP 工具、站外购买链接、未核验的整个用户 Ollama 目录、对 Steam Deck/Linux 的虚假支持。所有运行时 AI 均按 Steam 内容问卷披露，live-generated 路径必须说明 guardrail。

### Mobile

包含：iOS/Android 原生或跨端 Companion；Create/Companion/Reason；账号登录；云端推理；加密记忆同步；麦克风授权后的语音；订阅、恢复购买、账号/数据删除。

不包含：Execute、任意本机文件/终端、桌面托盘、Ollama 14B 本地运行、直接读取 Desktop SQLite、后台常驻桌面行为。

### Cloud

包含：认证和租户隔离；加密同步；模型网关；配额、计费和权益；内容安全与滥用防护；审计日志；数据导出/删除；备份恢复；SLO、监控和事件响应。

不包含：直接控制用户电脑、保存不必要的原始提示/语音、把 Desktop 本地数据默认为云端、在无同意时启用遥测。

详细逐功能分配见 `docs/PRODUCT_MATRIX.md`。

## 7. 路线图与阶段门

### Phase 1：P0 安全、隐私与许可基线

1. 升级 Electron/Vite/electron-builder，处理 audit；开启 sandbox/CSP；清理 source map 和无用依赖。
2. Execute 默认关闭，高危操作确认和范围约束；保持现有撤销/取消回归测试。
3. 完成数据流图、隐私政策、EULA、联网同意、导出/删除/保留策略和敏感数据加密决策。
4. 生成 SBOM、第三方许可与素材来源清单；固定精确 Ollama/Qwen/Python artifact。
5. 恢复有效 Git/CI 和可复现 build metadata。

退出门：所有 Desktop P0 为零，官方 npm audit 无 High/Critical，烟测与安全回归通过。

### Phase 2：Desktop 0.9 Private Beta

1. 代码签名和 Smart App Control 验证。
2. beta 更新、回滚、数据库迁移备份。
3. 语音商业依赖固化；联网/离线降级明确。
4. 设置真实性清理；提醒持久化；安装/升级/卸载矩阵。
5. 支持、反馈、崩溃诊断、版本/隐私页面。

退出门：完成 20–50 名受控测试者的安装、升级、数据恢复和权限测试，无未关闭 P0/P1。

### Phase 3：Desktop 1.0 Direct

1. stable 更新通道、发布签名和最终 SBOM。
2. 官网、购买、许可证/激活策略、退款与支持流程。
3. 性能、长会话、磁盘/内存、离线与弱网测试。
4. 商业素材只描述当前 build 已实现能力。

退出门：`docs/RELEASE_CHECKLIST.md` 的 Universal + Desktop 全部通过并留证。

窗口 07 已完成 SKU、激活/换机/退款/支持边界、可替换本地接口以及官网/商店源稿审计；ATH-PRODUCT-001 已关闭。真实发行主体、价格税务、支付与许可证平台、公钥、公开联系渠道、生产激活 UI 和签字仍为 ATH-DESKTOP-002 外部阻断，因此 Phase 3 保持 **No-Go**。

### Phase 4：Steam 1.0

以 Desktop 1.0 为代码基线创建 Steam SKU；接 Steamworks、Depot、分支、所有权、Steam Cloud 白名单；提交真实商店素材、内容问卷和 near-final build。Valve 明确要求商店页只展示首发已有能力、build 在标注的操作系统正常启动，并要求 live-generated AI 披露 guardrail。

窗口 08 已完成可在无账号环境中诚实验证的工程和材料部分，但保持 **Blocked / No-Go**：`athena-steam-personal-v1`、独立构建、所有权/分支检查、Steam 专用工具与外链裁剪、SteamPipe VDF、Cloud 加密冲突/删除协议、AI 申报草案和 Athens 主题素材已落盘。窗口 03 未批准任何 Cloud 条目，因此白名单为空且运行时关闭；真实 Steamworks 账号、AppID/DepotID、签名构建、私有分支、clean-machine、内容问卷和 Valve review 均未伪造。

### Phase 5：Cloud 1.0，再到 Mobile 1.0

Cloud 必须先于 Mobile 正式版。先完成多租户安全、同步协议、计费/配额和数据权利，再实现移动 Companion。不得把 Electron UI 直接包装成移动 1.0，也不得把 Desktop SQLite 直接暴露为同步协议。

## 8. 明确延期（非首发阻断）

- Live2D、复杂头像表情、音乐、日历、天气插件。
- macOS、Linux、Steam Deck 支持。
- 公共插件市场和第三方技能执行。
- 多模型云路由、团队协作、企业管理。
- 本地模型自动下载器之外的多模型商店。

这些功能在进入已承诺版本前必须先更新产品矩阵；宣传图和商店页不得提前写成已实现。

## 9. 官方审核依据（2026-07-15 核对）

- [Electron Releases：官方仅支持最新三个稳定大版本](https://www.electronjs.org/docs/latest/tutorial/electron-timelines)
- [Microsoft Smart App Control：未知未签名代码可能被阻止](https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/overview)
- [Steam Review Process：商店页与 build 必须只承诺已实现内容](https://partner.steamgames.com/doc/store/review_process)
- [Steam Content Survey：生成式 AI 与 live-generated guardrail 披露](https://partner.steamgames.com/doc/gettingstarted/contentsurvey?l=english)
- [Apple App Review Guidelines：隐私、同意和应用内账号删除](https://developer.apple.com/app-store/review/guidelines/)
- [Apple App Privacy：所有应用要求隐私政策 URL](https://developer.apple.com/help/app-store-connect/reference/app-privacy/)
- [Google Play Developer Program Policy：隐私政策、Data safety 与账号删除](https://support.google.com/googleplay/android-developer/answer/17105854?hl=en)
