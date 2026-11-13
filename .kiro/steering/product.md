---
inclusion: always
---
# Product: Memoria

Memoria is an offline "second brain" for AI coding tools. North star: **limit-hopping continuity** — when a user hits a usage/context limit in one tool (Claude Code, Codex, Gemini CLI, opencode, Copilot, Antigravity, Cursor, Windsurf, VS Code) and switches to another, the new tool must already know the project context. Zero re-explaining.

## Principles
- Local-first and private: data lives in `~/.memoria` (SQLite). APIs bind to localhost only.
- Capture never blocks: heuristic extraction works without any model; Ollama / OpenAI-compatible providers are optional upgrades.
- Never export or sync embeddings, secrets, settings, or raw transcripts.
- Recall is delivered three ways: MCP server, dashboard, and handoff blocks injected into `CLAUDE.md` / `AGENTS.md` / `GEMINI.md`.
