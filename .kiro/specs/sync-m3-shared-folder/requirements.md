# Requirements: Sync M3 — Shared Folder Sync

## Introduction
M2 delivered manual encrypted `.memsync` bundles and idempotent apply. M3 adds automatic, serverless sync between devices in the same sync group via a user-chosen shared folder (Dropbox, iCloud Drive, Syncthing, network share), reusing M2 crypto/bundle/apply primitives. Scope follows `docs/sync-design.md` §10/§14 (M3). Never sync embeddings, secrets, settings, transcripts, or machine-local paths.

## Requirements

### 1. Shared folder configuration
**User story:** As a user with two machines, I want to point Memoria at a shared folder so my memories sync without manual export/import.
- WHEN the user runs `memoria sync folder set <path>` THEN the system SHALL require sync to be configured (group key loadable), resolve/validate the path is an existing or creatable writable directory, persist it (e.g. `sync.folder.path` in sync state/settings), and report the configured path.
- WHEN the user runs `memoria sync folder status` THEN the system SHALL show folder path, availability/writability, watcher state, last export/import HLC+time, pending outbox count, and last error (if any).
- WHEN the user clears the folder (e.g. `memoria sync folder set --clear` or empty path) THEN the system SHALL stop the watcher and disable automatic folder sync without removing group keys.
- IF sync is not set up or the key is locked/unavailable THEN the system SHALL refuse folder enablement and instruct the user to run `sync setup` / provide passphrase.

### 2. Automatic export
- WHEN folder sync is enabled, outbox/entity clocks indicate pending changes relative to last folder export, AND the debounce interval (30 s) has elapsed THEN the system SHALL export a bundle to the shared folder.
- The bundle filename SHALL identify the originating device and be unique/monotonic (e.g. `<deviceId>-<hlc-or-seq>.memsync`, sanitized for filesystem safety) so peers can ignore their own files.
- The system SHALL write bundles atomically (temp file in the same directory + fsync/rename) so peers never read partial files; on failure it SHALL surface status `export_failed` and retry later without corrupting state.
- Exports SHALL reuse M2 export/apply semantics (delta by default; full only when explicitly requested by a future/manual path) and SHALL honor existing “never sync” rules.

### 3. Automatic import & applied ledger
- WHEN a new readable `.memsync` from another device appears in the folder THEN the system SHALL attempt to apply it via the existing M2 decrypt/validate/apply path.
- The system SHALL maintain an applied-bundle ledger (migration v5, e.g. `sync_applied_bundle` keyed by bundle/file id with device id, filename, applied_at, op stats) and SHALL skip bundles already applied (idempotent).
- The system SHALL ignore its own device’s bundles and non-bundle/partial files; it SHALL wait for stable writes (`awaitWriteFinish` or equivalent) before reading.
- IF a bundle fails decryption, AAD/header validation, parse, or group mismatch THEN the system SHALL record/log a structured error, skip it, and continue scanning other bundles.
- Successful apply SHALL update last-import state and queue local embedding backfill as in M2 (no embedding transfer).

### 4. Conflict visibility
- WHEN LWW apply records a conflict THEN it SHALL be persisted in the bounded conflict log (existing `sync_conflicts`, per M2).
- WHEN the user runs `memoria sync conflicts` THEN the system SHALL list recent conflicts (id/time, entity, entity_uid, winner_hlc, loser_hlc, summary/source device when available) with a sensible limit (e.g. last 50) and a clear “no conflicts” case.

### 5. Cleanup & resilience
- The system SHALL be able to delete its own exported bundles older than 14 days from the shared folder when safe to do so (best-effort; must not delete peers’ bundles). Exact “all peers applied” proof may be unavailable without peer acks, so cleanup SHALL be conservative (age-based for own files) and configurable/disableable if needed.
- IF the folder becomes missing/unreadable THEN the system SHALL pause watching/exporting, keep local state consistent, and surface `folder_unavailable` in status without crashing the engine.
- Two-device convergence is the acceptance target: create/update on A appears on B, delete/tombstone propagates, concurrent edits resolve by LWW with conflict recorded, and re-processing the same bundle is a no-op.
