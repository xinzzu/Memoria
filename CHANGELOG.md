# Changelog

Semua perubahan penting pada Memoria didokumentasikan di file ini.
Format mengikuti [Keep a Changelog](https://keepachangelog.com/id/1.1.0/);
versioning mengikuti [Semantic Versioning](https://semver.org/lang/id/).

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
