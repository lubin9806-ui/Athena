# Desktop Signed Private Beta 状态

> 阶段启动：2026-07-18（Asia/Shanghai）。入口提交：`908261e feat(ops): complete window 11 release review`。权威问题状态仍以 `ISSUE_REGISTER.md` 为准。

## 当前结论

**阶段已启动，但签名候选构建仍为 Blocked / No-Go。** 本机没有可用代码签名证书/私钥，未配置批准 publisher DN，也未配置 HTTPS update feed。现有 installer 和 EXE 都是 `NotSigned`，不得交付 Private Beta 参与者。

2026-07-18 的未签名工程构建验证了新候选门：manifest 自动枚举 `win-unpacked/Athena.exe` 和 `win-unpacked/resources/elevate.exe`，验收器同时拒绝未签名 installer、两个未签名执行文件和 dirty source，并以退出码 2 结束。该构建只作为 fail-closed 证据，不是可分发候选。

## 已关闭的本地前置

- 窗口 11 捕获的发行配置漂移已处理：Execute/全局工具权限默认 Off；webSearch/externalToolNetwork consent 默认 false。
- smoke 对“未同意时搜索按钮禁用”的状态进行验证，不再通过强行点击绕过 consent UI。
- `test:security` → `SECURITY_BASELINE_OK`。
- `test:privacy` → `ATHENA_PRIVACY_DATA_OK`。
- `test:release` → `ATHENA_RELEASE_ENGINEERING_OK ... migrationBackup=verified rollback=verified`。
- `smoke:electron` → `ATHENA_SMOKE_READY_TO_SHOW`、`ATHENA_SMOKE_DOM_OK`。
- 发布脚本会解析批准的 Git 可执行文件；Git 不可用时 `cleanCheckout=false`，不再回退成假 clean。
- `npm.cmd run release:preflight` 会一次性检查精确 Git 身份、干净 checkout、签名材料、publisher DN 和 HTTPS feed，且只输出存在性，不输出秘密。
- `npm.cmd run test:private-beta` 验证候选门会检查哈希、完整签名、时间戳和发布者，并对篡改与未完成 Beta 保持 fail-closed。
- CI 在签名构建前执行 preflight，生成 manifest 后执行 `release:verify-candidate`；操作顺序见 `PRIVATE_BETA_EXECUTION.md`。

## 当前外部阻断

| 输入 | 当前 | 必需条件 |
|---|---|---|
| Code signing certificate/private key | Missing | 受控 RSA Authenticode 证书；CI secret 或受保护签名服务 |
| `CSC_LINK` / `CSC_KEY_PASSWORD` | Missing | 不入仓库；仅注入受控构建环境 |
| `ATHENA_SIGNING_PUBLISHER` | Missing | 与证书 Subject、官网和 installer 显示一致的批准 DN |
| `ATHENA_UPDATE_BASE_URL` | Missing | 受控 HTTPS origin，提供 beta channel metadata/artifacts |
| 真实 Beta 环境/参与者 | 0/20–50 | 签名候选后执行安装/升级/卸载/UAC/Defender/标准用户/弱网矩阵 |

## 签名输入到位后的唯一入口

```powershell
npm.cmd run release:preflight
npm.cmd run build:release -- --require-clean
& '.\release\win-unpacked\Athena.exe' --smoke-test
npm.cmd run release:manifest
```

只有 preflight 返回 0、installer/EXE/uninstaller/helper 的 Authenticode 为 `Valid` 且有时间戳、candidate manifest 为 `distributionAllowed=true`，才允许进入安装矩阵和 20–50 人邀请测试。任何 unsigned、本地自签或工作树脏构建只能保留为工程证据。
