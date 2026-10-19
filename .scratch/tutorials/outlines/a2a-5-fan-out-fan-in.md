# Outline: A2A 5, Fan-out / fan-in

Prototype outline for the ticket "Tutorial outline: A2A 5, Fan-out / fan-in" on the Swarm and A2A tutorials map.
A rough take to react to, not the tutorial. Open questions are at the end.

Slug `fan-out-fan-in`. Page `docs/tutorials/a2a/fan-out-fan-in/index.md`. Starter `examples/tutorials/fan-out-fan-in/starter/`. No check suite (see open question 6).

This outline describes the app after the fix-first work: launch prompts carry roles, the custom builder has a role-prompt box, terminals keep creation order, the `Ctrl+B` prefix is swallowed, the plugin hint exists, and replies resolve only with a turn that starts after delivery.

## The lesson in one paragraph

A2A 3 handed one job to one agent and got one report back. This tutorial hands three jobs out at once and has to collect three reports that come back in any order. `lead` sends each worker its part with `wait_for_reply: false`, then goes idle. Each worker builds its part in its own folder and reports `DONE <part>` to `lead` with a new message. After each report `lead` names what is still outstanding. When nothing is, it wires the parts together and runs the end-to-end test. If a part breaks the end-to-end test, `lead` sends the failure back to that part's owner, never fixing it itself. The learner pastes one prompt and watches.

## Why it is shaped this way

- **The split is drawn before anyone starts.** The starter ships the contract (`src/types.ts`, finished and read-only) and one test file per part. A2A 2 taught negotiating a contract; this tutorial is about running parts in parallel, so nothing is negotiated.
- **One folder per worker.** All agents share the project folder, and per-agent worktrees aren't a chosen fix. File ownership in `AGENTS.md` keeps the workers off each other's files, as Swarm 2 decided for role prompts.
- **Each worker runs only its own test file.** The other parts stay red until their owners finish, so `npm test` would mislead a worker. Each part has its own npm script.
- **Nobody waits for a reply.** Each part takes minutes, far past the 60 seconds a reply waits. Fan-out uses `wait_for_reply: false`; fan-in is three new messages back.
- **Fan-in by counting, not polling.** `lead` keeps the count in its own conversation and says it out loud after each report (`OUTSTANDING: render, cli`), so the learner and the trail can see it. Polling with `quay_get_agent_status` is A2A 6's lesson.
- **Every message is one line,** because Quay flattens newlines when it types a message into a terminal. The learner's prompt dictates each message word for word, so the trail is checkable.

## The page, top to bottom

**Title:** A2A 5: Fan-out / fan-in

**Pitch:** One `lead` agent splits a tiny static-site generator three ways and hands each part to its own worker at once. The workers build in parallel, each in its own folder, and report back when they're done. `lead` waits for all three, wires the parts together and runs the end-to-end test. You paste one prompt.

**Tiles:** Time and Tokens are generated from test runs. Agents: 4 × Claude + 1 PowerShell shell. Level: Advanced (see open question 9).

**You'll learn:** fanning work out to several agents with one prompt, collecting reports that arrive in any order, keeping parallel agents apart with folder ownership, routing an integration failure back to the part's owner, and reading a fan-out and fan-in in Mission Control's trail.

**Before you start:** the shared Before-you-start page (Quay installed; Claude Code 2.1.296 or later, signed in; `event-bridge` 0.1.0 or later; PowerShell 7; Node 24 or later, npm and Git). A2A 3 done, and Swarm 4 for the custom swarm builder. Two lines on this page:

- Four agents run in Skip mode at once and edit files without asking. The starter goes into a new, empty folder.
- Four agents use about four times the tokens of a one-agent run. The Tokens tile shows it.

## The starter project: `fan-out-fan-in`

A static-site generator, `ssg build <in> <out>`, split into three parts and a three-line glue file. Every part is a stub that throws, and its tests are written and red.

```text
starter/
  package.json         name fan-out-fan-in, "type": "module", engines node >=24
                       scripts: test "vitest run"
                                test:parser "vitest run test/parser.test.ts"
                                test:render "vitest run test/render.test.ts"
                                test:cli "vitest run test/cli.test.ts"
                                e2e "vitest run test/e2e.test.ts"
                                typecheck "tsc --noEmit"
                                build "node bin/ssg.ts build site dist"
                       devDependencies: vitest, typescript, @types/node (exact versions, no ^)
  package-lock.json
  tsconfig.json        strict, erasableSyntaxOnly, noEmit, module/moduleResolution nodenext,
                       allowImportingTsExtensions
  .gitignore           node_modules/, dist/
  README.md            the goal in two sentences; points at AGENTS.md
  AGENTS.md            see below
  CLAUDE.md            @AGENTS.md
  src/types.ts         the contract, finished. Doc, Block and Inline types; the signatures of
                       parse, render, run and buildPage, each with a doc comment saying exactly
                       what it returns. Read-only for everyone.
  src/parser/parse.ts  export function parse(markdown: string): Doc            throws "not implemented"
  src/render/render.ts export function render(doc: Doc, template: string): string   throws
  src/cli/run.ts       export async function run(argv: string[], buildPage: BuildPage): Promise<number>   throws
  src/site.ts          export function buildPage(markdown: string, template: string): string   throws
                       header comment: "Owned by lead. Written after the three parts are done."
  bin/ssg.ts           finished entry point: process.exitCode = await run(process.argv.slice(2), buildPage)
  site/                index.md, about.md, hello.md, template.html ({{title}} and {{content}})
  site/expected/       index.html, about.html, hello.html: the exact pages the build must produce
  test/parser.test.ts  red
  test/render.test.ts  red
  test/cli.test.ts     red; injects a fake buildPage, so it never depends on src/site.ts
  test/e2e.test.ts     red; runs bin/ssg.ts on site/ into a temp folder and compares each page
                       with site/expected/, whitespace between tags ignored
```

**The Markdown subset** (in `src/types.ts` doc comments): front matter with `title:`, `#` and `##` headings, paragraphs (wrapped lines join), `- ` lists, inline `` `code` `` and `[text](href)`. Nothing else, so each part fits one agent's session.

**The tests**, by owner:

- **Parser:** front matter title; heading levels; paragraph lines join; list items; inline code; links.
- **Render:** fills `{{title}}` and `{{content}}`; headings become `h1` and `h2`; lists become `ul` and `li`; `<` and `&` in text are escaped; a `javascript:` link is rendered as plain text.
- **CLI:** `build <in> <out>` writes one `.html` per `.md` and prints `Built <n> pages to <out>`; non-`.md` files are skipped; missing arguments print the usage and exit 2; a missing `template.html` prints an error and exits 1.
- **End to end:** one test per page in `site/`, each matching `site/expected/`.

`hello.md` contains `` Use `<b>` sparingly `` and a `javascript:` link, so the end-to-end test proves escaping and the link rule survive the whole pipeline.

**Starters CI expected state:** `npm ci` and `npx tsc --noEmit` clean; every test red. The count comes from the test files and goes in the per-starter expected-state marker that Swarm 3's resolution added.

**`AGENTS.md`**, in full-ish:

- **Goal:** `ssg build <in> <out>` turns a folder of Markdown pages into HTML pages using `template.html`.
- **The contract:** `src/types.ts` is finished. Nobody edits it. If it seems wrong, tell `lead`.
- **Ownership:**

  | Agent | Owns | Runs |
  | --- | --- | --- |
  | `lead` | `src/site.ts` | `npm run e2e`, `npm run typecheck` |
  | `parser-dev` | `src/parser/` | `npm run test:parser` |
  | `render-dev` | `src/render/` | `npm run test:render` |
  | `cli-dev` | `src/cli/` | `npm run test:cli` |

  Nobody edits `test/`, `bin/`, `site/` or another agent's folder. Never run plain `npm test`: other parts are red until their owners finish.
- **On the bus:** every message is one line. A worker reports to `lead` with `quay_send_message`, `wait_for_reply: false`, text exactly `DONE <part>`, then stops. Nobody waits for a reply from anybody. Workers message only `lead`.
- **House rules:** npm only, no new dependencies (no Markdown library: writing the parser is the job), no `enum` or `namespace`.

## The swarm: Fan-out Crew

A custom swarm, built in step 3 the way Swarm 4 taught. Grid layout, four Claude Code rows, in this order so the grid reads lead top-left:

| Session name | Role | Role prompt |
| --- | --- | --- |
| `lead` | Lead | You are the lead. You hand out work over the A2A bus and integrate the results. You own src/site.ts only. Never edit a worker's folder: send its owner a one-line message instead. Read AGENTS.md, then wait for the user's task. |
| `parser-dev` | Parser Worker | You are a worker. You own src/parser/ and nothing else. Read AGENTS.md, then wait for a job from lead. When your tests pass, report to lead exactly as AGENTS.md says and stop. |
| `render-dev` | Render Worker | The same, with src/render/. |
| `cli-dev` | CLI Worker | The same, with src/cli/. |

The page gives all four role prompts in full, each in its own Paste box.

## Steps

### 1. Get the starter project

The standard step, inside Quay, as Swarm 2 proposed.

**Do**

1. Download `fan-out-fan-in.zip` from this page and unzip it into a new, empty folder.
2. In Quay, click **Add Project Workspace** in the rail and pick that folder.
3. Press `Ctrl+B N`, choose **PowerShell**, type `shell` in **Terminal Label (Optional)** and click **Start Terminal**.

**Paste into `shell`**

```text
git init; git add -A; git commit -m Starter; npm install
```

**You should see:** `01-starter-installed.webp`. The `shell` pane after `npm install`; the rail shows the project.

**Must match**

- `git commit` prints `Starter` as the message.
- `npm install` ends with `added` and a package count, no errors.

**May differ**

- The package count and timings.

**If not: node or npm is not recognised.** Node 24 or later isn't on your PATH. Install it from the Before-you-start page, then close and reopen Quay.

### 2. See the split

**Paste into `shell`**

```text
npm test
```

Teaching line: four test files, four owners. Each worker will run only its own file, and `lead` runs the last one. The page shows the ownership table from `AGENTS.md` here.

**You should see:** `02-all-red.webp` (pane). Vitest's summary with four test files, all failing.

**Must match**

- `Test Files  4 failed`.
- Every test fails with `not implemented`.

**May differ**

- Timings.

### 3. Build and launch the Fan-out Crew

**Do**

1. Press `Ctrl+B S`, then **Create Custom Swarm**.
2. In **Swarm Name**, type `Fan-out Crew`. Set **Layout Arrangement** to **Grid**.
3. Click **Add Agent** until the roster has four rows.
4. Fill in each row as the table above says: Claude Code, the role, the session name and the role prompt.
5. Click **Save**, then **Launch Swarm Now**.
6. Wait until all four panes have confirmed their role and gone quiet.

Teaching line: the `shell` terminal keeps running behind the grid. You'll bring it back in step 8.

**You should see:** `03-crew-launched.webp`. A 2x2 grid: `lead` top left, `parser-dev` top right, `render-dev` bottom left, `cli-dev` bottom right. Each pane's first reply names its role.

**Must match**

- The rail lists `shell`, `lead`, `parser-dev`, `render-dev`, `cli-dev`, in that order.
- All four Claude badges read Idle, and no pane shows the plugin hint.

**May differ**

- The wording of each acknowledgement.
- The port number in the rail header.

**If not: a pane shows the plugin hint.** Do the fix from A2A 1's step 2 in that pane.

### 4. Fan out

**Do:** click into the `lead` pane, or press `Ctrl+B O` until its border is highlighted.

**Paste into `lead`**

```text
Fan out the three parts. With quay_send_message and wait_for_reply false, send parser-dev exactly: Build src/parser/ until npm run test:parser passes, then report DONE parser to lead. Send render-dev exactly: Build src/render/ until npm run test:render passes, then report DONE render to lead. Send cli-dev exactly: Build src/cli/ until npm run test:cli passes, then report DONE cli to lead. Then end your turn with the line OUTSTANDING: parser, render, cli. Each time a DONE message arrives, end your turn with one line, OUTSTANDING: and the parts not yet done. When none are left, write src/site.ts and run npm run e2e. If an e2e test fails, find which part is wrong, send its owner one line starting FIX and naming the failing page and what differs, without waiting, and wait for its DONE again. Never edit a worker's folder. When npm run e2e and npm run typecheck both pass, end with the line FAN-IN COMPLETE.
```

**You should see:** `04-fan-out.webp`. Three `quay_send_message` calls in `lead`, then `OUTSTANDING: parser, render, cli`. All three workers' badges are Working at once, each pane showing `[Peer agent (lead)]: Build src/...`.

**Clip:** `04-fan-out.mp4`, with the still as its poster. The three worker badges turn Working within a few seconds of each other while `lead` turns Idle. This is the picture of fan-out.

**Must match**

- `lead` shows three `quay_send_message` calls, one to each worker.
- Each worker's pane shows its own job with the `[Peer agent (lead)]:` prefix.
- `lead`'s last line is `OUTSTANDING: parser, render, cli`, and its badge reads Idle.

**May differ**

- The order of the three sends.
- Whether `lead` reads `AGENTS.md` again first.

**If not: `lead` starts writing the parser itself.** Press `Esc` to stop it, run `git checkout -- src/` in `shell`, and paste the prompt again.

### 5. Watch the reports come back

**Do:** nothing. Watch the grid. Each worker runs its own tests until they pass, then reports.

**You should see:** `05-fan-in.webp`. Taken after the second report. Two workers Idle, one still Working. In `lead`, two `[Peer agent (...)]: DONE ...` prompts, each answered by an `OUTSTANDING:` line one part shorter.

**Must match**

- Each report in `lead` reads `[Peer agent (<worker>)]: DONE <part>`.
- Each of `lead`'s answers is one `OUTSTANDING:` line, missing the parts already reported.

**May differ**

- The order the reports arrive in. This is the point of fan-in: `lead` can't know it in advance.
- How long each worker takes.

**If not: a worker edits a file outside its folder.** It still may work, but the lesson is lost. Tell it: `Undo your changes outside src/<part>/ with git checkout, then report DONE <part> to lead.`

**If not: a worker's badge goes Idle and it never reports.** Its tests may still fail. Paste into that worker: `Run your test script. When it passes, report DONE <part> to lead as AGENTS.md says.`

### 6. Watch `lead` integrate

**Do:** nothing. After the third report, `lead` writes `src/site.ts` and runs `npm run e2e`.

Teaching line: if an end-to-end test fails, `lead` doesn't fix the part. It sends `FIX ...` to the owner and goes back to waiting. The If not below shows one.

**You should see:** `06-fan-in-complete.webp` (pane). `lead`'s `npm run e2e` run passing, then `FAN-IN COMPLETE`.

**Must match**

- `lead` edited `src/site.ts` and no other source file.
- The e2e run shows every test passing.
- `lead`'s last line is `FAN-IN COMPLETE`.

**May differ**

- Whether a `FIX` round happened first.
- How `src/site.ts` is written.

**If not: a `FIX` message went out.** This is the fan-in loop working, not a failure. The owner fixes its part and reports `DONE` again, and `lead` re-runs the end-to-end test.

### 7. Read the fan-out and fan-in in Mission Control

**Do:** open Mission Control from the rail's bottom toolbar or `Ctrl+K`.

**You should see:** `07-trail.webp`. Three `lead → <worker>` entries close together, then one `<worker> → lead` `DONE` entry per worker, in the order they arrived.

**Must match**

- One `lead → parser-dev`, one `lead → render-dev` and one `lead → cli-dev` entry, each Completed with the worker's closing summary as its reply.
- One `DONE` entry from each worker to `lead`, each Completed with an `OUTSTANDING:` line or, for the last, `lead`'s integration summary as its reply.

**May differ**

- The order of the `DONE` entries, and any `FIX` entries.
- Times and wording.

### 8. Check it worked

**Do**

1. Close Mission Control. Press `Ctrl+B O` until `cli-dev`'s pane is focused, then `Ctrl+B 1` to show `shell` there.
2. Paste the line below.

**Paste into `shell`**

```text
npm test; npm run build; Select-String -Path dist\hello.html -Pattern '&lt;b&gt;'; git status --short
```

**You should see:** `08-check.webp` (pane).

**Must match**

- `Test Files  4 passed`.
- `Built 3 pages to dist`.
- `Select-String` prints the escaped `<b>` line from `dist\hello.html`.
- `git status --short` lists files only under `src/site.ts`, `src/parser/`, `src/render/` and `src/cli/`.

**May differ**

- Timings, and the file names each worker added inside its own folder.

**You're done when**

- `lead`'s last line is `FAN-IN COMPLETE`.
- `npm test` shows every test file passing and `npm run build` prints `Built 3 pages to dist`.
- `git status --short` shows no change outside the four owned paths.

**Next up:** A2A 6, Long jobs: fire, then poll.

## Screenshot list

Full-window captures of Quay unless noted. Names are the step markers.

| File | Shows | Must-match anchors |
| --- | --- | --- |
| `01-starter-installed.webp` | `shell` pane after `npm install` | `Starter` commit, `added` line |
| `02-all-red.webp` | `shell` pane (crop) | `Test Files  4 failed` |
| `03-crew-launched.webp` | 2x2 grid after launch | rail order, four Idle badges |
| `04-fan-out.webp` | grid, three workers Working | three sends, `OUTSTANDING: parser, render, cli` |
| `04-fan-out.mp4` | the clip, still above as poster | three badges turning Working |
| `05-fan-in.webp` | grid after the second report | two `DONE` prompts in `lead` |
| `06-fan-in-complete.webp` | `lead` pane (crop) | e2e passing, `FAN-IN COMPLETE` |
| `07-trail.webp` | Mission Control over the stage | three out, one `DONE` per worker |
| `08-check.webp` | `shell` pane (crop) | `4 passed`, `Built 3 pages`, escaped `<b>` |

**Fixture recording:** one whole run, five terminals (four Claude casts with their bridge logs, one PowerShell cast), markers `01` to `08`. The recording fixes the report order the screenshots show; the page says the order may differ.

## Code this tutorial depends on

Already on the fix-first list: the launch prompt and the custom builder's role-prompt box (step 3), terminal creation order (rail order and grid positions), swallowing the `Ctrl+B` prefix, the plugin hint, and replies resolving only with a turn that starts after delivery (step 7).

Proposed in other drafts, still open: the trail ordered newest first, and `quay_get_agent_status` taking names.

New fix-first items from this outline: deliveries held until the target is idle, and a Queued trail status (decisions 1 and 3 below). This is the first tutorial where several agents message one terminal close together, so it is the first to need them.

## Decided with the maintainer

The draft's open questions, settled in order.

1. **Deliveries are held until the target is idle (fix-first).** Quay keeps a delivery queue per terminal. It types the next message into a Claude terminal only after that terminal's `turn.completed`, and writes text and Enter as one unit. This stops two reports merging into one prompt, and stops a report landing while `lead` is mid-turn.
2. **Mid-turn delivery needs no live test.** Holding until idle means Claude Code never receives typed input during a turn, so its own queueing doesn't matter.
3. **The trail gains a Queued status (fix-first).** Entries go Queued, then Dispatched on delivery, then Completed. A finished turn completes the one entry delivered for that turn, never a queued one. This extends the wrong-replies fix. Step 7 checks every `DONE` entry's reply.
4. **The swarm is a custom, saved Fan-out Crew,** built in the custom builder with four role prompts, as Swarm 4 taught.
5. **`lead`'s glue stays thin.** `src/site.ts` is three lines; the integration lesson is running the end-to-end test and routing failures to owners.
6. **No check suite.** The visible end-to-end test against `site/expected/` proves the pipeline.
7. **No forced `FIX` round.** It may or may not happen; the page shows it under May differ and in an If not.
8. **The final check swaps `shell` into `cli-dev`'s pane** with `Ctrl+B 1`, and the page says `cli-dev` keeps running behind it.
9. **Level: Advanced,** the first A2A tutorial at that level. The page template's level scale gains Advanced if it lacks it.
10. **Prerequisites: A2A 3 and Swarm 4,** linked under Before you start.

What changes in the steps because of 1 and 3: in step 5, a report that arrives while `lead` is answering another one waits in Quay's queue, so `lead` always answers one `DONE` per turn. In step 7, a `DONE` entry may briefly show Queued while the trail is open.
