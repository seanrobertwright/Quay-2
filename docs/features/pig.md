# PiG (Pi in Go)

PiG is a Go port of the Pi coding agent. Quay treats it as its own kind of terminal, next to Pi, not as a replacement for Pi. Unlike a Pi terminal, a PiG terminal is a full peer on the [A2A bus](./a2a-orchestration.md).

Quay was tested with **PiG 0.5.1** on Windows 11. PiG is still at 0.x and changes quickly, and its Windows build is marked as a preview upstream.

---

## Install and Sign In

Install PiG one of three ways:

- **npm:** `npm i -g @pi-in-go/pig`.
- **The install script:** `irm https://pi-in-go.dev/install.ps1 | iex` in PowerShell, then add the folder that holds `pig.exe` to your `PATH`. Quay's live check used this route, with PiG in `%LOCALAPPDATA%\Programs\pig`.
- **Go:** `go install github.com/MichaelKinsy/PiG/cmd/pig@latest`, which puts `pig.exe` in `%USERPROFILE%\go\bin` unless you've set `GOBIN` or `GOPATH`. Quay looks in that default folder; if Go put PiG somewhere else, add that folder to your `PATH`.

Then run `pig login` once. **PiG doesn't use Pi's sign-in.** It keeps its settings, sign-in and sessions in `~/.pig` and doesn't read Pi's `~/.pi` unless you opt in with `PIG_USE_PI_DIRS=1`, so signing in to Pi doesn't sign you in to PiG.

If you sign in with an Anthropic subscription, PiG warns on start that "third-party harness usage draws from extra usage and is billed per token, not your Claude plan limits." Running PiG in Quay doesn't change that.

### How Quay Finds PiG

Quay looks for `pig.exe` in this order:

1. in a folder on the terminal's `PATH`;
2. behind npm's `pig.cmd` shim on `PATH`, where npm keeps the real `pig.exe`;
3. in `go\bin` in your home folder.

Quay starts `pig.exe` directly, never through `cmd.exe` or npm's shim. If it can't find PiG, the terminal's pane says how to install it and the terminal exits. Quay never installs PiG for you.

---

## Launching a PiG Terminal

Pick **PiG** in the **New Terminal** dialog (`Ctrl+Shift+B N`), or **New PiG (Pi in Go) Agent** in the command palette. The terminal is named `pig` unless you name it.

The **Model** list has these presets:

| Preset | Flag |
| :--- | :--- |
| Default (PiG's configured model) | none |
| Claude Sonnet, latest (Thinking High) | `--model sonnet:high` |
| Claude Opus, latest | `--model opus` |
| High Thinking Mode | `--thinking high` |
| Max Thinking Mode | `--thinking max` |

Anything else goes in **Custom CLI Arguments**. A starting prompt is passed to PiG on its command line, so PiG starts working on it as soon as it opens.

**Relaunch** starts a new PiG session. It keeps the terminal's custom arguments but doesn't send the starting prompt again. To pick up where you left off, add `-c` to the custom arguments. It continues the newest PiG session in the project folder, which may belong to another PiG terminal in the same folder.

---

## Why There's No Skip / Ask Toggle

Other agents offer **Skip Permissions** or **Interactive Approvals**. PiG has no approval prompts: it never asks before a tool call, so there is nothing to skip. The dialog shows no toggle for PiG, and it always warns that PiG runs shell tools and edits on its own.

PiG's `-a` (`--approve`) flag is a different thing. It trusts the project's own `.pig/` files, such as local settings, MCP config and extensions, for that run. Quay never passes it. Add it to the custom arguments if you want PiG to load those files.

---

## On the A2A Bus: a Full Peer

Quay loads its own PiG extension into each PiG terminal, with PiG's `-e` flag. The extension is a small program, `quay-pig-bridge.exe`, that ships beside Quay. Quay writes nothing to `~/.pig` or to your project to set it up. The extension keeps a short log, `pig-bridge.log`, in Quay's data folder, which names each event it sends and never the text of an answer.

The extension does two jobs:

- It gives PiG Quay's MCP server, so PiG can call `quay_list_agents`, `quay_send_message`, `quay_get_agent_status` and the other [MCP tools](./a2a-orchestration.md#the-mcp-tools).
- It tells Quay when each PiG turn starts and ends, with PiG's answer. So the terminal shows **Working** and **Idle**, a message sent to PiG mid-turn waits as **Queued** until the turn ends, and a sender using `wait_for_reply` gets PiG's answer.

The terminal shows **Starting** until Quay first hears from the extension.

### The Listener Tag

If Quay hasn't heard from the extension 30 seconds after PiG's first output, the terminal turns **Unknown** and Mission Control tags it **Listener**. Its tooltip reads: "Quay's PiG extension isn't reporting. Quay was tested with PiG 0.5.1; run pig --version to compare."

A listener still gets messages typed into its prompt, but Quay can't read its reply, so a sender who waits is told at once that no reply will come. It has no `quay_*` tools either. The most likely cause is a PiG release that changed how extensions work, so run `pig --version` and compare it with 0.5.1. If the extension starts reporting later, the terminal is a full peer again.

---

## Swarms

PiG can fill any seat in a [custom swarm](./swarm-presets.md#your-swarms). Pick **PiG (Pi in Go)** as the seat's CLI. Like the other agents that take a starting prompt, it gets its role prompt when the swarm launches.

None of the built-in presets has a PiG seat. A one-click preset shouldn't depend on a 0.x CLI that most people don't have installed.

---

## Machina

PiG can author a [Machina](./machina-praxis.md) work order. Machina measures its spend from PiG's own session files for the work order's worktree, using the cost figures PiG writes, so the budget hold works as it does for Claude Code. A subscription sign-in records those figures too: in the live check, PiG's footer showed `$0.174 (sub)` and the work order showed "$0.17 of $1.01". Before PiG has run, the work order's note reads "No PiG sessions for this worktree yet."

Machina looks for PiG's sessions where PiG keeps them by default, in `~/.pig`, and follows PiG's `PIG_HOME`, `PIG_CODING_AGENT_DIR` and `PIG_CODING_AGENT_SESSION_DIR` variables. It doesn't follow `--session-dir` or PiG's `sessionDir` setting. With `--no-session`, PiG writes no session files at all. Either way the work order's spend reads $0, so leave those out of a work order's custom arguments.

When PiG finishes, it hands its work back for the gate:

- While Quay is hearing from the PiG extension, PiG submits its work itself with `machina_submit_deliverable`. If the gate passes, Machina types the verdict into PiG's terminal and the work order moves to **Awaiting merge**.
- If the extension isn't reporting when Machina sends the brief, the brief asks PiG to say it's done and stop instead, and you run the gate yourself.

---

## Known Issues on Windows

- **PiG's `bash` tool needs a bash shell.** PiG finds Git Bash in Git for Windows' default install folder (`Program Files\Git\bin\bash.exe`), or any `bash` on your `PATH`, or the shell named in PiG's own `shellPath` setting. Without one, PiG says "No bash shell found" and has only its file tools. Quay doesn't change PiG's settings for you.
- **PiG's `powershell` tool is off by default.** PiG starts with `read`, `bash`, `edit` and `write`. Add `powershell` to the `defaultTools` list in PiG's own settings if you want it.
- **TypeScript extensions you add yourself need Node.js 22.13 or newer.** Quay's own extension is a native program and needs nothing extra.

---

## Troubleshooting

| You see | Why | What to do |
| :--- | :--- | :--- |
| The pane says "PiG isn't installed" | Quay found no `pig.exe` on `PATH`, behind npm's shim, or in `go\bin` | Install PiG, or add the folder that holds `pig.exe` to `PATH`, then relaunch |
| PiG asks you to sign in | PiG has its own sign-in, separate from Pi's | Run `pig login` |
| A **Listener** tag on a PiG terminal | Quay's PiG extension isn't reporting | Run `pig --version` and compare it with 0.5.1 |
| PiG exits at once with `Hint: Start without extensions using "pig -ne"` | PiG couldn't find Quay's extension, which ships beside Quay | Reinstall Quay |
| "No bash shell found" | No Git Bash or other bash where PiG looks | Install Git for Windows, or set `shellPath` in PiG's settings |
| A PiG work order's spend stays at $0 | PiG wrote no session files, or wrote them where Machina doesn't look | Remove `--no-session` or `--session-dir` from the custom arguments |
