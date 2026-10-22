# Test runs: Swarm 1: Your first swarm

One section per test run, newest first. `pnpm docs:test-run first-swarm` adds each run's section from the page's step cards. How to set up the test account and do a run is in `scripts/test-runs/README.md`.

## 2026-10-22

- **Result:** pass
- **Run fingerprint:** `bb183d7f00cf3e48`
- **Failed at:** none
- **Tracking issue:** none
- **Quay:** 0.3.0

### Agent CLIs

| CLI | Version | Default model |
| --- | --- | --- |
| Claude Code | 2.1.308 | claude-opus-5-5 |

### Time and Tokens

| Agent | CLI | Minutes | Tokens |
| --- | --- | --- | --- |
| lead-dev | Claude Code | 2 | 245,562 |
| **Total** | | 6 | 245,562 |

### Before you start

- [x] Every agent CLI and tool the run used is on this list:
  - **Quay 2** is installed from the latest release ([Installing a Release](/guide/installation#installing-a-release)).
  - **Claude Code** 2.1.296 or later is installed and signed in ([Claude Code](/guide/installation#claude-code)). `claude --version`
  - The **event-bridge plugin** 0.1.0 or later is installed and enabled in Claude Code ([Event-bridge Plugin](/guide/installation#event-bridge-plugin)).
  - **PowerShell 7** is installed ([PowerShell 7](/guide/installation#powershell-7)). `pwsh --version`
  - **Node.js** 24 or later is installed, with npm ([Node.js and npm](/guide/installation#node-js-and-npm)). `node --version`
  - **Git** is installed and knows your name and email ([Git](/guide/installation#git)). `git --version`
  - You are using the **starter project**, because agents run in Skip mode and edit files without asking.
- **Used but not listed:** none

### Steps

#### 1. Get the starter project

- [x] `git commit` prints `Starter` as the message.
- [x] `npm install` ends with `found 0 vulnerabilities`.
- **If not, node or npm is not recognised:** not used
- **If not, git commit says Author identity unknown:** not used

#### 2. Launch the swarm

- [x] Two panes side by side: `lead-dev` on the left and `build-watcher` on the right.
- [x] The rail lists `lead-dev` and `build-watcher` under the project, beside the PowerShell pane from step 1.
- [x] `lead-dev`'s first line reads `Role: Lead Developer`, and it waits for your task.
- **If not, lead-dev asks you to accept Bypass Permissions mode:** not used
- **If not, lead-dev shows the plugin hint:** not used

#### 3. Start the watcher

- [x] `Tests  5 failed (5)`.
- [x] A `Waiting for file changes...` line under it.
- **If not, vitest is not recognized:** not used

#### 4. Give lead-dev the job

- [x] `build-watcher` shows `Tests  5 passed (5)`.
- [x] At the end, `lead-dev`'s pane header shows a green dot and `Ready`.
- [x] `lead-dev` tells you it believes the tests pass.
- **If not, lead-dev runs the tests itself anyway:** not used
- **If not, the watcher never re-runs:** not used

#### 5. Zoom in on the result

- [x] `build-watcher` fills the stage.
- [x] Five test names, each with a green ✓.
- **If not, Ctrl+B Z did nothing:** not used
- **If not, Ctrl+B Z zoomed lead-dev instead:** not used

#### 6. Check it worked

- [x] The CLI prints `Tip: $7.65  Total: $50.15  Each: $16.72`.
- [x] `git status --short` prints one line, ` M src/tip.ts`.

### You're done when

- [x] `build-watcher` showed `Tests  5 passed (5)`.
- [x] The CLI prints `Tip: $7.65  Total: $50.15  Each: $16.72`.
- [x] `git status --short` lists `src/tip.ts` as the only modified file.

### Fresh-eyes findings

Read by `claude-opus-5-5` from `docs/tutorials/swarm/first-swarm/index.md` as built at `b707e60`. Mark each finding fixed, or dismissed with a reason.

1. **Step 1, Get the starter project: a control or pane the page doesn't name or show.**
   > 2. In Quay, click **Add** at the top of the rail, click **Browse...**, pick that folder and click **Add Project**.

   The page never says what or where "the rail" is in Quay's window, and the screenshot is a placeholder, so a newcomer can't find the Add button.

   Outcome: fixed. A paragraph under You'll learn names the rail, the panel down the left that lists projects and their terminals.
2. **Step 1, Get the starter project: an action open to two readings.**
   > 3. Press `Ctrl+B N`, choose **PowerShell Console** and click **Start Terminal (Enter)**.

   You could hold Ctrl, B and N together, or press Ctrl+B, let go, then press N. Only step 5's troubleshooting says Ctrl+B is a prefix you release and then follow within 1.5 seconds.

   Outcome: fixed. The same paragraph says every `Ctrl+B` shortcut is two key presses: press `Ctrl+B`, let go, then press the next key.
3. **Step 4, Give lead-dev the job: a control or pane the page doesn't name or show.**
   > - `lead-dev`'s badge reads Working while it edits, then Idle again.

   The page never says where lead-dev's badge appears (pane header, rail entry or elsewhere), and the screenshot is a placeholder, so you can't check this.

   Outcome: fixed. The Must match now names the pane header, and says `Ready`, which is what Quay shows, not Idle.
4. **Step 5, Zoom in on the result: a term the page doesn't explain.**
   > 2. Press `Ctrl+B Z` to zoom it to the whole stage, and read the five passing tests.

   "Stage" is never explained, so a newcomer can't be sure which area the pane should fill or confirm that it "fills the stage".

   Outcome: fixed. The paragraph under You'll learn names the stage, the area right of the rail where the terminal panes open.

Read by `claude-opus-5-5` from `docs/tutorials/swarm/first-swarm/index.md` as built at `1fe02d7`. Mark each finding fixed, or dismissed with a reason.

1. **Step 4, Give lead-dev the job: a control or pane the page doesn't name or show.**
   > - At the end, `lead-dev`'s pane header shows a green dot and `Ready`.

   The page never says what or where a pane's header is, and the screenshot is only a placeholder. A newcomer can't tell which part of the `lead-dev` pane to look at for the green dot and `Ready`.

   Outcome: fixed. The paragraph under You'll learn says a split pane has a header along its top with the terminal's name and, for an agent, its status.

### Off-page knowledge

- none

### Differed from the screenshots

- not checked: placeholder stills
