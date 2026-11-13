---
inclusion: always
---
# Tech stack

- Node.js >= 22.5, TypeScript (CommonJS), `node:sqlite` with WAL. Schema migrations via `PRAGMA user_version`.
- Search: SQLite FTS5 (trigram) + Float32 BLOB embeddings with model-dialect guards (never compare vectors across models).
- Ingestion: chokidar watchers + per-tool parsers in `src/engine/ingest`.
- Desktop: Electron (`src/electron`), vanilla JS dashboard in `web/` with SSE live updates.
- Secrets: Electron safeStorage / OS keychain.
- Sync: stable UUIDs, HLC + outbox, LWW with tombstones, encrypted `.memsync` bundles (AES-256-GCM, HKDF, scrypt passphrase).

## Commands
- Build: `npm run build` · Test: `npm test` (node:test) · UI audit: `npm run check:ui`
- Run server isolated: `MEMORIA_DATA_DIR=$(mktemp -d) node dist/engine/index.js server`
- Never migrate the real `~/.memoria` DB outside the app.
