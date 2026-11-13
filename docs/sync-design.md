# Memoria Encrypted Sync — Design

Status: M1 implemented on `main` (PR #8; schema, UID, HLC, outbox, tests). M2 implemented (migration v4, group key/recovery code, encrypted manual `.memsync` bundles, CLI export/import, idempotent apply, embedding backfill queue). M3 implemented (migration v5 applied-bundle ledger, shared-folder config/status, atomic debounced export, watcher-driven scan/apply with per-file error tolerance, `sync folder`/`sync conflicts` CLI, cleanup of own old bundles, two-device integration tests). M4+ not implemented. Scope: F3 sync between Memoria instances (same user, multiple machines).

## 1. Goals and non-goals

### Goals

- Move memories, projects, tags, and links between machines without re-explaining context.
- End-to-end encryption: the transport (folder provider, cloud drive, network) only sees ciphertext.
- Offline-first: no always-on server required.
- Idempotent, incremental sync with deterministic conflict handling.
- Keep local privacy guarantees: no secret ever leaves the machine.

### Non-goals (v1)

- Real-time collaboration between different users.
- Syncing raw transcripts by default (large, highly sensitive; possible opt-in later).
- Syncing embeddings (see §5).
- Merging SQLite files directly (WAL + local IDs + derived indexes make this unsafe).

## 2. Current state that shapes the design

- `memories` and `projects` use local autoincrement `id` (`src/engine/store/db.ts:45-118`).
  These IDs are not stable across machines.
- `memory_tags`, `memory_entities`, `memory_links` reference local IDs.
- `memories.updated_at` now gets bumped by every synced mutation (M1); legacy
  rows are backfilled so LWW has a usable baseline.
- Embeddings are stored per dialect (`embed_model`) and must never be compared across models.
- `settings` contains secrets (API keys, webhook URLs/tokens) encrypted with `safeStorage`
  via `src/engine/store/secure.ts`; it must not be synced wholesale.
- `sources` and `transcripts` are machine-local capture state. `sources` must never sync.
- FTS5, entities, and memory links are derived/auxiliary data and can be rebuilt locally.

## 3. Identity model

Introduce globally stable IDs (UUID v4) for synced entities:

| Entity | Stable key | Notes |
|---|---|---|
| project | `projects.uid` | Local `path` is never synced; map by `slug` locally. |
| memory | `memories.uid` | Local row keeps integer `id`; `uid` is the sync key. |
| link | `(from_uid, to_uid)` | Resolved to local IDs on apply. |
| tag | `(memory_uid, tag)` | Carried inside the memory record; full set is LWW. |

New columns and indexes (migration v3):

- `ALTER TABLE projects ADD COLUMN uid TEXT;`
- `ALTER TABLE memories ADD COLUMN uid TEXT;`
- Backfill UIDs with `crypto.randomUUID()` for existing rows, then add unique indexes.
- `memories.updated_by TEXT` (device id) and `projects.updated_by` for LWW tiebreaks.
- `memories.embedding` stays local; imported rows start with `NULL`.

Sync bookkeeping tables:

```sql
CREATE TABLE sync_devices (
  device_id TEXT PRIMARY KEY,
  name TEXT,
  created_at INTEGER,
  last_seen INTEGER
);

CREATE TABLE sync_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  op_id TEXT UNIQUE NOT NULL,      -- device_id:seq
  seq INTEGER NOT NULL,
  hlc TEXT NOT NULL,               -- "wall.counter.device_id"
  entity TEXT NOT NULL,            -- project | memory | link
  entity_uid TEXT NOT NULL,
  op TEXT NOT NULL,                -- upsert | delete
  payload TEXT NOT NULL,           -- JSON snapshot / delete marker
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_sync_outbox_hlc ON sync_outbox(hlc);

CREATE TABLE sync_applied (
  file_id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  applied_at INTEGER NOT NULL,
  op_count INTEGER NOT NULL
);

CREATE TABLE sync_state (
  key TEXT PRIMARY KEY,
  value TEXT
);                                  -- max_hlc, group_id, last_export_hlc, ...
```

## 4. What syncs

Default scope:

- Projects: `uid`, `slug`, `name`, `last_seen` (not `path`).
- Memories: `uid`, project `uid`, kind, content, importance, created_at, updated_at,
  source_tool, status, resolved_at, origin, archived, tags.
- Links: endpoint UIDs, kind, weight, created_at.

Never sync:

- `settings` (secrets, machine paths, notification targets).
- `sources` (file offsets are machine-specific).
- Embeddings (`embedding`, `embed_model`) and vectors.
- FTS index and entities (rebuilt locally).
- Raw transcripts in v1.

## 5. Embeddings

Embeddings are derived data and dialect-specific. Syncing them is rejected because:

- A peer may use a different model; cross-dialect cosine similarity is invalid.
- Vectors leak content-derived information and increase bundle size.
- Re-embedding locally keeps search consistent with the local provider.

After applying imported memories, a background job embeds rows where
`embedding IS NULL` using the existing batch path (`embedManyVia`, up to 64 texts
per request). Dedupe on import uses content similarity, not vectors.

## 6. Cryptography

### Key model

- One sync group per user (multiple devices).
- Group key: 256-bit random, generated on the first device.
- Recovery code: Crockford base32 encoding of the group key, shown once, stored by the user.
- Stored copy on each device: encrypted via `safeStorage` (existing `enc1:` format).
- Optional passphrase wrapper: `scrypt(passphrase, salt, N=2^15, r=8, p=1)` derives a
  key-encryption key; the group key is wrapped with AES-256-GCM. Unlock per session.

### File format

- Plaintext payload: gzip(JSONL of ops) + encrypted manifest.
- Encryption: AES-256-GCM.
  - Per-file key via HKDF-SHA256 from the group key (`info = "memoria-sync-v1"`, `salt = file_id`).
  - Random 96-bit nonce, stored in the file header.
  - AAD: format version, group id, file id, device id, op count, HLC range.
- File name: opaque random id + `.memsync` (no device/timestamp metadata).
- Limits: reject files > 100 MB decompressed, > 200k ops, invalid JSON, or duplicate `op_id`.

### Threat model

| Adversary | Protected? | Notes |
|---|---|---|
| Cloud folder provider | Yes | Only ciphertext; file sizes/timestamps still visible. |
| Network attacker | Yes | No plaintext transport; GCM authenticity. |
| Stolen device | Partial | `safeStorage` protects keys at OS level; unlocked sessions are exposed. |
| Malicious paired device | Partial | Group members can inject valid records; validate input, cap sizes, log conflicts. |
| Rollback/replay | Yes | `sync_applied` ledger + monotonic HLC rejection. |
| Removed device | Partial | It can read old files; rotate group key for future bundles. |

Never log plaintext payloads, keys, or recovery codes. Import validation treats remote data as untrusted:
length caps, allowlisted kinds, no path application, prepared statements only.

## 7. Change capture

Application-level outbox (not triggers) because HLC and device identity require JS logic:

- Central mutation points in `store/db.ts` call `queueSyncOp()`:
  - `insertMemory`, `updateMemory`, `approveMemory`, `archiveMemory`, `deleteMemory`,
    `setTaskResolved`, `replaceMemoryTags`, `insertMemoryLink`, `ensureProject`.
- `deleteMemory` enqueues a `delete` tombstone before removing the row.
- Every op captures `updated_at`, `updated_by`, and a new HLC.
- Backfill on migration: enqueue upserts for existing projects/memories/links so peers
  can bootstrap from the current library.
- Tags travel as a full array inside the memory payload (LWW with the memory).
- Entities are reindexed locally after apply; FTS triggers maintain search automatically.

## 8. HLC and conflict resolution

Hybrid Logical Clock string: `wall_ms.counter.device_id` (counter resets when wall advances).
Compare by wall, then counter, then device id. Store the local max in `sync_state.max_hlc`.

Apply rules per entity:

1. Reject duplicate `op_id` and files already in `sync_applied`.
2. For `upsert`: apply if incoming HLC > local HLC; equal HLC resolved by device id.
3. For `delete`: apply tombstone if newer; keep tombstone for 180 days to prevent resurrection.
4. Record the losing payload in a bounded conflict log (last 50) for UI inspection.
5. Apply a file in one transaction; then enqueue embeddings for rows with `NULL` vector.

LWW accepts that concurrent edits can lose the loser's changes; the conflict log makes this visible.
Do not create automatic duplicate "conflict" memories in v1.

## 9. Transport

### Phase A — manual encrypted bundle (first)

- `memoria sync export --out <file>` exports upserts since `last_export_hlc` (or full snapshot).
- `memoria sync import --in <file>` applies it idempotently.
- Also exposed from Settings → Sync for non-CLI users.

### Phase B — shared folder (recommended default)

- User points Memoria at a folder synced by Syncthing/iCloud/Nextcloud/USB.
- Memoria writes one encrypted file per sync session and watches the folder for new files.
- Peers scan on startup and every N minutes; `sync_applied` prevents re-import.
- Files are never deleted automatically; a retention job removes applied local files older
  than 30 days (remote copies remain the user's responsibility).

### Phase C — direct LAN/HTTP (optional, later)

- Pair devices with a short code/QR over the existing local HTTP server.
- Useful when no shared folder exists; not required for v1.

## 10. API and UI

Endpoints:

- `GET /api/sync/status` — enabled, device id, group id, last sync, pending ops, conflicts.
- `POST /api/sync/setup` — create/join group (passphrase or recovery code).
- `POST /api/sync/export` — write bundle to a local path; return file id/size.
- `POST /api/sync/import` — apply a bundle path.
- `POST /api/sync/folder` — set/clear shared folder and enable watcher.

Settings → Sync:

- Enable toggle, device name, group/recovery code (hidden after setup).
- Shared folder picker, export/import buttons, last sync + error state.
- Conflict log (read-only), pending embedding count.

CLI: `memoria sync status|export|import|folder`.

## 11. Performance

- Batch up to 500 ops per file; gzip before encryption.
- Apply one file per transaction; WAL already enabled.
- Embedding backfill reuses the existing chunked batch path.
- Target: 5k memories < 5 s export/import on a laptop; bundle < 10 MB uncompressed.
- Indexes: `sync_outbox(hlc)`, `memories(uid)`, `projects(uid)`, `sync_applied(file_id)`.

## 12. Migration and compatibility

- Migration v3 adds `uid` columns, indexes, sync tables, and backfills UIDs.
- Old clients ignore unknown tables/columns; new clients work with an empty outbox.
- A peer with an older schema receives a clear "unsupported bundle version" error.
- Bundles carry `format_version: 1`; unknown versions are rejected, never partially applied.

## 13. Test plan

- Crypto: roundtrip, wrong key, tampered ciphertext/AAD, truncated file, decompression bomb.
- HLC: monotonicity across clock skew, tiebreak by device id.
- Apply: idempotency (same file twice, same op twice), ordering, transaction rollback on bad op.
- Conflicts: upsert vs upsert, delete vs later upsert, tag set LWW, link resolution.
- Scope: secrets/settings/sources/transcripts/embeddings never present in bundles.
- Migration: v2 DB with existing rows gets unique UIDs; links/tags remain consistent.
- Integration: two temporary DBs + shared folder, simulate both directions, assert convergence.
- Performance: 5k memories, 10k links; export/import timing and bundle size.

## 14. Delivery plan

1. **M1 — schema and change capture** ✅: migration v3, UIDs, outbox, HLC helpers, unit tests.
2. **M2 — crypto and manual bundles**: key generation/storage, recovery code, export/import CLI,
   idempotent apply, embedding backfill queue.
3. **M3 — folder sync**: watcher, applied ledger, conflict log, two-device integration tests.
4. **M4 — UX and docs**: Settings → Sync, status/conflict UI, README/i18n.
5. **M5 — hardening**: key rotation, device revocation, rollback protection, performance pass.
6. **Optional** — direct LAN pairing.

## 15. Decisions for v1

Resolved: manual bundles plus shared folder, transcripts excluded, generated recovery code
plus optional passphrase, LWW with bounded conflict log, and 180-day tombstone retention.
Still open: device revocation (manual group-key rotation vs automatic re-key through a
paired-device channel).
