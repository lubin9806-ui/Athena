# Athena 商业化问题台账

> 基线日期：2026-07-15  
> 这是唯一问题台账。严重级别、状态和交接规则见 `WORK_PROTOCOL.md`。

## 1. 状态汇总

| 严重级别 | Closed | Open/In Progress/Blocked | 说明 |
|---|---:|---:|---|
| Blocker | 7 | 0 | 窗口 01 的仓库、事实源与验证链 Blocker 已全部关闭 |
| P0 | 7 | 9 | ATH-SEC-001～003、ATH-PRIV-001、ATH-DATA-001、ATH-LEGAL-001、ATH-DATA-002 已关闭；ATH-REL-001 及 Steam/Cloud/Mobile P0 未关闭；2026-09-03 新登记 ATH-SEC-004；2026-09-06 新登记 ATH-CLOUD-004、ATH-SEC-005～007 |
| P1 | 4 | 6 | ATH-VOICE-001、ATH-WEB-001、ATH-CONFIG-001、ATH-AGENT-001 已关闭；Desktop/运营三项保持 Blocked；2026-09-06 新登记 ATH-DATA-003、ATH-CHAT-005、ATH-SEC-008 |
| P2/P3 | 4 | 16 | ATH-ARCH-001、ATH-PRODUCT-001、ATH-AUTO-001、ATH-CHAT-001 已关闭；ATH-REPO-001 保持未关闭；2026-09-03 新登记 ATH-VOICE-002、ATH-CLOUD-002、ATH-REPO-002、ATH-CHAT-002～004、ATH-STAB-001、ATH-WEB-002、ATH-IMG-001～003、ATH-CLOUD-003；2026-09-06 新登记 ATH-INIT-001、ATH-PERF-001 |

> 2026-09-06 数据库 schema 升至 **16**（`chat_messages.ephemeral`）。迁移为幂等 `ALTER TABLE`，既有行落为 `ephemeral=0`；`test:release` 新增有数据的 15→16 用例，`create-seed-database` 输出 `schema=16 contentRows=0`。各套件中硬编码的 schema 断言已同步更新为 16——这些断言是“改了 schema 请复查本模块”的绊线，本轮正是它暴露了 ephemeral 消息被清除时附件文件会成为磁盘孤儿的问题。

> 2026-09-06 独立核验（Claude Code，基线 `main@7829e85`，纯静态读码 + 定向回归）：对外部审计提出的 13 条候选缺陷抽查 9 条，全部在本地源码复现，据此新登记 ATH-DATA-002/003、ATH-CLOUD-004、ATH-SEC-005～007、ATH-AGENT-001、ATH-CHAT-005、ATH-AUTO-001。其中三条已在同日修复（ATH-AGENT-001、ATH-AUTO-001 关闭；ATH-CHAT-005 待补确定性回归）。两处对外部审计描述的修正已写入对应条目证据栏：ATH-CLOUD-004 的根因比“只看窗口模式”更靠前（逐条 mode 已在 payload 里却不用于过滤）；ATH-SEC-005 的方向与外部描述相反（降权生效，提权同样即时生效才是问题）。**ATH-DATA-002 与已关闭的 ATH-DATA-001 验收证据直接冲突，是否重开由数据负责人决定。**
>
> 未核验项（外部审计列出但本轮未复现，不得据此认定成立或不成立）：BUG-007 桌面同步增量性（与 ATH-CLOUD-002 重叠）、BUG-008 长文误路由（ATH-CHAT-001）、BUG-009 协议错误穿透（ATH-CHAT-003）、BUG-010 多轮创作漂移（ATH-IMG-002）。

> 2026-09-03 需求澄清（用户确认，本轮排期）：四类问题全部处理（对话路由与执行链路、搜索稳定性、账号与图像生成、整体稳定性与流畅度）；长文优先判定为生图意图；图片反推提示词做进对话内；账号系统先修体验；生图提示词多轮修改采用增量编辑+自动合并，完整版可查看可复制；角色/脸部一致性采用参考图/seed 机制；对话智能性（ATH-CHAT-004）：执行前先输出理解与计划扩展要点供确认，技术细节可自主扩展而角色特征锁定，覆盖所有模式，评估允许换更强模型。

窗口 07 判定：ATH-PRODUCT-001 有可重复营销审计证据并关闭；ATH-DESKTOP-002 的 SKU/策略/本地接口已定义，但因真实主体、支付/许可证平台、公开渠道和签字缺失转为 Blocked。Desktop 1.0 仍因 ATH-REL-001、ATH-DESKTOP-001、ATH-DESKTOP-002 及 Universal/Desktop 清单未完成项保持 No-Go。

## 2. 窗口 01 基线问题

| 编号 | 问题 | 证据 | 严重级别 | 负责窗口 | 状态 | 验收条件 |
|---|---|---|---|---|---|---|
| ATH-W01-001 | `.git` 是空目录，Git 命令无法识别仓库 | 审计时 `.git` 递归对象数为 0；原地初始化后 `rev-parse=true`、branch=`main`；G: 盘仅添加精确 `safe.directory` | Blocker | 01 | Closed | 不删除任何内容；原地初始化 main；`git rev-parse --is-inside-work-tree` 为 true，`git status` 可运行 |
| ATH-W01-002 | `.gitignore` 未覆盖本地模型、安装器、Python 缓存、用户记忆和根目录探针 | 原 `.gitignore` 仅 333 bytes；5.4GB 模型和 672MB Ollama installer 可被误纳入初始提交 | Blocker | 01 | Closed | ignore 规则覆盖运行/构建/用户/大文件；商业文档和归档 manifest 仍可追踪；`git check-ignore` 验证 |
| ATH-W01-003 | 根目录混有语音探针、下载日志、758MB `public.zip` 和快捷方式 | 2026-07-15 根目录清单及 SHA-256 | Blocker | 01 | Closed | 不删除；明确生成物移入 `legacy/root-artifacts/preserved-files`；README + SHA-256 manifest 落盘；未知目录不动 |
| ATH-W01-004 | 版本元数据把 Internal Alpha 标成 `1.0.0`；PowerShell 默认编码造成“乱码”误判 | `package.json`/`APP_VERSION` 为 1.0.0；`Get-Content -Encoding UTF8` 证明源文件无乱码 | Blocker | 01 | Closed | 统一为 0.8.0 Internal Alpha；新增 UTF-8 `.editorconfig`；README 明示非正式 1.0 |
| ATH-W01-005 | 当前 npm 镜像不实现 advisory endpoint，默认 `npm audit` 返回 404 | `registry=https://registry.npmmirror.com`；404 `[NOT_IMPLEMENTED]` | Blocker | 01 | Closed | `npm.cmd run audit:security` 固定官方 registry；能返回可解析漏洞清单；发现漏洞可非零退出 |
| ATH-W01-006 | 旧 docs README/roadmap 把愿景、骨架和已实现混写 | 旧 `docs/README.md` 宣称技能、系统目录和十章路线；`roadmap.md` 未标状态 | Blocker | 01 | Closed | 五份商业基线成为唯一事实源；旧 roadmap 明确为非承诺；README 与版本/能力一致 |
| ATH-W01-007 | 需要建立本轮修改后的完整构建和启动证据 | typecheck 和全部非 live 回归通过；开发态与打包态均输出 `ATHENA_SMOKE_READY_TO_SHOW`、`ATHENA_SMOKE_DOM_OK`；0.8.0 NSIS 构建成功 | Blocker | 01 | Closed | typecheck、非 live 回归、开发 smoke、`npm run build`、打包 exe smoke 全部成功并记录标记 |

## 3. 后续商业问题

| 编号 | 问题 | 证据 | 严重级别 | 负责窗口 | 状态 | 验收条件 |
|---|---|---|---|---|---|---|
| ATH-SEC-001 | Electron 28、Vite 5、builder 24 存在已知漏洞并超出支持基线 | 已锁定 Electron 42.7.0、Vite 8.1.4、electron-builder 26.15.3、better-sqlite3 12.11.1；官方 registry `found 0 vulnerabilities`；开发态和打包态 smoke 均退出 0 并输出两个成功标记 | P0 | 02 | Closed | 受支持版本已锁定；官方 audit 无 High/Critical；构建与烟测有重复证据 |
| ATH-SEC-002 | BrowserWindow 未显式 sandbox，HTML 无严格 CSP，生产包含 source map | `SECURITY_BASELINE_OK`；sandbox/CSP、外链确认、导航/下载/权限默认拒绝、IPC 发送者与负向输入已验证；最终 `app.asar` 中 `.map/.d.ts` 均为 0 | P0 | 02 | Closed | 安全基线与负向测试通过；生产包清单验证通过 |
| ATH-SEC-003 | Execute 默认 Full，缺少面向普通用户的高危逐次确认 | 窗口 11 刷新曾发现本机工作树把受跟踪 Execute 配置漂移为 Full，并在 `908261e` 中如实重开；签名 Private Beta 阶段已恢复仓库发行默认值为 Off，smoke 在未同意时按禁用状态验证，`test:security` 重新输出 `SECURITY_BASELINE_OK` | P0 | 02/11 | Closed | 默认 Off、显式升权、高危确认、撤销、取消、模式隔离和 consent-disabled smoke 均有自动化证据；签名候选仍由 ATH-REL-001 单独阻断 |
| ATH-PRIV-001 | 没有隐私政策、联网数据流说明和首次同意 | 窗口 11 刷新曾发现本机工作树把 webSearch/externalToolNetwork 同意漂移为 true，并在 `908261e` 中如实重开；签名 Private Beta 阶段已恢复发行默认值为 false，`test:privacy` 重新输出 `ATHENA_PRIVACY_DATA_OK`，开发 smoke 在未同意状态通过 | P0 | 03/11 | Closed | 应用内隐私入口、逐类默认未同意、主进程 consent gate、保留/导出/清除和当前 Desktop 数据流一致；公开 URL 仍是商业发布门 |
| ATH-DATA-001 | 保留/导出设置未执行，缺少完整导出、一键清除和加密决策 | `historyRetentionDays` 自动清理消息和活动记录；历史关闭后不保存聊天、不记录活动且停止自动提取长期记忆；完整 JSON/Markdown 导出包含 DB 表、设置、数据地图、静态保护决策和语音缓存；一键清除聊天、记忆、搜索/语音/工具活动与语音缓存；数据库迁移前备份并失败恢复；SQLite 明文风险已写入威胁评估 | P0 | 03 | Closed | `npm.cmd run test:privacy` 覆盖保留、导出、清除、语音缓存、备份和外网工具同意门；不虚假宣称 SQLite 已加密 |
| ATH-LEGAL-001 | notices 未覆盖完整 npm/Python/模型/素材来源 | `THIRD_PARTY_NOTICES.md` 覆盖 Electron、npm runtime、Python voice requirements、Ollama、Qwen2.5 和资产来源；`docs/SUPPLY_CHAIN_MANIFEST.json` 记录 61 个 runtime npm 包、Electron 42.7.0、OllamaSetup.exe 0.31.1 / SHA-256、Qwen2.5 Apache-2.0 来源、构建产物哈希和资源打包决策；`docs/ASSET_PROVENANCE.md` 归档当前 bundled/generated 素材来源与人工权属签字残余边界；`scripts/verify-supply-chain.js` 输出 `ATHENA_SUPPLY_CHAIN_OK` | P0 | 04 | Closed | SBOM、许可清单、Qwen/Ollama/Python artifact 和素材来源证据已归档；Ollama 再分发、人类权属签字、EULA/公开隐私 URL 仍作为发布清单 Go/No-Go，不虚假放行商业发布 |
| ATH-REL-001 | 无签名、更新、回滚和有效 CI 发布链 | 已实现 clean-checkout Windows CI、0.9 统一版本/构建输入哈希、候选 manifest、签名强制门、beta/stable channel pause/rollback、schema 迁移备份/恢复；签名阶段新增 Git 路径解析和 `release:preflight`，Git 不可用时不再把 checkout 误判为 clean；本机证书/私钥、批准 publisher DN 与 HTTPS feed 均不存在 | P0 | 06/Private Beta | Blocked | **外部阻断：取得受控代码签名证书/发布主体与 CI secret，配置 `CSC_LINK`/`CSC_KEY_PASSWORD`、`ATHENA_SIGNING_PUBLISHER`、`ATHENA_UPDATE_BASE_URL`**；随后由干净 checkout 生成 Valid+timestamp beta 包，并完成真实 feed 更新/暂停/回滚及安装矩阵 |
| ATH-VOICE-001 | 语音依赖系统 Python、在线服务和运行时模型下载 | `VOICE_ARCHITECTURE.md`；受管 Python 3.11 + 精确依赖 + 预置 Whisper；Windows SAPI TTS；禁止运行时下载/在线回退；能力检查与可理解错误 | P1 | 05 | Closed | 商业语音架构固定；依赖锁定；离线/联网降级和隐私标签通过 |
| ATH-WEB-001 | 搜索抓取第三方 HTML，缺少正式 SLA、监控和政策审查 | `WEB_PROVIDER_REVIEW.md` 判定现有 HTML provider 无商业授权/SLA并从 1.0 排除；Internal Alpha 有 1.25 秒/8 rpm 限速、Retry-After、超时、反爬分类、无查询遥测诊断和降级 UX | P1 | 05 | Closed | provider 政策评审完成；未签约 provider 不进入 1.0；实验实现的限速、失败 UX 和本地监控有测试 |
| ATH-CONFIG-001 | 启动项、通知、历史保留、导出等部分设置不驱动真实行为 | `SETTINGS_RUNTIME_AUDIT.md`；DesktopSettings 实现登录项/托盘/通知；全部可见控件枚举+wiring+隔离配置往返；旧在线语音/auto STT 控件移除 | P1 | 05 | Closed | 所有可见设置端到端生效并测试，或从发布版移除 |
| ATH-DESKTOP-001 | Desktop Beta 缺少真实安装/升级/卸载/弱网/故障测试 | 已落盘受控 Beta 方案、参与者/安装矩阵模板和 disposable-VM harness；个人 Partner Center 已预留 `Athena AI companion`（Store ID `9NT09L9504R1`），独立 AppX Private Audience 工程包、包内容验证与 unpacked smoke 已通过，但尚未 clean-build、上传、认证或从私密 Store 链接安装；真实测试者仍为 0 | P1 | 06/Store Beta | Blocked | **外部阻断：Microsoft Store Private Audience 首包认证，或有效签名 Direct 候选，以及 20–50 名真实测试者/Windows 测试环境**；安装升级矩阵完成且无 P0/P1，真实参与者达到 20–50 后方可关闭 |
| ATH-DESKTOP-002 | Desktop 1.0 的授权、支持、退款和正式发布材料未定义 | 单一一次性个人 SKU、2 设备/1.x 权益、换机/14 日退款/支持分流已冻结；可替换 LicenseAdapter、生产拒绝配置、官网/商店/EULA/隐私/支持源稿与本地回归已落盘；官网基址、支持 URL 和支持/隐私/安全邮箱已初步配置；真实主体、价格、支付/许可证平台、公钥、生产激活和签字仍为空 | P1 | 07 | Blocked | **外部阻断：发行主体、销售/税务、支付与许可证平台、价格币种、法律/产品签字和真实生产激活证据**；生产激活 UI/安全存储/公钥轮换/真实平台测试完成后关闭 |
| ATH-STEAM-001 | 无 Steamworks、Depot、所有权、内容问卷和 Steam 专用裁剪 | 已实现独立 Steam SKU/build、主进程 Steamworks restart/AppID/订阅/SteamID/私有分支 fail-closed 校验、SteamPipe VDF、VC++ redistributable 运行稿、Full/终端/HTTP/外链/站外支付多层裁剪、Cloud AES-GCM+vector clock+冲突/墓碑删除协议、AI 申报/guardrail、Athens 主题素材和 near-final verifier；窗口 03 白名单仍为空 | P0 | 08 | Blocked | **外部阻断：Desktop 1.0 干净基线、真实 Steamworks 合作方账号/AppID/DepotID/Steam Direct、签名候选、私有分支 owned-account/clean-machine/Cloud 测试、内容问卷与 Valve Store/build review**；`npm.cmd run test:steam` 仅证明工程边界，不冒充平台通过 |
| ATH-CLOUD-001 | 无认证、租户隔离、同步、计费、SLO 和数据权利服务 | `cloud/` 独立服务边界已实现认证/MFA/恢复/会话/设备、租户隔离、v1 加密同步、密钥轮换、限流配额、审计、导出删除、备份恢复、模型最小留存、零费用适配器与故障演练；生产供应商/区域/计费/KMS/TLS/外部渗透与运维签字未完成 | P0 | 09 | Blocked | **外部阻断：确定云/区域/KMS、模型与恢复供应商条款、计费税务、生产部署与 SLO/RPO/RTO、外部渗透/镜像扫描、法定留存和 on-call/状态页**；全部通过并签字后作为 Mobile 发布前置 |
| ATH-MOBILE-001 | 无 iOS/Android 工程和移动商店合规 | 未启动商店合规：Cloud 1.0 生产发布门为 No-Go；仓库无 Android/iOS 工程、Apple/Google 商店账号或真实审核证据。2026-09-02 已落盘 `docs/ANDROID_COMPANION_PLAN.md`；工程在独立目录 `G:\AthenaCompanion`，不并入 Desktop Electron。隔离开发 ≠ 生产 Go，不能关闭本问题 | P0 | 10 | Blocked | **前置阻断：Cloud 1.0 必须先取得有签字的生产 Go**；再创建 Companion 工程、完成 Mobile 专项清单、真实账号签名与 App Store/Google Play 审核。ADR 已写不等于工程或商店通过 |
| ATH-OPS-001 | 无跨平台事件响应、状态页、停止支持与发布复盘机制 | `config/operations.json`、`docs/ops/*` 与 `scripts/verify-operations-readiness.js` 已建立责任链、支持时限、事故等级、状态页模板、停更/撤包/热修/通知/复盘、EOL 和迁移控制；Desktop 负责人、支持/安全/隐私邮箱、支持 URL、事故微信桥接和状态页 URL 已初步配置；窗口 11 独立复核仍判定五平台全部 No-Go | P1 | 11 | Blocked | **外部阻断：配置 Legal/License、Steam、Cloud 双人 on-call、iOS/Android Owner、分页服务和真实平台演练**；完成 P0 tabletop、五平台停更/撤包/通知/恢复演练并关闭行动项后方可 Closed |
| ATH-ARCH-001 | PluginManager/Planner 关闭，旧 Workflows/Skills 曾多为骨架 | Workflows 已实现四个有界 start/next/cancel/complete 会话；Agent Skills 已由 `SkillLibrary`、包哈希信任状态、调用记录和 `SkillAgentToolBridge` 接入真实 `ToolRegistry`，旧 `src/skills/SkillManager.ts` 与 `config/skills.json` 空壳已移除；PluginManager、Planner、脚本自动执行与插件市场仍保持 Excluded | P2 | 05 | Closed | 固定工作流与只读渐进加载 Skills 保留为 Beta；未实现的插件执行生态继续从 1.0 UI/宣传排除，第三方脚本不得因 Skill 声明自动获得权限 |
| ATH-PRODUCT-001 | Live2D、音乐、日历、跨平台等旧愿景不得冒充首发能力 | `promo/*.html` 与 `DESKTOP_1_0_STORE_LISTING.md` 已移除旧 Muse/Venus/Oracle 和未过门卖点；Live2D 工程运行时存在但发行硬门为关闭，生产角色美术、真实 Cubism 导出、授权与视觉验收仍 No-Go；音乐、日历、跨平台等继续 Planned/Excluded | P3 | 07 | Closed | 已从 Desktop 1.0 官网/商店源稿排除；Live2D 仅可陈述为未发布工程能力，其他未来能力进入矩阵后另建实现问题并重新过营销审核 |
| ATH-REPO-001 | 来源不明空目录、历史归档和大模型本地 payload 仍需长期归属策略 | `新建文件夹/`、`legacy/root-artifacts`、`models/` | P2 | 04 | Open | 确认所有者/许可/保留期；在有备份和批准前不得删除 |
| ATH-SEC-004 | 官方 npm audit 新报 advisory：fast-uri 3.0.0–3.1.5（High，SSRF/主机混淆，经 ajv 8.20.0 运行时可达）、@xmldom/xmldom ≤0.8.14（Moderate，XML 片段注入，经 mammoth 运行时及 electron-builder/pixi 开发时） | 2026-09-03 `npm.cmd run audit:security` 非零退出：2 vulnerabilities (1 moderate, 1 high)，audit 报告 fix available；上次记录为 0 漏洞 | P0 | 02 | Open | 官方 registry `--audit-level=high` 返回 0（或窗口 02 完成 exploitability 评估并书面接受）；lockfile 修复已提交；`audit:security` 与候选版发布门重新通过 |
| ATH-VOICE-002 | 语音缺少打断（barge-in）：AI 朗读期间用户开口不能立即停下并转听 | 2026-09-03 已落语音取消基础（`70c7268`：synthesize/play/transcribe 可中止、`voice:cancel` IPC、停止播放联动）；尚无"播放中检测语音活动→停止朗读→进入听写"链路 | P2 | 05 | Open | 朗读过程中用户开口可中止播放并进入听写（含回声消除/误触发边界与验证）；不得宣称未经实现的"边听边说"并发 |
| ATH-CLOUD-002 | 桌面云同步三处不完整：queueCloudWindowSync 忽略 windowId 导致每条消息全量同步；入站仅导入 conversation.* 记录，服务端 memory.* 从不导入；出站 pushLocalState 仅推送 profile 一种记忆 | `src/core/cloud/CloudAccountService.ts`（queueCloudWindowSync `void windowId`、入站 conversation-only、出站 profile-only）；`test:cloud-sync` 仅覆盖 conversation 推拉 | P2 | 09 | Open | 按窗口增量同步且参数不被忽略；memory.* 双向导入/推送与冲突处理；fixture 端到端覆盖双向记忆同步；不改变 production=no-go |
| ATH-REPO-002 | 仓库无 git remote/远端备份：本地是唯一已确认开发现场，数据丢失不可恢复 | 2026-09-03 `git remote -v` 为空；`GROK_HANDOFF_2026-09-02.md` §2 记录同一事实 | P2 | 01 | Open | 与项目所有者确认远端平台与备份策略后配置 remote/定期备份；形成可复制的恢复流程证据 |
| ATH-CHAT-001 | 长段生图提示词被误判为电脑工具意图，弹出“切换到执行模式”拒绝语，并顺带触发联网搜索 | 用户 2026-09-02、2026-09-06 实测报告（含截图）。2026-09-06 用真实文本跑判定函数取得地面真相：拒绝语来自 `ToolRuntime.ts:135`，**不是路由判错**——路由已判为普通对话，是 ToolRuntime 内部第二套独立意图检查短路的（DEBT-003）。命中点：`politeLocalRequest` 匹配单字「将」、`fileNoun` 匹配场景里的「桌面」（桌子而非系统桌面）、`fileAction` 匹配 `"list"`（藏在 `realistic` 内，英文分支无词边界）。搜索来自 `shouldAutoSearch` 的 `freshness` 匹配「刚刚」（"杯子刚刚离开桌面"） | P2 | 05 | Closed | **已改为硬信号/软启发式分层**：路径、终端、端口、显式工具短语等硬信号任何长度都判定；关键词配对等软规则仅在 ≤400 字符时成立；删除无动作词的 `politeLocalRequest && fileNoun` 分支；英文名词与动词全部加词边界。`shouldAutoSearch` 同样分层，显式搜索请求与 URL 不受长度限制。回归：`test:tools`、`test:web-search`、`test:agent-routing` 三处各加长文用例，并各配一条“长文后接真实请求仍须命中”的反向断言。**已知取舍**：超过 400 字符且只有软信号的真实电脑请求会降级为普通对话，用户可切执行模式；这优于对创作内容硬拒绝 |
| ATH-CHAT-002 | 缺少“识别图片→反推提示词”能力；当前该请求被路由到执行模式并以工具报错结束 | 用户 2026-09-02 实测报告（自动跳执行模式后 list_directory JSON 报错）。需求澄清 2026-09-03：**对话内完成**。前置：当前默认 qwen2.5:14b 无视觉能力，需视觉模型或远程模型 | P2 | 05 | Open | 对话内发图片附件→能力检测（Ollama vision/远程视觉模型）→模型描述并反推提示词→可“再来一张”直接生图；无视觉模型时给出可理解的安装/配置提示；verify 覆盖 |
| ATH-CHAT-003 | 模型返回截断 JSON 工具参数时错误原文直接暴露给用户 | `ProtocolUtils.ts:22` 抛出 “Unterminated string...”，经 `ipc/index.ts` 的 `chat:error` 与 `ToolRuntime` 的规划失败分支原样转发；用户 2026-09-02 实测报告。**这类文案读起来像“我拒绝执行”，实际是响应损坏** | P2 | 05 | Closed | 2026-09-06 新增 `src/core/ai/ModelFailure.ts` 统一分类：protocol / auth / rate_limit / timeout / connection / cancelled / capability / passthrough，每类给出可执行的中文说明与稳定 `code`，原文经密钥脱敏后只进日志。**已写给人看的消息（同意提示、能力说明、产品规则）走 passthrough 保持原样**，避免被改写成泛化句子。已接入 `chat:error`、`ToolRuntime` 规划失败、Agent 失败回复三处。回归见 `test:model-adapters`（含截断 JSON 不泄漏、401 提示重填 Key、passthrough 不被改写、密钥脱敏） |
| ATH-CHAT-004 | 对话不够智能：不能明确用户需求（该问不问）、不能合理扩展需求（该补不补、补了还漂）；生图场景表现为 ATH-IMG-002 | 用户 2026-09-03 报告（服装+发型发饰+环境+pose 提示词改场景后要完整版连脸都不对）。需求澄清 2026-09-03：**执行前先输出“对需求的理解+计划补全/扩展的要点”供确认/调整**；**技术细节（构图/光影/氛围/镜头）可自主扩展，角色特征（脸/发型/服装）锁定**；**覆盖 Create/Companion/Reason 全部模式**；**评估允许换更强模型**（当前默认 qwen2.5:14b 为智能上限）。**2026-09-06 结构性定位（用户在看到 ATH-CHAT-001 根因后指出“这就是为啥我说不够智能”）**：消息的含义在任何模型看到它之前，就已经由正则子串匹配决定了。更关键的是 `AgentMessageRouter.shouldRequestSemanticReview` 只在规则得出 `ordinary-conversation` 且置信度为 `medium` 时才请求语义复核——即**模型只被允许复核规则认为平淡无奇的情况，规则最自信、也最可能错的时候反而完全不问模型**；而 `ToolRuntime` 的意图短路发生在路由之后，模型连被问的机会都没有。换更强的模型不会改善这一层，因为它根本没被调用 | P2 | 05 | Open | 三模式在需求存在扩展空间或关键缺口时先理解后确认；扩展只落技术维度、角色特征保持原样；用户可一键确认/修改理解；模型能力提示（可选更强本地/远程模型）在效果不足时可给出；verify 覆盖澄清、扩展与角色锁定的回归用例 |
| ATH-STAB-001 | 整体稳定性与流畅度：模型连接、启动、UI 动画、边缘 bug 的用户报告项 | 用户 2026-09-02、2026-09-06 报告。**2026-09-06 首个可量化数据点**：`smoke:electron` 的 DOM 门今日约 6 次中失败 1 次，失败点在 `ATHENA_SMOKE_LIQUID_FRAME` 之前，即 WebGL 液态玻璃着色器门（`glassReactive`/`liquidVelocityReactive`/`liquidShaderReactive`），发生在任何聊天代码执行之前；该次失败紧接在连续 12 个测试套件之后，随后单独连跑 4 次全通过。**同日实测机器状态**：24.3 GB 内存仅剩 2.8 GB 空闲、Memory Compression 占 6 GB、8 GB 显存已用 4.9 GB（ComfyUI 的 python 占 2.9 GB），qwen2.5:14b（8.37 GB）因此无法加载，Ollama 报 `unable to allocate CUDA_Host buffer`。**"连接模型"这一项另有独立原因见 ATH-SEC-008**（凭据解密失败静默回退导致误导性 401） | P2 | 05 | Open | 用户报告项逐条可复现→修复→关闭；开发态与打包态 smoke 连续通过；无未解释的启动/连接失败 |
| ATH-WEB-002 | 搜索反爬自动降级不够稳定，影响搜索可用性 | 用户 2026-09-02 实测报告；ATH-WEB-001 已 Closed 的限速/降级机制需要增强 | P2 | 05 | Open | 降级发生时对话有明确提示且不中断主回复；失败分类（限流/反爬/断网）准确；live 测试覆盖主要降级路径 |
| ATH-IMG-001 | 图像生成链路体验复核：对话生图、再来一张、本地引擎设置流程 | 用户 2026-09-02 报告（“图像生成”）；与 ATH-CHAT-001/002 联动 | P2 | 05 | Open | 对话生图/再来一张/本地引擎（ComfyUI/sd-cli）设置流程人工走查通过；错误与阻塞状态提示可理解 |
| ATH-IMG-002 | 多轮生图提示词缺少连续性：改场景后要“完整版”，AI 重写时连脸都漂移；且贴完长规格再说“生成图片”会产出完全无关的图 | 用户 2026-09-03、2026-09-06 实测报告（截图：贴完两千字人物规格后说“生成图片”，出来的是天坛）。2026-09-06 定位：`parseDirectImageGenerationIntent` 只认祈使句式（“生成一张…图”），纯描述式规格返回 `null`；于是回溯历史时该规格被跳过，`resolve("生成图片")` 退回 `{prompt:"生成图片"}`，**字面四个字被当成绘图提示词送进引擎**。同日已修“裸命令不得成为提示词”部分：无主题时返回 `null`，走对话而不是生成错图 | P2 | 05 | Open | **剩余**：窗口内维护累积版提示词状态，改场景只动场景段落，服装/发型发饰/环境/pose/脸部保持；生图永远使用合并版；“完整版”可展示并一键复制；**并需支持描述式规格**——用户贴一段视觉规格再说“生成图片”应能理解，按 ATH-CHAT-004 先输出理解与要点供确认再生成，而不是静默猜测（静默使用上一条消息有把无关内容发往远程 Provider 的风险） |
| ATH-IMG-003 | 生图角色/脸部一致性缺少参考图与 seed 机制 | 用户 2026-09-03 实测报告（“连脸都不对了”）。需求澄清 2026-09-03：**参考图/seed 机制**；本地 ComfyUI 支持，远程 provider 能力各异 | P2 | 05 | Open | 本地 ComfyUI 通道支持参考图输入与 seed 固定；远程通道按其实际能力如实展示（不支持时明确说明）；UI 可配置 seed/参考图；verify 覆盖能力声明真实性 |
| ATH-CLOUD-003 | 账号系统体验：注册/登录/同步在本机 cloud 服务上跑通、报错可理解；生产决策仍由 ATH-CLOUD-001 阻断 | 用户 2026-09-02 报告（“账号系统”）。需求澄清 2026-09-03：**先修体验** | P2 | 09 | Open | 桌面→cloud fixture 端到端账号流程通过；设置面板账号状态真实、错误文案可理解；`test:cloud-sync` 扩展覆盖账号状态展示 |
| ATH-DATA-002 | 关闭“保存聊天历史”后，窗口聊天仍写入 `chat_messages` 及多处派生存储 | 2026-09-06 核验：`AthenaController.ts` 无条件调用 `saveChatMessage`；`saveChatMessage` 同时把消息文本折进 `chat_windows.summary`（每条 180 字，累积 1200 字）与 `working_state`（lastUserMessage/lastAssistantMessage 各 120 字）；`Conversation.ts` 无条件写 `context_snapshots`，其 included/omitted 的 `preview` 含近期消息与检索到的记忆原文；读取侧 `AthenaController.ts:1337` 的 `saveHistory` 分支在有 `chatWindowId` 时是死代码，历史照样被检索喂给模型。同日修复见右栏 | P0 | 03 | Closed | **已落契约**：历史关闭时消息写入 `chat_messages` 但标记 `ephemeral`（schema 16），不折入窗口摘要/工作状态、不写 `context_snapshots`、不写全局 `messages`、不提取长期记忆、不入云同步；在下次启动或历史被重新开启时连同附件文件删除；已有历史不受影响。证据：`test:privacy` 跨表负向断言、`test:chat-attachments` 附件文件不成孤儿、`test:release` 有数据的 15→16 迁移（既有行落为 `ephemeral=0` 不被误删）。**残留边界（已写入 PRIVACY_AND_DATA.md，不称“不保存”）**：会话进行中数据仍在本机磁盘上，真正的内存态存储属未开工的独立任务；`historyRetentionDays` 覆盖仍由 ATH-DATA-003 跟踪 |
| ATH-DATA-003 | `historyRetentionDays` 到期清理不覆盖 `chat_messages` | 2026-09-06 核验：保留期只清理 `messages` 与 `data_activity_records`，窗口聊天从不过期，因此“到期删除”对实际在用的聊天存储从未生效 | P1 | 03 | Closed | 2026-09-06 新增 `pruneChatMessagesBefore()`：删除到期窗口消息，显式删除其 `context_snapshots`（该外键为 SET NULL，否则会留下含原文 preview 的孤儿行），按消息 id 从滚动摘要中剔除对应行，并重建 `working_state.messageCount`。附件文件由 `AttachmentService.cleanupExpiredMessageFiles()` 在行级联删除**之前**清扫，通过 `AthenaController.applyRetention()` 串起来——直接调用裸 `applyDataRetention()` 会漏掉文件，两处调用点已改为走控制器。长期记忆不受影响。回归：`test:privacy`（到期删、未到期留、摘要剔除、快照清除、计数重建）与 `test:chat-attachments`（文件不成孤儿 + 外键检查） |
| ATH-CLOUD-004 | 混合模式窗口把 Execute 消息同步到云端 | 2026-09-06 静态核验：`src/core/cloud/CloudSyncMapper.ts:15` 仅按窗口当前模式判断；`:23-33` 逐条转换只过滤 role，且把 `mode: message.mode` 打进 payload 却不用于过滤。入队触发点 `AthenaController.ts:1157` 的逐条判断是正确的，因此任一非 execute 消息即可带出整窗口的 execute 正文 | P0 | 09 | Open | 逐条消息与派生数据分类；混合模式窗口的上传捕获中不含 execute 正文、结果与摘要；`test:cloud-sync` 覆盖混合模式、临时会话与撤销同意的负向用例 |
| ATH-SEC-005 | 运行内权限只跟随全局设置，没有 Run 级“只降不升”的授权上限 | 2026-09-06 静态核验：`src/core/tools/AgentComputerTools.ts:57-58,88-89` 每次 refresh/execute 重读设置，**降权会生效，但提权同样即时生效**，与“撤销后不得自动恢复”冲突；`AthenaController.ts:534` 的 `applyToolPermission` 只更新 `this.conversation`，不触达 Agent 桥；`:1185` 恒按 execute 解析而不看当前模式 | P0 | 02 | Open | Run 授权上限只降不自动升；撤销立即广播到全部能力与已开终端；切模式、降权、暂停恢复、再提权经 Controller/IPC 端到端验证，不只测桥的单次开关 |
| ATH-SEC-006 | Ollama 按 Provider 名直接放行，实际 endpoint 不参与联网同意判断 | 2026-09-06 静态核验：`src/core/ai/ModelNetworkPolicy.ts:4` 为 `provider === 'ollama' \|\| remoteModelConsent`（全文件仅 3 行）；配置校验未将 Ollama URL 限定为回环地址，适配器按配置 URL 发请求 | P0 | 03 | Open | 按真实目的地（回环/LAN/远程）分类并执行联网同意；本地/LAN/远程/重定向的允许-拒绝矩阵有测试；不读取真实凭据 |
| ATH-SEC-007 | Agent 恢复与审批继续路径不复检远程模型联网同意 | 2026-09-06 静态核验：启动路径 `AthenaController.ts:609` 有 `canRouteModelRequest` 门；`resumeAgentRun:892` 与审批恢复路径 `:886` 均无同等检查 | P0 | 02 | Open | 每次模型/工具外发边界复检当前同意版本；撤销联网后暂停恢复与已连接 MCP 均不产生新请求（捕获计数为零） |
| ATH-AGENT-001 | 通用任务 `validation: []` 时运行结束即展示为“任务已完成”，缺少验收证据 | 2026-09-06 核验：`src/core/agent/ProjectWorkspaceService.ts:152` 固定 `validation: []`，`AgentRunner.ts:891` 空集合不阻止 completed。同日修复：`AgentRunnerResult.verification` 区分 verified/unverified/not_applicable，未声明验收却动过工具的运行在回复中明示未经验证；`test:agent-runtime` 新增三态断言并通过 | P1 | 05 | Closed | 运行终态与验收态分离；纯文本任务正常结束；动过工具但无验收声明的任务不展示为已验收。不伪造 validation，按任务类型生成必要验收另属 TASK-008 范围 |
| ATH-CHAT-005 | 路由预检期间可重复提交或切换窗口，请求绑定实时 `currentChatWindowId` 而非提交瞬间快照 | 2026-09-06 核验：原 `sendMessage` 在 `await routeMessage` **之后**才置 `isStreaming`，预检窗口内 `switchChatWindow` 不设防；`requestChatWindowId` 虽已捕获，却只用于附件对账，routeMessage/sendMessage 仍读实时值。同日修复：新增 `isRequestPending` / `isChatRequestBusy()`，提交瞬间加锁并覆盖窗口与 Project 的切换/新建/删除/归档，IPC 调用改用提交快照。dev smoke 因此需要新增“等待请求落定”才能切窗口 | P1 | 05 | Implemented / Needs Verification | 慢路由下双提交、切窗口、附件、取消与失败重试不串请求；**待补**一条直接断言“请求进行中切换窗口被拒绝”的确定性回归，当前仅由 smoke 需要新增落定等待间接证明 |
| ATH-PERF-001 | 语义路由预检在每条普通消息前阻塞 4–8 秒 | 2026-09-06 实测（DeepSeek `deepseek-v4-pro`，走 Athena 自身代码路径，app 自己的 profile）：规则判定 0.03–2.78 ms；语义预检 短消息 **5.37 s**、中等消息 **3.80 s**、长文 **8.01 s 超时**、长文+8轮历史 **8.00 s 超时**。对照最小往返 2.03 s。超时后丢弃结果、改用 0.2 ms 就已算出的规则结论，即纯浪费。静态数据：预检在 45 条 fixture 中触发 9 条（普通对话 8/16，执行类 **0/16**）；负载最大约 11500 字符 / 6400 token。路由在每次发送中被调用两次（`ipc/index.ts:238` 与 `:258`），但 15 秒缓存使第二次为 0 ms | P2 | 05 | Open（用户 2026-09-06 决定排后） | 候选方案：①默认关闭语义预检、保留开关（规则层已由 ATH-CHAT-001 收紧，且预检本就不在执行类消息上运行）；②收紧参数：超时 8s→1.5s、历史负载 8×1200→3×300、长文跳过。**结构性方向见 ATH-CHAT-004**：Codex/Claude Code 类工具不做发送前路由，而是一次调用挂工具、由模型在生成中自行决定调用；Athena 的 `AgentRunner` 已具备该形态，缺的是入口而非能力 |
| ATH-SEC-008 | 凭据解密失败被静默吞掉并改用其他来源，且状态不校验可解密性 | 2026-09-06 实测发现（本轮排查一度被它误导到错误结论）：`CredentialStore.ts:128-135` 在 `safeStorage.decryptString` 抛错时静默 `catch`，转而读取 cwd 下的 `.env`/`.env.local`，于是"密钥读不出来"变成"用了另一把密钥"，表现为供应商返回 401 而非可诊断的本地错误。`getCredentialStatus` 仅检查条目存在即报告 `source: 'windows-safe-storage'`，不验证能否解密，因此界面会显示"已配置"。safeStorage 主密钥按 userData 目录派生（各自的 `Local State`），换用户配置文件、应用改名或迁移 userData 都会触发 | P1 | 02 | Open | 解密失败必须是显式可见错误，不得静默改用其他来源；`getModelCredentialStatus` 需反映真实可用性；模型连接失败应在界面上可见（当前不可见，用户只能从"回复很奇怪"反推——注意搜索、本地生图、硬编码文案都不需要 LLM，会掩盖连接故障）；补充负向测试覆盖不可解密条目 |
| ATH-INIT-001 | Athena Initiative System（主动行为系统）：由模型决定“下次何时醒来”，醒来后再决定说话或保持沉默 | 用户 2026-09-06 提出并确认方向。现状核验：`proactiveCare` 仅在 `SettingsStore.ts:301` 往提示词加一行，无引擎；`Scheduler` 为纯内存 Map，重启全丢（DEBT-007）；现有 `reminder:due` 链路（Controller → EventBus → `ipc/index.ts:210` → 系统通知 + `webContents.send`）可复用，但渲染端 `app.ts:2281` 只做 `chatPanel.addMessage`，**不落库、不属于任何窗口、切窗即失**，即 Athena 主动说的话今天没有任何持久化路径 | P3 | 待定 | Open | **V0 已于 2026-09-06 交付（schema 17）**：新增 `scheduled_jobs` 表；`Reminder` 改为先落库再挂表，启动时 `restorePending()` 重新挂起全部待办，关闭期间已到期的提醒立即触发并标记 `overdue`；`AthenaController.deliverProactiveMessage()` 把 Athena 自己产生的消息真正写入聊天窗口（此前 `app.ts` 仅 `chatPanel.addMessage`，不落库、不属于任何窗口、切窗即失）；渲染层新增 `pendingProactiveDeliveries` 队列，请求进行中不插入、待落定后再显示；`scheduled_jobs` 已并入一键清除与保留期清理（仅清理已完成/已取消，待办永不过期）。证据：`test:privacy` 覆盖持久化、模拟重启恢复、overdue 触发、取消、保留期与一键清除。**V1 已于 2026-09-06 交付**：`src/core/initiative/` 新增意图契约与严格解析（接受 `27m` / `1.5h` / 数字等写法，钳到 [15, 240] 分钟，`speak` 但无内容降级为 `wait`，无法解析时回落默认值并记录 issue，任何输入都不抛错）、策略门（关闭 / 历史关闭 / 静音时段 23–8 / 每日 4 条上限）、`InitiativeEngine`（唤醒时复检门 → 询问模型 → 说或沉默 → 安排下次；模型失败不终止循环；唤醒时间被推出静音时段）、`ModelInitiativeDecider`（**刻意不覆盖 `numCtx`**，避免 Ollama 在与普通聊天交替时重载模型）。新增设置 `personalization.initiativeMessages`，**默认关闭**并有界面开关，关闭时立即停循环。`scheduled_jobs` 新增 `initiative` 类型，每日预算按已结算的作业统计而非聊天消息。回归：新增 `test:initiative`。**本轮由测试抓到的真实缺陷**：`start()` 原本不幂等，而 `syncInitiativeLoop()` 在每次保存设置时调用它，第二次即抛错；已在 `Scheduler` 增加 `has()` 并让 `armWake`/`Reminder.arm` 幂等。剩余分期：V3 记忆与用户状态入决策；V4 视觉/PC 状态另立门（严格解析、钳到 [min,max]、解析失败兜底，复用 ATH-CHAT-003 的错误分类）；V2 说/不说 + 频率与静默预算；V3 记忆与用户状态入决策；V4 视觉/PC 状态另立同意与授权门。**已定决策**：主动消息归属“最近活跃的非临时窗口”；**历史关闭时整个主动系统停摆**（依赖 ATH-DATA-002 的开关真实性，已闭环）。**约束**：V1–V3 输出在类型上只能是消息或沉默，不得成为工具调用路径（AC-03/AC-05；参见 ATH-SEC-005/007） |
| ATH-AUTO-001 | 超过定时器上限（约 24.86 天）的提醒在上限处提前触发 | 2026-09-06 核验：`src/engine/Scheduler.ts` 原为 `Math.min(delay, 2_147_483_647)` 且回调不复查 `dueAt`。同日修复：到期时间为事实源，分段重新挂表并在触发前复查，同时覆盖时钟跳变与休眠唤醒；`test:window05:arch` 新增假时钟 30 天回归，已单独确认该断言在旧实现上以 `reminder fired before its due time` 失败 | P2 | 05 | Closed | 长延时按真实到期时间触发；短提醒、取消、时钟跳变均正确。提醒持久化与重启恢复不在本条范围（属 DEBT-007 / TASK-016） |

## 4. 窗口 01 关闭记录

| 项目 | 最终证据 |
|---|---|
| Git | 空 `.git` 原地初始化为 `main`；精确添加 `G:/Athena` safe.directory；Git 状态和 ignore probe 可运行；未删除历史 |
| 根目录归档 | 17 个文件非破坏性移动；`legacy/root-artifacts/MANIFEST.sha256` 全部复核一致 |
| 元数据 | `package.json`、lockfile、`APP_VERSION` 统一为 0.8.0；UTF-8 `.editorconfig` 落盘 |
| 依赖审计 | `AUDIT_ENDPOINT_OK`；官方 registry 返回 8 项：7 High、1 Moderate；问题转交 ATH-SEC-001 / 窗口 02 |
| 自动化 | typecheck、persona、modes、theme、logger、web-search、tools 全部通过 |
| 开发态启动 | `npm.cmd run smoke:electron` 输出 `ATHENA_SMOKE_READY_TO_SHOW` 和 `ATHENA_SMOKE_DOM_OK` |
| 构建 | `npm.cmd run build` 生成 82,213,604-byte `Athena Setup 0.8.0.exe` |
| 打包态启动 | `release/win-unpacked/Athena.exe --smoke-test` 输出两个 smoke 成功标记 |
| 产物哈希 | Installer `3472C0B0AD3F85EC82B70553CAA0C33AAF12073FFC3F9501587DCC6D779CBEF4`；unpacked exe `67DC2A7036860A68E5312C212C31B8772AC463ED0289FCC44897867F55075E89` |

窗口 01 不关闭任何窗口 02–11 的问题，也不把“已登记”写成“已解决”。

## 5. 窗口 02：运行时安全关闭记录

| 项目 | 最终证据 | 剩余边界 |
|---|---|---|
| 依赖与审计 | Electron 42.7.0、Vite 8.1.4、electron-builder 26.15.3；官方 registry `found 0 vulnerabilities` | 版本继续由候选版 audit 门约束 |
| Electron 安全 | `SECURITY_BASELINE_OK`；sandbox、严格 CSP、导航/外链/下载/权限默认拒绝、IPC 负向验证；生产 `app.asar` 的 `.map/.d.ts` 计数均为 0 | 仅验证 Windows x64；Electron `console-message` API 有非阻断弃用警告 |
| Execute | 默认 Off；升权说明及删除、覆盖、移动、命令、程序启动、外网请求逐次确认；撤权、取消、参数脱敏、模式隔离全部通过 | 真实 Beta 用户可用性测试仍属 ATH-DESKTOP-001 |
| 自动化与启动 | typecheck、persona、modes、theme、logger、security、web-search、tools 全部通过；开发态与打包态均输出 `ATHENA_SMOKE_READY_TO_SHOW`、`ATHENA_SMOKE_DOM_OK` | live 搜索/LLM/工具测试未作为本窗口非 live 门执行 |
| 0.8.0 产物 | Installer 105,765,781 bytes，SHA-256 `fa089e8546e4a51827bbb2938572368adafae04eddafe00804c831b6a79b069a`；unpacked EXE 232,771,072 bytes，SHA-256 `0ff62b371413091312bb1bcee1bea72057dc68131de32655411ef9b93804831e` | 两者均为 `NotSigned`；嵌入式 ASAR 完整性需在签名发布链中启用；签名、更新与发布链仍属 ATH-REL-001/窗口 06 |
| 交接提交 | `ae5d2be feat(security): close runtime security window 02`，包含 25 个窗口 02 文件 | 这不是发布 tag；候选版 tag 仍由发布窗口建立 |

结论：窗口 02 的 Blocker 为 0，ATH-SEC-001～003 全部关闭，窗口 03 可按既定范围开始。ATH-PRIV-001、ATH-DATA-001 当时转交窗口 03；ATH-LEGAL-001 当时转交窗口 04 且已在窗口 04 关闭；ATH-REL-001 仍 Open。Steam、Cloud、Mobile、Live2D 与新产品功能未在本窗口开发。

## 6. 窗口 03：隐私与数据关闭记录

| 项目 | 最终证据 | 剩余边界 |
|---|---|---|
| 数据地图与应用内入口 | `docs/PRIVACY_AND_DATA.md`；设置抽屉“隐私与数据中心”展示数据地图、联网能力、静态保护决策、导出和清除 | 公开稳定 URL 的隐私政策/EULA 仍是发布清单 Go/No-Go 门 |
| 逐类联网同意 | `privacy.networkConsent.remoteModel/webSearch/onlineSpeechToText/onlineTextToSpeech/externalToolNetwork` 默认 false；主进程拒绝未同意的远程模型、搜索、在线 STT/TTS 和外部 HTTP/TCP 工具 | Athena Cloud 生产、Steam、Mobile、遥测未实现；本地 Provider 适配器不等于对应产品已发布 |
| 数据生命周期 | 历史关闭后不保存聊天、不记录活动且停止长期记忆自动提取；保留期清理消息和活动记录；语音缓存按小时清理 | 迁移备份保留用于恢复，后续发布窗口需定义备份保留策略 |
| 数据权利 | `privacy:export` 输出 JSON/Markdown；`privacy:clearLocalData` 清空聊天、记忆、索引、活动记录和语音缓存 | 账号删除/云端数据权利不适用当前 Desktop 本机范围 |
| SQLite 静态保护 | 威胁评估结论为 `plaintext-sqlite-with-compensating-controls`；迁移前备份和失败恢复落在 `src/memory/database/index.ts` | 未加密；Desktop Beta 前需重新评估 DPAPI/SQLCipher |
| 自动化 | typecheck、persona、modes、theme、logger、security、privacy、web-search、tools、开发态 smoke、db:stats、audit、build、打包态 smoke 均通过；`test:privacy` 输出 `ATHENA_PRIVACY_DATA_OK`，开发态和打包态均输出 `ATHENA_SMOKE_READY_TO_SHOW` / `ATHENA_SMOKE_DOM_OK` | 首次完整回归在 NSIS 阶段因残留 Electron 进程 `spawn UNKNOWN` 失败；清理本项目 Electron 残留进程后重跑 build 与打包态 smoke 通过。live 搜索/LLM/工具测试仍不作为窗口 03 非 live 门 |

结论：窗口 03 的 Blocker 为 0，ATH-PRIV-001、ATH-DATA-001 全部关闭，窗口 04 可按既定范围开始。ATH-LEGAL-001 当时转交窗口 04 且已在窗口 04 关闭；ATH-REL-001 以及 Steam、Cloud、Mobile P0 仍保持 Open；本窗口未实现账户、Cloud、Steam 或 Mobile。

## 7. 窗口 04：许可与供应链关闭记录

| 项目 | 最终证据 | 剩余边界 |
|---|---|---|
| SBOM 与 notices | `docs/THIRD_PARTY_NOTICES.md`；`docs/SUPPLY_CHAIN_MANIFEST.json`；`npm.cmd run test:supply-chain` 输出 `ATHENA_SUPPLY_CHAIN_OK packages=61 manifest=docs/SUPPLY_CHAIN_MANIFEST.json` | npm lockfile 仍含部分历史 `npmmirror` resolved URL；后续 CI/候选版需从干净 checkout 复核 |
| 模型与 Ollama | Qwen2.5 14B 默认 tag 记录为 `qwen2.5:14b`，上游 `Qwen/Qwen2.5-14B-Instruct` Apache-2.0；`resources/OllamaSetup.exe` 版本 0.31.1，SHA-256 `E56DEF86D8E5612F67F2876720C5808C01F9A5AB63DBEE7D873E9C0CB4A8FECA` | Ollama 安装器再分发条款和精确离线模型 blob 仍需候选离线包签字；正常安装器不包含模型 |
| 离线包边界 | `scripts/package-offline.ps1` 要求 `docs/OFFLINE_MODEL_ALLOWLIST.json`，逐文件校验 SHA-256；`docs/OFFLINE_MODEL_ALLOWLIST.example.json` 给出格式；禁止整包复制用户模型目录 | 尚未生成新的离线包；离线包发布前必须填真实 allowlist 并重新跑 |
| 打包资源 | `electron-builder.yml` 仅复制 `database/athena.db`；最终 `release\win-unpacked\resources\database` 只有 `athena.db` 241,664 bytes | 安装/升级矩阵和卸载数据保留仍属窗口 06 |
| 素材来源 | `docs/ASSET_PROVENANCE.md` 记录 bundled UI assets、concept assets、voice helpers 与 excluded payloads | 人工品牌/素材权属签字仍是发布清单门，不在本窗口冒充完成 |
| 自动化与产物 | typecheck、persona、modes、theme、logger、security、privacy、web-search、tools、smoke、db:stats、audit、build、packaged smoke、supply-chain 全部通过；Installer SHA-256 `F4E25930D551969678D6BF1BF932115D1D9D936520274FB8EF4589DD8AEC4D1E`；unpacked EXE SHA-256 `0FF62B371413091312BB1BCEE1BEA72057DC68131DE32655411EF9B93804831E` | 安装器未签名；CI、更新、回滚仍属 ATH-REL-001/窗口 06 |

结论：窗口 04 的 Blocker 为 0，ATH-LEGAL-001 已关闭，窗口 05 可按既定范围开始。ATH-REL-001 以及 Steam、Cloud、Mobile P0 仍保持 Open；本窗口未实现账户、Cloud、Steam、Mobile 或任何新产品能力。

## 8. 窗口 05：可靠性与功能真实性关闭记录

| 项目 | 最终证据 | 剩余边界 |
|---|---|---|
| 语音 | `VOICE_ARCHITECTURE.md`；本地 Whisper/SAPI；依赖精确锁定；缺 Python/模型、磁盘不足、超时均有错误码；在线适配器未来必须复用窗口 03 同意 | 正式候选包仍须补受管 Python/wheel/Whisper payload 的 SHA-256 与许可；缺 payload 时 UI 禁用，不冒充可用 |
| 搜索 | `WEB_PROVIDER_REVIEW.md`；官方条款结论；1.0 Excluded；Internal Alpha 限速、Retry-After、9–10 秒超时、反爬/限流/断网分类和本地无查询诊断 | 签约搜索 API、SLA、DPA、配额/成本完成前不得恢复 1.0 搜索宣传 |
| 设置 | `SETTINGS_RUNTIME_AUDIT.md`；登录项、close-to-tray、系统通知补齐；全部可见设置枚举/wiring/往返；不可用在线语音控件移除 | Windows 登录项仅在 packaged build 写入；真实安装矩阵仍属窗口 06 |
| 架构骨架 | 固定工作流已实现并通过 `ATHENA_WINDOW05_ARCH_OK`；PluginManager/Planner/Skills/插件市场从 1.0 UI/宣传排除 | 工作流不持久化，不宣称通用自动化引擎或插件生态 |
| 可靠性 | 本地崩溃 JSONL（脱敏/轮转）；长会话 1500 条、上下文最多 20；SQLite busy timeout/锁测试；磁盘不足模拟；语音 CPU/worker 上限；搜索深读并发 2 | 远程崩溃上传/遥测未实现且不默认启用；真实低配机长稳与安装测试仍属窗口 06 |
| 自动化 | `npm.cmd run test:window05` 输出 `WEB_SEARCH_VERIFY_OK`、`ATHENA_WINDOW05_ARCH_OK`、`ATHENA_WINDOW05_RELIABILITY_OK`；人格/模式/主题/日志/安全/隐私/工具/desktop-faults/supply-chain 均通过；开发 smoke 输出 READY/DOM；unsigned engineering build 成功 | 打包 EXE smoke 被 Windows Application Control 阻止，EXE 为 `NotSigned`，归属 ATH-REL-001/窗口 06；live HTML 搜索不具商业授权，不作为窗口 05 放行门 |

结论：ATH-VOICE-001、ATH-WEB-001、ATH-CONFIG-001、ATH-ARCH-001 全部 **Closed**，窗口 05 范围内 Blocker 为 0，允许窗口 06 继续；Desktop 仍受签名、真实 Beta、商业/运营和各平台外部门约束，不构成产品发布 Go。

## 9. 窗口 06：Desktop 0.9 Private Beta 交接记录

| 项目 | 工程证据 | 判定/剩余边界 |
|---|---|---|
| 版本与构建身份 | package/lock/包内版本统一为 `0.9.0-beta.1`；包内 build input SHA-256 `45840AC61D53EA599C626CC1FADDFDA271455727A426C70F250F57BCB71A02BA`；commit `9c930db5cd2e1e985bcd7d7ad57d81b6581e07ed` | 当前工作树含窗口 03–06 未提交路径，manifest 正确记录 `cleanCheckout=false`；需 CI 从提交后的干净 checkout 重建 |
| CI 与签名门 | `.github/workflows/desktop-beta.yml`；`build:release` 强制 certificate/password、批准 publisher DN、HTTPS update base URL 和 clean checkout；包内 `app-update.yml.publisherName` 用于 updater 签名所有者匹配 | 本机不存在证书；实际输出 `ATHENA_RELEASE_EXTERNAL_BLOCKED code-signing-certificate-missing`；不得虚构签名结论 |
| 更新/暂停/回滚 | `electron-updater` 6.8.9 NSIS client；beta/stable metadata；SHA-512；`control.json` pause；签名候选 stage；rollback pointer；客户端在检查/下载前复核 pause，只有 rollback 记录时允许 downgrade | fixture 回归通过不等于真实 feed；HTTPS 托管、签名下载、实网 pause/rollback 仍需发布环境证据 |
| 数据库迁移 | schema v1；迁移前 SQLite 一致快照；事务迁移；注入失败恢复；仅迁移时备份并保留最近 5 个；seed DB 从 `.build` 生成，不再依赖开发者数据库 | 自动化通过；跨真实 0.8 安装的设备矩阵仍未执行 |
| 故障与安装计划 | `ATHENA_DESKTOP_FAULTS_OK noOllama=degraded portConflict=rejected weakNetwork=bounded`；installer harness 与 Beta/安装矩阵空白模板已落盘 | 标准用户、UAC、Defender/SmartScreen、真实弱网、首装/升级/卸载/重装仍为 Not run，不可写通过 |
| 工程候选产物 | `release\candidates\0.9.0-beta.1-9c930db5cd2e-45840ac61d53\candidate-manifest.json`；installer SHA-256 `B96EB1236F301A834F8CEBCA2BEF42ADA304A7D7E40843293E315BB0C8FEA9D5`；EXE SHA-256 `E4F0C1BEECF674750736C8E583B48940A821A1584EBDF67A923BF84EE36AA468`；开发/打包 smoke 均有 READY/DOM 标记 | installer/EXE 均为 `NotSigned`；`distributionAllowed=false`；只允许本机工程证据，不得给 Beta 用户 |
| Beta 完成度 | `docs/DESKTOP_0.9_BETA_PLAN.md`；participant/install CSV 模板；manifest 明记 required 20–50、completed 0、status NOT_STARTED | ATH-DESKTOP-001 外部 Blocked；真实 20–50 人完成前不得关闭或宣称 Beta 通过 |

结论：窗口 06 的工程底座已形成，但发布门没有通过。ATH-REL-001 因代码签名证书/发布者身份/HTTPS feed/clean CI 实跑而 **Blocked**；ATH-DESKTOP-001 因签名候选不可分发、真实参与者为 0、设备安装矩阵未执行而 **Blocked**。Desktop 0.9 当前结论为 **No-Go**。

## 10. 窗口 07：Desktop 1.0 商业闭环交接记录

| 项目 | 工程/文档证据 | 判定/剩余边界 |
|---|---|---|
| SKU | `config/commercial.json`、`DESKTOP_1_0_COMMERCIAL_POLICY.md`：单一 `athena-desktop-personal-v1`，一次性个人许可，不设 Free/Pro 或订阅，最多 2 台本人设备，覆盖 1.x | 价格、币种、销售区域和税务未确定；没有真实收费 |
| 激活与换机 | `LicenseAdapter`/`LicenseStore` 契约、`LicenseService` 激活/校验/停用状态机；本地 fixture 验证 2 设备上限、释放槽位、篡改/错设备/2.x 拒绝和密钥不持久化 | 生产平台、公钥、设备标识、安全存储、撤销/恢复、应用内 UI 和真实网络测试未实现 |
| 退款与支持 | 14 日自愿退款且法定权利优先；退款撤权但保留本机数据；一般支持/隐私/安全三入口和响应目标已冻结 | 官网基址、支持 URL 和支持/隐私/安全邮箱已初步配置；EULA/隐私政策未生效，法律与运营签字缺失 |
| 官网与发行材料 | `promo/index.html`、`product.html`、`visual.html`；商店长短描述、截图规则、EULA/隐私草案、支持运行稿 | 全部明确 Prelaunch/No-Go/尚未开放购买；正式域名、下载、价格和签名 build 截图不存在 |
| 产品承诺审计 | ATH-PRODUCT-001 关闭；Live2D、音乐、日历、跨设备同步、Cloud/Steam/Mobile/macOS/Linux 保持 Planned/Excluded；旧人格和虚构工作流卖点移除 | 未来实现必须先更新产品矩阵并重新审核素材 |
| 自动化 | `npm.cmd run test:commercial` 输出 `ATHENA_COMMERCIAL_READINESS_OK sku=athena-desktop-personal-v1 model=one_time devices=2 productionBlockers=8` | 通过证明边界和拒绝门有效，不等于生产平台或商业发布通过 |

结论：ATH-PRODUCT-001 **Closed**；ATH-DESKTOP-002 的可替换工程与政策定义完成，但因真实主体/交易/许可证/签字和生产激活证据缺失转为 **Blocked**。Universal + Desktop 清单仍有签名、真实 Beta、质量、法务和运营未完成项，Desktop 1.0 为 **No-Go**。

## 11. 窗口 09：Cloud 1.0 工程交接记录

| 项目 | 工程证据 | 判定/剩余边界 |
|---|---|---|
| 独立边界 | `cloud/package.json`/lockfile、`src/server.js`、`verify-cloud.js`；无 Electron、Desktop SQLite、电脑工具或 Mobile UI 路由/导入 | Cloud 自有 Node/SQLite 本地测试边界成立；生产数据库/容器尚未选择 |
| 身份与隔离 | scrypt、TOTP/恢复码、一次性账号恢复、哈希会话、设备撤销、所有对象租户条件、跨租户负向测试 | 生产恢复投递、WAF/分布式限流和独立 BOLA/BFLA 渗透未完成 |
| 同步与加密 | API v1、幂等键、版本向量、409 冲突、墓碑、AES-256-GCM 包络加密、租户密钥轮换和审计链 | 真实 Desktop/Mobile 多设备与生产 KMS 未完成；不暴露 Desktop DB |
| 数据权利与恢复 | 加密导出、租户删除、已知备份清除、签名防复活账本、加密备份、校验和、staging restore/integrity | 分布式副本/对象锁备份、法定留存和真实 RPO/RTO 未证明 |
| 模型/计费/区域 | 提示/语音不落库；provider 条款登记；本地模型、零收费计费和本地区域故障适配器 | 真实模型/DPA/区域、价格税务/支付、云供应商/部署区域均未选择，不产生费用 |
| 安全与运维 | `THREAT_MODEL.md`、`PENETRATION_BASELINE.md`、`OPERATIONS_SLO.md`；自动测试、边界验证与故障演练 | 外部渗透、镜像/生产 secrets 扫描、真实容量/区域演练、on-call/状态页/事件演练未完成 |

结论：本地工程边界可供后续集成，但 `docs/cloud/CLOUD_GO_NO_GO.md` 判定生产 **No-Go**。ATH-CLOUD-001 转为 **Blocked**，不得关闭或宣称 Cloud 1.0 已发布；Mobile 1.0 的硬前置仍未满足。
