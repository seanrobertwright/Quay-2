# Ticket 01: Research: Praxis Engine Node 24 Packaging & Headless Sidecar Runtime

**Label**: `wayfinder:research`
**Mode**: AFK
**Status**: closed
**Parent**: [Machina Praxis Map](../00-map.md)
**Blocked by**: None (Frontier)

---

## Question

How should `@aiws/engine` (Praxis) from `E:\Projects\AI-WS-SDK` be packaged, bundled, and executed on Windows by Quay's Tauri/Rust backend as a headless sidecar process?

Specifically:
1. What are the Node 24 runtime prerequisites, native dependencies (`node:sqlite`), and bundle packaging options (e.g. standalone distribution, single-file bundle via esbuild/pkg, or invoking installed Node 24)?
2. What are the environment variables, platform baseline, and startup arguments required to launch Praxis headlessly in sidecar mode?
3. How should the SQLite database file (`%LOCALAPPDATA%\Quay2\praxis\praxis.db`) and migration scripts be initialized before the engine accepts incoming requests?
4. What loopback transport (HTTP REST, WebSocket, or stdio JSON-RPC) should Quay use to communicate with Praxis control APIs?

---

## Deliverable

A research report documenting:
- Engine bundle packaging and execution strategy.
- Required CLI startup command, flags, and environment.
- Healthcheck probe endpoints and initialization sequence.
- Database location and migration protocol.

---

## Resolution

### 1. Zero External Dependencies & Native TypeScript
- `@aiws/engine` has **0 runtime npm dependencies**; it relies entirely on Node 24 native built-ins (`node:sqlite`, `node:crypto`, `node:worker_threads`, `node:https`).
- Node 24 executes TypeScript source files directly with native type-stripping (`amaro`). No compilation or transpilation step is required.
- Uses native `node:sqlite` (`DatabaseSync` on SQLite 3.53.3+) with WAL mode, `PRAGMA synchronous = FULL`, `PRAGMA foreign_keys = ON`, and `BEGIN IMMEDIATE` transaction locking.
- Uses `aiws-native-helper-x64.exe` (Rust binary) for Windows DPAPI secret protection and durability probing, passed via `AIWS_WINDOWS_NATIVE_HELPER`.

### 2. Packaging Strategy
- Uses standard directory bundle (`aiws-engine-package/1`) packaged via `scripts/package-engine.mjs` into `src-tauri/resources/praxis` (containing `engine/src`, `engine/web`, `spec/engine-v1`, `runtime/node.exe`, and `native/windows/aiws-native-helper.exe`).
- Single-file bundlers (`pkg`, `esbuild`) are incompatible because of worker thread URL resolution (`new URL('./storage-worker.ts', import.meta.url)`) and dynamic ESM resolution.

### 3. Sidecar Startup Command & Dynamic Port Discovery
- Launch command: `node.exe --no-warnings <praxis-root>\engine\src\deployment-host.ts <path-to-config.mjs>`
- Environment: Clean platform baseline (`NODE_ENV=production`, `SystemRoot=C:\Windows`, `AIWS_WINDOWS_NATIVE_HELPER`).
- Startup Handshake: On boot, `deployment-host.ts` writes line 1 to stdout:
  `{"origin":"https://127.0.0.1:<PORT>","profile":"aiws-deployment-probe/1","certified":false}`
  Quay's Rust supervisor captures stdout line 1 to discover the dynamically allocated loopback port.

### 4. Database Schema & Storage Protocol
- Stored under `%LOCALAPPDATA%\Quay2\praxis\`:
  - `identity\owner.sqlite`: Holds exclusive single-instance lock (`BEGIN IMMEDIATE`).
  - `database\engine.sqlite`: Holds main SQLite WAL database.
  - `artifacts\`: Immutable content-addressable artifact store.
- Schema version 1 is strictly enforced with immutability triggers (`BEFORE UPDATE`, `BEFORE DELETE` abort). No in-place schema migrations.

### 5. Loopback Transport & Health Checks
- HTTPS loopback (TLS 1.3) with self-signed certificate in `identity\cert.pem`.
- Liveness probe: `GET /` (serves web shell without auth, returns 200 OK).
- Readiness probe: `GET /engine/v1/capabilities` (authenticated with Bearer token).
- Execution control: `/engine/v1/commands`, `/engine/v1/queries`, `/engine/dynamic/v1/requests`, `/engine/operator-view/v1/:id`, `/engine/hold-exits/v1`.

