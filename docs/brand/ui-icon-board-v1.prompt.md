# Athena 图标与组件视觉板 01

用户要求：按现有操作逻辑输出板块、图标、软件内图标和整体 UI 视觉图。

生成方式：内置 imagegen；人物身份参考 `athena-character-direction-02.png`。输出 `athena-ui-icon-board-v1.png`。

## 视觉检查与使用边界

- 图中包含 24 个软件内图标、应用标志与角色头像区分、两层导航、输入工具菜单、按钮、记忆／设置面板和反馈状态。
- 本图是栅格概念，不是可直接使用的 SVG 图标库。线宽和尺寸标签是目标规格，不是已经校准的生产文件。
- 应用 A 标志是本轮候选，图中曲线衬线比当前源码三角 A 更明显；尚未统一为最终标志。
- 生成图将「角色头像」说明写为个人账户与对话身份；实施时应只用于当前角色身份，不能与用户账户头像混淆。
- 图中处理中状态使用蓝色，深色按钮前景和少量色值文字有模型解释差异；正式实现以 `visual-tokens.css` 为准，处理中继续沿用品牌强调色并配状态文字。
- 记忆示例中「当前窗口」内容和选中 tab 未完全对应；实施保留实际五个 tab 的行为，不按图改变数据归属。
- 角色、标志和 UI 细节仍待评审，不表示程序已修改或发行版已启用 Live2D。

## 完整提示词

Use case: logo-brand / ui-mockup. Create a professional ATHENA Windows desktop UI KIT AND ICON SYSTEM visual presentation board, landscape 3200x2200 if possible. One readable flat contact-sheet presentation, not a webpage and not a screenshot. Exact main title 'ATHENA' + '图标与组件规范', small '设计概念'. Layout four panels with generous gutters and margins, 2 columns, upper row 45%, lower row 45%. Premium crisp vector-like line graphics on warm ivory #F2F1EC, #FCFCF8 surfaces, graphite #222C2A text, mineral green #3E6855 primary accents, silver #A6ADA7 subtle rules. One UI typography family, crisp Chinese labels. No 3D lettering, clutter or stock mockups.
PANEL UPPER LEFT '应用图标': develop ONE candidate app icon consistent with the current app's triangular A brand mark: a precise balanced capital A with negative-space inner counter, mineral green on warm ivory rounded-square tile. Show large 128px presentation and three smaller forms labeled '48', '32', '16'; side by side monochrome dark-on-light and light-on-dark variants. The icon must be simple and legible, no goddess face inside tiny app icon. Beside it show serif 'Athena' wordmark, then a small circular avatar cropped from the supplied anime character reference with caption '角色头像'. Clarify visually app icon and character avatar are different roles. Use exact character identity from reference: silver hair, olive silver ornament with green stone, grey-green eyes; adult anime.
PANEL UPPER RIGHT '软件内图标': exactly 24 simple UI icons in a 6 columns x 4 rows grid, each with short Chinese label beneath. Consistent 24x24 optical grid, 1.7px graphite rounded outline strokes, no backgrounds behind every glyph, no copied famous icons. Semantically clear forms:
row1 '侧栏' split panel; '新对话' plus bubble; '临时聊天' dashed bubble; '项目' folder; '记忆' three-tier database cylinder matching current app; '设置' gear.
row2 '添加文件' document plus; '导入文档' document inward arrow; '扫描 PDF' scan corners around document; '联网搜索' globe; '麦克风' microphone; '语音对话' headset or waveform speech bubble.
row3 '朗读' speaker; '发送' paper plane; '停止' square; '重试' circular arrow; '固定' pushpin; '重命名' pencil.
row4 '归档' archive box; '删除' trash; '工具' spanner; '最小化' horizontal dash; '关闭' x; '展开' chevron down.
Tiny single spec note '24px 网格 / 1.7px 线宽'. Glyphs substantial and legible, clean precise consistent curves.
PANEL LOWER LEFT '导航与输入': demonstrate correct TWO LEVEL navigation. First strip top level '陪伴' selected / '创作'. Second example top level '陪伴' / '创作' selected, with subordinate strip '创作' / '推理' / '执行' selected. Do not treat four modes as same hierarchy. Then wide composer containing plus, placeholder '描述你的想法…', microphone, green paper-plane send, lower caption '工具 · 关闭' and 'Enter 发送'. Show plus-menu popover aligned above plus with four visible rows '添加文件', '本轮联网搜索', '转写音频', '语音对话'. It is a compact sample of existing menu, do not claim a new standalone top-level destination. Three clear action buttons '主要操作' filled green / '次要操作' neutral outline / '不可用' disabled. Focus example crisp 2px green ring.
PANEL LOWER RIGHT '面板与状态': two sibling slim drawer examples: '记忆' drawer with short tabs '窗口 / 待确认 / 记忆 / 检索 / 导入' and readable sparse content '当前窗口', '目标', '已确认结论'; '设置' drawer with '模型', '外观', '语音', '隐私与数据' tidy settings rows, '保存设置' button. Under drawers four status treatments each color AND text: '未连接', '正在处理', '已完成', '连接失败'. Small dark-theme counterpart horizontal component strip showing same button and input on #18201D, surface #222D27, foreground #EDF1EC and accent #B4CDBB with dark button text. Bottom small palette swatches and '10 / 18 / 24' corner radius specimen.
Everything aligned and readable. Sparse professionally composed UI identity board. Glass only subtle translucent composer, no glossy icons, no arbitrary gradient glyphs, no multicolor app grid, no decorative magic particles, no unrelated dashboard data. Output actual raster concept image, not code.
