# Athena 发布验收清单

> 基线日期：2026-07-15  
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
| 产品/SKU |  |
| 商业版本 |  |
| 内部 build |  |
| Git commit/tag | 窗口 01 已恢复有效仓库；尚未创建初始提交或 tag，发布候选必须补齐 |
| 构建时间/环境 |  |
| 负责人 |  |
| 候选产物 SHA-256 |  |
| 最终结论 | Go / No-Go |
| 未关闭风险 |  |

## 3. 当前基线证据（2026-07-15）

- [x] `npm.cmd run typecheck`
- [x] Git 仓库有效：`rev-parse=true`、branch=`main`；大模型、环境文件、数据库和发布物 ignore probe 通过
- [x] `npm.cmd run audit:security` 可访问官方 advisory endpoint 并返回结构化结果
- [x] `npm.cmd run test:persona`
- [x] `npm.cmd run test:modes`
- [x] `npm.cmd run test:theme`
- [x] `npm.cmd run test:logger`
- [x] `npm.cmd run test:web-search` → `WEB_SEARCH_VERIFY_OK`
- [x] `npm.cmd run test:tools` → 权限、撤销、取消、模式隔离均通过
- [x] `npm.cmd run smoke:electron` → `ATHENA_SMOKE_READY_TO_SHOW`、`ATHENA_SMOKE_DOM_OK`
- [x] `npm.cmd run db:stats` → messages 85 / profile 9 / events 75 / project notes 5 / index 174
- [x] `npm.cmd run build` → 0.8.0 NSIS 构建成功
- [x] `release\win-unpacked\Athena.exe --smoke-test` → `ATHENA_SMOKE_READY_TO_SHOW`、`ATHENA_SMOKE_DOM_OK`
- [~] `release\Athena Setup 0.8.0.exe` 已生成并记录 SHA-256，但仍未签名
- [~] 离线包已生成，但许可、精确内容 manifest、签名和 clean-room 安装未通过
- [ ] 官方 registry `npm audit` 清零：当前 8 项（7 High、1 Moderate）
- [ ] live 搜索、LLM 综合、live 工具测试纳入候选版证据

## 4. Universal 发布门

### 4.1 范围和版本

- [ ] `PRODUCT_MATRIX.md` 中所有 GA 能力在候选 build 可用
- [ ] 商店页、官网、截图、视频和更新说明不包含 Planned/Excluded 能力
- [ ] 技术版本、应用内版本、安装包版本、商店版本一致
- [ ] 有效 Git tag/commit 可定位源码，构建写入 commit 和时间
- [ ] 版本边界、最低系统要求、已知限制和迁移说明已冻结

### 4.2 安全

- [ ] Electron 位于官方支持的最近三个稳定大版本之一
- [ ] `npm audit --registry=https://registry.npmjs.org` 无 High/Critical；其余例外有风险接受记录
- [ ] Python、Ollama、模型和外部二进制均有版本锁定、哈希和漏洞检查
- [ ] `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true` 已验证
- [ ] 严格 CSP 已验证；无 `unsafe-eval`；生产 source map 不分发
- [ ] IPC 全部验证发送者、类型、长度和路径；新增通道有负向测试
- [ ] 外链只允许预期 HTTPS；导航、下载和权限请求默认拒绝
- [ ] 麦克风只在用户动作后请求；拒绝权限不阻断文本核心功能
- [ ] Execute 默认 Off；Read/Files/Full 升权有清晰说明和显式同意
- [ ] 删除、覆盖、移动、命令、程序启动、外网请求等高风险动作有确认/范围策略
- [ ] 工具降权、离开 Execute、取消任务会立即撤销可撤销能力
- [ ] 安装器、主 exe、卸载器和辅助可执行文件均签名并验证时间戳
- [ ] 安装包通过 Defender/Smart App Control 测试和多引擎恶意软件扫描
- [ ] secrets 扫描通过；候选包不含 `.env`、开发数据库、日志、缓存、用户模型目录或测试数据

### 4.3 隐私和数据权利

- [ ] 数据流清单覆盖聊天、记忆、语音、搜索、工具日志、崩溃诊断和支付
- [ ] 隐私政策与 EULA 有公开稳定 URL，应用内可访问
- [ ] 首次启用搜索、在线 STT/TTS、云同步、遥测前有分别说明和同意
- [ ] UI 明确区分本地推理、第三方联网和 Athena Cloud
- [ ] 历史保存开关真实生效；关闭后不会继续提取长期记忆
- [ ] `historyRetentionDays` 有真实清理任务和边界测试
- [ ] 用户可以导出支持范围内的全部数据
- [ ] 用户可以清除本机数据；账号平台可删除账号和关联云数据
- [ ] 删除、保留、备份和法定留存规则一致且可验证
- [ ] 敏感本地数据的静态加密/Windows 凭据保护方案已完成威胁评估
- [ ] 日志默认不写完整提示、密钥、Authorization、Cookie、密码或敏感文件内容
- [ ] 数据库升级前备份，失败时可恢复；卸载时的数据保留选择透明

### 4.4 法务与知识产权

- [ ] 公司/发行主体、产品名、域名、支持邮箱和隐私联系人确定
- [ ] Athena/苏时夏名称、图标、字体、壁纸、宣传图、音频的权属证据归档
- [ ] npm 与 Python 依赖许可清单、SBOM 和 notices 随版本归档
- [ ] Ollama 的精确版本与再分发条款核验
- [ ] Qwen 的精确模型、量化、manifest、license 和归属文本核验
- [ ] AI 生成的代码/图片/音频素材有来源、使用范围和人工复核记录
- [ ] 用户协议包含 AI 局限、内容责任、工具执行风险和禁止用途
- [ ] 目标销售区域的隐私、消费者保护、AI 披露、税务和退款要求经专业复核

### 4.5 可靠性和质量

- [ ] 类型检查和全部非 live 自动化测试通过
- [ ] live 搜索、live LLM、live 工具在隔离测试环境通过
- [ ] Electron 开发态与打包态烟测均有 `READY_TO_SHOW`、`DOM_OK`
- [ ] 首次安装、覆盖升级、跨版本升级、卸载、重装和回滚矩阵通过
- [ ] 无 Ollama、无模型、无 Python、断网、弱网、磁盘满、数据库锁定均有可理解降级
- [ ] 长会话、长文本、大数据库、长时间托盘运行通过 CPU/内存/磁盘门槛
- [ ] 关键数据迁移有向前/回滚测试和备份恢复演练
- [ ] 更新包签名、分批发布、暂停发布、回滚和紧急修复流程通过
- [ ] 崩溃诊断最小化、可退出且不会包含敏感正文
- [ ] 无障碍：键盘、焦点、对比度、缩放、屏幕阅读基础检查通过
- [ ] 中文编码、英文兜底、时区和日期边界通过

### 4.6 构建与供应链

- [ ] CI 从干净 checkout 构建，不依赖开发机缓存或个人 `%USERPROFILE%`
- [ ] package manager、Node、Python 和构建工具版本锁定
- [ ] production manifest 只包含允许文件；根目录杂物不会进入产物
- [ ] `puppeteer` 等无用依赖移除或给出必需证据
- [ ] 轻量包和离线包分别有精确 manifest、大小、哈希和许可
- [ ] 离线包只复制指定模型 artifact，不复制整个用户 `.ollama\models`
- [ ] 产物可重复构建并生成 SBOM、notices、SHA-256 和签名验证报告
- [ ] 发布密钥、签名证书和商店凭据不在仓库，具备轮换和恢复方案

### 4.7 运营和支持

- [ ] 支持入口、响应时限、退款流程、状态页和已知问题页可用
- [ ] 发布负责人、安全联系人、隐私联系人和事件升级链确定
- [ ] P0 安全事件具备停更、撤包、通知、修复和复盘流程
- [ ] 指标只采集必要数据，并与隐私同意/退出机制一致
- [ ] 版本停止支持、数据迁移和服务终止策略已公布

## 5. Desktop Direct 专项

- [ ] Windows 10/11 x64 最低 build 和硬件/内存/磁盘要求已实测
- [ ] 代码签名发布者名称与官网/安装器一致
- [ ] SmartScreen/Smart App Control、标准用户安装和 UAC 路径通过
- [ ] 安装目录可变、快捷方式、启动项、托盘、关闭行为与设置一致
- [ ] Ollama 未安装/版本不兼容/端口冲突/模型缺失的引导可恢复
- [ ] 轻量安装器不暗示包含模型；离线包标明真实体积和磁盘需求
- [ ] Execute Beta 的默认 Off、高危确认、审计和故障恢复通过真实用户测试
- [ ] beta/stable 更新通道、签名更新与回滚通过
- [ ] 购买许可、激活、换机和退款策略完成，或明确 1.0 采用无账号一次性授权方案

## 6. Steam 专项

- [ ] Steamworks 合作方、AppID、税务/银行和 Steam Direct 流程完成
- [ ] Steam SDK/启动/所有权校验和离线行为完成
- [ ] SteamPipe Depot、分支、安装脚本和 redistributables 从干净机器验证
- [ ] 商店页仅写当前 build 已实现能力；截图来自真实 build
- [ ] 内容问卷完整披露开发期 AI 与 live-generated AI；guardrail 描述与实现一致
- [ ] Full Execute/终端/任意 HTTP 在 Steam 1.0 build 中排除
- [ ] 任何应用内交易使用 Steam Wallet，不引流外部商店
- [ ] Steam Cloud 仅同步白名单、加密、小型数据；冲突和删除传播通过
- [ ] 只勾选实际验证的 Windows；不提前承诺 Linux/Steam Deck
- [ ] Store Presence 和 near-final Build 均预留至少 7 个工作日审核缓冲
- [ ] Valve review 反馈全部关闭并归档

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

- [ ] 资产、信任边界、威胁模型和数据分类评审完成
- [ ] 身份认证、会话、MFA/恢复、租户隔离和权限测试通过
- [ ] 传输加密、静态加密、密钥管理、轮换和 secrets 管理通过
- [ ] API 版本、幂等、限流、配额、重试和兼容策略冻结
- [ ] 模型 provider 数据处理条款、地域和保留策略归档
- [ ] 内容安全、滥用防护、封禁/申诉和人工升级流程完成
- [ ] 计费、权益、发票/税务、试用、欠费和退款状态机通过
- [ ] 数据导出、账号删除、备份删除和法定留存可审计
- [ ] SLO、容量、监控、告警、on-call、状态页和事件响应演练通过
- [ ] 备份/恢复满足 RPO/RTO；区域故障和供应商故障有降级方案
- [ ] 渗透测试、依赖/镜像扫描和发布审批完成

## 9. 标准验证命令

```powershell
npm.cmd run typecheck
npm.cmd run test:persona
npm.cmd run test:modes
npm.cmd run test:theme
npm.cmd run test:logger
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
