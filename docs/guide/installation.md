# Installation & Setup

This guide details the system prerequisites and step-by-step instructions to install, build, and run **Quay 2** on Windows.

---

## System Requirements

- **Operating System**: Windows 10 (Version 1809 / Build 17763 or newer) or Windows 11.
  - Native Windows ConPTY is required and built into modern Windows builds.
- **Architecture**: `x86_64` (AMD64) or `aarch64` (ARM64 Windows).
- **RAM**: 8 GB minimum (16 GB+ recommended for running multi-agent swarms).
- **Disk Space**: 500 MB for Quay 2 binary and runtime caches.

---

## Toolchain Prerequisites

Before building Quay 2 from source, verify you have installed the required development toolchains:

### 1. Visual Studio C++ Build Tools
The Rust compiler on Windows requires MSVC C++ build tools.
- Download from the [Visual Studio Downloads page](https://visualstudio.microsoft.com/downloads/) or install via `winget`:
  ```powershell
  winget install Microsoft.VisualStudio.2022.BuildTools --override "--passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
  ```

### 2. Rust Toolchain (1.85+)
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

### 3. Node.js (20+ or 24+ LTS) & pnpm
Install Node.js:
```powershell
winget install OpenJS.NodeJS.LTS
```
Enable `pnpm` globally:
```powershell
npm install -g pnpm
pnpm --version
```

### 4. Git & GitHub CLI (`gh`)
```powershell
winget install Git.Git
winget install GitHub.cli

# Authenticate GitHub CLI for the GitHub Companion Drawer
gh auth login
```

### 5. AI Agent CLIs (Optional but Recommended)
Install the autonomous coding CLIs you plan to supervise:
```powershell
# Claude Code:
npm install -g @anthropic-ai/claude-code

# Antigravity CLI:
# Follow Antigravity installation instructions

# Aider:
pip install aider-chat
```

---

## Building from Source

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

---

## Packaging a Release Binary

To generate an optimized, standalone Windows executable:

```powershell
pnpm tauri build
```

This compiles Quay 2 with full Link-Time Optimization (`lto = true`), symbol stripping, and optimizations (`opt-level = 3`).

Output artifacts:
- **Standalone Executable**: `src-tauri/target/release/tauri-app.exe`
- **Windows Installer (`.msi` / `.exe`)**: `src-tauri/target/release/bundle/nsis/` or `bundle/msi/`

---

## Verifying the Build

Run the test suites to confirm full platform compatibility:

```powershell
# Verify TypeScript types:
pnpm tsc --noEmit

# Run Rust unit tests:
cargo test --manifest-path src-tauri/Cargo.toml
```
