# Athena UI 视觉审阅

可点击样板已完成：[打开本地预览](http://127.0.0.1:4174)，[查看样板与验证说明](G:/Athena/docs/brand/companion-prototype/README.md)。样板使用示例内容，尚未接入 Athena 运行界面。

日期：2026-09-09。阶段：视觉提案，尚未接入运行界面。图中对话、记录与状态均为示例。

## 01 整体方向

![整体视觉](G:/Athena/docs/brand/athena-ui-ai-visual-board-01.png)

延续已确认品牌标志、暖白与灰绿。此图作为整体气质参考；导航与组件行为以以下细化稿和源代码为准。

## 02 工作空间

![工作空间细化](G:/Athena/docs/brand/athena-workspaces-visual-02.png)

创作展示连续文字输出，推理展示对比回答，执行展示当前 Project、任务与计划、交付产物、持久化执行记录、Agent Skills、MCP 和工具权限。保留“陪伴 / 创作”一级入口与创作下的三个子模式。执行页将已有区域作视觉重排，以便同时检查其信息层级；这是版式提案，不代表当前页面已采用此排布。

[工作空间完整提示词](G:/Athena/docs/brand/athena-workspaces-visual-02.prompt.md)

## 03 图标与组件

![图标与组件](G:/Athena/docs/brand/athena-components-visual-03.png)

包含十四枚功能图标、正负型样例、日夜输入框、加号菜单、按钮与反馈状态、记忆和设置抽屉。菜单与抽屉分别展示于独立样例，实际界面不会同时打开这些浮层。

经图像检查与局部修正，工具菜单与输入框已留出可见间距，夜间焦点描边已去除明显外发光。局部正负型示例中的文件夹语义对应 Project，图示文字与最终图标路径仍需在组件实现中逐项校准。

[组件完整提示词与修正记录](G:/Athena/docs/brand/athena-components-visual-03.prompt.md)

## 与当前操作逻辑的对应

- 一级导航只有“陪伴”和“创作”；二级“创作 / 推理 / 执行”仅在创作空间显示。依据：src/renderer/index.html:117、src/renderer/app.ts:1620。
- 陪伴、创作、推理不开放电脑工具，状态为相应模式加“纯聊天”。执行默认权限关闭。依据：README.md:39、src/renderer/app.ts:5827。
- 输入区常驻加号、文本、麦克风、发送及底部状态；八个次级功能放在加号菜单内。依据：src/renderer/index.html:1313。
- 工具菜单在输入框上方，运行布局需至少保留 10px 间距并完整展示底部状态。依据：src/renderer/app.ts:4563。
- 记忆、设置和工具抽屉互斥；打开抽屉时收起加号菜单。依据：src/renderer/app.ts:4417。
- 记忆为窗口、待确认、记忆、检索、导入五个标签；设置为折叠分组。依据：src/renderer/index.html:206、src/renderer/index.html:578。
- 联网搜索拥有独立的启用与同意状态，不能等同于执行权限。语音功能依据实际可用状态呈现。依据：src/renderer/app.ts:5842、src/renderer/app.ts:6533。

## 交付边界

本轮只新增图像及说明，没有修改产品代码、配置、人格或数据库。图片由内置 image_gen 生成，已经检查布局、主要文案、导航与状态。图片不是生产级 SVG 图标集，也不是软件运行截图。正式实现应使用准确的组件文案、统一图标母版和已确认 Logo 资产；所有界面继续不使用 IP 人物。
