<div align="center">

<img src="banner.png" alt="Memoria banner">

# Memoria

**Second brain offline untuk semua AI coding tools.**

[English](README.md) · **Bahasa Indonesia**

</div>

---

> 🌍 Dokumen ini ringkasan Bahasa Indonesia. Untuk dokumentasi lengkap & terbaru, baca [README.md](README.md) (English).

## Kenapa?

Setiap tool AI punya memori pendek. Claude tidak ingat sesi kemarin, Codex tidak tahu keputusan yang
disepakati di Gemini CLI — dan saat limit habis di tengah pekerjaan, Anda menjelaskan semuanya dari
nol di tool lain.

**Memoria menutup celah itu**: menangkap sesi dari 9 tool AI, mengekstrak fakta / keputusan / tugas /
error-fix, lalu menyalurkannya ke sesi berikutnya — otomatis, 100% lokal.

Dirancang untuk alur **limit-hopping**: limit habis jam 14:30, buka tool lain jam 14:31 — tool baru
sudah tahu Anda sedang mengerjakan apa.

## Cara kerja singkat

1. Bekerja seperti biasa di tool AI mana pun — transkrip tertangkap real-time.
2. Mesin ekstraksi bertingkat mengubahnya menjadi memori (fakta, keputusan, tugas, error-fix).
3. Saat sesi diam ±4 menit, **resume engine** mengekstrak sesi terbaru lebih dulu dan menyuntikkan
   blok **SESSION RESUME** (tugas terbuka, keputusan terkunci, branch, file yang berubah) ke
   `AGENTS.md` / `CLAUDE.md` / `GEMINI.md`.
4. Buka tool lain — langsung nyambung.

## Fitur utama

| | |
|---|---|
| 🔄 Capture 9 tool | Claude Code, Codex, opencode, Gemini CLI, Copilot, Antigravity, VS Code, Cursor, Windsurf |
| ⏸️ Resume engine | Hot-path ekstraksi + injeksi multi-file + prompt lanjutan siap-paste |
| ✅ Tab Tasks | Semua janji tugas dari sesi AI dalam satu checklist |
| 🧠 Tiered intelligence | Tanpa model pun jalan (heuristik → antrian tinjau); Ollama atau endpoint OpenAI-compatible sebagai upgrade |
| 🔍 Retrieval hibrid | Keyword + embedding + graph centrality, toleran typo |
| 🕸️ Graph memori | Interaksi ala Obsidian |
| 🌐 EN/ID | English default, Indonesia satu klik |
| 🔐 Privasi | 100% lokal; API key terenkripsi via OS keychain; tanpa telemetri |

## Mulai cepat

| OS | Paket |
|---|---|
| Windows | `Memoria Setup 0.5.0.exe` dari [Releases](https://github.com/xinzzu/Memoria/releases) |
| Linux | `memoria_0.5.0_amd64.deb` atau `Memoria-0.5.0.AppImage` |
| macOS | `Memoria-0.5.0.dmg` |

Tanpa Ollama pun langsung bekerja (mode heuristik). Untuk ekstraksi kelas LLM:

```bash
ollama pull qwen2.5-coder:3b
ollama pull nomic-embed-text
```

Daftarkan tool di tab **Integrations**, atau CLI:

```bash
node dist/engine/index.js integrate claude
node dist/engine/index.js scan
node dist/engine/index.js recall "kata kunci"
```

## Dokumentasi

- [ROADMAP.md](ROADMAP.md) — rencana eksekusi & posisi terkini
- [CHANGELOG.md](CHANGELOG.md) — catatan rilis
- [README.md](README.md) — dokumentasi lengkap (English)

## Lisensi

MIT © 2026 Memoria

---

_Dibuat di Indonesia — supaya agent AI Anda tidak pernah lupa lagi._
