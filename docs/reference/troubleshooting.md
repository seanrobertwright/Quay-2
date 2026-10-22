# Troubleshooting & FAQ

Common questions, troubleshooting steps, and operational guidance for **Quay 2**.

---

## 1. ConPTY & Terminal Rendering

### Issue: Characters or Unicode Emojis Seem Offset or Misaligned
**Solution**:
- Quay 2 incorporates a custom xterm.js Unicode 11 emoji width provider.
- Ensure `@xterm/xterm` has proposed APIs enabled so the custom width provider can measure 2-cell wide glyphs properly.
- Verify your Windows Terminal font supports full Nerd Font or Powerline glyphs (e.g. *Cascadia Code NF*, *JetBrains Mono NF*).

### Issue: Terminal Shows Blank Screen or Hangs on Spawn
**Solution**:
- Verify you are running on Windows 10 (1809+) or Windows 11. ConPTY is unsupported on Windows 7 / 8.
- Ensure the target executable (e.g. `claude.exe`, `pwsh.exe`) is accessible on your system `PATH`.
- Check `%LOCALAPPDATA%\Quay2\logs\` for any process spawn exceptions.

---

## 2. Agent-to-Agent (A2A) Bus

### Issue: Claude Does Not See `quay_list_agents` or `quay_send_message`
**Solution**:
- Claude Code must be launched through Quay 2 so that `--mcp-config` can be injected automatically.
- Verify your local firewall is not blocking loopback traffic to `127.0.0.1`.
- In Claude Code, enter `/mcp` to list active servers; verify `quay` is connected.

---

## 3. GitHub Companion Drawer

### Issue: GitHub Issues Show Error "Failed to execute gh issue list"
**Solution**:
- The GitHub Companion requires the official GitHub CLI (`gh`).
- Install `gh` via `winget install GitHub.cli`.
- In a terminal, run `gh auth login` to authenticate with your GitHub account.
- Run `gh auth status` to confirm your session is valid.

---

## 4. Archon & SDD Graph

### Issue: Archon Graph Modal Displays "Archon is not running on localhost:3090"
**Solution**:
- Archon runs as a local background daemon.
- In PowerShell, run `archon start` or start your Archon container/service on port 3090.
- Quay 2 will automatically detect the active daemon and load recent workflow DAGs.
