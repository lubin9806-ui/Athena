# Athena Chat Windows Manual QA

Scope: desktop Electron UI only. This checklist verifies chat windows, window memory, ContextManager explainability, and Temporary Chat copy. It does not validate Cloud, Mobile, signing, Store, Steam, or packaged release behavior.

## Environment

- Start from a clean Electron run or smoke user-data directory.
- Keep an ordinary Project with at least two persistent chat windows.
- Create one Temporary Chat from the top chat-window bar.
- Open the Memory panel and use the Window tab for the current-window checks.

## Checklist

- Project selector lists only active Projects and switching Project changes the window list without mixing other Project windows.
- New chat window appears in the current Project, becomes active, and the composer remains focused.
- Window selector title, message count, rename, archive, and delete actions remain readable at 480 x 700 and desktop widths.
- Window memory panel shows the current title, Project, mode, message count, update time, goal, conclusions, todos, pinned facts, summary, and context-budget stats without implying that global memory was written.
- Pinning a fact adds it only to the current window memory panel; unpinning removes it without affecting other windows.
- Context budget section distinguishes recent messages, summary, memory count, token estimate, characters, and prompt message count after at least one model turn.
- Temporary Chat button creates an active temporary window labelled as temporary in the selector.
- Temporary Chat badge reads as temporary and explains that content is kept only in this window until it is closed.
- Archive is disabled for Temporary Chat; delete action changes to Close / 关闭.
- Closing Temporary Chat warns that messages and context snapshots will be cleared.
- After closing Temporary Chat, it disappears from the normal window list and another persistent window becomes active.
- Ordinary windows do not show Temporary Chat content in their window memory panel or prompt context.

## Release Boundaries Not Covered

- No packaged installer, AppX, Store, Steam, or signed candidate was verified.
- No live remote provider multi-turn Temporary Chat conversation was verified.
- No Cloud sync, Mobile sync, account, or cross-device behavior was verified.
- No production privacy/security claim beyond local Electron UI behavior was verified.
