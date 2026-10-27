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
| `Ctrl+Shift+B S` | **Swarm Launcher** | Opens 1-click multi-agent swarm preset modal |

---

## Development Tools & Engineering Drawers

| Shortcut | Action | Description |
| :--- | :--- | :--- |
| `Ctrl+Shift+B W` | **Create Worktree** | Opens Git Worktree branch creation dialog |
| `Ctrl+Shift+B D` | **Diff Inspector** | Opens the Visual Diff & File Changes drawer: a log of agents' Edit and Write tool calls |
| `Ctrl+Shift+B I` | **GitHub Companion** | Toggles GitHub Issues & PR triage drawer |
| `Ctrl+Shift+B A` | **Pre-PR Audit** | Runs the Pre-PR Audit Gate: scans changed file names and the git diff for secrets, key files and personal paths |
| `Ctrl+Shift+B H` | **Session History** | Opens Claude Code session history and auto-resumer |
| `Ctrl+Shift+B T` | **Token Spend** | Opens token meter and audio chime settings |
| `Ctrl+Shift+B R` | **Archon & SDD** | Opens Archon visual DAG, streaming logs, and spec inspector |
| `Ctrl+Shift+B F` | **Machina** | Opens native AI Software Factory cockpit |
| `Ctrl+Shift+B P` | **Praxis Builder** | Toggles the Praxis Builder, which lists the project's `.praxis/` definitions and shows a graph you can edit on the canvas and in the inspector, and save with `Ctrl+S` |
| `Ctrl+Shift+B M` | **Mission Control** | Opens Mission Control, where you send messages to agents on the A2A bus and read its message trail |
| `Ctrl+Shift+P` | **Command Palette** | Opens global command launcher and searchable palette. `Ctrl+K` also opens it outside a terminal |
| `Esc` | **Dismiss / Close** | Closes any open modal, dialog, or drawer |

The Diff Inspector is not a branch diff. It lists the Edit and Write tool calls in the newest 500 or so events Quay has received from the event-bridge plugin since it started.
