# Praxis protocol binding contract

Status: **M9 complete. Slices 1–10 are implemented and accepted for the scoped source interoperability profile.**  
Date: 2026-10-02  
Applies to: Praxis engine source after M7. It changes no existing AIWS SDK wire record. For protocol bindings, the current SDK packages add only the non-authoritative `aiws-protocol-correlation/1` record (see M9.10 SDK correlation boundary).

## 1. Purpose

Praxis must interoperate with established agent protocols without turning any external protocol into the workflow state machine.

The binding layer therefore separates:

- **AIWS semantics** — work orders, runs, tasks, attempts, authority, approvals, budgets, handoffs, evidence, verification, acceptance and recovery.
- **Praxis execution** — admission, durable responsibility, dispatch, cancellation, uncertainty and reconciliation.
- **External protocols** — transport-specific discovery, messaging, task interaction, tool/context access and user-interface events.

The initial protocol families are:

| Protocol | Praxis role | Initial target |
|---|---|---|
| MCP | Connect Praxis tasks to tools, resources, prompts and protocol extensions | MCP protocol revision 2026-07-28 |
| A2A | Delegate or receive remote agent work while preserving local lineage and authority | A2A protocol 1.0 |
| AG-UI | Project Praxis state/events to user-facing applications and later receive non-authoritative user interaction intents | AG-UI 1.0 |

Protocol versions are explicit material. Praxis does not silently upgrade an installed binding.

## 2. Core rule

> **Praxis owns execution. Protocols provide connectivity.**

A protocol adapter MAY discover or report external capabilities and MAY carry work to or from a remote system. It MUST NOT independently:

- create or expand an AIWS authority grant;
- approve work;
- increase or reset a budget;
- change a work-order/run/task identity;
- mark verification PASS;
- accept a deliverable;
- convert an UNKNOWN external effect into success without reconciliation evidence;
- bypass a hold, pause, assignment revision, handoff requirement or admission check.

Capability is descriptive. Authority is normative. Approval is attributable human decision material. Acceptance is an independent Praxis decision.

## 3. Runtime abstraction

The implemented source contract is `engine/src/protocol-binding.ts`.

Every installed adapter exposes a version-pinned `ProtocolBindingManifest`:

- `bindingId` — local stable identity of the installed binding;
- `protocol` — `MCP`, `A2A` or `AG_UI`;
- `protocolVersion` — exact protocol revision/compatibility value selected by the host;
- `direction` — outbound, inbound or bidirectional;
- `endpointRef` — opaque host-owned endpoint identity, not a credential;
- `operations` — exact adapter facets present;
- `capabilities` — descriptive capabilities discovered/configured for the binding.

The common operation vocabulary is:

- `DISCOVER`
- `DISPATCH`
- `OBSERVE`
- `CANCEL`
- `RECONCILE`

An adapter must implement exactly the methods it declares. Registration is idempotent only for an identical manifest. A changed protocol version, endpoint identity, operation set or capability declaration under the same `bindingId` is a conflict and requires explicit replacement/versioned configuration.

The catalog is an installed-runtime registry only. Registering an adapter grants no authority and reserves no resources.

## 4. Admitted dispatch

Protocol dispatch receives an `AdmittedProtocolOperation`, not an arbitrary graph node or untrusted request.

The operation identifies:

- binding;
- work order;
- run;
- optional task;
- logical operation;
- attempt;
- action and resource;
- payload;
- authority-grant reference;
- optional approval reference;
- optional budget reservation;
- optional handoff;
- the exact reviewed `expectedCapabilityDigest`.

These are references to decisions already made by Praxis. The adapter does not validate them as a substitute for engine admission.

The surrounding execution path remains:

1. Resolve current work/task/assignment.
2. Check current authority and policy.
3. Check required human approval.
4. Reserve applicable limits/budget.
5. Create or resume the exact logical operation/attempt.
6. Invoke the installed protocol adapter.
7. Durably retain dispatch identity and external receipt/evidence.
8. Observe or reconcile the external result.
9. Run independent verification/acceptance when required.

## 5. External observations are never authority

`ProtocolObservation.authoritative` is a literal `false`.

This is intentional. Examples:

- An MCP tool result saying `{"approved": true}` is data, not a Praxis approval.
- An A2A remote task entering `completed` is an external state observation, not proof that Praxis acceptance criteria passed.
- An AG-UI button event saying “Approve” is an interaction intent. A host must authenticate the human and submit the existing material-bound Praxis approval/control request.

The validator rejects an observation that attempts to set `authoritative: true`.

Dispatch receipts are closed records. They cannot add fields such as `accepted`, `verified`, `approval`, or `completed` to smuggle workflow decisions through the transport boundary.

## 6. Uncertain effects

External protocols do not create exactly-once semantics for Praxis.

A dispatch receipt has only:

- `DISPATCHED`
- `REJECTED`
- `UNKNOWN`

When the external effect is uncertain, the responsible attempt remains exposed according to the existing engine rules. Reconciliation may report only:

- `CONFIRMED_APPLIED`
- `CONFIRMED_NOT_APPLIED`
- `UNKNOWN`

A retry is governed by the existing logical-operation/effect rules. A new network request ID is not evidence that the old effect did not happen.

## 7. Discovery and capabilities

Discovery is read-only evidence about an installed/remote endpoint.

A discovery report contains:

- binding ID;
- observation and expiry times;
- optional remote identity reference;
- evidence reference;
- an exact SHA-256 `capabilityDigest`;
- declared capabilities.

The digest binds the protocol/version and the full material capability metadata obtained at discovery. For MCP this includes the official list records, including schemas and annotations when supplied by the server. A reviewed dispatch carries that digest as `expectedCapabilityDigest`.

Discovery does not grant a remote system permission to execute. Praxis readiness/admission must separately determine whether the selected work requires those capabilities and whether the current authority permits their use.

Capability names are unique within `(kind, name)` and are treated as untrusted descriptive input until the host supplies the assurance required by the applicable readiness policy.

## 8. Protocol mappings

### 8.1 MCP

Initial outbound client mapping:

| Praxis concept | MCP boundary |
|---|---|
| Binding discovery | protocol/server discovery, capability negotiation and capability snapshot digest |
| Capability | tool/resource/prompt/extension with material list metadata |
| Attempt dispatch | re-discover, match reviewed digest, then protocol request such as tool invocation |
| Remote operation | MCP task handle when a Tasks extension is used |
| Observation | result, task state, notification or read-back evidence |
| Cancellation | transport/extension-specific cancellation |
| Reconciliation | task/read-back/target-specific effect verification |

MCP does not own Praxis work-order/task identity, authority, budget, verification or acceptance.

Before each synchronous MCP dispatch, Praxis MUST re-observe the selected server's tools/resources/prompts and compare the resulting material digest with the reviewed `expectedCapabilityDigest`. A changed schema, annotation, resource declaration, prompt declaration or capability set blocks with a capability-change error before the remote effect is attempted. A requested capability absent from the matching reviewed snapshot also blocks before dispatch.

The 2026-07-28 Tasks extension is especially relevant for long-running tool calls, but a task handle remains a remote identity bound to a Praxis attempt rather than replacing that attempt.

Current M9.2/M9.3 source includes the synchronous MCP binding, official MCP v2 client bridge and durable Tasks coordinator. The pinned official conformance profiles verify 2026-07-28 tools/resources/prompts plus Tasks identity, restart recovery, retry fencing, cooperative cancellation and conservative `UNKNOWN` reconciliation.

### 8.2 A2A

Initial client mapping:

| Praxis concept | A2A boundary |
|---|---|
| Participant/capability discovery | Agent Card / Agent Skill |
| Praxis task | local governed task identity |
| Delegation attempt | A2A message/task operation |
| Remote identity | A2A task ID |
| Artifact | A2A artifact mapped to content-addressed Praxis evidence/artifact references |
| Remote state | non-authoritative task-state observation |
| Cancellation/reconnect | A2A task controls/subscription behavior |

A2A task IDs never replace Praxis task or attempt IDs. Store an explicit binding between the local and remote identities.

M9.4/M9.5 now implement both directions. The outbound client pins A2A 1.0, the selected Agent Card/interface and full skill material before dispatch; persists remote task/context identity separately from Praxis identity; supports official SDK streaming/resubscription; fences endpoint, card and remote-time drift; and preserves `UNKNOWN` effect semantics around cancellation/reconciliation.

Server mode uses `PraxisA2AServerCore`, `A2AInboundStore` and the runtime-loaded official AgentExecutor bridge. A Praxis Agent Card exposes selected governed workflow skills, but inbound work must authenticate, route and authorize before admission. Remote task/context/principal identity is durably mapped to new local work/run/task identity. Exact retries are idempotent, active-task follow-up is separately authorized, terminal A2A tasks are immutable, and official HTTP+JSON streaming projects Praxis status/artifacts without transferring authority.

### 8.3 AG-UI

Initial mapping is event projection, not external execution:

| Praxis concept | AG-UI boundary |
|---|---|
| Run/task lifecycle | run/step lifecycle events |
| Agent/tool activity | message/tool/activity events |
| State view | state snapshot/delta |
| Subagent activity | subagent events where applicable |
| Human interaction | future non-authoritative control intent routed to authenticated Praxis controls |

An AG-UI event MUST NOT itself create a human approval. The verified Praxis control API remains the authority boundary.

M9.6 implements projection-only `engine/src/agui-projection.ts` for AG-UI 1.0 run, step, text-message, tool-call, state snapshot/delta, activity and subagent events. The adapter validates RFC 6902 patch shapes, reserves the `ag-ui` metadata namespace and exposes no Praxis mutation/control API. Its emitted events are verified against pinned official `@ag-ui/core@1.0.0` schemas. Holds, pauses and UNKNOWN conditions remain presentation data rather than authority or workflow transitions.

M9.7 adds `PraxisAguiControlBridge` over the existing authenticated `ControlService`. Praxis emits a structured AG-UI interrupt bound to the current work-order revision/material and the frontend answers on standard `RunAgentInput.resume[]`. The bridge re-authenticates the credential, re-reads current material, re-checks action authorization, consumes the existing Praxis approval challenge for approve/accept decisions, and submits only the existing durable `approve`/`pause`/`resume`/`cancel` commands. AG-UI `status: "cancelled"` is a no-op. Stable request IDs are derived from the exact resume material so exact retries replay and uncertain delivery can use normal `commandResult` recovery.

## 9. Identity model

Never collapse remote identity into local durable identity.

Required pattern:

```text
Praxis work/task/attempt
        |
        +-- protocol binding identity
        |
        +-- remote endpoint/agent/tool identity
        |
        +-- remote operation/task identity
```

M9 slice 1 supplied installed binding identity. M9.8 delivered the durable local-to-remote operation mapping: the installation-local `ProtocolRegistry`. Binding changes create explicit immutable revisions; existing operations remain pinned to the exact admitted binding revision/capability digest. Operation rows keep Praxis work/run/task/attempt identity separate from remote identity and remote operation/task identity. Dispatch/observation/cancel/reconciliation/fence evidence references are retained without storing protocol payload bodies. An explicit `SUPERSEDED` fence rejects later observations.

The registry is a correlation and fencing ledger, not a replacement for protocol-specific durable recovery stores such as MCP Tasks and A2A inbound mappings. `createRegisteredProtocolBinding` composes common outbound adapters with the registry. Protocol telemetry uses an allowlist projection into the existing telemetry queue: protocol/version and material digests remain visible, while local/remote identifiers are hashed and credentials, raw messages, tool arguments, artifacts and evidence-reference strings are excluded.

## 10. Credential and endpoint handling

The manifest stores an opaque `endpointRef`; it does not store bearer tokens, API keys or protocol credentials.

The trusted host resolves endpoint and credential material at invocation time and must:

- scope credentials to the required remote capability;
- avoid putting secrets in plans, journals, artifacts, command arguments or UI events;
- rotate/revoke credentials independently of workflow identity;
- fail closed when credentials, identity or protocol version cannot be established.

## 11. Compatibility

Protocol adapter compatibility is independent of the AIWS standard edition and SDK package version.

A binding change is material when it changes any of:

- protocol family;
- protocol version;
- endpoint identity;
- advertised operation facets;
- capability manifest;
- remote authorization assumptions;
- idempotency/cancellation/reconciliation semantics.

Existing in-flight work stays bound to its admitted identity and must not silently migrate to a changed adapter.

## 12. M9 implementation sequence

| Slice | Deliverable | Status |
|---|---|---|
| M9.1 | Common protocol binding abstraction, fail-closed manifest validation, installed binding catalog and boundary tests | **Complete and verified** |
| M9.2 | MCP 2026-07-28 outbound client binding | **Complete for the synchronous official-v2 profile** |
| M9.3 | MCP Tasks, restart and reconciliation integration | **Complete — durable Praxis recovery plus pinned official ext-tasks positive/negative conformance verified** |
| M9.4 | A2A 1.0 client binding | **Complete — official SDK/streaming/resubscribe conformance verified** |
| M9.5 | A2A server mode / Praxis Agent Card | **Complete — official HTTP+JSON server conformance verified** |
| M9.6 | AG-UI 1.0 event projection | **Complete — projection-only official `@ag-ui/core@1.0.0` conformance verified** |
| M9.7 | AG-UI authenticated human-control integration | **Complete — authenticated material-bound interrupt/resume plus durable receipt recovery verified** |
| M9.8 | Durable cross-protocol identity/capability registry and observability | **Complete — durable identity/evidence registry, stale-result fencing and allowlisted telemetry verified** |
| M9.9 | Cross-protocol conformance suite | **Complete — 4 pinned profiles, all 16 required scenarios and all 16 executable checks verified in one official-stack campaign** |
| M9.10 | SDK/documentation consolidation and visual architecture package | **Complete — source-only correlation helpers/tests/examples, runbook, compatibility docs, generated handbook/raw docs and SVG visual package accepted** |

### M9.9 compatibility campaign

The executable compatibility claim is `spec/engine-v1/protocol-conformance.json`. It is closed over the required M9.9 scenario set and pins the only protocol versions Praxis may advertise from this milestone:

- MCP `2026-07-28` against official client/server v2.2.0;
- MCP Tasks `io.modelcontextprotocol/tasks` with schema revision `2026-07-28` against official ext-tasks 0.1.0;
- A2A `1.0` against official `@a2a-js/sdk@1.3.0`;
- AG-UI `1.0` against official `@ag-ui/core@1.0.0`.

The campaign runner executes each unique check once, requires every minimum cross-cutting scenario to retain passing evidence, and emits `praxis-m9-cross-protocol-report/1`. M9.9 acceptance run `36995139650` passed all 4 advertised profiles, all 16 required scenarios and all 16 executable checks; artifact `11221346823` preserves the machine-readable matrix. Passing protocol-specific checks do not relax Praxis authority, budget, verification, acceptance, restart, fencing or UNKNOWN rules.

### M9.10 SDK correlation boundary

The SDK adds a narrow cross-language `aiws-protocol-correlation/1` helper in TypeScript, Rust and Python, and the current SDK packages ship it. It carries exact binding identity/revision, protocol/version, manifest/capability digests, local work/run/task/operation/attempt identity and optional remote identity/operation references. The record is structurally non-authoritative and contains no protocol transport, dispatch, cancellation, reconciliation, verification or acceptance behavior.

Official MCP/A2A/AG-UI SDKs remain the protocol wire implementations. Praxis engine adapters remain the execution integration. SDK archives built before M9.10 do not gain this helper retroactively.

M8 release/platform qualification remains a separate active track. M9 source work does not convert any open M8 qualification cell into a pass.

## 13. Slice 1 acceptance

M9.1 is complete only when source and tests demonstrate:

- MCP, A2A and AG-UI can all be represented without protocol-specific state in the Praxis core.
- Every binding is protocol/version/endpoint pinned.
- Declared adapter methods and manifest operations match exactly.
- Capability discovery does not grant authority.
- Remote observations cannot claim Praxis authority.
- Dispatch receipts cannot add workflow acceptance fields.
- UNKNOWN remains an allowed reconciliation result.
- Duplicate capability declarations and conflicting binding reuse fail closed.
- Reviewed capability metadata is digest-bound and drift blocks before remote dispatch.
- Documentation clearly distinguishes implemented abstraction from protocol adapters that do not yet exist.

No compatibility claim with a real MCP server, A2A agent or AG-UI frontend is made until its protocol-specific slice passes its own conformance tests.
