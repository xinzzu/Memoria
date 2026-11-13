---
inclusion: always
---
# Project structure & key entry points

## Engine (`src/engine/`, built to `dist/engine/`)
- `index.ts` — CLI entry (`scan|extract|recall|mcp|backup|handoff|integrate|server|sync ...`).
- `config.ts` — paths/config resolution (`MEMORIA_DATA_DIR`, data dir layout).
- `http.ts` — localhost HTTP API for dashboard (SSE/events, memories/projects/settings/handoff/resume/notify; guards `sync.groupKey` direct writes).
- `lifecycle.ts` — background jobs (auto-backup/archive, embed backfill queue processing, sync tombstone prune, housekeeping).
- `handoff.ts` — session resume/handoff block generation & injection into `AGENTS.md`/`CLAUDE.md`/`GEMINI.md`.
- `events.ts` — in-process event bus (SSE/notify).
- `store/db.ts` — schema, migrations, queries, sync state/helpers (UID/HLC/outbox/entity clock/tombstones/conflicts/seen ops/embed queue/aliases, snapshot & capture functions).
- `store/backup.ts`, `store/secure.ts` — backups, safeStorage/encryption helpers.
- `ingest/` — `watcher.ts` (chokidar), `scanner.ts`/`manager.ts`, per-tool parsers.
- `extract/` — `extractor.ts`, `provider.ts` (heuristic/Ollama/OpenAI-compat + embedding/batch), prompts/topics.
- `retrieve/` — `search.ts` (FTS5 + vector rerank, keywordScore), `vecfind.ts`, `vecindex.ts`.
- `mcp/` — MCP server and tool handlers.
- `sync/` — `crypto.ts`, `keys.ts`, `bundle.ts`, `export.ts`, `apply.ts`, `embed.ts`, `cli.ts` (M1/M2); M3 adds folder transport/watcher/ledger/conflicts.
- `notify/`, `summary/`, `git.ts`, `scan.ts`.

## Desktop & UI
- `src/electron/` — main process (tray, global shortcuts, safeStorage integration).
- `web/` — vanilla dashboard (`index.html`, `app.js`, `i18n.js`, assets/CSS). SSE-driven live updates.

## Tests & docs
- `tests/*.test.mjs` — `node:test` suites executed against `dist/` (core, migration, webhook, openai-embed, sync-m1, sync-crypto, sync-m2).
- `docs/sync-design.md` — encrypted sync design/status (M1/M2 done, M3–M5 pending). `docs/superpowers/specs/*` — feature specs (e.g. demo video).
- `ROADMAP.md`, `CHANGELOG.md`, `AGENTS.md`, `README.md` — plan/status/history/conventions.
- `scripts/` — `audit-ui.js` (`check:ui`), `bench-f1c.mjs`, build helpers. `video/` — Remotion demo project (local artifact).
