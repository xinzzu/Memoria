# Changelog

Semua perubahan penting pada Memoria didokumentasikan di file ini.
Format mengikuti [Keep a Changelog](https://keepachangelog.com/id/1.1.0/);
versioning mengikuti [Semantic Versioning](https://semver.org/lang/id/).

## [Unreleased]

## [0.9.0] — 2026-11-14 — Two-way & Measured

**Memory now flows both ways** (import your Obsidian vault / memory bank),
the pre-limit trigger can buzz your phone (the `notifyLimit` webhook), and
every ranking change must now beat the eval numbers first — the RRF
experiment lost and was recorded, not shipped blindly.

### Added
- **MCP over HTTP — the AI-to-AI bridge (PR-K)** — the engine now also serves
  MCP at `http://127.0.0.1:48210/mcp` (streamable transport, stateless,
  JSON responses) on the same port as the dashboard, behind the same
  host/origin/token guards as the rest of the API. Any AI tool — Claude Code,
  Codex, Gemini, opencode, or an agent on the LAN (with the optional
  `apiToken`) — can now point at one URL instead of wiring per-tool stdio
  configs. Verified: initialize handshake, tools/list (7 tools incl.
  build_context/update_memory/forget), and a live `recall` call over HTTP;
  the stdio transport stays fully compatible. All 7 tools + repo structure
  docs updated in README.
- **notifyLimit webhook toggle** — the F4 pre-limit moment can now ping
  Discord/Telegram/generic: "AI limit hit, resume brain is ready — switch tools
  whenever you're ready" (opt-in toggle in Settings → Notifications, event
  payload carries project slug + snapshot status).
- **Obsidian two-way — import side (PR-G)** — `POST /api/import/markdown
  {folder, project?}` + UI (Backup & data → Import Markdown): a folder of
  .md notes (Obsidian vault, Cline memory bank, plain notes) is imported as
  memories — first heading becomes the title line, 2 levels deep, ≤500 files,
  tiny files skipped, embeddings computed locally. Idempotent by design:
  re-importing the same folder merges via dedupe instead of duplicating.
  Completes the two-way story with the existing Obsidian export.

### Fixed
- **Overview "Recently worked on" no longer lists zero-activity projects** —
  recentProjects() now requires at least one transcript (audit finding);
  **graph labels hide when off-screen** and clamp inside the canvas instead of
  clipping raw at the edges.

### Changed
- **RRF ranking: evaluated and rejected** — reciprocal-rank fusion of the
  keyword and semantic lists was measured against the tuned score blend with
  the eval harness (PRNG seed 42): blend won hit@1 (77.5% vs 67.9%), hit@5
  (100% vs 99.6%) and MRR (0.855 vs 0.790) at 240 queries; RRF won only
  hit@1/MRR at the 600-query scale. Kept the blend; experiment documented so
  nobody re-proposes it without beating both scales.

## [0.8.0] — 2026-11-14 — Encrypted Sync & Zero-AI Brain

**The brain that follows you, free forever**: end-to-end encrypted sync
between machines (M1–M4), agents that curate their own memory, zero-AI
session snapshots that arrive *before* your limit runs out, and retrieval
quality that is now measured in the open (hit@5 92.8–100% on a reproducible
eval).

### Added
- **Eval harness lite (PR-D)** — `scripts/eval-search.mjs`: a reproducible
  LongEval-lite benchmark (deterministic PRNG seed 42, N topics × paraphrase +
  typo queries, generic noise memories as distractors) that scores
  `searchMemories` with hit@1 / hit@5 / MRR and average latency. Current
  zero-LLM numbers (hash embeddings + FTS5 trigram, no model at all):
  **hit@1 77.5% · hit@5 100% · MRR 0.855** at 240 queries / 520 memories;
  **hit@5 92.8%** at 600 queries / ~1300 memories; ~14 ms per query. Run:
  `npm run build && node scripts/eval-search.mjs [topics] [noise]`. Any
  future ranking change (e.g. RRF fusion) must beat these numbers first.
- **Smart remember (PR-C, mem0-style ADD/UPDATE/NOOP — zero-LLM)** —
  `addMemoryWithDedupe` now grows memories instead of only stacking them: new
  content that is LONGER and overlaps ≥55% tokens with a near-duplicate
  replaces the old content (with its fresh embedding + dialect, sync metadata
  and FTS5 following via `updateMemory`). Two-tier thresholds keep it safe:
  full merge at 0.85 (hash) / 0.92 (model) / 0.85 (text), selective UPDATE
  down to 0.6 (embedding) / 0.75 (text) only when the new text is clearly an
  extension of the same fact; otherwise the old NOOP + importance-bump and
  plain insert paths are unchanged. The MCP `remember` tool now reports what
  actually happened ("Memory updated (replaced content of #N)" / "Memory
  saved" / "Merged into existing memory #N").
- **Consolidation (PR-B)** — `extract/consolidate.ts`: a daily, model-free pass
  that clusters near-duplicate memories (same project, same kind, cosine
  ≥ 0.85 on locally computed hash embeddings — briefs excluded, newest 400
  per run) and merges each cluster into its best member: longest content
  survives, importance takes the maximum, tags are unioned, the rest are
  deleted with sync tombstones. Runs in `dailyMaintenance` (toggle
  `autoConsolidate`, default on, also in Settings → Behavior) and on demand
  via `POST /api/consolidate`. This is the zero-LLM answer to runaway curation
  inboxes (mcp-memory-service consolidation / mem0 "Dream", offline edition).
- **Temporal memory, provenance & project brief (migrasi v6)** — memories gain
  `valid_from`/`valid_to` (Graphiti-style validity windows; archiving closes a
  fact's validity, unarchiving reopens it) and `source_session` provenance —
  every memory and F4 snapshot now traces back to its source conversation, and
  the extraction pipeline stamps the session it came from. **Project brief**
  (Letta core-memory / Cline memory-bank style): an auto-maintained, max-one
  per-project summary memory (`Project brief: …` — decisions, open tasks,
  preferences, key facts, ≤1400 chars, regenerated daily and on demand) that
  ALWAYS sits first in `project_context` and recall outputs. New MCP tool
  **`build_context`** assembles one ready-to-paste context block (brief + key
  memories + optional query matches + 1-hop relation traversal, capped to
  `maxChars`), and `recall` now appends 1-hop related memories from its top
  hits. New `GET /api/continuity` + `POST /api/projects/brief` endpoints; F4
  emits `limit_hit`/`resume_ready` into a `continuity_events` ledger
  (`continuityStats()` aggregates 30-day counts + average limit→resume gap).
- **Zero-AI session brain (F4)** — `extract/snapshot.ts` adds two model-free
  mechanisms. (1) **Work snapshots**: at scan time the last 16 transcript lines
  of a project are mined deterministically (files touched, shell commands run,
  errors, last user message) and combined with the project's git branch/dirty
  files into one `context` memory (origin `heuristic`, max one per 15 minutes,
  dedupe-merged) — so recall/handoff in the next tool knows exactly what was
  being worked on. (2) **Pre-limit trigger**: provider kill-messages
  ("usage limit reached", "credit balance too low", "quota exceeded", …) are
  detected in new transcripts via a cursor over `transcripts` — patterns are
  deliberately strict so dev discussions *about* limits never fire it. On
  detection the engine captures a snapshot, runs priority extraction and
  injects resume context IMMEDIATELY (before the idle trigger fires), and
  emits a `limit_hit` event (SSE today, webhook-ready). This is the
  limit-hopping north star: switch tools the moment your quota dies and the
  next AI already has the continuation brain.
- **MCP self-editing tools** — the MCP server now exposes `update_memory`
  (correct content/kind/importance; a content change is auto re-embedded so
  semantic search stays accurate) and `forget` (delete a stale memory by id,
  or by query — a confident match is deleted immediately, otherwise
  candidates are listed for an explicit id). `updateMemory` gains optional
  embedding/embed-model patch support so edits never leave stale vectors
  behind; FTS5 stays in sync via its UPDATE trigger. Agents can now curate
  their own second brain, not only append to it.
- **Encrypted sync UX (M4)** — Settings now includes a **Sync** tab showing
  group/device status, pending outbox, last export/import, embed queue, shared
  folder path/state/error, and recent conflict log (last-writer-wins). Folder
  sync can be configured or disabled from the dashboard (CLI required for group
  setup/passphrase-locked keys and manual bundle export/import). New localhost
  endpoints `GET /api/sync/status`, `GET /api/sync/conflicts`, and
  `POST /api/sync/folder` expose sync status, bounded conflict history, and
  folder configuration. README documents encrypted sync CLI and privacy scope
  (EN/ID). Full EN/ID i18n for sync UI strings.

- **Encrypted sync shared-folder transport (M3)** — database migration v5 adds
  the `sync_applied_bundle` ledger (with backfill from legacy `sync_applied`)
  to track applied bundle IDs across manual and folder imports. New folder sync
  layer (`src/engine/sync/folder.ts`) supports configuring a writable shared
  folder (Dropbox/iCloud/Syncthing/network share), folder status, atomic
  debounced delta export of `<device>-<stamp>.memsync` bundles, and watcher-
  driven scan/apply of peer bundles with idempotent ledger checks and per-file
  decrypt/AAD/parse error tolerance. CLI adds `memoria sync folder set|status`
  and `memoria sync conflicts`; folder watcher runs in engine background jobs.
  Cleanup removes this device’s own bundles older than 14 days. Never syncs
  embeddings, secrets, settings, transcripts, or machine-local paths. Two-device
  integration tests cover convergence (create/delete tombstone), concurrent LWW
  conflict handling, idempotent re-apply, folder guards, and CLI (41 tests
  total).

- **Encrypted sync manual bundles (M2)** — database migration v4 adds
  per-entity LWW clocks, tombstones, conflict log, seen-op ledger, embedding
  backfill queue, and project slug aliases. New `memoria sync setup|status|export|import`
  CLI creates/joins a sync group (generated recovery code or join), stores the
  256-bit group key encrypted via OS keychain (`safeStorage`) or a
  passphrase-protected scrypt wrapper, and writes/reads encrypted `.memsync`
  bundles (AES-256-GCM, per-file HKDF key, gzip JSONL). Export supports
  `--full` relay snapshots built from current device state; import is
  idempotent, validates and canonicalizes operations, applies LWW with
  tombstones, records bounded conflicts, maps projects by UID/alias/slug without
  syncing local paths, never syncs embeddings/secrets/settings/transcripts, and
  queues local embedding backfill for imported memories. Test suite now covers
  crypto recovery/passphrase, bundle tamper/wrong-key/duplicate-op rejection,
  roundtrip, relay, delta/idempotency, LWW conflict, tombstone resurrection
  prevention, project slug aliasing, and CLI (38 tests total).

- **Encrypted sync foundation (M1)** — database migration v3 adds stable UUID
  `uid` columns plus `updated_by` to `projects` and `memories`, backfills every
  existing row, and creates `sync_devices`, `sync_outbox`, `sync_applied`, and
  `sync_state`. All project/memory/tag/link mutations now emit outbox
  upsert/delete operations with hybrid logical clocks (`wall.counter.device`);
  deletes produce tombstones and memory deletes also tombstone their links. The
  migration enqueues an initial snapshot of existing projects, memories, and
  links for peer bootstrap. Embeddings, entities, and FTS remain device-local
  and are never queued. Test suite now covers v2→v3 backfill, outbox capture,
  tombstones, HLC monotonicity/clock observation, and replay suppression
  (31 tests total).

### Changed
- **Database migrations are atomic** — each `PRAGMA user_version` step now runs
  inside a transaction, so a failed migration rolls back instead of leaving a
  partially upgraded schema or duplicated outbox snapshots.
- **Memory mutations bump `updated_at`/`updated_by` consistently** — approvals,
  task resolution, archive/unarchive, content edits, and tag changes now update
  sync metadata, not just content edits.

## [0.7.1] — 2026-11-13

### Added
- **Batch embeddings for OpenAI-compatible providers (F1B leftover)** —
  `openaiEmbedMany` sends up to 64 texts per `/embeddings` request, maps results
  via `index` (server response order is not assumed), automatically chunks
  larger batches, and returns `null` per failed item without blocking other
  batches. `embedManyVia` now uses this batch path (previously one request per
  text). New tests: single batch + index order, chunks over 64, partial
  response, provider wiring, and no-op without a base URL.

### Changed
- **CI release**: the workflow now runs verification (`npm test` + `check:ui`)
  before building installers; `v*` tags must match the `package.json` version;
  the GitHub Release body is taken from the matching CHANGELOG section
  (fallback: git log between tags). Verification also runs on PRs and pushes to
  `main`, and the build matrix uses `fail-fast: false` so one OS failure does
  not cancel the others.
- **Library pagination moved to SQL** — `GET /api/memories` and
  `GET /api/memories/list` now use SQLite `LIMIT`/`OFFSET` directly
  (`listMemoriesPage` in `store/db.ts`) instead of materializing the entire
  table through `allMemories()`/`listDraft()`/`listArchived()` and slicing in
  JS. Totals are still computed with count queries and the response shape is
  unchanged. New tests assert page order, totals, and limits match the old
  implementation for all three tabs (active/draft/archived).

### Fixed
- **`canonicalPath` test failed on Linux**: it hardcoded `/private/tmp` (macOS
  symlink behavior). It now compares against `fs.realpathSync("/tmp")`, so it
  passes on macOS, Linux, and Windows.

## [0.7.0] — 2026-11-11 — Phase 3: Webhook & Notifications

**Memoria can now reach you outside the dashboard** — send notifications to
Discord, Telegram, or any JSON endpoint when the weekly digest is generated,
a scan finishes, a memory is approved, or drafts are waiting for review.
Fully opt-in, secrets encrypted, delivery failures never disturb the engine.

### Added
- **Webhook & notifications (F3)** — Discord, Telegram, and generic JSON
  webhooks (`src/engine/notify/webhook.ts`): the module is an extra listener
  on the internal event bus; delivery failures never disturb the caller.
  Four opt-in events (default off): weekly digest, scan finished (with
  new-transcript/memory counts), memory approved (batch approvals send one
  summary), and drafts waiting (daily check, at most once per 24 hours,
  configurable threshold). English message bodies. New **Notifications**
  Settings tab: per-event toggles, platform configuration, and a per-platform
  **Send test** button (`POST /api/notify/test`). Secrets (Discord/generic
  webhook URLs, Telegram token) are stored encrypted via safeStorage when
  available — same as the API key.
- Scan events now carry `newTranscripts` & `newMemories` (the previously
  discarded `extractQueue()` return is now captured) — scan notification
  payloads contain real summaries; older SSE clients stay compatible.

### Fixed
- **Static Settings toggles never persisted / never loaded**: `saveSettings()`
  and `loadSettingsToggles()` were called in `web/app.js` but never defined —
  every toggle in Behavior/Data neither persisted nor showed its saved state
  on page load. Both are now implemented (POST `{key, value}` + load from
  GET `/api/settings`).

## [0.6.0] — 2026-11-11 — Phase 1C: Retrieval & Scale

**Large libraries stay fast** — keyword search moved to an FTS5 index,
embedding vectors are stored as Float32 BLOBs, and every dashboard list is
paginated. Acceptance: 5,000 memories → search < 100 ms.

### Added
- **FTS5 keyword search** (F1C 5.1): keyword candidates are now chosen by an
  FTS5 index (`memories_fts`, external-content + INSERT/DELETE/UPDATE
  triggers, trigram tokenizer → substring semantics matching `includes()`),
  reranked with the existing `keywordScore` over a maximum of 200 candidates —
  the final blend formula is unchanged. Queries that find nothing in FTS
  automatically fall back to a full scan, so fuzzy typo recall (editDistance)
  stays exactly as before. New indexes: `memories(archived, status)` &
  `transcripts(extracted, ts)`.
- **Versioned schema migrations** (`PRAGMA user_version`) in `store/db.ts` —
  first time this exists; the old `PRAGMA table_info`-based migration is kept.
- **Structural guard in the UI audit** (`scripts/audit-ui.js`, via
  `npm run check:ui`): beyond selector checks, HTML structure is now
  validated — all elements must be closed and global elements (`#overlay`,
  `#toast-wrap`) must be direct `<body>` children. Prevents the modal bug
  below from silently recurring.
- `MEMORIA_DATA_DIR` env override in `config.ts` — run the server/bench on a
  throwaway DB without touching `~/.memoria` (same pattern as
  `MEMORIA_OLLAMA_URL`).

### Changed
- **Embeddings stored as Float32 BLOBs** (F1C 5.2, automatic v2 migration on
  first run): ~50% smaller than JSON TEXT and no more per-row `JSON.parse` of
  vectors on any read path (`readMemories`, `vecfind`). On-disk: raw
  little-endian float32; legacy JSON rows are converted.
- **Dedupe candidates via SQL** (F1C 5.4): no more full `allMemories()` scan —
  candidates come straight from the DB (project/dialect/active, newest 500).
  Similarity & merge behavior unchanged.
- **Full dashboard pagination** (F1C): `/api/memories/list` (draft/archive)
  and `/api/memories/tag` now accept `limit`/`offset` and respond in the same
  shape as `/api/memories` (`total`/`hasMore`); every Memories tab uses the
  "Load more" pattern, with offsets advancing per raw page so client-side
  filters never skip pages.
- **Event delegation for memory row actions**: per-button listeners re-bound
  on every render are replaced by one delegated listener pair per container
  (WeakSet-guarded) — list re-renders are O(1), not O(n).
- `.mem` cards use `content-visibility: auto` + `contain-intrinsic-size` —
  off-viewport cards skip rendering (cheap windowing for long lists;
  replaces fragile JS virtualization with variable row heights).

### Perf
- F1C acceptance met (`scripts/bench-f1c.mjs`, 5,000 synthetic memories):
  median search **11.3 ms** for common words, **5.4 ms** rare words,
  **58.0 ms** substring — all < 100 ms.

### Fixed
- **Add/Edit memory modal didn't appear outside the Settings tab**:
  `web/index.html` was missing 4 closing `</div>` tags at the end of the
  Settings block, so `#overlay` (and `#toast-wrap`) became children of the
  hidden `#view-settings`. Clicking Edit on Graph/Memories seemed dead, then
  the modal suddenly appeared when Settings opened. Modal & toast now live on
  `<body>` and work on every tab.

## [0.2.0] — 2026-11-04 — Phase 1B: Tiered Intelligence (Ollama optional)

**Users without Ollama/API keys get memories from the very first minute** —
and existing Ollama users notice no change.

### Added
- **A `MemoryProvider` layer with 3 engine tiers** (`extract/provider.ts`):
  - **Tier 0 Heuristic** (new, default fallback): rule-based extraction
    (ID/EN sentence classification — decisions, tasks, error-fixes,
    preferences, entity-rich facts) + 256-dim TF-IDF hashing embeddings
    (FNV-1a + bigrams) so dedupe & the similarity graph work without any
    model. Heuristic results **always enter the review queue (draft)** with an
    origin badge — a curation inbox, not hidden noise.
  - **Tier 1 Ollama**: previous behavior, unchanged.
  - **Tier 2 OpenAI-compatible** (new, explicit opt-in): one protocol for
    LM Studio / llama.cpp / vLLM / OpenRouter / cloud via the `openaiBaseUrl`
    + `openaiApiKey` + model settings. New "Intelligence engine" settings card
    with a privacy warning (cloud = content leaves the machine).
- **Engine selection**: `extractEngine` / `embedEngine` settings
  (auto/ollama/openai/heuristic|hash). `auto` mode = Ollama when it's up,
  otherwise heuristic/hash — and it **never** silently picks the cloud tier.
  Changes apply instantly, no restart.
- **Circuit breaker**: 3 consecutive provider failures = a 60-second rest —
  a half-dead Ollama no longer hangs `remember`/MCP for up to 60 seconds.
- **`origin` & `embed_model` on every memory** + a dialect guard across all
  cosine paths (search, dedupe, per-dialect LSH index): vectors from different
  models can never be cross-compared. Embedding-less dedupe now uses token
  Jaccard (previously: insert without any check → duplicates piled up).
- The topbar chip now shows the **engine actually in use** (e.g. "🧠
  Heuristic") — not just Ollama status.

### Fixed
- **Silent Ollama model auto-pull removed** — it could download gigabytes
  without consent; now it only warns and falls back to another tier.
- Search before approval: drafts intentionally don't appear in search (by
  design) — no behavior change; noted to avoid misunderstanding while testing.

## Fase 1A — Resume Engine (limit-hopping)

_Part of the [0.2.0] release above: F0, F1A, and F1B shipped together as one
0.2.0 version — not three separate releases all named 0.2.0._

The core feature for the **limit-hopping** scenario: switch AI tools mid-task
without re-explaining context. Branch: `feat/f1a-resume-engine`.

### Added
- **A "⏸️ SESSION CONTINUATION" block** now sits at the TOP of every handoff
  (and every file injection). Composed from 4 cheap, LLM-free signals: the
  latest transcript session (tool + time + closing message), unfinished
  pending tasks, recent decisions ("locked — don't repeat"), and **`git
  status`** (active branch + files currently changing — new data via
  `runGitStatus`).
- **A ready-to-paste continuation prompt** — `GET /api/resume?slug=` plus a
  new "Copy continuation prompt" button on the Handoff tab. Plan B that
  always works when the target tool doesn't read injected files.
- **Multi-file injection**: the context block is now injected into
  `AGENTS.md` (Codex/opencode), `CLAUDE.md` (Claude Code), and `GEMINI.md`
  (Gemini CLI) — no longer AGENTS.md only, which left Claude/Gemini never
  reading the context. Marker-block duplication (not symlinks) so it's safe
  on Windows. Each target can be disabled in Settings → "Context injection
  (resume)".
- **Hot-path resume**: when transcript activity goes quiet for ≥ 4 minutes
  (the "session ended" heuristic), Memoria immediately runs scan → extraction
  with **newest-session priority** → context injection. Target: resume
  context ready ≤ 5 minutes after the last message — no longer waiting for
  the next batch queue. Background extraction continues for the old backlog.

### Fixed
- **Project identity merge failed for dashboard/quick-note saves**:
  `/api/remember` and `/api/import` slugified before `ensureProject`, so the
  project path was never forwarded — dashboard memories landed in a project
  separate from Claude/Codex sessions in the same directory, and resume blocks
  lost their tasks/decisions. Raw paths are now forwarded (a `looksLikePath`
  guard prevents plain names from resolving into fake paths).
- **`/api/resume`, `GET|POST /api/handoff`, `/api/handoff/remove` demanded an
  exact slug** — path/name input is now resolved via `resolveProject()`
  (now shared in `store/db.ts`, used by MCP + HTTP).
- **`/api/remember` replied 500 even though the memory saved**: `node:sqlite`
  returns null-prototype objects and `Number(row)` over them throws a
  TypeError — users saw "Save failed" for memories that actually saved.
  Caught by the F1A smoke test; now returns `{"ok":true}` and duplicates are
  merged by dedupe. The 500 stack is also logged.
- Context files freshly created by injection no longer start with two blank
  lines.

### Changed
- The hot-path resume idle threshold is now configurable via the
  `resumeIdleMinutes` setting (default 4 minutes, minimum 1) — applies
  without restart.
- `ollamaUrl` can be overridden via the `MEMORIA_OLLAMA_URL` env (isolated
  testing & non-standard endpoints).

## Phase 0 — Foundation

The first part of the execution plan in `ROADMAP.md`. Branch:
`feat/f0-foundation`.

### Security
- **The HTTP API now only accepts connections from this machine.** Previously
  the server bound to all interfaces with CORS `*` and no authentication —
  other devices on the LAN could read/delete memories, and any website in the
  browser could inject content into a project's `AGENTS.md`
  (`POST /api/handoff`). Now: explicit `127.0.0.1` bind, `Host` header
  validation (anti DNS-rebinding), non-local `Origin` rejected for
  data-changing requests, CORS echoes only local origins, plus an optional
  token via the `apiToken` setting (`x-memoria-token` header).

### Fixed
- **The dashboard memory library showed only 8 items.** `GET /api/memories`
  ignored the `status` param and always truncated to the 8 newest. The
  `status` param (active/draft/archived) is now honored, `limit`/`offset`
  pagination is available (the response adds `total`/`hasMore`), and the UI
  has a "Load more" button plus a visible error message when a fetch fails.
- **MCP recall never used the semantic score.** Agent queries weren't
  embedded, leaving 30% of the score weight dead. The MCP `recall` (and CLI,
  HTTP, `related`) now passes the query embedding explicitly; the global
  cache that raced across requests was removed.
- **One physical project could be recorded as several projects.** Each tool
  reports `cwd` in a different format and `ensureProject` matched by exact
  slug only. Projects are now merged via canonical path (resolve + realpath,
  lowercased on Windows), old paths are backfilled, and a memo prevents
  repeated syscalls during bulk scans.
- **MCP `project_context`/`remember` demanded an exact slug.** Paths with
  slightly different separators/case/trailing slashes returned "No memories
  yet". Now resolved in stages: slug → slugified path → canonical path →
  LIKE on name/slug.
- **Memory deletion without confirmation** — a confirm dialog now exists.
- **Multiline memories were impossible** — Enter in the modal saved
  immediately. Now Ctrl/Cmd+Enter saves, Enter inserts a newline (hint
  added).
- **`stats().lastScan` always showed "now"** — it now records when a scan
  actually finished.
- Failed global-shortcut registration is now reported (console + OS
  notification); previously swallowed by a `try/catch` that never ran because
  `globalShortcut.register` returns `false` rather than throwing.

### Changed
- **Dashboard/palette/quick are now served by the HTTP engine** (same-origin)
  — the port is no longer hardcoded in 3 JS files + 3 CSPs; changing the port
  in config no longer breaks the UI. CSP tightened to `connect-src 'self'`.
- **Auto-start on login is now optional** (`autoStartLogin` setting, default
  on) — previously forced on every launch; on macOS it now starts hidden
  (`openAsHidden`).
- **Global shortcuts are configurable** from Settings → Global shortcut
  (`shortcutQuick`/`shortcutPalette`); shortcuts for disabled features are no
  longer consumed; tray menu labels follow the configuration (⌘ on macOS).
- The `PECUT_SHOT` debug screenshot harness was removed from
  `electron/main.ts`.
- Windows-specific placeholders in the memory form were replaced with neutral
  hints.

## [0.1.0] — 2026-10

Initial beta release: 9-tool capture, local Ollama extraction, MCP server,
hybrid retrieval, Electron dashboard, etc. See `README.md`.
