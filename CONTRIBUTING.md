# Contributing to Quay 2

Thank you for your interest in contributing to **Quay 2**! We are building the premier native Windows workspace and orchestrator for autonomous multi-agent AI engineering.

Whether you are fixing a ConPTY terminal edge case, extending the Agent-to-Agent (A2A) MCP orchestration protocol, improving Archon SDD workflow visualization, or polishing the user interface, your contributions are welcome.

---

## Code of Conduct

We are committed to providing a welcoming, inclusive, and harassment-free experience for everyone. Please treat fellow contributors and maintainers with kindness, respect, and constructive professionalism.

---

## Architectural Philosophy: Vertical Slice Architecture (VSA)

Quay 2 is strictly organized around **Vertical Slice Architecture (VSA)** rather than layered technical tiers. Every domain capability lives end-to-end within its own dedicated slice.

### Backend Slices (`src-tauri/src/slices/`)
- **`pty`**: Native Windows ConPTY process lifecycle management via `portable-pty`. Handles command spawning, IO streams over background threads, resize events, and process exit status.
- **`bridge`**: Embedded loopback HTTP server (`127.0.0.1:<port>`) implementing the `claude-mod-events` v1 wire protocol. Ingests telemetry, serves long-polls, and evaluates tool permissions.
- **`orchestrator`**: In-process Agent-to-Agent (A2A) router and loopback MCP server (`quay_list_agents`, `quay_send_message`, `quay_broadcast`, `quay_get_agent_status`).
- **`github`**: Native `gh` CLI subprocess integration, issue/PR triage, and GraphQL dependency resolution for blocked issues.
- **`archon`**: Archon & Spec-Driven Development (SDD) runtime bridge, DAG inspection, live event streaming, and ADR viewer.
- **`machina`**: Native Machina Praxis AI Software Factory supervisor, SQLite schema migrations, and work order lifecycle manager.
- **`sessions`**: Claude Code transcript scanner, token spend accounting, deduplication engine, and disk caching.
- **`audit`**: Pre-PR Audit Gate: scans changed file names and the git diff for secrets, key files and personal paths.
- **`workspace`**: Project directory registration, configuration persistence, and worktree discovery.

### Frontend Slices (`src/slices/`)
- **`terminal/`**: Terminal lifecycle powered by `@xterm/xterm`, fit addon, emoji width provider, and modal launcher.
- **`rail/`**: Left navigation sidebar, collapsible project tree, collapsible worktrees, status indicators, and condensed tool row.
- **`stage/`**: Main viewport area supporting side-by-side splits, vertical splits, 2x2 grid, zoom mode, and bottom status strips.
- **`orchestrator/`**: A2A Mission Control modal for operator dispatch and inter-agent message logs.
- **`github/`**: GitHub Companion slide-over drawer with blocked issue tags, filter chips, and 1-click agent prompt submission.
- **`archon/`**: Visual DAG execution canvas, live node status inspector, streaming execution logs, and spec task trackers.
- **`machina/`**: AI Software Factory cockpit, stage progression, deliverable reviewers, and worker pools.
- **`sessions/`**: Session history browser and token spend meter.

> [!IMPORTANT]
> **VSA Rule**: When adding or updating a feature, keep backend logic within `src-tauri/src/slices/<feature>/` and frontend UI within `src/slices/<feature>/`. Do not introduce circular dependencies between unrelated slices.

---

## Development Setup

### Prerequisites
1. **Operating System**: Windows 10 (1903+) or Windows 11 with native ConPTY support.
2. **Rust**: Rust toolchain 1.85+ (`stable-x86_64-pc-windows-msvc`).
   ```powershell
   rustup default stable
   rustup update
   ```
3. **C++ Build Tools**: Visual Studio 2022 with the "Desktop development with C++" workload installed.
4. **Node.js**: Node.js 20+ or 24+ LTS.
5. **Package Manager**: `pnpm` (v10 or v12).
   ```powershell
   npm install -g pnpm
   ```
6. **Git & GitHub CLI**:
   - `git` installed and configured on your PATH.
   - `gh` CLI (`winget install GitHub.cli`) authenticated via `gh auth login`.

---

### Getting the Code & Running Locally

1. **Clone the Repository**:
   ```powershell
   git clone https://github.com/seanrobertwright/Quay-2.git
   cd Quay-2
   ```

2. **Install Frontend Dependencies**:
   ```powershell
   pnpm install
   ```

3. **Run in Development Mode**:
   ```powershell
   pnpm tauri dev
   ```
   This starts the Vite development server (`http://localhost:1420`) and compiles the Rust ConPTY backend with hot-reload watching enabled.

4. **Run Documentation Locally**:
   ```powershell
   pnpm docs:dev
   ```
   Launches the VitePress documentation server locally at `http://localhost:5173`.

---

## Quality Checks & Testing

Before submitting any Pull Request, ensure all verification steps pass cleanly:

### 1. Frontend Typecheck
```powershell
pnpm tsc --noEmit
```

### 2. Frontend Production Build
```powershell
pnpm build
```

### 3. Rust Backend Checks & Tests
```powershell
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

### 4. Documentation Build Test
```powershell
pnpm docs:test
pnpm docs:build
```

`docs:build` first packs each `starter/` and `check/` folder under `examples/` into `docs/public/starters/`, which git ignores. `docs:test` runs the packing script's tests.

---

## Contribution Workflow

1. **Branch Naming**:
   Create a descriptive branch off `master`:
   - `feat/feature-name` for new capabilities.
   - `fix/bug-description` for bug fixes.
   - `docs/topic-name` for documentation additions.
   - `refactor/subsystem-name` for code refactoring.

2. **Commit Conventions**:
   We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:
   - `feat(archon): add live DAG streaming node animation`
   - `fix(pty): prevent ConPTY buffer overflow during high-throughput stdout`
   - `docs(a2a): document custom prompt handoff parameters`

3. **Submitting Pull Requests**:
   - Open a PR against the `master` branch.
   - Provide a clear summary of the changes, motivation, and any UI screenshots or test output.
   - Link any relevant GitHub issues (`Fixes #123`).

---

## Security & Anti-CSRF Considerations

Quay 2 integrates a loopback HTTP bridge for telemetry and agent control. Any changes to networking code must adhere to these security mandates:
- **Loopback Only**: All sockets must explicitly bind to `127.0.0.1`, never `0.0.0.0`.
- **Constant-Time Verification**: Bearer authorization tokens must be verified using constant-time comparison to prevent timing side-channels.
- **Port Allocation**: Ports must be assigned dynamically (ephemeral port `0`) or scoped safely to avoid port collision.
- **Credential Protection**: Never log authorization tokens, API keys, or raw environment variables to stdout or disk.

---

## License & Intellectual Property

By contributing to Quay 2, you agree that your contributions will be licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)** as outlined in the [`LICENSE`](LICENSE) file.
