# Athena 发布验收清单

> 基线日期：2026-07-18
> 使用方式：每个候选版本复制一份发布记录，填写证据链接/路径和负责人。`docs/COMMERCIAL_ROADMAP.md` 决定版本范围，本文件决定是否可以发布。

## 1. 状态规则

- `[x]`：当前基线有可重复证据。
- `[ ]`：未完成或未验证；发布门项目不得口头豁免。
- `[~]`：部分完成，只能用于内部 Alpha，视同未通过发布门。
- `N/A`：必须写明为什么对该 SKU 不适用。

只要目标平台存在未关闭 P0，或其必需区块有 `[ ]`/`[~]`，结论就是 **No-Go**。

## 2. 候选版本记录

| 字段 | 值 |
|---|---|
| 产品/SKU | Desktop Direct / Athena Desktop 1.x Personal 商业预发布；工程候选仍为 0.9 Private Beta |
| 商业版本 | Desktop Window 07 / `0.9.0-beta.1`（未提升为 1.0） |
| 内部 build | `0.9.0-beta.1-9c930db5cd2e-44f5a481cdcf` |
| Git commit/tag | 窗口 11 刷新父基线 `40336f3 feat(steam): establish window 08 engineering slice`；刷新时工作树 18 条，`cleanCheckout=false`；没有候选 tag |
| 构建时间/环境 | 2026-07-18 刷新；Windows x64 10.0.26200；Node 24.18.0；Electron 42.7.0 |
| 负责人 | 窗口 11（独立复核与运营门；未代替 Product/Security/Legal/QA 人工签字） |
| 候选产物 SHA-256 | unsigned installer `7D486394F947FF36AE905DFFD9F095987B66B7C3C835D1814635F80936BF6845`；unsigned unpacked EXE `337540574E02AECDF804417DB48C2A87A682405BD3347EFCA29B617730DC94E1` |
| 最终结论 | **No-Go / Blocked** |
| 未关闭风险 | ATH-SEC-003/ATH-PRIV-001：发行配置已漂移为 Execute=`full` 且部分联网同意=true；ATH-REL-001：代码签名证书、批准发布者 DN、HTTPS 更新源、clean-checkout CI 实跑和真实更新/暂停/回滚仍缺外部证据；ATH-DESKTOP-001：真实测试者 0/20–50，安装矩阵、UAC、Defender、标准用户和弱网未完成；ATH-DESKTOP-002：发行主体、价格税务、支付/许可证平台、公钥、公开支持/隐私/安全入口和签字缺失。当前包 `NotSigned` 且不得销售或分发给 Beta 参与者 |

## 3. 当前基线证据（2026-07-15）

- [x] `npm.cmd run typecheck`
- [x] Git 仓库有效：`rev-parse=true`、branch=`main`；大模型、环境文件、数据库和发布物 ignore probe 通过
- [x] `npm.cmd run audit:security` 使用 `https://registry.npmjs.org/` → `found 0 vulnerabilities`
- [x] `npm.cmd run test:persona`
- [x] `npm.cmd run test:modes`
- [x] `npm.cmd run test:theme`
- [x] `npm.cmd run test:logger`
- [x] `npm.cmd run test:security` → `SECURITY_BASELINE_OK`
- [x] `npm.cmd run test:privacy` → `ATHENA_PRIVACY_DATA_OK`
- [x] `npm.cmd run test:supply-chain` → `ATHENA_SUPPLY_CHAIN_OK packages=61 manifest=docs/SUPPLY_CHAIN_MANIFEST.json`
- [x] `npm.cmd run test:web-search` → `WEB_SEARCH_VERIFY_OK`
- [x] `npm.cmd run test:tools` → 权限迁移/降权、运行中撤权、任务取消、逐次高危拒绝、参数脱敏、模式隔离均通过
- [x] `npm.cmd run smoke:electron` → `ATHENA_SMOKE_READY_TO_SHOW`、`ATHENA_SMOKE_DOM_OK`
- [x] `npm.cmd run db:stats` → messages 85 / profile 9 / events 75 / project notes 5 / index 174
- [x] `npm.cmd run build` → Electron 42.7.0 / electron-builder 26.15.3 的 0.8.0 NSIS 构建成功
- [x] `release\win-unpacked\Athena.exe --smoke-test` → 退出码 0；`ATHENA_SMOKE_READY_TO_SHOW`、`ATHENA_SMOKE_DOM_OK`
- [~] `release\Athena Setup 0.8.0.exe` 已生成并记录 SHA-256 `F4E25930D551969678D6BF1BF932115D1D9D936520274FB8EF4589DD8AEC4D1E`，Authenticode 状态为 `NotSigned`
- [x] 生产 `app.asar` 清单中 `.map` 与 `.d.ts` 计数均为 0；未使用的 Puppeteer 已从依赖和 lockfile 移除
- [ ] 候选 SKU 若包含联网搜索/LLM/live 工具，则对应 live 测试纳入候选证据；现有 HTML 搜索已从 Desktop/Steam 1.0 排除

### 3.1 窗口 06 工程候选证据（2026-07-16）

- [x] 版本统一为 `0.9.0-beta.1`；`APP_VERSION` 直接读取 package metadata；package/lock/包内 metadata 一致
- [x] `.github/workflows/desktop-beta.yml` 定义 Windows clean checkout、`npm ci`、Electron ABI rebuild、全回归、`--require-clean`、签名 secret 门、packaged smoke 和候选 artifact 上传
- [x] 构建输入 SHA-256 `44F5A481CDCF12E0E40F7467EF20B59AD52C1CDAFAD11A86D273F2EC870AE6FB` 与 commit 写入包内 `resources/build-info.json`
- [x] `npm.cmd run test:release` → `ATHENA_RELEASE_ENGINEERING_OK version=0.9.0-beta.1 channels=beta,stable migrationBackup=verified rollback=verified`
- [x] 数据库 schema v1 仅在迁移时生成一致快照；注入迁移失败后恢复原数据和 `user_version=0`，随后正常升级到 v1；保留最近 5 个迁移备份
- [x] updater 客户端使用 NSIS generic provider、SHA-512、包内 publisher DN 匹配、默认不自动下载/安装，并在检查和下载前尊重 `control.json.paused`
- [x] `npm.cmd run test:desktop-faults` → `ATHENA_DESKTOP_FAULTS_OK noOllama=degraded portConflict=rejected weakNetwork=bounded`
- [~] 开发态 smoke 输出 `ATHENA_SMOKE_READY_TO_SHOW` / `ATHENA_SMOKE_DOM_OK`；窗口 07 最新 unsigned EXE 因新哈希被本机 Application Control 阻止启动，旧窗口打包态成功不能替代新包证据
- [x] `npm.cmd run test:supply-chain` → `ATHENA_SUPPLY_CHAIN_OK packages=77 manifest=docs/SUPPLY_CHAIN_MANIFEST.json`；官方 npm audit 为 0 vulnerabilities
- [x] `npm.cmd run test:commercial` → `ATHENA_COMMERCIAL_READINESS_OK sku=athena-desktop-personal-v1 model=one_time devices=2 productionBlockers=13`
- [~] 工程候选 installer 105,971,220 bytes、unpacked EXE 232,771,072 bytes 已生成并精确哈希；两者 Authenticode 均为 `NotSigned`，candidate manifest 为 `BLOCKED`；生产 ASAR 1,376 项且 `.map/.d.ts` 为 0，内置商业配置保持 `prelaunch/unconfigured`
- [ ] 代码签名证书、发布者 DN、HTTPS feed 和真实 clean-checkout CI run（外部 Blocked）
- [ ] 首装/覆盖升级/跨版本/卸载/重装、标准用户/UAC/Defender/弱网真实矩阵
- [ ] 20–50 人受控 Beta；当前完成数 `0`，不得写为 Beta passed

### 3.2 窗口 07 商业预发布证据（2026-07-16）

- [x] Desktop 1.0 冻结为单一 `athena-desktop-personal-v1`：一次性个人许可证、不设 Free/Pro 或订阅、无需账号、最多 2 台本人设备、覆盖 1.x 更新
- [x] 激活/停用/离线校验使用可替换 `LicenseAdapter`/`LicenseStore`；本地测试覆盖设备上限、换机释放槽位、错设备、篡改、2.x 越界和原始密钥不持久化
- [x] 退款边界冻结为购买后 14 个自然日自愿退款且法定权利优先；退款撤销 entitlement 但不远程删除本机数据
- [x] 一般支持、隐私和安全三入口及响应目标已定义；所有真实地址在生产配置中仍为 `null`，没有虚构主体或联系人
- [x] `promo/*.html` 与 `DESKTOP_1_0_STORE_LISTING.md` 只描述当前可验证边界，明确 Prelaunch/No-Go/尚未开放购买；Live2D、日历、云同步和跨平台保持 Planned/Excluded
- [~] EULA、隐私政策、支持运行稿和商店文案已形成源稿，但没有法律复核、公开稳定 URL、正式主体、签名 build 截图/视频或产品签字
- [ ] 真实支付/许可证平台、价格币种、销售区域/税务、生产公钥与轮换、安全 entitlement 存储、设备标识隐私评审、应用内激活 UI 和真实激活/换机/退款演练

## 4. Universal 发布门

### 4.1 范围和版本

- [ ] `PRODUCT_MATRIX.md` 中所有 GA 能力在候选 build 可用
- [~] 仓库内官网/商店文案源稿已通过 Planned/Excluded 宣称审计；正式截图、视频、域名和更新说明尚不存在，不能整体勾选通过
- [ ] 技术版本、应用内版本、安装包版本、商店版本一致
- [ ] 有效 Git tag/commit 可定位源码，构建写入 commit 和时间
- [~] 版本/SKU/Planned 边界和已知限制源稿已冻结；最低 Windows build/硬件门、正式迁移说明仍待真实矩阵

### 4.2 安全

- [x] Electron 位于官方支持的最近三个稳定大版本之一（42.7.0）
- [x] `npm audit --registry=https://registry.npmjs.org` 无 High/Critical（当前总漏洞 0）
- [~] Python、Ollama、模型和外部二进制已有工程 manifest：Python requirements 归档、OllamaSetup.exe 0.31.1 / SHA-256 `E56DEF86D8E5612F67F2876720C5808C01F9A5AB63DBEE7D873E9C0CB4A8FECA`、Qwen2.5 Apache-2.0 来源归档；漏洞检查和再分发签字仍未完成
- [x] `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true` 已验证
- [x] 严格 CSP 已验证；无 `unsafe-eval`/`unsafe-inline`；生产 source map 不分发
- [x] IPC invoke 通道全部验证发送者；聊天类型/长度和文件路径有负向测试
- [x] 外链/导航先默认拒绝，仅对无凭据 HTTPS 地址显示显式确认；下载和非音频权限请求默认拒绝
- [x] 麦克风仅在 renderer 显式请求后短时放行；拒绝权限不阻断文本核心功能
- [ ] 窗口 11 刷新发现受跟踪发行配置的 Execute/全局权限为 Full；实现层升权说明仍在，但恢复默认 Off 并复验前不得通过
- [x] 删除、覆盖、移动、命令、程序启动、外网请求等高风险动作有逐次确认和脱敏预览
- [x] 工具降权、离开 Execute、取消任务会立即撤销可撤销能力
- [ ] 安装器、主 exe、卸载器和辅助可执行文件均签名并验证时间戳
- [ ] 安装包通过 Defender/Smart App Control 测试和多引擎恶意软件扫描
- [ ] secrets 扫描通过；候选包不含 `.env`、开发数据库、日志、缓存、用户模型目录或测试数据

### 4.3 隐私和数据权利

- [x] 数据流清单覆盖当前 Desktop 本机范围内的聊天、长期记忆、设置、搜索、语音、工具记录、日志、临时文件和本地脱敏崩溃诊断；支付未实现且不得宣传
- [ ] 隐私政策与 EULA 有公开稳定 URL，应用内可访问
- [ ] 联网能力有独立说明/同意实现，但窗口 11 刷新发现发行配置的 webSearch/externalToolNetwork 已预先同意；恢复默认 false 并复验前不得通过
- [x] UI 明确区分本地推理、第三方联网和未实现的 Athena Cloud/账号/Steam/Mobile
- [x] 历史保存开关真实生效；关闭后不会继续保存聊天或提取长期记忆
- [x] `historyRetentionDays` 有真实清理任务和边界测试
- [x] 用户可以导出支持范围内的全部本机数据
- [x] 用户可以清除本机数据；账号/云端平台未实现且不适用当前 Desktop 本机范围
- [x] 删除、保留、备份规则一致且可验证；法定留存仍需法律窗口确认
- [x] 敏感本地数据的静态加密/Windows 凭据保护方案已完成威胁评估；当前 SQLite 明文，不宣称已加密
- [x] 日志默认不写完整提示、密钥、Authorization、Cookie、密码或敏感工具正文，脱敏有回归测试
- [x] 数据库升级前备份，失败时可恢复；卸载时的数据保留选择仍属安装/发布窗口

### 4.4 法务与知识产权

- [ ] 公司/发行主体、产品名、域名、支持邮箱和隐私联系人确定
- [ ] Athena/苏时夏名称、图标、字体、壁纸、宣传图、音频的权属证据归档
- [x] npm 与 Python 依赖许可清单、SBOM 和 notices 随版本归档：`docs/THIRD_PARTY_NOTICES.md`、`docs/SUPPLY_CHAIN_MANIFEST.json`
- [~] Ollama 的精确版本与再分发条款核验：`OllamaSetup.exe` 0.31.1 与 SHA-256 已归档；再分发条款仍需发布签字
- [~] Qwen 的精确模型、量化、manifest、license 和归属文本核验：默认 tag、上游模型和 Apache-2.0 已归档；离线包精确 blob/quant manifest 需 allowlist 后复核
- [~] AI 生成的代码/图片/音频素材有来源、使用范围和人工复核记录：`docs/ASSET_PROVENANCE.md` 已归档；人工权属签字仍未完成
- [~] `EULA_DRAFT.md` 已包含 AI 局限、内容责任、Execute 风险和禁止用途；真实主体、适用法律、责任条款、法律复核和公开 URL 未完成
- [ ] 目标销售区域的隐私、消费者保护、AI 披露、税务和退款要求经专业复核

### 4.5 可靠性和质量

- [x] 类型检查和全部非 live 自动化测试通过
- [ ] 候选 SKU 包含的 live LLM/工具在隔离测试环境通过；现有无商业授权 HTML 搜索不得纳入候选 SKU
- [x] Electron 开发态与打包态烟测均有 `READY_TO_SHOW`、`DOM_OK`
- [ ] 首次安装、覆盖升级、跨版本升级、卸载、重装和回滚矩阵通过
- [x] 无 Ollama/端口冲突/弱网由 `test:desktop-faults` 覆盖；无 Python/语音模型、磁盘不足、数据库锁定由 `test:window05:reliability` 覆盖并有有界提示
- [ ] 长会话、长文本、大数据库、长时间托盘运行通过 CPU/内存/磁盘门槛
- [x] 关键数据迁移有升级前备份和失败恢复自动化覆盖；完整安装升级矩阵仍属 ATH-REL-001/窗口 06
- [ ] 更新包签名、分批发布、暂停发布、回滚和紧急修复流程通过
- [x] 崩溃诊断仅写本机 JSONL、1 MB 轮转、字段/密钥脱敏，不上传遥测；删除本地诊断目录即可退出/清除
- [ ] 无障碍：键盘、焦点、对比度、缩放、屏幕阅读基础检查通过
- [ ] 中文编码、英文兜底、时区和日期边界通过

### 4.6 构建与供应链

- [ ] CI 从干净 checkout 构建，不依赖开发机缓存或个人 `%USERPROFILE%`
- [~] package manager、Node、Python 和构建工具版本锁定：Node 24.18.0、package-lock v3、Electron 42.7.0、electron-builder 26.15.3、TypeScript 5.9.3、Vite 8.1.4 已归档；Python 运行时版本仍需候选环境锁定
- [x] production `app.asar` 已验证不含 `.map/.d.ts`；供应链 manifest 已归档允许资源和构建产物
- [x] 未使用的 `puppeteer` 已从依赖和 lockfile 移除
- [~] 轻量包和离线包分别有精确 manifest、大小、哈希和许可：轻量包已归档；离线包需真实 `OFFLINE_MODEL_ALLOWLIST.json` 后生成
- [x] 离线包只复制指定模型 artifact，不复制整个用户 `.ollama\models`
- [~] 产物可重复构建并生成 SBOM、notices、SHA-256 和签名验证报告：SBOM/notices/SHA-256 已生成；签名验证仍为 NotSigned
- [ ] 发布密钥、签名证书和商店凭据不在仓库，具备轮换和恢复方案

### 4.7 运营和支持

- [~] 支持/隐私/安全分流、响应目标、14 日退款和已知限制内容已定义；真实 URL/邮箱、独立状态页和公开已知问题页未上线
- [~] `config/operations.json` 与 `docs/ops/RELEASE_OPERATIONS.md` 已定义发布责任链和升级链；真实负责人、Cloud 双人 on-call、分页服务和公开入口仍为空
- [~] P0/P1 的停更、撤包、热修、通知、修复和复盘流程及模板已落盘；尚未用 Desktop/Steam/Cloud/Apple/Google 真实账号完成演练
- [ ] 指标只采集必要数据，并与隐私同意/退出机制一致
- [~] 版本停止支持、数据迁移和服务终止策略已落盘；尚未在真实公开渠道发布或完成生产演练

## 5. Desktop Direct 专项

- [ ] Windows 10/11 x64 最低 build 和硬件/内存/磁盘要求已实测
- [ ] 代码签名发布者名称与官网/安装器一致
- [ ] SmartScreen/Smart App Control、标准用户安装和 UAC 路径通过
- [ ] 安装目录可变、快捷方式、启动项、托盘、关闭行为与设置一致
- [ ] Ollama 未安装/版本不兼容/端口冲突/模型缺失的引导可恢复
- [ ] 轻量安装器不暗示包含模型；离线包标明真实体积和磁盘需求
- [ ] Execute Beta 的默认 Off、高危确认、审计和故障恢复通过真实用户测试
- [ ] beta/stable 更新通道、签名更新与回滚通过
- [~] 已明确 1.0 采用无账号一次性个人授权、2 设备、1.x 权益、换机和 14 日退款；生产 provider、公钥、安全存储、应用内 UI、公开入口和真实演练未完成

## 6. Steam 专项

- [ ] Steamworks 合作方、AppID、税务/银行和 Steam Direct 流程完成
- [~] SDK 桥、restart/AppID/订阅/SteamID/私有分支 fail-closed 校验和注入回归已完成；真实 AppID owned-account/offline 行为未验证
- [~] SteamPipe app/depot VDF、私有测试分支规则和 VC++ 2015–2022 x64 redistributable 运行稿已完成；真实上传与 clean-machine 未验证
- [~] 商店文案只写首发边界并有 5 张不低于 1920x1080 的 16:9 实际运行截图候选；必须从真实 Steam near-final build 复捕/核对
- [~] 开发期 AI、live-generated AI、guardrail 与局限已形成问卷草案；尚未在 Steamworks 提交或获 Valve 核验
- [x] Full Execute、所有 full-level 工具、终端、命令/程序启动、任意 HTTP/TCP、搜索与外链在 Steam 运行时多层排除
- [x] Steam SKU 无应用内交易和外部购买路径；未来交易必须另行接 Steam Wallet 审核
- [~] AES-256-GCM、大小限制、vector-clock 冲突和墓碑删除传播回归通过；窗口 03 未批准条目，白名单为空且 Cloud 关闭
- [x] 构建配置与文案只声明 Windows x64，明确不承诺 Linux/macOS/Steam Deck
- [x] 运行稿要求 Store Presence 与 near-final Build 各预留至少 7 个工作日；实际排期需账号 owner 确认
- [ ] Valve review 反馈全部关闭并归档

窗口 08 工程结论：`npm.cmd run test:steam` 输出 `ATHENA_STEAM_WINDOW08_OK engineering-only` 与 `ATHENA_STEAM_NEAR_FINAL_SOURCE_OK`。因为没有真实 Steamworks 账号、AppID/DepotID、签名候选和 Valve review，ATH-STEAM-001 状态为 **Blocked**，不得改写为 Closed。

## 7. Mobile 专项

- [ ] Cloud 1.0 API、安全和数据权利先通过发布门
- [ ] iOS/Android 工程、签名、bundle/package ID、商店账号和 CI 完成
- [ ] 不包含 Execute、本地 14B、任意文件/终端或桌面常驻行为
- [ ] 麦克风、通知等权限按需请求，有无权限替代路径
- [ ] Apple App Privacy、PrivacyInfo.xcprivacy、Google Data safety 与真实数据流一致
- [ ] 隐私政策在应用内和商店可访问
- [ ] 若能创建账号，应用内账号删除和外部删除入口均可用
- [ ] Apple/Google 订阅、收据校验、恢复购买、退款和家庭/地区边界通过
- [ ] 网络丢失、token 过期、同步冲突、删除传播和多设备并发通过
- [ ] 手机/平板尺寸、动态字体、键盘、VoiceOver/TalkBack 和电量测试通过
- [ ] TestFlight/Play internal → closed → production 分阶段发布完成

## 8. Cloud 专项

- [x] 资产、信任边界、威胁模型和数据分类已落盘并完成窗口内工程评审
- [~] 身份认证、会话、MFA/恢复、租户隔离和权限本地测试通过；独立生产渗透未完成
- [~] TLS 生产拒绝门、静态加密和轮换通过；生产 KMS/secrets/IAM 未选择
- [x] API v1、幂等、限流、配额、重试、冲突和兼容策略已冻结
- [ ] 真实模型 provider 数据条款、地域和保留策略未选择；仅登记不可生产的本地 fixture
- [~] 本地内容阻断、申诉和人工升级状态已实现；生产政策、人员与渠道未完成
- [ ] 计费/税务/发票/退款供应商与政策未确定；本地状态机明确零收费
- [~] 导出、账号删除和已知备份删除可审计；法定留存和分布式删除证明未完成
- [~] SLO/告警/演练基线已定义；真实容量、on-call、状态页和生产事件演练未完成
- [~] 加密备份恢复和本地区域/供应商故障演练通过；真实 RPO/RTO/跨区域未证明
- [ ] 内部渗透基线和依赖审计可执行；外部渗透、镜像扫描和发布审批未完成

## 9. 标准验证命令

```powershell
npm.cmd run typecheck
npm.cmd run test:persona
npm.cmd run test:modes
npm.cmd run test:theme
npm.cmd run test:logger
npm.cmd run test:security
npm.cmd run test:privacy
npm.cmd run test:supply-chain
npm.cmd run test:commercial
npm.cmd run test:web-search
npm.cmd run test:web-search:live
npm.cmd run test:web-search:e2e
npm.cmd run test:tools
npm.cmd run test:tools:live
npm.cmd run smoke:electron
npm.cmd run db:stats
npm.cmd run audit:security
npm.cmd run build
& '.\release\win-unpacked\Athena.exe' --smoke-test
```

候选版必须保存完整日志、退出码、产物哈希和测试环境；不能只记录“已运行”。live 工具测试应在隔离账号/目录执行，不得在真实用户数据上验收。

## 10. 发布签字

| 角色 | 姓名 | 日期 | 结论/备注 |
|---|---|---|---|
| Product |  |  |  |
| Engineering |  |  |  |
| Security/Privacy |  |  |  |
| Legal/License |  |  |  |
| QA/Release |  |  |  |

最终规则：没有可复现证据的勾选视为未完成；任何平台不得借用另一个平台的审核结果。
