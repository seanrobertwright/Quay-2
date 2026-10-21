# Test runs

A tutorial is published only after test runs pass. A test run is the maintainer following one
tutorial's rendered page by hand, from getting the starter project to the check-it-worked step,
in a Windows account kept for nothing else. Each run is written up in the tutorial's record,
`examples/tutorials/<slug>/test-runs.md`. The record sits beside `starter/` and `check/`, outside
`docs/`, so the site never renders it. What a run is and what counts as a pass were decided in
issue #14.

The record is generated, not typed. `pnpm docs:test-run <slug>` writes each run's section from the
page's step cards, and the maintainer fills in what the run found.

## Set up the test account

Do this once.

1. **Make a local Windows account used only for test runs.** Your own account won't do: its agent
   config (plugins, hooks, mods, a global `CLAUDE.md`) changes what the agents do and how many
   tokens they use.
2. **Install only what the tutorials' "Before you start" lists tell a learner to install.** Today
   that is Node 24 or later with npm, Git, PowerShell 7 and the agent CLIs. Quay itself is
   installed fresh before each run (below). Anything more on the account could hide a
   prerequisite a page forgot to list.
3. **Sign in each agent CLI once.** Leave every CLI on its default settings and default model. Add
   no plugins, hooks or global instruction files.
4. **Put the recording wrapper on the account's `PATH`,** so each run records the agent output
   the screenshots replay. The wrapper is the record and replay tool in `tools/record-replay/`;
   its README says how to build it. Copy `quay-record-replay.exe` into a folder of its own once
   under each agent CLI's name (`claude.exe`, `codex.exe`, ...). Put that folder ahead of the
   real CLIs in the account's user `PATH` variable, in Windows' Environment Variables settings,
   not in a shell profile: Quay builds each terminal's environment from the registry, so a
   `PATH` set only in a shell never reaches its terminals. The wrapper runs the real CLI further
   along `PATH` and passes everything through, so it changes nothing the agents do. It is the one
   thing the account holds beyond the "Before you start" lists.

## Before each run

1. **Install Quay from its release installer.** Use the latest release, or the draft release when
   the run is a re-run for a release. Never use a dev build (`pnpm tauri dev` or a local
   `pnpm tauri build`). A tutorial that needs an unreleased fix waits for the release that has it.
2. **Update each agent CLI to its latest stable version.** Keep the default settings and models,
   except where the page says otherwise, for example Skip mode.
3. **Wipe Quay's data,** so it starts as on first launch. Close Quay, then in the test account:

   ```powershell
   Remove-Item -Recurse -Force "$env:LOCALAPPDATA\Quay2", "$env:LOCALAPPDATA\com.quay.app" -ErrorAction SilentlyContinue
   ```

   `%LOCALAPPDATA%\Quay2` holds Quay's own files, such as `workspaces.json`.
   `%LOCALAPPDATA%\com.quay.app` holds its WebView's storage, which keeps settings such as the
   rail width.
4. **Point the recorder at the tutorial's recordings folder.** Set the account's user variable
   `QUAY_RECORD_DIR` to `tools/record-replay/recordings/<tutorial>/` in a checkout the test
   account can write to, and empty that folder. The wrapper refuses to start a CLI with no
   `QUAY_RECORD_DIR` set.
5. **Serve the page and its zips from the tutorial's branch.** In your own account, on that branch:

   ```powershell
   pnpm docs:build
   pnpm docs:preview
   ```

   `docs:build` packs every starter and check suite into the zips the page links to, so the
   preview has exactly what the live site will have. The preview serves the site at
   `http://localhost:4173/Quay-2/`.
6. **Do the fresh-eyes read first** when this is the first run of a new run fingerprint. It is a
   project skill, still to be built in issue #98, that hands the built page to a new agent and
   lists where a newcomer would get stuck. Its findings go in the run's section.
7. **Add the run's section** to the record, in your own account, on the tutorial's branch:

   ```powershell
   pnpm docs:test-run <slug>
   ```

   The slug is the tutorial's folder name, for example `first-swarm`. The section is dated today;
   `--date YYYY-MM-DD` dates it otherwise. The command fails, and writes nothing, when the page
   breaks a step-card rule or `examples/tutorials/<slug>/starter/` is missing.

## Doing the run

In the test account, open the preview, download the starter zip from the page, and follow the page
and nothing else. Unzip the starter into `C:\tutorials\<slug>`, the neutral project path
recordings are made on, since an agent's output shows whatever paths it prints. Keep the record
open in your own account and fill it in as you go.

For the recording, run `quay-record-replay mark <recordings folder> NN-<what>` at the start of each
step, with the name of that step's screenshot, such as `03-reply`. When the run is over, close
Quay and run `quay-record-replay finish <recordings folder>`. The recordings are committed with
the record.

A run passes only when all of these hold:

1. Only the page was used: no action or prompt that isn't on the page, and no nudging an agent or
   retrying a step unless an If not says to.
2. Every Must match held.
3. Every "You're done when" item is true, including the check suite passing where the tutorial
   has one.
4. No knowledge the page doesn't give was needed, even if you got past the step anyway.
5. Every agent CLI and tool the run used is listed in the page's "Before you start". Each tutorial's
   prerequisites stand alone and never rely on an earlier tutorial having been done.

Two rules go with these:

- An If not used during the run still allows a pass if its fix worked as written. Record it.
- After a failure, any change to a Do or Paste slot, the starter or the check suite means a new
  run from step 1. Changes to wording alone, captions or If not text don't.

Each new run fingerprint needs two passing runs. Run 1 is where Must match and May differ are
written; run 2 checks them. Anything in run 2 that differed and isn't under May differ either
moves there, or has its prompt tightened, which changes the fingerprint, so both runs start again.
A re-run of an unchanged fingerprint is one run.

## Filling in the section

`pnpm docs:test-run` writes every line it can from the page. Replace each value in italics, tick
each box that held, and leave the headings as they are.

| Line | What goes there |
| --- | --- |
| Result | `pass` or `fail`. |
| Run fingerprint | Written by the command. Leave it. |
| Failed at | For a failed run, the step it stopped at; otherwise `none`. |
| Tracking issue | For a failed run, a link to the issue that tracks it; otherwise `none`. |
| Quay | Quay's version, shown under **Check for Updates...** in the command palette. |
| Agent CLIs | One row per CLI the run used: its version (`<cli> --version`) and its default model. |
| Time and Tokens | One row per agent, by its pane label: its minutes and its tokens, each from that CLI's own report, or `not reported`. The Total row holds the minutes from starting step 1 to the last "You're done when" item, and the sum of the reported tokens. |
| Before you start | Tick the box when every CLI and tool the run used is on the list. Under "Used but not listed", name each one that isn't, or leave `none`. |
| Steps | Tick each Must match item that held. For each If not, write `not used`, `fix worked` or `fix failed`. |
| You're done when | Tick each item that was true at the end. |
| Fresh-eyes findings | Each finding with its step and quoted line, marked fixed, or dismissed with a reason; `none` if the read found nothing or wasn't due. |
| Off-page knowledge | Anything you needed that the page didn't give; `none` otherwise. |
| Differed from the screenshots | Anything on screen that didn't match a You should see image; `none` otherwise. |

Commit the record with the run's results on the tutorial's branch.

## The run fingerprint

The section's fingerprint is 16 hex digits of a SHA-256 over:

- the page's Do and Paste slots, as written and in page order, with each Paste slot's target;
- every file in the tutorial's `starter/` and `check/` folders that the docs build packs into
  its zips, each counted by its git blob id, so a checkout's line endings don't change it.

Wording, captions, Must match, May differ and If not text are left out, so editing them doesn't
call for new runs.

## Working on the script

```powershell
pnpm docs:test        # includes this script's tests, scripts/test-runs/test-runs.test.ts
pnpm docs:typecheck   # includes type-checking this script
```
