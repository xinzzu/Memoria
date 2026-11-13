<div align="center">

<img src="banner.png" alt="Memoria banner">

# Memoria

**A second brain for every AI coding tool — 100% local.**

Claude Code, Codex, Gemini CLI, Copilot, Antigravity, opencode, VS Code, Cursor, Windsurf —
one shared memory that remembers everything you've ever done and feeds it into your next session.

No cloud. No account. Nothing leaves your computer.

<br>

![Windows · Linux · macOS](https://img.shields.io/badge/platform-Windows%20%E2%80%A2%20Linux%20%E2%80%A2%20macOS-6e8dff)
![Node](https://img.shields.io/badge/node-%E2%89%A522.5-339933)
![Electron](https://img.shields.io/badge/Electron-37-47848f)
![Inference](https://img.shields.io/badge/inference-optional%20%28Ollama%20%2F%20OpenAI%20compat%29-529fff)
![Data](https://img.shields.io/badge/data-100%25%20local-4cc38a)
![Status](https://img.shields.io/badge/status-0.8.0--beta-7f6eff)
[![Release](https://img.shields.io/github/v/release/xinzzu/Memoria?label=Release)](https://github.com/xinzzu/Memoria/releases)
[![Build](https://github.com/xinzzu/Memoria/actions/workflows/build.yml/badge.svg?label=Build)](https://github.com/xinzzu/Memoria/actions)
[![License](https://img.shields.io/github/license/xinzzu/Memoria)](LICENSE)

**English** · [Bahasa Indonesia](README.id.md)

</div>

---

## Why?

Every AI tool has short-term amnesia. Claude doesn't remember yesterday's session. Codex doesn't
know you decided "12-column grid" in Gemini CLI. And when you hit your usage limit mid-task and
switch to another tool, you explain everything all over again.

**Memoria closes that gap.** It watches your AI tool sessions, extracts what matters — facts,
decisions, tasks, fixed errors — and hands it to the next session, in any tool, automatically.

Built for the **limit-hopping** workflow: hit your limit at 14:30, open a different tool at
14:31 — and it already knows what you were working on.

---

## How it works

```
        Your AI tool sessions
  Claude Code · Codex · Gemini · Copilot · Antigravity · opencode · VS Code · Cursor · Windsurf
        │                              │
        │ jsonl / sqlite / logs        │ /memory · /recall  (MCP stdio)
        ▼                              ▼
   WATCHER (real-time)           MCP SERVER
        │                              ▲
        ▼                              │
   EXTRACTION — tiered, never blocked  │
   Tier 2  OpenAI-compatible (opt-in)  │
   Tier 1  Ollama (local LLM)          │
   Tier 0  Heuristics (no model!)      │
        ▼                              │
   ┌───────────────────────────────────────┐
   │   LOCAL DATABASE (SQLite)             │
   │   memories + graph + embeddings       │──── context injected into
   └──────────────────┬────────────────────┘     AGENTS.md · CLAUDE.md · GEMINI.md
        ▼                              │
   DASHBOARD (Electron tray app)       │
```

1. Work as usual in any AI tool.
2. Memoria captures new sessions in real time and stores them locally.
3. The active intelligence tier extracts memories — indexed by keyword + embeddings + graph links.
4. When a session goes idle (~4 minutes = session ended), the **resume engine** kicks in: the
   newest session is extracted first, and a **SESSION RESUME** block is injected into the context
   files your tools actually read.
5. Open the dashboard anytime — overview, memories, task board, graph, handoffs.
6. (Optional) Sync the same memory library across your machines with end-to-end encrypted bundles.

## Highlights

| | |
|---|---|
| 🔄 **Capture from 9 tools** | Claude Code, Codex, opencode, Gemini CLI, Copilot, Antigravity, VS Code, Cursor, Windsurf |
| ⏸️ **Resume engine** | A SESSION RESUME block auto-injected into AGENTS.md / CLAUDE.md / GEMINI.md: open tasks, locked decisions, current branch, dirty files |
| ✅ **Tasks view** | Every task your AI sessions promised, in one checkable board |
| 🧠 **Tiered intelligence** | Works with **no model at all** (heuristics + review queue), with Ollama, or any OpenAI-compatible endpoint (LM Studio, llama.cpp, vLLM, cloud — opt-in) |
| 🔍 **Hybrid retrieval** | Keyword (FTS5) + embeddings + graph centrality, fuzzy-tolerant |
| 🕸️ **Memory graph** | Obsidian-style: node labels, hover focus on neighbors, zoom & pan |
| 📋 **Tasks & timeline** | Per-project activity + git history + weekly digest |
| 🔎 **Global palette** | Search & copy memories from anywhere; quick-note hotkey |
| 🔐 **Encrypted sync (optional)** | E2E encrypted `.memsync` bundles across your devices — manual or shared folder (Dropbox/iCloud/Syncthing/network), no server, no embeddings/secrets/transcripts |
| 🔔 **Webhooks & notifications** | Opt-in alerts to Discord, Telegram, or generic JSON webhooks (digest, scan, approvals, pending drafts) |
| 🌐 **EN / ID interface** | English-first, Bahasa Indonesia one click away |
| 💾 **Backups & export** | Auto-backup (last 10), restore, export to Markdown / JSON / Obsidian vault |

## Requirements

| | Minimum | Notes |
|---|---|---|
| Windows | 10/11 | |
| Linux | .deb distros / AppImage | tray needs libappindicator |
| macOS | 12+ | Apple Silicon & Intel |
| Node.js | ≥ 22.5 | only when building from source |
| Ollama | **optional** | upgrade path for LLM-grade extraction & embeddings |
| RAM | 4 GB (8 GB recommended) | works CPU-only |

## Quickstart

### 1 · Install

| OS | Package |
|---|---|
| Windows | `Memoria Setup 0.8.0.exe` from [Releases](https://github.com/xinzzu/Memoria/releases) |
| Linux | `memoria_0.8.0_amd64.deb` (`sudo dpkg -i`) or `Memoria-0.8.0.AppImage` |
| macOS | `Memoria-0.8.0.dmg` (drag to Applications; right-click → Open if gated) |

Memoria lives in the tray and starts capturing automatically.

### 2 · First run — no model required

Out of the box, Memoria runs on **Tier 0 heuristics**: sessions are captured and turned into
memory candidates that land in the **Pending approval** inbox for you to curate. Search, tasks,
timeline, graph, handoff — everything works.

Want LLM-grade extraction and embeddings later?

```bash
ollama pull qwen2.5-coder:3b
ollama pull nomic-embed-text
```

Memoria detects them automatically (within ~5 minutes) and moves up a tier — nothing to
reconfigure, no data migrations. Prefer LM Studio / llama.cpp / a cloud endpoint instead?
Settings → **Engine**.

### 3 · Register your tools

Open the **Integrations** tab → one-click registration per tool, or via CLI:

```bash
node dist/engine/index.js integrate claude
```

Supported targets: `~/.claude.json`, `~/.codex/config.toml`, `~/.config/opencode/opencode.json`,
`~/.gemini/settings.json`, `~/.copilot/mcp-config.json`, `~/.gemini/config/mcp_config.json`.

Then start a new session and tell your agent:

```
Recall the decisions from previous sessions in this project.
```

### 4 · CLI

```bash
node dist/engine/index.js scan      # scan all tools now
node dist/engine/index.js recall "docker issue"
node dist/engine/index.js status
node dist/engine/index.js mcp       # MCP stdio mode

# encrypted sync (same user, multiple machines)
node dist/engine/index.js sync setup                         # create group + recovery code
node dist/engine/index.js sync status
node dist/engine/index.js sync export --out ./bundle.memsync
node dist/engine/index.js sync import --in ./bundle.memsync --embed
node dist/engine/index.js sync folder set /path/to/shared    # auto-sync via shared folder
node dist/engine/index.js sync folder status
node dist/engine/index.js sync conflicts
```

## The resume engine — limit-hopping

The core feature. You hit a usage limit mid-task and switch tools; the new tool should already
know what you were doing.

When transcript activity goes quiet (~4 minutes = session ended), Memoria runs the hot path:
**scan → extract the newest session first → inject**. Within ~5 minutes, every context
convention file in the project contains an idempotent, marked block:

```markdown
## SESSION RESUME
> claude · 14:32 · branch: feat/auth

**Open tasks:**
- [ ] finish the refresh-token endpoint in routes/api.ts

**Locked decisions (do not repeat):**
- JWT access tokens, 15 min — not sessions

**Dirty files (git):** src/auth/middleware.ts, src/auth/routes.ts

_Continue the work above — do not re-litigate locked decisions._
```

Injected into **AGENTS.md** (Codex/opencode), **CLAUDE.md** (Claude Code) and **GEMINI.md**
(Gemini CLI) — each target toggleable in Settings — plus a one-click **resume prompt** for
tools that don't read context files.

## Tiered intelligence

| Tier | Engine | Needs | Extraction | Embeddings |
|---|---|---|---|---|
| 2 | OpenAI-compatible | explicit opt-in + endpoint | ✓ LLM-grade | ✓ model-grade |
| 1 | Ollama | installed locally | ✓ LLM-grade | ✓ model-grade |
| 0 | **Heuristics** (default) | **nothing** | rule-based → review queue | local hash (256-dim) |

- `Auto` mode: Ollama when it's running **and** the model exists, otherwise heuristics.
  Never touches the cloud.
- Engine changes apply instantly — no restart.
- Embedding dialects are never mixed: search, dedupe and the graph never compare vectors
  across models.

## Encrypted sync (optional)

Sync the same memory library across your machines (same user) with end-to-end encrypted bundles:

- **Transport:** manual `.memsync` export/import or a shared folder watched by Memoria
  (Dropbox, iCloud Drive, Syncthing, network share).
- **Crypto:** 256-bit group key + recovery code, AES-256-GCM bundles (HKDF per file, AAD-bound
  header), idempotent apply with HLC/LWW and conflict/tombstone handling.
- **Never synced:** embeddings, secrets/API keys, settings, raw transcripts, or machine-local paths.
- **Setup:** `memoria sync setup` (create/join group) then export/import or `memoria sync folder set`.
- **Dashboard:** Settings → **Sync** shows group/device status, pending outbox, last
  export/import, shared-folder state/error, and recent conflicts (group setup, passphrase unlock,
  and manual bundle transfer remain CLI).

> Sync hardening (key rotation/revocation, rollback protection, performance pass) is planned (M5).

## Dashboard

Nine views, English or Bahasa Indonesia:

- **Overview** — greeting, pastel stat cards, 7-day activity chart, "Recently worked on",
  resume-ready projects, setup checklist
- **Memories** — full library: search, kind/project/topic filters, approval inbox, archive
- **Projects** — per-project activity, click through to timelines
- **Timeline** — session trail + git history
- **Handoff** — generate, copy, or inject the resume block
- **Tasks** — the AI-session promise board
- **Graph** — memory connections, Obsidian-style interactions
- **Integrations** — official logos, one-click MCP registration
- **Settings** — two-pane layout: data sources, engine tiers, behavior, data/backup,
  notifications, and sync

Global: `Ctrl/⌘ + Shift + M` quick note · `Ctrl/⌘ + Shift + Space` memory palette
(both rebindable in Settings).

## Privacy

- Capture, extraction, search — 100% local in `~/.memoria` by default.
- The OpenAI-compatible tier is the **only** way data leaves the machine, and it requires
  explicit opt-in with a visible privacy warning.
- API keys and webhook secrets are encrypted by the OS (Keychain on macOS / DPAPI on Windows)
  when available and never returned to the UI.
- Encrypted sync bundles are end-to-end encrypted and never include embeddings, secrets,
  settings, transcripts, or machine-local paths.
- Stale, low-importance memories are archived automatically (forgetting curve); backups keep
  the last 10 versions.

## Development

```bash
git clone https://github.com/xinzzu/Memoria && cd Memoria
npm install
npm run dev          # TypeScript watch mode
npm run build        # compile once
npm test             # build + node --test (41 tests)
npm run start        # Electron dev (engine on port 48210)
npm run check:ui     # audit UI selectors + structure
npm run dist         # Windows installer
npm run dist:linux   # AppImage + .deb
npm run dist:mac     # .dmg + .zip (macOS only)
```

> Tests run against `dist/` (not `src/`). For an isolated server, use
> `MEMORIA_DATA_DIR=$(mktemp -d)` and never touch the live `~/.memoria` DB or port `48210`.

### Project structure

```
src/
├── engine/
│   ├── config.ts              # per-OS data sources & tool config
│   ├── http.ts                # local API (127.0.0.1:48210) + static dashboard
│   ├── ingest/                # watcher + per-tool parsers (claude, codex, vscdb, …)
│   ├── extract/               # provider tiers, heuristics, ollama, openai-compat,
│   │                          # entities, topics, task lifecycle, dedupe
│   ├── retrieve/search.ts     # hybrid retrieval (FTS5 + embeddings + centrality)
│   ├── sync/                  # E2E encrypted sync (keys, bundles, export/apply,
│   │                          # shared-folder transport, CLI, embed backfill)
│   ├── mcp/server.ts          # MCP server (stdio)
│   ├── store/                 # SQLite (node:sqlite), migrations, backup, secure storage
│   ├── notify/webhook.ts      # opt-in Discord/Telegram/generic notifications
│   ├── handoff.ts             # resume engine + multi-file injection
│   └── index.ts               # CLI entry
├── electron/main.ts           # tray, dashboard, global hotkeys
web/                           # dashboard UI (vanilla JS, EN/ID i18n)
scripts/                       # icon generator, UI selector audit, search bench
docs/                          # design docs (e.g. sync-design.md)
tests/                         # node --test suites (run against dist/)
ROADMAP.md                     # execution plan & current position
CHANGELOG.md                   # release notes
```

### Tech

TypeScript · Node 24 (`node:sqlite`, FTS5) · Electron 37 · chokidar · MCP SDK · vanilla JS dashboard

## FAQ

**Does my data leave my computer?**
No. Capture, extraction and search all run locally in `~/.memoria`. The cloud tier exists but
only activates if you explicitly configure it.

**Can I sync between machines?**
Yes. Create/join a sync group (`memoria sync setup`), then export/import `.memsync` bundles
manually or point Memoria at a shared folder (Dropbox/iCloud/Syncthing/network share) via CLI
or Settings → Sync. Bundles are end-to-end encrypted and never include embeddings, secrets,
settings, transcripts, or machine-local paths.

**Do I need Ollama?**
No. Heuristics work with zero models — the review-queue inbox guides you from there. Ollama is
an upgrade path, detected automatically when you install it.

**Which tools are supported?**
Claude Code, Codex, opencode, Gemini CLI, Copilot, Antigravity — plus VS Code, Cursor and
Windsurf capture, and a generic `/api/import` endpoint for anything else.

**Will memories grow forever?**
No — stale, low-importance memories are archived automatically (forgetting curve); backups
keep the last 10 versions.

**Can Memoria notify me outside the dashboard?**
Yes, opt-in. Configure Discord, Telegram, or a generic JSON webhook in Settings → Notifications
for digest/scan/approval/draft events. Webhook secrets are stored encrypted when available.

**UI language?**
English by default; Bahasa Indonesia one click away in Settings.

## Documentation

- [ROADMAP.md](ROADMAP.md) — execution plan, phases and current position
- [CHANGELOG.md](CHANGELOG.md) — release notes
- [docs/sync-design.md](docs/sync-design.md) — encrypted sync design and status

## License

MIT © 2026 Memoria

---

_Made in Indonesia — so your AI agents never forget again._
