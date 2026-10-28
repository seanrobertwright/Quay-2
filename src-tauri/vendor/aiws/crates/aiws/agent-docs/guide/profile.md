# Implementation profile

This release targets the [AIWS-001 edition 0.4](./standard.md) **proposal**. The standard specifies responsibilities shared by definition authors, runtimes, enforcement boundaries, assessors and operators. Installing this SDK is not certification of an application or of every requirement in the standard.

## Implemented surface

All three SDKs implement the same closed JSON command schema, canonical action fingerprints, finite-set grant attenuation, mission-wide accounting, operation/attempt identities, material-bound approvals, current authorization checks, recovery fencing, explicit waits, verification, acceptance, invalidation, trigger admission and graph execution checkpoints. All three include native SQLite stores and coordinators. Rust runs independently of Node.

The shared schema is `spec/schema.json`, JSON Schema Draft 2020-12. Unknown command types, fields, editions and features are rejected. Runtime shape checks apply even if application code bypasses TypeScript's compiler. Rust record constructors return `Result` and preserve checked JSON internally.

Numeric accounting and UTC epoch millisecond fields use canonical unsigned decimal strings of at most 100 digits. JSON numeric literals must be safe integers; fractional values and unsafe integers are rejected. Amounts are abstract integer units chosen by the contract owner, not floating-point currency. IDs are opaque strings; scopes are exact finite sets, without wildcards or implicit inheritance. JSON boundaries reject duplicate keys, comments, trailing commas, excessive nesting and unpaired surrogates. The limit is 1 MiB per input and depth 64. Audit files exceeding 1 MiB require an application transport that streams bounded events through `auditPlayback`/`audit_playback`; raising the parser limit silently is not supported.

## Trigger profile

Supported kinds: MANUAL, SCHEDULED, EVENT, RESOURCE_CHANGE, CONDITION, WORKFLOW_LIFECYCLE and EXTERNAL_RESPONSE. A trigger is immutable under its registered ID and pins the mission's immutable contract. Updating it requires a new trigger identity/revision. The owner and authorization references are supplied by the enclosing application's controlled definition and trusted authorizer; they are not taken from event data.

`fireTrigger` validates source/type, age, validity, enabled status, causal depth, deterministic field equality, rate limit and live-run concurrency. Duplicate identity is `(trigger ID, revision, source, event ID)`; different content under that identity is an error. Receipts and run admission or wait satisfaction commit in one transaction. Receipts are retained for the mission lifetime. A duplicate cannot change the original target run. An external response must match one pending, unexpired wait and its correlation token.

Conditions support EDGE and LEVEL. EDGE fires on false-to-true; a false sample resets it. Sampling and truth acquisition belong to the authenticated producer. The source supplies trusted causal depth; the authorizer must prevent clients from resetting it to evade a bound. A lifecycle-event adapter must preserve parent-event lineage.

Scheduled triggers require `schedule: {startMs, intervalMs, catchUp, maxCatchUp}`. The clock is UTC epoch time and intervals are fixed; calendar cron expressions, time zones and daylight-saving calculations are unsupported. `tickTrigger` calculates occurrence IDs from stable slot numbers and commits its cursor with admitted runs. SKIP omits missed slots; LATEST admits the latest due slot; ALL admits a bounded batch. `maxCatchUp` is 1–1000. The whole tick rolls back on an admission failure, preserving the cursor. Choose batch/rate/concurrency/age limits that permit progress. A scheduler calls `tickTrigger` periodically; the library does not create an operating-system timer or start a daemon. Expired occurrences are rejected, never silently assigned a fresh occurrence time.

Rejected commands return a structured error without changing mission state. A production ingress adapter must durably record, reject or defer failed deliveries before acknowledging its transport, preserving the original event identity on retry. The SDK does not provide HTTP authentication, a Kafka consumer, a filesystem watcher or a dead-letter service. These are deployment bindings with different credentials and delivery semantics.

## Node profile and inherited defaults

Graphs pin an ID/revision and must have unique nodes, valid dependencies, no graph cycles and a path from every node to END. Repetition is expressed by a bounded LOOP. Graph activation is allowed only before operations begin. The graph/contract supply inherited revision, mission authority/budget and deadline. Nodes are required unless deliberately skipped by branching or an ANY join. Optional `inputSchema` and `outputSchema` provide material contracts; their explicit profile default is a JSON object. Record references used by checkpoint nodes are checked against same-run evidence, except the linked child run or original compensated operation. Custom schemas allow local references; remote references, asynchronous validation, dynamic references and format assertions are rejected.

| Kind | Config | Completion evidence |
|---|---|---|
| TASK | `executionKind`: AGENT, FUNCTION, TOOL, HUMAN | Same-run, same-node operation confirmed applied |
| DECISION | `field`, `equals`, `then`, `else` | `data` with the declared field; unselected branch skipped |
| FORK | `{}` | Enables downstream dependencies |
| JOIN | `mode`: ALL or ANY | Required predecessors complete; ANY cannot abandon an active operation |
| LOOP | `maxIterations` positive decimal | Distinct confirmed operations and boolean `done`; exhaustion marks node/run FAILED |
| WAIT | `{}` | `waitId` of a satisfied same-run wait |
| APPROVAL | `{}` | `approvalId` of a current same-run approval; dispatch still checks material binding |
| SUBWORKFLOW | `{}` | `childRunId` with completed execution, passing verification and accepted outcome |
| VERIFICATION | `{}` | Current passing assessment `revision` |
| ACCEPTANCE | `{}` | Current accepted assessment `revision` |
| RECONCILIATION | `{}` | `operationId` with known external effect |
| COMPENSATION | `{}` | New confirmed operation and distinct `originalOperationId` confirmed applied |
| END | `{}` | `disposition: COMPLETED`; run completion is a separate checked transition |

`readyNodes`/`ready_nodes` identifies runnable checkpoints. A graph-bound dispatch must name a ready TASK, LOOP or COMPENSATION node, binds the operation to that node and permits only one active operation per node. A caller cannot dispatch directly past a dependency and later fabricate completion. Retry uses the same logical operation only after confirmed nonapplication and within the contract's attempt limit. No automatic arbitrary graph interpreter, LLM invocation or shell execution is hidden in `completeNode`.

Node input schemas validate the operation action payload before dispatch; output schemas validate the completion result. Business output values can be carried in that result. Provider adapters and the authorizer must validate evidence truth, subworkflow parent lineage and domain material requirements. Schema validity alone is not domain verification. Approval, verification and acceptance remain distinct records.

## Persistence, effects and recovery

SQLite uses WAL, FULL synchronization, BEGIN IMMEDIATE, a hash-chained journal and optional expected revisions. Each store contains one immutable mission. Reads reconstruct state from the journal. Writes validate and append atomically. Hashes detect accidental alteration and enable cross-language comparison; they are not signatures and cannot prevent a database owner from rewriting an entire journal. Use trusted storage permissions and external checkpoints where required. Reference replay is linear in retained history on every transaction; this release prioritizes inspectable semantics over large-history throughput. SQLite backup must include a consistent WAL snapshot; do not copy a live database file alone.

The coordinator requires injected authorization and a clock; there is no permissive default. It checks every command and overwrites the caller's policy fields for admission, retry and dispatch. A checked snapshot revision is compared again inside the write transaction. An authorization failure or concurrent change blocks the action.

DISPATCHED is committed before calling an effect adapter. Exceptions and lost responses leave UNKNOWN with the reservation retained. Reconciliation is an authenticated, read-only lookup of the external effect. UNKNOWN is never automatically retried. Recovery increments the run's ownership epoch and returns unresolved attempts without calling an adapter. Prepared work from an old epoch is fenced; an operator can settle a never-dispatched attempt as confirmed not applied and explicitly admit a safe retry.

Audit playback/import executes no adapters. It verifies sequence and reconstructs semantic state; it never silently launches work. A fresh execution requires new admission. Live migration, arbitrary policy languages, remote schemas, target-specific exactly-once extensions and distributed storage plugins are not advertised by this profile.

## Application responsibilities

The application supplies authenticated actors and event sources, authoritative policy inputs, credential custody, egress enforcement, evidence assessment, calendar/transport integrations, durable rejected-delivery handling and operational monitoring. It must prevent untrusted callers from using raw store/reducer methods or an unrestricted second network client. Node `executionKind` and a Git worktree describe execution organization; neither creates a security sandbox. Treat adapters as trusted components and apply their own timeout/cancellation/target-fencing policies.

These responsibilities remain explicit integration interfaces. M9.1 provides the verified common, version-pinned Praxis protocol-binding contract. M9.2/M9.3 verify synchronous MCP 2026-07-28 and durable Tasks/recovery against pinned official MCP packages. M9.4/M9.5 verify A2A 1.0 in both directions: outbound Agent Card/skill pinning, durable task identity and resubscription, plus an authenticated/authorized Praxis Agent Card server with durable inbound identity, official AgentExecutor/HTTP+JSON streaming and terminal-task immutability. M9.6 verifies projection-only AG-UI 1.0 run/step/message/tool/state/activity/subagent events against pinned official `@ag-ui/core@1.0.0`; the projection cannot mutate Praxis state or create approval/control records. External protocol events remain non-authoritative. AG-UI authenticated human-control ingress is verified in M9.7: standard interrupt/resume maps to the existing authenticated Praxis control service with current-material fencing, durable idempotency and receipt recovery. M9.8 verifies one durable cross-protocol registry with explicit binding revisions, operation identity/evidence correlation, stale-result fencing and allowlisted hashed-identity telemetry. M9.9 verifies the checked-in pinned compatibility manifest and executable cross-protocol campaign: MCP 2026-07-28, MCP Tasks 2026-07-28, A2A 1.0 and AG-UI 1.0 all passed together across 16 required scenarios. M9.10 SDK/documentation/visual consolidation is complete for the scoped source interoperability profile. See `COVERAGE.md`, `TEST-REPORT.md` and `docs/M9-BUILD-PLAN.md` for tested behavior and remaining interoperability/deployment work.

## Release 0.4.0 readiness 2.0.0

Readiness 2.0.0 is the current readiness schema in all three SDKs, a breaking change and the only SDK part of M10. Encoding produces only 2.0.0 records and refuses a 1.0.0 record with `UNSUPPORTED_VERSION`; decoding accepts both versions and never converts a record. The exported readiness types describe 2.0.0, and `v1` holds the frozen 1.0.0 types. Readiness evaluation still takes 1.0.0 inputs only. Finite-v1 records, journals and event hashes are unchanged. The rest of M10, agent binding, is a source-only engine profile.

## Release 0.3.0 observability extension

Native Python is an independent implementation of the same finite-v1 contract, graph, triggers, coordinator and SQLite journal. `OBSERVABILITY.md` defines the shared event, metric and outbox behavior. Coordinator authorizers now return authenticated actor, policy revision and decision class; caller context is replaced. Direct reducer/store calls without context are explicitly marked unattributed and are restricted to trusted/offline use. Application identity and policy truth are not supplied by the SDK.

Enriched edition 0.4 journals are not compatible with older event hashes. Keep historical journals with their original SDK. Review and reconcile any migration into a new linked contract. Alert notification delivery, scheduling and acknowledgements are deployment integrations; SDK evaluation does not automatically notify or remediate.


## Opt-in M3 source profile

`aiws-limits/1` adds a separate shared ledger for hierarchical cost, summed active time, elapsed time and attempts, with protected handoff funds inside total cost. All three native SDKs expose durable reservations and authenticated-host coordinators. It does not change finite-v1 contracts or old journal interpretation. Hosts must pair ledger gates with existing mission/handoff dispatch checks; separate databases are not one atomic transaction. See the budgets chapter and `docs/M3-IMPLEMENTATION.md`. Older binary downloads retain their baseline scope.


## M9 protocol source boundary

M9.1–M9.9 are verified in Praxis engine source for the pinned compatibility profiles documented in M9 completion and compatibility (not in this pack). M9.10 adds a source-only `aiws-protocol-correlation/1` helper to all three SDK implementations so application code can carry exact binding revision and remote identity alongside AIWS/Praxis work identity without importing protocol wire schemas.

The helper is non-authoritative; it ships in SDK 0.4.0 and is absent from the earlier 0.3.0 archives. Official MCP/A2A/AG-UI packages remain host-owned at the Praxis adapter boundary. M8 still governs release/platform/production qualification.
