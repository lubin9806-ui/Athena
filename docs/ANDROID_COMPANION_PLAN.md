# Athena Android Companion 开发计划

> 窗口 10 / ATH-MOBILE-001
> 基线日期：2026-09-02（Asia/Shanghai）
> 仓库：`G:\Athena`
> 文档角色：Android 专项 ADR 与分阶段开发计划。它解释“按现有商业基线如何做安卓”，**不**把 Mobile、Cloud 或商店提交改写成已放行。

当前判定：**规划 GO / 隔离开发条件满足 / 商店与公开发行 NO-GO**。

| 范围 | 结论 | 原因 |
|---|---|---|
| 写出并维护本计划 | **GO** | `docs/cloud/CLOUD_GO_NO_GO.md` 允许 Mobile 使用 API v1 做隔离开发；所有者已要求按现有基线做安卓计划 |
| 对本地 Cloud fixture 做 Android 工程脚手架 | **GO（需所有者确认开工）** | Cloud 本地工程边界已通过 `ATHENA_CLOUD_1_0_ENGINEERING_OK`；客户端不得连接生产或宣称 Cloud 可用 |
| Play 内测 / 正式轨 / 收费 / 公开下载 | **NO-GO** | ATH-CLOUD-001、ATH-MOBILE-001 仍为 Blocked；无 Play Console、package ID 签字、Data safety 与生产 API |
| 把 Electron UI 包装成 APK，或直连 Desktop SQLite | **禁止** | `docs/COMMERCIAL_ROADMAP.md` Phase 5 与 `docs/PRODUCT_MATRIX.md` 的硬边界 |

ATH-MOBILE-001 保持 **Blocked**。本文件进入证据栏，不等于问题关闭。

## 1. 事实源与优先级

发生冲突时，低优先级文档不得覆盖高优先级结论：

1. `ISSUE_REGISTER.md`
2. `COMMERCIAL_ROADMAP.md`
3. `PRODUCT_MATRIX.md`
4. `RELEASE_CHECKLIST.md` 第 7 节 Mobile 专项
5. `cloud/CLOUD_GO_NO_GO.md`、`cloud/API_V1.md`、`cloud/ARCHITECTURE.md`
6. 本计划

本计划不修改 Desktop 1.0 一次性许可、Steam 裁剪或 Live2D 发行硬门。Desktop Direct 仍是无账号本地优先；Android 是**另一 SKU**：必须有账号、只走 Cloud，不继承 Desktop 许可证。

## 2. 产品定义

名称工作稿：Athena Companion（Android）。最终商店名、开发者名称和商标由发行主体签字，不在本文件冻结。

目标用户：需要随身继续 Create / Companion / Reason 对话、查看与延续已同步记忆、使用麦克风语音，并在 Play 完成订阅/恢复购买的个人用户。

核心承诺（与 `PRODUCT_MATRIX.md` Mobile 1.0 一致）：

- Create / Companion / Reason，语义与 Desktop 三种普通模式一致
- 账号登录、设备登记、会话轮换、MFA/恢复
- 云端推理：`POST /v1/model/responses`，仅 `create|companion|reason`
- 加密同步视图：`memory` / `conversation` / `preference` / `reminder`
- 麦克风授权后的语音；拒绝后仍可打字
- 通知（提醒资源落地后）
- Play 订阅收据、恢复购买、账号/数据导出与删除

明确排除（首发与后续未改矩阵前均不得实现或宣传）：

- Execute、任意本机文件、终端、程序启动、任意 HTTP/TCP 电脑工具
- 本地 Ollama / 14B / BYOK 直连第三方模型（Mobile 列是 Planned，不是 1.0 GA）
- 读取、上传或迁移 `database/athena.db`
- 桌面托盘、桌面常驻、桌宠、Live2D
- Skills / 插件市场
- 把 Desktop 一次性个人许可或 Steam 所有权当成 Mobile 权益
- 静默把本地语音失败切到在线 STT/TTS
- 在手机上复用 Desktop 的搜狗/Bing/DuckDuckGo HTML 抓取

人格：Android 不得打包 `personality/private/`。Companion 身份来自 Cloud `preference` 记录与首方默认公开卡；私有桌面人格仍只属于本机 Desktop。

## 3. 硬前置

### 3.1 发布前置（不可绕过）

`CLOUD_GO_NO_GO.md`：Cloud 1.0 生产 Go 是 Mobile 1.0 硬前置。未满足前禁止：

- 指向生产基址的客户端
- Play internal/closed/production 作为“Athena Cloud 可用”的证据
- 商店文案写跨设备同步、云推理已上线
- 关闭 ATH-MOBILE-001

### 3.2 隔离开发前置（当前已满足）

本地 Cloud 可在 loopback 启动，供 Android 模拟器/本机调试：

```powershell
cd G:\Athena\cloud
npm.cmd test
npm.cmd run verify
```

要求标记：`ATHENA_CLOUD_DRILL_OK`、`ATHENA_CLOUD_1_0_ENGINEERING_OK`。客户端配置只允许 `http://10.0.2.2:8787`（模拟器）或明确的本机/内网 fixture，生产模式必须 fail-closed。

### 3.3 Cloud API 缺口（会挡住部分 Mobile GA 行）

当前冻结的 `/v1` **没有**搜索代理、流式补全、附件、生图或电脑工具。因此：

| 产品矩阵 Mobile 1.0 行 | 当前 Cloud v1 | 计划处置 |
|---|---|---|
| Create/Companion/Reason | `POST /v1/model/responses` `{prompt,mode}` | M3 可做；fixture 回显，非真实模型 |
| 跨设备记忆同步 | `memory/conversation/preference/reminder` | M4 可做 |
| 搜索 + 来源卡片 GA（云代理） | **无对应端点** | 不得在 Android 侧抓网页；另开 Cloud 变更，经窗口 09 批准后再接 |
| 深读 Beta | 无 | 同上 |
| STT/TTS GA | 模型网关不保留语音 | 先用系统 on-device 引擎；在线适配器必须独立同意 |
| 订阅 GA | 计费端口为零收费 fixture | Play Billing 沙箱可做协议，生产收款 Blocked |
| 提醒 GA | `reminder` 资源存在 | 用同步记录 + 系统通知，不依赖 Desktop 进程内定时器 |

未先改 `PRODUCT_MATRIX.md` 和 Cloud API 兼容策略，不得把搜索/生图/Execute 塞进 Android。

## 4. 架构

```text
[Athena Companion Android]
        |  HTTPS (生产) / loopback HTTP (fixture)
        |  Bearer access token + Idempotency-Key
        v
[Cloud HTTP /v1]
  auth / devices / sync / model / entitlements / data rights
        |
        x  禁止：Electron IPC、Desktop SQLite、ComputerTools、Live2D
```

客户端分层（均在 `mobile/android/`，不进入 `src/app` 或 `src/renderer`）：

1. **Network**：OkHttp，RFC 9457 problem+json，`Athena-API-Version: 1`，未知字段忽略。
2. **Session**：access/refresh 不写明文 SharedPreferences；Android Keystore + EncryptedSharedPreferences；401 后刷新一次，失败回登录。
3. **SyncEngine**：vector clock、tombstone、409 冲突交给用户，服务端永不静默选边；客户端同样禁止静默覆盖。
4. **Conversation**：三种模式的提示词与模式切换；模式切换不授予工具权限（Mobile 无工具）。
5. **Voice**：RECORD_AUDIO 运行时权限；系统 SpeechRecognizer / TextToSpeech；拒绝后打字路径保持可用。
6. **BillingBridge**：Play Billing 5+；收据只交给未来的 Cloud billing adapter，应用内不自造 entitlement。
7. **PrivacyCenter**：导出、删除、同意开关、Data safety 对照表。

安全默认：

- `usesCleartextTraffic` 仅 debug 构建、仅 loopback/RFC1918 fixture
- 无 backup 明文 token（`android:allowBackup` 对账号材料关闭或排除）
- 证书锁定在生产 flavor，debug 不锁
- 不收集聊天正文作为崩溃日志
- 不实现 `QUERY_ALL_PACKAGES`、文件树、无障碍滥用、后台弹出

## 5. 技术选型

| 项 | 选择 | 理由 |
|---|---|---|
| 语言/UI | Kotlin + Jetpack Compose + Material 3 | 安卓先行；禁止 WebView 包一层 Electron 渲染器 |
| 最低系统 | API 29（Android 10） | Keystore、通知渠道、分区存储已稳定；不承诺更旧系统 |
| 目标/编译 | 当前稳定 compileSdk（开工时锁定，写入本文件修订） | 随 AGP 升级，不随桌面 Electron 版本 |
| 网络 | OkHttp + kotlinx.serialization | 与 Cloud 严格 JSON / exact keys 对齐 |
| 本地缓存 | SQLCipher 或 EncryptedFile 中的结构化缓存 | Mobile 不使用明文 Desktop SQLite；缓存只是同步视图 |
| 并发 | Kotlin coroutines + WorkManager | 增量同步、token 刷新、导出下载 |
| 测试 | JUnit + MockWebServer + Compose UI + fixture Cloud | 每个阶段有稳定标记，对标 Desktop 的 `ATHENA_*_OK` |
| CI | 独立 GitHub/本地 workflow，不复用 Windows Electron job | 签名、Play 上传 secret 与 Desktop CSC 分离 |
| iOS | 本计划不创建 | 可复用 OpenAPI/契约测试，不在本阶段引入 KMP |

不选 React Native / Capacitor / Electron-Android：与“不得把 Electron UI 直接包装成移动 1.0”冲突。

## 6. 仓库布局（待开工时创建）

```text
mobile/android/
  README.md                 仅本地 fixture 说明，标明 No-Go
  app/                      ApplicationId 由所有者决定后写入
  core-api/                 /v1 客户端、problem+json、幂等
  core-sync/                vector clock 与冲突
  core-session/             登录、设备、Keystore
  feature-chat/
  feature-memory/
  feature-privacy/
  feature-billing/          无生产密钥
  gradle/                   版本目录
```

约束：

- 不把 `database/`、`config/model.json`、`config/settings.json`、人格私有卡、API Key 拷进 assets
- 不把 Live2D / Cubism / 3D VRM 打进 APK
- debug 与 release 使用不同 ApplicationId 后缀或不同 signing，避免污染正式包名
- `mobile/` 加入根文档索引后，仍不得出现在 Desktop/Steam 商店文案

建议包名候选（须所有者签字，未签字前不得创建 Play 应用）：

1. `com.elanastra.athena`（与当前商业配置网站一致）
2. `com.athena.companion`

未决定前工程可用 `com.athena.companion.debug`，且不上传 Play。

## 7. 分阶段计划

阶段门用证据而不是口头完成。任何阶段都可以在 Cloud 生产仍 Blocked 时做完工程，但不能把该阶段标成商店通过。

### M0 计划与边界（本文件）

- 完成 ADR、排除清单、API 缺口、验证命令草案
- 更新 `docs/README.md` 索引；ATH-MOBILE-001 仍 Blocked
- 退出：所有者接受本计划或提出修改；**不**创建收费入口

### M1 工程骨架

- 创建 `mobile/android`，Compose 空壳，debug 连接 Cloud fixture
- 健康检查：`GET /health/live`、`/health/ready`
- 生产 flavor 拒绝非 HTTPS 与未配置的基址
- 验证：`mobile` 模块 assembleDebug；静态扫描确认无 Electron/SQLite 桌面导入
- 退出标记（建议）：`ATHENA_ANDROID_SHELL_OK`

### M2 身份与设备

- register / login / MFA setup+confirm / refresh / logout
- 设备列表与撤销
- 401→refresh→失败则清会话
- 验证：对 fixture 跑账号、错误口令、过期 refresh、撤销设备
- 退出标记：`ATHENA_ANDROID_AUTH_OK`

### M3 对话三种模式

- 聊天 UI 为手机重新布局，不缩放 Desktop 1180×760
- `POST /v1/model/responses` 带 `Idempotency-Key`
- 客户端拒绝 `execute`；Cloud 已拒绝 Execute，双层 fail-closed
- 配额耗尽、内容阻断、503 按 API 重试策略处理；无静默换 provider
- 退出标记：`ATHENA_ANDROID_CHAT_OK`

### M4 同步记忆

- 四类资源的 put/get/changes
- 冲突 UI：展示 409 双方，用户选择；禁止自动合并聊天与记忆正文
- 墓碑删除在多设备可见
- 离线队列：仅重放相同幂等键
- 退出标记：`ATHENA_ANDROID_SYNC_OK`
- 真实双机冲突恢复仍属发布门，fixture 双客户端不算生产证明

### M5 语音、通知、设置

- RECORD_AUDIO、POST_NOTIFICATIONS 按需请求；永久拒绝后有打字/静音替代
- on-device STT/TTS；缺引擎时禁用并解释
- 在线语音若未来接入，必须新同意键，且不得从本地失败自动跳转
- `reminder` → 精确/非精确闹钟策略按 Play 政策最小化
- 退出标记：`ATHENA_ANDROID_VOICE_OK`

### M6 隐私与数据权利

- 应用内隐私中心：数据地图、同意、导出、账号删除
- 调用 `POST /v1/data/exports`、`DELETE /v1/account`
- 删除后本地缓存与 token 一并清除
- 起草 Google Data safety 与真实数据流对照表（仍非商店提交）
- 退出标记：`ATHENA_ANDROID_PRIVACY_OK`

### M7 Play Billing 协议（沙箱）

- 订阅 SKU 与 Cloud entitlement 状态机映射草案
- 恢复购买、家庭共享/地区边界写成测试矩阵
- **不**在 Cloud billing adapter 仍为 `local-no-charge` 时对真实用户扣款
- 退出标记：`ATHENA_ANDROID_BILLING_SANDBOX_OK`（engineering-only）

### M8 设备矩阵与无障碍

- 手机/小折叠、动态字体、键盘遮挡、TalkBack、深色主题、电量/弱网
- 网络丢失、token 过期、同步冲突、删除传播、多设备并发
- 退出：清单行可重复；仍不是 Play review 通过

### M9 商店提交（被 ATH-CLOUD-001 阻断）

仅当 `CLOUD_GO_NO_GO.md` 改为生产 Go，且下列外部项存在时启动：

- 发行主体、Play Console、upload key、Play App Signing
- 生产 HTTPS 基址、真实模型与计费 adapter
- 公开隐私政策 URL、账号删除外部入口
- internal → closed → production
- 窗口 11 对 Android 的独立复核

在此之前，AAB 只可作为 unsigned/internal engineering artifact，不得写“已上架”。

## 8. 验证命令（开工后落地）

Desktop 现有命令保持不变。Android 增加独立脚本，例如：

```powershell
cd G:\Athena\cloud
npm.cmd test
npm.cmd run verify

cd G:\Athena\mobile\android
.\gradlew.bat :app:assembleDebug
.\gradlew.bat :app:testDebugUnitTest
node ..\..\scripts\verify-android-companion.js
```

建议稳定标记：

- `ATHENA_ANDROID_SHELL_OK`
- `ATHENA_ANDROID_AUTH_OK`
- `ATHENA_ANDROID_CHAT_OK`
- `ATHENA_ANDROID_SYNC_OK`
- `ATHENA_ANDROID_VOICE_OK`
- `ATHENA_ANDROID_PRIVACY_OK`
- `ATHENA_ANDROID_COMPANION_ENGINEERING_OK`

没有 Play 回执时，verify 脚本必须打印 `production=no-go`，对标 Cloud 的 `ATHENA_CLOUD_1_0_ENGINEERING_OK ... production=no-go`。

`docs/RELEASE_CHECKLIST.md` 第 7 节在 M9 之前保持全部 `[ ]` 或 engineering `[~]`，不得因本 ADR 勾成 `[x]`。

## 9. 外部阻断（保持 Blocked 的原因）

1. Cloud 生产 provider、区域、KMS、TLS、计费、渗透、SLO、on-call（ATH-CLOUD-001）
2. Play Console 账号、package ID 签字、upload/app-signing key
3. 公开隐私政策 URL 与法律主体
4. 真实模型条款，使 `/v1/model/responses` 不再是 local-fixture
5. 若要坚持矩阵中的 Mobile 搜索 GA：Cloud 必须先增加签约搜索代理 API
6. Android Owner 写入 `config/operations.json` 并完成窗口 11 演练（ATH-OPS-001）
7. iOS 不在本计划关闭范围内；ATH-MOBILE-001 覆盖双端商店合规，仅 Android 工程完成不能关闭该 P0

## 10. 与 Desktop 工作区的隔离

当前 `main@db4b1dc` 仍有未提交 Desktop 改动。Android 开工时：

- 只新增 `mobile/android/**`、本文件、必要脚本与索引
- 不把 Android 改动混进 Desktop 安全默认 / 生图 / smoke 提交
- 不读取、不迁移 `database/` 聊天附件
- 不修改 `RELEASE_FEATURES.live2d`
- 不把 fixture 连通写成真实用户 Beta

## 11. 开放决策（须所有者回答后才能创建正式应用）

1. ApplicationId：`com.elanastra.athena` 还是 `com.athena.companion`，或其他。
2. 是否立即开始 M1 脚手架（仅 fixture），或等 Cloud 生产 Go 后再建工程。
3. 首发是否坚持矩阵中的“搜索 GA”。若坚持，窗口 09 必须先扩 API；若否，先改产品矩阵再开发。
4. 订阅价、税区、是否提供免费额度；在 Cloud billing 未选供应商前只能做沙箱。
5. Android Owner 人名与 Play 账号持有人（可与 Desktop 发行主体相同，但必须写明）。

## 12. 下一步可直接执行

若所有者确认“可以在 fixture 上建工程”：

1. 冻结 ApplicationId（debug 可用临时 ID）
2. 创建 `mobile/android` 空模块与 `scripts/verify-android-companion.js`
3. 对接 `GET /health/*` 与 fail-closed 基址
4. 再做 M2 登录，而不是先做 UI 视觉搬运

若所有者确认“只保留计划、暂不建工程”：本文件即为窗口 10 的当前交付；等待 ATH-CLOUD-001 外部项。
