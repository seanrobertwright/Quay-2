# Outline: Swarm 5, Bug Hunt

Prototype outline for [Tutorial outline: Swarm 5, Bug Hunt](https://github.com/seanrobertwright/Quay-2/issues/20).
Accepted by the maintainer on 2026-10-19, with the decisions at the end folded in. Not the tutorial: the page is written after the fix-first work.

Slug `bug-hunt`. Page `docs/tutorials/swarm/bug-hunt/index.md`. Starter `examples/tutorials/bug-hunt/starter/`. Check suite `examples/tutorials/bug-hunt/check/`, packed as `bug-hunt-check.zip`.

This tutorial describes the app after the fix-first work: the **Bug Hunter** built-in preset (id `bug-hunter`) from the docs-drift decision, launched with the role prompts from the launch-prompt decision. Neither exists in code on master today.

## The page, top to bottom

**Title:** Swarm 5: Bug Hunt

**Pitch:** A shopping-cart library ships with a bug report naming three things that go wrong. Four Claude Code agents take it in turns: `reproducer` turns each complaint into a failing test, `tracer` finds the cause, `patcher` fixes it, `verifier` checks the fix. You hand the report over, drive each handoff, then run a check suite none of the agents has seen.

**Tiles:** Time and Tokens are generated from test runs. Agents: 4 × Claude. Level: Intermediate.

**You'll learn:** the Bug Hunter preset, giving four agents one job each in a fixed order, handing work between panes through files the agents write, reading a verdict you can check, and proving a fix with tests the agents never saw.

**Before you start** (all on the shared Before-you-start page, linked):

- Quay 2 installed.
- Claude Code 2.1.296 or later, signed in.
- The `event-bridge` plugin installed (the pane status badges this tutorial reads come from it).
- Node 24 or later, Git, PowerShell 7.
- The starter project, because the agents run in Skip mode and edit files without asking.

Note for the page: the preset sets no `custom_flags`, so all four agents run on the CLI's default model, and the launcher spawns them in Skip mode (the backend's default when no permission mode is sent).

## The starter project

A small cart-pricing library with a one-file CLI that prints a receipt. The three bugs are already in `src/cart.ts`; the visible tests pass because none of them reaches a bug. The bug report describes symptoms, never locations.

```text
starter/
  package.json          name bug-hunt, "type": "module", "engines": { "node": ">=24" }, exact versions
  package-lock.json
  tsconfig.json         strict, erasableSyntaxOnly, noEmit, module/moduleResolution nodenext,
                        allowImportingTsExtensions, types node
  .gitignore            node_modules/
  README.md             the goal in two sentences; points at AGENTS.md and BUG-REPORT.md
  AGENTS.md             goal, behaviour rules, commands, house rules (see below)
  CLAUDE.md             @AGENTS.md
  BUG-REPORT.md         three complaints from a user, each with the command that shows it (see below)
  src/cart.ts           the library: addItem, removeItem, applyCoupon, subtotal, discount, total, formatReceipt
  src/cli.ts            node src/cli.ts <cart.json>: replays a cart file's operations, prints the receipt
  carts/three-mugs.json add 3 × mug at 20.00, 10% coupon
  carts/double-mug.json add mug, add mug again
  carts/typo-remove.json
                        add mug, add tote, remove "toet"
  test/cart.test.ts     seven visible tests, all green on the planted code
```

**Types and signatures** (`src/cart.ts`), kept unchanged by every agent:

```ts
export type Item = { sku: string; name: string; priceCents: number; quantity: number };
export type Coupon = { kind: "percent"; value: number } | { kind: "fixed"; valueCents: number };
export type Cart = { items: Item[]; coupon?: Coupon };
export function addItem(cart: Cart, item: Item): Cart
export function removeItem(cart: Cart, sku: string): Cart
export function applyCoupon(cart: Cart, coupon: Coupon): Cart
export function subtotal(cart: Cart): number   // cents
export function discount(cart: Cart): number   // cents
export function total(cart: Cart): number      // cents, never below 0
export function formatReceipt(cart: Cart): string
```

Money is whole cents everywhere, so there is no floating-point story to distract from the three bugs.

**Scripts.**

| Script | Runs | Who uses it |
| --- | --- | --- |
| `npm test` | `vitest run` | every agent, and the learner in steps 1 and 7 |
| `npm run typecheck` | `tsc --noEmit` | patcher, verifier, the learner at the end |
| `npm run receipt -- carts/<file>.json` | `node src/cli.ts` | reproducer, to see each symptom; the learner if curious |

**Dependencies:** dev only: `vitest`, `typescript`, `@types/node`. Nothing at runtime.

**The three planted bugs.** Named here for the outline and the check suite; the page never names them and the bug report never locates them.

| Bug | Symptom in the report | What the check suite asserts |
| --- | --- | --- |
| Coupon ignores quantity | "10% off three 20.00 mugs took 2.00 off, not 6.00" (`three-mugs.json` prints Total 58.00) | `discount` of 10% on 3 × 2000 is 600; the receipt for `three-mugs.json` ends with Total 54.00 |
| Duplicate lines | "I added the same mug twice and the receipt lists it on two lines instead of x2" (`double-mug.json`) | adding an existing SKU gives one line with `quantity` 2 |
| Removing a missing SKU deletes the last line | "I mistyped a SKU when removing and my tote vanished" (`typo-remove.json` prints a receipt with only the mug) | `removeItem` with an unknown SKU returns the cart unchanged |

The causes, for whoever builds the starter: percent discount computed on `priceCents` instead of `priceCents * quantity`; `addItem` always pushes a new line; `removeItem` splices at `findIndex`'s `-1`.

**The visible tests (`test/cart.test.ts`).** Seven tests that cover every exported function with inputs that miss the bugs, so the suite is honest but incomplete: add one item; add two different SKUs; remove an existing SKU; 10% coupon on one item; fixed coupon; total never below zero; receipt has one line per item plus a Total line.

**The bug report (`BUG-REPORT.md`).** Three sections, each headed by the complaint in the user's words, with "What I did" (the `npm run receipt` command and the cart file), "What I saw" (the printed receipt) and "What I expected". No file names, no function names.

**The check suite (`check/cart.check.test.ts`).** Six tests the agents never see: the three regression tests in the table above, the receipt check for `three-mugs.json`, and two guards that the fixes broke nothing (removing an existing SKU still removes only that line; a 10% coupon on quantity 1 still discounts correctly). It imports from `../src/cart.ts` and is run with `npx vitest run check` after the zip is unpacked beside `src/`.

**CI expected state:** `npm ci` and `npx tsc --noEmit` pass; `npm test` is green (7 tests); the check suite run against the unfixed starter fails 4 of 6. This is the case the starter decision already names for the starters CI job.

**`AGENTS.md`**, in full-ish:

- Goal: a cart-pricing library and receipt CLI. `BUG-REPORT.md` lists three things users have seen go wrong.
- Behaviour: money is whole cents; adding a SKU already in the cart raises its quantity; removing a SKU not in the cart changes nothing; a percent coupon applies to the subtotal; the total never drops below zero.
- Commands: `npm test`, `npm run typecheck`, `npm run receipt -- carts/<file>.json`.
- House rules: npm only, no new dependencies, no `enum` or `namespace`, keep every exported signature in `src/cart.ts` unchanged, never change or delete an existing test.
- Check suite: held back until the agents are done, so it is not in the folder and needs no rule.

## What the Bug Hunter role prompts must make true

Input to the launch-prompt fix, where the four texts are written. Grid order is spawn order, read left to right then top to bottom: `reproducer` top-left, `tracer` top-right, `patcher` bottom-left, `verifier` bottom-right.

- **reproducer** edits only `test/`; never `src/`. Its tests must fail on the current code and show the symptom as reported.
- **tracer** edits nothing under `src/` or `test/`; it writes `TRACE.md` only.
- **patcher** edits only `src/`; never `test/`. Smallest change that makes `npm test` pass.
- **verifier** edits nothing; it writes `VERDICT.md` only and runs the commands itself rather than trusting the patcher's report.
- All four read `AGENTS.md` before their first action and wait for the user between tasks. They carry the shared teammate clause from the A2A 3 outline (act on a teammate's message as on the user's; message a teammate only when the user, `AGENTS.md` or a teammate's message asks). No prompt on this page asks anyone to message, so the learner drives every handoff.
- Each role ends its task reply with a fixed last line so Must match can check it: `REPRODUCED <n>`, `TRACED <n>`, `PATCHED`, and `VERIFIED` or `REJECTED`. Fixed Paste prompts can't carry run-specific text, so the handoff travels in files the agents write, not in what the learner relays.

## Steps

### 1. Get the starter project

**Do**

1. Download `bug-hunt.zip` from this page and unzip it into a new, empty folder, for example `C:\tutorials\bug-hunt`.
2. In Quay, click **Add Project Workspace** in the rail and pick that folder.
3. Press `Ctrl+B N` and choose **PowerShell**.

**Paste into the PowerShell pane**

> git init -b main; git add -A; git commit -m Starter; npm install; npm test

One sentence on the files: `src/cart.ts` is the library, `BUG-REPORT.md` is what users have seen go wrong, `carts/` holds the carts the report refers to, and `test/` is the suite that passes anyway.

**You should see:** `01-starter-tests-green.webp`. The PowerShell pane after `npm test`: 7 tests passed, with the project selected in the rail.

**Must match**

- `git commit` prints `Starter` as the message.
- `npm test` ends with `7 passed`.

**May differ**

- The package count from `npm install`, and the test timings.

Teaching line: the tests are green and the bugs are still there. That is the point of the check suite at the end.

### 2. Launch the Bug Hunter

**Do**

1. Press `Ctrl+B S` to open the Swarm Launcher.
2. Select the **Bug Hunter** card. Its roster lists `reproducer`, `tracer`, `patcher` and `verifier`.
3. Click **Launch Swarm Now**.

Teaching line: the grid replaces the PowerShell pane on the stage, but that terminal is still running. `Ctrl+B 1` puts it into whichever cell has focus; you'll want it in step 7.

**You should see:** `02-bug-hunter-launched.webp`. A 2x2 grid: `reproducer` top-left, `tracer` top-right, `patcher` bottom-left, `verifier` bottom-right. Each has confirmed its role and is waiting.

**Must match**

- The four pane names, in that order.
- Each agent's first reply names its role (Reproducer, Tracer, Patcher, Verifier) and says it is waiting for a task.

**May differ**

- The exact wording of each confirmation.

**If not:** a pane shows a plugin hint. Install the `event-bridge` plugin from the Before-you-start page, then relaunch.

### 3. Hand the bug report to the reproducer

Focus is on `reproducer` after launch.

**Paste into `reproducer`**

> Read AGENTS.md and BUG-REPORT.md. For each of the three complaints, write one Vitest test in test/regressions.test.ts that fails on the current code and shows the symptom exactly as reported, using the carts in carts/ where they help. Do not change anything under src/ or the existing tests. Run npm test, confirm that exactly your three new tests fail, and end your reply with the line REPRODUCED 3.

**You should see:** `03-reproduced.webp`. The `reproducer` pane zoomed (`Ctrl+B Z`): a test run with 3 failed and 7 passed, then `REPRODUCED 3`.

**Must match**

- The test run reports 3 failed, 7 passed.
- The last line is `REPRODUCED 3`.
- The only new or changed file is `test/regressions.test.ts`.

**May differ**

- The test names and how each test sets up its cart.
- How many times the agent ran the receipt command first.

**If not:** the reproducer reports fewer than three failures. Paste into `reproducer`: "One of the complaints is not reproduced yet. Re-read BUG-REPORT.md, run the receipt command it gives, and write a test that fails the same way. End with REPRODUCED 3."

### 4. Hand the failing tests to the tracer

**Do**

1. Press `Ctrl+B Z` to leave zoom, then `Ctrl+B O` to move focus to `tracer`.

**Paste into `tracer`**

> Read BUG-REPORT.md and test/regressions.test.ts, then run npm test. For each failing test, find the code in src/ that causes it. Write TRACE.md with one section per failing test: the symptom, the function responsible, and the cause in two sentences. Do not change anything under src/ or test/. End your reply with the line TRACED 3.

**You should see:** `04-traced.webp`. The `tracer` pane: it has read the tests, run them, written `TRACE.md`, and ended with `TRACED 3`.

**Must match**

- `TRACE.md` exists with three sections, and together they name `addItem`, `removeItem` and the coupon discount.
- The last line is `TRACED 3`.
- `git status` shows `TRACE.md` as the only new file since step 3.

**May differ**

- The order of the sections and the wording of each cause.

### 5. Hand the trace to the patcher

**Do**

1. Press `Ctrl+B O` to move focus to `patcher`.

**Paste into `patcher`**

> Read TRACE.md and AGENTS.md. Fix the three causes in src/cart.ts with the smallest change that makes npm test pass. Do not change any file under test/, and keep every exported signature in src/cart.ts as it is. Run npm test and npm run typecheck, and when both pass end your reply with the line PATCHED.

**You should see:** `05-patched.webp`. The `patcher` pane: a test run with 10 passed, a clean typecheck, then `PATCHED`.

**Must match**

- The test run reports 10 passed, 0 failed.
- The last line is `PATCHED`.
- Every edit is in `src/cart.ts`.

**May differ**

- How each fix is written, and how many runs it took.

**If not:** the patcher says a test still fails after several attempts. Paste into `patcher`: "Run npm test, read the failing assertion and the matching section of TRACE.md, and fix src/cart.ts until it passes. Do not change the tests."

**If not:** the patcher edited a test. Paste into `patcher`: "Run git checkout -- test to undo your changes there, then make npm test pass by changing src/cart.ts only."

### 6. Ask the verifier for a verdict

**Do**

1. Press `Ctrl+B O` to move focus to `verifier`.

**Paste into `verifier`**

> Run npm test and npm run typecheck yourself, then read git diff, BUG-REPORT.md and TRACE.md. Check that every change is under src/, that no test was changed or weakened, that each of the three complaints is fixed by the diff, and that nothing unrelated changed. Write VERDICT.md with your findings. If everything holds, end your reply with the line VERIFIED; otherwise list what is wrong in VERDICT.md and end with the line REJECTED.

**You should see:** `06-verified.webp`. The `verifier` pane zoomed: its own test run, the diff review, and `VERIFIED`.

**Must match**

- The verifier ran `npm test` itself and reports 10 passed.
- The last line is `VERIFIED`.

**May differ**

- How the verifier phrases its review, and how much of the diff it quotes.

**If not:** the last line is `REJECTED`. Press `Ctrl+B O` until `patcher` is focused and paste into `patcher`: "Read VERDICT.md and fix every item it lists, changing src/cart.ts only. Run npm test and npm run typecheck, then end with PATCHED." Then repeat this step once.

**If not:** the verifier says `REJECTED` a second time. Stop the loop here. Open `VERDICT.md`, make the fix it asks for in `src/cart.ts` yourself in the `patcher` pane (or ask `patcher` for the exact edit and apply it), run `npm test` and `npm run typecheck` by hand, and go on to step 7. The check suite there is the final word, not the verifier.

### 7. Check it worked

The agents are done. Now run the tests they never saw.

**Do**

1. With `verifier` still focused, press `Ctrl+B 1`. The PowerShell pane from step 1 takes the bottom-right cell; `verifier` keeps running behind it.
2. Download `bug-hunt-check.zip` from this page and unzip it into the project folder, so `check/` sits beside `src/`.

**Paste into the PowerShell pane**

> npx vitest run check; npm run typecheck; git status --short

**You should see:** `07-check-passed.webp`. The PowerShell pane in the bottom-right cell: the check suite with 6 passed, a clean typecheck, and a short `git status`.

**Must match**

- `vitest run check` ends with `6 passed`.
- `git status --short` lists `src/cart.ts` as modified and `test/regressions.test.ts`, `TRACE.md`, `VERDICT.md` and `check/` as new. Nothing else.

**May differ**

- Test timings.

**If not:** a check test fails. The patch covered the reproducer's tests but not the behaviour behind them. Press `Ctrl+B O` until `patcher` (bottom-left) is focused, then paste into `patcher`: "The check suite in check/ now exists and has failures. Run npx vitest run check, fix src/cart.ts until it passes without changing any test, and end with PATCHED." Then run the Paste above again.

**You're done when**

- `npx vitest run check` passes, 6 tests.
- `npm test` passes, 10 tests.
- `npm run typecheck` is clean.
- `git status` shows the only change under `src/` is `src/cart.ts`.

**Next up:** Swarm 6, Red Team / Blue Team.

## Screenshot list

All full-window captures of Quay unless noted. Names are the step markers.

| File | Shows | Must-match anchors |
| --- | --- | --- |
| `01-starter-tests-green.webp` | PowerShell pane after `npm test`, project in the rail | `7 passed`, project name |
| `02-bug-hunter-launched.webp` | 2x2 grid, four role confirmations | the four pane names, "Reproducer", "Tracer", "Patcher", "Verifier" |
| `03-reproduced.webp` | `reproducer` zoomed, failing run | `3 failed`, `7 passed`, `REPRODUCED 3` |
| `04-traced.webp` | `tracer` pane in the grid, `TRACE.md` written | `TRACED 3` |
| `05-patched.webp` | `patcher` pane in the grid, green run | `10 passed`, `PATCHED` |
| `06-verified.webp` | `verifier` zoomed, review and verdict | `10 passed`, `VERIFIED` |
| `07-check-passed.webp` | PowerShell pane in the bottom-right cell, check suite and status (pane crop) | `6 passed`, the `git status` lines |

No clip. The only Quay motion under ten seconds is the four panes filling the grid at launch, and Swarm 1's step 2 is already the launch clip; each handoff here takes minutes.

## Decisions

Settled with the maintainer on 2026-10-19 against the draft's open questions.

1. **The learner drives every handoff.** One fixed paste per agent, in order, so every Must match is a line the learner reads. The bus is taught from A2A 1 onward, and each stage here outlasts a 60-second reply anyway.
2. **Files are the handoff medium.** `test/regressions.test.ts`, `TRACE.md` and `VERDICT.md` are written by one agent and read by the next, which keeps the pastes fixed, leaves evidence on disk for Must match, and gives the verifier something to reject into.
3. **The check suite is a `check/` folder beside `src/`,** run with `npx vitest run check`, so the reproducer's tests survive and `npm test` (10) and the check suite (6) are both evidence at step 7.
4. **Seven visible tests, one per export,** green on the planted code. A thin but honest suite that makes step 1's "green but buggy" line land.
5. **`REJECTED` gets one retry.** The first If not sends `VERDICT.md` back to `patcher` and repeats step 6 once; a second `REJECTED` stops the loop and the learner finishes by hand before step 7, so a test run always ends.
6. **No clip.** Swarm 1 has the launch clip.
7. **Confirmed by Swarm 1's outline:** swarm launches omit the permission mode and the backend defaults to Skip; terminal order and swallowing the `Ctrl+B` prefix are already fix-first, so `Ctrl+B 1` reaches the PowerShell pane in step 7.
8. **Level Intermediate.** Four agents, five handoffs, a verdict to read and possibly act on, a check suite; nothing runs in parallel and every prompt is pasted.

Also folded in from decisions since the draft: `git init -b main` opens the step 1 paste, as every tutorial's does since the Swarm 10 outline, and the role prompts carry the shared teammate clause from the A2A 3 outline.

Per-agent worktrees are not needed: the four agents run one at a time and own disjoint paths (`test/`, `TRACE.md`, `src/`, `VERDICT.md`).
