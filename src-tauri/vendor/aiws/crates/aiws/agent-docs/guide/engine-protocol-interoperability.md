# Praxis protocol interoperability

> **M9 status:** **Complete.** M9.1–M9.10 are accepted for the scoped source interoperability profile: MCP 2026-07-28 + Tasks, A2A 1.0 and AG-UI 1.0 are version-pinned and evidence-backed, with SDK correlation helpers, operator guidance and visual architecture included.

Praxis now has a common boundary for three complementary interoperability roles:

| Protocol | Role around Praxis | Initial target |
|---|---|---|
| **MCP** | Tools, resources, prompts and protocol extensions | 2026-07-28 |
| **A2A** | Remote agent discovery, delegation and task interaction | 1.0 |
| **AG-UI** | Agent/user event projection and later authenticated control intents | 1.0 |

The design rule is simple:

> **Praxis owns execution. Protocols provide connectivity.**

AIWS still defines work orders, runs, tasks, attempts, authority, human approval, budgets, handoffs, evidence, verification, acceptance and recovery. A protocol adapter cannot replace those semantics.

## The boundary

Praxis protocol interoperability architecture (not in this pack)

MCP, A2A and AG-UI deliberately remain adapters around the engine rather than branches inside the core state machine. The protocol mapping visual (not in this pack) shows the three roles side by side.

## What M9 slice 1 added

The source contract is `engine/src/protocol-binding.ts`.

It introduces:

- a version-pinned `ProtocolBindingManifest`;
- a runtime `ProtocolBindingCatalog`;
- descriptive protocol capabilities;
- an `AdmittedProtocolOperation` for work that has already passed Praxis governance;
- closed dispatch receipts;
- non-authoritative external observations;
- cancellation and reconciliation result shapes;
- tests that cover MCP, A2A and AG-UI manifests with the same common abstraction.

The formal contract is [`spec/engine-v1/PROTOCOL-BINDINGS.md`](https://github.com/seanrobertwright/AI-WS-SDK/blob/main/spec/engine-v1/PROTOCOL-BINDINGS.md). The full delivery sequence is [M9](https://github.com/seanrobertwright/AI-WS-SDK/blob/main/docs/M9-BUILD-PLAN.md).

## Capability is not authority

A discovered capability means only that an endpoint reports or demonstrates support for something.

```text
Capability
  "I can do X"

Authority
  "Praxis permits this actor to do X in this scope"

Approval
  "A verified human approved this material action"

Execution
  "The action was attempted"

Evidence
  "Here is what was observed"

Acceptance
  "The accountable decision accepts the result"
```

Registration and discovery therefore grant nothing. The existing readiness, authority, approval, budget and dispatch gates remain in charge.

For protocol-bound work, discovery also produces a material SHA-256 capability snapshot. Praxis binds that digest into the admitted operation. The MCP adapter re-lists tools, resources and prompts immediately before dispatch and compares the full material metadata—including schemas and annotations supplied by the official SDK—to the reviewed digest. Any drift blocks before the remote call.

## External events are observations

Every common `ProtocolObservation` has:

```typescript
authoritative: false
```

This is a structural rule, not a convention.

An MCP result such as:

```json
{"approved": true}
```

is still just external data.

An A2A task state of `completed` is still just a remote task-state observation.

An AG-UI button event that says “Approve” is still just a UI interaction intent until a trusted host authenticates the human and executes the existing material-bound Praxis control flow.

The common validator rejects attempts to mark protocol observations authoritative.

MCP, A2A and AG-UI protocol mapping (not in this pack)

## MCP direction

`McpOutboundBinding` implements the outbound MCP mapping core in `engine/src/mcp-binding.ts`. `OfficialMcpV2ClientPort` in `engine/src/mcp-official-client.ts` is the host-side wrapper for the official v2 client. It is runtime-loaded deliberately, so Praxis core remains independent of the transport package; deployments that use it install and pin `@modelcontextprotocol/client` in the host.

```text
Praxis attempt
      |
      v
MCP binding
      |
      +-- discover
      +-- tools/resources/prompts
      +-- tool invocation
      +-- optional Tasks extension
      +-- cancellation
      +-- read-back/reconciliation
```

The initial target is MCP 2026-07-28. Long-running tool work will use the Tasks extension where appropriate, while keeping the MCP task handle separate from the Praxis attempt identity.

The current source maps `mcp.tools/call`, `mcp.resources/read` and `mcp.prompts/get`, requires the connected port to report exactly `2026-07-28`, captures returned payloads as evidence, treats tool-level error payloads as external results rather than Praxis decisions, and returns `UNKNOWN` when transport failure leaves the external effect uncertain. A target-specific verifier can provide reconciliation evidence; otherwise reconciliation stays `UNKNOWN`.

Dispatch is also bound to the reviewed discovery snapshot: the operation carries `expectedCapabilityDigest`, the adapter re-discovers the current capability metadata, and a changed schema/capability set or missing selected capability fails closed before invocation.

A remote MCP task finishing does not automatically pass verification or acceptance.

### MCP Tasks durability and recovery

M9.3 adds `McpTaskStore` and `McpTaskCoordinator`.

```text
Praxis attempt
      |
      | tools/call
      v
MCP Tasks server
      |
      +-- immediate result ──────> evidence
      |
      +-- task handle
              |
              v
       durable task binding
       - local operation/attempt
       - work order/run/task
       - binding + endpoint
       - MCP + Tasks revisions
       - reviewed capability digest
       - remote task ID
       - resumable reference
              |
        restart / reconnect
              |
              v
          tasks/get
```

The remote task identity never replaces the Praxis operation/attempt identity. The mapping is persisted before a task-backed dispatch receipt is returned, so restart cannot lose responsibility for an already-created remote task.

When a task reports `input_required`, Praxis emits a non-authoritative control-request observation. Before any input is sent, the host must provide an approval ID and authority-evidence reference bound to the exact observed task revision. That decision is durable. If `tasks/update` has an ambiguous outcome, Praxis records the input decision as `UNKNOWN` and **fences any resend** until the uncertainty is reconciled; the same approval/input payload is not a safe retry token.

Task cancellation is cooperative. A successful remote cancellation request does not prove the underlying business effect was undone. Task completion likewise does not imply verification, effect confirmation or acceptance. Target-specific reconciliation remains independent.

The task's TTL and poll interval are remote protocol hints/backstops. They do not replace Praxis deadlines, budgets or accounting. Recovery also pins endpoint identity, base MCP revision, Tasks extension revision and capability digest; a changed endpoint or protocol cannot silently take ownership of the old remote task.

M9.3 is qualified with both deterministic fake-port recovery tests and pinned official `@modelcontextprotocol/ext-tasks` conformance. The official-extension gate covers create/get/update/cancel, persisted handoff and restart, missing extension negotiation, lost polling responses, remote-task deletion, TTL boundaries, stale terminal timestamps, duplicate/stale input, ambiguous input-update outcomes with retry fencing, ambiguous cancellation, and conservative `UNKNOWN` reconciliation. Remote completion remains evidence rather than Praxis acceptance.

## A2A direction

A2A 1.0 is now qualified in both directions.

Outbound, `A2AClientBinding` plus `OfficialA2AClientPort` discover Agent Cards/skills, pin the reviewed capability digest, create and persist a separate remote Task identity, normalize task/message/artifact observations as non-authoritative evidence, support resubscription after interruption and keep terminal effect reconciliation conservative.

Inbound, `PraxisA2AServerCore`, `A2AInboundStore` and the official AgentExecutor bridge expose selected governed workflows as Praxis Agent Card skills:

```text
External A2A client
       |
       v
Official A2A transport
       |
       v
Praxis Agent Card / server bridge
       |
       +-- authenticate caller
       +-- route requested skill
       +-- authorize exact message/material
       +-- admit new Praxis work identity
       +-- persist remote ↔ local identity
       +-- project status/artifacts
       v
Governed Praxis workflow
```

The official HTTP+JSON conformance test uses `@a2a-js/sdk@1.3.0` and verifies authenticated admission, durable inbound identity mapping, streaming status/artifact projection and A2A terminal-task immutability. A completed remote task cannot be mutated with another message; a later interaction must create new A2A task identity (while conversational context may remain related). A2A completion still does not equal Praxis verification or acceptance.

## AG-UI direction

AG-UI 1.0 is implemented as a read/projection boundary:

```text
Praxis state/events
       |
       v
AG-UI projection
       |
       +-- run lifecycle
       +-- step lifecycle
       +-- messages
       +-- tool/activity events
       +-- state snapshot/delta
       +-- subagent attribution
       |
       v
User interface
```

`engine/src/agui-projection.ts` emits only projection events and has no Praxis mutation/control API. It covers run/step lifecycle, text messages, tool calls/results, state snapshots and checked RFC 6902 deltas, structured activity snapshots/deltas and subagent attribution. The reserved `ag-ui` metadata namespace is rejected, and the emitted event set passes pinned official `@ag-ui/core@1.0.0` schema conformance. Holds, pauses and UNKNOWN conditions stay presentation data rather than new workflow authority.

M9.7 now adds `PraxisAguiControlBridge` as the inbound HITL seam. Praxis presents standard AG-UI interrupts, and the frontend answers with `RunAgentInput.resume[]`. The bridge treats those answers only as control intents: it re-authenticates the caller, revalidates current revision/material, rechecks authorization, consumes the existing single-use Praxis approval challenge for approve/accept, and submits the ordinary durable Praxis control command. `status: "cancelled"` is a no-op. Exact retries derive the same command request ID, and lost responses use the existing `commandResult` lookup. M9.7 is verified: focused tests cover forged identity, stale material, tampered interrupts, expired challenges, changed artifacts, lifecycle controls, duplicate/replayed resumes and lost-response receipt recovery; pinned official `@ag-ui/core@1.0.0` validates the Interrupt, ResumeEntry, RunAgentInput and structured interrupt outcome.

## UNKNOWN stays UNKNOWN

No protocol adapter is allowed to manufacture exactly-once semantics.

The common dispatch boundary supports `DISPATCHED`, `REJECTED` and `UNKNOWN`. Reconciliation supports `CONFIRMED_APPLIED`, `CONFIRMED_NOT_APPLIED` and `UNKNOWN`.

If a connection drops after a possible external effect, Praxis keeps responsibility exposed until reconciliation proves what happened or the existing human-governed recovery path resolves it.

UNKNOWN and recovery lifecycle (not in this pack)

## Protocol identity stays separate

Local Praxis identity never collapses into an external endpoint, agent or task identity. The binding revision, exact protocol/version, endpoint identity and remote operation are correlated explicitly so restart, replacement and protocol upgrades cannot silently rewrite durable responsibility.

Durable protocol identity and registry (not in this pack)

## Durable protocol registry

M9.8 adds the verified `ProtocolRegistry` in engine source. It records immutable protocol-binding revisions plus durable operation identity, including protocol/version, endpoint reference, reviewed manifest/capability digests, separate local and remote identities, and evidence references.

Protocol-specific recovery stores remain responsible for their detailed task state. The registry adds one cross-protocol correlation/fencing layer: optimistic registry revisions reject stale writes, and an explicit `SUPERSEDED` fence rejects late remote results after responsibility changes.

Protocol telemetry is intentionally smaller than registry state. M9.8 acceptance verified restart survival, stale-result fencing, schema corruption rejection, registry revision conflicts and telemetry privacy across MCP, A2A and AG-UI. The existing `TelemetryQueue` receives protocol/version, binding revision, material digests, phase/status and hashed identity fields. It does **not** receive credentials, raw endpoint/agent/task identifiers, messages, tool arguments, artifacts, protocol payloads or evidence-reference strings. Telemetry remains best-effort and cannot roll back authoritative registry commits.

## Cross-protocol compatibility campaign

M9.9 verifies the protocol claims through one executable campaign. The checked-in `spec/engine-v1/protocol-conformance.json` manifest pins the compatibility surface and maps every required cross-cutting failure mode to concrete Engine/protocol checks.

Acceptance run `36995139650` ran the real pinned stacks for MCP 2026-07-28 + Tasks, A2A 1.0 and AG-UI 1.0, then composed those results with Praxis control, admission, restart, replacement and protocol-registry tests. All 4 advertised profiles, all 16 required cross-cutting scenarios and all 16 executable checks passed; machine-readable artifact `11221346823` preserves the matrix.

The machine-readable output is `praxis-m9-cross-protocol-report/1`, containing only the advertised protocol/package/version matrix, scenario IDs, check IDs, pass/fail status and durations. It is evidence of tested interoperability, not permission to bypass Praxis authority or acceptance semantics.

## SDK protocol correlation records

M9.10 adds a small source-only `aiws-protocol-correlation/1` record in TypeScript, Rust and Python. It lets application code correlate AIWS/Praxis work/run/operation/attempt identity with the exact binding revision and optional remote identity. The validator requires `authoritative: false`.

This helper is not a protocol client and does not duplicate MCP, A2A or AG-UI schemas. Official protocol SDKs and Praxis adapters remain responsible for transport behavior. The SDK 0.4.0 packages include the helper; the earlier 0.3.0 archives do not.

See M9 completion and compatibility (not in this pack) for the exact matrix and [protocol operations and recovery](./engine-protocol-operations.md) for operator procedures.

## Current implementation boundary

What exists now:

- common version-pinned binding abstraction plus MCP, A2A and AG-UI protocol-specific source adapters;
- official-stack conformance for MCP `2026-07-28`, MCP Tasks, A2A `1.0` and AG-UI `1.0`;
- durable protocol-specific task stores plus the cross-protocol `ProtocolRegistry`;
- authenticated AG-UI human-control intent routed through existing Praxis controls;
- privacy-preserving protocol telemetry and stale-result fencing;
- M9.9 unified compatibility campaign with 4/4 profiles, 16/16 required scenarios and 16/16 executable checks;
- M9.10 source-only cross-language correlation records, runnable examples, operator runbook, completion record and SVG visual package.

What remains outside M9:

- M8 platform/release/production qualification;
- cross-machine Praxis recovery;
- exactly-once external-effect guarantees;
- silent compatibility with protocol/package versions not listed in the verified matrix.

Do not infer those capabilities from the presence of a protocol adapter. Use M9 completion and compatibility (not in this pack) as the compatibility boundary.

## M8 remains independent

M9 is a feature/interoperability milestone running beside M8. Protocol functionality does not qualify the Windows/macOS/Linux matrix, installers, production containment, PostgreSQL, constrained hosts or endurance claims. Those gates remain owned by M8.
