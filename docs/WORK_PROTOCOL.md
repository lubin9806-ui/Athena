# Athena 商业化工作协议

> 生效日期：2026-07-15  
> 目的：让窗口 01–11 使用同一事实源、问题编号、证据标准和交接门，避免重复开发与范围漂移。

## 1. 唯一事实源

文档优先级如下：

1. `ISSUE_REGISTER.md`：问题状态、负责人和验收事实。
2. `COMMERCIAL_ROADMAP.md`：商业阶段和平台总边界。
3. `PRODUCT_MATRIX.md`：每个平台包含/排除的能力。
4. `RELEASE_CHECKLIST.md`：构建和发布 Go/No-Go 门。
5. `architecture.md` 及专题设计文档：实现细节。

发生冲突时，不静默修改多个结论。先在问题台账建立编号，再由负责窗口同时更新所有受影响的基线文档。

## 2. 窗口责任边界

| 窗口 | 唯一责任 | 不得提前做的内容 |
|---|---|---|
| 01 商业总审计 | 仓库可用性、事实盘点、文档、问题编号、构建/启动基线 | 02–11 的产品和安全功能 |
| 02 运行时安全 | 受支持依赖、Electron 安全、Execute 默认权限与高危确认 | 隐私产品功能、商店集成 |
| 03 隐私与数据 | 数据地图、同意、保留、导出、清除、加密决策 | Steam/Mobile/Cloud 实现 |
| 04 许可与供应链 | SBOM、第三方许可、模型/素材来源、精确发行 manifest | 新产品能力 |
| 05 可靠性与真实性 | 语音/搜索降级、提醒持久化、设置真实性、故障 UX | 商业支付或跨平台 |
| 06 Desktop Beta | 签名、更新/回滚、CI、安装升级矩阵、受控 Beta | Steam/Mobile/Cloud |
| 07 Desktop 1.0 | 直售 SKU、授权/支持/退款、Desktop 发布签字 | 其他平台实现 |
| 08 Steam | Steamworks、Depot、所有权、Cloud 白名单、审核材料 | Mobile/Cloud 后端 |
| 09 Cloud | 认证、租户隔离、同步、模型网关、计费、SLO | Mobile UI |
| 10 Mobile | iOS/Android Companion、商店内购、移动隐私与审核 | Desktop/Steam 重构 |
| 11 总发布 | 跨平台发布编排、运营、事件响应、最终复盘 | 未经台账批准的新功能 |

一个问题只能有一个“负责窗口”。其他窗口可被列为依赖，但不得同时宣称负责，避免无人真正关闭。

## 3. 严重级别

| 级别 | 含义 | 处理规则 |
|---|---|---|
| Blocker | 阻止下一窗口安全接手的仓库、事实源或验证链问题 | 当前窗口结束前必须为零 |
| P0 | 阻止对应商业版本发布的安全、隐私、法律或商店问题 | 对应版本 Go 前必须为零 |
| P1 | 阻止公开 Beta 或高概率造成数据/口碑损失 | 对应 Beta 前必须为零 |
| P2 | 有绕行方案但限制体验、规模或效率 | 必须排期，不阻止当前接手 |
| P3 | 优化或远期愿景 | 不得包装成当前承诺 |

Blocker 与 P0 不同：Blocker 衡量“下一个窗口能否开始”，P0 衡量“商业版本能否发布”。因此窗口 01 可以在 P0 仍开放时放行窗口 02，但不能留下 Blocker。

## 4. 问题生命周期

状态只允许：`Open`、`In Progress`、`Blocked`、`Closed`、`Accepted Risk`。

- Open：有证据和验收条件，尚未开始。
- In Progress：负责窗口已开始，并在本轮工作范围内。
- Blocked：缺少外部权限、证书、账号或决定；必须写明阻断物。
- Closed：验收条件全部满足且证据已落盘/可复现。
- Accepted Risk：仅 P2/P3 可用，必须有接受人、日期和到期时间；Blocker/P0/P1 不得口头接受。

关闭问题时必须同时记录：实际改动、验证命令、关键输出、残余风险。仅写“已修复”无效。

## 5. Git 与文件安全协议

- 不删除来源不明文件、用户数据、模型、发布物或疑似历史。
- `.git` 异常时先检查 objects、refs、HEAD、config 和对象数量；存在任何内容就停止并保全，不得 `git init` 覆盖。
- 禁止 `git reset --hard`、强制 checkout、清理未跟踪文件和改写历史，除非用户明确授权。
- 生成物可移动到 `legacy/root-artifacts`，但必须记录原路径、大小和 SHA-256。
- 每个窗口只提交自身范围的文件；不吸收其他窗口或用户的未完成改动。
- 构建不得依赖未记录的个人目录内容；本地模型和安装器只通过精确 manifest 进入发行流程。

## 6. 证据协议

证据优先级：

1. 可重复命令及退出码。
2. 自动化测试的稳定标记。
3. 打包态烟测和产物哈希。
4. 源码路径/行号。
5. 截图或人工观察。

构建成功不等于启动成功；开发态启动成功不等于打包态成功。桌面基线至少需要：

```powershell
npm.cmd run typecheck
npm.cmd run audit:security
npm.cmd run test:persona
npm.cmd run test:modes
npm.cmd run test:theme
npm.cmd run test:logger
npm.cmd run test:web-search
npm.cmd run test:tools
npm.cmd run smoke:electron
npm.cmd run build
& '.\release\win-unpacked\Athena.exe' --smoke-test
```

依赖审计发现漏洞时非零退出是有效证据，不是“审计不可用”。只有无法访问 advisory endpoint、命令不存在或输出不可解析才算审计链故障。

## 7. 交接协议

窗口结束必须交付：

1. 本窗口关闭/新增的问题编号。
2. 改动文件列表。
3. 验证命令和关键输出。
4. 仍开放的 P0/P1 及其负责窗口。
5. 下一窗口可直接复制的准确输入。

放行条件：`ISSUE_REGISTER.md` 中 `Severity = Blocker` 且 `Status != Closed` 的数量为 0，并且本窗口要求的构建/启动证据通过。

## 8. 范围变更协议

若实现中发现必须跨窗口修改：

1. 先停止扩张。
2. 新建问题编号，写明证据和依赖。
3. 只做防止数据损坏或让验证链恢复的最小改动。
4. 将完整实现交给原定负责窗口。

不得以“顺手”“未来会用”或“已经打开这个文件”为理由提前实现窗口 02–11 的功能。

