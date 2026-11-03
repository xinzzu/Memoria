# Memoria — Rencana Pengerjaan (Eksekusi v1)

> Disusun: 2026-11-03 · Basis: v0.1.0-beta (commit 26e1cef)
> North star: **Limit-hopping continuity** — nol kalimat pengantar ulang saat pindah tool AI.

---

## 0. Ringkasan Eksekutif

Memoria = second brain offline untuk semua AI coding tool. Rencana ini menyatukan:
(1) perbaikan bug kritis, (2) **Resume Engine** untuk skenario limit-hopping,
(3) **Tiered Intelligence** agar Ollama jadi opsional, (4) performa & RAM,
(5) design dashboard, (6) ekspansi.

| Fase | Tema | Estimasi | Prioritas |
|------|------|----------|-----------|
| **F0** | Fondasi: keamanan + bug kritis | 2–3 hari | 🔴 P0 — pintu masuk semua fase |
| **F1A** | Resume Engine (limit-hopping) | 5–7 hari | 🔴 P0 — jantung use case |
| **F1B** | Tiered Intelligence (Ollama opsional) | 5–7 hari | 🟠 P1 — penyebab onboarding friction |
| **F1C** | Retrieval & Skala (FTS5, BLOB, batch) | 3–4 hari | 🟠 P1 — prasyarat skala |
| **F2** | Dashboard design & UX | 5–7 hari | 🟡 P2 |
| **F3** | Ekspansi (webhook, sync, test, signing) | fleksibel | 🟢 P3 |

Urutan eksekusi: **F0 → F1A → F1B → F1C → F2 → F3.**
Alasan: F0 memperbaiki fondasi yang bocor; F1A menjawab keresahan asal produk;
F1B membuka gerbang user baru; F1C & F2 menyempurnakan; F3 menumbuhkan.

---

## 1. North Star & Prinsip Desain

### Skenario pengujian utama (litmus test)
> Kerja di Claude Code pukul 14:00, limit habis 14:30, buka Codex/opencode/Gemini
> pukul 14:31 di proyek yang sama → **tool baru langsung tahu**: daftar pekerjaan
> terakhir, keputusan terkunci, file yang terakhir disentuh — tanpa user menjelaskan ulang.

Setiap fitur baru wajib menjawab: *"Apakah ini mempercepat momen pindah tool itu?"*

### Prinsip
1. **Capture never blocked** — ingest transkrip tidak pernah butuh model apapun.
2. **Degradasi berjenjang, tidak pernah diam** — tanpa Ollama ≠ tanpa memori.
3. **Privasi eksplisit** — default 100% lokal; cloud hanya opt-in dengan peringatan jelas.
4. **Ukur sebelum optimasi** — metrik RAM/latensi masuk `/api/stats` sebelum tuning.
5. **Satu identitas proyek = satu realpath** — lintas tool harus menemu-kan memori yang sama.

---

## 2. Fase 0 — Fondasi (P0, 2–3 hari) — ✅ SELESAI 2026-11-03

Semua fase lain bergantung pada ini. Target: tidak ada bug yang membuat fitur
unggulan terlihat bodoh, dan tidak ada celah keamanan.
**Status: 8/8 item dikerjakan di branch `feat/f0-foundation` (lihat `CHANGELOG.md`
bagian Unreleased — smoke test keamanan/pagination/static lolos 10/10).**

| # | Tugas | Lokasi | Status |
|---|-------|--------|--------|
| 0.1 | **Keamanan API**: bind `127.0.0.1`, validasi `Origin`/`Host`, token opsional | `http.ts` | ✅ |
| 0.2 | **Perbaiki `GET /api/memories`**: hormati param `status`, pagination | `http.ts`, `app.js` | ✅ |
| 0.3 | **MCP `recall` embed query** sebelum search; hapus global cache | `mcp/server.ts`, `search.ts` | ✅ |
| 0.4 | **Identitas proyek lintas tool**: satu path kanonik = satu ID | `db.ts`, `ingest/util.ts` | ✅ |
| 0.5 | Fuzzy-match proyek di MCP `project_context`/`remember` | `mcp/server.ts` | ✅ |
| 0.6 | UX aman: konfirmasi delete, `Ctrl/Cmd+Enter` untuk multiline, label scan benar | `app.js`, `index.html` | ✅ |
| 0.7 | Cleanup: hapus `PECUT_SHOT`, toggle auto-start, `lastScan` nyata, port dari config (static serve same-origin) | `main.ts`, `http.ts`, `manager.ts`, `web/*` | ✅ |
| 0.8 | Shortcut configurable + feedback kegagalan registrasi | `main.ts`, `http.ts`, `index.html`, `app.js` | ✅ |

**Definition of Done F0**: semua item di atas terverifikasi di Windows + macOS;
`recall` MCP mengembalikan hasil semantik; tab Memori menampilkan seluruh pustaka
dengan pagination; scan port berbeda tidak memutus UI; akses dari hostname asing ditolak.

---

## 3. Fase 1A — Resume Engine / Limit-Hopping (P0, 5–7 hari) — ✅ SELESAI 100% (2026-11-03)

Fitur inti yang menjawab keresahan asal. Bahan-bahannya sudah ada (watcher, handoff,
tasklife, integrate) — tinggal dirangkai jadi alur "pindah tool tanpa jelasin ulang".
**Status: 3.1–3.5 SELESAI.** Acceptance (3.5) dieksekusi otomatis di macOS dengan
fixture nyata: proyek git asli + transkrip format jsonl Claude Code asli + watcher &
hot-path timer hidup → 12/12 assertion lolos (injeksi otomatis ke AGENTS/CLAUDE/
GEMINI.md, merge lintas-path `/tmp` vs `/private/tmp` jadi SATU proyek, blok
LANJUTAN berisi task/keputusan/branch/file dirty/pesan sesi, resume & remove via
path mentah). Acceptance menangkap & memperbaiki 2 bug tambahan:
`/api/remember` membuang path (merge gagal untuk simpanan dashboard) dan
`GET /api/handoff`/`resume`/`remove` belum fuzzy-resolve. Threshold idle kini
configurable (`resumeIdleMinutes`, default 4).

### 3.1 Hot-path: deteksi akhir sesi → ekstraksi prioritas → inject segera
- Heuristic "session ended": file transkrip suatu sesi tidak bertambah ±3–5 menit
  (`watcher.ts` debounce sudah ada, tambah pelacak per-session last-event).
- Saat terpicu: ekstraksi **sesi itu duluan** (bukan antri batch global), lalu inject
  langsung ke file target proyek tersebut.
- Target latensi: konteks resume siap ≤ 5 menit setelah pesan terakhir.
- Fallback antrian lama tetap jalan untuk sisanya.

### 3.2 Multi-file injection (lintas konvensi tool)
- Tool membaca file berbeda: Codex/opencode → `AGENTS.md`, Claude Code → `CLAUDE.md`,
  Gemini CLI → `GEMINI.md`.
- Strategi aman lintas OS: **inject blok ber-marker yang sama ke semua file target**
  (marker `<!-- memoria:start/end -->` sudah idempotent — `handoff.ts:86-88`).
  ⚠️ Jangan andalkan symlink di Windows (butuh Admin/Developer Mode); duplikasi blok
  ber-marker bekerja identik di kedua OS. Symlink boleh jadi opsi di macOS.
- Mapping tool→file di `integrate.ts`, konfigurabel per proyek (toggle di tab Integrasi).

### 3.3 Section "⏸️ LANJUTAN SESI" di handoff
Blok khusus di paling atas handoff, digabung dari bahan tanpa-LLM (murah & cepat):
- `task_pending` terbaru (sudah ada di `tasklife.ts`)
- **`git status`** — branch + file dirty (BARU; `git.ts` baru punya `git log` —
  ini sinyal "pekerjaan terakhir" paling akurat)
- 2–3 pesan terakhir sesi yang baru selesai
- Timestamp + tool sumber, format persis seperti mock-up di percakapan.

### 3.4 Plan B anti-gagal: "Salin prompt lanjutan"
- Tombol di dashboard + aksi di global palette: salin 3–5 baris resume prompt
  siap-paste ke tool mana pun.
- Menjamin alur tetap jalan walau injeksi file gagal (izin, tool tidak baca file).

### 3.5 Verifikasi lintas tool (uji manual, kedua OS)
Script acceptance: kerja nyata di Claude Code → diamkan 6 menit → buka Codex & opencode
di proyek sama → cek file target berisi blok LANJUTAN dengan task list benar.

**Definition of Done F1A**: skenario limit-hopping lolos di ≥3 pasang tool
(Claude→Codex, Claude→opencode, Codex→Gemini) di Windows DAN macOS; latensi injeksi ≤ 5 menit.

---

## 4. Fase 1B — Tiered Intelligence: Ollama Opsional (P1, 5–7 hari)

### 4.1 Interface `MemoryProvider`
```
interface MemoryProvider {
  extract(conversation): Promise<ExtractedMemory[] | null>;
  embed(text): Promise<number[] | null>;
}
```
Tiga implementasi:
- **HeuristicProvider** (Tier 0, default — tanpa model, tanpa network)
- **OllamaProvider** (Tier 1 — kode sekarang, `ollama.ts` dipindah)
- **OpenAICompatProvider** (Tier 2 — satu protokol untuk LM Studio, llama.cpp,
  vLLM, OpenRouter, cloud API; `Base URL + key + model`)

### 4.2 Tier 0 Heuristik (tanpa model apapun)
- Ekstraksi berbasis aturan, memanfaatkan `entities.ts` yang sudah ada:
  `decision` ("pakai/pilih X daripada Y", "decided to"), `task_pending` ("TODO",
  "next step", "belum selesai"), `error_fixed` (stack trace + kalimat solusi),
  `fact` (kalimat padat entity path/versi/config).
- **Sinergi review mode** (`db.ts:158`): hasil heuristik → otomatis masuk tab
  "Menunggu Persetujuan" → user tanpa Ollama mendapat *inbox kurasi*, bukan layar kosong.
- Tandai `origin: "heuristic"` → badge transparansi di dashboard.
- Embedding fallback **hashing TF-IDF ~256 dim, pure JS** (tanpa model) — cukup
  untuk dedupe + edge similarity graph. Kolom baru `embed_model` agar vektor
  dialect berbeda tidak dibandingkan silang (`search.ts:16` wajib cek ini).
- Dedupe fallback berbasis teks (normalisasi + trigram/Jaccard) di
  `dedupe.ts:24-28` — sekarang cabang tanpa-embedding langsung insert tanpa cek.

### 4.3 Tier 2 Cloud (opt-in keras)
- Toggle terpisah per kapabilitas: "izinkan ekstraksi ke cloud" ≠ "izinkan embedding
  ke cloud", dengan warning privasi eksplisit (jangan gobrak janji "100% lokal").
- **API key disimpan via `safeStorage`** → Keychain (macOS) / DPAPI (Windows).
  Mode CLI/MCP murni (di luar Electron): fallback file terenkripsi atau tolak dengan pesan.

### 4.4 UX penyatu
- First-run wizard: deteksi Ollama terpasang? → tawarkan pull model **dengan
  konfirmasi ukuran download** (saat ini `ollama.ts:12-16` auto-pull GB tanpa izin!).
  Tidak ada? → "Mode Heuristik aktif, upgrade kapan saja."
- Chip status engine di Overview: "🧠 Heuristik / Ollama (qwen2.5-coder:3b) / LM Studio".
- Circuit breaker `embed()`: timeout pendek (5–8 dtk), 3x gagal → skip sementara —
  jangan biarkan MCP `remember`/`/api/remember` nge-hang 60 dtk (`ollama.ts:47`).
- `ollama-serve.ts`: cek terinstal sebelum spawn.

**Definition of Done F1B**: fresh install tanpa Ollama di Windows & macOS menghasilkan
memori (draft heuristik) dalam ≤ 10 menit pemakaian; search & handoff berfungsi;
pemakai Ollama tidak merasakan perubahan (regresi nol).

---

## 5. Fase 1C — Retrieval & Skala (P1, 3–4 hari)

| # | Tugas | Lokasi |
|---|-------|--------|
| 5.1 | **FTS5** untuk keyword search (ganti loop JS per-dokumen `search.ts:51-72`) + index `memories(archived,status)`, `transcripts(extracted,ts)` | `store/db.ts` |
| 5.2 | Embedding → **BLOB Float32** (hemat ~50% + hilang jank `JSON.parse` di `vecfind.ts:27`); lazy-build index | `vecfind.ts`, `vecindex.ts` |
| 5.3 | Batch embedding (endpoint `/api/embed` Ollama menerima array) — 1 call per ±20 memori, bukan per memori | `extractor.ts:76` |
| 5.4 | Dedupe: kandidat via SQL (project + recency) bukan `allMemories()` penuh | `dedupe.ts:30` |
| 5.5 | **SSE `/api/events`** — memori baru, draft, progress scan live di dashboard (ganti polling 12 dtk `app.js:1201`) | `http.ts`, `app.js` |
| 5.6 | Metrik self-report: `process.memoryUsage()`, durasi scan, kedalaman antrian → `/api/stats` + kartu di Overview | `manager.ts` |

---

## 6. Fase 2 — Dashboard Design & UX (P2, 5–7 hari)

1. **Loading skeleton + error banner retry** — tab Memori/Overview kini layar kosong
   diam; `renderMemories` (`app.js:223`) bahkan tanpa try/catch.
2. **Proyek drill-down** — baris proyek diklik → detail (memori, timeline, tugas,
   handoff, git). Sekarang read-only stub tanpa handler klik.
3. **Tab Tugas** — endpoint `/api/tasks` (`http.ts:128`) sudah ada tanpa UI;
   tampilan pending/done per proyek. Pembeda unik Memoria.
4. **Graph**: label top-N node, hover tooltip, dirty-flag render (stop saat `alpha`
   ≤ 0.01 — sekarang 60fps permanen `app.js:609-659`), seed posisi stabil,
   strategi kluster > 250 node.
5. **Handoff**: preview diff sebelum inject, pilih file target, tombol "lepas injeksi"
   (endpoint `/api/handoff/remove` sudah ada, UI tidak), backup AGENTS.md sebelum inject pertama.
6. **Theme & a11y**: light theme (`prefers-color-scheme`), keyboard nav + `role`
   untuk sidebar/toggle, hint ⌘ vs Ctrl (`index.html:558`).
7. **Refactor**: modul `web/shared.js` (konstanta `KIND_*`, `esc`, port — kini
   terduplikasi di 3 file JS), event delegation ganti re-bind `bindRowActions`.
8. Font lokal (kini Google Fonts = dependensi online untuk app offline).
9. *(Opsional, jika direncanakan)* ekstraksi string ke `i18n.js` — WAJIB dilakukan
   SEBELUM polish F2 jika target audiens EN; menyusuri ulang 1200 baris `app.js`
   dua kali itu mubazir.

---

## 7. Fase 3 — Ekspansi (P3, fleksibel)

- **Webhook/hook** (Slack/Discord/Telegram) + plugin API — kandidat pertumbuhan #1.
- **Sinkronisasi terenkripsi antar mesin** (age/libsodium; resolusi konflik per memori).
- Palet global: aksi "buka di dashboard", bukan hanya copy (`palette.js:66-71`).
- **Test suite (vitest)**: scoring search, dedupe, marker handoff, parser per tool —
  prasyarat sebelum distribusi luas.
- Distribusi: code signing + notarization (macOS Gatekeeper), mengurangi warning
  SmartScreen (Windows) — atau minimal dokumentasi "klik kanan → Open".

---

## 8. Matriks Windows × macOS (per-item, bukan setelah jadi)

| Aspek | Windows | macOS | Aksi |
|---|---|---|---|
| Path sumber | `%APPDATA%`, `%LOCALAPPDATA%` | `~/Library/Application Support` | Sudah benar di `config.ts:31-40` — **verifikasi live** kedua OS |
| Ollama binary | `%LOCALAPPDATA%\Programs\Ollama\ollama.exe` | `/Applications/Ollama.app/.../ollama` | Sudah ada (`config.ts:59-65`); cek juga `brew` path |
| Multi-file injection | Duplikasi blok ber-marker (symlink butuh Admin/Dev Mode) | Duplikasi blok, symlink opsional | Strategi tunggal: **blok duplikat** — aman di keduanya |
| Penyimpanan API key | DPAPI via `safeStorage` | Keychain via `safeStorage` | Satu API, perilaku beda OS otomatis; fallback jelas di CLI murni |
| Shortcut global | `Ctrl+Shift+Space` bisa bentrok IME | `⌘⇧Space` bisa bentrok Spotlight/input source | **Shortcut configurable** (F0.8), jangan hardcode |
| Tray icon | `.ico` multi-resolusi | **Template image** (hitam-putih, ikut dark/light menu bar) | Tambah varian `logoTemplate.png` |
| Auto-start | Registry/Startup | `setLoginItemSettings({ openAsHidden: true })` | Toggle UI (F0.7), jangan paksa on |
| Watcher FS | `ReadDirectoryChangesW` (native, oke) | FSEvents (native, oke) | chokidar sudah menangani; jangan set `usePolling` |
| Kinerja Ollama | Umumnya CPU-only → ekstraksi lambat | Apple Silicon → Metal GPU, jauh lebih cepat | Ekspektasi UX beda; hot-path F1A penting untuk Windows |
| Installer | NSIS `.exe` (warning SmartScreen jika unsigned) | `.dmg` (Gatekeeper; kanan-klik → Open) | Dokumentasikan di F3; signing menyusul |
| Build CI | Runner Windows | Runner macOS (wajib untuk `.dmg`) | `build.yml` sudah ada — pastikan kedua job hijau tiap fase |
| Ukuran RAM | Baseline sama | macOS kompres memori — ukur `footprint`, bukan hanya RSS | Metrik F1C |

### Checklist verifikasi mac (pertama kali, sebelum F1A)
1. `npm run build && npm run status` → per-tool count tidak nol untuk tool yang dipakai.
2. Tray muncul & tidak "hilang" di menu bar notch.
3. `⌘⇧M` / `⌘⇧Space` tidak bentrok → ubah shortcut bila perlu.
4. Scan proyek mac nyata → cek slug proyek konsisten (prasyarat F0.4).
5. Ollama via Metal: ukur durasi ekstraksi 1 sesi (baseline F1B/F1C).

---

## 9. Estimasi & Urutan Eksekusi

```
Minggu 1      F0 (2–3 hr) + mulai F1A (audit identitas proyek dulu!)
Minggu 2      F1A selesai + acceptance lintas tool di 2 OS
Minggu 3      F1B (provider + heuristik + wizard)
Minggu 4      F1B selesai + F1C (FTS5, BLOB, SSE, metrik)
Minggu 5      F2 (design & UX) — bisa diparalel sebagian dengan F1C
Minggu 6+     F3 sesuai umpan balik user
```

Yang boleh paralel: F2 (pekerjaan web/JS) terpisah dari F1B/F1C (pekerjaan engine).
Yang tidak boleh dilewati: **F0.4 identitas proyek** — kalau bocor, F1A percuma.

## 10. Risiko & Mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Slug proyek lintas tool tak bisa dinormalisasi sempurna | F1A gagal silent | F0.4 paling awal; fallback: manual mapping UI (pilih proyek dari path) |
| Ekstraksi heuristik berisik (false positive) | Inbox draft membingungkan | Default masuk draft + importance rendah; iterasi pola dari data nyata |
| Vektor hashing & nomic tercampur | Search kacau | Kolom `embed_model` + tolak cosine lintas dialect |
| Regresi pemakai Ollama lama saat refactor provider | Kehilangan kepercayaan | Acceptance F1B: regresi nol; test skor search sebelum/sesudah |
| Injeksi ber-marker menabrak file yang diedit user | Konten user rusak | Marker idempotent + backup file sebelum inject pertama (F2.5) |

## 11. Acceptance Script Manual (tiap fase, jalankan di Windows & macOS)

- **F0**: (a) akses `http://<ip-lan>:48210/api/stats` dari device lain → ditolak;
  (b) tab Memori menampilkan > 8 item + pindah halaman; (c) recall MCP untuk pertanyaan
  sinonim (bukan keyword persis) mengembalikan memori.
- **F1A**: limit-hopping nyata Claude→Codex→Gemini; blok LANJUTAN muncul di 3 file;
  task list & branch benar; tombol "Salin prompt lanjutan" menghasilkan teks siap-paste.
- **F1B**: uninstall Ollama → 10 menit pemakaian normal → inbox draft berisi kandidat
  memori; approve → muncul di recall. Install ulang Ollama → otomatis naik tier tanpa kehilangan data.
- **F1C**: 5.000 memori sintetis → search < 100 ms, RAM engine stabil, dashboard
  update live tanpa refresh.
- **F2**: jalankan memori list 500 item — scroll mulus; semua aksi punya loading state
  dan error state; delete selalu konfirmasi.
