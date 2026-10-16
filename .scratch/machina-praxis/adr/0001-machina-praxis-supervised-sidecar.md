# ADR 0001: Supervised Node 24 Praxis Sidecar with Epoch-Fenced Crash Recovery

- **Status**: Accepted
- **Date**: 2026-10-16
- **Source Tickets**: [01: Research: Praxis Engine Packaging & Node 24 Sidecar Strategy](../issues/01-research-praxis-engine-packaging.md), [03: Spec: Sidecar Supervisor Daemon & Health Monitoring in Rust](../issues/03-spec-praxis-sidecar-supervisor-lifecycle.md)

## Context

The Praxis workflow engine (`@aiws/engine` in `E:\Projects\AI-WS-SDK\engine`) is written in TypeScript targeting Node.js $\ge 24.0.0$, utilizing native type-stripping (`amaro`), built-in `node:sqlite` (`DatabaseSync`), and a worker thread (`new URL('./storage-worker.ts', import.meta.url)`). Quay 2 is a Windows desktop application with a Rust/Tauri backend. We needed to decide how Quay packages, launches, monitors, and recovers the Praxis runtime without flashing console windows or corrupting in-flight SQLite state.

## Decision

1. **Unbundled `aiws-engine-package/1` Layout**: Do not bundle Praxis with single-file bundlers (`esbuild`, `pkg`), which break `storage-worker.ts` relative `import.meta.url` resolution. Ship the self-contained `aiws-engine-package/1` directory tree alongside `aiws-native-helper-x64.exe` and invoke `node.exe --no-warnings <praxis-root>\engine\src\deployment-host.ts <config.mjs>`.
2. **Windowless Child Spawn & Dynamic Loopback TLS**: Spawn via `tokio::process::Command` with Windows `CREATE_NO_WINDOW` (`0x08000000`), ephemeral ECDSA P-256 loopback TLS 1.3 certificates (`rcgen`), and `port: 0`. Parse line 1 of stdout (`aiws-deployment-probe/1`) within 10s to discover the bound HTTPS port.
3. **Dual-Cadence Health Polling**: Poll liveness (`GET /`) every 5s and readiness (`GET /engine/v1/capabilities`) every 15s.
4. **Epoch-Fenced Crash Recovery**: On crash or 3 consecutive health failures, sweep orphan PIDs (`TerminateProcess`), respawn with exponential backoff ($1\text{s}..16\text{s}$), increment `engine_meta.epoch` in `%LOCALAPPDATA%\Quay2\praxis\database\engine.sqlite`, revoke all credential leases from prior epochs, and mark in-flight attempts `INTERRUPTED`.

## Consequences

- **Positive**: Zero npm runtime dependencies; full SQLite WAL durability; deterministic recovery from crashes without zombie processes or leaked credentials.
- **Negative**: Requires Node.js $\ge 24.0.0$ on the host (or bundled `node.exe` in Tauri resources).
