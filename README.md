# Athena

Athena is a local AI desktop companion built with Electron, Vite, TypeScript, SQLite, and Ollama.

> Status: **Internal Alpha 0.8.0**. This repository is not a signed or store-ready 1.0 release. Commercial scope and release decisions are governed by [docs/COMMERCIAL_ROADMAP.md](docs/COMMERCIAL_ROADMAP.md), [docs/ISSUE_REGISTER.md](docs/ISSUE_REGISTER.md), and [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md).

## Start

```bash
npm.cmd install
npm.cmd run dev
```

This builds the renderer, compiles the Electron main process, and starts the current desktop runtime from `dist/app/main.js`.

## Web search

Web search is enabled by default. Athena automatically searches for time-sensitive requests such as latest news, current prices, weather, scores, or current office holders. Use the `+` menu beside the composer to force web search for the next message. Search behavior, source count, deep-read page count, and secondary search can be changed under **Settings → Web search**.

Search uses Sogou first for direct access in mainland networks, then automatically falls back to Bing China and DuckDuckGo. The research pipeline opens result pages one by one, extracts article/main content plus JSON-LD, hydration JSON, lists, and tables, then issues a refined second query through a different provider when possible. Results are grounded in numbered citations, and the desktop UI shows clickable source cards plus the deep-read and search-round counts below the answer.

## Computer tools

Athena has four explicitly separated top-level modes: **Create** produces creative artifacts, **Companion** handles natural conversation and continuity, **Reason** analyzes and verifies, and **Execute** is the only mode allowed to touch the computer. Switching to Execute opens a dedicated full-page workspace where natural-language goals are converted into real local tool calls. It shows live planning, redacted arguments, results, duration, session history, and a control for stopping subsequent steps.

The single tool permission is adjustable inside the **Execute** workspace:

- **Off**: no computer tools.
- **Read**: read, list, and search files anywhere the current Windows account can access.
- **Files**: full file read/write, including create, edit, copy, move, delete, and conflict-safe batch organization by file type or wildcard.
- **Full**: file access plus persistent PowerShell/CMD sessions, one-shot commands, program launch, HTTP requests, and TCP ports. Athena can write commands or interactive input to a terminal session and read later output in chunks.

Create, Companion, and Reason are permanently **Off** for computer tools; Execute defaults to **Full** and can be changed to any of the four levels. Leaving Execute or lowering its permission immediately applies the lower cap. Dropping below Full closes Athena-managed terminal sessions and permanently lowers any tool task already in progress, so a later mode change cannot restore that task's former access. Every tool call records redacted arguments, status, duration, and result in the Execute workspace instead of underneath a chat reply. Stopping a task prevents later planned steps; any operation already completed is kept and reported rather than silently rolled back. Large file reads, HTTP responses, text searches, batch moves, and structured replacements are bounded so the model cannot exhaust the desktop process with a single tool call.

## Verification

```bash
npm.cmd run typecheck
npm.cmd run audit:security
npm.cmd run test:web-search
npm.cmd run test:web-search:live
npm.cmd run test:web-search:e2e
npm.cmd run test:tools
npm.cmd run test:tools:live
npm.cmd run smoke:electron
npm.cmd run db:stats
```

`smoke:electron` should print `ATHENA_SMOKE_DOM_OK`.

`audit:security` deliberately uses the official npm registry because the configured dependency mirror does not implement npm's advisory endpoint. A non-zero result means the audit ran and found blocking advisories; dependency remediation belongs to Window 02.
