# Contributing to Memoria

Thanks for helping build the offline second brain for AI coding tools! This
document covers how the repo actually works — follow it and your PR will land
fast.

## Getting started

- **Node >= 22.5.0** (the engine uses the built-in `node:sqlite`)
- `npm install`
- `npm run build` — TypeScript → `dist/` (the engine runs from `dist/`)
- `npm test` — build + `node --test tests/` (tests run against **`dist/`**,
  not `src`)
- `npm run check:ui` — HTML structure + selector audit for `web/`

## Isolated dev server (never touch your real data)

```bash
HOME=$(mktemp -d) MEMORIA_DATA_DIR=$(mktemp -d) node dist/engine/index.js server
```

Port 48210. The fake `HOME` neutralizes the chokidar watcher (large AI-tool
session directories can hit EMFILE) and guarantees you can't corrupt a real
`~/.memoria`. `MEMORIA_DATA_DIR` is the official override.

## How this repo works

- **Branches**: `feat/…`, `fix/…`, `chore/…`, `docs/…` → pull request →
  **merge commit** (no fast-forward). Conventional commit subjects
  (`feat(scope): …`).
- **Ranking/retrieval changes must beat the eval numbers first**: run
  `npm run build && node scripts/eval-search.mjs` and compare hit@1 / hit@5 /
  MRR against the published numbers in `CHANGELOG.md` before and after.
- **UI strings**: English is the key passed through `t()`; Indonesian lives in
  the dictionary in `web/i18n.js`. **No emoji** in UI chrome. Engine-facing
  strings are English-only.
- **Release notes are English-only** — `CHANGELOG.md` entries land in the
  GitHub Release body.
- **Database migrations** are `PRAGMA user_version` steps in
  `src/engine/store/db.ts` — always atomic (transactional) and covered by
  `tests/migration.test.mjs`; raise the version expectations in tests when you
  add one.
- **Windows × macOS**: paths resolve per-OS in `config.ts`; never rely on
  symlinks for injection (marker-block duplication works identically on both).

## Add agent-chatter phrases for your language
Memoria drops agent chatter ("let me check…", "want me to…", "hope this
helps") before it becomes a memory. Those phrases live in one JSON file per
language in `src/engine/extract/noise-lang/` and are plain words, never
regular expressions, so you do not need to know the code to add a language.

1. Copy `en.json` to `<code>.json` (ISO 639-1, e.g. `es.json`, `hi.json`) and
   set `"language"` and `"name"`.
2. Translate the phrases. Rule ids stay the same:
   - `agent-narration` (`"at": "start"`): the agent describing its next step.
   - `offer-question` (`"at": "start"`): the agent offering to do more.
   - `generic-agent` (`"at": "anywhere"`): closing pleasantries.
   - `user-request` (`"at": "start"`): the user asking the agent to do something.

   Phrases are matched on whole words separated by spaces. Languages written
   without spaces (Japanese, Chinese, Thai) switch to character-based matching:
   add `"script": "cjk"` (Japanese, Chinese) or `"script": "thai"` to the file,
   optionally list polite leading fillers ("yes,", "well then,") under
   `"fillers"` — they are stripped before `"at": "start"` matching — keep
   `"at": "start"` phrases as short openers, and make `"at": "anywhere"`
   phrases at least 6 characters long (substring matching) so they cannot drop
   real statements.
3. That's it for registration: every `*.json` in `noise-lang/` is loaded
   automatically, so you don't touch `index.ts`.
4. Run `npm test` (`tests/noise-lang.test.mjs` checks every file) and
   `npm run eval:heuristic`.

Matching ignores case, apostrophes and commas, and works on whole words, so
`lets` covers "Let's" and "let’s". Keep phrases short and specific: a phrase
that also starts real decisions ("use", "we decided") would drop real memories.

## PR checklist

- [ ] `npm test` green (this runs the build too)
- [ ] `npm run check:ui` green (if you touched `web/`)
- [ ] Eval numbers compared and pasted in the PR (if you touched
      retrieval/ranking)
- [ ] `CHANGELOG.md` `[Unreleased]` entry added (English)
- [ ] DB migration added + tested, and test version expectations raised (if
      schema changed)
- [ ] Considered both OSes and legacy databases (if sync/ingest)

## Local testing notes

- Isolated servers: `MEMORIA_DATA_DIR=$(mktemp -d)` (+ fake `HOME`).
- Benchmark: `node scripts/bench-f1c.mjs 5000` (target < 100 ms).
- Retrieval eval: `node scripts/eval-search.mjs [topics] [noise]`.
- Context cost on your own data (read-only copy): `node scripts/audit-context.mjs [memory.db]`.
- The review/QA server must never run against your real `~/.memoria` with a
  real `HOME` — copy the DB to a temp dir instead.
