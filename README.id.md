<div align="center">

<img src="banner.png" alt="Memoria banner">

# Memoria

**Second brain offline untuk semua AI coding tools — 100% lokal.**

Claude Code, Codex, Gemini CLI, Copilot, Antigravity, opencode, VS Code, Cursor, Windsurf —
satu memori bersama yang mengingat semua yang pernah Anda kerjakan dan menyalurkannya ke sesi berikutnya.

Tanpa cloud. Tanpa akun. Tidak ada data yang keluar dari komputer Anda.

<br>

![Windows · Linux · macOS](https://img.shields.io/badge/platform-Windows%20%E2%80%A2%20Linux%20%E2%80%A2%20macOS-6e8dff)
![Node](https://img.shields.io/badge/node-%E2%89%A522.5-339933)
![Electron](https://img.shields.io/badge/Electron-37-47848f)
![Inference](https://img.shields.io/badge/inference-opsional%20%28Ollama%20%2F%20OpenAI%20compat%29-529fff)
![Data](https://img.shields.io/badge/data-100%25%20lokal-4cc38a)
![Status](https://img.shields.io/badge/status-0.7.1--beta-7f6eff)
[![Release](https://img.shields.io/github/v/release/xinzzu/Memoria?label=Release)](https://github.com/xinzzu/Memoria/releases)
[![Build](https://github.com/xinzzu/Memoria/actions/workflows/build.yml/badge.svg?label=Build)](https://github.com/xinzzu/Memoria/actions)
[![License](https://img.shields.io/github/license/xinzzu/Memoria)](LICENSE)

[English](README.md) · **Bahasa Indonesia**

</div>

---

## Kenapa?

Setiap tool AI punya amnesia jangka pendek. Claude tidak ingat sesi kemarin. Codex tidak tahu
keputusan "grid 12 kolom" yang Anda sepakati di Gemini CLI. Dan saat limit habis di tengah
pekerjaan lalu pindah ke tool lain, Anda menjelaskan semuanya dari nol.

**Memoria menutup celah itu.** Ia mengawasi sesi AI tool Anda, mengekstrak hal penting — fakta,
keputusan, tugas, error-fix — lalu menyalurkannya ke sesi berikutnya, di tool apa pun, otomatis.

Dibuat untuk alur **limit-hopping**: limit habis jam 14:30, buka tool lain jam 14:31 — tool baru
sudah tahu Anda sedang mengerjakan apa.

---

## Cara kerja

1. Bekerja seperti biasa di tool AI mana pun — transkrip tertangkap real-time.
2. Mesin ekstraksi bertingkat mengubahnya menjadi memori (fakta, keputusan, tugas, error-fix),
   diindeks dengan keyword (FTS5) + embedding + graph.
3. Saat sesi diam ±4 menit, **resume engine** mengekstrak sesi terbaru lebih dulu dan menyuntikkan
   blok **SESSION RESUME** (tugas terbuka, keputusan terkunci, branch, file yang berubah) ke
   `AGENTS.md` / `CLAUDE.md` / `GEMINI.md`.
4. Buka tool lain — langsung nyambung.
5. (Opsional) Sinkronkan pustaka memori yang sama ke perangkat lain dengan bundle terenkripsi E2E.

## Fitur utama

| | |
|---|---|
| 🔄 **Capture 9 tool** | Claude Code, Codex, opencode, Gemini CLI, Copilot, Antigravity, VS Code, Cursor, Windsurf |
| ⏸️ **Resume engine** | Blok SESSION RESUME otomatis di AGENTS.md / CLAUDE.md / GEMINI.md: tugas terbuka, keputusan terkunci, branch, file kotor |
| ✅ **Tab Tasks** | Semua janji/tugas dari sesi AI dalam satu checklist |
| 🧠 **Tiered intelligence** | Jalan **tanpa model** (heuristik → antrian tinjau), dengan Ollama, atau endpoint OpenAI-compatible (LM Studio, llama.cpp, vLLM, cloud — opt-in) |
| 🔍 **Retrieval hibrid** | Keyword (FTS5) + embedding + graph centrality, toleran typo |
| 🕸️ **Graph memori** | Interaksi ala Obsidian: label node, fokus tetangga, zoom & pan |
| 📋 **Tasks & timeline** | Aktivitas per proyek + riwayat git + digest mingguan |
| 🔎 **Palette global** | Cari & salin memori dari mana saja; hotkey quick-note |
| 🔐 **Sync terenkripsi (opsional)** | Bundle `.memsync` E2E antar perangkat — manual atau folder bersama (Dropbox/iCloud/Syncthing/jaringan), tanpa server/embedding/secret/transkrip |
| 🔔 **Webhook & notifikasi** | Alert opt-in ke Discord, Telegram, atau webhook JSON generik (digest, scan, approval, draft) |
| 🌐 **UI EN/ID** | English default, Bahasa Indonesia satu klik |
| 💾 **Backup & ekspor** | Auto-backup (10 terakhir), restore, ekspor Markdown / JSON / Obsidian vault |

## Kebutuhan

| | Minimum | Catatan |
|---|---|---|
| Windows | 10/11 | |
| Linux | distro .deb / AppImage | tray butuh libappindicator |
| macOS | 12+ | Apple Silicon & Intel |
| Node.js | ≥ 22.5 | hanya untuk build dari source |
| Ollama | **opsional** | upgrade untuk ekstraksi & embedding kelas LLM |
| RAM | 4 GB (8 GB direkomendasikan) | jalan CPU-only |

## Mulai cepat

### 1 · Instal

| OS | Paket |
|---|---|
| Windows | `Memoria Setup 0.9.0.exe` dari [Releases](https://github.com/xinzzu/Memoria/releases) |
| Linux | `memoria_0.9.0_amd64.deb` (`sudo dpkg -i`) atau `Memoria-0.9.0.AppImage` |
| macOS | `Memoria-0.9.0.dmg` (seret ke Applications; klik kanan → Open jika digate) |

Memoria berjalan di tray dan langsung mulai menangkap.

### 2 · Jalan pertama — tanpa model

Secara bawaan Memoria memakai **Tier 0 heuristik**: sesi ditangkap dan menjadi kandidat memori
yang masuk ke inbox **Pending approval** untuk Anda kurasi. Search, tasks, timeline, graph,
handoff — semuanya tetap bekerja.

Ingin ekstraksi & embedding kelas LLM?

```bash
ollama pull qwen2.5-coder:3b
ollama pull nomic-embed-text
```

Memoria mendeteksi otomatis (±5 menit) dan naik tier — tanpa konfigurasi ulang atau migrasi data.
Lebih suka LM Studio / llama.cpp / endpoint cloud? Settings → **Engine**.

### 3 · Daftarkan tool

Buka tab **Integrations** → registrasi satu klik per tool, atau via CLI:

```bash
node dist/engine/index.js integrate claude
node dist/engine/index.js scan
```

Lalu mulai sesi baru dan minta agen Anda:

```
Recall the decisions from previous sessions in this project.
```

### 4 · CLI

```bash
node dist/engine/index.js scan
node dist/engine/index.js recall "kata kunci"
node dist/engine/index.js status
node dist/engine/index.js mcp

# sync terenkripsi (satu user, banyak perangkat)
node dist/engine/index.js sync setup                         # buat group + recovery code
node dist/engine/index.js sync status
node dist/engine/index.js sync export --out ./bundle.memsync
node dist/engine/index.js sync import --in ./bundle.memsync --embed
node dist/engine/index.js sync folder set /path/ke/folder   # auto-sync via folder bersama
node dist/engine/index.js sync folder status
node dist/engine/index.js sync conflicts
```

## Sync terenkripsi (opsional)

Sinkronkan pustaka memori antar perangkat (user yang sama) dengan bundle end-to-end encrypted:

- **Transport:** ekspor/impor manual `.memsync` atau folder bersama yang dipantau Memoria
  (Dropbox, iCloud Drive, Syncthing, network share).
- **Kripto:** group key 256-bit + recovery code, bundle AES-256-GCM (HKDF per file, header
  terikat AAD), apply idempoten dengan HLC/LWW serta penanganan konflik/tombstone.
- **Tidak pernah disinkronkan:** embedding, secret/API key, settings, transkrip mentah, atau path lokal mesin.
- **Setup:** `memoria sync setup` (buat/join group) lalu export/import atau `memoria sync folder set`.
- **Dashboard:** Settings → **Sync** menampilkan status group/device, pending outbox, ekspor/impor
  terakhir, status/error folder, dan konflik terbaru (setup group, unlock passphrase, dan transfer
  bundle manual tetap via CLI).

> Hardening sync (rotasi/revokasi kunci, proteksi rollback, performance pass) direncanakan (M5).

## Dashboard

Sembilan view, English atau Bahasa Indonesia:

- **Overview** — ringkasan, kartu statistik, chart aktivitas 7 hari, proyek terbaru, resume-ready, checklist setup
- **Memories** — pustaka lengkap: cari, filter kind/proyek/topik, inbox approval, arsip
- **Projects** — aktivitas per proyek, masuk ke timeline
- **Timeline** — jejak sesi + riwayat git
- **Handoff** — buat, salin, atau injeksikan blok resume
- **Tasks** — papan janji tugas dari sesi AI
- **Graph** — koneksi memori, interaksi ala Obsidian
- **Integrations** — registrasi MCP satu klik
- **Settings** — dua panel: sumber data, engine, perilaku, data/backup, notifikasi, dan sync

Global: `Ctrl/⌘ + Shift + M` quick note · `Ctrl/⌘ + Shift + Space` memory palette (bisa diubah di Settings).

## Privasi

- Capture, ekstraksi, dan pencarian — 100% lokal di `~/.memoria` secara default.
- Tier OpenAI-compatible adalah **satu-satunya** jalur data keluar dari mesin, dan hanya aktif
  jika Anda mengaktifkannya secara eksplisit (dengan peringatan privasi).
- API key dan secret webhook dienkripsi OS (Keychain di macOS / DPAPI di Windows) bila tersedia
  dan tidak pernah dikembalikan ke UI.
- Bundle sync terenkripsi E2E dan tidak pernah berisi embedding, secret, settings, transkrip, atau path lokal.
- Memori lama/kurang penting diarsipkan otomatis (forgetting curve); backup menyimpan 10 versi terakhir.

## Pengembangan

```bash
git clone https://github.com/xinzzu/Memoria && cd Memoria
npm install
npm run dev          # TypeScript watch mode
npm run build        # compile sekali
npm test             # build + node --test (41 tes)
npm run start        # Electron dev (engine di port 48210)
npm run check:ui     # audit selector + struktur UI
npm run dist         # installer Windows
npm run dist:linux   # AppImage + .deb
npm run dist:mac     # .dmg + .zip (khusus macOS)
```

> Tes berjalan terhadap `dist/` (bukan `src/`). Untuk server terisolasi gunakan
> `MEMORIA_DATA_DIR=$(mktemp -d)` dan jangan sentuh DB `~/.memoria` asli atau port `48210`.

### Struktur proyek

```
src/
├── engine/
│   ├── config.ts              # sumber data & konfigurasi tool per OS
│   ├── http.ts                # API lokal (127.0.0.1:48210) + dashboard statis
│   ├── ingest/                # watcher + parser per tool (claude, codex, vscdb, …)
│   ├── extract/               # tier provider, heuristik, ollama, openai-compat,
│   │                          # entitas, topik, task lifecycle, dedupe
│   ├── retrieve/search.ts     # retrieval hibrid (FTS5 + embedding + centrality)
│   ├── sync/                  # sync E2E terenkripsi (kunci, bundle, export/apply,
│   │                          # transport folder bersama, CLI, embed backfill)
│   ├── mcp/server.ts          # MCP server (stdio)
│   ├── store/                 # SQLite (node:sqlite), migrasi, backup, secure storage
│   ├── notify/webhook.ts      # notifikasi opt-in Discord/Telegram/generic
│   ├── handoff.ts             # resume engine + injeksi multi-file
│   └── index.ts               # entri CLI
├── electron/main.ts           # tray, dashboard, hotkey global
web/                           # UI dashboard (vanilla JS, i18n EN/ID)
scripts/                       # generator ikon, audit UI, benchmark search
docs/                          # dokumen desain (mis. sync-design.md)
tests/                         # suite node --test (berjalan terhadap dist/)
ROADMAP.md                     # rencana eksekusi & posisi terkini
CHANGELOG.md                   # catatan rilis
```

### Teknologi

TypeScript · Node 24 (`node:sqlite`, FTS5) · Electron 37 · chokidar · MCP SDK · vanilla JS dashboard

## FAQ

**Apakah data saya keluar dari komputer?**
Tidak. Capture, ekstraksi, dan pencarian berjalan lokal di `~/.memoria`. Tier cloud hanya aktif
jika Anda mengonfigurasinya secara eksplisit.

**Bisa sync antar perangkat?**
Bisa. Buat/join sync group (`memoria sync setup`), lalu ekspor/impor bundle `.memsync` manual
atau arahkan Memoria ke folder bersama (Dropbox/iCloud/Syncthing/network share) via CLI atau
Settings → Sync. Bundle terenkripsi E2E dan tidak pernah berisi embedding, secret, settings,
transkrip, atau path lokal.

**Apakah saya butuh Ollama?**
Tidak. Heuristik berjalan tanpa model — inbox tinjau memandu Anda. Ollama adalah jalur upgrade
yang terdeteksi otomatis saat terpasang.

**Tool apa saja yang didukung?**
Claude Code, Codex, opencode, Gemini CLI, Copilot, Antigravity — plus capture VS Code, Cursor,
Windsurf, dan endpoint generik `/api/import`.

**Apakah memori akan tumbuh selamanya?**
Tidak — memori lama/kurang penting diarsipkan otomatis (forgetting curve); backup menyimpan 10 versi terakhir.

**Bisa dapat notifikasi di luar dashboard?**
Bisa, opt-in. Konfigurasikan Discord, Telegram, atau webhook JSON generik di Settings →
Notifications untuk event digest/scan/approval/draft. Secret webhook disimpan terenkripsi bila tersedia.

**Bahasa UI?**
English secara default; Bahasa Indonesia satu klik di Settings.

## Dokumentasi

- [README.md](README.md) — dokumentasi lengkap (English)
- [ROADMAP.md](ROADMAP.md) — rencana eksekusi & posisi terkini
- [CHANGELOG.md](CHANGELOG.md) — catatan rilis
- [docs/sync-design.md](docs/sync-design.md) — desain & status sync terenkripsi

## Lisensi

MIT © 2026 Memoria

---

_Dibuat di Indonesia — supaya agent AI Anda tidak pernah lupa lagi._
