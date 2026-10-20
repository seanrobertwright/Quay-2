# Quay 2 terminal garbling — User Acceptance Test

<!-- uat:meta
version: 1
app: Quay 2 — terminal garbling
generated: 2026-10-20
tester_level: intermediate
commit: 5993069
branch: master
repo: E:/Projects/Quay2
-->

<!-- uat:summary:start -->
_This UAT has not been run yet._
<!-- uat:summary:end -->

## How to use this checklist

This checklist answers one question: **when, and how, does a Quay terminal pane get garbled?** Each
test performs one trigger (relaunch, a project switch, a resize, a mod, a monitor change) and asks
whether the pane is still clean afterwards. A **Fail** here is useful data, not a disappointment. Record
every garble you see, even a small one.

**Time:** about 90 minutes. The sections run highest-suspicion first, so if you have to stop, use
**Submit what I have so far** and the most important answers are already in. **Save my work** keeps
everything between sittings.

**What you need:**

- Windows 11 with this repo checked out at `E:\Projects\Quay2`, and the dev prerequisites from
  `CONTRIBUTING.md`: Node 20+, `pnpm` 10+, Rust 1.85+ (MSVC), and Visual Studio 2022 C++ build tools.
- PowerShell 7 (`pwsh`) on your PATH.
- Claude Code, Antigravity (`agy`) and Codex installed **and signed in**. Section 9 also uses one of
  OpenCode, Kiro or Copilot, whichever you have.
- Two monitors with **different** display scaling (for example 100% and 150%), for Section 8.
- Do **not** run this in a project where real agents are working. The tests open and close many
  terminals.

### Recording a result

A pane is **clean** when, after the wait time the test gives, none of the symptoms below is visible.
Wait the full time before you judge, because agents often redraw a second or two after a change.

- **G1, stacked or overlapping:** old frames drawn on top of new ones, such as two input boxes,
  repeated status lines, or text over text.
- **G2, shifted columns or bad wrap:** text offset by one or more columns, box borders broken or
  jagged, lines wrapping at the wrong place.
- **G3, missing or stale output:** the screen does not update, part of a redraw never arrives, blank
  areas, or typing does not echo.
- **G4, odd characters:** stray fragments such as `[0m`, `;1H` or `[?25l`, the replacement character
  (a diamond with a question mark), or letters that do not belong.
- **G5, undersized:** the program draws narrower or shorter than the pane, leaving an empty strip at
  the right or bottom wider than about one character.
- **G6, oversized:** content is cut off at the right or bottom edge, or a full-width line wraps onto a
  second line.
- **G7, other:** anything else. Describe it.

For every **Fail**, start the **Notes** with this line and fill it in:

```text
Symptoms: G? | Appeared: <which step, and how long after> | Redraw fixed it: yes / no / partly | PROBE: <paste>
```

- **Redraw**: in a split layout, click the circular-arrow button in the pane header (tooltip
  **Redraw terminal screen (Ctrl+L)**). In a single pane there is no header, so click inside the
  terminal and press `Ctrl`+`L`.
- **PROBE**: run the size probe below and paste the line it returns.
- Always attach a screenshot of a garbled pane (`Win`+`Shift`+`S`, then `Ctrl`+`V` into the picture box).

Use the purple look-and-feel box for anything odd that is not garbling, such as flicker, a slow redraw or
a jumpy cursor.

### Tool 1 — PROBE (xterm size versus pane size)

This reads, for every visible pane, how many columns and rows xterm is drawing and how many would fit.
It changes nothing.

1. Click an empty part of the left sidebar, then press `F12` (or right-click the sidebar and choose
   **Inspect**). Open the **Console** tab.
2. Paste the snippet below and press Enter. If the console refuses to paste, type `allow pasting`,
   press Enter, and paste again.
3. A table prints. The last line is a text version of it, so copy that line into Notes.
4. To run it again later, click in the console, press the up arrow, then Enter.

```js
(() => { const out = []; document.querySelectorAll('.xterm').forEach((x) => { const host = x.parentElement; const cs = getComputedStyle(host); const w = parseInt(cs.width), h = parseInt(cs.height); if (!w) return; const scr = x.querySelector('.xterm-screen').getBoundingClientRect(); const m = x.querySelector('.xterm-char-measure-element'); const dpr = devicePixelRatio; const devCell = m ? Math.floor((m.getBoundingClientRect().width / 32) * dpr) : NaN; const cols = Math.round((scr.width * dpr) / devCell); const rows = x.querySelectorAll('.xterm-rows > div').length; const cellW = scr.width / cols, cellH = scr.height / rows; const pane = host.parentElement.parentElement; const label = pane.querySelector('select')?.selectedOptions[0]?.text || pane.querySelector('.h-7 .font-medium')?.textContent || 'single pane'; const fitCols = Math.floor((w - 14) / cellW), fitRows = Math.floor(h / cellH); out.push({ pane: label, cols, rows, fitCols, fitRows, ok: cols === fitCols && rows === fitRows, gapRightPx: Math.round(w - scr.width), gapBottomPx: Math.round(h - scr.height), cellW: +cellW.toFixed(2), dpr }); }); console.table(out); return JSON.stringify(out); })()
```

`ok: true` means xterm fills its pane. `ok: false` means xterm itself is the wrong size, which is the
"terminal smaller than its window" symptom (**G5**) at the xterm level.

### Tool 2 — RULER (what size the program thinks it is), PowerShell terminals only

Type this into a **PowerShell Console** terminal inside Quay:

```powershell
$s = $Host.UI.RawUI.WindowSize; "PTY says $($s.Width) cols x $($s.Height) rows"; '#' * $s.Width
```

The `#` line should reach exactly to the right edge on **one** line. If it stops short, the program
thinks the terminal is narrower than it is (**G5**). If it wraps onto a second line, the program thinks
it is wider (**G6**). Write the `PTY says` numbers in Notes next to PROBE's `cols` and `rows`.

### Tool 3 — output generators, PowerShell terminals only

- **STREAM**: about six seconds of steady output, many small pieces:

  ```powershell
  1..400 | ForEach-Object { "line $_ " + ('=' * 60); Start-Sleep -Milliseconds 15 }
  ```

- **BIG**: more than 256 KB of coloured output, larger than Quay's replay buffer:

  ```powershell
  $e = [char]27; 1..6000 | ForEach-Object { "$e[3$($_ % 7 + 1)mrow $_ $e[0m" + ('x' * 50) }
  ```

### Claude Code configurations A to D

Your Claude Code settings use the fullscreen layout and have the claude-mods mods enabled. Several
tests repeat a trigger in four configurations so we can tell a mod problem from a layout problem.
Type the flags exactly into **Custom CLI Arguments (Optional)** when you start the terminal:

- **A**: leave the field empty. Mods on, fullscreen layout (alternate screen, mouse tracking).
- **B**: `--settings {"tui":"default"}`. Mods on, main screen.
- **C**: `--safe-mode`. Mods off (all plugins off), main screen.
- **D**: `--safe-mode --settings {"tui":"fullscreen"}`. Mods off, fullscreen layout.

These four were checked against `claude.exe` on this machine: A and D enter the alternate screen,
B and C do not. In C and D the event-bridge plugin is off too, so Quay's status badge for that terminal
may stay on its first state. That is expected and is not a failure.

### Starting a terminal (used by every test)

"Start **X** labelled `name`" means: make sure project **uat-p** is selected in the left sidebar, then
click **New Terminal** in the top bar, click the **X** tile (**Claude**, **Antigravity**, **Codex**,
**OpenCode**, **Kiro**, **Copilot** or **PowerShell Console**), fill in **Custom CLI Arguments
(Optional)** if a config says so, type `name` into **Terminal Label (Optional)**, and click
**Start Terminal (Enter)**. Leave **Skip Permissions (Default)** and the Model setting alone.

An agent is **ready** when its input box is showing and the screen has stopped changing, usually
5 to 15 seconds.

### The resize recipe (R)

Several tests say "run R on terminal X". Do every step with a three-second wait after it, and check that
X is clean after each wait:

1. **R1**: click **Side-by-Side Split (Ctrl+B %)** in the top bar. Using the dropdowns in the pane
   headers, put X in the left pane and `ps-1` in the right pane.
2. **R2**: drag the divider between the panes to about 30% and let go.
3. **R3**: drag it to about 70% and let go.
4. **R4**: click **Single Pane (Ctrl+B x)**. X should be the pane showing.
5. **R5**: maximise the Quay window, wait, then restore it to its normal size.

Write the first step where garbling appeared (for example `Appeared: R2, at once`).

## Words used in this document

- **Pane**: one terminal's rectangle on the stage. A split shows two panes and the grid shows four.
- **Rail**: the left sidebar listing projects and terminals.
- **Stage**: the area to the right of the rail where panes are drawn.
- **uat-p / uat-empty**: the two scratch projects Section 1 creates. uat-empty never gets a terminal,
  and clicking it is how several tests make Quay rebuild every pane.
- **Relaunch**: restarting a terminal that has exited, using the **Relaunch Agent** button on its
  **Session Inactive** ribbon, or the **Relaunch** link in its rail row.
- **Fullscreen layout / main screen**: the two ways Claude Code draws (see configs A to D).
- **Mods**: Claude Code plugins that draw into its screen. Yours include side panes (Archon, GitHub,
  Outputs, Sources, Dev servers, What's next), the two animated **hud** lines under the prompt, bands
  above the prompt (shelf, quick-reply, presets, session namer, lint-test gate) and turn-chime toasts.

## Section 1 — Setup and baseline
<!-- uat:section id=1 title="Setup and baseline" -->

### 1.1  Start the Quay dev build
<!-- uat:test id=1.1 -->

- **Goal:** Run Quay from source so DevTools is available.
- **Before you start:** Nothing.
- **Steps:**
  1. Open PowerShell in `E:\Projects\Quay2` and run `pnpm install`.
  2. Run `pnpm tauri dev`. Leave this terminal open for the whole run, since closing it closes Quay.
     The first build can take several minutes.
- **PASS looks like:** A window titled **Quay — Claude Code Workspace & Orchestrator** opens.
- **If it does not work:** Note the last error lines from the PowerShell window. Nothing else in this
  checklist can run without it.

<!-- uat:answer:start id=1.1 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=1.1 -->


### 1.2  Create and add the two scratch projects
<!-- uat:test id=1.2 -->

- **Goal:** One project to work in, and one empty project used to force pane rebuilds.
- **Before you start:** 1.1 passed.
- **Steps:**
  1. In a separate PowerShell window, run:
     `New-Item -ItemType Directory -Force "$HOME\quay-uat-p", "$HOME\quay-uat-empty" | Out-Null; git -C "$HOME\quay-uat-p" init`
  2. In Quay, click **Add** (tooltip **Add Project Workspace**) at the top of the rail and add the folder
     `quay-uat-p` from your home folder. Repeat for `quay-uat-empty`.
- **PASS looks like:** Both projects appear in the rail as **quay-uat-p** and **quay-uat-empty**, and
  the count badge next to each shows `0`.
- **If it does not work:** Note the error the Add Project dialog shows.

<!-- uat:answer:start id=1.2 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=1.2 -->


### 1.3  uat-p has no workspace launch flags
<!-- uat:test id=1.3 -->

- **Goal:** Make sure the A to D flags are the only flags Claude gets.
- **Before you start:** 1.2 passed.
- **Steps:**
  1. In the **quay-uat-p** row of the rail, click the gear (tooltip
     **Workspace Settings (Env Vars & Flags) for quay-uat-p**).
- **PASS looks like:** The custom flags field is empty and no environment variables are listed.
- **If it does not work:** Clear the flags, save, and note what was there.

<!-- uat:answer:start id=1.3 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=1.3 -->


### 1.4  Get every agent past its first-run prompts
<!-- uat:test id=1.4 -->

- **Goal:** Trust dialogs and sign-in screens must not appear in the middle of a later test.
- **Before you start:** 1.3 passed.
- **Steps:**
  1. Start **Claude** labelled `warmup-claude`. Answer any "trust this folder" prompt. Wait until ready.
  2. Do the same for **Antigravity** (`warmup-agy`), **Codex** (`warmup-codex`) and your OpenCode, Kiro or
     Copilot (`warmup-x`).
  3. Close all four terminals with the **X** (**Close terminal**) on each rail row.
- **PASS looks like:** All four agents reached their input prompt in uat-p.
- **If it does not work:** Note which agent stopped at which screen. Mark tests for that agent
  **Not done**.

<!-- uat:answer:start id=1.4 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=1.4 -->


### 1.5  Baseline: a fresh PowerShell pane fills its space
<!-- uat:test id=1.5 -->

- **Goal:** Confirm PROBE reads correctly on a pane that should be perfect, and record your normal
  cell size.
- **Before you start:** 1.4 passed. The Quay window is at its normal (not maximised) size.
- **Steps:**
  1. Start **PowerShell Console** labelled `ps-1`. Leave the layout as a single pane.
  2. Run PROBE (Tool 1).
- **PASS looks like:** One row, with `ok: true`. **Copy the line into Notes even on Pass**, because its
  `cellW` and `dpr` are the baseline for Sections 8 and 10.
- **If it does not work:** If `ok` is `false`, paste the line. The rest of the checklist is still worth
  running.

<!-- uat:answer:start id=1.5 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=1.5 -->


### 1.6  Baseline: PowerShell agrees with xterm about the size
<!-- uat:test id=1.6 -->

- **Goal:** Confirm the program inside the pane is told the same size xterm draws.
- **Before you start:** 1.5 done; `ps-1` is showing.
- **Steps:**
  1. Run RULER (Tool 2) in `ps-1`.
- **PASS looks like:** `PTY says` shows the same columns and rows as PROBE's `cols` and `rows`, and
  the `#` line exactly fills one line.
- **If it does not work:** Write both pairs of numbers in Notes, and say whether the `#` line stopped
  short or wrapped.

<!-- uat:answer:start id=1.6 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=1.6 -->


## Section 2 — Relaunch (reported by the user)
<!-- uat:section id=2 title="Relaunch" -->

### 2.1  Relaunched PowerShell shows its prompt, after a busy first run
<!-- uat:test id=2.1 -->

- **Goal:** A relaunched terminal shows its new output at once, even when the old run printed a lot.
- **Before you start:** Section 1 done. Single pane layout.
- **Steps:**
  1. Start **PowerShell Console** labelled `relaunch-busy`.
  2. Run STREAM (Tool 3) and wait until `line 400` appears.
  3. Type `exit` and press Enter. A **Session Inactive** ribbon appears at the top of the pane.
  4. Click **Relaunch Agent** on the ribbon, then wait 5 seconds.
  5. Type `echo relaunched` and press Enter.
- **PASS looks like:** Within 5 seconds of step 4 a new `PS ...>` prompt is visible, and step 5 shows
  your typing and prints `relaunched`.
- **If it does not work:** Record G3 if nothing new appeared. Then press Enter about 20 more times and
  note whether output starts appearing at some point (roughly how many presses). Finally, click
  **quay-uat-empty** in the rail, click **quay-uat-p** again, and note whether the prompt shows up now.

<!-- uat:answer:start id=2.1 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=2.1 -->


### 2.2  Relaunched PowerShell shows its prompt, after a quiet first run
<!-- uat:test id=2.2 -->

- **Goal:** The same check when the first run printed almost nothing.
- **Before you start:** 2.1 answered.
- **Steps:**
  1. Start **PowerShell Console** labelled `relaunch-quiet`. Wait for its prompt.
  2. Type `exit` and press Enter right away.
  3. Click **Relaunch Agent**, then wait 5 seconds.
- **PASS looks like:** A complete new prompt appears below the old output within 5 seconds, and no new
  text overwrites old text higher up.
- **If it does not work:** Note whether the prompt is missing completely, appears only partly, or
  appears after you type a few characters.

<!-- uat:answer:start id=2.2 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=2.2 -->


### 2.3  Relaunched Claude Code (config A) draws a clean screen
<!-- uat:test id=2.3 -->

- **Goal:** Relaunching Claude in your normal setup gives a usable, clean screen.
- **Before you start:** 2.2 answered.
- **Steps:**
  1. Start **Claude** (config A, no arguments) labelled `relaunch-A`. Wait until ready.
  2. Send `Reply with only the word ready` and wait for the reply.
  3. Type `/exit` and press Enter. Wait for **Session Inactive**.
  4. Click **Relaunch Agent** and wait 15 seconds.
  5. Type `hello` into the input box, without sending it.
- **PASS looks like:** The pane shows one complete Claude Code screen: an intact input box with whole
  borders, no pieces of the earlier session drawn over it, and `hello` appears in the box.
- **If it does not work:** Record the symptoms. Try Redraw (`Ctrl`+`L`) and note the result. Then click
  **quay-uat-empty** and back to **quay-uat-p**, and note whether the screen is clean after that.

<!-- uat:answer:start id=2.3 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=2.3 -->


### 2.4  Relaunched Claude Code (config C) draws a clean screen
<!-- uat:test id=2.4 -->

- **Goal:** The same relaunch on the main-screen layout with mods off.
- **Before you start:** 2.3 answered.
- **Steps:**
  1. Start **Claude** with `--safe-mode` (config C) labelled `relaunch-C`. Wait until ready.
  2. Do steps 2 to 5 of test 2.3 in this terminal.
- **PASS looks like:** Same as 2.3: a clean new Claude screen below the earlier transcript, with
  `hello` in the input box.
- **If it does not work:** As in 2.3.

<!-- uat:answer:start id=2.4 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=2.4 -->


### 2.5  Relaunched Antigravity draws a clean screen
<!-- uat:test id=2.5 -->

- **Goal:** Relaunch works for agy.
- **Before you start:** 2.4 answered.
- **Steps:**
  1. Start **Antigravity** labelled `relaunch-agy`. Wait until ready.
  2. Send `Reply with only the word ready` and wait for the reply.
  3. Exit agy: press `Ctrl`+`C`, and again if it asks. Note in Notes what made it exit. Wait for
     **Session Inactive**.
  4. Click **Relaunch Agent** and wait 15 seconds, then type `hello` without sending it.
- **PASS looks like:** One complete agy screen with an intact input area and `hello` in it.
- **If it does not work:** As in 2.3.

<!-- uat:answer:start id=2.5 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=2.5 -->


### 2.6  Relaunched Codex draws a clean screen
<!-- uat:test id=2.6 -->

- **Goal:** Relaunch works for Codex.
- **Before you start:** 2.5 answered.
- **Steps:**
  1. Start **Codex** labelled `relaunch-codex`. Wait until ready.
  2. Send `Reply with only the word ready` and wait for the reply.
  3. Type `/quit` and press Enter. If that does nothing, press `Ctrl`+`C` twice. Note which worked.
  4. Click **Relaunch Agent** and wait 15 seconds, then type `hello` without sending it.
- **PASS looks like:** One complete Codex screen with an intact input area and `hello` in it.
- **If it does not work:** As in 2.3.

<!-- uat:answer:start id=2.6 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=2.6 -->


### 2.7  Relaunch from the rail link behaves like the ribbon button
<!-- uat:test id=2.7 -->

- **Goal:** The rail's **Relaunch** link gives the same clean result.
- **Before you start:** 2.6 answered.
- **Steps:**
  1. In `relaunch-A` (Claude config A), type `/exit` and wait for it to exit.
  2. In the rail, click the small **Relaunch** link next to `exited` in the `relaunch-A` row.
  3. Wait 15 seconds and type `hello` without sending it.
- **PASS looks like:** A clean Claude screen, as in 2.3.
- **If it does not work:** As in 2.3. Also note whether this second relaunch looks worse than the first.

<!-- uat:answer:start id=2.7 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=2.7 -->


## Section 3 — Pane rebuild and replay
<!-- uat:section id=3 title="Pane rebuild and replay" -->

### 3.1  Rebuilt PowerShell pane matches what was there before
<!-- uat:test id=3.1 -->

- **Goal:** Switching to an empty project and back must not damage a pane.
- **Before you start:** Section 2 done. Single pane, showing `ps-1`.
- **Steps:**
  1. In `ps-1` run `Get-ChildItem $env:SystemRoot | Select-Object -First 30`, then take a screenshot.
  2. Click **quay-uat-empty** in the rail (the stage shows **Launch Terminal**), then click
     **quay-uat-p** and select `ps-1` again.
  3. Wait 3 seconds and take a second screenshot.
- **PASS looks like:** The listing and the prompt look the same as before, aligned the same way.
- **If it does not work:** Attach both screenshots.

<!-- uat:answer:start id=3.1 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=3.1 -->


### 3.2  Rebuilt Claude Code pane (config A) is clean
<!-- uat:test id=3.2 -->

- **Goal:** A fullscreen Claude pane survives a rebuild.
- **Before you start:** 3.1 answered.
- **Steps:**
  1. Start **Claude** config A labelled `rebuild-A`. Wait until ready.
  2. Send `List the numbers 1 to 40, one per line` and wait for the reply.
  3. Click **quay-uat-empty**, then **quay-uat-p**, then `rebuild-A`. Wait 3 seconds.
- **PASS looks like:** One clean Claude screen with an intact input box. Stray text above or around it
  from earlier frames counts as a Fail (G1).
- **If it does not work:** Record the symptoms, then try Redraw and note the result.

<!-- uat:answer:start id=3.2 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=3.2 -->


### 3.3  Rebuilt Claude Code pane (config C) is clean
<!-- uat:test id=3.3 -->

- **Goal:** The same rebuild on the main-screen layout with mods off.
- **Before you start:** 3.2 answered.
- **Steps:**
  1. Start **Claude** config C labelled `rebuild-C` and do steps 2 and 3 of 3.2 in it.
- **PASS looks like:** The transcript, numbers 1 to 40, reads cleanly in order, and the input box below
  it is intact.
- **If it does not work:** As in 3.2.

<!-- uat:answer:start id=3.3 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=3.3 -->


### 3.4  Rebuild after the pane changed size during its life
<!-- uat:test id=3.4 -->

- **Goal:** Replaying output recorded at several sizes into one new pane.
- **Before you start:** 3.3 answered.
- **Steps:**
  1. Show `rebuild-C` and run R1 to R4 of the resize recipe on it (split, 30%, 70%, single).
  2. Send `List the numbers 41 to 60, one per line` and wait for the reply.
  3. Click **quay-uat-empty**, then **quay-uat-p**, then `rebuild-C`. Wait 3 seconds.
- **PASS looks like:** The whole transcript, 1 to 60, is readable, and earlier lines are not drawn over
  later ones.
- **If it does not work:** Note which part is damaged: the oldest output, the middle, or the current
  screen.

<!-- uat:answer:start id=3.4 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=3.4 -->


### 3.5  Overflowing the replay buffer leaves no fragments at the top
<!-- uat:test id=3.5 -->

- **Goal:** When old output is dropped from the 256 KB replay buffer, the cut must not leave odd
  characters behind.
- **Before you start:** 3.4 answered.
- **Steps:**
  1. Start **PowerShell Console** labelled `big`, run BIG (Tool 3) and wait for the prompt to return
     (about 10 to 30 seconds).
  2. Click **quay-uat-empty**, then **quay-uat-p**, then `big`. Wait 3 seconds.
  3. Scroll the pane all the way to the top with the mouse wheel.
- **PASS looks like:** The very first line is a whole coloured `row NNNN xxxx...` line (or part of one
  with no stray codes). No fragments such as `[3`, `;1m` or `m` begin the line.
- **If it does not work:** Record G4 and screenshot the top of the pane.

<!-- uat:answer:start id=3.5 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=3.5 -->


### 3.6  A hidden terminal keeps everything it printed while hidden
<!-- uat:test id=3.6 -->

- **Goal:** Switching between terminals in the same project (no rebuild) loses nothing.
- **Before you start:** 3.5 answered. Single pane layout.
- **Steps:**
  1. Show `ps-1`, type STREAM and press Enter, then **immediately** click `big` in the rail.
  2. Wait 10 seconds, then click `ps-1` again.
  3. Scroll up through the output.
- **PASS looks like:** Lines `line 1` to `line 400` are all present in order, each on its own line, and
  a prompt follows `line 400`.
- **If it does not work:** Note the first missing or damaged line number.

<!-- uat:answer:start id=3.6 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=3.6 -->


## Section 4 — The first frame of a new terminal
<!-- uat:section id=4 title="First frame of a new terminal" -->

### 4.1  New Claude Code (config A) in a single pane: first frame clean
<!-- uat:test id=4.1 -->

- **Goal:** Baseline for this section: a new Claude pane in the simplest case.
- **Before you start:** Section 3 done. Single pane layout, window at normal size.
- **Steps:**
  1. Start **Claude** config A labelled `first-A`. Watch it closely as it appears, then wait 10 seconds.
- **PASS looks like:** From its first visible frame Claude draws at the full pane width: the input box
  spans the pane, nothing is drawn twice, and nothing jumps sideways.
- **If it does not work:** Say whether the problem was only in the first second or still there after
  10 seconds.

<!-- uat:answer:start id=4.1 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=4.1 -->


### 4.2  New PowerShell started from a grid is told the right size
<!-- uat:test id=4.2 -->

- **Goal:** A terminal created while the stage is a 2×2 grid gets the size of the pane it is shown in.
- **Before you start:** 4.1 answered.
- **Steps:**
  1. Click **2x2 Grid Layout** in the top bar and put `ps-1`, `big`, `first-A` and `rebuild-C` in the
     four slots using the pane dropdowns. Wait 3 seconds.
  2. Start **PowerShell Console** labelled `from-grid`.
  3. Click **Single Pane (Ctrl+B x)**, then click `from-grid` in the rail. Wait 3 seconds.
  4. Run RULER in `from-grid` and run PROBE.
- **PASS looks like:** `PTY says` matches PROBE's `cols` and `rows`, and the `#` line fills one line
  exactly.
- **If it does not work:** Write both pairs of numbers. Then press `Ctrl`+`L`, run RULER again, and
  note whether the numbers now match.

<!-- uat:answer:start id=4.2 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=4.2 -->


### 4.3  New Claude Code (config A) started from a grid: first frame clean
<!-- uat:test id=4.3 -->

- **Goal:** The same grid-born case for Claude.
- **Before you start:** 4.2 answered.
- **Steps:**
  1. Return to **2x2 Grid Layout** with four terminals in the slots. Wait 3 seconds.
  2. Start **Claude** config A labelled `grid-born-A`.
  3. Click **Single Pane (Ctrl+B x)** and click `grid-born-A` in the rail. Wait 10 seconds.
- **PASS looks like:** Claude fills the full pane width with a clean screen.
- **If it does not work:** Record the symptoms and PROBE. Try Redraw and note the result.

<!-- uat:answer:start id=4.3 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=4.3 -->


### 4.4  New Antigravity started from a grid: first frame clean
<!-- uat:test id=4.4 -->

- **Goal:** The grid-born case for agy.
- **Before you start:** 4.3 answered.
- **Steps:**
  1. Repeat 4.3 with **Antigravity** labelled `grid-born-agy`.
- **PASS looks like:** agy fills the full pane width with a clean screen.
- **If it does not work:** As in 4.3.

<!-- uat:answer:start id=4.4 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=4.4 -->


### 4.5  New Codex started from a grid: first frame clean
<!-- uat:test id=4.5 -->

- **Goal:** The grid-born case for Codex.
- **Before you start:** 4.4 answered.
- **Steps:**
  1. Repeat 4.3 with **Codex** labelled `grid-born-codex`.
- **PASS looks like:** Codex fills the full pane width with a clean screen.
- **If it does not work:** As in 4.3.

<!-- uat:answer:start id=4.5 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=4.5 -->


## Section 5 — Resizing
<!-- uat:section id=5 title="Resizing" -->

All tests in this section use `first-A` (Claude config A) unless they say otherwise. Close terminals
you no longer need with their rail **X** whenever the rail gets crowded, but keep `ps-1`, `big`,
`first-A`, `rebuild-C`, `grid-born-agy` and `grid-born-codex`.

### 5.1  Splitting side by side
<!-- uat:test id=5.1 -->

- **Goal:** Claude redraws cleanly when its pane halves in width.
- **Before you start:** Section 4 done. Single pane showing `first-A`.
- **Steps:**
  1. Do R1 (side-by-side split, `first-A` left, `ps-1` right). Wait 3 seconds.
- **PASS looks like:** Both panes are clean, and Claude's input box fits the left pane.
- **If it does not work:** Record the symptoms and PROBE. Try Redraw and note the result.

<!-- uat:answer:start id=5.1 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=5.1 -->


### 5.2  Dragging the divider slowly
<!-- uat:test id=5.2 -->

- **Goal:** A slow drag across the whole range.
- **Before you start:** 5.1 answered, still split.
- **Steps:**
  1. Drag the divider slowly from the far left (20%) to the far right (80%) over about 5 seconds,
     release, and wait 3 seconds.
- **PASS looks like:** Both panes are clean after the wait.
- **If it does not work:** Also note what you saw during the drag.

<!-- uat:answer:start id=5.2 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=5.2 -->


### 5.3  Dragging the divider fast, back and forth
<!-- uat:test id=5.3 -->

- **Goal:** A burst of many resizes.
- **Before you start:** 5.2 answered.
- **Steps:**
  1. Drag the divider quickly left and right for about 5 seconds, release near the middle, and wait
     3 seconds.
- **PASS looks like:** Both panes are clean after the wait.
- **If it does not work:** Record the symptoms and PROBE. Note whether Redraw fixes it.

<!-- uat:answer:start id=5.3 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=5.3 -->


### 5.4  Stacked split
<!-- uat:test id=5.4 -->

- **Goal:** Halving the height rather than the width.
- **Before you start:** 5.3 answered.
- **Steps:**
  1. Click **Stacked Split (Ctrl+B ")** with `first-A` on top and `ps-1` below. Wait 3 seconds.
  2. Drag the horizontal divider to about 30%, release, and wait 3 seconds.
- **PASS looks like:** Both panes are clean after each wait.
- **If it does not work:** Note which step.

<!-- uat:answer:start id=5.4 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=5.4 -->


### 5.5  Resize while Claude is streaming a reply
<!-- uat:test id=5.5 -->

- **Goal:** A resize in the middle of a stream of output.
- **Before you start:** 5.4 answered. Side-by-side split with `first-A` left.
- **Steps:**
  1. In `first-A` send `Write 60 numbered lines, each a short sentence about the sea`.
  2. While the reply is still arriving, drag the divider to 30%, then to 70%.
  3. Wait until the reply finishes, plus 3 seconds.
- **PASS looks like:** The finished reply reads cleanly with no repeated or overlapping lines, and the
  input box is intact.
- **If it does not work:** Note the first damaged line number.

<!-- uat:answer:start id=5.5 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=5.5 -->


### 5.6  Maximise and restore the window
<!-- uat:test id=5.6 -->

- **Goal:** A large width change in one step. On a wide monitor this also crosses the widths where
  Claude docks its side panes (110 and 144 columns).
- **Before you start:** 5.5 answered. Single pane showing `first-A`.
- **Steps:**
  1. Run PROBE and note `cols`.
  2. Maximise the Quay window, wait 3 seconds, and run PROBE.
  3. Restore the window, wait 3 seconds, and run PROBE.
- **PASS looks like:** Claude is clean after each wait, and PROBE shows `ok: true` each time. Put all
  three `cols` values in Notes, even on Pass.
- **If it does not work:** Note whether the damage came on maximising or on restoring.

<!-- uat:answer:start id=5.6 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=5.6 -->


### 5.7  Snap the window to half the screen
<!-- uat:test id=5.7 -->

- **Goal:** Windows snap resizing.
- **Before you start:** 5.6 answered.
- **Steps:**
  1. Click the Quay window, press `Win`+`Left`, and wait 3 seconds.
  2. Press `Win`+`Up` (or drag it back) to restore, and wait 3 seconds.
- **PASS looks like:** Claude is clean after each wait.
- **If it does not work:** Record the symptoms and PROBE.

<!-- uat:answer:start id=5.7 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=5.7 -->


### 5.8  Drag the window edge
<!-- uat:test id=5.8 -->

- **Goal:** A continuous resize from the window frame.
- **Before you start:** 5.7 answered.
- **Steps:**
  1. Drag the right edge of the Quay window inward by about a third, then back out, in one slow
     movement. Release and wait 3 seconds.
- **PASS looks like:** Claude is clean.
- **If it does not work:** Record the symptoms and PROBE.

<!-- uat:answer:start id=5.8 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=5.8 -->


### 5.9  Minimise and restore
<!-- uat:test id=5.9 -->

- **Goal:** Hiding the window completely and bringing it back.
- **Before you start:** 5.8 answered.
- **Steps:**
  1. Minimise Quay, wait 10 seconds, and restore it from the taskbar. Wait 3 seconds.
- **PASS looks like:** Claude is clean and PROBE shows `ok: true`.
- **If it does not work:** Record the symptoms and PROBE.

<!-- uat:answer:start id=5.9 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=5.9 -->


### 5.10  Drag the rail width
<!-- uat:test id=5.10 -->

- **Goal:** Resizing the sidebar changes the stage width.
- **Before you start:** 5.9 answered.
- **Steps:**
  1. Drag the rail's right edge (tooltip **Drag to resize sidebar (Double click to reset)**) as far
     right as it goes, release, and wait 3 seconds.
  2. Double-click the same edge to reset it, and wait 3 seconds.
- **PASS looks like:** Claude is clean after each wait.
- **If it does not work:** Note which step.

<!-- uat:answer:start id=5.10 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=5.10 -->


### 5.11  Focus switching that shows or hides the skip-permissions banner
<!-- uat:test id=5.11 -->

- **Goal:** The red **Dangerously Skipping Permissions** banner above the panes appears only while a
  skip-mode agent pane is focused, so clicking between panes changes the stage height.
- **Before you start:** 5.10 answered.
- **Steps:**
  1. Do R1 (`first-A` left, `ps-1` right). Click inside `first-A` and confirm the banner is showing.
  2. Click inside `ps-1` (the banner disappears) and wait 3 seconds.
  3. Click inside `first-A` (the banner returns) and wait 3 seconds. Repeat steps 2 and 3 twice more.
- **PASS looks like:** Both panes are clean after every wait, and PROBE shows `ok: true` for both.
- **If it does not work:** Record PROBE right after a switch, and say which pane was damaged.

<!-- uat:answer:start id=5.11 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=5.11 -->


### 5.12  2×2 grid with four different agents
<!-- uat:test id=5.12 -->

- **Goal:** Four agents resized into quarters at once.
- **Before you start:** 5.11 answered.
- **Steps:**
  1. Click **2x2 Grid Layout** and put `first-A`, `rebuild-C`, `grid-born-agy` and `grid-born-codex`
     in the four slots. Wait 5 seconds.
- **PASS looks like:** All four panes are clean, and PROBE shows `ok: true` for all four.
- **If it does not work:** Name the damaged pane or panes.

<!-- uat:answer:start id=5.12 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=5.12 -->


### 5.13  Zoom a grid pane and restore
<!-- uat:test id=5.13 -->

- **Goal:** Going from a quarter to the full stage and back.
- **Before you start:** 5.12 answered, grid showing.
- **Steps:**
  1. Click inside `first-A`, then click **Zoom active pane (Ctrl+B z)** in the top bar. Wait 3 seconds.
  2. Click **Restore split layout (Ctrl+B z)**. Wait 3 seconds.
- **PASS looks like:** `first-A` is clean zoomed, and all four panes are clean after restoring.
- **If it does not work:** Note which step and which pane.

<!-- uat:answer:start id=5.13 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=5.13 -->


### 5.14  A hidden terminal resized while hidden
<!-- uat:test id=5.14 -->

- **Goal:** A pane hidden during a window resize must catch up when shown.
- **Before you start:** 5.13 answered.
- **Steps:**
  1. Click **Single Pane (Ctrl+B x)** and show `ps-1` (so `first-A` is hidden).
  2. Maximise the window and wait 3 seconds.
  3. Click `first-A` in the rail and wait 3 seconds.
  4. Restore the window.
- **PASS looks like:** `first-A` is clean at step 3, and again after step 4.
- **If it does not work:** Record the symptoms and PROBE at step 3.

<!-- uat:answer:start id=5.14 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=5.14 -->


### 5.15  Redraw on a clean Claude pane (config A) keeps it clean
<!-- uat:test id=5.15 -->

- **Goal:** The Redraw button itself must not damage a fullscreen Claude pane.
- **Before you start:** 5.14 answered.
- **Steps:**
  1. Do R1 with `first-A` left. Wait 3 seconds.
  2. Click **Redraw terminal screen (Ctrl+L)** in the `first-A` pane header. Wait 3 seconds.
- **PASS looks like:** Claude's screen is redrawn whole and clean, and the input box still works.
- **If it does not work:** Record the symptoms.

<!-- uat:answer:start id=5.15 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=5.15 -->


### 5.16  Redraw on a main-screen Claude pane (config C) keeps the transcript
<!-- uat:test id=5.16 -->

- **Goal:** Redraw should repaint the screen without erasing the conversation.
- **Before you start:** 5.15 answered.
- **Steps:**
  1. Use the left pane dropdown to show `rebuild-C`. Scroll up and confirm the numbers 1 to 60 are
     there.
  2. Click **Redraw terminal screen (Ctrl+L)** in its header and wait 3 seconds. Scroll up.
- **PASS looks like:** The earlier transcript (the numbers) is still in the pane's scrollback, and the
  current screen is clean.
- **If it does not work:** Say whether the transcript was erased completely or only damaged.

<!-- uat:answer:start id=5.16 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=5.16 -->


## Section 6 — Claude Code mods and layout
<!-- uat:section id=6 title="Claude Code mods and layout" -->

### 6.1  Resize recipe in config A (mods on, fullscreen)
<!-- uat:test id=6.1 -->

- **Goal:** The full resize recipe in your normal Claude setup.
- **Before you start:** Section 5 done. Close every Claude terminal so the rail is clear.
- **Steps:**
  1. Start **Claude** config A labelled `mods-A`. Wait until ready. Send `Reply with only the word ready`.
  2. Run R (R1 to R5) on `mods-A`.
- **PASS looks like:** `mods-A` is clean after every step.
- **If it does not work:** Note the first step that garbled.

<!-- uat:answer:start id=6.1 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=6.1 -->


### 6.2  Resize recipe in config B (mods on, main screen)
<!-- uat:test id=6.2 -->

- **Goal:** Same mods, other layout.
- **Before you start:** 6.1 answered.
- **Steps:**
  1. Start **Claude** config B (`--settings {"tui":"default"}`) labelled `mods-B` and repeat 6.1's steps.
- **PASS looks like:** `mods-B` is clean after every step.
- **If it does not work:** Note the first step that garbled.

<!-- uat:answer:start id=6.2 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=6.2 -->


### 6.3  Resize recipe in config C (mods off, main screen)
<!-- uat:test id=6.3 -->

- **Goal:** No mods, main screen.
- **Before you start:** 6.2 answered.
- **Steps:**
  1. Start **Claude** config C (`--safe-mode`) labelled `mods-C` and repeat 6.1's steps.
- **PASS looks like:** `mods-C` is clean after every step.
- **If it does not work:** Note the first step that garbled.

<!-- uat:answer:start id=6.3 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=6.3 -->


### 6.4  Resize recipe in config D (mods off, fullscreen)
<!-- uat:test id=6.4 -->

- **Goal:** No mods, fullscreen.
- **Before you start:** 6.3 answered.
- **Steps:**
  1. Start **Claude** config D (`--safe-mode --settings {"tui":"fullscreen"}`) labelled `mods-D` and
     repeat 6.1's steps.
- **PASS looks like:** `mods-D` is clean after every step.
- **If it does not work:** Note the first step that garbled.

<!-- uat:answer:start id=6.4 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=6.4 -->


### 6.5  Side panes docking as the window widens (config A)
<!-- uat:test id=6.5 -->

- **Goal:** When the pane passes about 144 columns, mods dock their side panes beside the transcript.
  The re-layout must draw cleanly.
- **Before you start:** 6.4 answered. Single pane showing `mods-A`, window at normal size.
- **Steps:**
  1. Run PROBE and note `cols`.
  2. Maximise the window, wait 5 seconds, and run PROBE again.
- **PASS looks like:** Claude is clean. Note in Notes whether side panes appeared and the `cols` before
  and after. If `cols` is still under 144 when maximised, mark **Not done** and give the number.
- **If it does not work:** Screenshot it. Say whether the damage is in the transcript, a side pane, or
  the border between them.

<!-- uat:answer:start id=6.5 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=6.5 -->


### 6.6  Side panes undocking as the window narrows (config A)
<!-- uat:test id=6.6 -->

- **Goal:** The reverse re-layout.
- **Before you start:** 6.5 answered, window maximised.
- **Steps:**
  1. Click **Side-by-Side Split (Ctrl+B %)** with `mods-A` on the left, so its pane drops well below
     110 columns. Wait 5 seconds.
- **PASS looks like:** The side panes are gone or moved inline, and the pane is clean.
- **If it does not work:** As in 6.5.

<!-- uat:answer:start id=6.6 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=6.6 -->


### 6.7  The hud lines animating for two minutes, visible
<!-- uat:test id=6.7 -->

- **Goal:** The hud mod redraws its two lines all the time. Damage must not build up over time.
- **Before you start:** 6.6 answered. Split, `mods-A` left and visible.
- **Steps:**
  1. Leave Quay alone for 2 minutes while watching `mods-A`.
- **PASS looks like:** After 2 minutes the hud lines and the input box are exactly where they started,
  with nothing duplicated or smeared.
- **If it does not work:** Note roughly when the damage first appeared.

<!-- uat:answer:start id=6.7 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=6.7 -->


### 6.8  The hud lines animating for two minutes, hidden
<!-- uat:test id=6.8 -->

- **Goal:** A pane that kept animating while hidden must be clean when shown again.
- **Before you start:** 6.7 answered.
- **Steps:**
  1. Click **Single Pane (Ctrl+B x)** and show `ps-1`, so `mods-A` is hidden.
  2. Wait 2 minutes, then click `mods-A` in the rail and wait 3 seconds.
- **PASS looks like:** `mods-A` is clean.
- **If it does not work:** Record the symptoms and PROBE.

<!-- uat:answer:start id=6.8 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=6.8 -->


### 6.9  Quick-reply band appearing and disappearing
<!-- uat:test id=6.9 -->

- **Goal:** A band that appears above the prompt changes how many rows the transcript gets.
- **Before you start:** 6.8 answered, `mods-A` showing.
- **Steps:**
  1. Send `Ask me one yes-or-no question and wait for my answer`. Wait for the question; a row of reply
     buttons should appear above the prompt.
  2. Answer `yes` and wait for the reply, plus 3 seconds.
- **PASS looks like:** The pane is clean while the band shows and after it goes. If no band appeared,
  mark **Not done** and say so.
- **If it does not work:** Note whether the damage came when the band appeared or when it left.

<!-- uat:answer:start id=6.9 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=6.9 -->


## Section 7 — Character widths
<!-- uat:section id=7 title="Character widths" -->

### 7.1  Emoji with a variation selector take two columns
<!-- uat:test id=7.1 -->

- **Goal:** `⚙️` (a gear followed by an invisible width marker) must take two columns, as agents assume.
- **Before you start:** Section 6 done. Show `ps-1`.
- **Steps:**
  1. Run: `"$([char]0x2699)$([char]0xFE0F)" * 5 + '|'; '0123456789|'`
- **PASS looks like:** The two `|` characters line up in the same column, one directly above the other.
- **If it does not work:** Screenshot it, and say whether the top `|` is to the left or right of the
  bottom one.

<!-- uat:answer:start id=7.1 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=7.1 -->


### 7.2  Pictographic emoji take two columns
<!-- uat:test id=7.2 -->

- **Goal:** The same check for a plain emoji.
- **Before you start:** 7.1 answered.
- **Steps:**
  1. Run: `[char]::ConvertFromUtf32(0x1F642) * 5 + '|'; '0123456789|'`
- **PASS looks like:** The two `|` characters line up.
- **If it does not work:** As in 7.1.

<!-- uat:answer:start id=7.2 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=7.2 -->


### 7.3  Emoji in a Claude reply do not shift Claude's layout
<!-- uat:test id=7.3 -->

- **Goal:** Width disagreements show up as shifted borders after emoji appear.
- **Before you start:** 7.2 answered.
- **Steps:**
  1. Show `mods-A` in a single pane. Send:
     `Reply with exactly five lines, each starting with one of these and then a short word: ⚙️ ⚠️ ⏸️ ✅ 🙂`
  2. Wait for the reply, plus 3 seconds.
- **PASS looks like:** The reply lines start at the left margin, the input box borders are straight and
  whole, and no line after the emoji is shifted.
- **If it does not work:** Screenshot it, and note which emoji's line is shifted.

<!-- uat:answer:start id=7.3 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=7.3 -->


## Section 8 — Display scaling
<!-- uat:section id=8 title="Display scaling" -->

### 8.1  Moving Quay to the monitor with different scaling
<!-- uat:test id=8.1 -->

- **Goal:** Character cells change size when the scale changes. Panes must refit.
- **Before you start:** Section 7 done. Side-by-side split with `mods-A` left and `ps-1` right.
- **Steps:**
  1. Drag the Quay window by its title bar fully onto the other monitor. Wait 5 seconds.
  2. Run PROBE, and run RULER in `ps-1`.
- **PASS looks like:** Both panes are clean, PROBE shows `ok: true` with a different `dpr` from the
  baseline in 1.5, and RULER's `PTY says` matches PROBE for `ps-1`.
- **If it does not work:** Paste PROBE and the RULER numbers.

<!-- uat:answer:start id=8.1 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=8.1 -->


### 8.2  Moving Quay back to the first monitor
<!-- uat:test id=8.2 -->

- **Goal:** The reverse move.
- **Before you start:** 8.1 answered.
- **Steps:**
  1. Drag the window back to the first monitor. Wait 5 seconds.
  2. Run PROBE, and run RULER in `ps-1`.
- **PASS looks like:** Both panes are clean, PROBE shows `ok: true` with `dpr` and `cellW` equal to the
  baseline in 1.5, and RULER matches PROBE.
- **If it does not work:** As in 8.1.

<!-- uat:answer:start id=8.2 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=8.2 -->


## Section 9 — Other agents
<!-- uat:section id=9 title="Other agents" -->

### 9.1  Antigravity: resize recipe
<!-- uat:test id=9.1 -->

- **Goal:** The resize recipe on agy.
- **Before you start:** Section 8 done.
- **Steps:**
  1. Start **Antigravity** labelled `agy-r`. Wait until ready. Send `Reply with only the word ready`.
  2. Run R (R1 to R5) on `agy-r`.
- **PASS looks like:** `agy-r` is clean after every step.
- **If it does not work:** Note the first step that garbled, and whether Redraw or `Ctrl`+`L` fixes it.

<!-- uat:answer:start id=9.1 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=9.1 -->


### 9.2  Antigravity: pane rebuild
<!-- uat:test id=9.2 -->

- **Goal:** agy survives a rebuild.
- **Before you start:** 9.1 answered.
- **Steps:**
  1. Show `agy-r`. Click **quay-uat-empty**, then **quay-uat-p**, then `agy-r`. Wait 3 seconds.
- **PASS looks like:** One clean agy screen.
- **If it does not work:** Record the symptoms, and try Redraw.

<!-- uat:answer:start id=9.2 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=9.2 -->


### 9.3  Codex: resize recipe
<!-- uat:test id=9.3 -->

- **Goal:** The resize recipe on Codex.
- **Before you start:** 9.2 answered.
- **Steps:**
  1. Start **Codex** labelled `codex-r`. Wait until ready. Send `Reply with only the word ready`.
  2. Run R (R1 to R5) on `codex-r`.
- **PASS looks like:** `codex-r` is clean after every step.
- **If it does not work:** As in 9.1.

<!-- uat:answer:start id=9.3 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=9.3 -->


### 9.4  Codex: pane rebuild
<!-- uat:test id=9.4 -->

- **Goal:** Codex survives a rebuild.
- **Before you start:** 9.3 answered.
- **Steps:**
  1. Show `codex-r`. Click **quay-uat-empty**, then **quay-uat-p**, then `codex-r`. Wait 3 seconds.
- **PASS looks like:** One clean Codex screen.
- **If it does not work:** As in 9.2.

<!-- uat:answer:start id=9.4 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=9.4 -->


### 9.5  OpenCode, Kiro or Copilot: resize recipe
<!-- uat:test id=9.5 -->

- **Goal:** The resize recipe on your third agent. Write which one you used at the start of Notes.
- **Before you start:** 9.4 answered.
- **Steps:**
  1. Start **OpenCode**, **Kiro** or **Copilot** labelled `x-r`. Wait until ready. Send
     `Reply with only the word ready`.
  2. Run R (R1 to R5) on `x-r`.
- **PASS looks like:** `x-r` is clean after every step.
- **If it does not work:** As in 9.1.

<!-- uat:answer:start id=9.5 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=9.5 -->


### 9.6  OpenCode, Kiro or Copilot: pane rebuild
<!-- uat:test id=9.6 -->

- **Goal:** The third agent survives a rebuild.
- **Before you start:** 9.5 answered.
- **Steps:**
  1. Show `x-r`. Click **quay-uat-empty**, then **quay-uat-p**, then `x-r`. Wait 3 seconds.
- **PASS looks like:** One clean screen.
- **If it does not work:** As in 9.2.

<!-- uat:answer:start id=9.6 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=9.6 -->


### 9.7  OpenCode, Kiro or Copilot: relaunch
<!-- uat:test id=9.7 -->

- **Goal:** Relaunch on the third agent.
- **Before you start:** 9.6 answered.
- **Steps:**
  1. Exit `x-r` using its own quit command or `Ctrl`+`C`, and note which worked. Wait for
     **Session Inactive**.
  2. Click **Relaunch Agent**, wait 15 seconds, and type `hello` without sending it.
- **PASS looks like:** One complete screen with an intact input area and `hello` in it.
- **If it does not work:** As in 2.3.

<!-- uat:answer:start id=9.7 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=9.7 -->


## Section 10 — After restarting Quay (run last)
<!-- uat:section id=10 title="After restarting Quay" -->

**This section restarts Quay, which ends every running terminal.** Nothing is lost: they come back as
**Session Inactive** with their scrollback. Run it last.

### 10.1  Restored scrollback reads cleanly
<!-- uat:test id=10.1 -->

- **Goal:** Scrollback restored from disk after a restart contains no fragments or overlaps.
- **Before you start:** Sections 1 to 9 done.
- **Steps:**
  1. Close the Quay window. If `pnpm tauri dev` is still running in its PowerShell window, press
     `Ctrl`+`C` there. Then run `pnpm tauri dev` again.
  2. Select **quay-uat-p**, then click `big`, then `ps-1`, then `mods-A`, waiting 3 seconds on each and
     scrolling through each.
- **PASS looks like:** Each shows **Session Inactive** with readable earlier output: no G1 or G4, and
  `big` begins with a whole `row` line.
- **If it does not work:** Name the terminal or terminals, and screenshot the damaged part.

<!-- uat:answer:start id=10.1 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=10.1 -->


### 10.2  Relaunch from restored state (Claude config A)
<!-- uat:test id=10.2 -->

- **Goal:** Relaunching a terminal restored from disk gives a clean screen.
- **Before you start:** 10.1 answered.
- **Steps:**
  1. With `mods-A` showing, click **Relaunch Agent**. Wait 15 seconds and type `hello` without sending.
- **PASS looks like:** One complete Claude screen with an intact input box and `hello` in it.
- **If it does not work:** As in 2.3. Also say whether it looked better or worse than 2.3.

<!-- uat:answer:start id=10.2 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=10.2 -->


### 10.3  Cold start: the first new pane measures the same as the baseline
<!-- uat:test id=10.3 -->

- **Goal:** Panes created right after start-up must use the final font and cell size.
- **Before you start:** 10.2 answered. The window is at its normal size on the first monitor.
- **Steps:**
  1. Start **PowerShell Console** labelled `cold`, show it in a single pane, and run PROBE and RULER.
- **PASS looks like:** PROBE shows `ok: true`, `cellW` matches the baseline in 1.5, and RULER matches
  PROBE.
- **If it does not work:** Paste both.

<!-- uat:answer:start id=10.3 -->
- [ ] **Status:** _not answered_
- **Notes:**
- **Look & feel concern:**
- **Screenshots:**
<!-- uat:answer:end id=10.3 -->


## Cleanup (not a test)

- Close the test terminals with their rail **X**.
- Remove **quay-uat-p** and **quay-uat-empty** from the rail with their remove buttons
  (**Remove workspace ...**), then delete the folders:
  `Remove-Item -Recurse -Force "$HOME\quay-uat-p", "$HOME\quay-uat-empty"`.
  **This deletes those two folders permanently.** They hold only test files.

## Not in scope (deferred — do NOT test)

- **Gemini, Pi, Grok, Aider**: not installed on the test machine.
- **The released v0.2.0 installer**: this run uses the dev build so DevTools is available.
- **Swarm-launched terminals**: they go through the same spawn and pane code as **New Terminal**, so
  they are covered indirectly.
- **Terminal search (Ctrl+F)** and the Archon, Machina and GitHub drawers: these are overlays that do
  not resize panes.

## What each section probes (for whoever processes the results)

These are suspicions drawn from reading the code at commit `5993069`. Each one is a hypothesis to check
against the results, not a confirmed bug.

- **Relaunch (Section 2, 9.7, 10.2).** Relaunch keeps the pane mounted, so `useTerminal` keeps its
  `highestSeq` from the old process. `PtySession::spawn` starts the new process's `seq` at 1, and the
  `pty-output` listener drops every chunk whose `seq` is not above `highestSeq`. A pane that saw N
  chunks would hide the new process's first N chunks, and the old screen is not cleared either. A
  terminal restored from disk starts at `last_seq` 0 (`read_saved_scrollback`), so 10.2 is the control
  for 2.3. 2.1 against 2.2 separates "many old chunks" from "few".
- **Pane rebuild (Section 3, 9.2, 9.4, 9.6).** When the active project has no terminals, `Stage` returns
  its `Placeholder` branch, which is a different element tree, so every `TerminalView` unmounts. Coming
  back mounts fresh xterm instances that replay up to 256 KB of raw output (`get_terminal_output`)
  recorded at whatever sizes the PTY had, into a pane of today's size.
- **Buffer cut (3.5, 10.1).** `trim_output_buffer` and `read_saved_scrollback` drop the oldest bytes. A
  cut can land inside an escape sequence, or drop the alternate-screen switch that later bytes depend on.
- **First frame (Section 4).** `spawn_terminal` is given `getGlobalTerminalDimensions`, the size of
  whichever pane was fitted last anywhere (for example a grid quarter). `syncPtySize` sends the first
  fit without the follow-up `Ctrl+L`, so a program that drew its first frame at the old size is never
  asked to redraw.
- **Resize (Section 5).** Each size change sends `resize_pty` and then `Ctrl+L` 60 ms later, so a drag
  sends a burst. Programs that do not treat `Ctrl+L` as "redraw" keep stale frames. Hidden panes skip
  `syncPtySize` until they are shown. `SkipBanner` changes the stage height when focus moves between
  panes (5.11).
- **Mods and layout (Section 6).** With `tui: fullscreen`, Claude Code enters the alternate screen,
  enables mouse tracking and uses synchronized output (measured with a ConPTY probe). Mods dock side
  panes from 110 columns, and unasked panes from 144. hud redraws all the time. Configs A to D separate
  mods from layout.
- **Widths (Section 7).** `createClaudeUnicodeProvider` widens VS16 and emoji to two cells. ConPTY and
  each agent have their own width tables, and any disagreement shows up as shifted columns.
- **Cell metrics (Section 8, 10.3).** A scale change or a late font change alters the cell size. Panes
  refit only when their container's size changes (`ResizeObserver`).

<!-- uat:findings:start -->
_No tester-reported findings yet._
<!-- uat:findings:end -->

## Sign-off

- Tester name: ______  Date: ______
