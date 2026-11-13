---
inclusion: always
---
# Product: Memoria

Memoria is an offline “second brain” for AI coding tools (Electron + Node/TS engine). North star: **limit-hopping continuity** — when a user hits a usage/context limit in one tool and switches to another, the new tool must already know the project context (zero re-explaining).

## Supported tools
Claude Code, Codex, Gemini CLI, opencode, Copilot, Antigravity, Cursor, Windsurf, VS Code (transcript watchers/parsers in `src/engine/ingest/`).

## Core principles
- **Local-first & private:** all data lives in `~/.memoria` (SQLite, WAL). HTTP/MCP serve localhost only; no telemetry/cloud dependency.
- **Capture never blocks:** heuristic extraction always works without any model. Ollama and OpenAI-compatible endpoints are optional upgrades (tiered intelligence).
- **Recall surfaces:** MCP server (`memoria recall/remember`), dashboard (Electron/`web/`), and handoff/resume blocks injected into `CLAUDE.md` / `AGENTS.md` / `GEMINI.md`.
- **Sync safety (critical):** never export or sync embeddings, secrets/API keys, settings, raw transcripts, or machine-local paths/offsets. Sync moves only stable, portable entities (projects/memories/tags/links) via encrypted `.memsync` bundles with LWW+tombstones; imported memories are queued for local embedding backfill.

## Product truth
- Treat `CHANGELOG.md`, `ROADMAP.md` ("POSI TERKINI"), and `git log` as the source of truth for status and conventions. Keep user-facing engine strings and `CHANGELOG.md` in English.
