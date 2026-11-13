# Changelog

Semua perubahan penting pada Memoria didokumentasikan di file ini.
Format mengikuti [Keep a Changelog](https://keepachangelog.com/id/1.1.0/);
versioning mengikuti [Semantic Versioning](https://semver.org/lang/id/).

## [Unreleased]

## [0.8.0] — 2026-11-14 — Encrypted Sync & Zero-AI Brain

**Otak yang mengikuti kamu, gratis selamanya**: sync terenkripsi antar mesin
(M1–M4), agen yang bisa mengkurasi memorinya sendiri, snapshot sesi tanpa AI
yang tiba *sebelum* limit habis, dan kualitas retrieval yang kini terukur
terbuka (hit@5 92.8–100% pada eval reproducible).

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

## [0.7.0] — 2026-11-11 — Fase 3: Webhook & Notifikasi

**Memoria kini bisa memberi tahu kamu di luar dashboard** — kirim notifikasi ke
Discord, Telegram, atau endpoint JSON apa pun saat digest mingguan jadi, scan
selesai, memori disetujui, atau draft menunggu kurasi. Opt-in penuh, secret
terenkripsi, gagal-kirim tidak pernah mengganggu engine.

### Added
- **Webhook & notifikasi (F3)** — Discord, Telegram, dan generic JSON webhook
  (`src/engine/notify/webhook.ts`): modul jadi listener tambahan di event bus
  internal, gagal-kirim tidak pernah mengganggu pemanggil. Empat event opt-in
  (default mati): weekly digest, scan selesai (dengan jumlah transkrip/memori
  baru), memory approved (approve massal = satu ringkasan), dan draft menunggu
  kurasi (cek harian, maks sekali per 24 jam, ambang bisa diatur). Isi pesan
  English. Tab Settings baru **Notifications**: toggle per event, konfigurasi
  platform, dan tombol **Send test** per platform (endpoint `POST
  /api/notify/test`). Secret (URL webhook Discord/generic, token Telegram)
  disimpan terenkripsi via safeStorage bila tersedia — sama seperti API key.
- Scan event kini membawa `newTranscripts` & `newMemories` (return
  `extractQueue()` yang tadinya dibuang kini ditangkap) — payload notifikasi
  scan berisi ringkasan nyata; klien SSE lama tetap kompatibel.

### Fixed
- **Toggle Settings statis tidak pernah tersimpan / dimuat**: fungsi
  `saveSettings()` dan `loadSettingsToggles()` dipanggil di `web/app.js` tapi
  tidak pernah didefinisi — setiap toggle di Behavior/Data tidak pernah
  persist dan tidak pernah menampilkan status tersimpan saat halaman dibuka.
  Keduanya kini didefinisikan (POST `{key, value}` + muat dari GET
  `/api/settings`).

## [0.6.0] — 2026-11-11 — Fase 1C: Retrieval & Skala

**Pustaka besar tetap ngebut** — keyword search pindah ke index FTS5, vektor
embedding disimpan sebagai BLOB Float32, dan seluruh list dashboard
terpagination. Acceptance: 5.000 memori → search < 100 ms.

### Added
- **FTS5 keyword search** (F1C 5.1): kandidat keyword kini dipilih index FTS5
  (`memories_fts`, external-content + trigger INSERT/DELETE/UPDATE, tokenizer
  trigram → semantik substring setara `includes()`), direrank `keywordScore`
  lama di atas maks 200 kandidat — formula blend final tak berubah. Query yang
  tak menemukan apa pun di FTS otomatis fallback ke scan penuh, sehingga
  recall typo fuzzy (editDistance) tetap seperti sebelumnya. Index baru:
  `memories(archived, status)` & `transcripts(extracted, ts)`.
- **Migrasi skema berversi** (`PRAGMA user_version`) di `store/db.ts` —
  pertama kali ada; migrasi lama berbasis `PRAGMA table_info` tetap dipertahankan.
- **Guard struktural di audit UI** (`scripts/audit-ui.js`, via `npm run check:ui`):
  selain cek selector, kini struktur HTML divalidasi — semua elemen harus
  tertutup dan elemen global (`#overlay`, `#toast-wrap`) wajib anak langsung
  `<body>`. Mencegah regresi bug modal di bawah terulang diam-diam.
- `MEMORIA_DATA_DIR` env override di `config.ts` — jalankan server/bench pada
  DB sementara tanpa menyentuh `~/.memoria` (pola `MEMORIA_OLLAMA_URL`).

### Changed
- **Embedding disimpan sebagai BLOB Float32** (F1C 5.2, migrasi v2 otomatis
  saat pertama kali jalan): hemat ±50% vs JSON TEXT dan tidak ada lagi
  `JSON.parse` vektor per baris di jalur baca manapun (`readMemories`,
  `vecfind`). On-disk: little-endian raw float32; baris JSON lama dikonversi.
- **Dedupe kandidat via SQL** (F1C 5.4): bukan lagi full-scan `allMemories()` —
  kandidat diambil langsung dari DB (proyek/dialek/aktif, 500 terbaru). Perilaku
  similarity & merge tidak berubah.
- **Pagination penuh di dashboard** (F1C): `/api/memories/list` (draft/archive)
  dan `/api/memories/tag` kini menerima `limit`/`offset` dan membalas bentuk
  yang sama dengan `/api/memories` (`total`/`hasMore`); semua tab Memories
  memakai pola "Load more", offset maju per halaman mentah agar filter
  client-side tidak melompati halaman.
- **Event delegation untuk aksi baris memori**: listener per tombol yang
  dipasang ulang di setiap render diganti satu pasang listener delegated per
  kontainer (guard WeakSet) — re-render list O(1), bukan O(n).
- `.mem` cards memakai `content-visibility: auto` + `contain-intrinsic-size`
  — card di luar viewport di-skip render browser (windowing murah untuk
  list panjang; menggantikan virtualisasi JS yang rawan dengan tinggi variabel).

### Perf
- Acceptance F1C terpenuhi (`scripts/bench-f1c.mjs`, 5.000 memori sintetis):
  median search kata umum **11,3 ms**, kata jarang **5,4 ms**, substring
  **58,0 ms** — semua < 100 ms.

### Fixed
- **Modal Add/Edit memory tidak muncul di luar tab Settings**: `web/index.html`
  kekurangan 4 `</div>` penutup di akhir blok Settings, sehingga `#overlay`
  (dan `#toast-wrap`) menjadi anak `#view-settings` yang `display:none` saat
  tidak aktif. Klik Edit di Graph/Memories seolah tidak bereaksi, lalu modal
  tiba-tiba muncul saat Settings dibuka. Modal & toast kini di `<body>` dan
  tampil normal di semua tab.

## [0.2.0] — 2026-11-04 — Fase 1B: Tiered Intelligence (Ollama opsional)

**User tanpa Ollama/API key kini mendapatkan memori sejak menit pertama** —
dan yang punya Ollama tidak merasakan perubahan.

### Added
- **Lapisan `MemoryProvider` dengan 3 tier mesin** (`extract/provider.ts`):
  - **Tier 0 Heuristik** (baru, default fallback): ekstraksi berbasis aturan
    (klasifikasi kalimat ID/EN — keputusan, task, error-fix, preferensi, fakta
    ber-entity) + embedding hashing TF-IDF 256-dim (FNV-1a + bigram) sehingga
    dedupe & similarity graph tetap bekerja tanpa model. Hasil heuristik
    **selalu masuk antrian tinjau (draft)** dengan badge asal — inbox kurasi,
    bukan noise tersembunyi.
  - **Tier 1 Ollama**: perilaku lama, tidak berubah.
  - **Tier 2 OpenAI-compatible** (baru, opt-in eksplisit): satu protokol untuk
    LM Studio / llama.cpp / vLLM / OpenRouter / cloud via setting
    `openaiBaseUrl` + `openaiApiKey` + model. Kartu Pengaturan baru
    "Mesin kecerdasan" dengan peringatan privasi (cloud = konten keluar mesin).
- **Seleksi mesin**: setting `extractEngine` / `embedEngine`
  (auto/ollama/openai/heuristic|hash). Mode `auto` = Ollama bila menyala,
  else heuristik/hash — dan **tidak pernah** memilih tier cloud secara diam.
  Perubahan berlaku langsung tanpa restart.
- **Circuit breaker**: 3 kegagalan provider beruntun = istirahat 60 detik —
  Ollama setengah mati tidak lagi menggantung `remember`/MCP sampai 60 detik.
- **`origin` & `embed_model` di tiap memori** + guard dialek di seluruh jalur
  cosine (search, dedupe, index LSH per-dialek): vektor dari model berbeda
  tidak akan pernah dibandingkan silang. Dedupe tanpa embedding kini memakai
  Jaccard token (dulu: langsung insert tanpa cek → duplikat menumpuk).
- Chip topbar kini menampilkan **mesin yang sedang bekerja** (mis. "🧠
  Heuristik") — bukan lagi hanya status Ollama.

### Fixed
- **Auto-pull model Ollama diam-diam dihapus** — dulu bisa mendownload ~GB
  tanpa izin; kini hanya peringatan + fallback ke tier lain.
- Search sebelum approve: draft memang tidak ikut pencarian (by design) —
  tidak ada perubahan perilaku; dicatat agar tidak salah paham saat menguji.

## Fase 1A — Resume Engine (limit-hopping)

_Bagian dari rilis [0.2.0] di atas: F0, F1A, dan F1B dirilis bersama sebagai
satu versi 0.2.0 — bukan tiga rilis terpisah yang sama-sama bernama 0.2.0._

Fitur inti untuk skenario **limit-hopping**: pindah tool AI di tengah tugas tanpa
menjelaskan ulang konteks. Branch: `feat/f1a-resume-engine`.

### Added
- **Blok "⏸️ LANJUTAN SESI"** kini menjadi bagian TERATAS setiap handoff (dan
  setiap injeksi file). Digabung dari 4 sinyal murah tanpa LLM: sesi transkrip
  terakhir (tool + jam + pesan penutup), task pending yang belum selesai,
  keputusan terbaru ("terkunci — jangan diulang"), dan **`git status`**
  (branch aktif + file yang sedang berubah — data baru via `runGitStatus`).
- **Prompt lanjutan siap-paste** — `GET /api/resume?slug=` + tombol baru
  "Salin prompt lanjutan" di tab Handoff. Plan B yang selalu bekerja bila
  injeksi file tidak terbaca oleh tool tujuan.
- **Multi-file injection**: blok konteks kini disuntik ke `AGENTS.md`
  (Codex/opencode), `CLAUDE.md` (Claude Code), dan `GEMINI.md` (Gemini CLI) —
  bukan lagi hanya AGENTS.md yang membuat Claude/Gemini tidak pernah membaca
  konteks. Duplikasi blok ber-marker (bukan symlink) agar aman di Windows.
  Tiap target bisa dimatikan di Pengaturan → "Injeksi konteks (resume)".
- **Hot-path resume**: saat aktivitas transkrip diam ≥ 4 menit (heuristic
  "sesi selesai"), Memoria langsung menjalankan scan → ekstraksi dengan
  **prioritas sesi terbaru** → injeksi konteks. Target: konteks resume siap
  ≤ 5 menit setelah pesan terakhir — tidak lagi menunggu antrian batch
  berikutnya. Ekstraksi background tetap berjalan untuk backlog lama.

### Fixed
- **Merge identitas proyek gagal untuk simpanan dashboard/quick-note**:
  `/api/remember` dan `/api/import` melakukan slugify sebelum `ensureProject`
  sehingga path proyek tidak pernah diteruskan — memori dashboard masuk ke
  proyek terpisah dari sesi Claude/Codex di direktori yang sama, dan blok
  resume kehilangan task/keputusan. Path mentah kini diteruskan (guard
  `looksLikePath` mencegah nama polos di-resolve jadi path palsu).
- **`/api/resume`, `GET|POST /api/handoff`, `/api/handoff/remove` menuntut
  slug persis** — input path/nama kini di-resolve lewat `resolveProject()`
  (kini shared di `store/db.ts`, dipakai MCP + HTTP).
- **`/api/remember` membalas 500 padahal memori tersimpan**: `node:sqlite`
  mengembalikan objek ber-prototype `null`, dan `Number(row)` di atasnya
  melempar TypeError — user melihat "Gagal simpan" untuk memori yang sebenarnya
  sukses. Ditemukan lewat smoke test F1A; kini `{"ok":true}` dan duplikat
  di-merge dedupe. Stack error 500 juga kini ter-log.
- File konteks yang baru dibuat injeksi tidak lagi diawali dua baris kosong.

### Changed
- Threshold idle hot-path resume kini bisa diatur via setting
  `resumeIdleMinutes` (default 4 menit, minimum 1) — berlaku tanpa restart.
- `ollamaUrl` bisa dioverride via env `MEMORIA_OLLAMA_URL` (testing terisolasi
  & endpoint non-standar).

## Fase 0 — Fondasi

Bagian pertama dari rencana eksekusi di `ROADMAP.md`. Branch: `feat/f0-foundation`.

### Security
- **API HTTP kini hanya menerima koneksi dari mesin ini.** Sebelumnya server
  bind ke semua interface dengan CORS `*` tanpa autentikasi — perangkat lain di
  LAN bisa membaca/menghapus memori, dan situs sembarang di browser bisa
  menyuntik konten ke `AGENTS.md` proyek (`POST /api/handoff`). Sekarang:
  bind eksplisit `127.0.0.1`, validasi header `Host` (anti DNS-rebinding),
  tolak `Origin` non-lokal untuk request pengubah data, CORS hanya echo origin
  lokal, plus token opsional via setting `apiToken` (header `x-memoria-token`).

### Fixed
- **Pustaka memori di dashboard hanya menampilkan 8 item.** `GET /api/memories`
  mengabaikan param `status` dan selalu memotong 8 memori terbaru. Kini param
  `status` (active/draft/archived) dihormati, tersedia pagination
  `limit`/`offset` (respons menambah `total`/`hasMore`), dan UI punya tombol
  "Muat selengkapnya" serta pesan error yang terlihat saat fetch gagal.
- **Recall via MCP tidak pernah memakai skor semantik.** Query dari agent tidak
  di-embed, sehingga 30% bobot skor mati. Kini `recall` MCP (dan CLI, HTTP,
  `related`) mengirim embedding query secara eksplisit; global cache yang
  balapan antar request dihapus.
- **Satu proyek fisik bisa tercatat sebagai beberapa proyek.** Tiap tool
  melaporkan `cwd` dengan format berbeda dan `ensureProject` hanya cocok by
  slug persis. Kini proyek digabungkan lewat path kanonik (resolve + realpath,
  lowercase di Windows), path lama di-backfill, dan memo mencegah syscall
  berulang saat scan massal.
- **MCP `project_context`/`remember` menuntut slug persis.** Path dengan
  pemisah/kapital/trailing-slash sedikit beda menghasilkan "Belum ada memori".
  Kini di-resolve berjenjang: slug → slugify path → path kanonik → LIKE
  nama/slug.
- **Hapus memori tanpa konfirmasi** — kini ada dialog konfirmasi.
- **Memori multiline mustahil** — Enter di modal langsung menyimpan. Kini
  simpan dengan Ctrl/Cmd+Enter, Enter = baris baru (hint ditambahkan).
- **`stats().lastScan` selalu menunjukkan "sekarang"** — kini mencatat waktu
  scan yang benar-benar selesai.
- Shortcut yang gagal didaftarkan kini dilaporkan (console + notifikasi OS);
  sebelumnya tertelan `try/catch` yang tidak pernah jalan karena
  `globalShortcut.register` mengembalikan `false`, bukan melempar exception.

### Changed
- **Dashboard/palette/quick kini dilayani oleh HTTP engine** (same-origin) —
  port tidak lagi di-hardcode di 3 file JS + 3 CSP; ganti port di config tidak
  lagi memutus UI. CSP diperketat ke `connect-src 'self'`.
- **Auto-start saat login jadi opsional** (setting `autoStartLogin`, default
  aktif) — sebelumnya dipaksa aktif tiap peluncuran; di macOS kini mulai
  tersembunyi (`openAsHidden`).
- **Shortcut global bisa diubah** dari Pengaturan → Shortcut global
  (`shortcutQuick`/`shortcutPalette`); shortcut fitur yang dimatikan tidak
  lagi dikonsumsi; label menu tray mengikuti konfigurasi (⌘ di macOS).
- Harness debug screenshot (`PECUT_SHOT`) dihapus dari `electron/main.ts`.
- Placeholder Windows-spesifik di form memori diganti hint netral.

## [0.1.0] — 2026-10

Rilis beta awal: capture 9 tool, ekstraksi Ollama lokal, MCP server,
retrieval hibrid, dashboard Electron, dsb. Lihat `README.md`.
