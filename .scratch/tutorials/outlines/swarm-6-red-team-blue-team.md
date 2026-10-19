# Outline: Swarm 6, Red Team / Blue Team: notes app

Prototype outline for [Tutorial outline: Swarm 6, Red Team / Blue Team](https://github.com/seanrobertwright/Quay-2/issues/21).
Accepted by the maintainer on 2026-10-19, with the decisions at the end folded in. Not the tutorial: the page is written after the fix-first work.

Slug `red-team-blue-team`. Page `docs/tutorials/swarm/red-team-blue-team/index.md`. Starter `examples/tutorials/red-team-blue-team/starter/`, check suite `examples/tutorials/red-team-blue-team/check/`.

The Red/Blue Team preset (id `red-blue-team`) does not exist in code yet; it is added with the fix-first work from the presets decision. This outline describes the app after that fix.

## The page, top to bottom

**Title:** Swarm 6: Red Team / Blue Team: notes app

**Pitch:** Two Claude Code agents play attacker and defender on a small notes app you own. `red-team` finds the holes and pins each one with a failing test; `blue-team` patches the server until every test passes. Two rounds, then Quay's Pre-PR Audit Gate catches the one thing neither agent was looking for, before the code could leave your machine.

**Tiles:** Time and Tokens are generated from test runs. Agents: 2 × Claude. Level: Intermediate.

**You'll learn:** the Red/Blue Team preset, giving two agents opposed goals and separate folders so they can't undo each other, reading a test run as a scoreboard, and the Pre-PR Audit Gate (`Ctrl+B A`): what it scans, what it doesn't, and fixing a blocker with one click.

**Before you start** (all on the shared Before-you-start page, linked):

- Quay 2 installed.
- Claude Code 2.1.296 or later, signed in.
- The `event-bridge` plugin installed (the pane status badges this tutorial reads come from it).
- Node 24 or later, Git, PowerShell 7.
- The starter project, because the agents run in Skip mode and edit files without asking.

Note for the page: the three holes are textbook and the app is the learner's own, in-process, on their machine. Every "exploit" in this tutorial is a Vitest assertion; nothing is sent anywhere.

## The starter project

A notes app with a fixed two-user login, a JSON API and two HTML pages, built so that each hole sits one line away from a correct example of the same thing.

```text
starter/
  package.json          npm, exact versions, "type": "module", "engines": { "node": ">=24" }
  package-lock.json
  tsconfig.json         strict, erasableSyntaxOnly, module nodenext, lib ES2024, types node
  .gitignore            node_modules/, data/*.db; on purpose, no .env line
  .env.example          NOTES_DB=data/notes.db, the one setting the server reads; step 1 copies it to .env
  README.md             the goal in a paragraph
  AGENTS.md             goal, the rules of the app, commands, folder ownership (see below)
  CLAUDE.md             @AGENTS.md
  server/app.ts         export function createApp(dbPath: string): Hono
                        login, cookie middleware, the API routes and the two HTML pages; all three holes live here
  server/db.ts          export function openDb(dbPath: string): DatabaseSync (node:sqlite)
                        schema users(id, name) and notes(id, user_id, title, body, shared, created_at); seeds alice and bob
  server/pages.ts       layout(title, inner) and noteCard(note): HTML built by string concatenation, no escaping helper
  server/index.ts       createApp(process.env.NOTES_DB ?? "data/notes.db"), serve() on port 3000,
                        prints "Listening on http://localhost:3000"; npm start loads .env with --env-file
  test/notes.test.ts    the visible tests, in-process via app.request() against createApp(":memory:")
  test/exploits/.gitkeep
                        empty: red-team's folder
  data/.gitkeep
```

**Login.** `GET /login/alice` or `GET /login/bob` sets a `user` cookie and redirects to `/`. Every other route reads that cookie and answers 401 without it. Nothing more: no passwords, no sessions table, so the one missing check is easy to spot.

**Seed.** Four notes: alice has `Groceries` (1) and `Ideas` (2); bob has `Bob's secret` (3, body `the safe code is 4242`, not shared) and `Team lunch` (4, shared).

**Routes.**

| Route | Does | State |
| --- | --- | --- |
| `GET /api/notes` | your notes, newest first | correct, parameterised |
| `POST /api/notes` with `{ title, body, shared? }` | 201, the created note | correct, parameterised |
| `GET /api/notes/search?q=` | your notes whose title contains `q` | **hole 1** |
| `DELETE /api/notes/:id` | 204, or 404 when the note isn't yours | **hole 3** |
| `GET /` | HTML: your notes plus every shared note | **hole 2** |
| `GET /notes/:id` | HTML: one note, 404 when it isn't yours or shared | correct ownership check; same unescaped rendering as `/` |

**Scripts.**

| Script | Runs | Who uses it |
| --- | --- | --- |
| `npm test` | `vitest run --dir test` | both agents, and the learner in step 1 |
| `npm run typecheck` | `tsc --noEmit` | both agents |
| `npm start` | `node --env-file=.env server/index.ts` | nobody in this tutorial; it's there so the app is a real app, and so `.env` has a reason to exist |
| `npm run check` | `vitest run --dir check` | the learner, step 9, after unzipping the check suite |

**Dependencies:** `hono`, `@hono/node-server`; dev: `vitest`, `typescript`, `@types/node`. Storage is `node:sqlite`, cookies are `hono/cookie`, so nothing native and nothing to escape HTML with until Blue writes it.

**The three holes.** Each is the vulnerable line next to a correct one.

| | Hole | Where | Symptom | What the check suite asserts |
| --- | --- | --- | --- | --- |
| 1 | SQL injection | `search` builds its query with a template literal: `` `... WHERE user_id = ${userId} AND title LIKE '%${q}%'` ``; the route above it uses `prepare(...).all(userId)` | as alice, `q=%' OR '1'='1` returns bob's `Bob's secret`; `q=O'Brien` is a 500 | the payload returns none of bob's notes and a 200; a title containing an apostrophe can be created and found |
| 2 | Stored XSS | `noteCard` in `server/pages.ts` concatenates `note.title` and `note.body` straight into the HTML | bob posts a shared note with body `<script>window.pwned = 1</script>`; alice's `GET /` contains that tag verbatim | alice's `GET /` contains `&lt;script&gt;` and not `<script>window`; a body `Fish & chips` renders as `Fish &amp; chips` on `/` and on `/notes/:id` |
| 3 | Missing ownership check | `DELETE` runs `DELETE FROM notes WHERE id = ?` with no `AND user_id = ?`; the `GET /notes/:id` handler two routes up has the check | as alice, `DELETE /api/notes/3` returns 204 and bob's secret is gone | alice's delete of note 3 returns 404 and bob still lists it; alice's delete of bob's shared note 4 also returns 404 |

**The visible tests (`test/notes.test.ts`).** Eight tests, all green on the starter, none touching a hole.

1. `GET /api/notes` without a cookie returns 401.
2. `GET /login/alice` sets the `user` cookie and redirects to `/`.
3. `POST /api/notes` as alice returns 201 with an `id`.
4. `GET /api/notes` as alice lists only alice's notes, newest first.
5. `GET /api/notes/search?q=Groc` as alice finds `Groceries`.
6. `DELETE /api/notes/1` as alice returns 204 and the note is gone from `GET /api/notes`.
7. `GET /` as alice contains `Groceries` and bob's shared `Team lunch`, not `Bob's secret`.
8. `GET /notes/3` as alice returns 404.

Test 5 uses no quote character and test 7 reads only titles, so neither notices the holes.

**The check suite (`check/holes.test.ts`).** Six tests, two per hole, as in the table above. Zipped separately as `red-team-blue-team-check.zip`, unzipped into the project in step 9 so it sits at `check/` beside `server/`. The pairs are chosen so that a blacklist is not a pass: stripping quotes breaks the apostrophe test, stripping `<script>` breaks the `&lt;script&gt;` test, and checking `shared` instead of ownership breaks the note 4 test.

**CI expected state:** `npm ci`, `npx tsc --noEmit` and `npm test` pass (8 tests); `npm run check` against the starter plus the unzipped check suite is red (6 of 6 failing); the zip holds `.env.example` and no `.env`, and `.gitignore` has no `.env` line. The starters CI job carries a per-starter expected state, as Swarm 3 and Swarm 4 already need, and here the red run is the proof that the holes are in place.

**`AGENTS.md`**, in full-ish:

- Goal: a notes app for two users. The rules of the app:
  1. A user sees their own notes and every note marked shared, and nothing else, through every route.
  2. Only a note's owner can delete it. A note you can't delete is a 404, not a 403.
  3. A note's title and body are shown exactly as typed, as text. They never run and never change the page around them.
  4. Search matches titles of your own notes only, and any text is a valid search.
- Commands: `npm test`, `npm run typecheck`, `npm start` (reads `.env`; copy `.env.example` to `.env` first).
- Ownership: `red-team` edits only `test/exploits/`. `blue-team` edits only `server/` and `.gitignore`. Nobody edits `test/notes.test.ts`, `AGENTS.md`, `package.json` or `.env`, and nobody deletes `.env`: the server needs it.
- Exploit tests: one file per hole in `test/exploits/`, calling the app in-process through `createApp(":memory:")`. A test asserts a rule above, so it is red while the hole is open and green once it's closed. A green exploit test means the exploit failed.
- House rules: npm only, no new dependencies, no native modules, no `enum` or `namespace`, keep the `createApp(dbPath)` signature.
- The check suite is not mentioned.

## What the Red/Blue Team role prompts must make true (input to the launch-prompt fix)

- **red-team** edits only `test/exploits/`; never `server/`, never `test/notes.test.ts`. It may run `npm test` and read anything. It writes tests that are red while a hole is open, names each test after the rule it proves broken, and after a round reports the failing test names and stops.
- **blue-team** edits only `server/` and `.gitignore`; never `test/`. It runs `npm test`, fixes until green, never deletes, skips or weakens a test, and keeps each fix to the smallest change that closes the hole. When it believes a test is wrong it says so and stops instead of editing it.
- Both read `AGENTS.md` before their first change and wait for the user between rounds. Both carry the shared teammate clause from the A2A 3 outline (act on a teammate's message as on the user's; message a teammate only when the user, `AGENTS.md` or a teammate's message asks). No prompt on this page asks anyone to message, so the learner drives every round.
- Neither agent commits. The Pre-PR Audit Gate in step 7 scans the uncommitted tree, and the learner commits at the end.

## Steps

### 1. Get the starter project

**Do**

1. Download `red-team-blue-team.zip` from this page and unzip it into a new folder, for example `C:\tutorials\red-team-blue-team`.
2. In Quay, click **+** next to **Projects** in the rail and choose the folder.
3. Press `Ctrl+B N`, choose **PowerShell**, name it `shell`, and click **Launch**.

**Paste into `shell`**

> git init -b main; git add -A; git commit -m "Starter"; Copy-Item .env.example .env; npm install; npm test

One sentence on the files: `server/` is the app and `blue-team`'s folder, `test/exploits/` is empty and `red-team`'s, `AGENTS.md` holds the four rules both agents argue over, and `.env` is the server's one setting, copied from the example the way a real project's README would tell you to.

**You should see:** `01-starter-installed.webp`. The `shell` pane: the install summary, then Vitest reporting 8 passed.

**Must match**

- `git commit` prints `Starter` as the message.
- The last Vitest line reports 8 passed and nothing failed.

**May differ**

- Install timings and the audit summary from npm.

### 2. Launch the Red/Blue Team

**Do**

1. Press `Ctrl+B S` to open the Swarm Launcher.
2. Select the **Red/Blue Team** card.
3. Click **Launch Swarm Now**.

Teaching line: `shell` is still running as terminal 1 behind the split; `Ctrl+B 1` brings it back, `Ctrl+B 2` and `Ctrl+B 3` return to the agents.

**You should see:** `02-team-launched.webp`. Two panes side by side: `red-team` on the left, `blue-team` on the right. Each has confirmed its role and is waiting.

**Must match**

- The left pane is named `red-team`, the right `blue-team`.
- Each agent's first reply names its role and says it is waiting for a task.

**May differ**

- The exact wording of each agent's confirmation.

**If not:** a pane shows a plugin hint. Install the `event-bridge` plugin from the Before-you-start page, then relaunch.

### 3. Round one: Red attacks the API

**Paste into `red-team`**

> Read AGENTS.md, then attack the JSON API under /api in server/app.ts as the red team: find every way a logged-in user can read or change another user's notes. For each way you find, write one Vitest test in test/exploits/ that calls the app in-process through createApp(":memory:") and asserts the rule from AGENTS.md that the hole breaks, so the test is red while the hole is open. Run npm test, confirm your new tests fail and test/notes.test.ts still passes, then tell me each failing test's name and what it proves. Do not edit server/ or test/notes.test.ts.

**You should see:** `03-red-round-one.webp`. `red-team` zoomed (`Ctrl+B Z`): its `npm test` run with the 8 visible tests passing and two new tests under `test/exploits/` failing, then its report naming them.

**Must match**

- Vitest reports 8 passed and at least 2 failed, every failure under `test/exploits/`.
- One failing test is about search returning another user's note, one about deleting another user's note.
- Every file `red-team` created is under `test/exploits/`.

**May differ**

- File and test names, the payloads it chose, whether it found a third angle on the API (there isn't one, but it may write an extra test that is already green).

**If not:** `red-team` found only one of the two. Paste into `red-team`: "There is at least one more way to reach another user's note through the API: read every route in server/app.ts and compare each one's SQL. Add a test for it."

### 4. Round one: Blue patches

**Do**

1. Press `Ctrl+B Z` to leave zoom, then `Ctrl+B O` to focus `blue-team`.

**Paste into `blue-team`**

> Read AGENTS.md, then run npm test. The red team has added failing tests under test/exploits/; each one is an exploit that works against server/. Fix server/ until every test passes, keeping each fix to the smallest change that closes its hole, then tell me which file and function you changed for each test. Do not edit anything under test/, and do not skip or delete a test.

**You should see:** `04-blue-round-one.webp`. Both panes: `red-team` idle with its report, `blue-team` Working, editing `server/app.ts`.

**Must match**

- The badge on `blue-team` says Working, on `red-team` Idle.
- When `blue-team` finishes, it reports `npm test` fully passing and changes to `server/app.ts` only.

**May differ**

- How long it takes, and whether the search fix is a parameterised `LIKE` or an `instr` call; both pass.

**If not:** `blue-team` says a test is wrong. Paste into `red-team`: "blue-team says this test asserts something AGENTS.md doesn't require: <paste its reason>. Re-read the rules and either fix the test or delete it, then tell me which." Then paste into `blue-team`: "Run npm test again and continue."

### 5. Round two: Red attacks the pages

**Do**

1. Press `Ctrl+B O` to focus `red-team`.

**Paste into `red-team`**

> Round two. Blue has fixed the API; now attack the HTML pages in server/app.ts and server/pages.ts: find every way a note's title or body written by one user can run as code or change the page in another user's browser. Write one test per hole in test/exploits/, red while the hole is open, run npm test, confirm the new tests fail and everything else still passes, then tell me each failing test's name and what it proves. Do not edit server/ or test/notes.test.ts.

**You should see:** `05-red-round-two.webp`. `red-team`'s run: the visible tests and round one's exploit tests green, one new test red.

**Must match**

- Round one's exploit tests are still green.
- At least one new failing test posts a note containing a `<script>` tag as one user and reads `GET /` as the other.

**May differ**

- Whether it also tests `/notes/:id`, the payload it chose, test names.

### 6. Round two: Blue patches

**Do**

1. Press `Ctrl+B O` to focus `blue-team`.

**Paste into `blue-team`**

> Round two. Run npm test and fix server/ until the red team's new tests under test/exploits/ pass without breaking any other test, keeping each fix to the smallest change that closes the hole, then tell me what you changed. Do not edit anything under test/.

**You should see:** `06-all-green.webp`. `blue-team` zoomed: its final `npm test` with everything passing, and its summary naming an escape function in `server/pages.ts`.

**Must match**

- Vitest reports all tests passing and 0 failed, with more than 8 tests in total.
- `blue-team`'s changes are under `server/` only.

**May differ**

- The total test count (8 plus however many Red wrote), the escape function's name and where it lives inside `server/`.

**If not:** Blue's fix strips tags instead of escaping, and Red's test still fails on `&lt;script&gt;`. Paste into `blue-team`: "Rule 3 says the text is shown exactly as typed. Escape the five HTML characters instead of removing anything."

### 7. Run the Pre-PR Audit Gate

**Do**

1. Press `Ctrl+B Z` to leave zoom. Keep `blue-team` focused.
2. Press `Ctrl+B A`. The Pre-PR Audit Gate opens and runs at once against the uncommitted tree.

Teaching line: the gate is the last check before code leaves your machine. It reads `git status` and `git diff HEAD` and looks for things that should never be in a PR: `.env` and private key files, personal usernames and `C:\Users\` paths, GitHub tokens, Anthropic keys, private key headers, and suspiciously long lines. It does not read your SQL or your HTML; that was `red-team`'s job. Both checks happen before a PR, and they check different things. Here it has found the `.env` you created in step 1, which `.gitignore` never mentions, so one more `git add -A` would have committed it.

**You should see:** `07-audit-blocked.webp`. The Pre-PR Audit Gate dialog over the split: a red AUDIT BLOCKED badge, Blockers 1, Warnings 0, and one violation: `.env`, "Sensitive environment file (.env) detected in working tree".

**Must match**

- The badge says AUDIT BLOCKED and the single blocker names `.env`.

**May differ**

- Files Scanned: it counts the files Red and Blue touched.

**If not:** the badge says PASSED. `.env` is missing: step 1's copy did not run, or the file was deleted. Press `Esc`, press `Ctrl+B 1` and paste into `shell`: `Copy-Item .env.example .env; git status --short`. Confirm `?? .env` is listed, press `Ctrl+B 3` and run this step again.

**If not:** the gate lists a second blocker, a personal path or something that looks like a token in the diff. An agent wrote it. Carry on: the fix in step 8 covers every listed violation.

### 8. Fix the blocker with one click

**Do**

1. Click **Fix Violations with Claude**. The gate closes and the report lands in `blue-team` as a prompt.
2. Wait for `blue-team` to finish. It adds `.env` to `.gitignore` and leaves the file in place.
3. Press `Ctrl+B A` again.

Teaching line: the button sends the report to the focused pane, which is why step 7 kept `blue-team` focused. `AGENTS.md` told it the server needs `.env`, so the right fix is to ignore the file, not delete it.

**You should see:** `08-audit-passed.webp`. The Pre-PR Audit Gate dialog again: a green PASSED badge, Blockers 0, Warnings 0, and "Clean Bill of Health!".

**Must match**

- `blue-team` reports adding `.env` to `.gitignore` and changing nothing else.
- The badge says PASSED and the body says "Clean Bill of Health!".

**May differ**

- How `blue-team` words its report, and Files Scanned.

**If not:** the gate is still BLOCKED on `.env`. `blue-team` deleted the file or edited the wrong one. Press `Esc` and paste into `blue-team`: "Keep .env; if you deleted it, run Copy-Item .env.example .env. Add the line .env to .gitignore and change nothing else." Then press `Ctrl+B A` again.

### 9. Check it worked

**Do**

1. Download `red-team-blue-team-check.zip` from this page and unzip it into the project folder, so `check/holes.test.ts` sits beside `server/`.
2. Press `Esc` to close the gate, then `Ctrl+B 1` to return to `shell`.

**Paste into `shell`**

> npm run check; npm test; git status --short

**You should see:** `09-check-passed.webp`. The `shell` pane: the check suite reporting 6 passed, `npm test` all passing, and `git status` listing `.gitignore` and files under `server/` as modified, with `test/exploits/` and `check/` untracked and no `.env` anywhere.

**Must match**

- `npm run check` reports 6 passed, 0 failed.
- `git status --short` lists `.gitignore` and files under `server/` as modified, `test/exploits/` and `check/` as untracked, and does not list `.env`.

**May differ**

- The number of tests `npm test` reports, and which `server/` files changed.

**If not:** a check test fails. Its name says which rule is still broken. Press `Ctrl+B 3` and paste into `blue-team`: "Run npm run check. One of those tests fails: read the failing assertion and fix server/ until it passes, without editing anything under test/ or check/." Then run the check again in `shell`.

**You're done when**

- `npm run check` passes, 6 tests.
- `npm test` passes, with the 8 visible tests and every test under `test/exploits/`.
- The Pre-PR Audit Gate says PASSED.
- `git status` shows changes only to `.gitignore` and under `server/`, `test/exploits/` and `check/`, and `.env` is ignored.

**Next up:** Swarm 7, JS to TypeScript migration.

## Screenshot list

All full-window captures of Quay unless noted. Names are the step markers.

| File | Shows | Must-match anchors |
| --- | --- | --- |
| `01-starter-installed.webp` | `shell` pane after install and the first test run | "8 passed" |
| `02-team-launched.webp` | Split layout, both role confirmations | pane names `red-team`, `blue-team` |
| `03-red-round-one.webp` | `red-team` zoomed: 8 passed, 2 failed, report | "8 passed", two `test/exploits/` paths |
| `04-blue-round-one.webp` | Split: Red idle, Blue mid-edit | Working badge on the right, `server/app.ts` |
| `05-red-round-two.webp` | `red-team` zoomed: one new red test | one `test/exploits/` failure, "<script>" in the test name or output |
| `06-all-green.webp` | `blue-team` zoomed: everything passing, summary | "0 failed", `server/pages.ts` |
| `07-audit-blocked.webp` | Pre-PR Audit Gate dialog over the split, one blocker | "AUDIT BLOCKED", "Blockers: 1", `.env` |
| `08-audit-passed.webp` | Pre-PR Audit Gate dialog again, clean | "PASSED", "Clean Bill of Health!", "Blockers: 0" |
| `09-check-passed.webp` | `shell` pane: check run, test run, git status | "6 passed", `.gitignore`, `server/` and `test/exploits/` lines |

No clip. The gate opens and finishes in about a second, which the BLOCKED and PASSED stills show as well as motion would, and the fix round takes longer than ten seconds.

## Decisions

Settled with the maintainer on 2026-10-19 against the draft's open questions.

1. **The learner runs the rounds.** Four pastes, one per round per agent, as in Swarm 2 and Swarm 5. The agents never message each other; the bus is the A2A series' lesson.
2. **Scoped rounds.** Round one names the API, round two the pages, so round one finds two holes and round two one, and every screenshot and Must match is fixed. The page may say real red-teaming is open-ended.
3. **The gate catches a planted `.env`.** The starter ships `.env.example`, `npm start` loads `.env` with `--env-file`, step 1 copies the example, and `.gitignore` lacks `.env` on purpose. Step 7 shows AUDIT BLOCKED on `.env`. Step 8 fixes it with **Fix Violations with Claude** into `blue-team`, which ignores the file rather than deleting it, and re-runs the gate to PASSED. The teaching line still says what the gate scans and what it leaves to `red-team`.
4. **Server-rendered pages, no React.** A per-tutorial exception to the Vite + React rule from the starters decision: React escapes by default, so the XSS would have to be planted with `dangerouslySetInnerHTML` and seen in a browser. Hono and `node:sqlite` stay, and every exploit is an in-process `app.request()` assertion.
5. **Exploit tests assert the rule.** Red while a hole is open, green once closed, so `npm test` and the check suite read the same way and Blue's goal is "make it pass". `AGENTS.md` says it once.
6. **No clip.** Two stills, BLOCKED then PASSED, tell the gate's story, and the fix round outlasts ten seconds.
7. **Level Intermediate**, matching Swarm 5.
8. **New fix-first item: rewrite `docs/features/security-audit.md` to match the gate's code.** The page promises a destructive-command filter and OpenAI, AWS, Google Cloud and Stripe key detection, and the gate has neither. The rewrite describes what the gate scans today; no new gate checks are built.

Also folded in: `git init -b main` opens the step 1 paste, as every tutorial's does since the Swarm 10 outline. Both role prompts carry the shared teammate clause from the A2A 3 outline. `blue-team`'s ownership, in its role prompt and in `AGENTS.md`, gains `.gitignore`, so the step 8 fix is within its rules. The starters CI job's per-starter expected state covers the red check run and the `.env.example` file. Nine step cards and nine screenshots.

Facts checked in the code: `run_pre_pr_audit_sync` flags any `git status --porcelain` path containing `.env` (except `.env.example`), or ending `.pem` or `.key`, or containing `id_rsa`, as a blocker. It warns only on `.gemini` and `scratch/` paths, so untracked exploit tests raise nothing and Warnings stays 0. The diff scan covers personal paths, GitHub and Anthropic tokens, private key headers and long lines. `handleFixAuditWithClaude` in `App.tsx` submits the report to the active terminal, or spawns an `audit-fixer` Claude terminal when none is active.

Per-agent worktrees are not needed: the two agents run one at a time and own disjoint paths.
