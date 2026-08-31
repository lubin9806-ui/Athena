# Cross-mode memory continuity

Athena treats companion, creation, reasoning, and execution as four responsibilities of one role inside one chat window. A mode switch changes behavior and tool access; it does not create a new identity or clear the conversation's memory.

## Continuity layers

1. **Raw window history** — `chat_messages` remains the source of truth for the current conversation. Messages retain their original mode so the prompt can distinguish a creative proposal from a reasoning review or an execution result.
2. **Structured working state** — `chat_windows.working_state` keeps bounded mode checkpoints, transitions, explicit user decisions, open questions, and agreed next actions. This state survives application restarts and is visible in the window-memory panel.
3. **Reviewed long-term and Project memory** — profile, procedural, temporal, event, and Project candidates continue through the existing review queue. A mode switch never bypasses review or turns temporary brainstorming into approved durable memory.
4. **Durable execution tasks** — when execution starts, the current role card, Project instructions, approved memories, structured handoff, mode-labelled history, task decisions, and unresolved questions are passed into the Agent task.

## Expected flow

```text
Creation: agree on a direction and next step
    -> Reasoning: verify assumptions, risks, and unresolved questions
        -> Execution: inherit the same role, decisions, memory, and Project scope
            -> Execution result returns to the same window and updates its checkpoint
```

The user should be able to say “continue with the plan we just agreed on” after switching modes. Athena should use the current window's handoff instead of asking for the whole background again.

## Isolation and privacy

- Chat windows remain isolated from sibling windows.
- Project instructions and Project memory never cross Project boundaries.
- Temporary Chat keeps in-session continuity but cannot create durable tasks or long-term memory.
- Only explicit user decisions are promoted into `confirmedDecisions`; assistant proposals remain available through checkpoints and raw history until the user confirms them.
- Approved long-term memory is available in execution, but pending or rejected review candidates are not.
- Recalled history and memory provide context only. They never grant tool capabilities, expand Project scope, or replace runtime approval.

## Verification

Run:

```powershell
npm.cmd run typecheck
npm.cmd run test:chat-windows
npm.cmd run test:project-workspace
npm.cmd run test:memory-retention
npm.cmd run test:persona
npm.cmd run smoke:electron
```

The focused tests cover a creation decision, a reasoning open question, a switch to execution, role-card/runtime-memory injection, mode-labelled history, Project isolation, and Temporary Chat restrictions.
