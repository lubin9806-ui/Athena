# Athena — 总有一天 / SOMEDAY

九张一套的宣传海报。主题来自用户提供的诗段，视觉方向是「不要太抽象、太花哨或太写实」：
克制的编辑式排版，冷调石板灰与银白，大量留白，没有霓虹、没有科技感图标、没有设备样机。

- 成品：`posters/athena-someday-01..09-*.png`，各 1536 × 2048（3:4）
- 索引：`posters/contact-sheet.png`，1536 × 2384，用于整体审看，不属于九张
- 校验：`posters/MANIFEST.json` 记录每张的尺寸、字节数、sha256 与所用素材

## 结构

| # | 名称 | 素材 | 说明 |
|---|---|---|---|
| 01 | 云端之上 | `source/art/clouds.png` | 主视觉，诗段首句 |
| 02 | 巨石与月 | `source/art/moon.png` | 夜与持续用力 |
| 03 | 归途 | `source/art/snow.png` | 风雪与留白，浅底 |
| 04 | 陪伴 | `source/runtime/04-companion-day.png` | 陪伴模式 |
| 05 | 创作 | `source/runtime/05-create-day.png` | 创作模式与 Project |
| 06 | 推理 | `source/runtime/06-reason-day.png` | 推理模式 |
| 07 | 执行 | `source/runtime/07-execution-day.png` | 执行工作区、Skills、MCP |
| 08 | 记忆 | `source/runtime/08-memory-day.png` | 记忆面板 |
| 09 | 夜 | `source/runtime/09-companion-night.png` | 深色界面，浅底收尾 |

节奏是「暗、暗、亮 / 暗、暗、暗 / 暗、暗、亮」：03 与 09 两张浅底分别收住上下半场。

## 真实性

六张实机图是既有打包体 `release/win-unpacked/Athena.exe --smoke-test` 用
`webContents.capturePage()` 抓的原始像素，隔离了全新的预览配置，未接入任何模型或麦克风
（见 `source/runtime/capture-manifest.json`）。海报只做等比缩放和圆角裁切，界面内容一个像素没改，
所以每张都标注「实机截图 · 未修饰 · 1280 × 820」。

三段小字说明只写截图里看得见的事实。页脚标注 `DESKTOP 0.9.7-BETA.1 · 私有测试`，
因为按 `README.md`，当前版本是私有 Beta 候选，不是公开或上架的 1.0。

## 重新生成

```bash
node_modules\.bin\electron.cmd promo\campaign-20260907-someday\tools\build-posters.cjs
```

只重出其中几张时把 id 片段作为参数传进去，例如 `... build-posters.cjs 03-snow 09-night`
（此时不会更新 `MANIFEST.json` 和索引图）。

- `tools/poster-content.cjs` — 九张的文案与配图，改文案只改这里
- `tools/poster-html.cjs` — 共用的版式、配色与字体
- `tools/build-posters.cjs` — Electron 离屏渲染与校验
- `tools/capture-runtime.cjs` — 重新抓实机截图
- `.build/` — 生成的中间 HTML，便于排版调试

排版用系统里的 Noto Serif SC（标题与诗句）和 Noto Sans SC（说明与拉丁字），
两者都是可变字体。换机器前先确认这两个字体存在，否则会回退到微软雅黑，字重和气质都会变。

Windows 会把 `BrowserWindow` 构造时的尺寸裁到显示器大小，所以渲染器先建窗口再
`setContentSize()`，并以半尺寸窗口 × 2 倍设备像素还原 1536 × 2048。
