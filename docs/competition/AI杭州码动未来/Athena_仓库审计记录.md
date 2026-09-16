# Athena 参赛材料仓库审计记录

审计日期：2026 年 9 月 15 日  
工作目录：`G:\Athena`  
材料目标：只读分析业务实现并生成参赛附件，不修改现有业务源码。

## 1. 版本与工作树状态

- `package.json` 版本：`0.9.7-beta.1`，描述为 private beta candidate。
- 当前分支：`codex/ci-green-0.9.7`，相对远端 ahead 11。
- 当前 HEAD：`39f5b4a fix(ui): show approval code character for character`。
- 工作树不是干净状态。审计开始时已有 `src/core/cloud/CloudProtocol.ts` 修改和 `src/core/cloud/CloudSyncState.ts` 未跟踪文件；审计过程中并行产生的 Agent、工具、IPC、Renderer 和测试改动随后已提交为 5 个提交。本任务没有编辑这些业务源码，也没有还原或覆盖它们。
- 最终材料以这些提交完成并重新通过类型检查与相应测试后的当前工作树为准；既存 Cloud 改动仍未提交，因此它仍不是完全可复现的签名发行基线。

## 2. 实际装配主链

`src/core/controller/AthenaController.ts` 在主进程中实际装配模型客户端、消息路由、Project 工作区、AgentStore、ToolRegistry、ComputerAgentToolBridge、记忆/上下文、OCR、文档/图像成果、Skills、MCP 与研究工具，并在 Execute 请求中创建持久化任务、检索上下文、刷新工具注册、启动 AgentRunner、处理审批/取消/恢复和返回结果。

`src/core/agent/AgentRunner.ts` 当前采用模型原生 `tool_calls`：模型提出调用，ToolRegistry 解析 schema、持久化参数与审批预览，AgentPolicyEngine 决定允许/拒绝/审批，工具结果再作为 tool message 回到模型。默认执行预算为 16 轮模型调用和 48 次工具调用；预算耗尽会生成可持久化决策门，用户可追加同等预算或停止并让模型在禁用工具的情况下总结真实进度。

## 3. 当前可证实能力

| 能力 | 当前结论 | 主要代码依据 | 证据等级 |
|---|---|---|---|
| 自然语言任务入口 | 已实现；默认规则路由，可选语义复核 | `AgentMessageRouter.ts`、`AthenaController.ts` | 源码 + 45 夹具 |
| 连续自主执行 | 已实现 / Beta | `AgentRunner.ts` | 源码 + Agent runtime 回归 |
| 动态规划 | 已实现于工具循环 | `AgentRunner.ts` | 源码 + 夹具；无执行前结构化计划 |
| 任务持久化 | 已实现 | `AgentStore.ts`、`ProjectWorkspaceService.ts` | 源码 + Project workspace 回归 |
| Windows 文件/命令工具 | 22 个已实现 | `ComputerToolCatalog.ts`、`ComputerTools.ts` | 源码 + 工具服务测试 |
| 通用 GUI 自动化 | 未实现 | 工具目录无鼠标、键盘、屏幕控制 | 代码目录反证 |
| 逐项审批 | 当前源码已实现 | `agentRunPresentation.ts`、`app.ts`、IPC、Controller | 源码 + approvalItems/per-call 回归；缺实机截图 |
| 自动执行位置保护 | 当前源码已实现 | `AutoExecutedLocations.ts`、`ToolRuntime.ts` | 源码 + Agent runtime 专项夹具 |
| 结果可信度 | `verified/unverified/issues/not_applicable` | `agentVerification.ts`、`AgentRunner.ts` | 源码 + 失败/恢复回归 |
| 普通任务自动验收 | 部分实现 | task 默认 `validation: []` | 源码；多数普通任务仍 unverified |
| 多层本地记忆 | 已实现 / Beta | `src/memory/`、`ContextManager.ts` | 源码 + 记忆测试 |
| 多模型 | Ollama/OpenAI-compatible 适配已实现 | 模型 adapters、`LLMClient` | 契约/运输失败夹具；非真实付费请求 |
| 附件与 OCR | 常用格式和本地 OCR 已实现 | `AttachmentService`、`LocalOcrService` | 格式/OCR 测试 |
| PDF 输入 | 当前损坏 | `ProjectDocumentService.ts:358` | 源码缺陷 + 假绿测试审计 |
| 文档成果 | MD/HTML/DOCX/PDF 已实现 | `ArtifactAgentToolBridge.ts`、`DocumentArtifactService.ts` | 成果测试；与 PDF 输入链分开 |
| 语音 | 本地 STT/TTS 代码与依赖已实现 / Beta | Voice services/runtime | 逻辑 + 依赖导入；非真实设备 E2E |
| Skills / MCP | 受控扩展框架已实现 | `SkillAgentToolBridge.ts`、`McpIntegrationHost.ts` | 源码 + 回归；Skill 不自动执行脚本 |
| Web 研究 | 已实现 / 实验性 | `ResearchAgentToolBridge.ts`、`WebResearchAgent.ts` | 源码 + 夹具；无服务 SLA |

## 4. 当前不能写成“已实现”的能力

1. 通用鼠标、键盘、截图理解和任意 Windows GUI 控制。
2. 执行前可审阅、可编辑、带依赖与验收条件的细粒度计划。当前任务仍有通用起始步骤，真实细分来自运行工具步骤。
3. 所有普通任务的自动内容级验收。没有 required validations 时只能标记 `unverified`；未恢复失败或拒绝会标记 `issues`。
4. 稳定 PDF 项目文档输入。当前 `document.destroy()` 与 pdfjs v6 生命周期不匹配，验证脚本又存在静默退出/固定成功标记问题。
5. 已完成真实云模型、真实麦克风/扬声器、干净设备、签名安装包或商店发布验证。
6. Athena Cloud 生产级服务。
7. Live2D 当前产品能力。`releaseFeatures.ts` 中 gate 为关闭。

## 5. 最终验证记录

以下命令在当前工作树执行；每条单独检查退出码：

| 命令 | 结果与关键标记 | 解释 |
|---|---|---|
| `npm.cmd run typecheck` | PASS | 当前 TypeScript 工作树可编译 |
| `npm.cmd run test:agent-foundation` | PASS | Agent 基础对象与事件链 |
| `npm.cmd run test:agent-runtime` | PASS；`verdicts=rerun-recovered,abandoned-kept`；`outage=reset-parked-resumed...`；`budget=rounds-extended...`；`approvalItems=command-write-http-mixed` | 验证失败不被掩盖、断线恢复、预算门与逐项审批 |
| `npm.cmd run test:project-workspace` | PASS；`approvals=per-call` | Project 隔离、任务、审批与运行 |
| `npm.cmd run test:tools` | PASS，含权限撤销、取消、高风险确认和模式隔离标记 | 计算机工具主链 |
| `npm.cmd run test:agent-routing` | 45 夹具，accuracy 1.000，safety false positives 0 | 夹具表现，不外推开放域 |
| `npm.cmd run test:model-adapters` | PASS；OpenAI calls 10、Ollama calls 4；覆盖断线、拒绝、TLS、DNS、503/404、截断、超时分类 | 本地 HTTP 夹具，不是付费供应商在线调用 |
| `npm.cmd run test:memory-recall-evals` | keyword 1.000；default paraphrase 0.000；provider paraphrase 1.000 | 明确默认语义缺口 |
| 附件、格式、OCR、Artifact、Skills、MCP、Research 测试 | PASS | 各自为模块/夹具证据 |
| `npm.cmd run test:voice-runtime` | PASS；files=3735 | 依赖与 import，不是麦克风 E2E |
| `npm.cmd run smoke:electron` | PASS；`ATHENA_SMOKE_READY_TO_SHOW`、`ATHENA_SMOKE_DOM_OK` | 当前源码构建后的桌面运行，不是签名包 |
| `npm.cmd run test:execute:e2e` | PASS；fixture-outage-retry、fixture-budget-summary、fixture-approval-items | 固定模型夹具驱动真实 Renderer，覆盖断线恢复、预算停止总结和逐项审批；非 live 模型 |

## 6. 已确认的假绿测试

`npm.cmd run test:project-documents` 会在 Electron 脚本之后额外执行固定 `console.log('ATHENA_PROJECT_DOCUMENTS_OK ...')`。直接执行：

```text
.\node_modules\.bin\electron.cmd scripts\verify-project-documents.js
DIRECT_EXIT=0
```

验证脚本没有输出完成标记且静默退出；同时源码仍存在 `await document.destroy()`。因此报名材料不把 PDF 输入列为可用能力，且将该问题列为比赛前 P0。

## 7. 素材真实性结论

`docs/brand/ui-shots/` 是实际运行时界面截图，但多为空状态；可用于说明 UI，不能证明完整 Agent 任务。`assets/steam/screenshots/` 为较早运行版本；概念板、角色原型和 Live2D 资产不能用作当前实现证据。比赛级证明仍需补拍 Project、工具步骤、逐项审批、Windows 前后状态、真实成果与验证状态。

## 8. 审计结论

Athena 已具备可运行的超级智能体核心主链，Readiness 评为 **B**。其最强证据是原生工具调用、持久化任务、Windows 文件/命令工具、逐项审批、断线/预算恢复、分层本地记忆和真实文档成果。阻止其进入 A 级的主要因素是：计划与自动验收不完整、PDF 输入与测试可信度缺陷、缺少最终构建的真实无剪辑 E2E 和用户数据。
