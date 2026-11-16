# Complete Keyboard Shortcuts Reference

Quay 2 is engineered for complete keyboard navigability. Inspired by `tmux`, all primary window, stage, and tool commands use the `Ctrl+Shift+B` prefix chord: press `Ctrl+Shift+B`, let go, then press the next key within a second and a half.

- **Press the second key without `Ctrl`.** A `Ctrl` key, such as `Ctrl+A`, ends the prefix and goes to the terminal as typed, so it never runs a chord by accident. `Shift` and the other modifier keys do not end it, so `Ctrl+Shift+B %` and `Ctrl+Shift+B "` work.
- **A key that is not a chord** ends the prefix and goes to the terminal as typed.
- **Text fields:** in an input box, such as a modal's branch name field, `Ctrl+Shift+B` does not start a chord and keys are typed as usual.
- **Command palette:** `Ctrl+Shift+P` opens it from anywhere. `Ctrl+K` opens it too when a terminal does not have focus; in a terminal, `Ctrl+K` goes to the shell.

## Inside a Terminal

While a terminal pane has focus, the shell's control keys reach it, as in any other terminal. `Ctrl+A`, `Ctrl+B`, `Ctrl+K` and `Ctrl+X` go to the shell, so readline, vim, emacs, tmux and Claude Code get the keys they expect.

| Shortcut | Action | Description |
| :--- | :--- | :--- |
| `Ctrl+C` | **Copy or interrupt** | Copies the selection when text is selected, otherwise sends `^C` to the shell |
| `Ctrl+V` | **Paste** | Pastes the clipboard into the shell |
| `Ctrl+Shift+C` | **Copy** | Copies the selection and never sends `^C` |
| `Ctrl+Shift+V` | **Paste** | Pastes the clipboard into the shell |
| `Ctrl+F` | **Search** | Opens or closes the pane's scrollback search |

---

## Workspace & Terminal Switching

| Shortcut | Action | Description |
| :--- | :--- | :--- |
| `Ctrl+Shift+B N` | **New Terminal** | Opens the terminal launcher dialog |
| `Ctrl+Shift+B 1` | **Switch to Terminal 1** | Directly activate terminal in slot 1 |
| `Ctrl+Shift+B 2` | **Switch to Terminal 2** | Directly activate terminal in slot 2 |
| `Ctrl+Shift+B 3` | **Switch to Terminal 3** | Directly activate terminal in slot 3 |
| `Ctrl+Shift+B 4` | **Switch to Terminal 4** | Directly activate terminal in slot 4 |
| `Ctrl+Shift+B 5` | **Switch to Terminal 5** | Directly activate terminal in slot 5 |
| `Ctrl+Shift+B 6` | **Switch to Terminal 6** | Directly activate terminal in slot 6 |
| `Ctrl+Shift+B 7` | **Switch to Terminal 7** | Directly activate terminal in slot 7 |
| `Ctrl+Shift+B 8` | **Switch to Terminal 8** | Directly activate terminal in slot 8 |
| `Ctrl+Shift+B 9` | **Switch to Terminal 9** | Directly activate terminal in slot 9 |
| `Alt+1` .. `9` | **Fast Jump** | One-stroke switcher to terminals 1 through 9 |

---

## Tiling Stage & Splits

| Shortcut | Action | Description |
| :--- | :--- | :--- |
| `Ctrl+Shift+B %` | **Split Horizontal** | Splits the active viewport side-by-side (50% / 50%) |
| `Ctrl+Shift+B "` | **Split Vertical** | Splits the active viewport top-and-bottom (50% / 50%) |
| `Ctrl+Shift+B G` | **Quad Grid** | Arranges 4 terminals into a 2x2 grid |
| `Ctrl+Shift+B Z` | **Toggle Zoom** | Maximizes active pane to full stage, or restores previous split |
| `Ctrl+Shift+B O` | **Cycle Focus** | Moves keyboard focus clockwise to next visible pane |
| `Ctrl+Shift+B X` | **Unsplit** | Collapses splits back to single active view |
| `Ctrl+Shift+B S` | **Swarm builder** | Opens the swarm builder in a stage tab: every swarm preset and the custom roster. Launching a swarm closes the tab |

---

## Development Tools & Engineering Drawers

| Shortcut | Action | Description |
| :--- | :--- | :--- |
| `Ctrl+Shift+B W` | **Create Worktree** | Opens Git Worktree branch creation dialog |
| `Ctrl+Shift+B D` | **Diff lens** | Opens the diff lens on the selected terminal's pull request; with no pull request linked, opens the Source control panel and its repo-wide Diffs, the Visual Diff & File Changes drawer: a log of agents' Edit and Write tool calls |
| `Ctrl+Shift+B I` | **Source control** | Opens the Source control panel: the repository's pull requests and issues, Topos, Diffs and Pre-PR Audit. Picking a pull request or issue opens it in the companion for the selected terminal |
| `Ctrl+Shift+B A` | **Pre-PR Audit** | Opens the Source control panel and runs the Pre-PR Audit Gate: scans changed file names and the git diff for secrets, key files and personal paths |
| `Ctrl+Shift+B H` | **Session History** | Opens the Agents panel on its Session history: search the project's Claude Code sessions, at most 100, and **Resume** one |
| `Ctrl+Shift+B Q` | **Next waiting terminal** | Selects the next terminal waiting on you, the next amber dot in the module bar's terminal status list. Every session waiting on you is a row in the Agents panel's **Waiting on you**; picking a permission request there opens it in the companion's Activity view, with **Allow once**, **Allow for session** and **Deny**. The count on the module bar's **Agents** icon shows how many wait |
| `Ctrl+Shift+B T` | **Token Spend** | Opens token meter and audio chime settings |
| `Ctrl+Shift+B R` | **Workflows** | Opens the Workflows panel: the engine strip, then Archon runs, [Machina](../features/machina-praxis.md) work orders and Praxis runs under **Needs you**, **Running** and **Recent**, with **Start** between them. Picking one shows its decision in the companion's Run view |
| `Ctrl+Shift+B F` | **Engine strip** | Opens the Workflows panel with its engine strip focused: Archon online or offline, the Factory's Active or Paused switch, Halt (press twice), today's Factory spend and Praxis sign-in |
| `Ctrl+Shift+B P` | **Praxis Builder** | Opens the [Praxis Builder](../features/praxis-builder.md) stage tab, which lists the project's `.praxis/` definitions and shows a graph you can edit on the canvas and in the companion's Inspector, undo with `Ctrl+Z`, redo with `Ctrl+Shift+Z` or `Ctrl+Y`, and save with `Ctrl+S` (`Cmd` on macOS). `Ctrl+F` goes to a node by id or kind, and `Tab`, `Enter`, the arrow keys and `Delete` work the canvas without a mouse. Press `?` in the canvas for the rest of its keys |
| `Ctrl+Shift+B C` | **Topos** | Opens the Topos view, the Git cockpit, in the companion for the selected terminal's repository. Its **Wide** toggle opens it as the Topos lens over the terminal. It needs git 2.36 or newer |
| `Ctrl+Shift+B M` | **Activity** | Opens the Activity view in the companion for the selected terminal: its tool calls and messages, its pending permission request, and a message strip that sends it a task. Broadcast to all agents is in the command palette |
| `Ctrl+Shift+P` | **Command Palette** | Opens global command launcher and searchable palette. `Ctrl+K` also opens it outside a terminal |
| `Esc` | **Dismiss / Close** | Closes any open modal, dialog, or drawer |

The Diff Inspector is not a branch diff. It lists the Edit and Write tool calls in the newest 500 or so events Quay has received from the event-bridge plugin since it started.
