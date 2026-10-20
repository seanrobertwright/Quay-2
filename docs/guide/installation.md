# Installation & Setup

This guide covers installing **Quay 2** on Windows, from the release installer or from source, then the agent CLIs it runs and the event-bridge plugin that lets Quay see what Claude Code is doing.

---

## System Requirements

- **Operating System**: Windows 10 (Version 1809 / Build 17763 or newer) or Windows 11.
  - Native Windows ConPTY is required and built into modern Windows builds.
- **Architecture**: `x86_64` (AMD64) or `aarch64` (ARM64 Windows).
- **RAM**: 8 GB minimum (16 GB+ recommended for running multi-agent swarms).
- **Disk Space**: 500 MB for Quay 2 binary and runtime caches.

---

## Installing a Release

Download the Windows installer from the latest release on the [Releases page](https://github.com/seanrobertwright/Quay-2/releases/latest): `Quay_<version>_x64-setup.exe`, or `Quay_<version>_x64_en-US.msi` if you prefer an MSI. Run it and start **Quay** from the Start menu.

Then install the [agent CLIs](#agent-clis) you plan to run and, for Claude Code, the [event-bridge plugin](#event-bridge-plugin).

---

## Building from Source

### Toolchain Prerequisites

#### 1. Visual Studio C++ Build Tools

The Rust compiler on Windows requires MSVC C++ build tools.

- Download from the [Visual Studio Downloads page](https://visualstudio.microsoft.com/downloads/) or install via `winget`:

  ```powershell
  winget install Microsoft.VisualStudio.2022.BuildTools --override "--passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
  ```

#### 2. Rust Toolchain (1.85+)

Install the official Rust toolchain via `rustup`:

```powershell
# In PowerShell:
Invoke-WebRequest -Uri "https://win.rustup.rs" -OutFile "$env:TEMP\rustup-init.exe"
& "$env:TEMP\rustup-init.exe" -y --default-host x86_64-pc-windows-msvc --default-toolchain stable
```

Verify the installation:

```powershell
rustc --version
cargo --version
```

#### 3. Node.js (20+ or 24+ LTS) & pnpm

Install Node.js:

```powershell
winget install OpenJS.NodeJS.LTS
```

Enable `pnpm` globally:

```powershell
npm install -g pnpm
pnpm --version
```

#### 4. Git & GitHub CLI (`gh`)

```powershell
winget install Git.Git
winget install GitHub.cli

# Authenticate GitHub CLI for the GitHub Companion Drawer
gh auth login
```

### Step 1: Clone the Repository

```powershell
git clone https://github.com/seanrobertwright/Quay-2.git
cd Quay-2
```

### Step 2: Install Node Dependencies

```powershell
pnpm install
```

### Step 3: Run Desktop App in Development Mode

```powershell
pnpm tauri dev
```

- Vite starts the frontend live-reload server at `http://localhost:1420`.
- Cargo compiles the Rust backend in unoptimized debug mode.
- The desktop window launches automatically with active file watchers on `src/` and `src-tauri/`.

### Packaging a Release Binary

To generate an optimized, standalone Windows executable:

```powershell
pnpm tauri build
```

This compiles Quay 2 with full Link-Time Optimization (`lto = true`), symbol stripping, and optimizations (`opt-level = 3`).

Output artifacts:

- **Standalone Executable**: `src-tauri/target/release/tauri-app.exe`
- **Windows Installer (`.msi` / `.exe`)**: `src-tauri/target/release/bundle/nsis/` or `bundle/msi/`

### Verifying the Build

Run the test suites to confirm full platform compatibility:

```powershell
# Verify TypeScript types:
pnpm tsc --noEmit

# Run Rust unit tests:
cargo test --manifest-path src-tauri/Cargo.toml
```

---

## Agent CLIs

Quay runs the coding CLIs you install; it doesn't bundle them. This applies the same way to a release install and a source build. Quay starts each CLI by name, so it has to be on your `PATH`.

### Claude Code

Install Claude Code with its native installer, in PowerShell:

```powershell
irm https://claude.ai/install.ps1 | iex
```

Quay needs Claude Code 2.1.296 or later. Check the version:

```powershell
claude --version
```

Then run `claude` once in a terminal and sign in. Quay's Claude terminals use that sign-in.

Install the [event-bridge plugin](#event-bridge-plugin) next. Without it Quay can't see a Claude terminal's status or replies.

### Other CLIs

Install the other CLIs you plan to supervise with their own instructions. For example:

```powershell
# Aider:
pip install aider-chat
```

---

## Event-bridge Plugin

The event-bridge plugin sends Claude Code's events to Quay. Quay reads a Claude terminal's status from them (Starting, Working, Waiting, Idle) and takes a Claude peer's replies from them, and the plugin brings Claude Code's tool approvals to Quay. Quay sets the address, token and terminal tag the plugin uses when it starts Claude Code, so the plugin needs no configuration.

Install it:

```powershell
claude plugin install event-bridge --marketplace seanrobertwright/claude-mod-events
```

In a Claude Code session that was already running, run `/reload-plugins` to load it.

To check it, run `/plugin` in Claude Code: event-bridge should be listed as installed and enabled.

To update it:

```powershell
claude plugin update event-bridge@event-bridge
```

### When Quay hears nothing

A Claude terminal shows **Starting** until Quay hears from the plugin. If 30 seconds pass after the terminal's first output with no event, the terminal shows **Unknown** and its pane shows the plugin hint. A Claude Code prompt left open longer than that brings the hint up too: answer the prompt and the hint clears as soon as the plugin speaks. If the plugin isn't installed, install it with the line above and run `/reload-plugins` in that terminal.

### Other causes {#other-causes}

Each of these keeps an installed plugin from running, with its fix:

- **The plugin is disabled in `/plugin`.** Enable event-bridge there, then run `/reload-plugins`.
- **The terminal started Claude Code with `--bare`.** That flag turns plugins off. A relaunch reuses the terminal's flags, so open a new Claude terminal without it. If it came from the workspace's default flags, remove it there first.
- **The terminal started Claude Code with `--safe-mode`.** That flag turns plugins off too. Start a new Claude terminal without it, the same way.
- **`disableAllHooks` is set in your Claude Code settings.** It stops the plugin's hooks. Remove the setting or set it to `false`, then relaunch the terminal.
- **Your organization sets `allowManagedModsOnly`.** Only mods your organization manages can load. Ask whoever manages Claude Code for your organization to add the event-bridge plugin.
- **Claude Code is older than 2.1.287.** Update it by running the native installer again, and check with `claude --version`.

To check whether Claude Code can load mods at all, run:

```powershell
claude plugin test
```
