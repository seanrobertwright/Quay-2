# Outline: Swarm 7, JS to TypeScript migration

Prototype outline for [Tutorial outline: Swarm 7, JS to TypeScript migration](https://github.com/seanrobertwright/Quay-2/issues/22).
Follows the step-card template from "Prototype: Tutorial page template". The maintainer reacted to the first
draft; the answers are in "Decided with the maintainer" at the end, and this text is the handoff for writing
the tutorial.

Slug `js-to-typescript` (fixed by the page-template decision's slug table). Page `docs/tutorials/swarm/js-to-typescript/index.md`. Starter `examples/tutorials/js-to-typescript/starter/`.

## The page, top to bottom

**Title:** Swarm 7: JS to TypeScript migration

**Pitch:** Three Claude Code agents convert one small JavaScript project to TypeScript at the same time, one folder each, while a PowerShell pane runs `tsc --watch` as the whole team's gauge. You build the swarm, brief the agents, watch the error count fall from 24 to 0, and prove the tests still pass.

**Tiles:** Time and Tokens are generated from test runs. Agents: 3 x Claude + 1 PowerShell shell. Level: Intermediate.

**You'll learn:** building a custom swarm for a specific job with a role prompt per agent (your second time through the builder, after Swarm 4), giving each agent one folder and a frozen test suite as the contract, using a shell pane as the swarm's shared gauge, and jumping between terminals with `Ctrl+B 1` to `Ctrl+B 5`.

**Builds on:** Swarm 4 (the custom swarm builder) and Swarm 1 (reading a watcher pane).

**Before you start** (all on the shared Before-you-start page, linked): Quay installed; Claude Code 2.1.296 or later, signed in; the `event-bridge` plugin 0.1.0 or later; Node 24 or later, Git, PowerShell 7. Nothing extra for this tutorial.

## The starter project

A working command-line tool, `receipt`, in plain JavaScript. It reads a shopping-list file and prints a receipt with a total. It is written in three folders of similar size that import each other through one barrel file each, so the only shared seam is two import lines in `src/cli/`. The tests are already TypeScript and are frozen.

```text
starter/
  package.json          name js-to-typescript, "type": "module", "engines": { "node": ">=24" }, exact versions
  package-lock.json
  tsconfig.json         strict, allowJs, checkJs, noEmit, module and moduleResolution nodenext,
                        erasableSyntaxOnly, allowImportingTsExtensions, include ["src"] only
  .gitignore            node_modules/
  README.md             the goal in a paragraph; points at AGENTS.md
  AGENTS.md             goal, commands, folder ownership, migration rules (see below)
  CLAUDE.md             @AGENTS.md
  samples/groceries.txt four lines: a # comment and 2 x Apples @ 0.40, 1 x Bread @ 2.25, 3 x Milk @ 1.10
  src/parse/index.js    barrel: export { parseLine, parseDocument }
  src/parse/line.js     "2 x Apples @ 0.40" -> { qty: 2, name: "Apples", unitPrice: 0.4 }, or null
  src/parse/document.js splits text into lines, skips blanks and # comments, returns { items, errors }
  src/format/index.js   barrel: export { formatMoney, renderReceipt }
  src/format/money.js   formatMoney(0.4) -> "0.40"; padLeft helper
  src/format/table.js   renderReceipt(items) -> aligned rows and a TOTAL line
  src/cli/index.js      barrel: export { run, parseArgs }
  src/cli/args.js       parseArgs(argv) -> { path, totalOnly } or a usage error
  src/cli/run.js        run(argv, io) -> exit code; io is { readFile, out }, so tests inject both
  src/cli/main.js       the bin: run(process.argv.slice(2), { readFile, out }) -> process.exitCode
  test/parse.test.ts    5 tests against src/parse/index.js
  test/format.test.ts   4 tests against src/format/index.js
  test/cli.test.ts      3 tests against src/cli/index.js, with an in-memory readFile and out
```

**Scripts.**

| Script | Runs | Who uses it |
| --- | --- | --- |
| `npm test` | `vitest run` | the agents when they think they're done, and the learner at the end |
| `npm run typecheck` | `tsc --noEmit` | the agents, one-off, and CI |
| `npm run typecheck:watch` | `tsc --noEmit --watch` | the learner, in the `tsc-watcher` pane |

No `start` script, because the bin's extension changes during the tutorial: `node src/cli/main.js samples/groceries.txt` on the starter, `node src/cli/main.ts samples/groceries.txt` when it's done. Node 24 runs the `.ts` directly, which is the proof at the end that nothing needs a build step.

**Dependencies:** dev only: `typescript`, `vitest`, `@types/node`. No runtime dependencies, nothing native.

**The starting error count.** The starter is written so that `tsc --noEmit` reports exactly 24 errors, 8 per folder: implicit-`any` parameters (TS7006), a `match[1]` used without a check (TS18048), an object property that doesn't exist on the inferred type (TS2339). The barrels report none. The migration drives the count to zero: renaming a file to `.ts` doesn't remove an error, adding the right type does.

**How renames meet the tests.** The tests are `.test.ts` from the start and import each folder's barrel by its `.js` name (`../src/parse/index.js`). TypeScript under `nodenext` and Vitest (for a TypeScript importer) both resolve that specifier to `index.ts` once the `.js` is gone, so the tests never change and run against the migrated modules. `tsconfig.json` includes only `src/`, so the watcher's count is the migration's count and the tests never add to it. Inside `src/`, imports of a renamed file switch to the `.ts` name (`allowImportingTsExtensions`), which is also what lets Node run the result directly. To confirm when the starter is built: Vitest resolving the tests' `.js` specifiers to the renamed `.ts` barrels.

**CI expected state:** `npm ci` passes; `vitest run` is green (12 tests); `npx tsc --noEmit` exits non-zero with a summary line that begins `Found 24 errors`. This starter is red on the type check by design and uses the starters CI job's per-starter expected state, as Swarm 3 and Swarm 4 do.

**No check suite.** The visible tests plus zero type errors are the check. There is nothing to hide from the agents: they must keep the tests green, and the type checker can't be gamed without `any` or `@ts-ignore`, which `AGENTS.md` forbids.

**`AGENTS.md`**, in full-ish:

- Goal: `receipt` prints a receipt for a shopping-list file. Convert it from JavaScript to TypeScript with no change in behaviour. Done when `npm run typecheck` reports zero errors and `npm test` passes.
- Commands: `npm test`, `npm run typecheck`, `node src/cli/main.js samples/groceries.txt` (`.ts` once renamed).
- Ownership: `parse-agent` edits only `src/parse/`. `format-agent` edits only `src/format/`. `cli-agent` edits only `src/cli/`. Nobody edits `test/`, `tsconfig.json`, `package.json` or `samples/`.
- The seam: you own the import lines in your folder. When a teammate renames a file you import, the type check reports a missing module against your file; change your import to the `.ts` name. Never fix an import in a teammate's folder.
- Migration rules: rename with `git mv`; keep every exported name and its behaviour, because the tests are frozen; add real types, no `any`, no `@ts-ignore`, no `@ts-expect-error`; don't loosen `tsconfig.json`.
- The watcher pane is the human's. Run `npm run typecheck` once when you think you're done; don't start your own watch.
- When your folder is done, end your turn with one last line: `DONE src/<your folder>/`.
- House rules: npm only, no new dependencies, no `enum` or `namespace`.

## Role prompts

Pasted into the builder's Role prompt box in step 2, one per Claude row, in the four slots the box shows as its placeholder. The three are the same shape; `cli-agent`'s carries the seam.

- **parse-agent:** `You are the Parse Migrator. You own src/parse/ and nothing else. You leave src/format/ and src/cli/ to format-agent and cli-agent, and you never touch test/, tsconfig.json or package.json. You work by reading AGENTS.md first, renaming with git mv, adding real types with no any or @ts-ignore, running npm run typecheck and npm test when you think you're done, and ending with the line DONE src/parse/.`
- **format-agent:** the same with `src/format/`, `Format Migrator`, teammates `parse-agent` and `cli-agent`, last line `DONE src/format/`.
- **cli-agent:** `You are the CLI Migrator. You own src/cli/ and nothing else, including its import lines. You leave src/parse/ and src/format/ to parse-agent and format-agent, and you never touch test/, tsconfig.json or package.json. You work by reading AGENTS.md first, renaming with git mv, pointing your imports at teammates' .ts files when npm run typecheck reports a missing module, using their exported types once they exist instead of inventing your own, adding real types with no any or @ts-ignore, running npm run typecheck and npm test when you think you're done, and ending with the line DONE src/cli/.`

## Steps

### 1. Get the starter project

- **Do:** the standard step 1, inside Quay. Download `js-to-typescript.zip` from this page and unzip it into a new folder. In Quay, click **+** beside **Projects** in the rail and add the folder. Press `Ctrl+B N`, choose **PowerShell Console**, name it `shell`, and click **Start Terminal**.
- **Paste into `shell`:** `git init -b main; git add -A; git commit -m Starter; npm install`
- **You should see:** `01-starter-installed`. The `shell` pane: git's first commit, then npm's install summary and the prompt back. One sentence on the files: `src/parse/`, `src/format/` and `src/cli/` are the three folders, one per agent; `test/` is frozen and is how each agent knows it broke nothing; `AGENTS.md` holds the rules every agent reads.
- **Must match:** one commit line from git; `npm install` ends without an error.
- **May differ:** install timings and package counts; npm's funding and audit lines.
- **If not: `npm install` says Node is too old.** Install Node 24 or later; check with `node --version`.

### 2. Build and launch the swarm

No built-in preset is "one agent per folder plus a shell", so you build one, the way Swarm 4 taught. This one isn't saved; nothing reuses it.

- **Do:**
  1. Press `Ctrl+B S` to open the Swarm Launcher, then click **Create Custom Swarm**.
  2. Swarm Name: `JS to TS`. Layout Arrangement: **2x2 Quad Grid**.
  3. Fill the four roster rows, adding rows with **Add Agent** (new rows default to Claude Code):

     | Row | Kind | Role / Title | session-name |
     | --- | --- | --- | --- |
     | 1 | Claude Code | Parse Migrator | `parse-agent` |
     | 2 | Claude Code | Format Migrator | `format-agent` |
     | 3 | Claude Code | CLI Migrator | `cli-agent` |
     | 4 | PowerShell | Type Watcher | `tsc-watcher` |

  4. Paste each Claude row's role prompt (above) into its **Role prompt** box.
  5. Click **Launch Swarm Now**.
- **Paste into Role prompt:** the three role prompts above, one per row, written `::: paste Role prompt`.
- **You should see:** `02-swarm-launched`. A 2x2 grid: three Claude Code panes that have each confirmed their role and folder in one line and are waiting, and a PowerShell prompt in the project folder at bottom-right. Teaching line: roster order is grid order, and `shell` from step 1 is still terminal 1, so `Ctrl+B 2` to `Ctrl+B 5` jump to `parse-agent`, `format-agent`, `cli-agent` and `tsc-watcher`, and `Ctrl+B 1` brings `shell` back (this relies on the fix-first change that keeps terminals in creation order).
- **Must match:** the four pane names, in grid order; each Claude pane's first line names its role (`Role: Parse Migrator`, `Role: Format Migrator`, `Role: CLI Migrator`) and its folder, and says it is waiting.
- **May differ:** the port number in the rail header; the wording of each agent's confirmation.
- **If not: a Claude pane shows the plugin hint.** Follow the hint's install line, then `/reload-plugins`.
- **If not: the roster already holds rows from a swarm built earlier.** Fill those rows instead, deleting any extra with the bin icon.

### 3. Start the type watcher

- **Do:** press `Ctrl+B 5` to focus `tsc-watcher`.
- **Paste into `tsc-watcher`:** `npm run typecheck:watch`
- **You should see:** `03-watcher-24-errors`. The watcher pane: 24 errors listed under `src/parse/`, `src/format/` and `src/cli/`, then `Found 24 errors. Watching for file changes.`
- **Must match:** `Found 24 errors. Watching for file changes.`
- **May differ:** the timestamps tsc prints.
- **If not: `tsc` is not recognized.** `npm install` didn't finish in step 1; run it again in this pane, then the paste again.

### 4. Brief parse-agent

- **Do:** press `Ctrl+B 2` to focus `parse-agent`.
- **Paste into `parse-agent`:** `Convert src/parse/ from JavaScript to TypeScript now, as your role says: git mv each .js file to .ts, add precise types, keep every exported name and behaviour the same so test/parse.test.ts keeps passing, and stop when npm run typecheck reports no errors under src/parse/ and npm test passes. End with DONE src/parse/.`
- **You should see:** `04-parse-working`. `parse-agent` reading `AGENTS.md` and renaming files; its badge shows Working. The watcher at bottom-right has re-run.
- **Must match:** the badge on `parse-agent` says Working; every file it renames or edits is under `src/parse/`.
- **May differ:** which file it starts with, how many tool calls, the count the watcher shows mid-way.

### 5. Brief format-agent

- **Do:** press `Ctrl+B 3` to focus `format-agent`. Don't wait for `parse-agent` to finish.
- **Paste into `format-agent`:** `Convert src/format/ from JavaScript to TypeScript now, as your role says: git mv each .js file to .ts, add precise types, keep every exported name and behaviour the same so test/format.test.ts keeps passing, and stop when npm run typecheck reports no errors under src/format/ and npm test passes. End with DONE src/format/.`
- **You should see:** `05-two-working`. Both top panes Working at the same time, the watcher re-running underneath.
- **Must match:** the badges on `parse-agent` and `format-agent` both say Working.
- **May differ:** which agent is further along.

### 6. Brief cli-agent

`src/cli/` imports the other two folders, so this agent's role prompt carries the seam, and its job reminds it.

- **Do:** press `Ctrl+B 4` to focus `cli-agent`.
- **Paste into `cli-agent`:** `Convert src/cli/ from JavaScript to TypeScript now, as your role says. parse-agent and format-agent are renaming src/parse/ and src/format/ right now: when npm run typecheck reports a missing module in src/cli/, point your import at the new .ts file, and use their exported types once they exist. Stop when npm run typecheck reports no errors under src/cli/ and npm test passes. End with DONE src/cli/.`
- **You should see:** `06-three-working`. All three Claude panes Working; the watcher shows a count that is lower than 24 but not yet 0.
- **Must match:** three Working badges; the watcher's current `Found N errors` line, with N below 24.
- **May differ:** N. It can rise for a moment when a rename lands before the import that points at it is fixed, or when a `.ts` file reveals a type `checkJs` had let through.
- **If not: `cli-agent` says it can't finish because `src/parse/` or `src/format/` has no types yet.** Paste into `cli-agent`: `Wait for parse-agent and format-agent to report DONE, then run npm run typecheck and finish src/cli/ against their types.`

### 7. Watch the count fall

- **Do:**
  1. Press `Ctrl+B 5` to focus `tsc-watcher`, then `Ctrl+B Z` to zoom it to the whole stage.
  2. Watch: each save by any agent re-runs the check and the `Found N errors` line changes.
  3. When it reads `Found 0 errors`, press `Ctrl+B Z` to return to the grid and wait for all three agents to print their `DONE` line.
- **You should see:** `07-zero-errors`, with the clip `07-zero-errors.mp4`: the watcher pane, the last re-run clearing the final errors and settling on `Found 0 errors. Watching for file changes.` The caption describes the motion: the error list vanishes and the count line turns to zero.
- **Must match:** `Found 0 errors. Watching for file changes.`; back in the grid, all three Claude badges say Idle and each pane ends with its `DONE src/<folder>/` line.
- **May differ:** how long it takes (expect 10 to 20 minutes) and which agent finishes first; the path of the count on the way down, which need not be monotonic; the agents' summaries, and whether one ran `npm test` more than once.
- **If not: the count is stuck above zero and all three agents are idle.** Zoom the watcher, read which folder the remaining errors are under, and paste into that folder's agent: `npm run typecheck still reports errors under src/<folder>/. Read them and fix them inside your folder only, without any or @ts-ignore, then end with your DONE line.`
- **If not: an agent changed a file outside its folder.** Paste into that agent: `You edited <path>, which isn't yours. Run git checkout -- <path> and finish inside your own folder only.`
- **If not: an agent used `any` or `@ts-ignore` to get to zero.** Paste into it: `Replace every any, @ts-ignore and @ts-expect-error in src/<folder>/ with a real type, and keep npm run typecheck at zero errors.`

### 8. Check it worked

The watcher keeps running; the check runs in the step 1 terminal.

- **Do:** press `Ctrl+B 1` to bring `shell` back.
- **Paste into `shell`:** `npm test; npm run typecheck; node src/cli/main.ts samples/groceries.txt; Get-ChildItem -Recurse src -Filter *.js; git status --short`
- **You should see:** `08-check`. The `shell` pane: `Tests  12 passed`, a silent `npm run typecheck`, the receipt with its `TOTAL` line, nothing from the `.js` listing, and a `git status` that lists only renames and edits under `src/`.
- **Must match:** `Tests  12 passed (12)`; `npm run typecheck` prints no errors; the receipt ends with a `TOTAL` line reading `6.35`; the `.js` listing prints nothing.
- **May differ:** test timings; whether `git status` shows the renames as `R` (staged by `git mv`) or as a delete plus an untracked `.ts`.
- **You're done when:**
  - `npm run typecheck` reports zero errors;
  - `npm test` passes, 12 tests;
  - no JavaScript is left under `src/`;
  - `node src/cli/main.ts samples/groceries.txt` prints the receipt with `TOTAL` `6.35`;
  - `git status` shows changes only under `src/`.

**Next up:** Swarm 8, Tri-Agent Council: plan, build, verify.

## Screenshot list

All full-window captures of Quay unless noted. Names are the step markers.

| File | Shows | Must-match anchors |
| --- | --- | --- |
| `01-starter-installed.webp` | `shell` pane after the paste | the commit line, the install summary |
| `02-swarm-launched.webp` | 2x2 grid, three role-and-folder confirmations, PowerShell prompt | four pane names, three `Role:` lines |
| `03-watcher-24-errors.webp` | Watcher after first run (pane crop) | `Found 24 errors. Watching for file changes.` |
| `04-parse-working.webp` | Top-left Working, others idle | Working badge on `parse-agent`, `src/parse/` paths |
| `05-two-working.webp` | Both top panes Working | two Working badges |
| `06-three-working.webp` | Three Working, watcher mid-count | three Working badges, `Found N errors` with N < 24 |
| `07-zero-errors.webp` | Watcher zoomed, zero errors; poster for the clip | `Found 0 errors. Watching for file changes.` |
| `08-check.webp` | `shell` pane after the checks (pane crop) | `12 passed`, `TOTAL` `6.35` |

**Clip:** `07-zero-errors.mp4`, the one clip for this tutorial. The watcher's final re-run: the error list clears and the count line goes to zero, at real speed, under ten seconds, trimmed to the last save. Terminal motion, so it depends on the timed replay the screenshot decision landed and the replay spike confirmed; fallback is the still.

## Code it depends on

- **Terminals kept in creation order** (screenshot fixtures decision), for the `Ctrl+B 1` to `5` mapping.
- **The launch prompt with role prompts** ([Decide: How do Swarm agents get their role prompt at launch?](https://github.com/seanrobertwright/Quay-2/issues/11)): the `Role:` first line, the authored role prompt, the team briefing, the Role prompt box with its four-slot placeholder, and new roster rows defaulting to Claude Code (Swarm 4).
- **The plugin hint** ([Decide: How does Quay show that the event-bridge plugin is missing?](https://github.com/seanrobertwright/Quay-2/issues/47)), step 2's If not.
- **Per-starter expected state in starters CI**, for a starter that is red on the type check.
- **The Paste slot's field form** (`::: paste Role prompt`), as A2A 1 allowed for Mission Control.

Verified in code: the builder's labels (Create Custom Swarm, Swarm Name, Layout Arrangement, 2x2 Quad Grid, Add Agent, Role / Title, session-name, Launch Swarm Now) and PowerShell as a roster kind, in `SwarmModal.tsx`; `Ctrl+B Z` toggles zoom and `Ctrl+B 1` to `9` focus the visible terminals in order, in `useWorkspace.ts`. Today the second default row is Antigravity and there is no Role prompt box; both change with the fixes above.

No new fix-first items.

## Decided with the maintainer

In the order the questions were put.

1. **A custom swarm, built in step 2.** No built-in is one agent per folder plus a shell, and TDD Swarm's role prompts would give `test-architect` the frozen `test/`. Builds on names Swarm 4.
2. **Three agents**, one folder each, filling the grid with the watcher.
3. **The watcher is a swarm row; the step 1 `shell` runs the final check.** Five terminals: `shell` at `Ctrl+B 1`, the grid at `Ctrl+B 2` to `5`. The watcher is never stopped.
4. **A four-slot role prompt per Claude row**, pasted into the builder, so each agent confirms its folder at launch and the step 2 screenshot shows the ownership. The step 4 to 6 pastes carry only the job.
5. **All three agents are briefed at once; transient red is May differ.** The seam sits on the importer. No pressure on the per-agent worktrees fog item: the frozen tests need all three folders in one tree.
6. **A fixed starting count of 24, asserted in starters CI.**
7. **`test/` stays out of tsconfig**, so the count is purely the migration's.
8. **Level Intermediate.**

Folded in from decisions since the draft: step 1 inside Quay with the standard line in a PowerShell Console pane; rows default to Claude Code; the Role prompt box's placeholder; the `Ctrl+B` digits shifted by the `shell` terminal; a fixed last line `DONE src/<folder>/` where the draft said "tell me when you're done".
