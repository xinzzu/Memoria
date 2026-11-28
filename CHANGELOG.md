# Changelog
All notable changes to Memoria are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
## [Unreleased]
### Added
- Italian agent-chatter phrases (`noise-lang/it.json`) (#147, thanks @durgaprasad-mr).
- German agent-chatter phrases (`noise-lang/de.json`) (#142, thanks @daocuong11).
## [0.17.1] — 2026-11-25 — Contributors
A small release with the first contributions after v0.17.0, all from @daocuong11, plus a release history on the website.
### Added
- French agent-chatter phrases (`noise-lang/fr.json`) (#141, thanks @daocuong11).
- Vietnamese agent-chatter phrases (`noise-lang/vi.json`), so chatter from AI tools used in Vietnamese is no longer stored as memories (#136, thanks @daocuong11).
- `memoria --version` (also `-v` and `version`) prints the installed version (#133, thanks @daocuong11).
### Docs
- Code comments in `src/engine/git.ts` and `src/engine/ingest/watcher.ts` translated to English (#134, #140, thanks @daocuong11).
- The landing page has a release history at `/changelog/`, generated from this file (#126).

## [0.17.0] — 2026-11-24 — Quality
A quality release: no new integrations, measured changes only. Every item below came with
before/after numbers from a real library; the headline ones are in the README ("What it
measures"). Highlights: structured capture of todos, answered questions, verifier error→fix
and commits; turn reports; a lifecycle that keeps expired and stale memories out of context;
retention; capture health; `memoria doctor`; a lite MCP toolset. Without a model, only
structured evidence is served unasked, and rule-based sentences stay searchable drafts.
Schema v10 → v14 (a snapshot is taken first); sync stays compatible with v0.16 in both
directions.

### Docs
- README (EN/ID/HI) and the landing page describe what Tier 0 does and does not do, with
  measured numbers; the graph, webhooks and team brain are marked experimental.
- `PRIVACY.md`.

### Transcript roles repaired (migration v11)
- **Old Claude Code tool output no longer counts as something you said.** Before v0.12 every tool result (file reads, shell output, edit receipts) was stored with role `user`. Migration v11 re-labels those rows as `tool` or `system` from their text, in Claude sessions written by the old parser only. Checked against 8,068 rows whose original jsonl still exists: 96.9% of tool output leaves `user`, 96.9% of typed messages stay `user`, and rows labelled `user` went from 21% to 85% correct. The session's "last user request" in snapshots was right in 5 of 15 labelled sessions before and 13 of 14 after; 8 of 78 automatic task closures came only from tool output and no longer happen.
- **Snapshot before migrations.** When a schema migration is pending, the database is first copied to `backups/memory-pre-v<N>-<time>.db` with `VACUUM INTO`.

### Fixed (found in the v0.16.3 → v0.17.0 upgrade test)
- **Clearer dashboard on a fresh install.** Memories says "No memories yet" instead of "No matching memories" when nothing is filtered, and the archive has its own empty text. Timeline says "No projects yet" when there are none. Capture health shows "not installed, or never used on this computer" instead of a long temp path (the path stays in the tooltip). The Graph "Reset" button, project and topic filters, Graph empty text, Tasks title and engine label are now translated in both languages.
- **No crash when Ollama is not installed.** Starting Ollama on a machine without it threw an uncaught `spawn ollama ENOENT` in the Electron main process and showed an error dialog (reported by the AppImage catalog test). Memoria now looks for `ollama` on `PATH` first and handles spawn errors, so it just stays on the offline extractor.
- **Retrievals tab when empty:** no more row of zeros ("0 logged calls · 0 with no result · …") and no filter or clear button with nothing to filter. The tab now says what it is for, offers "Connect an AI tool", and says so when logging is paused.
- **Settings no longer breaks on open.** A refactor on 5 Nov removed `loadBackups()`, so opening Settings threw, and the backup list, sync status, device list and capture health never loaded.
- **No resume block in the home folder.** A session started in `~` made the home folder a "project", and resume blocks were written to `~/AGENTS.md`, `~/CLAUDE.md` and `~/GEMINI.md`. The home folder and filesystem roots are now never injected. `MEMORIA_NO_INJECT=1` turns injection off entirely, for tests and audits on a copy of a real database.
- **The resume block lists only reviewed tasks and decisions** under the default structured policy. It no longer falls back to unreviewed heuristic drafts or transcript lines.
- The dashboard's select chevrons loaded again (CSP now allows `data:` images).

### Structured-first promotion (Tier 0)
- **What Memoria hands agents unasked is now only structured evidence.** That covers memories from session events (todos, answered questions, verifier error→fix, commits), self-labelled lines (`TODO:`, `Keputusan:`), memories saved with `remember`, and drafts confirmed in two sessions. These feed the resume block, `project_context` and `build_context`. Other Tier 0 sentences stay drafts. Drafts with strong evidence no longer expire, and **`recall` still searches drafts**, ranked a little lower and marked "draft: not reviewed".
- Why: on a new blind sample from the current pipeline, sentences promoted by the evidence score were 42% precise. After refitting the score on a new tuning sample, no threshold or memory kind reached 70%. The structured set measured 95.6% (80.5% without todos). Recall on held-out targets is unchanged at 55% hit@5 (MRR 0.35 against 0.42).
- `tier0Promote = evidence` restores promotion by the evidence score.

### Commits close tasks; event memories are marked
- A `fix:` or `feat:` commit marks an open task done when most of the task's keywords (at least two) appear in the commit subject.
- `recall` labels memories built from a structured session event with "from event".

### Evidence score for Tier 0 triage
- **Triage decisions now come from an evidence score.** It is a logistic regression over 22 features (the Tier 0 score, kind, length, word count, letter ratio, question form, code spans, file paths, markdown, list form, reasons, first-person narration, decision and entity signals). It was fitted offline on 296 owner-labelled memories from a real library, with thresholds chosen on that set only.
- **Runtime signals adjust it within fixed bounds:**
  - each "not relevant" mark from the retrieval inspector lowers it (capped);
  - memories agents keep fetching get a little credit;
  - memories built from a structured session event get a little credit;
  - self-labelled lines ("TODO: …", "Keputusan: …") get credit.

  Noise rules still archive outright, and an explicit checklist item is never archived by the score alone.
- On held-out labels the model never saw:

  | Held-out sample | Active precision | Memories kept | Noise removed | Real memories active |
  |---|---|---|---|---|
  | Newer (500 items) | 37.5% → 46.4% | 74.5% → 76.4% | 80.4% → 81.8% | 15 → 32 of 55 |
  | Older | 40.7% → 41.9% | 91.3% → 87.0% (one item) | 70.1% → 70.9% | — |

  Recall on 50 queries whose target is a labelled real memory, after re-triage: hit@5 26% → 58%. On the 29 targets outside the training labels: 24% → 55%. Re-running the old triage gives 38% on the same 29.

### Doctor, checksums, privacy
- **`memoria doctor`** runs read-only checks and prints a fix for each warning; it exits with 1 when something failed. It covers folder permissions, database integrity, schema version, journal mode, disk use, backups, capture health, extraction backlog, Ollama models, MCP integrations, the local API token and sync conflicts.
- **SHA256 checksums.** Every GitHub Release now has `SHA256SUMS.txt` for its installers (`shasum -a 256 -c SHA256SUMS.txt`).
- **`PRIVACY.md`** describes what is read, where it is stored, what is redacted, and every opt-in way data can leave the machine. It ships in the npm package.

### Capture health
- **See whether each AI tool's sessions are reaching Memoria.** `memoria status`, `GET /api/capture-health` and a Settings card report every source as ok, behind, error, idle, missing or disabled. "Behind" means the tool kept writing more than a day after the last stored message: the parser stopped matching, or the app was not running. Only files a parser reads count as session activity: config files, IDE state databases and another tool's data in a shared folder (`~/.gemini` also holds Antigravity) do not. A tool with session files but nothing stored is "idle" with a hint to scan. On a copy of a real library: Claude Code, OpenCode, Gemini and Antigravity ok (Antigravity: 17,928 messages on the first scan of that copy), VS Code and Copilot idle (their chat files are empty), Codex, Cursor and Windsurf not installed.
- **One bad transcript file no longer stops a scan.** The Claude Code parser skips an unreadable file, counts it, and goes on; the count appears in the health report.

### Leaner context for agents
- **Lite toolset.** Set `MEMORIA_MCP_TOOLS=lite` in an MCP client's config (or the `mcpTools` setting) to expose only `recall`, `project_context` and `remember`: 348 tokens of tool definitions. The full set (default) went from about 1,520 to 1,011 tokens with shorter descriptions.
- **Default output caps on every context tool.** `recall` 4,000 characters, `project_context` 3,000, `build_context` 4,000, `file_context` 2,500, `get_memory` 8,000, `related` 3,000; `maxChars` still overrides where it exists, and truncation is stated in the output.
- **Resume block.** It shows the session title and the agent's last turn report instead of raw last messages. Older turn reports and lines already in the resume section are left out of the memory list, list lines are capped at 200 characters, and tool output no longer feeds the derived tasks. On a real library the block went from a median of 436 to 380 tokens (p90 760 → 583). Tool definitions plus resume block per session: 728 tokens in lite mode, 1,391 in full mode.

### Transcript retention and two more secret rules (migration v14)
- **`memoria maintain retention`** previews which raw transcripts could leave the database (older than `--days`, default 90). With `--apply` it moves them to a gzip JSONL archive in `<data dir>/archive/` (mode 0600), and reads the archive back before deleting anything. `--restore <file>` puts the rows back. `--apply --delete` deletes permanently instead. Rows not yet extracted and the latest session of each project are never touched; memories and session events stay. On a copy of a real library (14 days): 11,516 rows in 51 sessions became a 3.2 MB archive, the database went from 89.2 MB to 72.7 MB, and a restore brought back all 11,516 rows.
- **Labelled private keys are redacted.** A 32-byte hex value next to a label (`Private key: 0x…`, `process.env.PRIVATE_KEY || '0x…'`, `privateKeyToAccount("0x…")`) and 64-byte keypair arrays are now masked. Transaction hashes and public addresses are not. Migration v14 re-runs the redactor over stored data; on the same library it masked keys in 13 transcript rows. Plain entropy detection was measured and rejected: of 256 high-entropy tokens, nearly all were public Solana/EVM addresses, transaction signatures, CSS module names or base64 SVG.
- Session event payloads are redacted value by value, so they stay valid JSON.

### Memory lifecycle
- **Expired working memories are retired before anything is served.** Turn reports, todos, short approvals and still-failing tasks carry an expiry. Once it passes they are archived as one triage batch (`maintain triage --undo` restores them), and this runs before `recall`, `project_context`, `build_context` and handoffs, not only on the background schedule.
- **Stale memories are marked.** A memory that names project files, none of which exist any more, ranks lower and `recall` labels it "stale: the files it names are gone". It is not archived, because the file may have moved.
- On a copy of a real library (121 projects, top 10 of `project_context`): expired or stale memories served went from 16.9% to 1.7%.

### Tier 0 reads sessions turn by turn
- **One turn report instead of sentence fragments.** A turn is a user message plus everything the agent does until the next one. The agent's final message of a turn becomes one short-lived `working` memory (kind `context`, code and tables removed, about 600 characters, served for three days), plus up to 20 candidates from its sentences and lists.
- **Mid-turn narration and tool output are skipped.** From user messages, only stated rules ("jangan …", "always …"), checklists and lines that label themselves ("TODO: …", "Keputusan: …") are taken. Session-continuation summaries are read like a report.
- Measured by re-extracting 90 real sessions and matching against the owner's labels: on the held-out sample, memories kept 30.9% → 34.5% and noise removed 91.2% → 94.8%; on the older held-out sample 26.1% → 26.1% and 92.9% → 96.1%.
- Where the 946 labels came from: the agent's final message 32% worth keeping, continuation summaries 27%, mid-turn messages 15%, tool output 6%, user messages 3%. Sentence-level quality beyond this needs an LLM provider.

### Backfill for older sessions
- **`memoria maintain backfill-events`** re-reads Claude Code and OpenCode sessions stored before session events existed, then builds the todo, decision, error→fix and commit memories from them. It writes a backup first, skips transcripts that are already stored, and adds nothing on a second run. Older heuristic task memories that duplicate a captured todo are archived as one triage batch (`maintain triage --undo` reverts it). It runs only the two parsers, not a full scan, so it never writes resume blocks into project files.

### Error → fix from verifier runs, file edits and commits
- **Build and test runs are judged from their output.** Claude Code `Bash` and OpenCode `bash` calls to an allowlisted verifier (`npm run build`, `npx tsc`, `forge test`, `pytest`, `cargo test`, …) are stored as events with the command normalized and the first error line from the output; most real runs are piped, so the exit code alone says nothing. Edits (`Edit`/`Write`/`MultiEdit`, OpenCode `edit`/`write`) and `git commit` calls (message and sha) are stored too, with the branch.
- **`error_fixed` from evidence:** a verifier run that failed with an error line, then edits to code files, then the same verifier passing, becomes one memory naming the error and the files. Network/RPC errors, a missing script, non-compiler lines under `tsc`, and edits to agent or editor settings do not count. A verifier still failing after the session has been quiet for an hour becomes a short-lived task, closed when a later run passes.
- **Commits:** `fix:` commits become `error_fixed`, `feat:`/`perf:` commits become `task_done`, with the commit hash stored.
- On a real library: 50 verifier error→fix memories, all plausible on review, 40 with a specific error line; 8 fix and 14 feature commits; 6 still-failing tasks. Before, 26 heuristic `error_fixed` memories, about 8 of them real.

### Todos and answered questions from structured events
- **Agent todo lists become task memories with their real status.** Claude Code `TodoWrite` and `update_plan`, and OpenCode `todowrite` plus its `todo` table, are stored as session events; each item becomes one task memory (`task_pending` / `task_done`, cancelled items archived) that follows the agent's later updates. Before, the list was flattened into a checklist text row that sentence heuristics mostly discarded. On a real library: 548 todo items, 0.2% captured before, 100% after, all with the right status.
- **Answered questions become decisions.** Claude Code `AskUserQuestion` and OpenCode `question` answers turn into a `decision` ("question → answer"). A reply that asks back or was not given is skipped; a bare approval ("ok", "ya, jalanin") or a long free-text reply is kept as short-lived `working` context. On the same library: 104 questions, 87 durable decisions, 64% judged correct in a review by the maintainer's agent (not an independent label); 56 of the 58 real decisions are found, against 2 before.
- Session titles (Claude Code `ai-title` / `custom-title`, OpenCode session title) are recorded as events for the resume block.
- Todo memories are `working` with an expiry (open: 7 days, done: 3 days after the list). Serving rules for expired memories come with the lifecycle step.

### Session events and memory metadata (migration v13)
- **`session_events`**: a local table for structured events from agent sessions (todos, questions, titles, verifier runs, file edits, commits). Inserts are idempotent per source id, payloads are redacted, and the table is never synced. Parsers start writing to it in the next steps.
- **Optional memory columns**: `git_branch`, `git_commit`, `memory_class` (`working` / `durable`), `expires_at`, and a local `source_event_id`. All default to empty, so existing memories are unchanged.
- **Sync stays compatible both ways.** The new fields travel as optional payload fields: older versions ignore them, and a bundle from an older version no longer resets them. `scripts/compat-sync.mjs` checks this against a released package; against v0.16.3 all 8 checks pass in both directions.

### Retrieval inspector (migration v12)
- **See what your agents were given.** A new **Retrievals** tab lists the last 500 calls to `recall`, `project_context`, `build_context` and `file_context`: tool, project, query, and each returned memory with its rank and score. Calls that returned nothing are listed too.
- **"Not relevant" marks.** Each returned memory can be marked not relevant (and unmarked). Marks are stored with their query and survive clearing the log; they will feed the evidence score in a later release.
- Local only: the log is never synced, queries are redacted with the same secret rules as transcripts before they are stored, and logging can be paused from the tab (`retrievalLog` setting). On a real library it adds about 0.1 ms per call; 500 entries take about 120 KB.

### Tier 0 measured on real data
- **The synthetic eval was optimistic.** On a hand-labelled sample of 296 heuristic memories from a real library (mostly Indonesian, casual agent chat), current triage reached 40% active precision and removed 57% of noise; the synthetic set reports 100% / 100%. Rules were tuned on that sample and checked on a separate held-out sample of 150, labelled before the classifier ran.
- **Held-out result:** active precision 31% → 41%, noise removed 59% → 70%, memories kept 91% → 91%. Changes: more Indonesian agent-chatter phrases and a new `user-request` rule (raw user requests such as "tambahin … dong") in `noise-lang/id.json`; known harness lines in `en.json`; structural rules for answered-question echoes, tool receipts, `throw new …` and template-literal lines, object-property / f-string lines, and lead-ins that end in a colon. Listing line numbers (`12 - …`, `5: …`) are stripped and the rest judged on its own, so a documented decision in a file listing is no longer dropped.
- Raising the promotion threshold does not help (the heuristic score does not separate memory from chatter well on this data), so auto-promoted heuristic memories should still be treated as drafts of uneven quality; an LLM provider (Ollama or OpenAI-compatible) remains the way to get clean extraction.

### Context cost and recall scope
- **`scripts/audit-context.mjs`** measures what Memoria actually hands an agent, on a read-only copy of a database. On a real library (25 projects, 480 active memories): resume block median **455 tokens** (max 745), Claude Code SessionStart hook median 267, `project_context` index median 300, `build_context` median 490, `recall` hits median 165.
- **Scoped recall follows the git repository.** One repository often became several projects (`repo`, `repo/contracts`, `repo/services/api`), and scoped `recall`, `project_context`, `build_context` and `file_context` saw only the exact folder. They now include every project in the same git work tree; nested repositories and folders outside git keep the exact scope. In the audit, project-scoped recalls with no hit went from 17/32 to 10/32 (the rest have no matching memory at all).
- **The Claude Code hook no longer repeats CLAUDE.md.** It sends only the lines CLAUDE.md does not already contain, or a one-line pointer: on projects with a Memoria block, the duplicated part went from median 60 tokens (max 93) to 0.

### Tier 0
- **Language noise files:** agent-chatter rules (`agent-narration`, `offer-question`, `generic-agent`) moved from regexes in `noise.ts` to one phrase list per language in `src/engine/extract/noise-lang/` (`en.json`, `id.json`). Phrases are plain words matched on whole words with case, apostrophes and commas ignored, so a new language is a data-only pull request; `tests/noise-lang.test.mjs` validates every file and its registration. Checked against the old rules on 62,328 real candidate lines (read-only): one line differs, a UI fragment ("lets talk …") now also counted as chatter. The new matching is stricter about word boundaries, so "Let measure …" is no longer dropped, and it accepts curly apostrophes ("Let’s"). `npm run eval:heuristic` is unchanged.

### Sync
- **Devices in the dashboard:** Settings → Sync lists this device and every device whose bundles were applied here (last bundle, count, revoked state), with **Rotate key** and per-device **Revoke**. A confirmation dialog asks for the sync passphrase when the key is passphrase-protected, then shows the new recovery code once as a ready-to-copy `memoria sync setup --join … --force` command. `GET /api/sync/devices`, `POST /api/sync/rotate`, `POST /api/sync/revoke` (both require `confirm: true`).
- **Fix:** rotating or revoking no longer loses the new recovery code when the full re-export fails (for example on an empty database). The key change is reported with the export error instead of an error that hid the code; this also applied to `memoria sync rotate|revoke`.

### Learning journal
- **What this week's errors taught you**, built from `error_fixed` memories with no model: fixes are grouped by text similarity per project, a group is *recurring* when the same error was fixed in the 90 days before or more than once this week, and files mentioned in more than one distinct fix are listed as "files that keep breaking". Recurring fixes come first.
- Overview card right under the activity chart: fixed / keep-coming-back / new counts with a trend against the previous 7 days, recurring fixes with how often and where, new fixes as one-line rows, and every row opens the memory (keyboard too). Also appended to the weekly digest (and its webhook event carries `fixes` / `recurringFixes`), `GET /api/journal?days=&project=`, and `memoria journal [days]`.

## [0.16.3] — 2026-11-22 — Listings

**Housekeeping for MCP directories.** No change to the app or the MCP tools.

### CI
- The GitHub Release job now waits for the npm publish, so directories that rebuild on a GitHub release (Glama Auto-Release) install the new version.

### Docs
- `glama.json` declares the Glama maintainer.

## [0.16.2] — 2026-11-22 — Community

**Three outside contributors in one release: thank you @bhavana4123 (Hindi README), @StreamLine-18 (landing page at https://memoria.xinzzu.web.id) and @jamesyshd19-cmyk (CLI unknown-command fix).** Also: zero known advisories in production dependencies, MCP tool annotations, and automatic MCP Registry publishing from CI.

### CI
- Release tags now publish `server.json` to the official MCP Registry through GitHub OIDC after the npm package is live, so the registry listing follows every release without a manual login.


### Fixed
- Unknown CLI commands now print an error and usage and exit with code 1. The status output labels the memory count "Memories". Contributed by @jamesyshd19-cmyk (#88).

### Security
- `@modelcontextprotocol/sdk` 1.30 → 1.32.2 and its dependency tree refreshed: `npm audit --omit=dev` goes from 9 advisories (1 critical, 4 high, 4 moderate in `proxy-addr`, `zod`, `body-parser`, `fast-uri`, `qs`, `hono` and the SDK itself) to 0. Desktop builds pick up the fixed versions from the lockfile.

### MCP
- Every tool declares MCP annotations: the six read tools are `readOnlyHint`, `remember`/`update_memory`/`forget` are marked as writes that can replace or delete content, and none touch the network (`openWorldHint: false`). Clients can auto-approve reads and confirm writes.
- Tool descriptions say "return" instead of "fetch", since nothing is fetched from outside the local database.

### Docs
- mcprush listing badge in every README.
- Landing page in `site/` (plain HTML/CSS, no external scripts or tracking), contributed by @StreamLine-18 (#78). Served at https://memoria.xinzzu.web.id.
- READMEs: npm, MCP Registry and Glama badges; a ready-to-paste stdio config (`npx -y @xinzzu/memoria mcp`) for any MCP client; `memoria integrate` shown for npm installs; the MCP tool count corrected to 9.
- `site/` scaffold for the landing page: brief, brand tokens, shared-asset script and a stack-agnostic GitHub Pages workflow (off until enabled).
- Hindi README (`README.hi.md`), contributed by @bhavana4123 (#72).
- CI checks that every README status badge and `server.json` match the `package.json` version (`npm run check:versions`).

## [0.16.1] — 2026-11-19 — Clear Tools

**Every MCP tool parameter is described in English.**

### MCP
- Tool parameter descriptions are now all in English (some were in Indonesian), and `limit`, `importance` and `maxChars` gained descriptions, so agents in any language call the tools correctly.

## [0.16.0] — 2026-11-19 — Team Brain

**Share what your project has learned through git.** An opt-in `.memoria/brain.md` carries decisions, conventions and known fixes to teammates and is reviewed like any other file. Tier 0 triage gets stale-task cleanup, an inbox cap and "always archive" patterns, and Memoria is now listed for the official MCP Registry.

### Discoverability
- README hero: one-line `npx` start and a demo GIF (`docs/img/demo.gif`); social preview image in `docs/img/social-preview.png`.
- npm metadata: English description and broader keywords; `mcpName` plus `server.json` for the official MCP Registry (`io.github.xinzzu/memoria`, stdio via `memoria mcp`).

### Team project brain
- **`.memoria/brain.md`:** opt-in per project (project detail card or `memoria brain on|off <project>`). Current decisions, conventions, known fixes and open tasks are written to a markdown file in the repo, one line per memory with a `<!-- m:<uid> -->` marker; drafts and superseded decisions are left out and secrets are redacted again on export. Output order is stable so diffs stay small.
- **Import:** teammates' lines become memories with origin `team`; edits made in review update the matching memory, and lines removed from the file archive only team memories created by the import, never local ones. Runs in background housekeeping and via `memoria brain import`. `POST /api/projects/brain`.
- **Fix:** the per-process project id cache is cleared on `closeDb()`, so reopening another database no longer reuses ids from the previous one.

### Tier 0
- **Stale tasks:** open tasks older than `staleTaskDays` (default 30) that no later message mentions are archived daily as an undoable batch, so "Open tasks" in the resume block stays about current work (`archiveStaleTasks`, toggle `archiveStaleTasks`). Undo restores them as active.
- **Inbox cap per project** (`draftCapPerProject`, default 50): uncertain drafts beyond the cap are archived lowest score first.
- **"Always archive" patterns:** the inbox groups drafts that start with the same words; one click archives them and adds the text as a user noise pattern (plain substring, never a regex). Future candidates containing it are dropped at extraction. `GET/POST/DELETE /api/drafts/noise-patterns`.
- **Keyboard review** in Pending approval: `j`/`k` move, `a` approve, `x` archive, space select.
- **"Used" boost:** memories that agents fetched (`get_memory`, `file_context`, recall) rank slightly higher in project context.
- Undo restores each memory's previous status (it always restored `draft`).

## [0.15.0] — 2026-11-19 — Editors & Trust

**VS Code and Cursor captured out of the box, and sync you can revoke.** Copilot Chat sessions and Cursor Composer conversations are now read from where the editors actually store them, and Sync gains key rotation, device revocation, and a clock guard.

> Upgrade notes: VS Code and Cursor capture are now on by default; turn them off in Settings → Sources if you do not want them. After `memoria sync rotate` or `revoke`, run `memoria sync setup --join <new code> --force` on every device you keep.

### Sync M5 (hardening)
- `memoria sync rotate` replaces the group key (same storage: keychain or passphrase) and republishes a full export to the shared folder. `memoria sync revoke <device-id-prefix>` marks a device as revoked and rotates. `memoria sync devices` lists devices with their last bundle. Kept devices re-join with `sync setup --join <new code> --force`.
- Bundles written with a previous group key or by a revoked device are skipped before decryption instead of being reported as folder errors; re-joining records the old group so its leftovers are skipped too.
- Bundles or operations dated more than 24 hours in the future are refused (a wrong or hostile clock could otherwise win every last-writer-wins conflict and push every device's clock forward).
- The passphrase-unwrapped key is cached per process: scrypt runs once instead of on every folder scan.
- Superseded decisions sync: the memory payload carries `supersededByUid` and `validTo`; links whose newer decision arrives later in the same bundle are resolved after all memories are applied.

### Capture
- **VS Code (Copilot Chat) and Cursor are captured by default.** New parser `ingest/vscode-chat.ts`: VS Code `workspaceStorage/<hash>/chatSessions/*.jsonl` operation logs are replayed the way VS Code does (initial / set / push / delete entries; edited requests truncate), legacy `.json` sessions are read, thinking parts are skipped, and tool invocations become tool rows. Cursor Composer conversations are read from `globalStorage/state.vscdb` (`cursorDiskKV`, inline `conversation` or `bubbleId:` entries). The project comes from each workspace's `workspace.json`. The generic ItemTable scan stays as a fallback.

## [0.14.0] — 2026-11-19 — Connected Everywhere

**Setup in a minute, every tool connected, beyond coding.** A first-run assistant, native Claude Code hooks, Antigravity conversations, ChatGPT/Claude history import, and a two-way Obsidian vault — plus secrets encrypted and the local API token-protected in CLI/npm mode.

> Upgrade notes: browser users of `memoria server` open the printed sign-in link once (`memoria token` prints it again). Scripts calling the local API need the `x-memoria-token` header. Existing Cursor / VS Code HTTP MCP entries get the header automatically.

### Beyond coding tools
- **Import ChatGPT and Claude history** (`import/chats.ts`): the `.zip` (or `conversations.json`) from ChatGPT or Claude data export. ChatGPT's conversation tree is followed from `current_node`, so regenerated branches and system prompts are skipped. Each conversation becomes a session (tools `chatgpt` / `claude-ai`) that Tier 0 extracts and triages like any other. Re-importing adds nothing. Dashboard: Settings → Backup & transfer; CLI: `memoria import <file>`; API: `POST /api/import/chats` (raw upload, up to 1 GB, streamed to a temp file). Dependency-free zip reader (`import/zip.ts`).
- **Obsidian vault, two-way** (`export/obsidian.ts`): memories live as Markdown notes with a stable `memoria_id` in frontmatter, one folder per project. Edit a note in Obsidian → the memory is updated (body, `kind`, `importance`); delete a note → the memory is archived; write a new note → a new memory, with its id written back. Changes in Memoria rewrite the note. `.memoria-sync.json` tracks the last synced state; when both sides changed, the note wins and the conflict is counted. Syncs every 5 minutes once Settings → Obsidian vault is set, or `memoria obsidian sync <dir>`. Notes from the old one-way export are replaced instead of duplicated. Frontmatter keys are now English.

### Claude Code hooks
- **Native Claude Code hooks** (`hooks/claude.ts`), installed when Claude Code is connected (Integrations, onboarding) or with `memoria hooks install` (`remove`, `status`):
  - `SessionStart` (sync, 10 s timeout): prints the project's resume context, which Claude Code adds to the new session — no waiting for the file watcher or an AGENTS.md refresh.
  - `Stop` (async): imports the session transcript right away.
  - `PreCompact` (async): import + deterministic work snapshot + resume block before the context is compacted.
  - `SessionEnd` (async): import + extraction + AGENTS.md/CLAUDE.md refresh.
  Merged into `~/.claude/settings.json` without touching other hooks; idempotent; a settings file that cannot be parsed is never modified. Only transcripts under `~/.claude/projects` are read. Engine logs go to stderr so SessionStart stdout is only the context; the hook always exits 0. Setting `claudeHooks` = `0` turns them into no-ops.
- SQLite `busy_timeout` (5 s): the app, MCP stdio servers, and hooks share the database.
- `scanClaude` accepts a single transcript file.

### Onboarding
- **First-run setup assistant** (`onboarding.ts`, dashboard): detects which AI tools have sessions on this machine, connects the selected ones (capture + MCP registration), imports past sessions in the background (newest first, Tier 0 offline, then auto-triage), and ends with "Here is what Memoria remembers" for the most recent projects. Shown once on installs without memories; Settings → Run setup again. API: `GET /api/onboarding`, `POST /api/onboarding/start`, `GET /api/onboarding/summary`, `POST /api/onboarding/skip`.

### Fixed
- Claude Code integration registered `node mcp` without the engine script path, so Claude Code could not start Memoria's MCP server.
- Task lifecycle closed fresh tasks: a done-word anywhere in the session ("fixed" about another bug) marked every task whose keywords appeared anywhere as done. A task now closes only when one message part mentions most of its keywords and says it is finished, or checks its checkbox.
- Engine label and settings text still said heuristics send results to a review queue.

### Capture
- **Antigravity conversations are captured** (`ingest/antigravity-brain.ts`): `~/.gemini/antigravity*/brain/<id>/…/transcript_full.jsonl` (IDE, CLI, agent). Previously only IDE log files were read and the brain transcripts were picked up by the generic Gemini scanner as user-only rows with no project. User requests are unwrapped from `<USER_REQUEST>`, planner responses are assistant rows, tool steps are tool rows, SYSTEM steps are skipped, and the project is inferred from the first absolute path (nearest folder with `.git`/`package.json`). On one real machine: 45 conversations, 17,103 rows.
- **Agent todo lists become tasks**: Claude Code `TodoWrite` and OpenCode `todowrite` are stored as `- [ ]` / `- [x]` checklists, which Tier 0 turns into task memories.
- **Tool output separated in every parser**: OpenCode bash calls (were appended to assistant text as `[command] …`), Gemini/generic `tool`/`function` rows, Cursor/VS Code/Windsurf tool-only messages and tool calls; OpenCode synthetic text parts are skipped.

### Fixed
- Copilot used `seq = 0, 1, …` per scan, so new messages collided with stored ones and were dropped; it now uses the per-session allocator.
- Noise rule for sentences split inside markdown links (`docs/X.md](file:///…)`).

### Tests
- `tests/ingest.test.mjs`: fixtures for Claude, Codex, OpenCode, Copilot, Gemini/generic, Cursor/VS Code (vscdb), and Antigravity: roles, tag stripping, checklists, unique seq, no duplicates on re-scan.

### Security
- **Local API token on by default** (`auth.ts`): random token in `<dataDir>/api-token` (0600). `/api/*` and `/mcp` require the `x-memoria-token` header or the `memoria_token` cookie (HttpOnly, SameSite=Strict); static dashboard files stay public so the dashboard can explain how to sign in. Electron sets the cookie automatically; `memoria server` prints a one-time sign-in link; new `memoria token` command. Existing Cursor / VS Code HTTP MCP entries get the token header added on startup. Toggle: Settings → Require API token (`apiTokenRequired`).
- **Secrets encrypted in CLI / npm mode** (`store/secretkey.ts`): AES-256-GCM (`kc1:`) with a master key in the macOS Keychain, Linux Secret Service, or Windows DPAPI (owner-only file fallback); the key is passed via stdin, never argv. Plaintext secrets from older versions are encrypted on startup. Sync can now be set up from the CLI without a passphrase.
- **Owner-only data files**: the data folder is 0700 and its files 0600 (was 0755 / 0644, readable by other accounts).

### Added
- `MEMORIA_HTTP_PORT` to run a second instance on another port.

## [0.13.2] — 2026-11-18 — Intel Macs

### Added
- macOS Intel (x64) installers next to Apple Silicon (arm64): `Memoria-<version>-x64.dmg` / `.zip`.

### Changed
- Installer file names are predictable: `Memoria-Setup-<version>.exe` (was `Memoria Setup <version>.exe`, which GitHub renamed to `Memoria.Setup.<version>.exe`) and `Memoria-<version>-<arch>.dmg`. The README install table links to the latest release instead of hard-coding a version.

## [0.13.1] — 2026-11-18 — First CI-published npm release

Same code as 0.13.0. This is the first release published to npm from GitHub Actions via trusted publishing (0.13.0 was published manually to create the package), and the first release with installers since 0.12.0. All changes are listed under 0.13.0 below.

### Changed
- Release pipeline: `@xinzzu/memoria` is now published from CI on every `v*` tag, with npm provenance.

## [0.13.0] — 2026-11-18 — Zero-Approval Tier 0

**Tier 0 without manual approval.** Heuristic drafts are now triaged
automatically (noise/duplicates → archive, strong or corroborated signals →
active), plus a capture data-loss fix, secret redaction, progressive context
disclosure for agents, and capture exclusions.

### Fixed
- **CRITICAL — capture was still losing messages**: `seqAllocator` (the
  0.11.0 fix) returned `n++` on a local copy, so every message of a session in
  one scan pass got the same seq and `INSERT OR IGNORE` dropped all but the
  first. On one real database, 13 of 35 Claude sessions were stored with no
  messages at all. Migration **v9** resets claude/codex/opencode/vscdb source
  offsets so the next scan re-reads them; `insertTranscript` skips messages
  that already exist (same session + timestamp + content), so the re-read does
  not duplicate data.
- **Encrypted secrets could not be read**: `decryptSecret` only base64-decoded
  the value without calling `safeStorage.decryptString`, so OpenAI-compatible
  API keys and webhook URLs/tokens came back as ciphertext bytes in the
  Electron app.
- **Tool output was stored as user speech**: Claude Code `tool_result` entries
  (typed `user` in the jsonl) are now stored with role `tool`, `isMeta`
  messages as `system`, and IDE/CLI injected tags (`<system-reminder>`,
  `<ide_opened_file>`, `<command-*>`) are stripped. Previously shell output
  even received the +0.08 "user message" bonus in heuristic extraction.
- The MCP server reports the version from `package.json` (was `0.1.0`).

### Added
- **Tier 0 auto-triage** (`extract/triage.ts`): every heuristic draft is
  decided as active / archive / keep with a recorded reason. Runs at startup
  and daily (`autoTriage`, on by default); drafts that stay uncertain are
  archived after `draftTtlDays` (default 14). Every change is logged per batch
  in `triage_log` and can be undone. On a real database: 4,153 drafts → 3,
  with about 400 promoted.
- **Noise filter** (`extract/noise.ts`): a rule table for tool echoes, shell
  output (`ls`/`ps`/`grep -n`), build logs, bare code/paths/URLs, and agent
  narration or offers. Applied before the per-window candidate quota fills up.
- **Triage score** (`triageCandidate`): explicit decisions and tasks get the
  strong-signal bonus, descriptive sentences that merely contain words like
  "use"/"later" do not; questions and context-dependent fragments are
  penalised. `archive` candidates are not stored at all. The per-session
  promotion cap scales with session length (was a fixed 8).
- **Corroboration**: a draft that appears again in another session or tool is
  promoted automatically.
- **Secret redaction** (`privacy/redact.ts`) in `insertTranscript`,
  `insertMemory`, and `updateMemory`: OpenAI/Anthropic/GitHub/GitLab/AWS/
  Google/Slack/Stripe/Hugging Face/npm tokens, Discord/Slack webhooks,
  Telegram bot tokens, JWTs, PEM private keys, connection-string passwords,
  bearer tokens, `SECRET_NAME=value` assignments, and `<private>…</private>`
  blocks. Migration **v8** redacts existing data.
- **Progressive disclosure in MCP**: `project_context` defaults to mode
  `index` (one line per memory with its id; short memories and the project
  brief stay whole), new tool `get_memory(ids)` returns full text, and
  `recall` accepts `mode: "index"`. `recall` results now include ids.
- **Local context metrics** (`retrieve/usage.ts`): every context delivery
  (recall, project_context, build_context, get_memory, resume block) is
  recorded in `continuity_events`; `/api/continuity` returns `usage7d`.
- **`file_context` MCP tool** (`retrieve/filecontext.ts`, `GET /api/file-context`):
  active memories that mention a file path, matched on trailing path segments
  (`src/engine/http.ts` matches `/abs/repo/src/engine/http.ts`, not
  `myhttp.tsx`). Generic names (`page.tsx`, `index.ts`) need two segments or a
  project scope. Ordered by specificity, then fixed errors, decisions, tasks.
- **Superseded decisions** (`extract/supersede.ts`, migration **v10**): when
  a new active decision shares a subject (tech word, package, path, command)
  with an older decision in the same project and overlaps in the "same topic,
  different content" band, the old one gets `superseded_by` + `valid_to`. It
  stays searchable (flagged and ranked lower in `recall`) but leaves the
  resume block, `project_context`, and `build_context`. Dashboard shows a
  *Superseded* badge with *Still current* to undo (`POST /api/decisions/restore`).
  Deliberately conservative: on one real database it flagged 0 of 144
  decisions.
- **Capture exclusions**: Settings → "Never capture these projects"
  (`captureExclude`). One entry per line: a folder path (prefix, including
  subfolders, `~` supported) or a project name/slug. Transcripts from matching
  projects are never stored. Applies to new captures.
- Dashboard: **Auto-triage** button (preview counts and reasons before
  applying), **Undo last triage**, draft inbox grouped by project × kind with
  *Approve all* / *Archive all*, triage/redaction status line, Settings toggle,
  and an Overview card for context delivered and tokens saved by the index.
- API: `GET/POST /api/triage`, `POST /api/triage/undo`,
  `GET /api/drafts/groups`, `GET /api/privacy`.
- CLI: `maintain triage [--apply|--undo]`, `memoria help`; `bin` entry and
  shebang for `npx`/global install (headless mode = `memoria server`).
- **npm package `@xinzzu/memoria`** for headless/CLI use (`npx @xinzzu/memoria@latest server`); published from CI on every `v*` tag via npm trusted publishing. The Electron app keeps its runtime name `memoria` (`build.extraMetadata`), so data folders and Keychain entries do not change.
- Labelled evaluation set + `npm run eval:heuristic` (active precision,
  memories kept, noise removed), enforced in the test suite.

### Changed
- `maintain heuristic-promote` now runs the full auto-triage.
- The local server rejects foreign `Origin` headers for every method (was
  non-GET only); the API token is compared in constant time.
- `project_context` returns a compact index by default; pass `mode: "full"`
  for the previous output.

## [0.12.0] — 2026-11-16 — Heuristic Continuity

Heuristic/no-AI mode is now strong enough for instant limit-hopping continuity without a model: richer signal extraction, deterministic resume fallbacks, and upgrade paths for legacy data and embeddings.

### Added
- **Heuristic/no-AI maximization (limit-hopping without a model)** — heuristic extraction is richer (sentences, lists/checkbox TODOs, code/command/path/error signals, ID/EN decision/error-fix/preference patterns) and scores each memory by confidence/signal. Strong heuristic signals (tasks, decisions, error-fixes, entity-backed facts) are now auto-promoted to `active` with `origin: "heuristic"` (capped per session) so recall/resume and cross-tool linking work instantly during limit-hopping; weaker results stay in the draft/review queue.
- **Deterministic resume/handoff fallbacks** — `collectResumeData`/handoff now fall back to heuristic drafts, the latest deterministic work snapshot, and recent transcript signals when structured memories are sparse, so tool switches still get open tasks/locked decisions/snapshot context without an LLM.
- **Deterministic snapshots active** — session/pre-limit work snapshots are stored as active `origin: "heuristic"` continuity memories.
- **Legacy data & embedding upgrade path** — `promoteLegacyHeuristicDrafts()` (run once at startup and via CLI) promotes eligible legacy heuristic drafts; `maintain heuristic-promote|reembed|consolidate|all` CLI backfills old data and re-embeds memories to the current embedding dialect for offline→cloud/model upgrades.
- **Tests** — `tests/heuristic-mode.test.mjs` covers heuristic extraction/promotion, snapshot activation, draft dedupe/linking, deterministic resume fallback, and heuristic task lifecycle.

### Changed
- **Heuristic dedupe/task lifecycle** — dedupe/link candidates include heuristic drafts (merge/link without surfacing to recall), and task lifecycle can resolve heuristic draft `task_pending` items.
- **Windsurf capture enabled by default** — Windsurf vscdb source is now enabled out of the box (still subject to per-install source settings) to improve cross-tool coverage.

## [0.11.0] — 2026-11-15 — Hardened & Measured
**Full re-audit (two parallel tracks: engine + web/API)** found 3 critical
bugs, including **real data loss** in the capture path. All important
high/medium findings are fixed in this release.
### Fixed
- **CRITICAL — scanners lost data from live sessions**: all five scanners
  restarted `seq` at 0 on every scan, while `transcripts` has
  UNIQUE(tool, session_id, seq) + INSERT OR IGNORE, so every new message in a
  growing session was silently dropped after the first scan. Now
  `seqAllocator(tool)` reads MAX(seq) per session and increments in memory
  (5 scanners, no `seq++` left).
- **CRITICAL — auto-link targeted the wrong row**: `addMemoryWithDedupe`
  read `last_insert_rowid()` AFTER `insertMemory` had inserted entities and
  the sync outbox, so the id pointed at the outbox and auto-linking either
  muted the graph or created false relations. `insertMemory` now returns the id.
- **HIGH**: the daily backup copied the live WAL database (torn or stale), now
  `VACUUM INTO`; `scanAll` had no reentrancy guard (watcher + hot path +
  /api/scan could overlap), now latched; `isGenericMemory` deleted real
  memories (one fence or bullet inside multi-line content dropped the whole
  memory), now two pattern classes + a ≥50% dominance rule;
  `continuity_events` had no retention, now pruned after 90 days + index
  (kind, ts); project briefs are identified by `source_tool='brief'` (not a
  content prefix); deleting a memory also cleans its tags/entities (parity
  with the sync path).
- **HIGH (web)**: kind/project filters WITHOUT a query rendered an empty list
  (/api/search now runs without q); the `since` pipeline leaked into
  total/hasMore/list/search (endless Load more, and old search results hid
  new ones); duplicate `pdTasks` id (the task list was injected into a header
  button); CSP disabled the app's own Retry button and logo fallback (now
  addEventListener); the batch bar leaked into other tabs.
- **MEDIUM**: 500 responses no longer leak stack traces or paths;
  `numParam()` on every numeric boundary (NaN no longer reaches node:sqlite);
  readBody capped at 10 MB + close/error listeners; SSE checks
  writableEnded/destroyed + a response error handler; 8 heavy endpoints guarded
  in-flight (409); purge/clean-noise in one transaction; the vector index
  follows the data version counter (semantic recall no longer goes stale after
  updates); topics diff before writing (no more daily outbox churn) + k-means
  downsample to 2000; continuity pairing is one-to-one; access_count in one
  batched UPDATE; single-pass highlight (a 'mark' query no longer breaks its
  own markup); seq guard for every async renderer + the palette; per-view
  loaders moved to setView (no more empty Graph/Integrations pages); purge
  probe inside try.

## [0.10.0] — 2026-11-14 — The Bridge

**One URL for every AI tool.** The engine now serves MCP over HTTP, Integrations
covers the full official MCP client map (12 targets), and the dashboard became
honest: heuristic drafts are visible where they were invisible, the activity
chart shows what your brain actually did, and the version chip never lies.

### Added
- **MCP over HTTP — the AI-to-AI bridge** — the engine serves MCP at
  `http://127.0.0.1:48210/mcp` (streamable transport, stateless, JSON responses)
  on the same port as the dashboard, behind the same host/origin/token guards as
  the rest of the API. Any AI tool — Claude Code, Codex, Gemini, opencode, or an
  agent on the LAN (with the optional `apiToken`) — points at one URL instead of
  per-tool stdio wiring. Live-verified: initialize handshake, tools/list (7
  tools), and a real `recall` call over HTTP; stdio stays fully compatible.
- **12 MCP integrations — the integration map is complete** — Integrations now
  registers Memoria into **Claude Desktop** (claude_desktop_config.json, per-OS),
  **Cursor** (~/.cursor/mcp.json via the HTTP bridge), **Windsurf**
  (~/.codeium/windsurf/mcp_config.json), **VS Code / Copilot** (~/.vscode/mcp.json,
  official `"type": "http"`), **Cline** (globalStorage cline_mcp_settings.json),
  and **Zed** (settings.json `context_servers`) — paths per the official MCP
  clients docs. All writers MERGE JSON: existing user configs are preserved.
- **Project detail shows pending drafts** — heuristic mode parks extraction
  results as drafts, which made healthy projects read as "0 memories / No
  memories yet". The view now shows "Heuristic results are parked as drafts — N
  waiting for this project" with a **Review drafts** button that jumps to the
  draft tab pre-filtered by that project.
- **Memories age filter + search-term highlighting** — an "All time / 7 / 30 /
  90 days" select (server-side `since` on the paginated path via
  `listMemoriesPage`, client-side elsewhere) and search terms highlighted with
  `<mark>` inside memory content (escape-safe).
- **MCP `recall` budget + project scope** — optional `project` (scope to one
  project) and `maxChars` (truncate the context block so agents never blow
  their context window).
- **Purge per project** — `POST /api/memories/purge {slug, confirm:true}`
  bulk-deletes one project's memories (sync tombstones included); the project
  detail UI exposes it behind a double confirmation.
- **Community standards complete** — CODE_OF_CONDUCT (Contributor Covenant 2.1),
  CONTRIBUTING (repo-specific workflow: dist tests, eval-first ranking, i18n
  conventions, migration policy), SECURITY.md (private advisory reporting),
  bug/feature issue forms with a secrets-redaction attestation, and a PR
  template. Repo health: 100%.

### Fixed
- **Memories list stability** — three fixes for rows "disappearing" while
  reviewing: late fetch responses no longer overwrite the newest render
  (latest-wins seq guard), identical renders skip the innerHTML rebuild and
  scroll position is preserved, and SSE refresh no longer rebuilds the list
  while on the draft tab (counts still update live).
- **Draft noise filter + one-click cleanup** — tool status lines ("has been
  updated successfully"), shields.io badge markdown, and formatting debris were
  captured as "facts" (the 4.8k-draft pileup). New `GENERIC_PATTERNS` filter
  them per-line on both extraction paths, and a **Clean noise drafts** button +
  `POST /api/drafts/clean-noise` clears stored noise explicitly (208 removed on
  the dev machine's real data).
- **Dynamic version chip** — the sidebar version was hardcoded ("v0.7.1") and
  stale on every release; `/api/stats` now reports the engine version.
- **Overview activity chart shows what your brain actually did** — window
  widened to 14 days and a second series counts memory creations per day
  (active + draft), so heuristic-mode work is visible; tooltip and legend
  updated.
- **Graph labels in dense clusters** — greedy anti-overlap (degree-priority
  slots): colliding labels dim instead of piling into unreadable stacks.
- **i18n consistency** — the quick-note window and global palette had raw
  Indonesian/English mixed strings bypassing `t()`; all wrapped, dictionary
  completed (EN and ID modes each fully consistent).

## [0.9.0] — 2026-11-14 — Two-way & Measured

**Memory now flows both ways** (import your Obsidian vault / memory bank),
the pre-limit trigger can buzz your phone (the `notifyLimit` webhook), and
every ranking change must now beat the eval numbers first — the RRF
experiment lost and was recorded, not shipped blindly.

### Added
- **notifyLimit webhook toggle** — the F4 pre-limit moment can now ping
  Discord/Telegram/generic: "AI limit hit, resume brain is ready — switch tools
  whenever you're ready" (opt-in toggle in Settings → Notifications, event
  payload carries project slug + snapshot status).
- **Obsidian two-way — import side (PR-G)** — `POST /api/import/markdown
  {folder, project?}` + UI (Backup & data → Import Markdown): a folder of
  .md notes (Obsidian vault, Cline memory bank, plain notes) is imported as
  memories — first heading becomes the title line, 2 levels deep, ≤500 files,
  tiny files skipped, embeddings computed locally. Idempotent by design:
  re-importing the same folder merges via dedupe instead of duplicating.
  Completes the two-way story with the existing Obsidian export.

### Fixed
- **Overview "Recently worked on" no longer lists zero-activity projects** —
  recentProjects() now requires at least one transcript (audit finding);
  **graph labels hide when off-screen** and clamp inside the canvas instead of
  clipping raw at the edges.

### Changed
- **RRF ranking: evaluated and rejected** — reciprocal-rank fusion of the
  keyword and semantic lists was measured against the tuned score blend with
  the eval harness (PRNG seed 42): blend won hit@1 (77.5% vs 67.9%), hit@5
  (100% vs 99.6%) and MRR (0.855 vs 0.790) at 240 queries; RRF won only
  hit@1/MRR at the 600-query scale. Kept the blend; experiment documented so
  nobody re-proposes it without beating both scales.

## [0.8.0] — 2026-11-14 — Encrypted Sync & Zero-AI Brain

**The brain that follows you, free forever**: end-to-end encrypted sync
between machines (M1–M4), agents that curate their own memory, zero-AI
session snapshots that arrive *before* your limit runs out, and retrieval
quality that is now measured in the open (hit@5 92.8–100% on a reproducible
eval).

### Added
- **Eval harness lite (PR-D)** — `scripts/eval-search.mjs`: a reproducible
  LongEval-lite benchmark (deterministic PRNG seed 42, N topics × paraphrase +
  typo queries, generic noise memories as distractors) that scores
  `searchMemories` with hit@1 / hit@5 / MRR and average latency. Current
  zero-LLM numbers (hash embeddings + FTS5 trigram, no model at all):
  **hit@1 77.5% · hit@5 100% · MRR 0.855** at 240 queries / 520 memories;
  **hit@5 92.8%** at 600 queries / ~1300 memories; ~14 ms per query. Run:
  `npm run build && node scripts/eval-search.mjs [topics] [noise]`. Any
  future ranking change (e.g. RRF fusion) must beat these numbers first.
- **Smart remember (PR-C, mem0-style ADD/UPDATE/NOOP — zero-LLM)** —
  `addMemoryWithDedupe` now grows memories instead of only stacking them: new
  content that is LONGER and overlaps ≥55% tokens with a near-duplicate
  replaces the old content (with its fresh embedding + dialect, sync metadata
  and FTS5 following via `updateMemory`). Two-tier thresholds keep it safe:
  full merge at 0.85 (hash) / 0.92 (model) / 0.85 (text), selective UPDATE
  down to 0.6 (embedding) / 0.75 (text) only when the new text is clearly an
  extension of the same fact; otherwise the old NOOP + importance-bump and
  plain insert paths are unchanged. The MCP `remember` tool now reports what
  actually happened ("Memory updated (replaced content of #N)" / "Memory
  saved" / "Merged into existing memory #N").
- **Consolidation (PR-B)** — `extract/consolidate.ts`: a daily, model-free pass
  that clusters near-duplicate memories (same project, same kind, cosine
  ≥ 0.85 on locally computed hash embeddings — briefs excluded, newest 400
  per run) and merges each cluster into its best member: longest content
  survives, importance takes the maximum, tags are unioned, the rest are
  deleted with sync tombstones. Runs in `dailyMaintenance` (toggle
  `autoConsolidate`, default on, also in Settings → Behavior) and on demand
  via `POST /api/consolidate`. This is the zero-LLM answer to runaway curation
  inboxes (mcp-memory-service consolidation / mem0 "Dream", offline edition).
- **Temporal memory, provenance & project brief (migrasi v6)** — memories gain
  `valid_from`/`valid_to` (Graphiti-style validity windows; archiving closes a
  fact's validity, unarchiving reopens it) and `source_session` provenance —
  every memory and F4 snapshot now traces back to its source conversation, and
  the extraction pipeline stamps the session it came from. **Project brief**
  (Letta core-memory / Cline memory-bank style): an auto-maintained, max-one
  per-project summary memory (`Project brief: …` — decisions, open tasks,
  preferences, key facts, ≤1400 chars, regenerated daily and on demand) that
  ALWAYS sits first in `project_context` and recall outputs. New MCP tool
  **`build_context`** assembles one ready-to-paste context block (brief + key
  memories + optional query matches + 1-hop relation traversal, capped to
  `maxChars`), and `recall` now appends 1-hop related memories from its top
  hits. New `GET /api/continuity` + `POST /api/projects/brief` endpoints; F4
  emits `limit_hit`/`resume_ready` into a `continuity_events` ledger
  (`continuityStats()` aggregates 30-day counts + average limit→resume gap).
- **Zero-AI session brain (F4)** — `extract/snapshot.ts` adds two model-free
  mechanisms. (1) **Work snapshots**: at scan time the last 16 transcript lines
  of a project are mined deterministically (files touched, shell commands run,
  errors, last user message) and combined with the project's git branch/dirty
  files into one `context` memory (origin `heuristic`, max one per 15 minutes,
  dedupe-merged) — so recall/handoff in the next tool knows exactly what was
  being worked on. (2) **Pre-limit trigger**: provider kill-messages
  ("usage limit reached", "credit balance too low", "quota exceeded", …) are
  detected in new transcripts via a cursor over `transcripts` — patterns are
  deliberately strict so dev discussions *about* limits never fire it. On
  detection the engine captures a snapshot, runs priority extraction and
  injects resume context IMMEDIATELY (before the idle trigger fires), and
  emits a `limit_hit` event (SSE today, webhook-ready). This is the
  limit-hopping north star: switch tools the moment your quota dies and the
  next AI already has the continuation brain.
- **MCP self-editing tools** — the MCP server now exposes `update_memory`
  (correct content/kind/importance; a content change is auto re-embedded so
  semantic search stays accurate) and `forget` (delete a stale memory by id,
  or by query — a confident match is deleted immediately, otherwise
  candidates are listed for an explicit id). `updateMemory` gains optional
  embedding/embed-model patch support so edits never leave stale vectors
  behind; FTS5 stays in sync via its UPDATE trigger. Agents can now curate
  their own second brain, not only append to it.
- **Encrypted sync UX (M4)** — Settings now includes a **Sync** tab showing
  group/device status, pending outbox, last export/import, embed queue, shared
  folder path/state/error, and recent conflict log (last-writer-wins). Folder
  sync can be configured or disabled from the dashboard (CLI required for group
  setup/passphrase-locked keys and manual bundle export/import). New localhost
  endpoints `GET /api/sync/status`, `GET /api/sync/conflicts`, and
  `POST /api/sync/folder` expose sync status, bounded conflict history, and
  folder configuration. README documents encrypted sync CLI and privacy scope
  (EN/ID). Full EN/ID i18n for sync UI strings.

- **Encrypted sync shared-folder transport (M3)** — database migration v5 adds
  the `sync_applied_bundle` ledger (with backfill from legacy `sync_applied`)
  to track applied bundle IDs across manual and folder imports. New folder sync
  layer (`src/engine/sync/folder.ts`) supports configuring a writable shared
  folder (Dropbox/iCloud/Syncthing/network share), folder status, atomic
  debounced delta export of `<device>-<stamp>.memsync` bundles, and watcher-
  driven scan/apply of peer bundles with idempotent ledger checks and per-file
  decrypt/AAD/parse error tolerance. CLI adds `memoria sync folder set|status`
  and `memoria sync conflicts`; folder watcher runs in engine background jobs.
  Cleanup removes this device’s own bundles older than 14 days. Never syncs
  embeddings, secrets, settings, transcripts, or machine-local paths. Two-device
  integration tests cover convergence (create/delete tombstone), concurrent LWW
  conflict handling, idempotent re-apply, folder guards, and CLI (41 tests
  total).

- **Encrypted sync manual bundles (M2)** — database migration v4 adds
  per-entity LWW clocks, tombstones, conflict log, seen-op ledger, embedding
  backfill queue, and project slug aliases. New `memoria sync setup|status|export|import`
  CLI creates/joins a sync group (generated recovery code or join), stores the
  256-bit group key encrypted via OS keychain (`safeStorage`) or a
  passphrase-protected scrypt wrapper, and writes/reads encrypted `.memsync`
  bundles (AES-256-GCM, per-file HKDF key, gzip JSONL). Export supports
  `--full` relay snapshots built from current device state; import is
  idempotent, validates and canonicalizes operations, applies LWW with
  tombstones, records bounded conflicts, maps projects by UID/alias/slug without
  syncing local paths, never syncs embeddings/secrets/settings/transcripts, and
  queues local embedding backfill for imported memories. Test suite now covers
  crypto recovery/passphrase, bundle tamper/wrong-key/duplicate-op rejection,
  roundtrip, relay, delta/idempotency, LWW conflict, tombstone resurrection
  prevention, project slug aliasing, and CLI (38 tests total).

- **Encrypted sync foundation (M1)** — database migration v3 adds stable UUID
  `uid` columns plus `updated_by` to `projects` and `memories`, backfills every
  existing row, and creates `sync_devices`, `sync_outbox`, `sync_applied`, and
  `sync_state`. All project/memory/tag/link mutations now emit outbox
  upsert/delete operations with hybrid logical clocks (`wall.counter.device`);
  deletes produce tombstones and memory deletes also tombstone their links. The
  migration enqueues an initial snapshot of existing projects, memories, and
  links for peer bootstrap. Embeddings, entities, and FTS remain device-local
  and are never queued. Test suite now covers v2→v3 backfill, outbox capture,
  tombstones, HLC monotonicity/clock observation, and replay suppression
  (31 tests total).

### Changed
- **Database migrations are atomic** — each `PRAGMA user_version` step now runs
  inside a transaction, so a failed migration rolls back instead of leaving a
  partially upgraded schema or duplicated outbox snapshots.
- **Memory mutations bump `updated_at`/`updated_by` consistently** — approvals,
  task resolution, archive/unarchive, content edits, and tag changes now update
  sync metadata, not just content edits.

## [0.7.1] — 2026-11-13

### Added
- **Batch embeddings for OpenAI-compatible providers (F1B leftover)** —
  `openaiEmbedMany` sends up to 64 texts per `/embeddings` request, maps results
  via `index` (server response order is not assumed), automatically chunks
  larger batches, and returns `null` per failed item without blocking other
  batches. `embedManyVia` now uses this batch path (previously one request per
  text). New tests: single batch + index order, chunks over 64, partial
  response, provider wiring, and no-op without a base URL.

### Changed
- **CI release**: the workflow now runs verification (`npm test` + `check:ui`)
  before building installers; `v*` tags must match the `package.json` version;
  the GitHub Release body is taken from the matching CHANGELOG section
  (fallback: git log between tags). Verification also runs on PRs and pushes to
  `main`, and the build matrix uses `fail-fast: false` so one OS failure does
  not cancel the others.
- **Library pagination moved to SQL** — `GET /api/memories` and
  `GET /api/memories/list` now use SQLite `LIMIT`/`OFFSET` directly
  (`listMemoriesPage` in `store/db.ts`) instead of materializing the entire
  table through `allMemories()`/`listDraft()`/`listArchived()` and slicing in
  JS. Totals are still computed with count queries and the response shape is
  unchanged. New tests assert page order, totals, and limits match the old
  implementation for all three tabs (active/draft/archived).

### Fixed
- **`canonicalPath` test failed on Linux**: it hardcoded `/private/tmp` (macOS
  symlink behavior). It now compares against `fs.realpathSync("/tmp")`, so it
  passes on macOS, Linux, and Windows.

## [0.7.0] — 2026-11-11 — Phase 3: Webhook & Notifications

**Memoria can now reach you outside the dashboard** — send notifications to
Discord, Telegram, or any JSON endpoint when the weekly digest is generated,
a scan finishes, a memory is approved, or drafts are waiting for review.
Fully opt-in, secrets encrypted, delivery failures never disturb the engine.

### Added
- **Webhook & notifications (F3)** — Discord, Telegram, and generic JSON
  webhooks (`src/engine/notify/webhook.ts`): the module is an extra listener
  on the internal event bus; delivery failures never disturb the caller.
  Four opt-in events (default off): weekly digest, scan finished (with
  new-transcript/memory counts), memory approved (batch approvals send one
  summary), and drafts waiting (daily check, at most once per 24 hours,
  configurable threshold). English message bodies. New **Notifications**
  Settings tab: per-event toggles, platform configuration, and a per-platform
  **Send test** button (`POST /api/notify/test`). Secrets (Discord/generic
  webhook URLs, Telegram token) are stored encrypted via safeStorage when
  available — same as the API key.
- Scan events now carry `newTranscripts` & `newMemories` (the previously
  discarded `extractQueue()` return is now captured) — scan notification
  payloads contain real summaries; older SSE clients stay compatible.

### Fixed
- **Static Settings toggles never persisted / never loaded**: `saveSettings()`
  and `loadSettingsToggles()` were called in `web/app.js` but never defined —
  every toggle in Behavior/Data neither persisted nor showed its saved state
  on page load. Both are now implemented (POST `{key, value}` + load from
  GET `/api/settings`).

## [0.6.0] — 2026-11-11 — Phase 1C: Retrieval & Scale

**Large libraries stay fast** — keyword search moved to an FTS5 index,
embedding vectors are stored as Float32 BLOBs, and every dashboard list is
paginated. Acceptance: 5,000 memories → search < 100 ms.

### Added
- **FTS5 keyword search** (F1C 5.1): keyword candidates are now chosen by an
  FTS5 index (`memories_fts`, external-content + INSERT/DELETE/UPDATE
  triggers, trigram tokenizer → substring semantics matching `includes()`),
  reranked with the existing `keywordScore` over a maximum of 200 candidates —
  the final blend formula is unchanged. Queries that find nothing in FTS
  automatically fall back to a full scan, so fuzzy typo recall (editDistance)
  stays exactly as before. New indexes: `memories(archived, status)` &
  `transcripts(extracted, ts)`.
- **Versioned schema migrations** (`PRAGMA user_version`) in `store/db.ts` —
  first time this exists; the old `PRAGMA table_info`-based migration is kept.
- **Structural guard in the UI audit** (`scripts/audit-ui.js`, via
  `npm run check:ui`): beyond selector checks, HTML structure is now
  validated — all elements must be closed and global elements (`#overlay`,
  `#toast-wrap`) must be direct `<body>` children. Prevents the modal bug
  below from silently recurring.
- `MEMORIA_DATA_DIR` env override in `config.ts` — run the server/bench on a
  throwaway DB without touching `~/.memoria` (same pattern as
  `MEMORIA_OLLAMA_URL`).

### Changed
- **Embeddings stored as Float32 BLOBs** (F1C 5.2, automatic v2 migration on
  first run): ~50% smaller than JSON TEXT and no more per-row `JSON.parse` of
  vectors on any read path (`readMemories`, `vecfind`). On-disk: raw
  little-endian float32; legacy JSON rows are converted.
- **Dedupe candidates via SQL** (F1C 5.4): no more full `allMemories()` scan —
  candidates come straight from the DB (project/dialect/active, newest 500).
  Similarity & merge behavior unchanged.
- **Full dashboard pagination** (F1C): `/api/memories/list` (draft/archive)
  and `/api/memories/tag` now accept `limit`/`offset` and respond in the same
  shape as `/api/memories` (`total`/`hasMore`); every Memories tab uses the
  "Load more" pattern, with offsets advancing per raw page so client-side
  filters never skip pages.
- **Event delegation for memory row actions**: per-button listeners re-bound
  on every render are replaced by one delegated listener pair per container
  (WeakSet-guarded) — list re-renders are O(1), not O(n).
- `.mem` cards use `content-visibility: auto` + `contain-intrinsic-size` —
  off-viewport cards skip rendering (cheap windowing for long lists;
  replaces fragile JS virtualization with variable row heights).

### Perf
- F1C acceptance met (`scripts/bench-f1c.mjs`, 5,000 synthetic memories):
  median search **11.3 ms** for common words, **5.4 ms** rare words,
  **58.0 ms** substring — all < 100 ms.

### Fixed
- **Add/Edit memory modal didn't appear outside the Settings tab**:
  `web/index.html` was missing 4 closing `</div>` tags at the end of the
  Settings block, so `#overlay` (and `#toast-wrap`) became children of the
  hidden `#view-settings`. Clicking Edit on Graph/Memories seemed dead, then
  the modal suddenly appeared when Settings opened. Modal & toast now live on
  `<body>` and work on every tab.

## [0.2.0] — 2026-11-04 — Phase 1B: Tiered Intelligence (Ollama optional)

**Users without Ollama/API keys get memories from the very first minute** —
and existing Ollama users notice no change.

### Added
- **A `MemoryProvider` layer with 3 engine tiers** (`extract/provider.ts`):
  - **Tier 0 Heuristic** (new, default fallback): rule-based extraction
    (ID/EN sentence classification — decisions, tasks, error-fixes,
    preferences, entity-rich facts) + 256-dim TF-IDF hashing embeddings
    (FNV-1a + bigrams) so dedupe & the similarity graph work without any
    model. Heuristic results **always enter the review queue (draft)** with an
    origin badge — a curation inbox, not hidden noise.
  - **Tier 1 Ollama**: previous behavior, unchanged.
  - **Tier 2 OpenAI-compatible** (new, explicit opt-in): one protocol for
    LM Studio / llama.cpp / vLLM / OpenRouter / cloud via the `openaiBaseUrl`
    + `openaiApiKey` + model settings. New "Intelligence engine" settings card
    with a privacy warning (cloud = content leaves the machine).
- **Engine selection**: `extractEngine` / `embedEngine` settings
  (auto/ollama/openai/heuristic|hash). `auto` mode = Ollama when it's up,
  otherwise heuristic/hash — and it **never** silently picks the cloud tier.
  Changes apply instantly, no restart.
- **Circuit breaker**: 3 consecutive provider failures = a 60-second rest —
  a half-dead Ollama no longer hangs `remember`/MCP for up to 60 seconds.
- **`origin` & `embed_model` on every memory** + a dialect guard across all
  cosine paths (search, dedupe, per-dialect LSH index): vectors from different
  models can never be cross-compared. Embedding-less dedupe now uses token
  Jaccard (previously: insert without any check → duplicates piled up).
- The topbar chip now shows the **engine actually in use** (e.g. "🧠
  Heuristic") — not just Ollama status.

### Fixed
- **Silent Ollama model auto-pull removed** — it could download gigabytes
  without consent; now it only warns and falls back to another tier.
- Search before approval: drafts intentionally don't appear in search (by
  design) — no behavior change; noted to avoid misunderstanding while testing.

## Fase 1A — Resume Engine (limit-hopping)

_Part of the [0.2.0] release above: F0, F1A, and F1B shipped together as one
0.2.0 version — not three separate releases all named 0.2.0._

The core feature for the **limit-hopping** scenario: switch AI tools mid-task
without re-explaining context. Branch: `feat/f1a-resume-engine`.

### Added
- **A "⏸️ SESSION CONTINUATION" block** now sits at the TOP of every handoff
  (and every file injection). Composed from 4 cheap, LLM-free signals: the
  latest transcript session (tool + time + closing message), unfinished
  pending tasks, recent decisions ("locked — don't repeat"), and **`git
  status`** (active branch + files currently changing — new data via
  `runGitStatus`).
- **A ready-to-paste continuation prompt** — `GET /api/resume?slug=` plus a
  new "Copy continuation prompt" button on the Handoff tab. Plan B that
  always works when the target tool doesn't read injected files.
- **Multi-file injection**: the context block is now injected into
  `AGENTS.md` (Codex/opencode), `CLAUDE.md` (Claude Code), and `GEMINI.md`
  (Gemini CLI) — no longer AGENTS.md only, which left Claude/Gemini never
  reading the context. Marker-block duplication (not symlinks) so it's safe
  on Windows. Each target can be disabled in Settings → "Context injection
  (resume)".
- **Hot-path resume**: when transcript activity goes quiet for ≥ 4 minutes
  (the "session ended" heuristic), Memoria immediately runs scan → extraction
  with **newest-session priority** → context injection. Target: resume
  context ready ≤ 5 minutes after the last message — no longer waiting for
  the next batch queue. Background extraction continues for the old backlog.

### Fixed
- **Project identity merge failed for dashboard/quick-note saves**:
  `/api/remember` and `/api/import` slugified before `ensureProject`, so the
  project path was never forwarded — dashboard memories landed in a project
  separate from Claude/Codex sessions in the same directory, and resume blocks
  lost their tasks/decisions. Raw paths are now forwarded (a `looksLikePath`
  guard prevents plain names from resolving into fake paths).
- **`/api/resume`, `GET|POST /api/handoff`, `/api/handoff/remove` demanded an
  exact slug** — path/name input is now resolved via `resolveProject()`
  (now shared in `store/db.ts`, used by MCP + HTTP).
- **`/api/remember` replied 500 even though the memory saved**: `node:sqlite`
  returns null-prototype objects and `Number(row)` over them throws a
  TypeError — users saw "Save failed" for memories that actually saved.
  Caught by the F1A smoke test; now returns `{"ok":true}` and duplicates are
  merged by dedupe. The 500 stack is also logged.
- Context files freshly created by injection no longer start with two blank
  lines.

### Changed
- The hot-path resume idle threshold is now configurable via the
  `resumeIdleMinutes` setting (default 4 minutes, minimum 1) — applies
  without restart.
- `ollamaUrl` can be overridden via the `MEMORIA_OLLAMA_URL` env (isolated
  testing & non-standard endpoints).

## Phase 0 — Foundation

The first part of the execution plan in `ROADMAP.md`. Branch:
`feat/f0-foundation`.

### Security
- **The HTTP API now only accepts connections from this machine.** Previously
  the server bound to all interfaces with CORS `*` and no authentication —
  other devices on the LAN could read/delete memories, and any website in the
  browser could inject content into a project's `AGENTS.md`
  (`POST /api/handoff`). Now: explicit `127.0.0.1` bind, `Host` header
  validation (anti DNS-rebinding), non-local `Origin` rejected for
  data-changing requests, CORS echoes only local origins, plus an optional
  token via the `apiToken` setting (`x-memoria-token` header).

### Fixed
- **The dashboard memory library showed only 8 items.** `GET /api/memories`
  ignored the `status` param and always truncated to the 8 newest. The
  `status` param (active/draft/archived) is now honored, `limit`/`offset`
  pagination is available (the response adds `total`/`hasMore`), and the UI
  has a "Load more" button plus a visible error message when a fetch fails.
- **MCP recall never used the semantic score.** Agent queries weren't
  embedded, leaving 30% of the score weight dead. The MCP `recall` (and CLI,
  HTTP, `related`) now passes the query embedding explicitly; the global
  cache that raced across requests was removed.
- **One physical project could be recorded as several projects.** Each tool
  reports `cwd` in a different format and `ensureProject` matched by exact
  slug only. Projects are now merged via canonical path (resolve + realpath,
  lowercased on Windows), old paths are backfilled, and a memo prevents
  repeated syscalls during bulk scans.
- **MCP `project_context`/`remember` demanded an exact slug.** Paths with
  slightly different separators/case/trailing slashes returned "No memories
  yet". Now resolved in stages: slug → slugified path → canonical path →
  LIKE on name/slug.
- **Memory deletion without confirmation** — a confirm dialog now exists.
- **Multiline memories were impossible** — Enter in the modal saved
  immediately. Now Ctrl/Cmd+Enter saves, Enter inserts a newline (hint
  added).
- **`stats().lastScan` always showed "now"** — it now records when a scan
  actually finished.
- Failed global-shortcut registration is now reported (console + OS
  notification); previously swallowed by a `try/catch` that never ran because
  `globalShortcut.register` returns `false` rather than throwing.

### Changed
- **Dashboard/palette/quick are now served by the HTTP engine** (same-origin)
  — the port is no longer hardcoded in 3 JS files + 3 CSPs; changing the port
  in config no longer breaks the UI. CSP tightened to `connect-src 'self'`.
- **Auto-start on login is now optional** (`autoStartLogin` setting, default
  on) — previously forced on every launch; on macOS it now starts hidden
  (`openAsHidden`).
- **Global shortcuts are configurable** from Settings → Global shortcut
  (`shortcutQuick`/`shortcutPalette`); shortcuts for disabled features are no
  longer consumed; tray menu labels follow the configuration (⌘ on macOS).
- The `PECUT_SHOT` debug screenshot harness was removed from
  `electron/main.ts`.
- Windows-specific placeholders in the memory form were replaced with neutral
  hints.

## [0.1.0] — 2026-10

Initial beta release: 9-tool capture, local Ollama extraction, MCP server,
hybrid retrieval, Electron dashboard, etc. See `README.md`.
