# Outline: Swarm 8, Tri-Agent Council: plan, build, verify

Prototype outline for [Tutorial outline: Swarm 8, Tri-Agent Council: plan, build, verify](https://github.com/seanrobertwright/Quay-2/issues/23).
Accepted by the maintainer on 2026-10-19, with the decisions at the end folded in. Not the tutorial: the page is written after the fix-first work.

Slug `tri-agent-council`. Page `docs/tutorials/swarm/tri-agent-council/index.md`. Starter `examples/tutorials/tri-agent-council/starter/`, check suite `examples/tutorials/tri-agent-council/check/`.

## The page, top to bottom

**Title:** Swarm 8: Tri-Agent Council: plan, build, verify

**Pitch:** Three Claude Code agents take one job in three stages. `planner-agent` reads a spec and writes `PLAN.md`, `builder-agent` builds the plan until the tests pass, and `verifier-agent` runs the result and gives a verdict. The job is a command-line link checker for a folder of Markdown files, and you end by running it yourself and opening a check suite the agents never saw.

**Tiles:** Time and Tokens are generated from test runs. Agents: 3 × Claude. Level: Intermediate.

**You'll learn:** the Tri-Agent Council preset, splitting one job into plan, build and verify so each agent owns one kind of file, handing work from one agent to the next through a plan file, closing a terminal from the rail, and reading a verdict you can check.

**Before you start** (all on the shared Before-you-start page, linked):

- Quay 2 installed.
- Claude Code 2.1.296 or later, signed in.
- The `event-bridge` plugin installed. The Working and Idle badges this tutorial reads come from it.
- Node 24 or later, Git, PowerShell 7.
- The starter project, because the agents run in Skip mode and edit files without asking.

Note for the page: unlike Full-Stack Pair, this preset sets no `--model` flag, so all three agents run on the CLI default.

## The starter project

The starter is a CLI with nothing inside it, a spec exact enough to build and test against without a reference solution, and a sample docs folder with three broken links planted where the spec says they are. The split that keeps three agents safe in one folder is by file kind: the Planner writes one file, the Builder edits two folders, the Verifier edits nothing.

```text
starter/
  package.json          name tri-agent-council, "type": "module", "engines": { "node": ">=24" }
                        scripts: test "vitest run", typecheck "tsc --noEmit"
                        devDependencies: vitest, typescript, @types/node (exact versions, no ^)
  package-lock.json
  tsconfig.json         strict, erasableSyntaxOnly, noEmit, module and moduleResolution nodenext,
                        allowImportingTsExtensions, types node
  .gitignore            node_modules/
  README.md             the goal in two sentences; points at SPEC.md and AGENTS.md
  AGENTS.md             goal, commands, house rules, ownership (see below)
  CLAUDE.md             @AGENTS.md
  SPEC.md               the CLI contract (see below), ending with the exact expected output for docs-sample/
  src/cli.ts            the stub: no argument prints the usage line to stderr and exits 2;
                        any argument prints "not implemented" to stderr and exits 2
  test/cli.test.ts      the visible suite: one passing test (usage line and exit 2 with no argument)
                        and eight it.todo lines, one per rule in SPEC.md
  docs-sample/          five Markdown files exercising every SPEC.md rule, 3 links broken (see below)
    index.md
    CHANGELOG.md
    guide/getting-started.md
    guide/config.md
    reference/cli.md
```

**Scripts.**

| Script | Runs | Who uses it |
| --- | --- | --- |
| `npm test` | `vitest run` | builder-agent, verifier-agent, the learner at the end |
| `npm run typecheck` | `tsc --noEmit` | builder-agent, verifier-agent |
| `node src/cli.ts docs-sample` | the CLI itself | verifier-agent, the learner in steps 1 and 6 |

No build step and no `bin` entry: Node 24 runs `src/cli.ts` directly, so the command on the page is the command the spec names.

**Dependencies:** dev only: `vitest`, `typescript`, `@types/node`. The CLI uses `node:fs` and `node:path` and nothing else, and the house rules forbid adding anything.

**The contract (`SPEC.md`).** Written so the check suite can be built from it alone.

| Rule | Says |
| --- | --- |
| Usage | `node src/cli.ts <folder>`. No argument, or a path that isn't a folder: print `Usage: node src/cli.ts <folder>` to stderr, exit 2. |
| Files | Every `*.md` under `<folder>`, recursively. |
| Links | Inline links and images, `[text](target)` and `![alt](target)`, with the target ending at the first space or `)`. Reference-style links, autolinks and bare URLs are not links. Fenced code blocks are skipped. |
| External | A target starting `http://`, `https://` or `mailto:` is counted but never fetched, so it is never broken. The checker works offline. |
| Relative | Any other target is a path relative to the file's own folder, with an optional `#anchor`. Missing file: broken. |
| Anchors | `#anchor` alone points into the same file. An anchor matches a heading when it equals the heading's slug: lowercase, drop every character that isn't a letter, digit, space or hyphen, then spaces to hyphens. Only `#` headings count. No matching heading: broken. |
| Report | One line per broken link to stdout, `<path>:<line>: <target> (missing file)` or `(missing anchor)`, path relative to `<folder>` with forward slashes, line 1-based. Sorted by path in code-point order, then line. Then one line: `Checked <K> links in <M> files: <N> broken.` |
| Exit | 0 when nothing is broken, 1 when something is, 2 on a usage error. |

**The sample docs (`docs-sample/`).** Five files that exercise every rule in `SPEC.md` at least once, so a build the Verifier passes has met every rule the check suite tests. They hold relative paths, same-file and cross-file anchors, a heading with punctuation (`Options & flags`, slug `options--flags`), an image, an `https://` link and a `mailto:` link, plus a link inside a fenced code block and a reference-style link, neither of which counts. Three links are planted broken, one of each kind the spec names:

| File | Planted | Kind |
| --- | --- | --- |
| `guide/config.md` | `../reference/api.md` | missing file |
| `guide/getting-started.md` | `config.md#enviroment-variables` (the heading is "Environment variables") | missing anchor, cross-file |
| `reference/cli.md` | `#exit-code` (the heading is "Exit codes") | missing anchor, same file |

So the last lines of `SPEC.md`, and the Must match for steps 5 and 6, are:

```text
guide/config.md:<line>: ../reference/api.md (missing file)
guide/getting-started.md:<line>: config.md#enviroment-variables (missing anchor)
reference/cli.md:<line>: #exit-code (missing anchor)
Checked <K> links in 5 files: 3 broken.
```

followed by exit code 1. The line numbers and the link count `<K>` are fixed when the starter is written. From then on they are part of the exact output `SPEC.md` states, so Must match includes them.

**The check suite (`check/`).** Packed as `tri-agent-council-check.zip`, unzipped into the project folder at step 6, run with `npx vitest run check`.

```text
check/
  cli.check.test.ts     runs the CLI with execFileSync(process.execPath, ["src/cli.ts", folder]),
                        normalises line endings, asserts exact stdout and exit code
  docs-check/           a second sample the agents never saw, built from the same rules on new files:
                        three folders deep, its own punctuated heading, image, mailto: link and link
                        inside a fenced code block, and four planted broken links
  docs-clean/           two files, three good links, nothing broken
```

Three tests: `docs-check` prints the four expected lines and the summary and exits 1; `docs-clean` prints `Checked 3 links in 2 files: 0 broken.` and exits 0; no argument prints the usage line and exits 2.

**CI expected state:** `npm ci` and `npx tsc --noEmit` pass; `npm test` is green (1 passed, 8 todo); `npx vitest run check` fails against the stub. The starters CI job already allows a per-starter expected state for a check suite that fails on the unfixed starter.

**`AGENTS.md`**, in full-ish:

- Goal: a command-line link checker for a folder of Markdown files, specified in `SPEC.md`. `docs-sample/` is the folder it is checked against, and `SPEC.md` ends with the exact output it must print there.
- Commands: `npm test`, `npm run typecheck`, `node src/cli.ts docs-sample`.
- Ownership: `planner-agent` creates and edits only `PLAN.md`. `builder-agent` edits only `src/` and `test/`. `verifier-agent` edits nothing. Nobody edits `SPEC.md`, `AGENTS.md` or `docs-sample/`.
- House rules: npm only, no new dependencies, `node:fs` and `node:path` only, no `enum` or `namespace`, `src/cli.ts` stays the entry point.
- The check suite is not in the starter. The spec's expected output is the Verifier's definition of done, the check suite is the learner's.

## What the Tri-Agent Council role prompts must make true (input to the launch-prompt fix)

- **planner-agent** reads `SPEC.md` and `AGENTS.md`, then writes only `PLAN.md`: modules and functions for `src/cli.ts`, the order to build them, and the test cases `test/cli.test.ts` should hold, each tied to a rule in `SPEC.md`. It never touches `src/` or `test/`. Its last line when the plan is written is `PLAN.md written`.
- **builder-agent** edits only `src/` and `test/`, follows `PLAN.md`, replaces the `it.todo` lines with real tests, and runs `npm test` and `npm run typecheck` until both pass. Its last line when done is `npm test passing`.
- **verifier-agent** edits nothing. It runs the CLI and the test commands itself, compares output with `SPEC.md` line for line, and reports what it ran and what differed. Its last line is `VERIFIED` or `REJECTED`, so step 5 has a line to match and an If not to branch on.
- All three read `AGENTS.md` before their first action and wait for the user between tasks. All three carry the shared teammate clause from the A2A 3 outline (act on a teammate's message as on the user's; message a teammate only when the user, `AGENTS.md` or a teammate's message asks). No prompt on this page asks anyone to message: the learner pastes every brief, and `PLAN.md` carries the plan from the Planner to the Builder on disk.

## Steps

### 1. Get the starter project

**Do**

1. Download `tri-agent-council.zip` from this page and unzip it into a new folder, for example `C:\tutorials\tri-agent-council`.
2. In Quay, click **+** next to **Projects** in the rail and choose the folder.
3. Press `Ctrl+B N`, choose **PowerShell**, and click **Launch**.

**Paste into the PowerShell pane**

> git init -b main; git add -A; git commit -m Starter; npm install; node src/cli.ts docs-sample

One sentence on the files: `SPEC.md` says what the checker must do and ends with the exact output it must print for `docs-sample/`, `src/cli.ts` is where it gets built, and `AGENTS.md` says which agent may touch which file.

Teaching line: the last command prints `not implemented`. That is the job.

**You should see:** `01-starter-installed.webp`. The PowerShell pane: the Starter commit, the install summary, then `not implemented`. The project is selected in the rail.

**Must match**

- `git commit` prints `Starter` as the message.
- The last line is `not implemented`.

**May differ**

- The package count from `npm install`, and install timings.

### 2. Launch the Tri-Agent Council

**Do**

1. In the rail, point at the PowerShell terminal's row and click its **×** (Close terminal). The Council brings its own shell, so this one isn't needed.
2. Press `Ctrl+B S` to open the Swarm Launcher.
3. Select the **Tri-Agent Council** card.
4. Click **Launch Swarm Now**.

Teaching line: with the PowerShell terminal closed, `Ctrl+B 1` to `Ctrl+B 4` match the four panes: `planner-agent`, `builder-agent`, `verifier-agent`, `terminal-shell`.

**You should see:** `02-council-launched.webp`. A 2x2 grid: `planner-agent` top-left, `builder-agent` top-right, `verifier-agent` bottom-left, `terminal-shell` bottom-right with a PowerShell prompt. Each agent has confirmed its role and is waiting.

**Must match**

- The pane names and positions above, and four terminals in the rail.
- Each agent's first reply names its role (Council Planner, Council Builder, Council Verifier) and says it is waiting for a task.

**May differ**

- The exact wording of each confirmation.

**If not:** a pane shows a plugin hint. Install the `event-bridge` plugin from the Before-you-start page, then relaunch.

**If not:** the rail lists five terminals, the PowerShell one from step 1 first. Every `Ctrl+B` number on this page is then one off. Close that terminal as in Do 1.

### 3. Brief the Planner

**Paste into `planner-agent`**

> Read SPEC.md and AGENTS.md, then write PLAN.md: the functions src/cli.ts needs and the order to build them, and the test cases test/cli.test.ts should hold, each tied to one rule in SPEC.md. Create or edit no other file. End your reply with the line PLAN.md written.

**You should see:** `03-plan-written.webp`. The Planner idle with a short summary ending `PLAN.md written`; the other two agents still waiting.

**Must match**

- The Planner's last line is `PLAN.md written`.
- Press `Ctrl+B 4` and run `git status --short` in `terminal-shell`: the only line is `?? PLAN.md`.

**May differ**

- The plan's length and how it names the functions.

**If not:** `git status` lists a file under `src/` or `test/`. Paste into `planner-agent`: "Undo your changes outside PLAN.md with git checkout -- src test and keep only PLAN.md."

### 4. Brief the Builder

The plan travels on disk: the Planner wrote `PLAN.md`, and the Builder reads it. Your brief only has to point at it.

**Do**

1. Press `Ctrl+B 2` to focus `builder-agent`.

**Paste into `builder-agent`**

> Read PLAN.md, SPEC.md and AGENTS.md, then build the plan: replace every it.todo in test/cli.test.ts with a real test and implement src/cli.ts until npm test and npm run typecheck both pass. Edit nothing outside src/ and test/. End your reply with the line npm test passing.

Teaching line: while it works, `Ctrl+B Z` zooms the pane so you can read along, and `Ctrl+B Z` again returns to the grid. Expect 5 to 15 minutes.

**You should see:** `04-builder-done.webp`. The Builder idle with its summary: tests written, `npm test` passing, typecheck clean.

**Must match**

- The Builder's last line is `npm test passing`.
- Every file it created or edited is under `src/` or `test/`.
- The badge on `builder-agent` says Idle.

**May differ**

- How long it takes, how many tests it wrote, and whether it split `src/cli.ts` into more files.

**If not:** the Builder says a test still fails after several attempts. Paste into `builder-agent`: "Run npm test, read the first failing assertion against the rule it cites in SPEC.md, and fix the code until it passes. Do not change SPEC.md or docs-sample."

**If not:** the Builder edited `docs-sample/` or `SPEC.md`. Paste into `builder-agent`: "Run git checkout -- docs-sample SPEC.md to undo your changes there and finish inside src/ and test/ only."

### 5. Ask the Verifier

**Do**

1. Press `Ctrl+B 3` to focus `verifier-agent`.

**Paste into `verifier-agent`**

> Run node src/cli.ts docs-sample and compare its stdout and exit code with the expected output at the end of SPEC.md, line for line. Then run npm test and npm run typecheck. Report what you ran and anything that differed, and end with one line: VERIFIED or REJECTED. Edit no file.

**You should see:** `05-verified.webp`. The Verifier zoomed: the three broken-link lines, the summary line, the test and typecheck results, and `VERIFIED` as the last line.

**Must match**

- The Verifier's last line is `VERIFIED`.
- Its report quotes the summary line from the end of `SPEC.md` and exit code 1.

**May differ**

- How the Verifier lays out its report and whether it re-reads `SPEC.md` first.

**If not:** the last line is `REJECTED`. Press `Ctrl+B 2` and paste into `builder-agent`: "verifier-agent rejected the build. Fix src/cli.ts until node src/cli.ts docs-sample matches the expected output in SPEC.md exactly, then end with npm test passing. The report: <paste the Verifier's report>". When the Builder is done, run this step once more.

**If not:** the Verifier says `REJECTED` a second time. Stop the loop here and go on to step 6. The check there runs the same comparison in front of you, and its If not covers what is still wrong.

### 6. Check it worked

**Do**

1. Download `tri-agent-council-check.zip` from this page and unzip it into the project folder, so it creates `check/` beside `src/`.
2. Press `Ctrl+B 4` to focus `terminal-shell`.

**Paste into `terminal-shell`**

> node src/cli.ts docs-sample; "exit $LASTEXITCODE"; npx vitest run check; git status --short

Teaching line: you have the Verifier's word for the first command. Now you see it yourself, then run tests no agent has seen.

**You should see:** `06-check-passed.webp`. The `terminal-shell` pane: the three broken-link lines and the summary line, `exit 1`, Vitest with 3 passed, and a short `git status`.

**Must match**

- The CLI's lines equal the expected output at the end of `SPEC.md`, line numbers and link count included, in that order.
- `exit 1`.
- `npx vitest run check` ends with `3 passed` and no failures.
- `git status --short` lists `PLAN.md`, changes under `src/` and `test/`, and the untracked `check/`, and nothing else.

**May differ**

- Test timings.

**If not:** the CLI's lines differ from `SPEC.md`. Press `Ctrl+B 2` and paste into `builder-agent`: "node src/cli.ts docs-sample does not match the expected output at the end of SPEC.md. Fix src/cli.ts until it matches exactly, then end with npm test passing." Then run the paste above again.

**If not:** a check test fails. Press `Ctrl+B 2` and paste into `builder-agent`: "A test in check/cli.check.test.ts fails. Read it, read the rule it cites in SPEC.md, and fix src/cli.ts until npx vitest run check passes. Do not edit check/." Then run the paste above again.

**You're done when**

- `node src/cli.ts docs-sample` prints exactly the expected output at the end of `SPEC.md` and exits 1.
- `npx vitest run check` passes, 3 tests.
- `git status --short` shows `PLAN.md`, changes under `src/` and `test/`, and the untracked `check/`, and nothing else.

**Next up:** Swarm 9, Polyglot Trio.

## Screenshot list

All full-window captures of Quay unless noted. Names are the step markers.

| File | Shows | Must-match anchors |
| --- | --- | --- |
| `01-starter-installed.webp` | PowerShell pane after the step 1 paste, project in the rail | `Starter`, `not implemented` |
| `02-council-launched.webp` | 2x2 grid, three role confirmations, shell prompt, four terminals in the rail | pane names, "Council Planner", "Council Builder", "Council Verifier" |
| `03-plan-written.webp` | Planner idle with summary, others waiting | `PLAN.md written` |
| `04-builder-done.webp` | Builder summary | `npm test passing`, Idle badge |
| `05-verified.webp` | Verifier zoomed, report | the `SPEC.md` summary line, `VERIFIED` |
| `06-check-passed.webp` | `terminal-shell` pane (pane crop): CLI report, exit code, check suite, git status | the three target strings, the summary line, `exit 1`, `3 passed` |

No clip. Every step shows a result rather than a sequence, and Swarm 1 already has the launch clip.

Fixture recording: one whole run, five terminals (the step 1 PowerShell cast, three Claude casts plus bridge logs for their badges, one `terminal-shell` cast), markers 01 to 06. No `quay_*` call crosses the bridge.

## Decisions

Settled with the maintainer on 2026-10-19 against the draft's open questions.

1. **The learner pastes every handoff.** No bus message: `PLAN.md` carries the plan from the Planner to the Builder on disk, and the learner pastes the Builder's brief. Swarm 2, 5 and 6 keep the bus out the same way, and `quay_send_message` is A2A 1's to introduce. The draft's steps 4 and 5 merge into one Brief the Builder card.
2. **No clip.** The draft's clip was the bus handoff, which is gone, and nothing else here is a sequence a still can't show.
3. **Step 1 runs inside Quay** with the standard `git init -b main` line, the pattern the Swarm 2 outline proposed and Swarm 3, 5 and 6 and A2A 1 and 2 follow, so it can be captured. Step 2 then closes that PowerShell terminal from the rail before the launch, so the grid is `Ctrl+B 1` to `4`.
4. **Full `SPEC.md`, and `docs-sample/` exercises every rule the check suite tests.** The check suite tests the same rules on new files, so a build the Verifier passes normally passes the check, and the check still catches a Builder that hard-coded `docs-sample/`.
5. **The learner's own CLI run is folded into the check-it-worked step**, one paste with the check suite and `git status`. Six step cards.
6. **`REJECTED` gets one retry**, as in Swarm 5. A second `REJECTED` goes on to the check step.
7. **Level Intermediate**, matching Swarm 5 and 6.
8. **New fix-first item: the rail's Close terminal button gets an accessible name and shows on keyboard focus.** Today it is an icon-only × with a `title` and no `aria-label`, invisible until the row is hovered. It gets `aria-label` "Close terminal <name>" and appears on `focus-visible` as well as hover. No new shortcut.

Also folded in: the report's line numbers and link count are Must match, because `SPEC.md` fixes the exact output; the role prompts carry the shared teammate clause from the A2A 3 outline and the Planner's handoff clause is gone; Before you start says the plugin is needed for the status badges. Already settled elsewhere: the slug `tri-agent-council` from the page-template table, and the preset as coded (three Claude agents and a PowerShell `terminal-shell`, CLI default model).

Facts checked in the code: `Ctrl+B` plus a number selects by position in the project's visible terminal list, so closing the step 1 terminal makes the grid 1 to 4; their order relies on the terminal-order fix already on the fix-first list. `Ctrl+B X` unsplits the stage and does not close a terminal. Closing from the rail kills the terminal and removes it from the list without a confirmation, while a shell that exits stays listed as exited.

Per-agent worktrees are not needed: the three agents run one at a time and own disjoint paths.
