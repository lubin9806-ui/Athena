# Athena 商业化问题台账

> 基线日期：2026-07-15  
> 这是唯一问题台账。严重级别、状态和交接规则见 `WORK_PROTOCOL.md`。

## 1. 状态汇总

| 严重级别 | Closed | Open/In Progress/Blocked | 说明 |
|---|---:|---:|---|
| Blocker | 7 | 0 | 窗口 01 的仓库、事实源与验证链 Blocker 已全部关闭 |
| P0 | 6 | 4 | ATH-SEC-001～003、ATH-PRIV-001、ATH-DATA-001、ATH-LEGAL-001 已关闭；ATH-REL-001 及 Steam/Cloud/Mobile P0 未关闭 |
| P1 | 3 | 3 | ATH-VOICE-001、ATH-WEB-001、ATH-CONFIG-001 已关闭；Desktop/运营三项保持 Blocked |
| P2/P3 | 2 | 1 | ATH-ARCH-001、ATH-PRODUCT-001 已关闭；ATH-REPO-001 保持未关闭 |

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
| ATH-DESKTOP-002 | Desktop 1.0 的授权、支持、退款和正式发布材料未定义 | 单一一次性个人 SKU、2 设备/1.x 权益、换机/14 日退款/支持分流已冻结；可替换 LicenseAdapter、生产拒绝配置、官网/商店/EULA/隐私/支持源稿与本地回归已落盘；真实主体、价格、支付/许可证平台、公钥、公开 URL 和联系人仍为空 | P1 | 07 | Blocked | **外部阻断：发行主体、销售/税务、支付与许可证平台、价格币种、公开支持/隐私/安全渠道和法律/产品签字**；生产激活 UI/安全存储/公钥轮换/真实平台测试完成后关闭 |
| ATH-STEAM-001 | 无 Steamworks、Depot、所有权、内容问卷和 Steam 专用裁剪 | 已实现独立 Steam SKU/build、主进程 Steamworks restart/AppID/订阅/SteamID/私有分支 fail-closed 校验、SteamPipe VDF、VC++ redistributable 运行稿、Full/终端/HTTP/外链/站外支付多层裁剪、Cloud AES-GCM+vector clock+冲突/墓碑删除协议、AI 申报/guardrail、Athens 主题素材和 near-final verifier；窗口 03 白名单仍为空 | P0 | 08 | Blocked | **外部阻断：Desktop 1.0 干净基线、真实 Steamworks 合作方账号/AppID/DepotID/Steam Direct、签名候选、私有分支 owned-account/clean-machine/Cloud 测试、内容问卷与 Valve Store/build review**；`npm.cmd run test:steam` 仅证明工程边界，不冒充平台通过 |
| ATH-CLOUD-001 | 无认证、租户隔离、同步、计费、SLO 和数据权利服务 | `cloud/` 独立服务边界已实现认证/MFA/恢复/会话/设备、租户隔离、v1 加密同步、密钥轮换、限流配额、审计、导出删除、备份恢复、模型最小留存、零费用适配器与故障演练；生产供应商/区域/计费/KMS/TLS/外部渗透与运维签字未完成 | P0 | 09 | Blocked | **外部阻断：确定云/区域/KMS、模型与恢复供应商条款、计费税务、生产部署与 SLO/RPO/RTO、外部渗透/镜像扫描、法定留存和 on-call/状态页**；全部通过并签字后作为 Mobile 发布前置 |
| ATH-MOBILE-001 | 无 iOS/Android 工程和移动商店合规 | 未启动：Cloud 1.0 生产发布门为 No-Go；仓库无移动工程、Apple/Google 商店账号或真实审核证据 | P0 | 10 | Blocked | **前置阻断：Cloud 1.0 必须先取得有签字的生产 Go**；解锁后再写移动 ADR、创建 Companion 并完成 Mobile 专项清单、真实账号签名与 App Store/Google Play 审核 |
| ATH-OPS-001 | 无跨平台事件响应、状态页、停止支持与发布复盘机制 | `config/operations.json`、`docs/ops/*` 与 `scripts/verify-operations-readiness.js` 已建立责任链、支持时限、事故等级、状态页模板、停更/撤包/热修/通知/复盘、EOL 和迁移控制；窗口 11 独立复核判定五平台全部 No-Go；真实负责人/值班/公开渠道/独立状态页和外部平台演练仍缺失 | P1 | 11 | Blocked | **外部阻断：配置真实 Release/Security/QA/Support/各平台 Owner 与 Cloud 双人 on-call，部署独立状态页和公开支持/安全/隐私入口**；完成 P0 tabletop、五平台停更/撤包/通知/恢复演练并关闭行动项后方可 Closed |
| ATH-ARCH-001 | PluginManager/Planner 关闭，Workflows/Skills 多为骨架 | Workflows 已实现四个有界 start/next/cancel/complete 会话并测试；PluginManager、Planner、Skills/插件市场保持 Excluded 且不进入 1.0 宣传 | P2 | 05 | Closed | 已实现并测试的固定工作流保留为 Beta；其余骨架从 1.0 UI/宣传排除 |
| ATH-PRODUCT-001 | Live2D、音乐、日历、跨平台等旧愿景未实现 | `promo/*.html` 与 `DESKTOP_1_0_STORE_LISTING.md` 已移除旧 Muse/Venus/Oracle 和未实现工作流卖点；Live2D、音乐、日历、云同步、Steam/Mobile/macOS/Linux 均明确为 Planned/Excluded；商业回归扫描禁词和必需边界 | P3 | 07 | Closed | 已从 Desktop 1.0 官网/商店源稿排除；未来进入矩阵后另建实现问题并重新过营销审核 |
| ATH-REPO-001 | 来源不明空目录、历史归档和大模型本地 payload 仍需长期归属策略 | `新建文件夹/`、`legacy/root-artifacts`、`models/` | P2 | 04 | Open | 确认所有者/许可/保留期；在有备份和批准前不得删除 |

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
| 退款与支持 | 14 日自愿退款且法定权利优先；退款撤权但保留本机数据；一般支持/隐私/安全三入口和响应目标已冻结 | 真实入口均为 `null`，EULA/隐私政策未生效，法律与运营签字缺失 |
| 官网与发行材料 | `promo/index.html`、`product.html`、`visual.html`；商店长短描述、截图规则、EULA/隐私草案、支持运行稿 | 全部明确 Prelaunch/No-Go/尚未开放购买；正式域名、下载、价格和签名 build 截图不存在 |
| 产品承诺审计 | ATH-PRODUCT-001 关闭；Live2D、音乐、日历、跨设备同步、Cloud/Steam/Mobile/macOS/Linux 保持 Planned/Excluded；旧人格和虚构工作流卖点移除 | 未来实现必须先更新产品矩阵并重新审核素材 |
| 自动化 | `npm.cmd run test:commercial` 输出 `ATHENA_COMMERCIAL_READINESS_OK sku=athena-desktop-personal-v1 model=one_time devices=2 productionBlockers=9` | 通过证明边界和拒绝门有效，不等于生产平台或商业发布通过 |

结论：ATH-PRODUCT-001 **Closed**；ATH-DESKTOP-002 的可替换工程与政策定义完成，但因真实主体/交易/许可证/公开联系渠道和签字缺失转为 **Blocked**。Universal + Desktop 清单仍有签名、真实 Beta、质量、法务和运营未完成项，Desktop 1.0 为 **No-Go**。

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
