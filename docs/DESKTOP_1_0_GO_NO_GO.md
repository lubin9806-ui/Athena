# Athena Desktop 1.0 Go/No-Go

> 窗口 07 / ATH-DESKTOP-002 + ATH-PRODUCT-001。最近工程复核：2026-08-18。目标范围只包含 Universal 与 Desktop Direct，不借用 Steam、Cloud 或 Mobile 的未来能力。

## 最终结论

**NO-GO / BLOCKED。Athena Desktop 1.0 不得收费、公开下载或宣称正式发布。**

窗口 07 已完成产品商业边界、可替换许可证接口、本地状态机测试和发行材料审计。它关闭了“未实现愿景进入宣传”的 ATH-PRODUCT-001，但不能替代签名、真实 Beta、生产支付/许可证、公开主体与联系渠道、质量矩阵或人工签字。

## 窗口 07 交付结论

| 责任项 | 结果 | 证据 |
|---|---|---|
| ATH-PRODUCT-001 | **Closed** | 官网/商店源稿移除旧 Muse/Venus/Oracle 与虚构工作流卖点；Live2D、音乐、日历、云同步、Steam/Mobile/macOS/Linux 明确 Planned/Excluded；营销回归扫描通过 |
| ATH-DESKTOP-002 | **Blocked（定义完成，外部依赖未就绪）** | 单一一次性个人 SKU、2 设备、1.x 权益、换机、14 日退款、支持/隐私/安全分流、EULA/隐私草案和本地适配器已完成；公开入口已初步配置；主体、价格、支付/许可证平台、公钥、生产 UI/安全存储和签字仍缺失 |

## Universal + Desktop 清单复核

按 `RELEASE_CHECKLIST.md` 当前勾选逐项计数：

| 发布门 | 通过 `[x]` | 部分 `[~]` | 未完成 `[ ]` | 结论 |
|---|---:|---:|---:|---|
| Universal | 28 | 12 | 23 | No-Go |
| Desktop Direct | 0 | 1 | 8 | No-Go |

Universal 分区中，安全已取得 10 项通过，但签名/恶意软件扫描/secrets 扫描仍未完成；隐私数据权利有 11 项通过，但正式公开 URL 未完成；法务、可靠性、供应链和运营仍有大量部分或未完成项。Desktop 专项只有“授权策略已定义但生产未接入”达到部分完成，其余真实设备、签名、安装、模型恢复、更新/回滚和用户测试均未通过。

## 本轮可重复证据

- `npm.cmd run typecheck` 通过。
- persona、modes、theme、logger、security、privacy、supply-chain、release、desktop-faults、web-search 和 tools 非 live 回归全部通过。
- `npm.cmd run test:commercial` 输出 `ATHENA_COMMERCIAL_READINESS_OK sku=athena-desktop-personal-v1 model=one_time devices=2 productionBlockers=8`。
- 开发态 Electron smoke 输出 `ATHENA_SMOKE_READY_TO_SHOW` 与 `ATHENA_SMOKE_DOM_OK`。
- `npm.cmd run audit:security` 输出 `found 0 vulnerabilities`。
- `npm.cmd run build` 成功生成 `0.9.6-beta.1` unsigned 工程包，并明确输出 `ATHENA_RELEASE_EXTERNAL_BLOCKED code-signing-certificate-missing` 与 `ATHENA_BUILD_SOURCE_DIRTY paths=1`。
- 最新候选 ID：`0.9.6-beta.1-4611ced92a98-09c484f33ca1`；构建输入 SHA-256：`09C484F33CA1079926AC8AF6078DEC81423CA845583181DEEEB63540232F11AD`；候选 ID 与 build provenance 一致。
- Installer：504,617,492 bytes，SHA-256 `6B394AF215E039BDFFE75C56985755D846A86CFBC4D3271E76B3E016A1B1F878`，Authenticode `NotSigned`。
- unpacked EXE：232,771,072 bytes，SHA-256 `45CBBEED08E534AEBDF537B94BB1E2A16A14DC265597E92B7636A4DC54D8887F`，Authenticode `NotSigned`。
- 生产 ASAR 共 8,154 个条目，`.map/.d.ts` 为 0，`config/settings.json` 未进入包；Direct 用户首启使用代码内安全默认值。
- packaged gate 通过；打包态 smoke 退出码 0，并输出 `ATHENA_SMOKE_READY_TO_SHOW`、`ATHENA_SMOKE_DOM_OK`。
- 受管 Python 保持 Python Software Foundation 有效签名与时间戳；候选仅含 3 个 EXE，未再携带 29 个无用 CLI 启动器。
- candidate manifest 为 `BLOCKED`；当前精确阻断是 clean checkout 未证明、生产 feed disabled，以及 installer/`Athena.exe`/`elevate.exe` 未签名。

## 阻断项

### 外部/人工输入

1. 真实发行主体、产品/商标/素材权属签字、目标销售区域、消费者/隐私/AI/税务法律复核。
2. 价格与币种、支付平台、许可证平台、处理方数据条款和服务 SLA。
3. 代码签名证书、批准 publisher DN、HTTPS 更新源、稳定官网域名与公开 EULA/隐私/支持/安全 URL。
4. 20–50 名真实受控 Beta 参与者、Windows 设备/VM、标准用户/UAC/Defender/SmartScreen 与弱网证据。
5. Product、Engineering、Security/Privacy、Legal/License、QA/Release 人工签字。

### 仍需工程完成

1. 生产许可证适配器、公钥与轮换、设备标识隐私设计、安全 entitlement 存储、激活/停用/恢复 UI 和真实平台负向测试。
2. 从干净 checkout 生成签名候选，并完成新包打包态 smoke、签名更新、暂停、回滚和卸载/升级矩阵。
3. 关闭或从 1.0 build/UI 排除 ATH-VOICE-001、ATH-WEB-001、ATH-CONFIG-001、ATH-ARCH-001 涉及的未达标可见能力。
4. live 搜索、live LLM、live tools 的隔离环境证据，以及长会话、磁盘/内存、断网/磁盘满/数据库锁、无障碍、中文编码和时区边界。
5. secrets 扫描、Defender/多引擎扫描、Python/离线包最终锁定、发布密钥轮换/恢复和正式截图/视频/更新说明。

## 转为 Go 的最低条件

只有当 Universal 63 项与 Desktop 9 项中的所有必需项均为 `[x]` 或有明确且经签字的 N/A、ATH-REL-001/ATH-DESKTOP-001/ATH-DESKTOP-002 关闭、候选 manifest 为 `distributionAllowed=true`、最新签名候选通过打包态 smoke 和真实安装/更新/回滚矩阵，并完成五角色签字后，Desktop 1.0 才能判定 **Go**。
