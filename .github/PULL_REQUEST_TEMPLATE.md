## What

<!-- One paragraph: what changed. -->

## Why

<!-- The problem or the adoption-map item this addresses. -->

## Verification

- [ ] `npm test` green (runs the build + full suite against `dist/`)
- [ ] `npm run check:ui` green (if `web/` touched)
- [ ] Eval compared — baseline vs new numbers pasted (if retrieval/ranking touched)
- [ ] `CHANGELOG.md` `[Unreleased]` entry added (English)
- [ ] DB migration: atomic `user_version` step + tests raised (if schema changed)
- [ ] Considered both OSes + legacy databases (if sync/ingest touched)
- [ ] No secrets in logs, tests, or screenshots
