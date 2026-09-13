# Athena 图标与组件细化图

生成方式：内置 image_gen。类型：ui-mockup。2026-09-09。

参考图：athena-ui-ai-visual-board-01.png；athena-primary-mark-colorways-v1.png。

## 初始完整提示词

Use case: ui-mockup.
Asset type: Athena UI component detail board, sheet 03.
Input images: Image 1 is the existing UI board used ONLY for colour, softness and visual identity. Image 2 is the approved Athena logo reference. Do not redesign this logo.
Generate one high-fidelity 3:2 landscape desktop interface specimen sheet titled "Athena / 图标与组件". Small footer "视觉方案 · 状态示例". Maximize legibility of actual UI components. Crisp front-on flat product design, generous but purposeful spacing, no perspective, no marketing artwork.

Identity: ivory #F5F1E8, surface #FCFCF8, sage #53675F, graphite text #222C2A. Dark components use warm deep gray-green #18201D, raised #26322C, ivory text #EDF1EC, sage-tinted active accents #B4CDBB. No pure black, neon or blue-purple. Consistent round line icons. UI Chinese type must be a clear modern sans-serif. Only "Athena" wordmark may be serif. Avoid shadows everywhere, fine separators, modest rounded corners.

Layout THREE purposeful zones, not a collage of tiny entire app windows:
LEFT 24 percent: functional icon catalogue. Fourteen large 24px-grid optical icons displayed at readable enlarged size, arranged 2 columns x 7 rows with concise labels: "侧栏", "新对话", "临时聊天", "Project", "文件", "联网", "工具", "麦克风", "发送", "记忆", "设置", "置顶", "刷新", "关闭". Each icon is the SAME simple rounded 1.75px outline family, not a mythological illustration. Temporary chat = dashed speech bubble, ordinary new chat = plus, Project = folder, memory = small stacked database. At bottom show a short inverse specimen strip with 4 same icons ivory on sage, labelled "正型 / 负型". Do not replace the brand mark with a helmet or A.

MIDDLE 42 percent: composer and control specimens.
Top large light specimen labelled "输入与工具展开". A plus-menu floats ABOVE a composer with a clear 10px gap. Eight EXACT menu entries in one legible list: "添加文件", "导入文档", "扫描 PDF OCR", "可调用工具", "本轮联网搜索", "转写音频", "朗读回复", "语音对话". Last voice controls may be muted to indicate not enabled. Do not draw arrows connecting unrelated items.
Composer has plus, placeholder "和 Athena 说点什么…", microphone, sage send button, and separate clearly uncut bottom line "陪伴 · 纯聊天" on left, "Enter 发送" on right. No permanent row of all tools.
Below show SAME composer in warm dark theme, labelled "夜间输入". Its popover is CLOSED. Include a visible focus ring on the dark composer. Keep text readable and full bottom status line.
Near bottom a compact row of button state specimens "默认", "悬停", "聚焦", "禁用", plus small textual feedback states "生成中", "可重试". These are component examples, no fake analytics, no auto-running animation.
Memory/settings drawers MUST NOT be open in these composer samples because the real app closes the menu when a drawer opens.

RIGHT 34 percent: two separate right-drawer specimen cards, each clearly labelled as an independent sample.
Top light drawer labelled "记忆抽屉". Drawer title "记忆", close X, five exact tabs "窗口", "待确认", "记忆", "检索", "导入". 窗口 selected. Show three short information groups "当前目标", "已确认结论", "待办事项" with honest empty state "暂无内容". The drawer attaches to a sliver of a pale app background on its left, visibly a right-side drawer rather than a new navigation page.
Bottom dark drawer labelled "设置抽屉". Title "设置", close X. Real accordion rows, not a tab bar: "常规", "个性化", "对话", "执行与权限", "联网搜索", "外观与动效", "模型". Show "外观与动效" expanded with a two-choice theme control "日光", "夜色", 夜色 selected. Other sections can continue below a subtle scroll affordance; no invented profile/avatar. This is a separate sample, not simultaneous with the memory drawer.

Absolute constraints: no people, IP characters, faces, avatars or mascots anywhere. No temple/feather/crescent background ornaments; the Greek story remains solely in a small approved Athena mark at the heading. No blanket privacy claims such as data never leaves device. No oversized Chinese serif headlines. No fake plugin integrations or invented feature buttons. Show a precise, calm, gentle, coherent, implementation-aware UI design with consistent strokes, padding, contrast and hierarchy.

## 最终局部校正提示词

Use case: precise-object-edit. Edit target: the attached Athena component board. Preserve the complete canvas, all headings, all icons, drawers, text and layout positions, brand mark and colours. Make only a localized refinement of the MIDDLE COLUMN input controls:
1. The white eight-item plus-menu currently overlaps the top of the white composer. Compact the eight menu rows slightly while keeping every label exactly unchanged and legible; the menu bottom must end at least 12 pixels ABOVE the composer's outer top edge. At this image's scale the popup should occupy about y=164 to y=428, and the composer starts around y=442. There must be clear empty ivory background between the two outer boundaries. Do not move the whole composer or cover the heading. Preserve all eight menu entries.
2. In the dark "夜间输入" specimen remove the luminous neon bloom from the focus outline. Use one crisp, thin, muted sage focus border with zero outer glow. Keep the text, button positions and the bottom status line unchanged.
Everything outside these two input-control refinements must remain visually identical. Do not introduce new elements.
