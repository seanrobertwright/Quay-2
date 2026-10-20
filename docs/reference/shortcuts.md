# Complete Keyboard Shortcuts Reference

Quay 2 is engineered for complete keyboard navigability. Inspired by `tmux`, all primary window, stage, and tool commands use the `Ctrl+B` prefix chord.

Quay 2 swallows the `Ctrl+B` prefix, as tmux does, so the focused terminal pane never receives it. Pressing `Ctrl+B` in a Claude Code pane starts the chord and does not background the running task.

---

## Workspace & Terminal Switching

| Shortcut | Action | Description |
| :--- | :--- | :--- |
| `Ctrl+B N` | **New Terminal** | Opens the terminal launcher dialog |
| `Ctrl+B 1` | **Switch to Terminal 1** | Directly activate terminal in slot 1 |
| `Ctrl+B 2` | **Switch to Terminal 2** | Directly activate terminal in slot 2 |
| `Ctrl+B 3` | **Switch to Terminal 3** | Directly activate terminal in slot 3 |
| `Ctrl+B 4` | **Switch to Terminal 4** | Directly activate terminal in slot 4 |
| `Ctrl+B 5` | **Switch to Terminal 5** | Directly activate terminal in slot 5 |
| `Ctrl+B 6` | **Switch to Terminal 6** | Directly activate terminal in slot 6 |
| `Ctrl+B 7` | **Switch to Terminal 7** | Directly activate terminal in slot 7 |
| `Ctrl+B 8` | **Switch to Terminal 8** | Directly activate terminal in slot 8 |
| `Ctrl+B 9` | **Switch to Terminal 9** | Directly activate terminal in slot 9 |
| `Alt+1` .. `9` | **Fast Jump** | One-stroke switcher to terminals 1 through 9 |

---

## Tiling Stage & Splits

| Shortcut | Action | Description |
| :--- | :--- | :--- |
| `Ctrl+B %` | **Split Horizontal** | Splits the active viewport side-by-side (50% / 50%) |
| `Ctrl+B "` | **Split Vertical** | Splits the active viewport top-and-bottom (50% / 50%) |
| `Ctrl+B G` | **Quad Grid** | Arranges 4 terminals into a 2x2 grid |
| `Ctrl+B Z` | **Toggle Zoom** | Maximizes active pane to full stage, or restores previous split |
| `Ctrl+B O` | **Cycle Focus** | Moves keyboard focus clockwise to next visible pane |
| `Ctrl+B X` | **Unsplit** | Collapses splits back to single active view |
| `Ctrl+B S` | **Swarm Launcher** | Opens 1-click multi-agent swarm preset modal |

---

## Development Tools & Engineering Drawers

| Shortcut | Action | Description |
| :--- | :--- | :--- |
| `Ctrl+B W` | **Create Worktree** | Opens Git Worktree branch creation dialog |
| `Ctrl+B D` | **Git Diff** | Opens visual git diff and file change viewer |
| `Ctrl+B I` | **GitHub Companion** | Toggles GitHub Issues & PR triage drawer |
| `Ctrl+B A` | **Pre-PR Audit** | Runs secret scanner and destructive command audit gate |
| `Ctrl+B H` | **Session History** | Opens Claude Code session history and auto-resumer |
| `Ctrl+B T` | **Token Spend** | Opens token meter and audio chime settings |
| `Ctrl+B R` | **Archon & SDD** | Opens Archon visual DAG, streaming logs, and spec inspector |
| `Ctrl+B F` | **Machina Praxis** | Opens native AI Software Factory cockpit |
| `Ctrl+B M` | **Mission Control** | Opens Mission Control, where you send messages to agents on the A2A bus and read its message trail |
| `Ctrl+K` | **Command Palette** | Opens global command launcher and searchable palette |
| `Esc` | **Dismiss / Close** | Closes any open modal, dialog, or drawer |
