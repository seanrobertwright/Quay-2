# Ticket 03: Spec: Sidecar Supervisor Daemon & Health Monitoring in Rust

**Label**: `wayfinder:grilling`
**Mode**: HITL
**Status**: closed
**Assignee**: Antigravity
**Parent**: [Machina Praxis Map](../00-map.md)
**Blocked by**: None (Resolved [01])

---

## Question

How does Quay's Rust backend (`src-tauri/src/slices/machina/`) supervise the Praxis sidecar process across its full lifecycle, including startup negotiation, continuous health checks, crash recovery, and credential lease garbage collection?

Specifically:
1. **Spawn & Port Negotiation**: How does Quay select an available loopback port (or named pipe), supply authorization tokens, and launch the Node 24 process without opening console popups on Windows?
2. **Liveness & Readiness Probing**: How often does Quay poll `/health` or `/readiness`, and how does it surface degraded status to the frontend?
3. **Crash Recovery & Orphan Cleanup**: If the Praxis sidecar crashes or Quay exits abruptly, how are open credential leases, locked SQLite databases, and child processes cleaned up?
4. **Graceful Shutdown**: How does Quay issue drain/shutdown requests so active stage handoffs complete before process termination?

---

## Deliverable

Architectural specification and design document for the Rust `MachinaSupervisor` service in `src-tauri`.

---

## Resolution

### 1. Process Spawning & Dynamic Handshake
- **Windowless Windows Execution**: Spawned via `std::process::Command` with `creation_flags(0x08000000)` (`CREATE_NO_WINDOW`) so no command prompt flash occurs.
- **Port Discovery**: Praxis uses dynamic OS port allocation (`port: 0` in `quay-praxis-config.mjs`) and prints `{"origin":"https://127.0.0.1:<PORT>","profile":"aiws-deployment-probe/1"}` on line 1 of stdout. Quay's supervisor reads line 1, parses the JSON, and captures the dynamic loopback port.
- **TLS Configuration**: Quay auto-generates self-signed TLS 1.3 certificates (`identity/cert.pem`, `identity/key.pem`) with `SAN=IP:127.0.0.1`. The Rust HTTP client (`reqwest::Client`) trusts `cert.pem` as its local root CA.

### 2. Liveness & Readiness Probing
- **Liveness Probe**: Every 5 seconds, Quay executes `GET https://127.0.0.1:<PORT>/` (unauthenticated static web shell, expects `200 OK`). Three consecutive timeouts mark the daemon `Degraded`.
- **Readiness Probe**: Every 15 seconds (and immediately prior to admitting any work order), Quay executes `GET /engine/v1/capabilities` with `Authorization: Bearer <QUAY_PRAXIS_BRIDGE_TOKEN>` and `AIWS-Schema-Version: 1.1.0`.
- **State Machine**: Transitions through `Starting` -> `Healthy` -> `Degraded` -> `Crashed`. Emits Tauri event `machina://supervisor-status-changed` to keep the UI in sync.

### 3. Epoch-Fenced Crash Recovery & Orphan Cleanup
- **Process Monitoring**: A Tokio background task monitors child process exit status.
- **Orphan Sweeping**: Quay stores the sidecar PID in `%LOCALAPPDATA%\Quay2\praxis\sidecar.pid`. On crash or startup, Quay sweeps and terminates any zombie child worker processes.
- **Epoch Fencing**: On restart, Praxis increments `engine_meta.epoch`. Any stale caller commands referencing an older epoch are rejected with `EPOCH_CONFLICT`.
- **Lease Sweeper**: At startup, Praxis queries SQLite for open `credential_leases`. Any lease from an older epoch is revoked via its credential provider before new attempts commit, ensuring zero leaked API keys or credentials.
- **Interrupted Recovery**: Active stage nodes from crashed attempts are marked `INTERRUPTED`. Work orders preserve their complete historical attempt logs and artifact hashes, allowing the operator to retry from the interrupted stage.

### 4. Graceful Shutdown & Drain
- On app exit, Quay's `AppHandle` hook sends `SIGINT`/`SIGTERM` to the sidecar process.
- Praxis traps the signal, aborts running work order timer loops, closes the HTTP listener, releases `owner.sqlite` database lock, and flushes the SQLite WAL to disk within a 5-second deadline before forceful process kill.

