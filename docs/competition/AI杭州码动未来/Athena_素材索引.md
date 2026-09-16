# Athena 参赛素材索引

审计基线：2026 年 9 月 15 日当前仓库。

## 推荐用于项目说明书的现有素材

| 素材 | 仓库路径 | 性质 | 推荐用途 | 使用边界 |
|---|---|---|---|---|
| Athena 品牌图标 | `resources/athena-brand-icon.png` | 当前应用视觉资产 | 封面、页眉、章节页 | 对外公开前仍应确认最终品牌主文件与权利状态 |
| Athena 矢量标记 | `docs/brand/companion-prototype/assets/athena-mark.svg` | traced prototype master | 矢量封面或印刷稿 | 不是已签署的最终精修 Logo 主文件 |
| Execute 日间界面 | `docs/brand/ui-shots/execution-day.png` | 实际运行时截图 | 产品界面、执行工作区说明 | 是空状态/静态界面，不是完整任务执行证据 |
| Memory 日间界面 | `docs/brand/ui-shots/memory-day.png` | 实际运行时截图 | 本地记忆与可检查界面 | 当前截图没有真实演示数据 |
| Settings 日间界面 | `docs/brand/ui-shots/settings-day.png` | 实际运行时截图 | 权限、隐私与设置章节 | 注意截图中的 Beta 文案；不要裁掉真实状态 |
| Companion 日间界面 | `docs/brand/ui-shots/companion-day.png` | 实际运行时截图 | 项目概述或普通聊天对照 | 空状态，不能证明 Agent 执行 |
| Create 日间界面 | `docs/brand/ui-shots/create-day.png` | 实际运行时截图 | 多模式产品结构 | Create 不具备计算机权限，不能与 Execute 混写 |
| Reason 日间界面 | `docs/brand/ui-shots/reason-day.png` | 实际运行时截图 | 模式对照 | Reason 不具备计算机权限 |
| Companion 夜间界面 | `docs/brand/ui-shots/companion-night.png` | 实际运行时截图 | 深色主题补充 | 同一说明书不建议同时混用太多主题 |

## 可作为历史或辅助材料、但不建议做能力证明

- `assets/steam/screenshots/*.png`：较早的编译后 Electron 运行截图，分辨率较高，但 UI 版本早于当前 `docs/brand/ui-shots/`。只有需要展示演进时使用，并标注“历史界面”。
- `docs/brand/athena-primary-mark-colorways-v1.png`：品牌色稿/参考板，适合内部色彩参考，不等同于最终精修、权利确认后的公开 Logo 主文件。
- `docs/brand/ui-board.html`：UI 截图索引与说明页面，可用于查找素材，不直接放入参赛附件。
- `docs/brand/companion-prototype/`：伴侣视觉原型资源，不能把原型画面当成当前产品运行功能。

## 不应作为当前实现证据的素材

- 概念图、生成式视觉板、角色设定图、未运行的界面稿。
- 没有 task/run、工具事件、审批与真实成果的空状态截图。
- 历史版本截图冒充当前 `0.9.7-beta.1`。
- Live2D 角色资源：当前 release feature gate 为关闭状态，不能作为当前产品能力宣传。
- Athena Cloud 概念或同步素材：当前生产服务不属于已验证成熟能力。

## 当前素材缺口

现有素材足以完成一份结构清晰的说明书，但不足以证明“超级智能体完成真实复杂任务”。尤其缺少：完整任务链、工具事件、审批参数、Windows 前后状态、成果文件打开、验证证据、真实语音和真实长期记忆召回的当前版本截图。具体补拍内容见《需要补拍的截图清单.md》。

## 本次 PDF 的素材选用

建议只使用统一的日间视觉：

1. 封面：`resources/athena-brand-icon.png`。
2. 产品概览：`docs/brand/ui-shots/execution-day.png`。
3. 记忆章节：`docs/brand/ui-shots/memory-day.png`。
4. 安全章节：`docs/brand/ui-shots/settings-day.png`。

所有运行时截图均加注“当前运行时界面；空状态不作为完整任务证明”，避免评委误解。

