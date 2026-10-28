# Praxis decisions and implementation boundary

> **Praxis naming:** This page documents **Praxis**, the AIWS workflow engine. Existing `engine/*` source paths, `/engine/...` routes, `aiws-engine/*` protocol identifiers, and existing script names remain unchanged for compatibility.

This page records the accepted Praxis design. M5 source implementation is in progress; see [SQLite persistence and recovery tests](./engine-persistence.md) for executable APIs and current evidence. A [local composed workflow](./engine-coding-workflow.md) now runs through acceptance; the complete interface and conformance scope remains unfinished. SDK documentation elsewhere describes the released finite-v1 library behavior. Agent code generation must consult the capability matrix before choosing APIs.

Interactive diagrams accompany this page: the [system overview](./diagrams.md#system-overview) and the [engine internals](./diagrams.md#engine-internals).

## Accepted direction

Praxis is independently developed rather than built on another workflow engine. Coding is the primary use case; business processes, document review, scheduling and other non-coding work remain possible. It must run on a developer computer, in Docker or on organizational infrastructure. Execution can last seconds through months. Recovery on another machine is outside the current scope.

A work order is the durable assignment also called a mission. It has its own engine identity, references its governing contract revision, and contains runs and optional child work orders. The mapping is accepted: existing SDK missionId denotes that same assignment, while contract and run IDs remain distinct. See the accepted WO-01 through WO-08 contract below. The current finite-v1 schema is unchanged.

Users configure automatic restart, human-authorized restart or rule-based continuation. Pause behavior is task-aware because some effects cannot be interrupted. Uncertain outcomes require human intervention. Dynamic workflows may include predefined branches, task addition and plan revision, with separately configured permissions and approval rules.

## Limits and authority

Limits may apply at several scopes. Reaching any applicable time, cost or attempt bound blocks new work within that scope. A branch limit holds affected and dependent work; a work-order limit holds all descendants. Independent branches can proceed only while every relevant shared and local bound permits it.

Only humans approve changes to an agent's permissions or resource limits. Workflow reapproval follows configured rules, but those rules cannot be edited by the agent to expand its own authority. A new branch, agent replacement, continuation or handoff cannot reset previously consumed allowance.

The agreed handoff reserve is human-approved and belongs inside the existing budget. Basic checkpoint/report production must remain possible without relying on an extra LLM request at the moment of failure.

## Accepted work-order hierarchy and identity contract — 2026-09-08

**Decision status:** accepted by the project owner. The SHALL rules in this section define the engine design baseline, not implemented SDK behavior. Protocol representation below is draft `aiws-engine-identity/0.1`; its version is independent of SDK package versions and AIWS editions.

### WO-01 — Assignment and contract separation

Work order and mission SHALL denote the same durable assignment. The engine's canonical term is WorkOrder; applications MAY display Mission. A work order SHALL have its own immutable identity, separate from contract and run identities. It SHALL reference its governing immutable contract revision and MAY have zero runs before execution begins, then one or more runs. Each run SHALL belong to exactly one work order and pin one immutable contract reference. A revised governing contract SHALL preserve contract lineage, prior acceptance records, cumulative consumption and reservations. A run requiring a different contract SHALL be a linked new run; contract replacement SHALL NOT rewrite the original run.

The current SDK field `Contract.missionId` maps to the same value as the engine's `workOrderId`; `Contract.id` remains contract identity. This is a boundary mapping, not permission to insert or rename fields in finite-v1. A work order is a separate engine record, not a second entity above a mission. Multiple existing mission IDs SHALL NOT be silently merged into one work order.

### WO-02 — Containment and dependencies

A work order MAY have child work orders. Every child SHALL have exactly one parent; roots have none. Parentage SHALL be acyclic, immutable after admission, and confined to the declared identity namespace. Cross-work references SHALL be dependencies, not additional parents. Required child work SHALL be identified explicitly for acceptance. A workflow node does not automatically become a child work order; use a child only for an independently governed subassignment. A child run is an execution relationship and does not by itself create a child work order. A node instance identifies a particular loop iteration or fan-out member, not a new workflow definition.

### WO-03 — Identity, retries and revisions

| Identity or reference | Required meaning and lifetime |
|---|---|
| `workOrderId` | Durable assignment; same semantic identity as legacy `missionId` |
| `contractRef` | Immutable contract ID and explicit revision; distinct from assignment ID |
| `workflowRef` | Reusable workflow definition ID and revision |
| `runId` | One execution; preserved on continuation; new for an explicit fresh execution |
| `predecessorRunId` | Previous run in execution lineage; never a replacement for parent work-order identity |
| `planRef`, `graphRef` | Exact plan/graph revisions applicable to a material action |
| `segmentId` | Explicit continuation or ownership boundary within a run |
| `nodeId`, `nodeInstanceId` | Definition node and particular execution occurrence; occurrence differs across loop iterations/fan-out |
| `operationId` | Logical action with immutable material fingerprint; preserved across safe retries |
| `attemptId` | One execution attempt; changes for each actual retry |
| `waitId` and correlation reference | Pending condition and its expected response; survives continuation |
| assessment subject reference | Exact work/evidence revision evaluated; never mutable “latest” |
| `handoffId` and revision | Specific durable transfer manifest and immutable version |
| `deliveryId` | One handoff revision addressed to one consumer occurrence; stable across redelivery |
| external references | Provider, session, model, repository or other foreign IDs; never engine authority |

The engine SHALL assign durable execution IDs and persist them before dispatch or acknowledgement. SDKs SHALL preserve IDs byte-for-byte and use the same case-sensitive wire field names. The tuple `(namespace, record type, id)` SHALL resolve unambiguously. IDs SHALL be opaque nonempty strings; this revision does not mandate a UUID format. References to scoped objects SHALL include their run and definition/revision context where needed. Display names SHALL NOT serve as identity or authorization.

An operation's fingerprint SHALL be immutable. Materially changed work SHALL receive a new operation ID linked to the superseded operation. Unchanged work MAY retain its operation ID across a new plan revision only after recorded compatibility and current authorization checks. Repeated work on different loop iterations/fan-out members SHALL receive distinct operation IDs. A retry SHALL create a new attempt while preserving operation identity and applicable idempotency semantics. Redelivery of the same admission request SHALL return the recorded result rather than create an extra attempt. UNKNOWN effects SHALL require human intervention and reconciliation before any potentially duplicating action.

### WO-04 — Continuation and terminal runs

Resuming a nonterminal interrupted execution SHALL preserve its run ID, waits, completed effects, operation identities and accounting. Recovery or explicit executor ownership transfer SHALL record a new segment and ownership epoch before dispatch. Routine activity within unchanged ownership need not create a segment. Segment creation SHALL NOT refresh grants, approval expiry, attempt counts or budgets.

A terminal run SHALL never be reopened. An explicit fresh execution, including corrective execution following a terminal FAILED run, SHALL create a new run with predecessor lineage and fresh admission. The engine SHALL reconcile prior effects and retain cumulative work-order accounting. Reusing completed outputs requires explicit evidence/compatibility references; starting a new run is not permission to repeat effects. Cross-machine recovery remains out of scope.

### WO-05 — Scoped limits and holds

Limits MAY apply to a work order, run or branch. Admission SHALL check every applicable ancestor and local limit and atomically reserve against shared accounting. Children SHALL NOT create independent copies of a parent's allowance; aggregation SHALL avoid double counting. Branch exhaustion SHALL hold that branch and its dependents; run exhaustion SHALL hold that run and dependent work; work-order exhaustion SHALL hold all its descendants. Unaffected branches MAY proceed only if every applicable shared limit allows them.

A recoverable limit SHALL produce a durable nonterminal hold containing scope, reason, blocking limit revision and decision reference when resolved. Hold is a control record, not a new terminal run state. Multiple holds MAY coexist. Resolving one SHALL NOT clear others or dispatch work automatically. Eligibility SHALL be rechecked under current authority, acceptance basis, ownership and remaining allowances. Permission or resource-limit changes require authenticated human approval. An agent cannot bypass a bound through a new branch, child, run, segment or handoff.

Pause/hold SHALL prevent new ordinary dispatch. Already-committed or non-interruptible effects SHALL follow declared task-aware stopping rules and remain accounted for until settled. Only separately authorized bounded recovery may consume the protected reserve, which remains within the approved total. An expired deadline continues to block admission until an authorized change; merely clearing a hold cannot renew it.

### WO-06 — Handoff ownership and delivery

The engine SHALL persist manifests, delivery intents, claims, acknowledgements and recovery state. Applications supply task-specific content, artifact adapters and summaries. A source completion, its manifest and its delivery intents SHALL commit atomically after durable artifact availability. Every delivery SHALL identify one immutable manifest revision and exact consumer occurrence. Claim ownership SHALL be fenced; acknowledgement SHALL be durable and idempotent. Lost acknowledgements/redelivery SHALL NOT admit duplicate consumer work. Acknowledgement means receipt and validation, never execution success or acceptance. Revised manifests SHALL receive new revisions and new delivery identities; previous consumption history remains intact.

A join SHALL record the exact incoming revisions consumed. Context text SHALL NOT expand authority. Summaries are derived views; authoritative state SHALL remain recoverable without the originating conversation or another model call. The engine-generated basic handoff SHALL exist even when summary generation fails. These rules select engine ownership; they do not require separately deployed services or claim exactly-once external effects.

### WO-07 — Completion and cancellation

To preserve the standard's mission lifecycle, work-order lifecycle remains OPEN, SUSPENDED or CLOSED. Closing SHALL record a separate disposition, COMPLETED or CANCELED. Interfaces MAY display “completed” or “cancelled” from that disposition. A hold on the entire work order blocks ordinary work; a local branch hold does not suspend independent branches.

The COMPLETED disposition SHALL require all required work, including required child work orders, to satisfy the governing acceptance conditions, current verification and required approval. It also SHALL require terminal owned runs, settled reservations and no unresolved material effects. All children SHALL be safely closed before parent closure; optional work need not succeed but cannot remain active or unaccounted for. A successful individual run is insufficient. Acceptance SHALL pin the exact criteria/evidence revisions. Required work SHALL NOT be silently reclassified as optional to force completion.

Cancellation SHALL immediately block new ordinary dispatch and request task-aware stopping. CANCELED closure SHALL wait for safe settlement; while effects remain unresolved, cancellation stays pending and a reconciliation owner SHALL remain recorded. CANCELED SHALL NOT imply acceptance. CLOSED SHALL remain terminal. Later evidence invalidation SHALL append an assessment and invalidate the current acceptance view without rewriting historical closure; corrective work uses a linked newly authorized work order.

### WO-08 — Versioning and compatibility

The SDK finite-v1 profile remains a closed existing wire profile. Its LOOP exhaustion remains terminal FAILED, its attached graphs remain fixed, and its contracts do not acquire nested work-order fields. The future engine SHALL advertise its new identity/hold/handoff capability explicitly and reject unsupported required semantics. Historical journals SHALL retain their original fields, hashes and interpretation. A compatibility adapter MAY expose `missionId` as `workOrderId` in an external projection, but SHALL NOT alter the original bytes. When both aliases are supplied at that boundary, differing values SHALL be rejected. Legacy import SHALL preserve all known accounting and references and report unavailable revision/parent/delivery data instead of inventing it.

The companion `AIWS-Engine-Identity-Contracts.schema.json` defines draft structural records; `AIWS-Engine-Identity-Examples.json` provides a linked illustrative bundle. These are design artifacts, not finite-v1 commands. Semantic validation SHALL additionally enforce references, cycles, revision pinning, material identity, authorization, accounting, idempotency and closure predicates. Passing JSON Schema alone establishes none of those history-dependent guarantees.

### Required implementation verification

| Scenario | Required result |
|---|---|
| Legacy mission mapped to engine work order | Same assignment ID; original contract and journal bytes unchanged |
| Conflicting mission/work-order aliases | Rejected before persistence |
| Second parent or parent cycle | Rejected; dependencies do not change ownership |
| Resume after interruption | Same run/operation IDs; new recorded segment when recovery changes ownership |
| Resume terminal FAILED run | Rejected; explicit linked new run required |
| Safe retry and changed material input | New attempt for same operation; changed material requires new operation |
| Two fan-out members share node definition | Distinct node-instance/operation IDs; no accidental deduplication |
| Concurrent child reservations | Aggregate parent allowance cannot be oversubscribed |
| Branch hold plus runnable sibling | Held branch/dependents blocked; eligible sibling can proceed |
| Root hold and partial hold resolution | All descendants blocked until all applicable blockers clear |
| Duplicate handoff delivery/acknowledgement | One consumer admission; recorded acknowledgement reused |
| Manifest changes after consumption | New revision/delivery; original evidence basis retained |
| Completed run but missing required acceptance | Work-order completion rejected |
| Cancellation with UNKNOWN effect | Dispatch blocked; cancellation remains pending; no successful completion |
| Later evidence invalidation | Acceptance view invalidated; historical closure remains terminal |
| Python/TypeScript/Rust interchange | Identical wire identities, decimal values and semantic outcomes |

These scenarios are release gates to implement, not a claim of passing engine tests.

## Praxis components and M4 design status

| Component | Responsibility | Current SDK support |
|---|---|---|
| Definition registry | Immutable plans/graphs and compatibility | Graph/plan IDs, closed schemas; no full registry service |
| Admission and policy service | Identity, authority, human-only changes | Authorizer interface and finite grant checks |
| Scheduler | Ready-node dispatch, durable timers and wake-up | readyNodes and fixed trigger ticks; no daemon |
| Execution workers | Agent/tool/function/human task adapters | EffectAdapter interface; no worker fleet |
| State and event store | Atomic state, history and outbox | One-mission SQLite journal |
| Artifact and handoff service | Engine-owned durable material, transfer and acknowledgement | M2 source primitives implemented; full engine orchestration remains M5 |
| Human intervention service | Decisions, hold resolution and escalation | Approval/wait records; no inbox UI |
| Observability service | Traces, metrics and alerts | OTLP projections/outbox and alert evaluation |

The owner accepted a TypeScript/Node.js coordinator with separate worker processes on one machine, native Windows/macOS Intel/Apple Silicon/Linux operation and Docker deployment, human-selected concurrency, SQLite-first storage with optional verified PostgreSQL support, supervised CLI/web controls and pluggable identity/policy adapters. Components are modules within that topology, not separately deployed services. Multiple-machine execution is deferred. OS minimums/architectures and transport/bootstrap rules are now specified in the M4 profile; platform qualification and measured capacity remain implementation gates; Archon integration remains later scope.

## Compatibility work that a Praxis release must resolve

Current LOOP exhaustion is terminal FAILED, while the accepted engine intervention model needs a resumable hold. Current graphs cannot be mutated after attachment. Current contracts are immutable and have no nested work-order budget fields. Settlement and recovery epochs are not a complete distributed target-fencing protocol. The finite-v1 event store replays retained history and has no automatic compaction.

Address these as explicit versioned design changes, with migration and conformance tests. Do not promise them by merely adding documentation examples that call nonexistent methods. The M1 contract candidate (not in this pack) specifies handoff records, receipt/admission transitions, resumable holds, ownership, migration and 40 acceptance scenarios. WO-01 through WO-08 now settle the work-order hierarchy and identity mapping. The companion identity-only draft schema does not replace the M1 handoff wire schema. M2 handoff APIs and the M3 nested-accounting ledger are implemented as opt-in source profiles. M4 engine architecture is complete as a design specification under the accepted ED-01–ED-15 baseline; M5 implements it. Older 0.3.0 binary packages retain their earlier finite-v1 scope. See the budgets chapter for ledger integration and its conservative cross-database ordering.



## M4 accepted decisions and starting architecture — 2026-09-09

The owner approved all engine recommendations. The [accepted decision record](https://github.com/seanrobertwright/AI-WS-SDK/blob/main/docs/engine/DECISIONS.md) was committed before architecture drafting. It preserves supervised execution, all-ancestor accounting, human-only escalation, conservative UNKNOWN handling, reference-aware retention and credential refresh on resume.

The [M4 design directory](https://github.com/seanrobertwright/AI-WS-SDK/tree/main/spec/engine-v1) contains a finalized architecture, twelve semantic host contracts, a failure-boundary matrix and 50 specified acceptance scenarios. The architecture proposes one transaction for workflow state, reservations and dispatch intent; existing separate SDK stores are not silently reinterpreted as atomic engine storage.

M4 is complete as an engine design specification. Wire codec 1.1.0, owner/worker enrollment, platform minimums, migration/snapshot rules, conformance/clock/capacity plans and the final identity/accounting review are finalized. M5 is the next implementation milestone. Static traceability checks are not engine tests. No running engine, PostgreSQL adapter, platform support certification or new SDK binary is delivered by these documents.

## Finalized M4 protocol, enrollment and compatibility

The [wire contract](https://github.com/seanrobertwright/AI-WS-SDK/blob/main/spec/engine-v1/WIRE.md) defines closed `aiws-engine/1` commands, queries, results, worker IPC and trusted host-adapter DTOs. All SDKs preserve exact IDs and decimal strings. Current codec 1.1.0 has 228 checked shape fixtures (98 accepted, 130 rejected); another 201 fixtures preserve the frozen 1.0.0 design. These do not execute engine behavior. The new codec explicitly carries active/inherited limits, governing contract references and the correct work-order lifecycle/closure disposition.

[Authentication and enrollment](https://github.com/seanrobertwright/AI-WS-SDK/blob/main/spec/engine-v1/AUTHENTICATION.md) require independent verified human identity before owner enrollment, protected one-use setup challenges, scoped sessions, explicit revocation and private launcher-bound worker enrollment. CLI and web share server-side authority and approval checks. Remote human access requires an explicitly configured organization gateway; workers remain on one machine.

[Platform targets](https://github.com/seanrobertwright/AI-WS-SDK/blob/main/spec/engine-v1/PLATFORMS.md) are Node.js 24 LTS with a pinned patched runtime, Windows 11 25H2, macOS 15 on Intel/Apple Silicon, Ubuntu 24.04 LTS and Debian 13 on x64/arm64, plus qualified Linux Docker images. Each native architecture and container image requires installation, process, security and recovery evidence before support is claimed.

[Migration rules](https://github.com/seanrobertwright/AI-WS-SDK/blob/main/spec/engine-v1/MIGRATIONS.md) define engine database version 1, snapshot format `aiws-engine-snapshot/1`, verified offline upgrades and conservative restore. Existing SDK stores can be preserved as read-only legacy archives; they cannot automatically resume execution or start the same assignment with reset budgets. Uncertain external effects block unsafe rollback/resume.

## M4 completed: conformance plan and lifecycle review

The [conformance plan](https://github.com/seanrobertwright/AI-WS-SDK/blob/main/spec/engine-v1/CONFORMANCE.md) defines nine suites with independent accounting/state/provider-effect oracles and 15 fault points. The [clock protocol](https://github.com/seanrobertwright/AI-WS-SDK/blob/main/spec/engine-v1/FAKE-CLOCK.md) supplies 12 deterministic boundary vectors; the [capacity plan](https://github.com/seanrobertwright/AI-WS-SDK/blob/main/spec/engine-v1/CAPACITY.md) specifies eight workload ladders, persistent round-robin fairness, storage estimates and provisional engineering targets. Test load values are not product workflow/task limits or measured capacity claims.

The [completed review](https://github.com/seanrobertwright/AI-WS-SDK/blob/main/spec/engine-v1/REVIEW.md) traces WO-01–WO-08, all 18 M1 requirements and eight M3 accounting groups, with 11 resolved design findings. All 50 semantic scenarios remain specified-only. The [M5 handoff](https://github.com/seanrobertwright/AI-WS-SDK/blob/main/spec/engine-v1/COMPLETION.md) begins with the SQLite unit of work and independent test controller, then supervised admission, local workers, handoffs/recovery, and a real coding workflow. Engine scenarios executed: zero; platform, recovery and capacity qualification remain implementation gates.


## Executable control profile

The [M5 control API](./engine-control-api.md) implements a declared subset of wire 1.1.0 over HTTPS with shared CLI/web commands and atomic approval receipts. This is implementation evidence for the local profile; the broader architecture and its remaining qualification obligations still apply.
