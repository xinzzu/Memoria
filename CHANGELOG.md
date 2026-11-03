# Changelog

Semua perubahan penting pada Memoria didokumentasikan di file ini.
Format mengikuti [Keep a Changelog](https://keepachangelog.com/id/1.1.0/);
versioning mengikuti [Semantic Versioning](https://semver.org/lang/id/).

## [Unreleased] — Fase 1A: Resume Engine (limit-hopping)

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

## [Unreleased] — Fase 0 (fondasi)

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
