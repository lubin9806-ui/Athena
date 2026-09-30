# 两端同步开关与会话边界 · 2026-09-30

本轮结论：手机端真机控件验收、桌面端同步竞态专项、桌面真实 staging 链路、两端真实往返及手机 force-stop 恢复通过。
范围仍是工程 staging，不是生产、签名 release、干净设备安装或完整后台恢复的发布证明。

## Android

仓库 `G:\AthenaCompanion`，提交 `5e1efa2`；先前干净 5G 验收归档提交 `057f50e`。

- OPPO PKT110，系统报告 Android 17/API 37，默认蜂窝 NR/5G；Wi-Fi 关闭。
- 实际 AccountScreen 控件：注册、首次登录选择、7 类独立开关、显式版本选择、退出、重新登录、两步删除和保留本机数据。
- 注入客户端 IOException 后账号会话、本机对话、人格名、成年状态和背景保留；解除注入后重试通过。
- 未选类别没有上传，账号登录/同步没有改变电脑连接。
- Android JVM 189/189，协议检查 2/2；4 项新增迟到响应检查覆盖关闭总开关/单类开关、迟到副本与待决冲突。
- 加入开关竞态修复后真实 instrumentation：`OK (1 test)`，79.049 秒。
- 每次随机测试账号都有独立网络栈的兜底清理；本轮账号均删除并加密擦除。

原始结果、截图与复现位于 `G:\AthenaCompanion\acceptance\2026-09-30-oppo-5g-staging`。
使用 Compose 测试宿主 Activity，不将此描述为完整 MainActivity 导航验收。
故障注入不等于运营商真实断网，也不等于进程重启或后台恢复验证。

## Desktop：真实 Electron 的确定性竞态

运行 `npm.cmd run test:cloud-sync-boundaries`。使用实际设置存储、Windows safeStorage、
CloudAccountService；仅 HTTP 换为可暂停响应的 loopback fixture。所有本机路径使用独立临时目录。

```text
PASS master-off-during-pull
PASS category-off-during-pull
PASS off-on-does-not-revive-old-work
PASS privacy-consent-revoked-during-pull
PASS logout-during-pull-does-not-resurrect-session
PASS master-off-during-push-stops-later-writes
PASS late-account-refresh-keeps-logout
PASS failed-upload-is-not-reported-successful
PASS logout-and-manual-login-keep-sync-off
ATHENA_DESKTOP_SYNC_BOUNDARIES_OK cases=10 encryptedSession=real localData=isolated network=loopback
```

第 10 项是正常同步的正向回归。修复前第一项会继续处理并成功返回，没有拒绝迟到同步；
新增测试先在原代码上失败，再由修复后代码通过。

修复包含：

1. 保存同步策略时递增本机 revision；即使「关闭再打开」最终值相同，旧任务也不能复活。
2. 拉取的每页前后、每次上传前后检查策略、隐私同意与账号会话。
3. 退出/删除/新登录使旧会话操作失效；迟到的状态刷新或 token 回调不能重建旧会话。
4. 退出持久化关闭同步；登录和注册本身不打开同步。
5. 上传失败不再吞掉错误；只有整轮成功才推进「最后同步」时间。

已经发出的请求无法撤回。测试允许已经发出的那次 PUT 完成，但断言之后不再上传下一项。
该检测不承诺撤销服务器已收到的请求，也不声称外部直接编辑设置文件能被进程 revision 完整追踪。

## Desktop：真实 staging

运行 `npm.cmd run test:cloud-staging:live`，只使用自建随机账号与隔离本机目录。

```text
ATHENA_ACCOUNT_RUNTIME_OK endpoint=https://staging-api.elanastra.com backgroundBytes=304 dimensions=2x2 adultMode=true firstLogin=blocked conflict=explicit logout=local-preserved deviceRevoke=verified cleanup=cryptographic-erase
```

类型检查、原 cloud-sync 协议/映射检查和 CI workflow 检查通过。
专项确定性检查已接入 Windows 的 Electron-backed CI，普通 CI 不访问真实 staging 或真实账号。
CI 配置本地通过不等于远端 CI 已运行。

## 后续证据

追加的两项并发检查已经通过：

```text
PASS overlapping-status-sync-share-single-refresh
PASS queued-sync-is-serialized-and-withdrawn
ATHENA_DESKTOP_SYNC_BOUNDARIES_OK cases=12 encryptedSession=real localData=isolated network=loopback
```

修复前，同时过期的状态查询与同步会重复使用一次性 refresh token，结束有效会话。
现在同一会话共用协议客户端，刷新过程 single-flight；迟到的旧 401 直接使用已经更新的 access token。
同步轮次串行，队列等待期间改变选择的旧任务不会再发送请求。
状态刷新保存最新的同步元数据，不把旧的导入映射覆盖回去。

Android 会话追加提交 `a2f45a5`：195 项 JVM 检查通过，包括 6 项新增的刷新并发、迟到登录和服务地址绑定检查。
同一 OPPO 5G 上，账号链路与真实控件流程合并复跑 `OK (2 tests)`，37.118 秒。
该版本 APK SHA-256：`BE0E4B24C11078E3B3971E580B872503725C3329DD5E8742D4E7546755A8E469`。

## 更新后桌面包：部分通过，线上账号验收失败已定位

重新打包的桌面代码为 `70a60cb`，版本 `0.9.7-beta.1`，嵌入 staging 账号服务地址。
使用 Athena 打包验收流程，先通过 typecheck 与源码 ready-to-show / DOM 检查，
再构建安装包、检查最终 app.asar 和运行包内启动检查。

```text
ATHENA_DESKTOP_BUILD_OK signed=false
ATHENA_DESKTOP_PACKAGE_OK version=0.9.7-beta.1 settings=excluded modelConfig=excluded personas=public-default memory=empty live2d=disabled account=official-https maps=0
ATHENA_PACKAGED_SMOKE_OK markers=ready-to-show,dom
```

- 安装包：`release/Athena Setup 0.9.7-beta.1.exe`，400097919 字节，SHA-256
  `8A740F49E005CE14E6729E888D3990AEF5ACBACB5DBBBE32B99C18D8D353919B`。
- 未打包目录主程序：`release/win-unpacked/Athena.exe`，232771584 字节，SHA-256
  `32F911720D89823F14B66E26BEC48121A60C56C5D9EDADC3803E3880105ACB9F`。
- `app.asar` 为 133385956 字节、4474 个条目；用户设置、密钥配置、私人数据、私人角色和禁用的 Live2D 不进入包。
- 未签名，工作区也不是干净 checkout，生产更新源禁用。此产物只作工程内测，不是生产发行或干净设备安装证明。

`test:packaged-cloud-staging:live` 确认从 app.asar 和 packaged-resource staging 地址启动，
但在退出后的设备撤销断言失败。本机已退出，服务端设备仍未变为 revoked。
该失败尝试的随机账号成功加密擦除，隔离本机 profile 删除；不将它描述为包内账号验收通过。

## 服务端限流修复：待上线复验

修复提交 `88e800b` 已推送 `origin/codex/ci-green-0.9.7`。
原实现对普通 API（120 次/分钟）与认证 API（10 次/分钟）使用相同 IP 计数器。
因此十余次正常账号/同步读取也能让一次正常退出返回 429；客户端仍可清除本机会话，
但远端设备没有完成撤销。

新增三个 HTTP 回归在旧实现全部失败，固定同一分钟后稳定复现；修复后全部通过：

1. 12 次正常账号读取后，退出返回 204，设备 revoked，旧凭据返回 401。
2. 认证请求仍受独立上限约束，认证请求超额不消耗普通 API 预算。
3. 普通 API 仍受独立上限约束，普通请求超额不消耗认证预算。

只拆分认证和普通 API 的 IP bucket，不提高限额，不信任客户端转发头，不改变套餐、密钥或数据库。
完整 Cloud 测试 46/46，`ATHENA_CLOUD_1_0_ENGINEERING_OK tests=46`，Render 配置验证通过。
Render 配置为手动部署；本轮浏览器控制连续超时，没有成功触发部署。
在新提交实际上线且重新通过包内账号验收之前，线上修复状态仍为待验证。

## 两端真实往返与进程恢复：实际通过

协调脚本：`docs/cloud/verify-cross-device-staging.cjs`。
Android 端：`CrossDeviceStagingAcceptanceTest`，测试代码提交 `26c79ea`，已编译并安装测试 APK。

脚本先检查 USB 真机、debug 应用与测试 APK，再创建一个自己的随机 staging 账号。
桌面使用真实 Electron、Windows safeStorage、CloudAccountService 与隔离 profile；
手机使用 MainActivity 的实际 ViewModel、Android Keystore 与加密本机存储。
仅通过 USB 下发临时随机测试凭据，所有账号/同步请求仍走 HTTPS，不代理手机 5G。

实际检查桌面暖色背景/成年开 → 手机显式选择 → 手机绿色背景/成年关 → 桌面显式选择 →
桌面蓝色背景/成年开 → force-stop 手机 → 从本机加密存储恢复 → 显式选择账号版本。
非所选的对话和人格名称使用本机 sentinel；最终云端只允许背景与成年模式两个资源，
检查图片接收不反向产生无意的 re-encode 上传。各路径有账号加密擦除与临时凭据清理。

首次启动时 USB 设备为 0，脚本在创建账号前被预条件阻止，自己的空隔离 profile 已清理。
用户重新连接手机后，确认 PKT110、Wi-Fi 关闭、飞行模式关闭和 MOBILE[NR]，
安装最新测试 APK 并完成实际往返。协调脚本也加入这四项网络/设备前置断言。

```text
ATHENA_CROSS_DESKTOP_PUBLISH_OK firstLogin=explicit categories=background-adult-only
ATHENA_CROSS_PHONE_PUBLISH_OK desktopToPhone=verified phoneToCloud=verified firstLogin=explicit conflict=explicit local=preserved
ATHENA_CROSS_DESKTOP_RECEIVE_OK phoneToDesktop=verified conflict=explicit local=preserved imageEcho=absent
ATHENA_CROSS_PHONE_RESTORE_OK session=keystore-restored local=encrypted-restored conflict=explicit desktopToPhone=verified pairing=unchanged
ATHENA_CROSS_DEVICE_STAGING_OK desktop=Electron phone=OPPO-5G roundTrip=verified restart=force-stop-restored background=verified adultMode=verified categories=independent
ATHENA_CROSS_ACCOUNT_CLEANUP_OK account=deleted cryptographicErase=true
ATHENA_CROSS_PROFILE_CLEANUP_OK credentials=removed profile=removed
```

手机 publish、restore、cleanup 三阶段各为 `OK (1 test)`，耗时分别 8.842、5.155、0.02 秒。
ADB force-stop 后 pidof 为空，随后启动真实 MainActivity；启动前读取 Keystore 会话与加密本机副本，
启动后仍需显式处理两项账号版本冲突。测试 debug 状态重置并 force-stop，临时凭据文件删除，
随机账号加密擦除、桌面隔离 profile 删除。仅归档脱敏标记，不归档密码、序列号或完整手机日志。
此项使用源码编译的 Electron 服务，不冒充包内往返；证明手机强制终止后的恢复，
不泛化为系统回收、后台调度或桌面进程重启。

复现：

```powershell
cd G:\Athena
npm.cmd run typecheck
.\node_modules\.bin\tsc.cmd
.\node_modules\.bin\electron.cmd docs/cloud/verify-cross-device-staging.cjs --staging --reset-debug-test-state
```

执行前确认测试 debug 应用中没有需要保留的数据。上述 tsc 命令编译 dist，typecheck 单独不输出 JavaScript。
debug 主 APK 仍为上述 BE0E4B24... 版本；新增手机代码只属于 androidTest 测试包。
