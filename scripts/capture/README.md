# Capture script

Takes every screenshot of a tutorial from a built Quay that replays the tutorial's recordings.
It launches Quay against a fixture, attaches with Playwright over WebView2's debugging port, and
takes each step's shots when every replay has reached that step's marker. Agent output in a
shot comes from the recordings and is never edited; annotations are overlays the script draws.

```powershell
pnpm docs:capture <slug> --exe <Quay exe> [--tool <quay-record-replay.exe>] [--port <n>] [--fast <n>] [--by-hand]
```

- `--exe` is the built Quay to capture. At a release that is the draft release's installed
  Quay; otherwise `src-tauri\target\release\tauri-app.exe` from `pnpm tauri build`.
- `--tool` defaults to `tools\record-replay\target\release\quay-record-replay.exe`. Build it
  with `cargo build --release --manifest-path tools/record-replay/Cargo.toml`.
- `--port` is the loopback debugging port, 9333 unless given. The script stops if anything
  already listens on it, so it never attaches to another program.
- `--fast` is the replay speed between shots, 10 unless given, from 1 to 100.
- `--by-hand` is the fallback described [below](#fallbacks).

It writes each still as `NN-<what>.webp` beside the tutorial's page, then the sidecar manifest.
It exits 0 when all of them are written, 1 when the capture fails, and 2 on a bad argument. A
failed capture keeps its fixture folder and prints where it is.

## The capture machine

The script checks these before the first shot and stops with a list of what is off:

- **Windows display scaling at 200%.** Shots are taken at the device pixel ratio, an integer 2,
  and never resized. Quay opens 1280 px wide in CSS pixels, so a still is 2560 px wide.
- **Quay opens 1280 px wide.** A screen too small for 2560 × 1600 physical pixels shrinks the
  window.
- **Cascadia Code installed.** It is the first font in the terminal's font stack.
- **The Windows app theme set to dark.** The script reads it from the registry's
  `AppsUseLightTheme`. The webview's `prefers-color-scheme` does not follow the app theme: on a
  machine set to dark it still reported light, so it can't be the check.

## What the script sets up

Everything is in the environment of the Quay it launches. Nothing goes into Quay's config or a
build, and nothing ships in the product:

| Variable | Value |
| --- | --- |
| `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` | `--remote-debugging-port=<port>`, only in this child's environment. |
| `WEBVIEW2_USER_DATA_FOLDER` | A fresh folder, so this Quay starts its own browser process. See [Established](#established). |
| `LOCALAPPDATA` | A fixture folder holding `Quay2\workspaces.json`. |
| `CLAUDE_CONFIG_DIR` | A copy of `claude-config\` from the tutorial's recordings folder, or an empty folder. Transcripts under its `projects\` give the spend figure. |

The fixture `workspaces.json` has one project on the manifest's neutral project path, by
default `C:\tutorials\<slug>`. Its saved `env_vars` put the folder holding the fake CLIs first
on the terminals' `PATH`, then the system folder, and point the replays at the recordings and a
fresh replay state folder. It also sets `QUAY_RECORD_DIR` to empty, since the test account sets
that variable for every terminal. Quay builds each terminal's environment from the registry and
then applies a project's `env_vars`, so this is the only way the fake CLIs reach its
terminals. The fake CLIs are copies of `quay-record-replay.exe` named after each CLI the
recordings were made with.

The project folder is emptied and the tutorial's starter is copied into it. The script marks a
folder it made with a `<folder>.quay-capture` file beside it, outside the project Quay opens,
and refuses to empty a folder it did not make.

When the capture ends, the script kills Quay with everything it started, and any process still
running from the fixture folder, then removes the fixture.

## Where a tutorial's capture files live

| File | Where |
| --- | --- |
| Recordings | `tools/record-replay/recordings/<slug>/<cli>-<n>.cast.gz` and `.http.jsonl.gz` |
| Capture manifest | `tools/record-replay/recordings/<slug>/capture.json` |
| Fixture Claude config | `tools/record-replay/recordings/<slug>/claude-config/` |
| Stills | `docs/tutorials/<series>/<slug>/NN-<what>.webp`, beside the page |
| Sidecar manifest | `examples/tutorials/<slug>/sidecar.json` |

## The capture manifest

One `capture.json` per tutorial, beside its recordings. It is the only place a shot's
geometry lives: each step marker, the shots taken there, the selectors to wait for, masks,
pinned values and annotations. Selectors are Playwright selectors.

```json
{
  "tutorial": "hello-a2a",
  "steps": [
    { "marker": "01-get-the-starter" },
    {
      "marker": "02-two-agents",
      "actions": [
        { "click": "[title^=\"New Terminal in active project\"]" },
        { "click": "text=Start Terminal (Enter)" }
      ],
      "waitFor": [".xterm"],
      "shots": [
        { "annotations": [{ "target": ".xterm >> nth=0", "label": "1  The agent you asked" }] },
        { "name": "02-two-agents-pane", "pane": ".xterm >> nth=0" }
      ]
    },
    {
      "marker": "03-reply",
      "actions": [{ "press": "Enter", "in": ".xterm-helper-textarea >> nth=0" }],
      "realTime": true,
      "shots": [{ "mask": [".elapsed"], "pin": [{ "selector": "button[aria-label=\"Token Spend & Chimes\"] >> text=$0.00", "text": "$0.42" }] }]
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `tutorial` | The tutorial's slug, the folder the manifest sits in. |
| `project` | The neutral project path the recordings were made on. Default `C:\tutorials\<slug>`. Never under a user profile. |
| `steps[].marker` | The step marker, `NN-<what>`. Steps are listed in step order, one per number. Every marker in a recording needs a step here. |
| `steps[].actions` | What the learner does in the step, in order: `{ "click": <selector> }`, `{ "press": <key>, "in": <selector> }`, `{ "fill": <selector>, "text": <text> }` or `{ "type": <text>, "in": <selector> }`. Typing in a terminal goes to its `.xterm-helper-textarea`. A replay waits for a live Enter wherever its recording has one, so a prompt the learner typed needs a `press` of `Enter`. |
| `steps[].waitFor` | Selectors that must be visible before the shots. |
| `steps[].timeout` | Seconds for the actions, the replays and `waitFor`. Default 120. |
| `steps[].realTime` | Plays the replays in real time from the previous marker to this one, the window a clip needs. |
| `steps[].shots` | Left out, one full-window shot named after the marker. |
| `shots[].name` | The still's name, starting with the step's number. Default the marker. |
| `shots[].pane` | A selector for the one pane to capture. Left out, the full window. |
| `shots[].mask` | Selectors masked in the shot. The rail's bridge-port badge is always masked. |
| `shots[].pin` | `{ selector, text }` values in Quay's own UI shown fixed for the shot. Each is an overlay that covers the element with the text in its own font, colour and background; Quay's DOM is never changed. A pin over a terminal is refused: agent output is never edited. |
| `shots[].annotations` | `{ target, label }` overlays: an outline around the target and an optional label. |

## How a capture runs

The replays share files in the replay state folder with the script, as
`tools/record-replay/README.md` describes: the speed they play at, the marker they hold at, and
the markers each has reached. For each step, the script:

1. Sets the speed to real time if the step is `realTime`.
2. Names the step's marker as the one to hold at. That releases the replays from the previous
   marker.
3. Does the step's actions.
4. Waits until every replay whose recording has the marker has reached it. A recording that
   opens on a marker, because its terminal started after that step was marked, is not waited
   for at that marker; its terminal starts during the next step.
5. Puts the speed back to `--fast`, waits for `waitFor`, the fonts, and the terminals to stop
   changing for half a second.
6. Takes each shot: WebP at quality 90, at device scale, with animations stopped, the caret
   hidden, the port badge and `mask` selectors masked, and pins and annotations drawn as
   overlays, which are removed after the shot, whether it succeeded or not.

When a replay doesn't reach the marker in time, the error names it and says whether no terminal
has played it yet (the step's actions didn't open it) or it is waiting (often for an Enter the
actions should press), with anything the replays reported, such as bridge calls the live bridge
refused.

## The sidecar manifest

`examples/tutorials/<slug>/sidecar.json`, written after the last shot:

```json
{
  "tutorial": "hello-a2a",
  "quayVersion": "0.3.0",
  "capturedOn": "2026-10-21",
  "recordedOn": "2026-10-19",
  "cliVersions": { "claude": "2.1.0 (Claude Code)" }
}
```

- `quayVersion` comes from the running Quay over Tauri IPC (`app.getVersion`), or in a capture
  by hand from the exe's version resource. The docs build's release check reads it.
- `recordedOn` is the UTC date the earliest recording started, from its header's `timestamp`,
  so it reads the same on every machine. `capturedOn` is the capture machine's local date.
- `cliVersions` is each CLI's `--version` from the recorded run, from the headers'
  `cli_version`. Recordings of one CLI made with two versions are an error.

The quarterly sweep reads all of it and lists it beside each tutorial it finds due
(`scripts/test-runs/README.md`). The failed-run notice on a tutorial's page takes its CLI
versions from the test-run record, not from here.

## Fallbacks

- **By hand.** `--by-hand` builds the same fixture and launches Quay without a debugging port.
  For each step it holds the replays at the marker as usual, prints the actions to do and the
  shots to take, and waits for Enter. Take each shot of Quay's client area only, with ShareX or
  Snipping Tool, on the pinned capture machine, and blur the port badge and any masks. It
  writes the sidecar like a scripted capture.
- **`tauri-driver`.** If CDP attach breaks, `tauri-driver` with a `msedgedriver` that matches
  the WebView2 runtime drives a built Quay over WebDriver (`cargo install tauri-driver
  --locked`). WebDriver has no masks, animation freeze or caret hiding, so those would be
  injected scripts. Not built.

## Established

Two questions the screenshot research left open, answered against a release build of Quay
with WebView2 155:

- **A debugging port with another Quay on the same WebView2 folder: it doesn't work.** With one
  Quay running on a folder, a second Quay on the same folder that asks for a debugging port
  exits at once with `0xC0000409` and never opens the port. The first Quay's browser process is
  untouched. A second Quay on the same folder without the port runs fine, so the mismatched
  browser arguments are the cause. A normal Quay runs on the default folder, which is why every
  capture gets a fresh `WEBVIEW2_USER_DATA_FOLDER`.
- **Why the CDP `deviceScaleFactor` override seemed ignored: Playwright resets it.**
  `Emulation.setDeviceMetricsOverride` with `deviceScaleFactor: 2` does take effect: the page
  reports a device pixel ratio of 2, and a raw CDP `Page.captureScreenshot` comes back
  2560 × 1600 on a 250% display. Each Playwright `page.screenshot` or `locator.screenshot`
  puts the page back to the display's real ratio, so the research read 2.5 after its
  screenshots. That is why the capture machine pins 200% scaling rather than overriding it.

Also seen: the debugging port listens on `127.0.0.1` only.

## Limits

- Quay's own views of the project folder, such as diffs and git state, show the starter as it
  was copied, not the files the recorded agents wrote; replays don't touch the disk.
- Clips from the CDP screencast (#101) and the changed-shot report (#102) build on this script
  and are not in it yet. `realTime` already plays a clip's window at real speed.

## Tests

```powershell
pnpm docs:test
pnpm docs:typecheck
```

`capture.test.ts` covers the parts that need no Quay: the arguments, the manifest, reading the
recordings, which replays each step waits for, the fixture workspace, the machine check and
the sidecar. The parts that drive Quay need a built Quay on a pinned machine and are checked
by running a capture.
