---
inclusion: always
---
# Project structure

- `src/engine/ingest` — per-tool transcript parsers and watchers
- `src/engine/extract` — heuristic + model-based memory extraction
- `src/engine/store` — SQLite schema, migrations, queries
- `src/engine/retrieve` — FTS5 + vector recall, ranking
- `src/engine/mcp` — MCP server (recall/remember tools)
- `src/engine/sync` — HLC, outbox, `.memsync` bundles, apply/LWW
- `src/engine/handoff.ts` — handoff block injection into instruction files
- `src/engine/http.ts` — localhost HTTP API for the dashboard
- `src/electron` — desktop shell · `web/` — dashboard · `tests/` — node:test suites
- Design docs: `docs/sync-design.md`, `ROADMAP.md`
