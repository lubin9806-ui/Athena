# Athena Chat Windows, Window Memory, and Context Management Handoff

> Acceptance date: 2026-08-04 Asia/Shanghai
> Scope: chat window management, per-window memory continuity, context length management, temporary chat isolation, and related documentation boundaries.

## Conclusion

Engineering handoff: **Go**

Release / GA claim: **No-Go until covered by the normal Desktop release gates**

The current implementation has automated evidence for independent chat windows, per-window rolling summaries, working state, context snapshots, Project instructions scoping, and Temporary Chat isolation. This means the feature can move to the next engineering window for UX polish, manual QA, and broader release integration.

This handoff does not approve a signed beta, Store package, Steam build, Cloud sync, mobile client, or commercial marketing claim.

## Verified Evidence

Commands run from `G:\Athena`:

```text
npm.cmd run typecheck
```

Result: passed.

```text
npm.cmd run test:chat-windows
```

Result: passed with `ATHENA_CHAT_WINDOWS_OK`.

The chat-window verifier uses an isolated temporary SQLite database and covers:

- default chat window creation
- independent Window A / Window B message histories
- rolling summary updates
- working state updates, including last message metadata and user-selection extraction
- pinned facts scoped per window
- prompt construction carrying window summary, working state, and recent messages
- prompt isolation so Window B does not inherit Window A content
- multiple windows under one Project
- Project instructions inheritance and cross-Project isolation
- ContextManager budget pressure and omitted-context explanation
- context snapshot persistence and retrieval
- Temporary Chat continuity while open
- Temporary Chat exclusion from global message history
- Temporary Chat prompt isolation from ordinary windows
- Temporary Chat message and context-snapshot cleanup on close
- rename, archive, and soft-delete behavior

```text
npm.cmd run smoke:electron
```

Result: passed with:

```text
ATHENA_SMOKE_READY_TO_SHOW
ATHENA_SMOKE_DOM_OK
```

The smoke run also reported reactive UI/settings checks in `ATHENA_SMOKE_UI_STATE`.

```text
npm.cmd run test:privacy
```

Result: passed with `ATHENA_PRIVACY_DATA_OK`.

## Implementation Surface Confirmed

Primary implementation surfaces:

- `src/memory/database/index.ts`
- `src/memory/working/index.ts`
- `src/memory/retriever/index.ts`
- `src/core/ai/ContextManager.ts`
- `src/core/ai/PromptBuilder.ts`
- `src/core/ai/Conversation.ts`
- `src/core/controller/AthenaController.ts`
- `src/app/ipc/index.ts`
- `src/app/preload.ts`
- `src/renderer/index.html`
- `src/renderer/app.ts`
- `scripts/verify-chat-windows.js`

SQLite schema now includes the feature-specific structures:

- `projects`
- `chat_windows`
- `chat_messages`
- `context_snapshots`

## Capability Boundaries

Allowed engineering claim:

> Athena now has an engineering-verified local chat-window context system: each window has independent message history, rolling summary, working state, context snapshots, Project instruction scoping, and Temporary Chat isolation.

Do not claim yet:

- commercial GA readiness
- signed/private-beta readiness
- clean-machine packaged validation for this feature
- cross-device window memory sync
- mobile Project/window continuity
- cloud-backed window memory
- encrypted SQLite storage
- perfect recall of all old messages under every context budget

## Residual Risks

- The verifier is strong for service, prompt, and IPC-facing behavior, but this handoff did not include a Playwright-style visual walkthrough of every chat-window UI control.
- The long-chat summary is bounded and rolling, but it is still simple line compaction rather than model-generated semantic summarization.
- Context token estimates are approximate. They are suitable for budget management, not exact model tokenizer accounting.
- Temporary Chat is verified against local/global message history and context snapshots, but package-level clean-user-data validation remains a later release gate.
- This acceptance did not run the full release, Store, Steam, Cloud, voice, or model-provider matrices.

## Next Window Recommendation

Next window: **UX polish and manual QA for chat-window context**

Recommended scope:

1. Exercise all chat-window controls in the actual Electron UI.
2. Verify right-side window memory panel readability and context snapshot display.
3. Add user-facing copy that explains Temporary Chat without overpromising privacy beyond the local implementation.
4. Add a manual QA checklist for A/B window isolation and long-chat behavior.
5. Only after manual UI QA, update product matrix wording if this feature should become a committed Desktop 1.0 capability.
