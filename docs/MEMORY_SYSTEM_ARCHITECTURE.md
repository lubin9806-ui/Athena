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
- Snapshot-level Project identity and per-item retrieval provenance.

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
- `project_notes.project_id` is authoritative. The title string is display and legacy-import metadata only.
- Local semantic retrieval stores a small vector beside keyword ngrams in `memory_index.semantic_vector`. The default provider is an offline hashed ngram vector, and the indexer exposes a narrow `MemoryVectorProvider` seam for a future local embedding model. This is not a remote embedding provider; exact keyword search still works when no embedding provider is installed.
- Persistent, non-archived `chat_windows` summaries and working state share that index. Cross-chat handoff uses direct topic matches first, an installed local semantic provider second, and the most recent eligible window only as the final fallback. The default hashed ngram vector is never presented as semantic paraphrase recall.
- Optional paraphrase recall uses Ollama's loopback-only `/api/embed` endpoint and is disabled by default. Athena batches the current handoff query with up to 24 eligible same-Project window summaries only when keyword matching would otherwise fall back to recency. It does not upload memory, contact a non-loopback endpoint, persist raw embedding vectors, or run for Temporary Chat.
- The configured embedding model defaults to `embeddinggemma`. Status detection reports disabled, unavailable Ollama, missing model, blocked endpoint, or ready without downloading anything. Downloading remains a separate user-click action with the existing confirmation dialog; missing, malformed, or timed-out embedding responses preserve keyword/recent fallback.
- Scoped index rows carry a Project ID before ranking and limits are applied, preventing another Project from crowding out the active Project's candidates.

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
- `scope = 'project'` requires a valid Project ID for all new writes. Legacy project procedures without one remain inspectable but are not prompt-eligible.

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

### 7. Project Document Memory

Tables: `project_documents`, `project_document_chunks`

Purpose:
- Keep validated TXT, Markdown, PDF, and DOCX source files as explicit Project assets.
- Retrieve bounded local text chunks by question instead of inserting whole documents into every prompt.
- Preserve document name, page/section locator, Project ID, parser, size, and SHA-256 provenance.

Implemented behavior:
- PDF.js extracts selectable text page by page; Mammoth extracts DOCX raw text; plain text must be valid UTF-8.
- Ordinary import rejects scanned/image-only PDFs explicitly. The separate scan-PDF action renders missing pages locally and uses bundled Tesseract.js `chi_sim` and `eng` data; mixed PDFs retain `needs_ocr` until every page has extracted text.
- OCR provenance records the local engine and languages. OCR text is treated as untrusted reference data and preserves page locators for source verification.
- Temporary Chat cannot persist documents. Per-document deletion and one-click clear remove the managed source file before deleting database evidence.

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

Every retrieved durable item also produces normalized evidence containing the memory table/id, Project ID when applicable, durable source table/id, review chat window, origin type, and a bounded excerpt. Context snapshots retain that evidence for both included and omitted candidates.

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

The first production `local-vector` adapter is `OllamaMemoryEmbeddingProvider`. It accepts only loopback Ollama endpoints, uses one bounded batch per eligible cross-chat handoff, and validates vector count, dimensions, and numeric values before ranking. For EmbeddingGemma it applies the model's retrieval-specific query and titled-document prompt formats before making that batch request. Its `0.28` similarity floor is provider-specific and calibrated against both paraphrase positives and unrelated-topic negatives; the separate best-versus-runner-up margin still rejects ambiguous matches. Other Ollama embedding models retain the conservative `0.50` default until separately evaluated. Its failure contract is intentionally soft: ordinary keyword and recent-window continuity remain available even when semantic retrieval is disabled or unhealthy.

## Local Embedding Validation

The live validation command is `npm.cmd run test:memory-embeddings:live`. It is intentionally excluded from the default offline suite because it requires an installed and running Ollama embedding model. The mock-backed `test:memory-embeddings` remains the deterministic CI contract.

On 2026-09-14, `embeddinggemma:latest` (`85462619ee72`, 768 dimensions) was validated on the development machine against the checked-in recall fixture:

- Four paraphrase positives selected the intended prior window: accuracy `1.000`, scores `0.3107-0.4172`.
- Four unrelated-topic negatives produced no semantic selection: highest observed candidate score `0.1681`.
- After explicitly unloading the model, warmup completed in `2217.7 ms`; subsequent full handoff batches took `124.6-478.8 ms` in that run.
- The test uses an isolated temporary database and config directory. It does not read or mutate the user's chat database or enable semantic retrieval in personal settings.
