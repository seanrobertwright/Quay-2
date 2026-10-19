# Outline: Swarm 1, Your first swarm (Dev & Watcher)

Draft for [Tutorial outline: Swarm 1, Your first swarm (Dev & Watcher)](https://github.com/seanrobertwright/Quay-2/issues/16),
a prototype ticket on the Swarm and A2A tutorials map. Follows the step-card template from
"Prototype: Tutorial page template". Screenshot names are step markers, not numbers.

## Page head

- **Title:** Swarm 1: Your first swarm
- **Slug:** `first-swarm`. Page `docs/tutorials/swarm/first-swarm/index.md`, starter `examples/tutorials/first-swarm/starter/`.
- **Lead:** Launch Quay's Dev & Watcher preset: a Claude Code agent beside a PowerShell pane that
  runs your tests on every save. The agent builds a tip calculator while you watch the tests go green.
- **At a glance:** Time and Tokens generated from test runs. Agents: 1 x Claude + 1 shell. Level: Starter.
- **You'll learn:** the Swarm launcher (`Ctrl+B S`), the side-by-side split, cycling focus (`Ctrl+B O`)
  and zooming a pane (`Ctrl+B Z`).
- **Before you start:** the shared Before-you-start page (Quay installed; Claude Code 2.1.296+ signed in;
  `event-bridge` 0.1.0+; PowerShell 7; Node 24+, npm and Git). Nothing extra for this tutorial.

## Starter project: `first-swarm`

A TypeScript skeleton for a tip-calculator CLI, with its tests already written and failing.

```text
starter/
  package.json        name first-swarm; scripts: test = "vitest", test:once = "vitest run",
                      typecheck = "tsc --noEmit"; devDependencies pinned: vitest, typescript, @types/node
  package-lock.json
  tsconfig.json       erasableSyntaxOnly, module nodenext, strict, noEmit
  AGENTS.md           goal in one sentence; exact commands; house rules (npm only, no native deps,
                      no enum/namespace); "a watcher pane runs the tests, don't run them yourself"
  CLAUDE.md           @AGENTS.md
  README.md           the goal, and the CLI usage the tests expect
  src/tip.ts          exports calculateTip, calculateTotal, splitBill; each throws Error("not implemented")
  src/cli.ts          parses args, calls src/tip.ts, prints "Tip: $X.XX  Total: $Y.YY" and, with a third
                      argument, "Each: $Z.ZZ"; present and complete so the lesson is tip.ts only
  test/tip.test.ts    five Vitest tests, all failing against the stubs
```

The five tests:

1. `calculateTip(100, 15)` is `15`.
2. `calculateTip(42.5, 18)` is `7.65` (rounded to cents).
3. `calculateTotal(42.5, 18)` is `50.15`.
4. `splitBill(50.15, 3)` is `16.72` (rounded up so the bill is covered).
5. `calculateTip(-1, 15)` throws.

Starters CI expects: `npm ci` and `npx tsc --noEmit` clean, tests **red** (5 failing). No check suite.

## Steps

### 1. Get the starter project

- **Do:** the standard step 1: download `first-swarm.zip` from this page, unzip into a new folder,
  then in that folder run `git init`, commit everything as "Starter", run `npm install`.
  Then in Quay click **+** beside **Projects** in the rail, **Browse...** to the folder, add it.
- **You should see:** `project-added`. The project in the rail, empty stage with the
  "Press Ctrl+B N" placeholder.
- **If not: `npm install` says Node is too old.** Install Node 24 or later; `node --version`.

### 2. Launch the swarm

- **Do:** press `Ctrl+B S`. The Swarm Launcher opens with **Dev & Watcher** already selected.
  Click **Launch Swarm Now**.
- **You should see:** `swarm-launched`. Two panes side by side: `lead-dev` on the left, a
  Claude Code session that has confirmed its role in one line and is waiting; `build-watcher` on the
  right, a PowerShell prompt in the project folder. The rail lists both under the project.
  **Clip step:** the launcher closing and the two panes appearing (Quay's own motion; under ten seconds).
- **Must match:** two panes; the rail shows `lead-dev` and `build-watcher`; `lead-dev`'s first
  line reads `Role: Lead Developer`.
- **May differ:** the port number in the rail header; the exact wording of lead-dev's acknowledgement.
- **If not: lead-dev shows a permissions prompt instead of waiting.** The swarm launcher starts
  Claude agents in Skip mode. If you see a prompt, press Esc, close the pane and relaunch the swarm.
- **If not: lead-dev's status badge stays Unknown.** The `event-bridge` plugin isn't loaded; see Before you start.

### 3. Start the watcher

- **Do:** press `Ctrl+B O` to move focus to `build-watcher` (its border highlights).
- **Paste into `build-watcher`:** `npm test`
- **You should see:** `watcher-red`. Vitest in watch mode: 5 failed, in red, waiting for file changes.
- **Must match:** `Tests  5 failed`; the "Waiting for file changes" line.
- **May differ:** how long the first run takes.
- **If not: "vitest is not recognized".** `npm install` didn't finish in step 1; run it again in this pane, then `npm test`.

### 4. Give lead-dev the job

- **Do:** press `Ctrl+B O` to move focus back to `lead-dev`.
- **Paste into `lead-dev`:** `Implement src/tip.ts so every test in test/tip.test.ts passes. Don't run the tests yourself: the build-watcher pane is running them, and I'm watching it. Tell me when you believe they all pass.`
- **You should see:** `tests-green`. lead-dev's badge turns Working; the watcher re-runs on each
  save, then shows 5 passed in green; lead-dev reports done.
- **Must match:** `Tests  5 passed` in `build-watcher`; lead-dev's badge back to Idle.
- **May differ:** how many saves it takes; the agent's wording; how long it takes.
- **If not: lead-dev runs the tests itself anyway.** It still works; the lesson is just quieter.
  Tell it: `Thanks. From now on leave test runs to the watcher.`
- **If not: the watcher never re-runs.** Vitest only watches files under the project; check the
  edits landed in `src/tip.ts`, not a new file.

### 5. Zoom in on the result

- **Do:** press `Ctrl+B O` to focus `build-watcher`, then `Ctrl+B Z` to zoom it to the whole stage.
  Read the five green test names. Press `Ctrl+B Z` again to restore the split.
- **You should see:** `watcher-zoomed`. The watcher pane filling the stage, five passing tests listed.
- **Must match:** five test names with green ticks.
- **May differ:** timing figures.
- **If not: Ctrl+B Z did nothing.** The 1.5-second prefix window lapsed; press `Ctrl+B` then `Z` within a second.

### 6. Check it worked

- **Do:** in `build-watcher`, press `q` to stop the watcher, then run the CLI.
- **Paste into `build-watcher`:** `node src/cli.ts 42.50 18 3`
- **You should see:** `cli-output`. `Tip: $7.65  Total: $50.15  Each: $16.72` under the command.
- **Must match:** that output line.
- **You're done when:**
  - the watcher showed `Tests  5 passed`;
  - the CLI prints `Tip: $7.65  Total: $50.15  Each: $16.72`;
  - `git status` lists `src/tip.ts` as the only modified file.

## Next up

Swarm 2: TDD Swarm kata.

## Screenshot list (step markers)

| Marker | What | Scope |
| --- | --- | --- |
| `project-added` | rail with the project, empty stage | full window |
| `swarm-launched` | two panes after launch; the clip's poster | full window, plus clip |
| `watcher-red` | 5 failing tests in watch mode | `build-watcher` pane |
| `tests-green` | 5 passing tests beside lead-dev's report | full window |
| `watcher-zoomed` | zoomed watcher | full window |
| `cli-output` | CLI line after quitting the watcher | `build-watcher` pane |

## Code it depends on

- Launch prompt for swarm agents, so `lead-dev` opens with `Role: Lead Developer` (decided, fix-first).
- Terminal creation order kept, so `lead-dev` is always left (decided, fix-first).
- **New:** the `Ctrl+B` prefix keystroke is not swallowed: the window listener sets the prefix flag
  and returns without `preventDefault`, so xterm also sends it to the focused pane. Claude Code uses
  `Ctrl+B` to background a running task, so steps 4 and 5 can misfire. Proposed: swallow the prefix
  (tmux behaviour).
