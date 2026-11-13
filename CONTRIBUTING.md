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
- The review/QA server must never run against your real `~/.memoria` with a
  real `HOME` — copy the DB to a temp dir instead.
