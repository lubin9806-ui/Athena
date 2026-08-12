# Athena Agent Platform Architecture

## Product Contract

Athena is a personal AI workspace with a persistent companion identity. Chat and execution are two phases of one agent, not two assistants. A discussion can produce a durable task, and the same task can later research, request scoped approval, execute, verify, and resume after an application restart.

The agent platform is provider-neutral. Model providers, tools, skills, MCP servers, and UI surfaces connect through explicit contracts instead of being embedded in conversation prompts.

## Delivery Blocks

1. Agent foundation: durable tasks, runs, steps, approvals, artifacts, events, and state transitions.
2. Model adapters: native tool calls and capability-aware routing across supported providers.
3. Agent runtime: one event loop, tool registry, policy engine, checkpoints, retries, and cancellation.
4. Project workspace: roots, goals, task board, plans, artifacts, run history, and resume controls.
5. Skill library: Agent Skills-compatible discovery, installation, versioning, trust, and isolated execution.
6. Integrations: MCP, GitHub, project analysis, image generation, and document workflows.
7. Memory and multimodal routing: scoped memory, provenance, model capabilities, and attachment pipelines.
8. Desktop product closure: native shell behavior, diagnostics, evaluation, reliability, and release gates.

Each block must preserve the active desktop runtime and have a focused acceptance command before the next block takes ownership of the same path.

## Block 04: Project Workspace

- `ProjectWorkspaceService` owns project-scoped roots, goals, task boards, plans, artifacts, history, and recoverable-run queries. Workspace metadata uses optimistic revisions and preserves unrelated Project memory state.
- Execute-mode messages become durable tasks tied to the active Project and chat window. The execution handoff includes the agreed conversation context and Project instructions, then runs through the provider-neutral native-tool runtime from Block 03.
- Main-process IPC validates Project, task, run, and approval identifiers. Task selection and chat-to-task creation enforce Project ownership.
- The execution workspace exposes durable task state, grouped approvals, checkpoints, runtime steps, artifacts, cancellation, and restart-resume controls. Permission settings are re-read before every start or resume.
- Acceptance command: `npm.cmd run test:project-workspace`.

## Block 05: Agent Skill Library

Athena follows the [Agent Skills specification](https://github.com/agentskills/agentskills/blob/main/docs/specification.mdx): `SKILL.md` YAML frontmatter is parsed with a YAML parser, names match directory names, and instructions/resources use progressive disclosure.

- `SkillLibrary` discovers built-in, Project (`.agents/skills`), user, and explicitly configured external roots. It validates package limits, rejects symlinks and path traversal, computes deterministic SHA-256 package hashes, and reports invalid packages as diagnostics.
- Third-party packages are installed transactionally and start as untrusted and disabled. Approval and enablement are separate actions. Content changes produce a new hash and require a new review; quarantine removes runtime eligibility.
- `allowed-tools` is retained as experimental metadata only. It never grants Athena capabilities or bypasses the Agent policy engine.
- `SkillAgentToolBridge` exposes only trusted, enabled skills through `list_skills`, `load_skill`, and text-only `read_skill_resource`. Scripts are never auto-executed. Full instructions load only after model selection, and every actual instruction/resource load records run and step evidence.
- Package hashes are rechecked immediately before instruction or resource access. Privacy export includes trust and invocation evidence; one-click clear removes invocation history while preserving installed packages and explicit trust decisions.
- Acceptance command: `npm.cmd run test:skill-library`.

## Block 06A: MCP Integration Host

Athena uses the official `@modelcontextprotocol/client` SDK and supports stdio plus Streamable HTTP with legacy, automatic, or pinned `2026-07-28` protocol negotiation.

- MCP configurations are stored separately from settings. Local commands, arguments, working directories, environment variable names, remote URLs, and protocol mode are bound to a SHA-256 approval fingerprint. Configuration changes disable the Server and revoke approval.
- Secret values are never accepted in configuration. Stdio receives only the SDK safe environment plus explicitly named variables; HTTP bearer tokens are read from a named process environment variable before each request.
- Local commands are spawned directly without a shell and require exact-command consent before enablement. Remote non-local URLs require HTTPS and the existing external-tool network consent.
- Tool annotations are treated as risk hints from an explicitly approved Server. Missing annotations use the MCP conservative defaults. Read-only calls remain policy-gated; mutating calls always require Agent approval, and potentially destructive calls are critical risk.
- A failed Server is isolated. Configuration revocation, disconnect, process exit, shutdown, and partial connection failure unregister owned tools immediately. Server-driven elicitation is not silently fulfilled.
- Acceptance command: `npm.cmd run test:mcp-integrations`.

## Block 01: Durable Agent Domain

The canonical implementation is under `src/core/agent`. SQLite schema v10 owns these records:

- `agent_tasks`: durable user intent and the normalized `TaskSpec`.
- `agent_runs`: one execution attempt with scene, strategy, provider, model, checkpoint state, phase, and revision.
- `agent_steps`: ordered research, reasoning, tool, or validation operations.
- `agent_approvals`: scoped decisions grouped by an approval checkpoint.
- `agent_artifacts`: code, images, documents, reports, citations, builds, and test evidence.
- `agent_run_events`: append-only audit and recovery events.

`TaskSpec` is the handoff contract between discussion and work. It contains the goal, success criteria, constraints, confirmed decisions, open questions, plan, capabilities, risks, and validation requirements. UI text and raw chat history are not substitutes for this record.

## State Invariants

- Every mutable task, run, step, and approval has a monotonic revision. A stale writer fails explicitly.
- Run phases use a guarded state machine. Terminal runs cannot resume.
- Approval requests create a checkpoint group. Execution can resume only when every decision in the active group is approved.
- Every meaningful run mutation appends an ordered event in the same SQLite transaction.
- Run checkpoint state must be JSON-serializable and sufficient for a runner to continue after restart.
- Task status and active-run ownership are updated transactionally with run phase changes.
- Artifacts remain linked to their task and carry an explicit validation status.

## Migration Boundary

Block 01 does not replace the current `Conversation`, `ToolRuntime`, or renderer flow. It establishes the durable contract that blocks 02 and 03 will adopt. The old fixed in-memory `WorkflowManager` remains temporarily for compatibility and is retired only after the new runner is wired through IPC and UI.

## Block 02: Provider-Neutral Model Adapters

The canonical model protocol is under `src/core/ai/model`. `LLMClient` remains the compatibility facade used by the current conversation and research paths, but delegates transport and protocol details to:

- `OpenAICompatibleAdapter`: OpenAI, DeepSeek, Athena Cloud, and conservative custom endpoints.
- `OllamaAdapter`: local Ollama chat, structured output, native tools, and NDJSON streaming.

The shared contract carries typed messages, function definitions, tool choice, parsed tool calls, streaming events, finish reasons, usage, response formats, cancellation signals, and provider capabilities. Assistant tool calls and tool results remain in message history so block 03 can run a real multi-turn agent loop.

Capability claims are explicit. OpenAI supports strict function schemas. DeepSeek strict schemas are enabled only for `/beta`; stable DeepSeek still uses native tool calls without claiming strict validation. Custom OpenAI-compatible endpoints default to conservative tool-choice capabilities. Ollama tool results are correlated by tool name, while OpenAI-compatible results use call IDs.

Malformed tool argument JSON, duplicate definitions, unsupported tool-choice modes, and references to missing tools fail before execution. Streaming OpenAI function names and argument strings are accumulated by call index; Ollama NDJSON content and tool calls are normalized into the same response type.

Block 02 does not execute tools. The legacy JSON planner remains active until block 03 introduces `AgentRunner` and `ToolRegistry`; that cutover can now consume `LLMClient.chatWithTools()` without provider-specific branches.

Run:

```powershell
npm.cmd run test:model-adapters
npm.cmd run test:model-providers
```

## Block 03: Durable Agent Runtime

The canonical execution kernel is under `src/core/agent`:

- `ToolRegistry` owns versioned tool definitions, Ajv argument validation, retry and timeout contracts, idempotency metadata, redacted persistence views, and normalized results.
- `AgentPolicyEngine` intersects the durable task capability declaration with explicit run grants, then returns allow, approval, or deny. Only that capability intersection is exposed to the model.
- `AgentRunner` owns one native tool-call loop across providers. Model rounds, pending batches, tool results, validation evidence, approvals, and recovery cursors are persisted in the run checkpoint.
- `ComputerAgentToolBridge` adapts the existing permission-gated computer tools without bypassing `ComputerToolService`. Runtime permission is checked again when execution begins, so a permission downgrade remains effective even before registry refresh.

High-risk calls pause the complete model tool batch before any call executes. Approvals bind the run step, tool name, tool version, capability, risk level, call ID, and a canonical argument fingerprint. A changed tool version or strengthened policy requires a new approval.

Tool retries are permitted only for idempotent tools or tools that support an idempotency key. After an interrupted process, a completed step is reconstructed without replay; an uncertain non-idempotent step pauses for a new critical replay approval. Cancellation aborts the active model/tool signal and terminalizes pending steps and approvals.

Required task validations must have explicit passed evidence from tool results before the runner can complete the task. A final model message alone is not verification evidence.

Block 03 is a core-runtime cutover, not the project workspace UI. The current `Conversation` and legacy JSON `ToolRuntime` remain the active renderer path until block 04 provides task creation, run controls, approval surfaces, history, and resume IPC.

Run:

```powershell
npm.cmd run test:agent-runtime
```

The runtime acceptance covers schema rejection, capability denial, grouped approval, restart recovery, bounded idempotent retry, cancellation, duplicate-run locking, non-idempotent replay approval, completed-step reconstruction, validation evidence, tool-version approval invalidation, computer-tool permission revocation, and approval cleanup.

## Block 01 Acceptance

Run:

```powershell
npm.cmd run test:agent-foundation
```

The test migrates a v9 database, verifies the migration backup, creates a project-linked task, checkpoints a run, pauses for approval, closes and reopens SQLite, resumes execution, validates an artifact, completes the run, and rejects stale or illegal writes.
