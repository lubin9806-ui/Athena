# Athena 商业化问题台账

> 基线日期：2026-07-15  
> 这是唯一问题台账。严重级别、状态和交接规则见 `WORK_PROTOCOL.md`。

## 1. 状态汇总

| 严重级别 | Closed | Open/In Progress/Blocked | 说明 |
|---|---:|---:|---|
| Blocker | 7 | 0 | 窗口 01 的仓库、事实源与验证链 Blocker 已全部关闭 |
| P0 | 0 | 10 | 分配给窗口 02、03、04、06、08–10；不阻止窗口 02 开始 |
| P1 | 0 | 6 | 分配给窗口 05–07、11 |
| P2/P3 | 0 | 3 | 非当前交接阻断 |

窗口 02 放行规则：Blocker 开放数量为 0，且 0.8.0 构建与开发/打包态启动已通过；当前已满足。P0/P1 继续按负责窗口处理，不代表商业版本可发布。

## 2. 窗口 01 基线问题

| 编号 | 问题 | 证据 | 严重级别 | 负责窗口 | 状态 | 验收条件 |
|---|---|---|---|---|---|---|
| ATH-W01-001 | `.git` 是空目录，Git 命令无法识别仓库 | 审计时 `.git` 递归对象数为 0；原地初始化后 `rev-parse=true`、branch=`main`；G: 盘仅添加精确 `safe.directory` | Blocker | 01 | Closed | 不删除任何内容；原地初始化 main；`git rev-parse --is-inside-work-tree` 为 true，`git status` 可运行 |
| ATH-W01-002 | `.gitignore` 未覆盖本地模型、安装器、Python 缓存、用户记忆和根目录探针 | 原 `.gitignore` 仅 333 bytes；5.4GB 模型和 672MB Ollama installer 可被误纳入初始提交 | Blocker | 01 | Closed | ignore 规则覆盖运行/构建/用户/大文件；商业文档和归档 manifest 仍可追踪；`git check-ignore` 验证 |
| ATH-W01-003 | 根目录混有语音探针、下载日志、758MB `public.zip` 和快捷方式 | 2026-07-15 根目录清单及 SHA-256 | Blocker | 01 | Closed | 不删除；明确生成物移入 `legacy/root-artifacts/preserved-files`；README + SHA-256 manifest 落盘；未知目录不动 |
| ATH-W01-004 | 版本元数据把 Internal Alpha 标成 `1.0.0`；PowerShell 默认编码造成“乱码”误判 | `package.json`/`APP_VERSION` 为 1.0.0；`Get-Content -Encoding UTF8` 证明源文件无乱码 | Blocker | 01 | Closed | 统一为 0.8.0 Internal Alpha；新增 UTF-8 `.editorconfig`；README 明示非正式 1.0 |
| ATH-W01-005 | 当前 npm 镜像不实现 advisory endpoint，默认 `npm audit` 返回 404 | `registry=https://registry.npmmirror.com`；404 `[NOT_IMPLEMENTED]` | Blocker | 01 | Closed | `npm.cmd run audit:security` 固定官方 registry；能返回可解析漏洞清单；发现漏洞可非零退出 |
| ATH-W01-006 | 旧 docs README/roadmap 把愿景、骨架和已实现混写 | 旧 `docs/README.md` 宣称技能、系统目录和十章路线；`roadmap.md` 未标状态 | Blocker | 01 | Closed | 五份商业基线成为唯一事实源；旧 roadmap 明确为非承诺；README 与版本/能力一致 |
| ATH-W01-007 | 需要建立本轮修改后的完整构建和启动证据 | typecheck 和全部非 live 回归通过；开发态与打包态均输出 `ATHENA_SMOKE_READY_TO_SHOW`、`ATHENA_SMOKE_DOM_OK`；0.8.0 NSIS 构建成功 | Blocker | 01 | Closed | typecheck、非 live 回归、开发 smoke、`npm run build`、打包 exe smoke 全部成功并记录标记 |

## 3. 后续商业问题

| 编号 | 问题 | 证据 | 严重级别 | 负责窗口 | 状态 | 验收条件 |
|---|---|---|---|---|---|---|
| ATH-SEC-001 | Electron 28、Vite 5、builder 24 存在已知漏洞并超出支持基线 | 官方 npm audit：8 项，7 High/1 Moderate；Electron 官方只支持最新三个稳定大版本 | P0 | 02 | Open | 升级受支持版本；官方 audit 无 High/Critical；自动化与打包烟测回归 |
| ATH-SEC-002 | BrowserWindow 未显式 sandbox，HTML 无严格 CSP，生产包含 source map | `src/app/main.ts`、`src/renderer/index.html`、Vite/TS 配置 | P0 | 02 | Open | sandbox/CSP/导航/下载/权限基线和负向测试通过；生产不分发 source map |
| ATH-SEC-003 | Execute 默认 Full，缺少面向普通用户的高危逐次确认 | `config/settings.json`、SettingsStore 默认值、ComputerTools 能力清单 | P0 | 02 | Open | 默认 Off；显式升权；危险操作确认；撤销、取消和模式隔离回归通过 |
| ATH-PRIV-001 | 没有隐私政策、联网数据流说明和首次同意 | 搜索会访问第三方；Google STT/Edge TTS 会发送音频/文本 | P0 | 03 | Open | 数据地图、应用内隐私入口、逐类同意与宣传文案一致 |
| ATH-DATA-001 | 保留/导出设置未执行，缺少完整导出、一键清除和加密决策 | `historyRetentionDays`/`exportFormat` 只有 schema/UI；SQLite 明文 | P0 | 03 | Open | 保留、导出、清除、备份恢复和静态保护方案有自动化证据 |
| ATH-LEGAL-001 | notices 未覆盖完整 npm/Python/模型/素材来源 | `THIRD_PARTY_NOTICES.md` 仅列 Ollama/Qwen 且注明待核验 | P0 | 04 | Open | SBOM、许可清单、精确 Qwen/Ollama/Python artifact 和素材权属证据归档 |
| ATH-REL-001 | 无签名、更新、回滚和有效 CI 发布链 | builder 明确关闭签名；当前仓库刚初始化且无 CI | P0 | 06 | Open | 有效 Git baseline/CI；签名 beta 包；更新/回滚/迁移备份和安装矩阵通过 |
| ATH-VOICE-001 | 语音依赖系统 Python、在线服务和运行时模型下载 | VoiceService、`tts.py`、`stt.py`、`stt_whisper.py` | P1 | 05 | Open | 商业语音架构固定；依赖锁定；离线/联网降级和隐私标签通过 |
| ATH-WEB-001 | 搜索抓取第三方 HTML，缺少正式 SLA、监控和政策审查 | WebSearchService provider 列表与 anti-bot 回退 | P1 | 05 | Open | provider 合约、速率限制、失败 UX、监控和政策评审完成 |
| ATH-CONFIG-001 | 启动项、通知、历史保留、导出等部分设置不驱动真实行为 | 设置 schema/UI 与运行时引用差异 | P1 | 05 | Open | 所有可见设置端到端生效并测试，或从发布版移除 |
| ATH-DESKTOP-001 | Desktop Beta 缺少真实安装/升级/卸载/弱网/故障测试 | 当前仅 smoke 和本机安装包 | P1 | 06 | Open | 20–50 人受控 Beta 和安装升级矩阵无 P0/P1 |
| ATH-DESKTOP-002 | Desktop 1.0 的授权、支持、退款和正式发布材料未定义 | 无账号/许可证/支持流程 | P1 | 07 | Open | SKU、授权、退款、支持、官网和签字完成 |
| ATH-STEAM-001 | 无 Steamworks、Depot、所有权、内容问卷和 Steam 专用裁剪 | 仓库无 Steam 集成 | P0 | 08 | Open | Steam 专项清单全部通过并获得 Valve build/store review |
| ATH-CLOUD-001 | 无认证、租户隔离、同步、计费、SLO 和数据权利服务 | 仓库无服务端工程 | P0 | 09 | Open | Cloud 专项清单全部通过；作为 Mobile 的前置版本发布 |
| ATH-MOBILE-001 | 无 iOS/Android 工程和移动商店合规 | 仓库无移动工程 | P0 | 10 | Open | Mobile 专项清单全部通过，且 Cloud 1.0 已发布 |
| ATH-OPS-001 | 无跨平台事件响应、状态页、停止支持与发布复盘机制 | 当前没有运营制度/工具 | P1 | 11 | Open | 发布责任链、状态页、事件演练和停止支持策略完成 |
| ATH-ARCH-001 | PluginManager/Planner 关闭，Workflows/Skills 多为骨架 | 对应类只含 enabled/id/注册生命周期 | P2 | 05 | Open | 要么实现并测试为某 SKU 能力，要么从 1.0 UI/宣传移除 |
| ATH-PRODUCT-001 | Live2D、音乐、日历、跨平台等旧愿景未实现 | legacy roadmap 与当前源码差异 | P3 | 07 | Open | 不进入 1.0 宣传；未来进入矩阵后另建实现问题 |
| ATH-REPO-001 | 来源不明空目录、历史归档和大模型本地 payload 仍需长期归属策略 | `新建文件夹/`、`legacy/root-artifacts`、`models/` | P2 | 04 | Open | 确认所有者/许可/保留期；在有备份和批准前不得删除 |

## 4. 窗口 01 关闭记录

| 项目 | 最终证据 |
|---|---|
| Git | 空 `.git` 原地初始化为 `main`；精确添加 `G:/Athena` safe.directory；Git 状态和 ignore probe 可运行；未删除历史 |
| 根目录归档 | 17 个文件非破坏性移动；`legacy/root-artifacts/MANIFEST.sha256` 全部复核一致 |
| 元数据 | `package.json`、lockfile、`APP_VERSION` 统一为 0.8.0；UTF-8 `.editorconfig` 落盘 |
| 依赖审计 | `AUDIT_ENDPOINT_OK`；官方 registry 返回 8 项：7 High、1 Moderate；问题转交 ATH-SEC-001 / 窗口 02 |
| 自动化 | typecheck、persona、modes、theme、logger、web-search、tools 全部通过 |
| 开发态启动 | `npm.cmd run smoke:electron` 输出 `ATHENA_SMOKE_READY_TO_SHOW` 和 `ATHENA_SMOKE_DOM_OK` |
| 构建 | `npm.cmd run build` 生成 82,213,604-byte `Athena Setup 0.8.0.exe` |
| 打包态启动 | `release/win-unpacked/Athena.exe --smoke-test` 输出两个 smoke 成功标记 |
| 产物哈希 | Installer `3472C0B0AD3F85EC82B70553CAA0C33AAF12073FFC3F9501587DCC6D779CBEF4`；unpacked exe `67DC2A7036860A68E5312C212C31B8772AC463ED0289FCC44897867F55075E89` |

窗口 01 不关闭任何窗口 02–11 的问题，也不把“已登记”写成“已解决”。
