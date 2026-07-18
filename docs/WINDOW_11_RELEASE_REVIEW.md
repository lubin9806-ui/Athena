# 窗口 11：总发布与运营独立复审

> 责任项：ATH-OPS-001。首次复审：2026-07-16；刷新日期：2026-07-18（Asia/Shanghai）。复审对象：窗口 03–10 当前 `main`、工作树和本机产物。本文不继承任何文档中的 `Closed`；只有本轮可重复命令、当前构建/平台证据和外部回执可以用于结论。

## 1. 总结论

| 平台 | 结论 | 硬阻断 |
|---|---|---|
| Desktop Direct | **NO-GO** | ATH-SEC-003、ATH-PRIV-001、ATH-REL-001 P0；发行配置漂移为 Execute=`full` 且部分联网同意=true；installer/EXE 均 unsigned；生产许可/主体/公开渠道和真实安装矩阵缺失 |
| Steam | **NO-GO** | ATH-STEAM-001 P0；无 Steamworks 账号证据、AppID/DepotID、签名 Steam candidate、私有分支/owned-account/Valve review；截图不是 Steam near-final build 证据 |
| Cloud | **NO-GO** | ATH-CLOUD-001 P0；仅 local fixture；无生产 provider/区域/KMS/TLS/计费/外部渗透/真实 RPO-RTO；无 on-call 和公共状态页 |
| iOS | **NO-GO** | ATH-MOBILE-001 P0 且 Cloud 前置 No-Go；无 iOS 工程、Bundle ID、Apple 团队/证书/TestFlight/App Review、隐私表单和商店材料 |
| Android | **NO-GO** | ATH-MOBILE-001 P0 且 Cloud 前置 No-Go；无 Android 工程、package ID、Play 账号/签名/AAB/track review、Data safety 和商店材料 |

五个平台均命中用户指定的强制 No-Go 条件。刷新后未关闭 P0 为 6 个：ATH-SEC-003、ATH-PRIV-001、ATH-REL-001、ATH-STEAM-001、ATH-CLOUD-001、ATH-MOBILE-001。当前不得收费、公开下载、上传 Steam、部署 Cloud 生产、提交 App Store 或 Google Play，也不得把本地工程验证写成平台批准。

## 2. 审计快照

- 刷新基线 HEAD：`40336f3`（`feat(steam): establish window 08 engineering slice`）；窗口 03、04、05、06、07、08、09 的独立实现提交均已进入当前 `main`。
- 窗口 11 刷新时 `git status --porcelain=v1` 有 18 条；其中包含窗口 11 运营/复审文件和待隔离的本机发行配置/运行态改动。提交窗口 11 后仍必须从 clean checkout 构建签名候选。
- Node `v24.18.0`，npm `11.16.0`，Electron `42.7.0`，electron-builder `26.15.3`。
- 仓库和当前环境未发现已配置 Windows CSC、Steam AppID/DepotID、Apple Team 或 Google Play service-account 证据；检查只记录存在性，不读取或输出秘密。
- `config/operations.json` 的真实负责人、值班、支持/安全/隐私入口、状态页 provider/URL 全为 `null`。流程已经定义，但运营能力未配备。

## 3. 窗口 03–10 独立复核

| 窗口 | 责任项 | 本轮新鲜证据 | 独立判断 |
|---|---|---|---|
| 03 | ATH-PRIV-001 / ATH-DATA-001 | 数据生命周期实现仍在，但 2026-07-18 `test:privacy` 首次默认断言失败：受跟踪发行配置的联网同意为 true | **ATH-PRIV-001 重开为 In Progress**；ATH-DATA-001 的保留/导出/清除/备份实现未发现新回归 |
| 04 | ATH-LEGAL-001 | `test:supply-chain` → `ATHENA_SUPPLY_CHAIN_OK packages=80`；manifest 已刷新并与当前 unsigned installer/EXE 的大小与哈希一致 | **源码/依赖清单范围复现**；真实签名、Ollama 再分发和人工权属签字仍是发布门 |
| 05 | ATH-VOICE-001 / ATH-WEB-001 / ATH-CONFIG-001 | `test:web-search`、`ATHENA_WINDOW05_ARCH_OK` 通过；切回 Node ABI 后 `ATHENA_WINDOW05_RELIABILITY_OK longMessages=1500` | 三项 Closed 的工程证据可复现；Node/Electron native ABI 必须按测试运行时重建，不得混用 |
| 06 | ATH-REL-001 / ATH-DESKTOP-001 | `test:release` → migration backup/rollback verified；开发 smoke 有 READY/DOM 标记；根依赖 audit 为 0 high | **Blocked 保持正确**。当前 installer 已能完整生成但未签名；真实 certificate/publisher/feed/clean CI/安装矩阵和 20–50 人 Beta 不存在 |
| 07 | ATH-DESKTOP-002 / ATH-PRODUCT-001 | `test:commercial` → `productionBlockers=13`；宣传源稿扫描通过 | 产品声明边界的 Closed 可复现；商业发布仍 Blocked。真实主体、价格、支付/许可证、公钥、公开入口、生产 UI 和签字缺失 |
| 08 | ATH-STEAM-001 | `test:steam` → 工程边界、裁剪、Cloud 冲突/删除和源素材检查通过；同时明确输出 `engineering-only`、`no real Steam candidate supplied` | **Blocked / P0**。无外部账号、ID、签名候选和 Valve 回执；不得提升为 Go |
| 09 | ATH-CLOUD-001 | 13 个 Cloud 测试通过；`ATHENA_CLOUD_DRILL_OK`；`ATHENA_CLOUD_1_0_ENGINEERING_OK ... production=no-go`；Cloud audit 0 | **Blocked / P0**。测试只证明 local fixture 与独立边界，生产 provider、基础设施、安全审计、值班和状态页均缺失 |
| 10 | ATH-MOBILE-001 | 文件扫描未发现 iOS/Android/mobile 工程或商店材料 | **Blocked / P0**。没有可以执行的安装、升级、签名、隐私、备份恢复或商店测试；“无证据”不能写成 Not Applicable |

## 4. Desktop Direct 构建、安装、升级与恢复复核

### 4.1 通过

- `npm.cmd run typecheck`。
- `test:release`、`test:desktop-faults`、`test:commercial`、`test:steam`、`test:web-search`、窗口 05 architecture/reliability、`test:operations`。
- `npm.cmd run audit:security` → `found 0 vulnerabilities`。
- `npm.cmd run smoke:electron` 输出 `ATHENA_SMOKE_READY_TO_SHOW`、`ATHENA_SMOKE_DOM_OK`。
- 当前 installer：158,385,341 bytes，SHA-256 `7D486394F947FF36AE905DFFD9F095987B66B7C3C835D1814635F80936BF6845`，Authenticode `NotSigned`。
- 当前 unpacked EXE：232,771,072 bytes，SHA-256 `337540574E02AECDF804417DB48C2A87A682405BD3347EFCA29B617730DC94E1`，Authenticode `NotSigned`。

### 4.2 失败或缺失

- `test:security` 实际失败：`config/settings.json.tools.permissionLevel` 为 `full`，而发行门要求 `off`；ATH-SEC-003 已重开。
- `test:privacy` 实际失败：首次默认 `webSearch` consent 为 true，而发行门要求 false；同时 `externalToolNetwork` 也已漂移为 true；ATH-PRIV-001 已重开。
- Windows CSC、批准 publisher DN、HTTPS update base URL 和证书私钥环境均缺失；证书存储中也未找到可用的 Code Signing 私钥证书。
- 当前 installer 虽为完整大小，但 installer 与 EXE 均 `NotSigned`，不得分发给 Private Beta 参与者或写成 `distributionAllowed=true`。
- 因无签名候选，本轮不能执行首次安装、覆盖升级、跨版本升级、UAC/标准用户、卸载/保留数据、重装或回滚矩阵。旧 unsigned installer 不能替代签名候选证据。
- 迁移备份/注入失败恢复通过的是自动化 fixture，不等于真实签名 installer 的升级/降级数据恢复演练。

## 5. 宣传截图与实际构建

使用当前 `win-unpacked` 构建，以 1920×1080 窗口分别重捕 companion/create/reason、day/night 五个状态。五次进程退出均为 0，输出位于忽略目录 `.build/window11-screenshots/`。

| 文件 | 候选 / 新捕获尺寸 | SHA 完全一致 | RGB MAE / RMS | 结论 |
|---|---|---|---:|---|
| 01-companion-night.png | 1924×1083 / 1924×1083 | 否 | 0.062 / 0.356 | 非同一产物 |
| 02-companion-day.png | 1924×1083 / 1924×1083 | 否 | 0.502 / 7.717 | 新捕获出现未绘制/透明矩形，启动状态也不同 |
| 03-create-night.png | 1924×1083 / 1924×1083 | 否 | 0.669 / 9.785 | 新捕获出现大面积未绘制/透明矩形，不能作为商店图 |
| 04-reason-day.png | 1924×1083 / 1924×1083 | 否 | 0.073 / 0.451 | 非同一产物 |
| 05-create-day.png | 1924×1083 / 1924×1083 | 否 | 0.504 / 7.757 | 新捕获不可重复候选像素/状态 |

结论：候选图整体设计与当前 Desktop UI 同源，但不能重复得到同一可见结果，且本轮捕获存在不可提交的透明/未绘制区域。更重要的是，它们不是真实 AppID 私有分支中的签名 Steam near-final build。Steam 截图门为 **Fail**；必须在最终 Steam candidate 上重新捕获、逐图人工复核隐私与裁剪能力，再替换源图。

## 6. 安全、隐私、许可与备份恢复总门

- 安全：根/Cloud npm audit 均为 0 high；Desktop 发行配置默认权限回归使 `test:security` 失败。仍缺签名、secrets scanner 归档、Defender/SmartScreen clean-machine、外部 Cloud penetration/container/image scan 和移动平台安全测试。
- 隐私：Desktop 数据生命周期实现仍在，但发行配置默认同意回归使 `test:privacy` 失败；Cloud local export/delete/deny-restore ledger 通过。仍缺公开政策 URL、生产处理方/区域/法定留存、移动 App Privacy/Data safety 与分布式删除证明。
- 许可：依赖 notices/SBOM 可重复；Ollama 再分发、人类素材/商标签字、真实 EULA 主体、销售区域复核和当前候选 manifest 仍未完成。
- 备份恢复：Desktop migration fixture 和 Cloud local encrypted restore/chaos drill 通过；真实 installer 升降级、生产不可变跨账号备份、真实 RPO/RTO/区域故障和 Mobile 多设备冲突恢复未证明。

## 7. 商店与外部账号清单

| 门 | Desktop Direct | Steam | Cloud | iOS | Android |
|---|---|---|---|---|---|
| 外部账号/主体 | 缺发行主体/支付/许可 provider | 缺 Steamworks partner/AppID/DepotID | 缺云、模型、计费、KMS provider | 缺 Apple Developer/App Store Connect | 缺 Play Console |
| 签名/密钥 | Windows CSC/批准 publisher 缺失 | 签名 Steam EXE/SteamPipe manifest 缺失 | 生产 TLS/KMS/IAM 缺失 | Team/Distribution cert/profile 缺失 | upload/app-signing key 与 service account 缺失 |
| 商店/公开材料 | 源稿有，真实 URL/截图/价格缺失 | 源稿/素材有，未上传/审核，截图门失败 | 状态页/支持/隐私 URL 缺失 | 全部缺失 | 全部缺失 |
| 安装/升级 | unsigned installer 存在，签名矩阵未跑 | 无 depot/private branch | 无生产 deploy/rollback | 无 IPA/TestFlight | 无 AAB/internal track |
| 外部审核 | 无签字 | 无 Valve Store/build review | 无独立 pen test/运营签字 | 无 App Review | 无 Play review |

## 8. ATH-OPS-001 处置

本窗口已建立：责任链、支持时限、事故等级、状态页模板、停更/撤包/热修/通知/复盘流程、版本停止支持和数据迁移政策；并增加机器门禁 `npm.cmd run test:operations`。

ATH-OPS-001 状态改为 **Blocked，不是 Closed**。关闭条件：

1. `operations.json` 中真实 Release Commander、Security/Privacy、QA/Release、Support/Comms、各平台 Owner 与 Cloud primary/secondary on-call 全部配置并验证联系方式；
2. 公共状态页在独立故障域上线，支持/安全/隐私入口公开并完成可观测性与权限演练；
3. 至少一次 P0 tabletop + 停更/撤包/通知/恢复/复盘演练保存 UTC 时间线和平台回执；
4. 五平台各自的停止发布动作由真实账号 Owner 演练，不能只验证本地模板；
5. 发布签字链完成，且演练行动项中无开放 P0/P1。

## 9. 官方平台规则复核

- Microsoft：Smart App Control 会阻止无法判定安全的 unsigned code；发布前应覆盖 installer、uninstaller、所有功能和被加载二进制的签名测试。<https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/overview>；<https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/test-your-app-with-smart-app-control>
- Steam：Store Presence 和 build 都必须由 Valve review；页面只能写首发内容，截图必须是实际产品画面，并建议至少预留 7 个工作日。<https://partner.steamgames.com/doc/store/review_process?language=english>
- Apple：iOS 需要与 Xcode 一致的 Bundle ID 和 Privacy Policy URL；App Privacy 必须包含第三方 SDK 行为，支持账号创建时须在应用内提供删除。<https://developer.apple.com/help/app-store-connect/reference/app-information/app-information>；<https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy>；<https://developer.apple.com/app-store/review/guidelines/>
- Google Play：所有发布应用都必须完成准确的 Data safety 和公开隐私政策；创建账号的应用还需应用内与外部删除路径；Android artifact 必须签名。<https://support.google.com/googleplay/android-developer/answer/10787469?hl=en>；<https://support.google.com/googleplay/android-developer/answer/17105854>；<https://support.google.com/googleplay/android-developer/answer/9859152?hl=en>

## 10. 可重复命令

```powershell
npm.cmd run typecheck
npm.cmd run test:security
npm.cmd run test:privacy
npm.cmd run test:supply-chain
npm.cmd run test:release
npm.cmd run test:desktop-faults
npm.cmd run test:commercial
npm.cmd run test:steam
npm.cmd run test:web-search
npm.cmd run test:tools
npm.cmd run audit:security
npm.cmd run smoke:electron
npm.cmd run build
npm.cmd run test:operations

Push-Location cloud
npm.cmd test
npm.cmd run drill
npm.cmd run verify
npm.cmd audit --audit-level=high --registry=https://registry.npmjs.org/
Pop-Location
```

`test:operations` 成功表示“门禁正确识别当前 No-Go”，不是发布成功。只有显式 `node scripts/verify-operations-readiness.js --require-go` 返回 0，且对应外部回执归档，才允许进入最终人工签字。
