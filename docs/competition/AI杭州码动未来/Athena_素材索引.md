# Athena 参赛素材索引

审计基线：2026 年 9 月 18 日当前仓库。参赛团队已确认最终 Athena Logo 可公开使用。

## 推荐用于项目说明书的现有素材

| 素材 | 仓库路径 | 性质 | 推荐用途 | 使用边界 |
|---|---|---|---|---|
| Athena 品牌图标 | `resources/athena-brand-icon.png` | 当前应用视觉资产 | 封面、页眉、章节页 | 参赛团队已确认最终 Logo 可公开使用 |
| Athena 矢量标记 | `docs/brand/companion-prototype/assets/athena-mark.svg` | traced prototype master | 矢量封面或印刷稿 | 不是已签署的最终精修 Logo 主文件 |
| Execute 日间界面 | `docs/brand/ui-shots/execution-day.png` | 实际运行时截图 | 产品界面、执行工作区说明 | 是空状态/静态界面，不是完整任务执行证据 |
| Memory 日间界面 | `docs/brand/ui-shots/memory-day.png` | 实际运行时截图 | 本地记忆与可检查界面 | 当前截图没有真实演示数据 |
| Settings 日间界面 | `docs/brand/ui-shots/settings-day.png` | 实际运行时截图 | 权限、隐私与设置章节 | 注意截图中的 Beta 文案；不要裁掉真实状态 |
| Companion 日间界面 | `docs/brand/ui-shots/companion-day.png` | 实际运行时截图 | 项目概述或普通聊天对照 | 空状态，不能证明 Agent 执行 |
| Demo 命令审批 | `docs/competition/AI杭州码动未来/demo-output/live-deepseek-2026-09-18T02-31-05-252Z/evidence/01-command-approval.png` | DeepSeek live E2E 实际截图 | 权限控制、工具调用 | 当前源码构建，非最终签名安装包 |
| Demo 文件修改审批 | `docs/competition/AI杭州码动未来/demo-output/live-deepseek-2026-09-18T02-31-05-252Z/evidence/03-median-fix-approval.png` | DeepSeek live E2E 实际截图 | 文件操作、参数可见性 | 虚构代码项目；逐项审批开启 |
| Demo 最终结果 | `docs/competition/AI杭州码动未来/demo-output/live-deepseek-2026-09-18T02-31-05-252Z/evidence/05-final-result.png` | DeepSeek live E2E 实际截图 | 结果交付、验证边界 | UI 如实为未验证；外部 E2E 独立通过 |
| 参赛字幕版视频 | `docs/competition/AI杭州码动未来/Athena_AI杭州码动未来_Demo演示视频.mp4` | 1080p H.264 成片 | 报名与答辩播放 | 无旁白音轨；实际解码约 2 分 24 秒 |
| 无剪辑证据版 | `docs/competition/AI杭州码动未来/demo-output/live-deepseek-2026-09-18T02-31-05-252Z/Athena_Demo_无剪辑证据版.mp4` | 真实 Renderer 连续录制 | 证明真实执行 | 35 秒、1180×760、无音频；保留原始执行顺序 |
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

本次已补录一条 DeepSeek 实时执行链，包含目标输入、命令审批、两次文件修改审批、复测审批与最终结果，可证明当前源码构建具备多工具连续执行能力。仍缺少最终签名安装包在比赛设备上的完整复录，以及真实语音、真实长期记忆召回和非虚构个人工作流的当前版本证据。具体补拍内容见《需要补拍的截图清单.md》。

## 交付件完整性校验

以下哈希基于 2026 年 9 月 18 日最终生成文件：

| 文件 | 字节数 | SHA-256 |
|---|---:|---|
| `Athena_AI杭州码动未来_项目说明书.pdf` | 979338 | `D65BBAB6A37D86DDC17E9672FFAE0A24961E95AADD7FD57C373A5CD6417C3321` |
| `Athena_AI杭州码动未来_Demo演示视频.mp4` | 6023186 | `892E509267D21999338F253EFB8FE1E36DEE1F1F2BC0132CBD83F779E8DCC242` |
| `demo-output/live-deepseek-2026-09-18T02-31-05-252Z/Athena_Demo_无剪辑证据版.mp4` | 2363640 | `67981E6E56C5367A4BE08BCBEA44E97C51EBEE4A024C94497D79361108012AFB` |

## 本次 PDF 的素材选用

建议只使用统一的日间视觉：

1. 封面：`resources/athena-brand-icon.png`。
2. 产品概览：`docs/brand/ui-shots/execution-day.png`。
3. 记忆章节：`docs/brand/ui-shots/memory-day.png`。
4. 安全章节：`docs/brand/ui-shots/settings-day.png`。

所有运行时截图均加注“当前运行时界面；空状态不作为完整任务证明”，避免评委误解。
