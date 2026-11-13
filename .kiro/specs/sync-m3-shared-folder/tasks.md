# Implementation Plan

- [ ] 1. **Migration v5 + ledger helpers** (`src/engine/store/db.ts`)
  - Add `MIGRATIONS` entry v5 `sync-applied-bundle` creating `sync_applied_bundle` (e.g. `bundle_id PK`, `device_id`, `filename`, `applied_at`, `ops`, `hlc_max`) with needed index(es); keep migration idempotent/transactional per existing pattern.
  - Add helpers to check/record applied bundles and to list recent `sync_conflicts` (limit/order) for CLI.
  - Update/extend `tests/migration.test.mjs` (and any count expectations) for v5.
  - _Req: 3,4_

- [ ] 2. **Folder config & status** (`src/engine/sync/folder.ts`, `src/engine/sync/keys.ts`/db state)
  - Implement `setSharedFolder`/clear with group-key-configured guard (`isSyncConfigured`/loadability), path resolve + writable validation, persist folder settings in `sync_state`.
  - Implement `getFolderStatus` (path, exists/writable, last export/import/error, pending counts via existing helpers).
  - _Req: 1,5_

- [ ] 3. **Atomic folder export** (`src/engine/sync/folder.ts`)
  - Implement delta `exportPendingToFolder` reusing M2 export; no-op when nothing pending since last folder export.
  - Generate safe unique filename per device/HLC; write atomically (tmp+rename) and update folder export markers/state.
  - _Req: 2_

- [ ] 4. **Scan/apply with ledger & resilience** (`src/engine/sync/folder.ts`, `apply.ts`/bundle integration as needed)
  - Implement `scanAndApplyFolder`: discover peer `*.memsync`, skip own/partial/already-applied, decrypt+apply via M2 path, record ledger, trigger embedding backfill queue behavior consistent with M2.
  - On decrypt/AAD/group/parse errors: capture/log per-file error, skip, continue; update status error fields.
  - _Req: 3,4_

- [ ] 5. **Watcher & debounce runtime** (`src/engine/sync/folder.ts` or `watcher.ts`, `src/engine/lifecycle.ts`)
  - chokidar watcher on folder (`awaitWriteFinish`), debounced 30 s export, hook into engine start/stop; handle folder missing (`folder_unavailable`) and recovery.
  - Ensure serialized export/apply to avoid races.
  - _Req: 2,3,5_

- [ ] 6. **CLI commands** (`src/engine/sync/cli.ts`, `src/engine/index.ts` wiring if needed)
  - Add `sync folder set <path>` / `--clear`, `sync folder status`, and `sync conflicts [--limit]` with clear output/errors; keep existing sync commands intact.
  - _Req: 1,4_

- [ ] 7. **Integration tests** (`tests/sync-m3.test.mjs`, update `package.json` test script)
  - Two isolated data dirs sharing one temp folder: convergence create/update, delete/tombstone propagation, concurrent edit → LWW + conflict row, idempotent re-apply/no-op, own-bundle ignore.
  - Error cases: bad/tampered bundle skipped; folder unavailable handled gracefully.
  - _Req: 2,3,4,5_

- [ ] 8. **Cleanup & docs/status** (`src/engine/sync/folder.ts`, `docs/sync-design.md`, `ROADMAP.md`, `CHANGELOG.md`)
  - Best-effort cleanup of own bundles older than 14 days (safe/conservative); expose via status/logging as appropriate.
  - Mark M3 implemented in design/roadmap/changelog (English) once complete.
  - _Req: 5_
