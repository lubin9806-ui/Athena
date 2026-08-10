# Athena Memory System Architecture

This document defines Athena's local-first memory architecture. The goal is to give the assistant continuity similar to modern personalized AI assistants while keeping the data model inspectable, private by default, and small enough to run inside the desktop app.

## References

Athena's direction is informed by current agent-memory systems, but the runtime remains local-first and SQLite-backed unless the user explicitly enables a remote provider.

- Mem0: multi-level user/session/agent memory and personalization API.
  https://github.com/mem0ai/mem0
- LangGraph / LangMem: short-term versus long-term memory, with semantic, episodic, and procedural memory types.
  https://docs.langchain.com/oss/python/concepts/memory
  https://langchain-ai.github.io/langmem/concepts/conceptual_guide/
- Letta / MemGPT: recall memory and archival memory, treating context like a managed working set instead of dumping all history into the prompt.
  https://github.com/letta-ai/letta
- Graphiti / Zep: temporal context graphs, provenance, validity windows, and hybrid retrieval over evolving facts.
  https://github.com/getzep/graphiti

## Design Goals

1. Remember what matters across days, projects, and chat windows.
2. Avoid unlimited raw-history stuffing that makes context noisy and slow.
3. Keep each memory item explainable: source, date, importance, confidence, and retention state.
4. Separate temporary chat, active-window context, long-term user facts, project facts, daily summaries, procedural rules, and temporal facts.
5. Make retention gradual: memory fades by importance between day 365 and day 730, instead of being deleted all at once.
6. Preserve privacy controls: history-off stops new long-term extraction, Temporary Chat stays isolated, and one-click clear removes derived summaries too.

## Memory Layers

### 1. Working Memory

Tables: `chat_windows`, `chat_messages`, `context_snapshots`

Purpose:
- Current chat window continuity.
- Rolling window summary.
- Pinned facts and working state.
- Prompt-budget debugging through context snapshots.

Retrieval rule:
- Only the current chat window is loaded.
- Temporary windows stay isolated and are deleted when closed or on startup cleanup.

### 2. Recall Memory

Table: `messages`

Purpose:
- Searchable saved conversation history for non-temporary chats.
- Useful for recent continuity and forensic debugging.

Retention:
- Controlled by the user-facing chat history retention setting.
- Not a substitute for long-term memory; old raw messages should not be the primary memory surface.

### 3. Episodic Memory

Tables: `events`, `daily_memory_summaries`

Purpose:
- `events`: extracted important things that happened.
- `daily_memory_summaries`: one compact daily summary generated the next day from saved messages and extracted events.

Implemented policy:
- Daily summaries are generated heuristically when no model is available, and are LLM-refined on startup when local Ollama or an explicitly consented remote model is reachable.
- Refined summaries are stored with `summary_method = 'llm-refined'`; fallback summaries use `summary_method = 'heuristic'`.
- Day 0-365: raw events are fully retrievable.
- Day 366-455: raw events need importance >= 5.
- Day 456-546: raw events need importance >= 6.
- Day 547-637: raw events need importance >= 7.
- Day 638-730: raw events need importance >= 8.
- After day 730: default retrieval stops.
- Raw events are pruned only after that date has a daily summary, so unsummarized history is not silently erased.

### 4. Semantic Memory

Tables: `profile`, `project_notes`
Index: `memory_index`

Purpose:
- Stable facts about the user, preferences, habits, health notes, and active projects.
- Project-scoped decisions, status, and constraints.
- Local semantic retrieval stores a small hashed vector beside keyword ngrams in `memory_index.semantic_vector`. This is not a remote embedding provider; it is an offline lexical-semantic fallback used to rank near matches when exact keyword search is weak.

Retention:
- Not governed by daily decay.
- Should be edited, superseded, or deleted explicitly.

### 5. Procedural Memory

Current storage:
- Persona card.
- Settings.
- Project instructions.
- High-confidence profile facts.
- `procedural_memories`

Purpose:
- Learned response rules, recurring user preferences, tool-use lessons, and "how Athena should work with this user" notes.
- Examples: "when the user says test, run focused regression proof", "for Athena release work, give Go/No-Go handoffs", "do not treat Temporary Chat as long-term memory."

Safety rule:
- Procedural memories are retrieved into context, but automatic creation should stay gated behind explicit extraction, evidence, and review controls.
- They must not silently override system instructions, project instructions, or privacy settings.

Review flow:
- New procedural and temporal candidates enter `memory_review_queue` unless they satisfy a narrow auto-apply rule.
- Pending duplicates are merged by `group_key`, so repeated extraction does not flood the queue.
- The service layer supports single-item and batch approve/reject operations; approval is the boundary that writes pending procedural or temporal memory into the active tables.

### 6. Temporal Graph Memory

Current storage:
- `memory_entities`
- `memory_facts`
- `memory_fact_sources`

Purpose:
- Facts that change over time, with validity windows and provenance inspired by Graphiti/Zep.
- Examples: "the active release target is X", "the current memory architecture is v7", "the preferred model changed from A to B."

Implemented behavior:
- Adding a temporal fact supersedes an existing active fact with the same subject and predicate unless explicitly disabled.
- Retrieval returns active facts with no `valid_to`.
- Sources can point back to the table/id or quote that produced the fact.

## Retrieval Cascade

The prompt should be assembled in this order:

1. System/persona/project instructions.
2. Current user input.
3. Recent current-window messages.
4. Pinned facts and working state.
5. Current-window rolling summary.
6. Procedural memories.
7. Project memory.
8. Semantic profile facts.
9. Temporal facts.
10. Episodic events still inside the decay policy.
11. Daily summaries inside the 730-day horizon.
12. Older raw history snippets only if budget remains.

The ContextManager remains responsible for token-budget pruning and must log why lower-priority items were omitted.

## Maintenance Jobs

On startup:
- Clean temporary chat windows.
- Apply user-configured data retention.
- Generate due daily summaries, normally yesterday and recent missing days, with LLM refinement when the configured model is available.
- Apply memory retention decay.
- Rebuild the retrieval index.

Future scheduled job:
- Run daily shortly after local midnight.
- Generate the prior day summary.
- Re-score importance and confidence.
- Compact or prune raw events according to the decay ladder.
- Record a maintenance audit item.

## Adapter Strategy

Athena should not directly depend on cloud memory systems by default. If external memory packages are introduced, they should sit behind a `MemoryProvider` interface:

- `local-sqlite`: default, required, offline.
- `local-vector`: optional embedding search using a local model.
- `temporal-graph`: optional graph retrieval over local tables or a local graph engine.
- `remote-memory`: optional only with explicit network consent.

This keeps the product truthful: local memory works without accounts, while advanced providers can be added later without rewriting prompt assembly.
