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

## Block 06B: Native Research and Project Analysis

Execution mode exposes research and project understanding through the same provider-neutral `ToolRegistry` used for files, Skills, and MCP. The model can choose these tools from the confirmed task context; keyword routing is not required.

- `web_research` reuses Athena's governed search and deep-read pipeline. It is registered only while web search is enabled and its specific network consent is active. Every result carries source URLs and collection timestamps and is marked as untrusted external evidence.
- `github_search_repositories` and `github_get_repository` use only the official GitHub REST API origin. Requests pin API version `2026-03-10`, expose rate-limit evidence, stop after rate-limit responses, and optionally read `ATHENA_GITHUB_TOKEN` from the process environment without storing or returning it.
- `project_inspect` is a read-only Project tool. It accepts only roots already registered to the active durable task's Project, skips dependency/build directories and symlinked files, summarizes known manifests and README content within byte limits, and runs non-interactive read-only Git inspection without a shell.
- Network and computer-read revocation is checked again immediately before execution. Resume refreshes the research tool set before the model receives definitions, so stale checkpoints cannot retain revoked capabilities.
- Acceptance command: `npm.cmd run test:research-tools`.

## Block 06C: Document and Image Artifacts

Execution mode can now create inspectable files through the same durable tool and approval runtime. Generated files are written only below the active Project's primary root at `.athena/artifacts/<task-id>`.

- `create_document_artifact` renders structured content locally as Markdown, HTML, DOCX, or PDF. HTML escapes model-provided text, DOCX uses the pinned `docx` package, and PDF uses a sandboxed hidden Electron renderer with networking and JavaScript disabled.
- `generate_image_artifact` uses a provider-neutral interface backed by the official OpenAI Image API generation endpoint and current `gpt-image-2` default. The API key comes from the existing encrypted/environment credential resolver and is never returned to the model or artifact metadata.
- Image generation has a separate default-off `privacy.networkConsent.imageGeneration` gate. Every image request also requires scoped approval because the prompt leaves the device and the call can incur charges. External generation is not treated as replay-safe after an interrupted process.
- Artifact writes reject missing roots, symlinked storage directories, path traversal, Windows reserved filenames, oversized payloads, and cross-Project access. Files are atomically persisted, format-checked, decoded where applicable, hashed with SHA-256, and only then registered with passed validation evidence.
- The execution panel can open a registered artifact only after the main process revalidates its Project ownership, regular-file status, and real path against current workspace roots.
- Task-record clearing does not silently delete generated files from a user's Project. The privacy center names the artifact directory and states that those files remain under user control.
- This block introduced one-shot image generation. Governed reference-image editing is added by Block 07D through the same artifact and approval runtime.
- Acceptance command: `npm.cmd run test:artifact-tools`.

## Block 07A: Governed Image Attachments

Chat and durable execution now share a validated image-input contract. This is image understanding, not image generation: generation remains the separately consented and approved Block 06C artifact tool.

- The renderer receives attachment IDs and bounded preview data only. The main process copies selected PNG, JPEG, or WebP files into Athena-managed storage, rejects symbolic links and path escapes, decodes them with Electron, enforces byte/pixel limits, and records SHA-256 integrity evidence in SQLite schema v11.
- Pending attachments belong to one chat window and Project. They become attached only to a message in that same window, are removed with temporary chats, expire after 24 hours if never sent, and are covered by privacy export metadata and one-click file deletion.
- `ModelMessage.images` carries managed file references instead of base64 payloads, so durable Agent checkpoints remain bounded and restartable. Adapters reload the file only after regular-file, format, size, and SHA-256 checks.
- Ollama image input is enabled only after `/api/show` reports the `vision` capability, then maps to the native `messages[].images` base64 field documented by [Ollama Vision](https://docs.ollama.com/capabilities/vision) and [Show model details](https://docs.ollama.com/api-reference/show-model-details).
- OpenAI image input maps to Chat Completions content parts only for conservatively recognized current OpenAI vision model families. DeepSeek, Athena Cloud, and custom OpenAI-compatible endpoints do not inherit that claim merely because their wire protocol is compatible.
- The composer supports up to five previews with explicit removal. Sent images render from a bounded main-process preview IPC; storage paths never cross the preload boundary. A failed request reconciles database state so unsent attachments remain retryable.
- Text document ingestion is implemented in Block 07C; local OCR and governed reference-image editing are implemented in Block 07D.
- Acceptance command: `npm.cmd run test:chat-attachments`.

## Block 07B: Project-Isolated Memory and Provenance

Durable Project memory now uses Project IDs as the authority. Human-readable titles remain labels; they are not isolation boundaries.

- SQLite schema v12 adds `project_id` to `project_notes`, `procedural_memories`, `context_snapshots`, and scoped `memory_index` rows. The same project-procedure key may exist independently in multiple Projects.
- Retrieval for a chat window includes only that Project's notes and project procedures. Global, mode, tool, and persona procedures remain available across Projects. Legacy project procedures without a Project ID and unmatched or ambiguous legacy notes are retained for administration but excluded from Project prompts.
- Migration backfills a legacy note only when its stored project title matches exactly one Project title, case-insensitively. Duplicate titles never cause an arbitrary assignment.
- Keyword and local semantic candidates are filtered by Project inside `memory_index`, before candidate limits are applied. Keyword ranking is computed before the bounded result set so a crowded Project index does not hide a stronger match.
- `RetrievedContext.evidence` normalizes direct records, approved review items, and temporal fact sources. ContextManager attaches the relevant evidence to each included or omitted snapshot item, and snapshots persist their Project ID.
- The memory panel reports the number of distinct retained sources. Privacy export already includes the underlying review, fact-source, Project, index, and snapshot records.
- Acceptance command: `npm.cmd run test:project-memory`.

## Block 07C: Local Project Document Grounding

Project documents are persistent, local assets rather than oversized chat messages. SQLite schema v13 stores validated source metadata separately from bounded retrieval chunks.

- The composer imports up to five TXT, Markdown, PDF, or DOCX files into the active non-temporary Project. Originals are copied to Athena-managed storage with regular-file, path-containment, byte, format, page, extracted-character, chunk-count, and SHA-256 checks.
- DOCX archives are preflighted for encryption, unsafe paths, malformed directories, excessive entry counts, decompressed size, and abnormal compression ratios before parsing. Multi-file imports are atomic for newly created records: a later failure removes earlier files, rows, chunks, and index entries from that batch.
- DOCX text uses Mammoth's documented `extractRawText({buffer})` API. PDF selectable text uses Mozilla PDF.js' packaged legacy build and per-page `getTextContent()` API. Parsing never invokes Office, Python, a shell, or a remote service. [Mammoth API](https://github.com/mwilliamson/mammoth.js#extractrawtextinput), [PDF.js Node example](https://github.com/mozilla/pdf.js/blob/master/examples/node/getinfo.mjs)
- Image-only/scanned PDFs are rejected by ordinary import with an explicit OCR-required error. Block 07D adds a separate local OCR action instead of silently sending scans to a remote model.
- Local keyword/vector index rows are Project-filtered before ranking. ContextManager receives only relevant chunks, labels each excerpt with document name and page/section locator, and asks the model to cite that locator.
- Retrieval evidence links each chunk back to the source `project_documents` record and bounded SHA-256 evidence. The Project panel lists documents and supports per-file deletion; one-click privacy clear deletes managed source files before database records.
- Temporary Chat cannot create persistent Project documents. Remote models may receive only the retrieved excerpts after the existing remote-model consent; source files are not automatically uploaded wholesale.
- Acceptance command: `npm.cmd run test:project-documents`.

## Block 07D: Local OCR and Reference Image Editing

SQLite schema v14 records whether Project PDFs still contain unextracted scan pages and whether local OCR supplemented their text. OCR and image editing remain separate capabilities with separate trust boundaries.

- `LocalOcrService` runs Tesseract.js in a Node worker with bundled `chi_sim` and `eng` trained data, a local `langPath`, and read-only cache behavior. No OCR CDN or remote vision provider is used. One batch is limited to 20 images, 15 MB each, and 80 MB total, and supports abort-driven worker termination. [Tesseract.js worker API](https://github.com/naptha/tesseract.js/blob/master/docs/api.md), [local installation guidance](https://github.com/naptha/tesseract.js/blob/master/docs/local-installation.md)
- The scan-PDF action accepts at most three PDFs and 20 pages per PDF. PDF.js first preserves any selectable text; only missing pages are rasterized with `@napi-rs/canvas` and OCR'd. Mixed PDFs retain a truthful `needs_ocr` flag until every page has text. OCR results remain untrusted reference data and critical text requires source verification.
- `extract_text_from_images` can read only managed attachment IDs owned by the Agent run's chat window. Both pending and already-attached message images are supported so approval pauses and restart recovery do not invalidate inputs.
- `edit_image_artifact` uses OpenAI's documented `/v1/images/edits` multipart endpoint with one to five validated current-chat references and an optional separate PNG alpha mask matching the first PNG reference. Every call rechecks image-network consent, API credential, write permission, chat ownership, byte/hash integrity, and high-risk approval. [OpenAI image editing guide](https://developers.openai.com/api/docs/guides/image-generation)
- Artifact metadata stores operation type, prompt SHA-256, provider request ID, and reference/mask attachment hashes, but never the API key or raw prompt. The privacy center names both image endpoints and states that approved references leave the device.
- Built-in `local-ocr` and `reference-image-editing` Skills provide progressive-disclosure operating instructions; they do not grant permissions or execute scripts.
- Acceptance commands: `npm.cmd run test:local-ocr`, `npm.cmd run test:artifact-tools`, and `npm.cmd run test:project-documents`.

## Block 08A: Local Diagnostics and Support Evidence

Desktop diagnostics are a local, user-controlled support surface rather than background telemetry.

- `DiagnosticsService` builds a bounded health snapshot from runtime versions, SQLite schema/quick-check, storage sizes, capability states, and aggregate Agent/extension counts. It does not perform network probes or upload data.
- The ZIP support bundle contains only `README.txt`, `health.json`, minimized crash metadata, and a SHA-256 manifest. It excludes chat and memory text, task titles/goals, tool inputs/results, commands, URLs, model names, attachments, documents, raw stack traces, credentials, and full user paths.
- Crash JSONL remains secret-redacted, 1 MB per active file, and at most three rotated files. Rotation removes the oldest destination before rename so Windows does not fail on an existing `.3` file. Diagnostic failures are swallowed by the crash monitor to avoid a second process failure.
- The privacy center shows the local health state and offers explicit support-bundle export and diagnostics-only deletion. Athena never uploads a support bundle automatically, and deletion targets only the four known crash filenames rather than recursively removing a configured directory.
- Acceptance command: `npm.cmd run test:diagnostics`.

## Block 01: Durable Agent Domain

The canonical implementation is under `src/core/agent`. These records were introduced in SQLite schema v10; current schema v14 adds governed attachments, Project-isolated memory, local document grounding, and OCR provenance without changing their contracts:

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
