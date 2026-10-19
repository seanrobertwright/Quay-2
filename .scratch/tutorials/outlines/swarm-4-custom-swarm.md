# Outline: Swarm 4, Build and save a custom swarm

Prototype outline for [Tutorial outline: Swarm 4, Build and save a custom swarm](https://github.com/seanrobertwright/Quay-2/issues/19).
Reviewed and accepted on the ticket. The decisions, and the fix they add, are at the end.

Slug `custom-swarm`. Page `docs/tutorials/swarm/custom-swarm/index.md`. Starter `examples/tutorials/custom-swarm/starter/`.

## The page, top to bottom

**Title:** Swarm 4: Build and save a custom swarm

**Pitch:** No built-in preset fits every job. You build your own two-agent "Docs Squad" in the custom swarm builder: `writer` drafts a README for a small CLI tool, `editor` checks every command in it against the code. You save the squad, quit Quay, start it again, and launch the same squad from the catalog.

**Tiles:** Time and Tokens are generated from test runs. Agents: 2 × Claude. Level: Starter.

**You'll learn:** the custom swarm builder (`Ctrl+B S`, Create Custom Swarm), naming agents and their sessions, writing a role prompt for each agent, saving a swarm so it survives a restart, and relaunching a saved swarm from the Preset Catalog.

**Before you start** (all on the shared Before-you-start page, linked):

- Quay 2 installed.
- Claude Code 2.1.296 or later, signed in.
- The `event-bridge` plugin installed (the pane status badges this tutorial reads come from it).
- Node 24 or later, Git, PowerShell 7.
- The starter project, because the agents run in Skip mode and edit files without asking.

Note for the page: this is the only tutorial in the series that teaches the builder. Every other Swarm tutorial launches a built-in preset, so the page can spend its words on the form.

## The starter project

A finished command-line tool with no README. The code is done, the tests pass, and the one thing missing is the document the squad writes. A visible README test tells the writer when it's done; the editor checks what a test can't, which is whether the words are true.

```text
starter/
  package.json          name tally, "type": "module", exact versions, "engines": { "node": ">=24" }
  package-lock.json
  tsconfig.json         strict, erasableSyntaxOnly, noEmit, module/moduleResolution nodenext, types node
  .gitignore            node_modules/
  LICENSE               MIT, so the README has a license to state
  README.md             the stub the squad replaces: one line, "# tally", and one line pointing at AGENTS.md for the goal
  AGENTS.md             goal, commands, README requirements, ownership, house rules (see below)
  CLAUDE.md             @AGENTS.md
  src/count.ts          export type Tally = { lines: number; words: number; chars: number }
                        export function tally(text: string): Tally
  src/cli.ts            parses --lines, --words, --chars, --json, --help and one or more file paths with node:util parseArgs,
                        prints one line per file (or one JSON object with --json), exits 1 on a missing file
  test/count.test.ts    four tests for tally(): empty string, one line, several lines, a word split across whitespace
  test/readme.test.ts   the README tests, see below
```

**Scripts.**

| Script | Runs | Who uses it |
| --- | --- | --- |
| `npm test` | `vitest run` | writer, editor, and the learner at the end |
| `npm run typecheck` | `tsc --noEmit` | nobody needs to; CI runs it |
| `npm start -- <options> <file...>` | `node src/cli.ts` | writer and editor, to get real example output |

**Dependencies:** none at runtime; dev: `vitest`, `typescript`, `@types/node`. The CLI uses only `node:fs` and `node:util`.

**The README tests (`test/readme.test.ts`).** Six tests the writer makes green. They read `README.md`, `package.json` and `src/cli.ts` and never run the CLI.

1. The first line is `# tally`.
2. It has the headings `## Install`, `## Usage`, `## Options`, `## Scripts` and `## License`, in that order.
3. Every option flag that `src/cli.ts` declares appears in the Options section.
4. Every script name in `package.json` appears in the Scripts section.
5. It contains no `TODO` or `TBD`.
6. It names the MIT license.

**CI expected state:** `npm ci` and `npx tsc --noEmit` pass; `npm test` is red on purpose (the four `tally()` tests pass, five of the six README tests fail against the stub). Like Swarm 3, this needs the starters CI job's per-starter expected state.

**`AGENTS.md`**, in full-ish:

- Goal: `tally` counts lines, words and characters in files. The code is finished. The work is `README.md`.
- Commands: `npm test`, `npm run typecheck`, `npm start -- [--lines] [--words] [--chars] [--json] <file...>`.
- README requirements: the five sections in order, every option and script documented, example output copied from a real run, no TODOs.
- Ownership: `writer` drafts `README.md`. `editor` edits `README.md` only after the writer says the draft is ready. Nobody edits `src/`, `test/`, `package.json` or `LICENSE`.
- House rules: npm only, no new dependencies, no `enum` or `namespace`.
- No check suite. The README tests are visible on purpose: they are the writer's definition of done. The editor checks accuracy and clarity, which tests can't.

## Steps

### 1. Get the starter project

**Do**

1. Download `custom-swarm.zip` from this page and unzip it into a new folder, for example `C:\tutorials\custom-swarm`.
2. In PowerShell, in that folder: `git init`, `git add -A`, `git commit -m "Starter"`, `npm install`.
3. In Quay, click **+** next to **Projects** in the rail and choose the folder.

One sentence on the files: `src/` is a finished CLI, `test/readme.test.ts` is how the writer knows the README is complete, and `README.md` is a stub waiting to be replaced.

**You should see:** `01-project-added.webp`. The starter project selected in the rail, empty stage.

### 2. Open the custom swarm builder

**Do**

1. Press `Ctrl+B S` to open the Swarm Launcher. It opens on the **Preset Catalog**: the seven built-in swarms, with a **Your swarms** group above them once you have saved one.
2. Click **Create Custom Swarm** in the bar under the title.
3. In **Swarm Name**, replace `Custom Swarm` with `Docs Squad`.
4. Leave **Layout Arrangement** on **Side-by-Side Split**.

Teaching line: the form below the name is the **Agents Roster**. It starts with two rows, both Claude Code, and every row is one terminal in the swarm: which CLI runs in it, the agent's role, the session name that labels its pane, and a **Role prompt** box whose placeholder names the four parts of a role prompt: who you are, what you own, what you leave to teammates, how you work.

**You should see:** `02-builder-open.webp`. The builder with `Docs Squad` in the name field and two default rows in the roster.

**Must match**

- The mode bar shows **Create Custom Swarm** selected.
- The roster has two rows and an **Add Agent** link.

### 3. Define the writer

**Do**

1. In the first row, keep the CLI on **Claude Code**.
2. Replace the role `Implementer` with `Technical Writer`.
3. Replace the session name `dev-agent` with `writer`.
4. Paste the role prompt into the row's **Role prompt** box. It follows the four parts in the placeholder's order.

**Paste into the first row's Role prompt**

> You are the Technical Writer. You own README.md and nothing else. You leave code changes to nobody: the code in this repo is finished, and if you find a bug you mention it in your reply instead of fixing it. You work by reading AGENTS.md, package.json and everything in src/ before you write, running the CLI to get real example output, documenting only what the code really does, and waiting for the user's task.

**You should see:** `03-writer-row.webp`. The first row reading Claude Code, Technical Writer, `writer`, with the role prompt filled in.

**Must match**

- The first row's session name is `writer`.

### 4. Define the editor

**Do**

1. In the second row, keep the CLI on **Claude Code**.
2. Replace the role `Architect` with `Docs Editor`.
3. Replace the session name `plan-agent` with `editor`.
4. Paste the role prompt into the row's **Role prompt** box.

**Paste into the second row's Role prompt**

> You are the Docs Editor. You own the final wording of README.md, and you may edit it directly once the Technical Writer says a draft is ready. You leave the first draft to the writer and never touch src/, test/ or package.json. You work by running every command and option the README shows and checking the output against src/cli.ts, fixing anything wrong or unclear in README.md, keeping npm test passing, and ending each review with a numbered list of your changes and the single word APPROVED on its own line.

Teaching line: the role prompt is what each agent reads first. Quay adds the rest of the launch prompt itself: a `Role:` line, a team briefing naming the other agent, and the instruction to confirm the role and wait.

**You should see:** `04-editor-row.webp`. Both rows complete: `writer` and `editor`, both Claude Code, both with a role prompt.

**Must match**

- The second row's session name is `editor`.
- The footer reads "Spawns 2 terminals".

### 5. Save and launch the squad

**Do**

1. Click **Save**.
2. Click **Launch Swarm Now**.

Teaching line: Save keeps Docs Squad as a card under **Your swarms** at the top of the Preset Catalog, on this machine, until you remove it. Saving again under the same name replaces the card. Launch starts the swarm on the stage.

**You should see:** `05-squad-launched.webp`. Two panes side by side: `writer` on the left, `editor` on the right. Each has confirmed its role and is waiting.

**Must match**

- The left pane is named `writer`, the right `editor`.
- Each agent's first reply names its role (Technical Writer, Docs Editor) and says it is waiting for a task.

**May differ**

- The exact wording of each confirmation.

**If not:** a pane shows a plugin hint. Install the `event-bridge` plugin from the Before-you-start page, then relaunch.

### 6. Brief the writer

**Paste into `writer`**

> Write README.md for this project from scratch, replacing the stub. Read AGENTS.md, package.json and everything in src/ first, run the CLI on LICENSE and on package.json to get real example output, and cover every section and option AGENTS.md lists. Keep going until npm test passes. Do not edit anything except README.md. Tell me when the draft is ready.

**You should see:** `06-writer-working.webp`. The writer reading `src/cli.ts`, running `npm start`, and writing `README.md`; its badge shows Working. The editor is idle.

**Must match**

- The badge on `writer` says Working.
- The only file it edits is `README.md`.
- When it finishes, it reports `npm test` passing, 10 tests.

**May differ**

- Which files it reads first, how many tool calls, how long it takes (expect 2 to 5 minutes).

**If not:** the writer says a README test still fails after several attempts. Paste into `writer`: "Run npm test, read the failing assertion in test/readme.test.ts, and fix README.md until it passes. Do not change the tests."

### 7. Brief the editor

**Do**

1. Wait for the writer to say the draft is ready.
2. Press `Ctrl+B O` to move focus to the right pane.

**Paste into `editor`**

> The writer says the README.md draft is ready. Run every command and option the README shows, check the output and the option descriptions against src/cli.ts and package.json, fix anything wrong or unclear directly in README.md, keep npm test passing, and reply with a numbered list of your changes ending with APPROVED on its own line.

**You should see:** `07-editor-approved.webp`. The editor's reply: a numbered list of changes and `APPROVED` as the last line. Both badges Idle.

**Must match**

- The editor's last line is `APPROVED`.
- The editor edited only `README.md`.

**May differ**

- How many changes it lists, and what they are. An empty list and `APPROVED` is a pass too.

**If not:** the editor describes problems but does not end with `APPROVED`. Paste into `editor`: "Fix those in README.md yourself, run npm test, and end your reply with APPROVED."

### 8. Quit and restart Quay

**Do**

1. Close Quay with the window's close button. Both agents stop with it.
2. Start Quay again from the Start menu.

Teaching line: terminals don't survive a restart; the project and the saved swarm do. Quay closes without asking, even with agents running.

**You should see:** `08-restarted.webp`. Quay open with the starter project still selected in the rail, and an empty stage.

**Must match**

- The project is in the rail.
- No panes on the stage.

**If not:** panes came back marked exited, each with a Relaunch button. Don't click Relaunch: a relaunched terminal gets no launch prompt, so the agent would start without its role. Close them and go on to the next step.

### 9. Relaunch the saved squad

**Do**

1. Press `Ctrl+B S`. The launcher opens on the Preset Catalog.
2. Under **Your swarms**, at the top of the catalog, is **Docs Squad**, with a `2 Agents` badge and a roster of Technical Writer (`writer`) and Docs Editor (`editor`).
3. Click the card, then **Launch Swarm Now**.

**You should see:** `09-saved-card.webp`. The Preset Catalog with the Docs Squad card selected under Your swarms. Clip `09-saved-card.mp4`: the card is clicked, Launch Swarm Now is clicked, the launcher closes and two panes appear.

**Must match**

- A card titled Docs Squad with the badge `2 Agents`.
- Its roster pills read Technical Writer (`writer`) and Docs Editor (`editor`).
- After launch, `writer` and `editor` confirm their roles again, the same two lines as step 5.

**May differ**

- Other cards under Your swarms, if you saved other swarms before this one.

**If not:** no Docs Squad card. Saved swarms live in Quay's settings folder for your Windows user; if you run Quay as a different user, or skipped Save in step 5, rebuild it from steps 2 to 5.

### 10. Check it worked

**Do**

1. Press `Ctrl+B O` until the right pane is focused.
2. Press `Ctrl+B N`, choose **PowerShell**, name it `check`, and click **Launch**.
3. In the new pane, run `npm test`, then `git status`.

**You should see:** `10-check.webp`. Left pane `writer` with its role confirmation, right pane `check` with `npm test` reporting 10 passing tests and `git status` listing only `README.md`.

**Must match**

- `npm test` reports 10 passed.
- `git status` shows one modified file: `README.md`.

**May differ**

- Test timings.

**You're done when**

- The Preset Catalog shows a Docs Squad card under Your swarms, and launching it brings up `writer` and `editor`, each confirming its role.
- `README.md` has the Install, Usage, Options, Scripts and License sections, and `npm test` passes, 10 tests.
- The editor's last reply ended with `APPROVED`.
- `git status` shows changes only to `README.md`.

**Next up:** Swarm 5, Bug Hunt.

## Screenshot list

All full-window captures of Quay unless noted. Names are the step markers.

| File | Shows | Must-match anchors |
| --- | --- | --- |
| `01-project-added.webp` | Starter selected in the rail, empty stage | project name in the rail |
| `02-builder-open.webp` | Launcher in Create Custom Swarm mode, name set, two default rows | "Docs Squad", two roster rows with the Role prompt placeholder, Add Agent |
| `03-writer-row.webp` | First row filled in, role prompt visible (modal crop) | Claude Code, "Technical Writer", `writer` |
| `04-editor-row.webp` | Both rows complete (modal crop) | `editor`, "Spawns 2 terminals" |
| `05-squad-launched.webp` | Split layout, both role confirmations | pane names, "Technical Writer", "Docs Editor" |
| `06-writer-working.webp` | Left pane mid-work, right pane idle | Working badge on the left, `README.md` in a tool call |
| `07-editor-approved.webp` | Editor's numbered list and verdict (pane crop) | `APPROVED` as the last line, two Idle badges |
| `08-restarted.webp` | Fresh start: project in the rail, empty stage | project name, no panes |
| `09-saved-card.webp` | Preset Catalog, the Docs Squad card selected under Your swarms | "Your swarms", "Docs Squad", `2 Agents`, roster pills |
| `10-check.webp` | Left `writer`, right `check` with test and status output | "10 passed", one `README.md` line |

One clip, `09-saved-card.mp4`, beside `09-saved-card.webp`: selecting the saved card, clicking Launch Swarm Now, the launcher closing and two panes appearing. Quay's own motion, under ten seconds. It ends as the panes appear, so it needs no timed terminal replay.

## Decisions

Resolved on [Tutorial outline: Swarm 4, Build and save a custom swarm](https://github.com/seanrobertwright/Quay-2/issues/19). The steps above already reflect them.

1. **The builder gets a Save.** A Save control that saves without launching, overwrite by name, a remove control on custom cards, a "Your swarms" group at the top of the catalog, new roster rows defaulting to Claude Code, saved swarms stored in Quay's settings folder, and saved swarms listed in the command palette. Designed in [Decide: How does the custom swarm builder save, list and remove a swarm?](https://github.com/seanrobertwright/Quay-2/issues/55) and built before this tutorial is written. Step 5 is Save, then Launch.
2. **The Role prompt box shows the four slots as its placeholder.** Who you are, what you own, what you leave to teammates, how you work. Part of the launch-prompt fix from [Decide: How do Swarm agents get their role prompt at launch?](https://github.com/seanrobertwright/Quay-2/issues/11), not the Save fix. Both pasted prompts follow that order.
3. **Both rows default to Claude Code**, so step 4 no longer switches the second row away from Antigravity. Other CLIs in a swarm are Swarm 9's lesson.
4. **The README tests and the stub stay.** The goal lives in `AGENTS.md` and the stub's second line points there. CI expects `npm test` red on the starter, the same per-starter expected state Swarm 3 needs.
5. **The editor edits `README.md`**, in sequence after the writer, and ends with a numbered list and `APPROVED`. A reply-only editor would add a round that teaches nothing this tutorial needs.
6. **Level Starter.** The agents never run at the same time and every prompt, role prompts included, is pasted.
7. **Facts checked in the code:** Quay has no close confirmation and never persists terminals, so a restart shows the project and an empty stage. Step 8's If not about exited panes stays as a guard.
