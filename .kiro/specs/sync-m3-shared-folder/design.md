# Design: Sync M3 — Shared Folder Sync

## Overview
Add a folder transport on top of M2. Reuse existing primitives: `src/engine/sync/{crypto,keys,bundle,export,apply,embed}.ts`, HLC/entity clocks/tombstones/conflicts/seen-ops in `src/engine/store/db.ts`, and `sync_state`/settings patterns. No new crypto format; `.memsync` stays M2-compatible.

## Components & responsibilities
- **`src/engine/store/db.ts` (migration v5)** — add `sync_applied_bundle` ledger, e.g.
  - `bundle_id TEXT PRIMARY KEY` (header fileId), `device_id TEXT`, `filename TEXT`, `applied_at INTEGER`, `ops INTEGER`, `hlc_max TEXT`, `source TEXT` (`import`/`folder`)
  - indexes as needed for cleanup/status; helper funcs `recordAppliedBundle`, `isBundleApplied`, `listRecentConflicts`, `pruneOwnBundlesLedger?` (as appropriate).
- **`src/engine/sync/folder.ts`** — folder orchestration (pure-ish, testable with temp dirs/dbs):
  - `setSharedFolder(path|null, opts?)`: load/require group key (configured & unlockable), validate/writable check, persist `sync.folder.path`/enabled flags in `sync_state`, return status.
  - `getFolderStatus()`: path, available, watcher active, pending counts, last export/import/error fields.
  - `exportPendingToFolder(opts?)`: if no pending delta since last folder export, no-op; else call M2 export to write `<deviceId>-<safeHlcOrTs>.memsync` atomically (tmp+rename in folder), update folder export markers/state.
  - `scanAndApplyFolder(opts?)`: enumerate `*.memsync`, skip own-device files and already-applied `bundle_id` (and/or filename guard), wait/stable-read, `readBundleFile`+`applySyncBundle` per file, record ledger on success (including already-applied-from-manual cases if detectable), queue/process embedding backfill consistent with M2, collect per-file errors without aborting scan.
  - `cleanupOwnBundles(maxAgeDays=14)`: best-effort delete only this device’s old bundles.
- **`src/engine/sync/watcher.ts` (or integrated in folder.ts/lifecycle)** — runtime watcher:
  - chokidar watch on configured folder with `awaitWriteFinish`, ignore initial optional per strategy; on add/change of peer bundles trigger debounced `scanAndApplyFolder`.
  - 30 s debounce timer for `exportPendingToFolder` when outbox advances / on schedule; start/stop with engine lifecycle (`startBackgroundJobs`/server) and on config change.
  - Folder missing/unreadable → stop/pause watcher, set last error/status `folder_unavailable`, recover when available.
- **`src/engine/sync/cli.ts` + `src/engine/index.ts`** — CLI surface:
  - `sync folder set <path>|--clear`, `sync folder status` (print human-readable status/errors).
  - `sync conflicts [--limit N]` (read from `sync_conflicts`).
  - Wire `folder` subcommand dispatch in `runSyncCommand` and ensure `index.ts` routes `sync` as today.
- **(Optional, if trivial)** `src/engine/http.ts` — only if needed for dashboard parity; not required for M3 core (CLI/engine first).

## Data flow
- **Export:** local mutation → outbox/entity clocks → debounce/export tick → `exportBundle` (delta) → atomic write to folder → update `last_export_*`/folder state.
- **Import:** peer writes bundle → watcher detects stable file → ledger/idempotency check → decrypt+apply (single-transaction, LWW/tombstone, conflict log, seen ops) → record ledger + last import → embed backfill queue.
- **State:** reuse `sync_state` keys (`last_export_hlc`, `last_import_*`) plus folder-specific keys as needed; ledger in SQLite is the source of truth for “applied”.

## Correctness & safety notes
- Never treat filename alone as proof of apply; prefer header `fileId` recorded in `sync_applied`/ledger. Maintain compatibility with M2 `sync_applied` table/checks.
- Sanitize device/hlc in filenames; be tolerant of other files in folder.
- Bound work per scan/export tick; catch per-bundle errors (log, continue). Do not crash watcher on bad peer file.
- Concurrency: serialize export/apply per process (DB transactions + in-process guard) to avoid races.

## Testing strategy (node:test, against `dist/`)
- Migration v5: table/index creation, idempotent migration on existing v4 DB.
- Folder config: rejects without group key; accepts writable temp dir; status reflects clear/unavailable.
- Two temp data dirs + one shared temp folder (helper to init/apply per dir): A creates → B imports; A deletes → tombstone on B; concurrent conflicting edits → deterministic LWW winner + conflict row; re-scan/re-apply same bundle → no-op/ledger prevents duplicate effects.
- Failure cases: tampered/foreign-key bundle skipped with error; partial file not applied before stable rename (simulate via atomic write); cleanup removes only own old files.
- Run via `npm test` suite additions (e.g. `tests/sync-m3.test.mjs`) once implemented.
