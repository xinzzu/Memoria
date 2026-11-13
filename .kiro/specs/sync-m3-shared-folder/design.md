# Design: Sync M3 — Shared Folder Sync

## Overview
Reuse M2 primitives (`.memsync` encode/decode, apply, LWW, tombstones). Add a folder transport with a chokidar watcher, an applied-bundle ledger, and a conflict-log reader.

## Components
- `src/engine/sync/folder.ts` — `setSharedFolder(path)`, `exportPending()`, `scanAndApply()`.
- `src/engine/sync/watcher.ts` — chokidar on the shared folder (`awaitWriteFinish`), debounced export timer (30 s).
- Migration v5: table `sync_applied_bundle(bundle_id TEXT PRIMARY KEY, device_id TEXT, applied_at INTEGER)`.
- CLI: `memoria sync folder set|status`, `memoria sync conflicts`.

## Data flow
outbox → exportPending → temp file → rename into folder → peer watcher → scanAndApply → ledger check → M2 apply → conflict log.

## Error handling
Decrypt/AAD failure: log + skip. Folder missing: pause watcher, surface status `folder_unavailable`. Partial file: ignored until rename completes.

## Testing
node:test with two temp data dirs sharing one temp folder: create on A → appears on B; delete on A → tombstone on B; concurrent edit → LWW winner + conflict row; re-apply same bundle → no-op.
