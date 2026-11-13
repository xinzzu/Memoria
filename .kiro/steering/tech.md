---
inclusion: always
---
# Tech & workflow

## Stack
- **Runtime:** Node.js >= 22.5, TypeScript (CommonJS, `tsc -p tsconfig.engine.json` → `dist/engine/`).
- **Storage:** `node:sqlite` `DatabaseSync`, WAL, migrations via `PRAGMA user_version` in `src/engine/store/db.ts` (MIGRATIONS array; v1 FTS5, v2 embedding BLOB, v3 sync UID/outbox, v4 sync LWW metadata; M3 will add v5).
- **Search:** FTS5 external-content trigram (`memories_fts`) + Float32 BLOB embeddings in `src/engine/retrieve/search.ts`/`vecfind.ts`/`vecindex.ts`. **Never compare vectors across `embed_model` dialects.**
- **Ingestion:** chokidar watchers + per-tool parsers in `src/engine/ingest/` (watcher, scanner, tool-specific parsers). Session-idle/resume logic in lifecycle/extractor/handoff.
- **Extraction:** tiered providers in `src/engine/extract/` — heuristic (always), Ollama, OpenAI-compatible; batch embeddings via `embedManyVia` where available.
- **Desktop/UI:** Electron (`src/electron/`, tray/shortcuts/safeStorage), vanilla JS dashboard in `web/` (app.js + i18n.js, SSE live via engine events, no framework).
- **Sync (M1/M2):** stable UUIDs, `updated_by`, HLC + outbox/entity clocks/tombstones/conflict+seen-op ledgers/embed queue/project aliases (`src/engine/store/db.ts`, `src/engine/sync/*`). `.memsync` = `MEMSYNC1` header + AAD + AES-256-GCM (HKDF-SHA256 per file) + gzip JSONL ops. Keys: `enc1:` safeStorage / `pass1:` scrypt / `MEMORIA_SYNC_KEY`; recovery code (Crockford base32). CLI: `node dist/engine/index.js sync setup|status|export|import`.

## Commands
- Build: `npm run build` · Test: `npm test` (build + `node --test` on **dist/**) · UI audit: `npm run check:ui`
- Isolated server: `MEMORIA_DATA_DIR=$(mktemp -d) HOME=$(mktemp -d) node dist/engine/index.js server` (port 48210 by default)
- Scan/recall/MCP: `node dist/engine/index.js scan|recall "<q>"|mcp`

## Hard constraints & gotchas
- **Never touch live `~/.memoria` or port 48210 in dev/tests.** Use `MEMORIA_DATA_DIR=$(mktemp -d)` or `dbmod.initDb(tmpDir)`; fake `HOME` avoids chokidar watching huge session dirs (EMFILE).
- **Tests run against `dist/`**, not `src/` — always build before testing changes. `npm test` runs: core, migration, webhook, openai-embed, sync-m1, sync-crypto, sync-m2.
- `node:sqlite` returns null-prototype rows — access properties explicitly (don’t coerce whole rows). `#overlay`/`#toast-wrap` must be direct `<body>` children (guarded by `check:ui`).
- UI text: English keys via `t()`, translations in `web/i18n.js`; **no emoji** in UI chrome. `CHANGELOG.md`/release notes in English; chat may be Indonesian.
- Git: conventional commits; work on `feat/...`/`fix/...`, PR, merge commit (`--no-ff`), delete branch. **Never commit unless explicitly asked.** Never commit secrets.
