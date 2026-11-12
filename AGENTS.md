<!-- memoria:start -->
# Handoff Proyek: Memoria — second brain offline untuk AI coding tools
> Diperbarui manual — 2026-11-11 (repo: github.com/xinzzu/Memoria, MIT)

## Apa ini
App Electron + engine Node/TS yang menangkap transkrip sesi AI coding tools
(Claude Code, Codex, Gemini CLI, opencode, Copilot, dll.) lalu mengubahnya jadi
memori yang bisa di-recall lintas tool (MCP + dashboard). North star: **limit-hopping**
— pindah tool AI tanpa menjelaskan ulang konteks.

## Sumber kebenaran (jangan andalkan dokumen lain)
- `CHANGELOG.md` — riwayat rilis per fase.
- `ROADMAP.md` — rencana fase + bagian **"POSI TERKINI"** (diupdate per fase; mulai
  dari sini saat lanjut kerja).
- `git log` — konvensi commit: conventional commits; fitur via branch
  `feat/...`/`fix/...` lalu `git merge --no-ff` ke `main`.

## Status (v0.7.0, 2026-11-11)
- Rilis: v0.2.0 (F0+F1A resume engine+F1B tiered intelligence) → v0.5.0 (F2 UX:
  light theme, tasks view, project detail, graph 2D/3D, i18n) → v0.6.0 (**F1C**:
  FTS5 keyword search, embedding Float32 BLOB, dedupe via SQL, list pagination)
  → v0.7.0 (**F3 webhook**: notifikasi Discord/Telegram/generic, 4 event opt-in,
  `POST /api/notify/test`, secret terenkripsi safeStorage).
- Rilis otomatis: push tag `v*` (wajib cocok dengan versi `package.json`) →
  verify (`npm test` + `check:ui`) → build 3 OS → publish GitHub Release.
  Body release diambil dari seksi CHANGELOG versi itu (fallback: git log
  antar-tag). Verify juga jalan di PR dan push ke `main`.
- Sisa backlog: sync terenkripsi antar mesin, code signing (butuh keputusan biaya).

## Arsitektur singkat
- `src/engine/` — inti (tsc, commonjs, output `dist/engine/`): `store/db.ts`
  (node:sqlite `DatabaseSync`, WAL, migrasi `PRAGMA user_version` + ALTER kolom),
  `retrieve/search.ts` (FTS5 external-content trigram `memories_fts` + trigger
  sync; rerank `keywordScore`; fallback scan legacy bila FTS 0 hasil),
  `vecfind.ts`/`vecindex.ts` (LSH per dialek embedding), `extract/` (provider
  heuristik/Ollama/OpenAI-compat), `ingest/` (watcher chokidar + scanner per tool),
  `handoff.ts` (injeksi blok ber-marker ke AGENTS/CLAUDE/GEMINI.md),
  `notify/webhook.ts` (listener event bus), `events.ts` (bus sync untuk SSE).
- `web/` — dashboard vanilla JS (app.js + i18n.js, tanpa framework); SSE live
  update; event delegation untuk aksi baris; `content-visibility` untuk list panjang.
- `src/electron/` — main process (tray, global shortcut, safeStorage).
- Embedding on-disk: **Float32 BLOB** (bukan JSON); codec: `f32ToBlob`/`decodeEmbedding`
  di db.ts. Search membandingkan vektor lintas dialek? JANGAN — guard `embed_model`.

## Perintah penting
- `npm run build` (tsc) · `npm test` (= build + `node --test`, **test jalan terhadap
  dist/, bukan src**) · `npm run check:ui` (audit selector + struktur HTML web/)
- Server lokal: `node dist/engine/index.js server` (port 48210).
- **Server terisolasi (JANGAN sentuh ~/.memoria asli):**
  `HOME=$(mktemp -d) MEMORIA_DATA_DIR=$(mktemp -d) node dist/engine/index.js server`
  — MEMORIA_DATA_DIR = env override resmi; HOME palsu menetralkan watcher chokidar
  (folder sesi besar bisa EMFILE).
- Benchmark search: `node scripts/bench-f1c.mjs 5000` (acceptance: <100 ms).

## Gotcha yang sudah pernah menggigit
- node:sqlite balikin objek null-prototype — akses properti eksplisit, jangan
  `Number(row)` (bug 500 dulu).
- Toggle Settings statis butuh `saveSettings()`/`loadSettingsToggles()` di app.js —
  dulu pernah dipanggil tanpa didefinisi (tidak persist).
- Elemen global `#overlay`/`#toast-wrap` WAJIB anak langsung `<body>` — dijaga
  guard struktural `check:ui` (dulu modal ketelan view hidden).
- String UI: English sebagai kunci `t()`, terjemahan ID di kamus `web/i18n.js`;
  **tanpa emoji** di UI chrome; string engine-facing English-first.

## Next
- Verifikasi installer di mesin asli (migrasi FTS5/BLOB `~/.memoria` jalan otomatis).
- Lanjut backlog F3 sisa di atas; detail posisi terkini selalu di `ROADMAP.md`.
<!-- memoria:end -->
