# 两端同步开关与会话边界 · 2026-09-30

本轮结论：手机端真机控件验收、桌面端同步竞态专项、桌面真实 staging 链路通过。
范围仍是工程 staging，不是生产、签名 release 或完整两台客户端互通的发布证明。

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

继续验证进程重启，以及桌面和手机同一账号的真实往返。
本轮桌面源码修改尚未取得重新打包后的独立运行证据；此前包验收不能替代本次新代码的包证明。
