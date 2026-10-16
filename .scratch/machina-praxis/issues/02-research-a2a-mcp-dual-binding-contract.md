# Ticket 02: Research: Dual Protocol Bridge Specification (MCP Tools & A2A Agent Card)

**Label**: `wayfinder:research`
**Mode**: AFK
**Status**: closed
**Parent**: [Machina Praxis Map](../00-map.md)
**Blocked by**: None (Frontier)

---

## Question

What are the exact wire contracts, JSON-RPC schemas, and protocol adapters required for any AI agent to leverage Machina Praxis via both Model Context Protocol (MCP) and Agent-to-Agent (A2A) protocol?

Specifically:
1. **MCP Tools Contract**:
   - What are the precise tool names, parameter schemas, and response formats for:
     - `machina_submit_work_order`
     - `machina_get_stage_status`
     - `machina_claim_attempt`
     - `machina_submit_deliverable`
     - `machina_resolve_hold`
   - How does Quay's embedded Axum MCP server proxy these tool calls to the Praxis sidecar?
2. **A2A Agent Card Specification**:
   - How does Praxis expose its Agent Card under the `@a2a-js/sdk@1.3.0` specification?
   - What are the message exchange patterns when an agent (e.g. Claude Code or Pi) delegates a sub-mission or receives an automated verification challenge?
3. **Authentication & Authority**:
   - How are caller identities, capability digests, and token spend authorizations verified on incoming protocol calls?

---

## Deliverable

A research specification detailing:
- Complete JSON-RPC tool schemas for MCP.
- A2A Agent Card registration and dispatch routing.
- Protocol adapter architecture in Quay's Rust bridge.

---

## Resolution

### 1. Architectural Invariant
Adheres to the foundational AIWS execution rule: *"Praxis owns execution; protocols provide connectivity."*
- Interactive CLI agents connect via Quay's embedded loopback Axum MCP server (`POST /mcp`) using 5 governed `machina_*` tools.
- Swarm peer agents connect via `@a2a-js/sdk@1.3.0` conforming Agent Card over Quay's A2A message bus and `PraxisA2AServerCore`.
- All incoming protocol observations carry `authoritative: false`; state transitions, ledger billing, and hold releases are strictly evaluated inside Praxis SQLite.

### 2. MCP Tools JSON-RPC Specification
The 5 tools exposed in `tools/list`:
1. `machina_submit_work_order`: Accepts `work_order_id`, `title`, `description`, `criteria_ref`, stage command arrays (`implementation`, `validation`, `correction`), `output_paths`, `max_corrections`, `exposure` (`BOUNDED` or `NOT_APPLICABLE`), and `max_total_cost`. Returns revision, stage, plan digest, and approval subject digest.
2. `machina_get_stage_status`: Inspects active stage, ordinal, task ID, clock high-water time, and structured `aiws-hold-card/1` metadata with available exits (`RECONNECT`, `ADD_PRICE`, `RAISE_LIMIT`, `DISCARD_RESULT`, `ADMIT_RESULT`).
3. `machina_claim_attempt`: Claims execution lease for a specific worker/terminal ID, checking expected revision to prevent race conditions. Returns lease timeout, worktree path, and target commands.
4. `machina_submit_deliverable`: Reports outcome (`SUCCEEDED`, `FAILED`, `UNKNOWN`), changed file hashes, and model usage report (input/output tokens) for true cost settlement.
5. `machina_resolve_hold`: Executes an authorized hold card exit with required subject digest verification, bounds adjustments, or price sheet submissions.

### 3. A2A Agent Card & Message Bus
- Card Name: `machina-praxis` (version `1.0.0`, protocol `HTTP+JSON 1.0`).
- Declares skills: `machina.software_factory.execute` and `machina.holdback.verify`.
- Inbound deduplication via `a2a_inbound_tasks` SQLite store using `sha256({ protocol, remoteTaskId, contextId, message })` to guarantee idempotent message replay.

### 4. Authentication & Ledger Budget Fencing
- PTY Bearer tokens validated by Quay BridgeState and mapped to `VerifiedControlSession`.
- Hierarchical scope bounds (`workflow:<wo_id>:<run_id>` -> `node:<node_id>`) reserve `exposure.allowance` pre-attempt. Overrun triggers `EXPOSURE_EXCEEDED` hold card; unreviewed models trigger `BINDING_VIOLATION` hold card.

