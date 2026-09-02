# Athena -> Grok 工程交接

> 交接快照：2026-09-02（Asia/Shanghai）
> 仓库：`G:\Athena`
> 当前分支：`main`
> 基线提交：`db4b1dc feat(image): add multi-engine conversation generation`

## 1. 先读结论

Grok 可以从当前工作区继续做**受控工程开发**，但必须原地保护现有未提交改动。当前不能重置、清理、切换到所谓“干净版本”，也不能把现有安装包当作新鲜候选。

当前交接结论：

| 范围 | 结论 | 原因 |
|---|---|---|
| Grok 接手阅读、诊断和继续修复 | **GO** | 仓库可读，定向类型、隐私、安全、模型、路由和图像回归已通过 |
| 直接提交整个工作区 | **NO-GO** | 32 个既有跟踪文件有改动，交接索引另改 1 个文件；还有本地数据库、截图、附件和新源码，尚未完成分组审阅 |
| 新鲜 Electron 运行时验收 | **NO-GO** | `smoke:electron` 连续两次在液态玻璃帧门失败 |
| 使用现有安装包作为当前候选 | **NO-GO** | 包校验确认源码输入已变化；EXE/installer 均未签名 |
| Beta、公测、商店、付费或公开分发 | **NO-GO** | 签名、真实 Beta、平台账号、生产商业依赖和发布签字仍未完成 |

## 2. 接手时绝对不要做

1. 不要运行 `git reset --hard`、`git checkout -- .`、`git clean`、改写历史或批量删除。
2. 不要运行 `git add .`，不要把整个工作区一次性提交。
3. 不要覆盖或提交 `config/model.json`、`config/settings.json`、`config/personas/`、`database/`、`.env*`、凭据文件、用户附件或本地运行产物。
4. 不要把 `artifacts/` 下的本机证明截图、`assets/avatar/athena-3d-default/preview/` 或 Live2D 参考素材自动纳入发行包。
5. 不要读取、打印或迁移 API Key。密钥只允许从现有环境变量、`.env.local`/`.env` 或 Windows `safeStorage` 解析，日志和交接材料中只记录“存在/不存在”。
6. 不要恢复 3D/VRM 生产路线。Live2D/分层 2D 是未来方向，但当前发行硬门仍为关闭。
7. 不要把 fixture、源码检查、开发态 smoke 或无签名包描述为真实在线请求、真实用户 Beta、商店通过或可公开发行。

仓库当前没有配置 Git remote，也没有 upstream。不要假设 GitHub/GitLab 上存在可恢复副本；当前本地工作区是唯一已确认的开发现场。

## 3. 当前 Git 与本地数据快照

交接前只读盘点结果：

- `HEAD`: `db4b1dc`
- 分支：仅确认本地 `main`
- remote：未配置
- 交接前既有的已跟踪改动：32 个文件，约 `+1003 / -222`
- 本交接另修改 `docs/README.md` 索引并新增本文件；因此交接完成后的 `git status` 会比上项多一个跟踪修改和一个未跟踪文档
- 交接前未跟踪且未被 ignore 的内容：9 个文件，约 6.2 MB，归在 `artifacts/`、`assets/`、`database/` 和 `src/` 四个根路径
- 唯一应作为候选新源码审阅的未跟踪文件：`src/core/ai/ModelConnectionDiagnostics.ts`
- `database/` 包含 `athena.db`、WAL/SHM 和聊天附件，是用户/运行态数据，不能交给源码提交或测试包
- `artifacts/` 当前包含 Live2D 与本机 ComfyUI 证明截图；它们是本机证据，不是可发布能力证明

接手后的第一组命令只能是只读盘点：

```powershell
Set-Location G:\Athena
git status --short --branch
git log -12 --oneline --decorate
git diff --stat
git diff --name-only
git ls-files --others --exclude-standard
```

如果上述快照与本文件明显不同，先停止提交动作，确认是否已有其他开发者继续修改了共享工作区。

## 4. 已进入 HEAD 的近期能力

按从新到旧的提交顺序：

| 提交 | 已落盘内容 | 边界 |
|---|---|---|
| `db4b1dc` | 多引擎对话生图：本地 stable-diffusion.cpp、ComfyUI 和多个云 provider 路由 | 不代表本机 runtime、模型或付费云凭据已就绪 |
| `129e033` | 声明成年虚构创作工作流路由 | 保持 Companion/Create 语义分离，不把规则扩成全局聊天行为 |
| `3a71754` | 四模式之间的上下文、决定和工作状态连续性 | 模式切换不授予工具权限，不跨 Project/窗口泄露记忆 |
| `f716ba6` | schema 15 相关测试对齐 | 只是测试兼容修正 |
| `20d37b5` | 开放创作模式继续保留人格 | 不得削平为一个无人格的通用创作模式 |
| `7c5057a` | 文档与音频附件支持 | 文件所有权、窗口隔离和本地处理边界仍必须保留 |
| `889dc3e` | 测试包硬关闭 Live2D | 当前发行行为的权威门；不要改成 UI 默认值绕过 |

关键架构入口：

- `src/app/main.ts`：Electron 生命周期、窗口、smoke
- `src/app/ipc/index.ts` 与 `src/app/preload.ts`：可信 IPC 与 renderer 能力面
- `src/core/controller/AthenaController.ts`：对话主编排
- `src/core/ai/`：模型、人格、上下文、凭据和网络策略
- `src/core/agent/`：持久化任务、运行器、审批、工具注册
- `src/core/artifacts/`：图像/文档 artifact 与 provider 路由
- `src/core/config/SettingsStore.ts`：设置读取、合并和写入
- `src/core/runtime/Paths.ts`：开发态、测试态和打包态路径边界
- `src/memory/`：SQLite、长期记忆、Project 记忆与工作状态
- `src/renderer/`：主 UI；不得独自决定安全权限或联网许可

进一步阅读顺序：

1. `docs/WORK_PROTOCOL.md`
2. `docs/ISSUE_REGISTER.md`
3. `docs/RELEASE_CHECKLIST.md`
4. `docs/AGENT_PLATFORM_ARCHITECTURE.md`
5. `docs/CROSS_MODE_MEMORY_CONTINUITY.md`
6. `docs/PRIVACY_AND_DATA.md`
7. `docs/LIVE2D_RELEASE_GO_NO_GO.md`

## 5. 当前未提交开发现场

这批改动不是一个可直接整体提交的主题，至少要按以下四组审阅。

### A. 安全默认值与本地配置覆盖层

涉及：

- `.gitignore`
- `src/core/ai/Conversation.ts`
- `src/core/config/SettingsStore.ts`
- `src/core/runtime/Paths.ts`
- `src/core/ai/CredentialStore.ts`
- `electron-builder.yml`
- `electron-builder.steam.yml`
- `electron-builder.store.yml`
- `scripts/release-common.js`
- `scripts/verify-security-baseline.js`
- `scripts/verify-model-providers.js`
- `README.md`

意图：

- 对话调用缺失真实设置时 fail closed，Execute 默认 `off`
- 开发态设置写到 gitignored 的 `settings.local.json` / `model.local.json`
- 测试和打包态继续从隔离目录或 userData 读取，不吸收开发者偏好
- 进程环境变量优先于 `safeStorage`，`safeStorage` 优先于本地 env 文件
- 三种包型均排除本地配置覆盖层

高风险事实：当前 `HEAD` 的跟踪配置仍是 Execute=`full`、remote model/web search/external tool network consent=`true`、DeepSeek 已配置；当前工作区才把这些值恢复为安全默认。**不能通过丢弃工作区开始接手。**

同时，项目所有者的提交规则是不提交 `config/model.json` 和 `config/settings.json`。Grok 应把它们视为本地输入；安全发行默认应通过源码默认、种子配置和构建/包验证闭环实现。若认为必须提交这两个文件，先向项目所有者明确说明原因并单独取得决定。

### B. 模型连接诊断

涉及：

- 新文件 `src/core/ai/ModelConnectionDiagnostics.ts`
- `src/app/ipc/index.ts`
- `src/renderer/app.ts`
- `scripts/verify-model-providers.js`

意图：把“服务可达、模型存在、聊天成功”拆成三个真实状态；对未选模型、401、402、429、5xx、超时和网络错误给普通用户可理解的提示。测试连接前，renderer 会先安全保存输入框中尚未保存的 Key。

边界：fixture 的连接测试不等于真实 DeepSeek/OpenAI 计费请求。远程网络仍必须经过单独 consent gate。

### C. 本地生图与 ComfyUI 接手体验

涉及：

- `src/core/artifacts/ImageGenerationIntent.ts`
- `src/core/artifacts/LocalImageDiscoveryService.ts`
- `src/core/controller/AthenaController.ts`
- `src/shared/types/images.ts`
- `src/app/ipc/index.ts`
- `src/app/preload.ts`
- `src/renderer/app.ts`
- `src/renderer/index.html`
- `src/renderer/style.css`
- `resources/image-runtime/README.md`
- `scripts/verify-image-runtime-contract.js`
- `scripts/verify-local-image-live.js`
- `scripts/verify-desktop-package.js`
- `scripts/build-desktop.js`

意图：

- “生图/出图/再来一张”等短指令可继承当前窗口最近的明确图片描述
- 自动识别本机 ComfyUI、完整 checkpoint 和 Z-Image Turbo 组件组合
- 可从设置页启动已安装的 ComfyUI，并等待本地服务就绪
- 简化本地生图设置，将复杂参数收进高级设置
- 独立 `sd-cli.exe` 若随包分发，必须与 manifest 中 SHA-256 一致
- 轻量包可不带二进制，按需安装是允许形态

边界：当前检查输出明确为 `binary=absent`。这证明“缺失二进制时契约正确”，不是 turnkey 本地生图已经随包交付。`release:image-runtime-preflight` 只有在审核过的 runtime 真正存在且哈希匹配时才应通过。

### D. 验证与发布脚本收口

涉及：

- `scripts/verify-agent-routing.js`
- `scripts/verify-desktop-package.js`
- `scripts/verify-microsoft-store.js`
- `scripts/verify-security-baseline.js`
- `scripts/verify-model-providers.js`
- `scripts/verify-local-image-live.js`
- `src/app/main.ts` 的 smoke 检查

这组脚本是能力真实性的组成部分，不是可随意放宽的“测试噪音”。如果门禁失败，应先确认产品实现是否漂移，不能先删除断言让 CI 变绿。

交接验证期间，`scripts/verify-local-image-live.js` 在共享工作区新增了对 Z-Image Turbo split-model workflow 的 live-proof 支持。该变化不是本交接文档创建的，说明工作区仍可能被另一个开发过程同时修改。Grok 接手时必须重跑 Git 快照，不能把本文件的文件数当成永远不变的常量。

## 6. 2026-09-02 新鲜验证证据

以下命令在当前未提交工作区实际执行：

| 命令 | 结果 | 关键标记/说明 |
|---|---|---|
| `npm.cmd run typecheck` | PASS | 退出码 0 |
| `npm.cmd run test:security` | PASS | `SECURITY_BASELINE_OK` |
| `npm.cmd run test:privacy` | PASS | `ATHENA_PRIVACY_DATA_OK` |
| `npm.cmd run test:model-providers` | PASS | `ATHENA_MODEL_PROVIDERS_OK providers=ollama+openai+deepseek+athena-cloud+custom credentials=encrypted` |
| `npm.cmd run test:agent-routing` | PASS | `ATHENA_AGENT_ROUTING_OK cases=45 accuracy=1.000 safetyFalsePositives=0` |
| `npm.cmd run test:image-runtime` | PASS | `ATHENA_IMAGE_RUNTIME_CONTRACT_OK ... binary=absent comfyui=not-required` |
| `npm.cmd run test:image-providers` | PASS | `ATHENA_IMAGE_PROVIDERS_OK channels=10 ... fallback=never` |
| `npm.cmd run smoke:electron` | **FAIL x2** | 两次均先输出 `ATHENA_SMOKE_READY_TO_SHOW`，随后 `liquidFrameBefore=1`、`liquidFrameAfter=1`、`liquidMotionReactive=false`、`ATHENA_SMOKE_DOM_MISSING` |
| `npm.cmd run test:desktop-package` | **FAIL** | `Build inputs changed after the desktop package was created.` |

smoke 当前首先失败在 `src/app/main.ts` 的液态玻璃帧活动门，发生在新的模型/图像设置控件检查之前。退出阶段出现的“IPC handler 未注册”日志是在应用已经进入失败退出流程后发生，现阶段不要把它未经验证地写成首要根因。

## 7. 现有包状态

2026-09-02 只读检查：

| 产物 | 大小 | SHA-256 | 签名 | 结论 |
|---|---:|---|---|---|
| `release/Athena Setup 0.9.6-beta.1.exe` | 507,712,863 bytes | `5D9C393723D6F2533C6A7534D0B378F27331166CEF8D4F6FDAF7F63FCF1AAD96` | `NotSigned` | 源码输入已变化，不能作当前候选 |
| `release/win-unpacked/Athena.exe` | 232,771,072 bytes | `5902D86F0F1B6D71C6FA7B92BC918EC6D54B9AC9548CB9BDB3CDAD8BE29E7816` | `NotSigned` | 仅旧工程产物，不可分发 |

不要先重建包来掩盖 smoke 失败。应先恢复新鲜 Electron smoke，再从审阅完成的提交或明确保存的工作区重建，并依次执行：

```powershell
npm.cmd run build
npm.cmd run test:desktop-package
& '.\release\win-unpacked\Athena.exe' --smoke-test
```

若出现 `better-sqlite3` Electron ABI 不匹配，先执行：

```powershell
npm.cmd run rebuild:sqlite:electron
```

## 8. Grok 的建议接手顺序

### P0：保全开发现场

- 重跑第 3 节的只读快照。
- 逐文件阅读 diff，标注每个路径属于 A/B/C/D 哪一组。
- 不碰 `database/`、凭据、本地配置和证明截图。
- 因 remote 为空，在形成第一个提交前先和项目所有者确认备份/远端策略。

### P0：修复新鲜 smoke

- 复现 `liquidMotionReactive=false`。
- 检查 `LiquidGlassRenderer` 的 RAF/可见性/测试时钟与 smoke 等待条件，不要直接删掉动画门。
- 修复后至少连续运行两次 `npm.cmd run smoke:electron`，两次都必须出现 `ATHENA_SMOKE_READY_TO_SHOW` 与 `ATHENA_SMOKE_DOM_OK`。
- 确认 smoke 能继续走到 `ATHENA_SMOKE_UI_STATE`，其中模型真实性、图像设置、直接生图路由和工具权限字段均为 true。

### P0：拆分、审阅并提交

建议提交顺序：

1. 安全默认与本地 overlay，不含用户配置文件。
2. 模型连接诊断与凭据优先级。
3. ComfyUI/本地生图发现、启动与设置 UX。
4. 对应测试和交接文档收口。

每次只使用 `git add <精确路径>`，提交前执行：

```powershell
git diff --cached --stat
git diff --cached --name-only
git diff --cached
```

### P1：消除事实源漂移

- `package.json`、商业路线和发布清单已是 `0.9.6-beta.1`，但根 `README.md` 顶部仍写 `0.9.0-beta.1`；统一时只改当前事实，不重写历史证据。
- `docs/COMMERCIAL_ROADMAP.md` / `docs/PRODUCT_MATRIX.md` 仍把 Live2D 描述为未实现/排除首发；运行时骨架与生产角色的边界应继续由 `docs/LIVE2D_RELEASE_GO_NO_GO.md` 解释，商业文案不能因此提升为已交付。
- 若新图像能力进入可见产品面，更新 `PRODUCT_MATRIX`、隐私数据流和发行检查，明确本地、云端、凭据、联网同意、模型许可和 fallback=`never`。

### P1：形成新包证据

- 新鲜 smoke 通过后再构建。
- 重新执行 package verifier；旧包的 hash/日期不得复用。
- 检查最终 ASAR 和包型排除项，而不是只看源码。
- 无有效 Authenticode 和时间戳时，只能标“unsigned engineering evidence”。

### P2：真实环境人工验收

- 用普通用户流程测试“自动检测 -> 启动 ComfyUI -> 识别 workflow -> 对话生图 -> 再来一张”。
- 分别验证无 ComfyUI、ComfyUI 已安装未启动、已运行、有完整 checkpoint、有 Z-Image Turbo 组件、只有独立模型、缺独立 runtime 等状态。
- 真实云 provider 测试必须由项目所有者确认凭据、费用和远程请求；fixture 不能替代。

## 9. 长期硬边界

- `RELEASE_FEATURES.live2d` 当前为 `false`。这是一道发行硬门，不是用户偏好。
- Live2D runtime 骨架可作本地工程验证；默认角色视觉、真实 Cubism `.moc3`、授权、人工美术审查和公开发行仍是 No-Go。
- 自研分层 2D runtime 可以是中间产品，但没有真实 Cubism rig/export 时不能标成官方 Cubism 模型。
- Companion、Create、Reason、Execute 是同一身份的四种责任；记忆应连续，但工具权限、Project 隔离和 Temporary Chat 边界不能连续“继承授权”。
- Execute 之外的模式始终不能调用电脑工具；Execute 也必须默认 Off 并显式升权。
- 图像、搜索、远程模型、语音和外部工具网络分别有独立同意，不允许一个总开关暗中放行。
- provider 失败不允许静默切换到可能收费或把数据发往别处的服务。

## 10. 仍开放的发布问题

以 `docs/ISSUE_REGISTER.md` 为唯一台账，当前主要外部阻断包括：

- `ATH-REL-001`：代码签名证书、批准 publisher、HTTPS update feed、clean-checkout CI 与真实更新/回滚证据
- `ATH-DESKTOP-001`：真实安装矩阵和 20–50 人受控 Beta
- `ATH-DESKTOP-002`：发行主体、价格税务、支付/许可证平台、公钥、生产激活与签字
- `ATH-STEAM-001`：Steamworks/AppID/Depot/signing/private branch/Valve review
- `ATH-CLOUD-001`：生产 provider、区域、KMS、计费、外部安全与 on-call
- `ATH-MOBILE-001`：Cloud 前置未 Go，且无 iOS/Android 工程和商店证据
- `ATH-OPS-001`：真实责任人、状态页、平台停更/恢复演练与发布签字

这些不是通过补几段代码就能自动关闭的事项。缺少外部账号、证书、费用授权或所有者决定时，应报告 Blocked，不得伪造证明。

## 11. 每一轮交付格式

Grok 每完成一个小阶段，应按下面格式交回：

```text
目标：
范围内改动：
明确未改：
改动文件：
验证命令与退出码：
关键稳定标记：
人工检查：
残余风险/外部阻断：
Git 提交：
Go/No-Go：
下一步可直接执行的输入：
```

只说“已完成”“测试通过”或“应该没问题”不构成交接证据。

## 12. 可直接交给 Grok 的启动指令

```text
你正在接手 G:\Athena。先完整阅读 docs/GROK_HANDOFF_2026-09-02.md、docs/WORK_PROTOCOL.md、docs/ISSUE_REGISTER.md 和 docs/RELEASE_CHECKLIST.md。当前 main@db4b1dc 有重要未提交改动，本地没有 Git remote。禁止 reset/checkout/clean/stash、禁止 git add .、禁止覆盖或提交 config/model.json、config/settings.json、database、凭据、人格私有数据和本机 artifacts。先只读核对 git 状态与 diff，然后优先复现并修复连续两次出现的 smoke 失败：ATHENA_SMOKE_READY_TO_SHOW 之后 liquidFrameBefore=1、liquidFrameAfter=1、liquidMotionReactive=false、ATHENA_SMOKE_DOM_MISSING。不得删除门禁来获得通过。修复后连续跑两次 smoke，并按文档第 11 节报告。未经所有者确认，不做公开发布、真实付费 API 调用或外部平台操作。
```
