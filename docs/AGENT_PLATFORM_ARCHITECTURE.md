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

## Acceptance

Run:

```powershell
npm.cmd run test:agent-foundation
```

The test migrates a v9 database, verifies the migration backup, creates a project-linked task, checkpoints a run, pauses for approval, closes and reopens SQLite, resumes execution, validates an artifact, completes the run, and rejects stale or illegal writes.
