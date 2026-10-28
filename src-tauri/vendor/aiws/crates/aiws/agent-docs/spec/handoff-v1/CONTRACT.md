# AIWS handoff and resumable-hold contract — candidate 1

Status: M1 specification candidate, 2026-09-08. Protocol identifier: `aiws-handoff/1`.
This is an original proposed extension to AIWS-001 edition 0.4. Its SHALL requirements apply only to implementations claiming this extension. SDK 0.3.0 / finite-v1 does **not** implement it. M2 implements the native APIs; M3 supplies hierarchical accounting and the work-order binding. No new SDK release or full-engine conformance is claimed here.

## 1. Purpose and decisions

A handoff transfers an identified result and the responsibility to consume it. A hold prevents new work until its recorded blockers are resolved. Neither record is an authorization grant or evidence that an external action succeeded.

This candidate chooses immutable manifests, one delivery per recipient, leased validation claims, durable acknowledgements, atomic consumer admission and an independent hold gate. These are reviewable protocol choices, not additional user-approved product requirements. Existing decisions about human-only permission and resource-limit changes and human intervention for uncertainty are mandatory constraints.

The contract does not select an engine language, transport, database topology, operating systems or UI. The accepted WO-01 through WO-08 engine contract now defines work order and mission as the same durable assignment, distinct from contract and run identity. An approved scope resolver must explicitly bind the engine workOrderId to the same legacy missionId value and enforce the single-parent hierarchy. Unsupported or unresolved scope bindings still fail closed; naming equivalence alone does not implement a scope resolver or authorize cross-scope access. The first implementation may support same-run handoffs and run/node-set holds while explicitly rejecting unresolved work-order scopes. That limitation must be reported, not described as full M3 support.

## 2. Objects and trust boundaries

| Object | Meaning |
|---|---|
| Manifest | Immutable producer checkpoint, outcome, recipients, immutable artifact references, controls and resume context |
| Handoff reference | Manifest ID and SHA-256 digest of its canonical JSON bytes |
| Delivery | Durable per-recipient receipt workflow; never an external effect attempt |
| Claim | Exclusive, expiring permission to validate a delivery; does not permit consumer work |
| Acknowledgement | Durable receipt of the exact validated manifest and material; does not mean task completion |
| Consumption | Immutable input set and logical consumer operation admitted once for a consumer activation |
| Hold | Durable gate with an owner, reason, affected members, blockers and allowed intervention decisions |
| Summary | Optional explanation derived from a specific manifest; never authoritative control state |
| Checkpoint | Committed node/iteration boundary; a blocked checkpoint is not node completion |

An activation is one logical invocation of a node. Loop iterations use distinct activation IDs; retries of the same iteration retain its activation and operation IDs while changing attempt IDs. A generation identifies a claim attempt. A run ownership epoch fences commands from a previous process owner. None of these identities may be reset to evade accounting or deduplication.

The authenticated coordinator supplies actor identity, policy decisions, trusted time and run ownership. Clients cannot establish these facts by putting an actor name or `HUMAN` in JSON. Raw reducers and stores remain trusted/offline interfaces; an application must not expose them as a bypass.

The integrating coordinator constructs record-bearing commands from client intent and checked ledger state. Output fields such as revision, resolved members, current controls, recipient mapping and evidence references are derived/verified there. A caller's structurally valid record is never trusted as the state to install.

## 3. Wire representation and identity

**HF-01 — Closed, versioned records.** `schema.json` is a standalone JSON Schema Draft 2020-12 contract. Unknown fields, message types and versions SHALL be rejected. It does not extend `spec/schema.json` or the released SDK constructors. Semantic rules in this document are additional to JSON shape validation.

IDs are nonempty opaque strings, bounded at 256 Unicode code points. Revisions, generations, byte counts and UTC epoch milliseconds are canonical unsigned decimal strings, at most 100 digits; generations and leases must be positive where specified. SHA-256 digests use 64 lowercase hexadecimal characters. The finite-v1 strict JSON rules (1 MiB, depth 64, no duplicate keys, unpaired surrogates or unsafe numeric literals) remain the candidate boundary. Large artifact content is stored outside records. Producers must partition an oversized fan-out into approved bounded boundaries or reject it before completion; they must never truncate recipient intent.

Canonical JSON uses the existing AIWS canonical serializer and its restricted numeric domain. SHA-256 is computed over the UTF-8 serialization of the entire manifest. The digest lives in references, not in the manifest itself, avoiding a self-hash. An ID reused with different canonical material is `IDENTITY_CONFLICT`. Hashes identify material; they are not signatures or proof of authorship.

`basis` identifies the last committed source revision and event hash **before** the boundary transaction. `checkpointId` binds the manifest to the node/iteration event committed in that transaction. The manifest does not include its own future event hash. Replay must verify that the basis was the expected predecessor and that the manifest and checkpoint were committed together.

**HF-02 — Stable deduplication.** Unique keys SHALL include:

| Domain | Unique key |
|---|---|
| Request | authority domain + authenticated principal + requestId |
| Producer boundary | missionId + runId + nodeId + activationId + checkpointId |
| Manifest | missionId + handoffId |
| Delivery | missionId + deliveryId; additionally handoffId + recipient node/activation/inputPort |
| Consumer admission | missionId + runId + consumer nodeId + activationId |
| Hold | authority domain + holdId |

An exact retry returns the original committed result without creating another event, claim, operation or reservation. Reusing a request ID with different material is `IDENTITY_CONFLICT`. Authenticate before disclosing any duplicate result. A new command must pass current authorization; an exact replay of a committed response does not execute work or broaden access. Deduplication/tombstone records remain available for the retained execution history; deletion or compaction may not permit a duplicate to become new work. Retention/compaction implementation belongs to M6.

Each confirmed logical iteration operation contributes at most once to the loop count. A different request or checkpoint ID may not count the same operation again. A producer activation cannot commit conflicting terminal outcomes under fresh manifest IDs; such material is `IDENTITY_CONFLICT`. A blocked checkpoint may later be followed by an authorized continuation boundary, but it preserves the same recorded consumption and does not repeat a previously counted operation.

## 4. Manifest and material

**HF-03 — Authoritative basis.** Every committed node boundary SHALL produce a manifest, including control nodes and END. The producer identity pins mission, run, graph and plan revisions, node, activation, operation/attempt references and checkpoint. Control nodes have an empty operation list. The runtime validates those identities and the applicable node-specific completion evidence against the ledger; a supplied operation ID alone is insufficient.

The manifest records `COMPLETED`, `SKIPPED`, `BLOCKED`, `FAILED` or `CANCELED`. `COMPLETED` is node execution completion, not automatically verification or acceptance. `BLOCKED` represents resumable incomplete work. `SKIPPED` cannot satisfy required success criteria. Each outcome includes criterion/evidence references where available and outstanding operation references. All unresolved external effects must be carried as blockers; a producer cannot turn them into success by omitting them from a caller-supplied list.

Recipients are derived from the pinned approved graph/input mapping. An END or archival-only checkpoint may have no recipients. Each listed recipient gets exactly one delivery intent in the boundary transaction. Additional recipients or material access cannot be invented by an agent. Handoffs in this version connect nodes within one run; cross-run/subworkflow and work-order transport bindings require a separately declared mapping and are not implicitly enabled.

**HF-04 — Durable artifacts.** Before committing availability, the producer SHALL durably store and verify each artifact, including immutable locator/version, digest, byte length, media type, optional schema digest and retention owner/deadline. Signed URLs and credentials are not immutable locators and must not be embedded in the manifest. Access locators may be resolved separately under current authority. Retention must cover pending consumption and the declared recovery/evidence window; retention expiry is not permission to silently break a live delivery.

Content digest is over exact artifact bytes, not a decoded/reformatted representation. A referenced schema is itself immutable and verified before use; remote schema fetching is not automatically authorized. Input validation uses the consumer's approved schema and mapping. A producer's schema assertion does not establish compatibility with every consumer.

Missing bytes, digest/size mismatch, unavailable decryption or schema failure prevent acknowledgement/admission and create or retain an appropriate hold. Repair of storage using exactly the same bytes may restore availability after revalidation. Changed bytes require a new manifest and explicit invalidation/replanning; never mutate an existing digest. Rechecking at admission/dispatch prevents a prior receipt from granting access to material that has since expired or changed. Atomic material access and execution must use an immutable verified snapshot or handle to prevent a check/use substitution.

**HF-05 — Atomic boundary.** A successful `commitBoundary` SHALL atomically commit: the validated node/iteration checkpoint; the manifest; each derived delivery intent; consumed-input lineage; applicable skip propagation; any required hold; and the authoritative audit event. Failure commits none of these. Artifacts may be stored first outside the ledger; a failed ledger transaction leaves an orphan, not a visible delivery. Recovery must reconstruct pending delivery from committed state without requiring a final agent message.

The boundary command includes a `hold` proposal only for a blocked boundary. The coordinator derives and validates its members and blockers; caller-supplied membership is never authoritative. For a terminal failed/canceled boundary, unresolved effects retain a reconciliation owner even though execution is terminal. It must not falsely create a resumable execution state. Every required node disposition, including transitively skipped nodes, needs a recorded checkpoint/manifest; multiple such records may be written by one transaction.

## 5. Delivery and consumer admission

**HD-01 — Receipt lifecycle.** Allowed delivery transitions are:

| Current | Command/event | Next | Required condition |
|---|---|---|---|
| PENDING | claimDelivery | CLAIMED | Current owner, authorized recipient, compatible outcome, unheld affected scope |
| CLAIMED | acknowledgeDelivery | ACKNOWLEDGED | Matching claim token, generation and epoch, unexpired lease; verified material and compatibility |
| CLAIMED | releaseDelivery / lease expiry / recovery | PENDING | Current token holder may release; trusted clock/owner may expire or fence; generation increments on next claim |
| PENDING or CLAIMED | exclude during approved branch/join selection | EXCLUDED | Selection is durable; no consumer admission/effect is discarded |
| PENDING, CLAIMED or ACKNOWLEDGED | invalidateHandoff | INVALIDATED | Attributable invalidation; dependent hold and lineage recorded atomically |
| ACKNOWLEDGED, EXCLUDED, INVALIDATED | exact duplicate | unchanged | Return original result; never manufacture new work |

No transition out of EXCLUDED or INVALIDATED is permitted. A corrected result uses new identities. An ACKNOWLEDGED delivery is not leased again merely because its acknowledgement was lost. A claim record is retained as acknowledgement provenance; its old lease expiry does not revoke the durable receipt. At execution admission, use current run ownership, not the receipt's historic lease.

**HD-02 — Claims and fencing.** Claim acquisition increments a monotonic generation and returns a token bound to delivery, authenticated claimant, run epoch and expiry. Only validation and immutable material reads are permitted under this claim. At `now >= expiresAt`, acknowledgement fails with `CLAIM_EXPIRED`. A stale generation, token, epoch or principal fails with `STALE_OWNER`. Lease renewal is deliberately absent in v1: release/reclaim if needed before acknowledgement. Hosts choose an authorized bounded lease duration; agents may not extend it through supplied clock values.

After same-machine recovery, increment ownership epochs durably and fence all pre-recovery unacknowledged claims. A new claim may be issued for receipt validation because claims authorize no external effect. This does not permit retrying an uncertain consumer operation. An old worker's late command is rejected even if its process is still running. External systems that cannot enforce fencing remain subject to explicit effect reconciliation.

Only the returned receipt-validation token is sent to the claimant. Persist its hash in the claim; keep the raw token out of audit/telemetry and summaries. Accepted-event records retain the token fingerprint and verified transition result needed for replay, not a reusable credential.

**HD-03 — Acknowledgement and admission separation.** `acknowledgeDelivery` SHALL verify the exact manifest digest, expected graph/plan revision, approved input mapping, artifact bytes/schema and recipient identity. Store the receipt before transport acknowledgement. An adapter supplies verified material access; a string `verified: true` is not evidence.

`admitConsumer` SHALL atomically bind the complete selected acknowledged input set to one consumer activation and logical operation, record consumption and reserve any required resources through the effect admission contract. A control node uses `operationId: null` and gets no effect authority. A duplicate activation cannot choose different input or operation material. Rejection creates no partial consumption or reservation. Dispatch performs all current authority, ownership, hold, input-validity and budget checks again.

A crash after receipt but before admission resumes at admission. A crash after admission resumes the same logical operation through existing effect recovery rules; it does not admit a second operation. Receipt, execution and verification remain separate records. At-least-once transport does not imply exactly-once external execution.

**HD-04 — Fan-out, joins and skip.** Each fan-out recipient has independent delivery/receipt state. One recipient's receipt cannot satisfy another. For ALL, every required input has a compatible acknowledged handoff. A declared optional skipped input must appear explicitly as a SKIPPED handoff in the selected input set, with a mapping that accepts that disposition; missing input is never equivalent to skip. A required skipped input propagates skip or fails according to the pinned definition, never succeeds silently.

For ANY, select one compatible completed predecessor and persist its exact input set at admission. Other candidates are excluded only under the pinned join policy. Version 1 uses conservative pre-dispatch exclusion: an unselected candidate with an admitted/active/unsettled operation blocks selection with `JOIN_UNSETTLED`. Its existing effects may not be abandoned. Losing candidates already completed remain in history but are not consumed. Racing winners serialize on consumer activation and ledger revision; only one input set is admitted. Quorum joins and arbitrary input transformations are outside v1.

**HD-05 — Invalidation and compatibility.** Invalidation SHALL append a reason/evidence record, mark all deliveries of that manifest invalid, invalidate affected consumption and assessments, and gate downstream dependent work in one serialized control transaction. Historical acknowledgements and already-applied effects remain recorded. Already-running work receives the configured stop/drain action; invalidation is not rollback. Reconciliation and compensating actions require their own authority.

Claim/ack/admission/dispatch and invalidation races are ordered by the authority ledger. If dispatch precedes invalidation, retain and reconcile its effect; if invalidation precedes dispatch, reject new dispatch. A version mismatch is `BASIS_STALE`. Candidate v1 does not permit an arbitrary compatibility override: any compatible-plan transition requires the later approved versioned workflow-change protocol. For now, create a new reviewed activation/manifest with explicit lineage.

## 6. Holds, limits and human intervention

**HS-01 — Independent gate and scope.** A hold has lifecycle OPEN → RELEASED or OPEN → CANCELED; both closed dispositions retain history. It is independent of node execution/effect state. HELD is a control projection, not a new terminal execution value. No new dispatch, ordinary admission, claim or acknowledgement may occur in affected work while an applicable OPEN hold exists. Read-only reporting, truthful effect settlement, invalidation, authorized reconciliation, owner recovery and cancellation remain possible. These operations cannot launch corrective work under the label of maintenance.

The hold pins an approved scope reference, resolver revision and explicit affected `(missionId, runId, nodeIds)` members. A whole-run member includes every current node and the future admissions of that same run; partial members cover named nodes and the dependency closure derived from the approved graph. Empty members or unknown scope bindings are rejected. Branch scope includes affected work and dependents; work-order scope includes all descendant workloads/runs. Independent work proceeds only if every applicable local and ancestor gate permits it.

Scope bindings are trusted control records. A runtime unable to atomically fence all affected members in its authority domain must reject that scope before starting work (`SCOPE_UNSUPPORTED`). It cannot approximate a work-order hold by stopping one branch. Future new members must inherit an open ancestor hold before admission. WO-01 through WO-08 now settle work-order hierarchy and identity mapping; M3 still implements the scope registry and atomic hierarchical accounting. The handoff-v1 wire records retain missionId and approved scope references unchanged.

**HS-02 — Loop and limit exhaustion.** Under this extension, a completed loop iteration with `done: false` at the last allowed iteration SHALL atomically persist that iteration, consumed attempts/cost, a BLOCKED checkpoint and an OPEN `ATTEMPT_LIMIT` hold. The node remains incomplete. It SHALL NOT mark the run terminal FAILED solely because the configured corrective bound was reached. Other unrecoverable failures can still produce terminal FAILED with a cause.

No additional iteration may run merely because the hold was dismissed. The count, prior effects, approvals, budget reservations and deadlines survive. If the bound is still exhausted, `resolveHold(RECHECK)` fails with `HOLD_NOT_CLEAR`. Additional attempts require a separately authenticated human-approved resource change (M3), or a linked new assignment with reviewed carry-forward accounting. Current immutable finite-v1 contracts cannot be edited in place.

Cost/time/attempt bounds use the same stop gate. Reaching any applicable bound stops new ordinary work in its scope. Already-running noninterruptible effects may still incur cost and must be truthfully accounted for. A hold does not promise that spent money stops increasing instantly or refunds exposure.

**HS-03 — Allowed intervention.** `resolveHold` supports RECHECK and CANCEL. RECHECK is a request to reevaluate blockers and all current gates, not a force-resume command. It releases only this hold, and only when the runtime verifies every blocker is clear under current policy. Other holds, manual pause, waits, cancellation, terminal states and exhausted ancestor limits remain effective. CANCEL records the human/policy decision and enters the applicable cancellation flow; it does not erase effects or reopen completed work.

The hold stores an owner and an explicit subset of supported decisions. Remaining held requires no state mutation. The UI may offer repair/replan within existing authority or request a human permission/resource change, but those operations use their own approved contracts; M1 does not add a `raiseBudget` or `grantSelfPermission` command.

Uncertain outcomes, any permission or resource-limit change (increases, reductions and partition transfers alike), and restart policy HUMAN always require an authenticated HUMAN decision reference. A human may authorize a resolution based on attributable evidence; a bare choice of “resume” cannot assert confirmed nonapplication or bypass required reconciliation. RULE resolutions are accepted only for an explicitly approved rule-based restart/intervention policy, with its current revision and recorded evaluation evidence. Automatic restart still reevaluates all gates. An agent-supplied claim of human identity is rejected.

**HS-04 — Accounting and time.** Hold placement/release, receipt, recovery and summary failure SHALL preserve accrued spending, attempt counts, unsettled reservations and protected allowance. Permission/resource changes are always separate human-authorized records; this extension never implicitly adds budget. Deterministic checkpointing/reporting requires no paid model request. Optional summaries may consume only a prior approved allowance inside the total; failure/exhaustion omits the summary and preserves the machine record. The actual multi-scope reservation algorithm belongs to M3.

UTC calendar deadlines, approval expiry, retention deadlines and total elapsed lifetime continue through pause/hold/downtime. Claim leases use trusted UTC and expire at equality; backward-clock uncertainty prevents extending an existing lease and requires ownership recovery. Active execution time excludes only confirmed stopped intervals; unknown intervals remain conservatively chargeable under the approved accounting profile. Parallel active-time accounting and concrete clock-fault tolerances must be declared by the engine/M3 profile, not chosen silently by a worker.

**HS-05 — Pause and aggregate state.** Opening a hold immediately fences new work but does not prove in-flight work stopped. Persist configured per-task drain/cancel/reconcile decisions. Continue to accept truthful late settlements. Nonterminal aggregate state remains RUNNING while any child is active unless manual PAUSED/cancellation precedence applies. With no active work, an unheld eligible node makes READY; otherwise an open resolvable hold is an owned outstanding condition and makes WAITING. Dead dependencies without any valid wait/hold path fail explicitly.

A UI may show “RUNNING · branch held” or “WAITING · intervention required” using both dimensions. Clearing one hold does not change verification/acceptance to success or automatically invoke a worker. Required nodes must still finish and pass applicable outcome gates before run completion.

**HS-06 — Recovery and terminal history.** Recovery SHALL append a new ownership epoch, preserve all holds/deliveries/consumption/effect state, and reconstruct pending work without executing adapters. The selected AUTO/HUMAN/RULE restart policy controls subsequent admission. HUMAN creates or retains a restart hold; AUTO cannot clear uncertainty, limits, a manual pause or another hold. Recovering on another machine remains outside the requested engine scope.

Terminal FAILED/COMPLETED/CANCELED/REJECTED histories are never reopened. Late evidence may settle an effect or append an invalidation but cannot resume execution. Cancellation closes the relevant hold as CANCELED only with its required disposition recorded; unresolved effects retain owners. A closed hold is never deleted or reused to reset history.

**HS-07 — Attributable events.** The authority ledger SHALL record accepted commands and their derived transitions with monotonic revision, previous-event hash, authenticated actor, policy/decision reference, trusted time, affected identities and result. Replay verifies these facts and applies recorded outcomes; it does not rerun clocks, rules, model calls or adapters. Rejected commands change no domain state or success ledger event; denial diagnostics may be recorded separately without pretending the requested transition succeeded.

Emit correlated events for boundary commit, claim, receipt, consumption, invalidation, hold opened/released/canceled and ownership recovery. Projections should expose pending-delivery count/age, open holds by reason, claim-expiry/stale-owner rejections and blocked descendants. IDs remain trace attributes rather than unbounded metric labels. Material and summary text, credentials and access URLs are not automatically exported. Notification/inbox delivery is an external integration; authoritative holds survive telemetry outages.

## 7. Command contracts

Every command envelope carries protocol, requestId, expectedRevision, missionId, runId, ownerEpoch and a closed body. `expectedRevision` is the authority-ledger revision, not a client timestamp. All commands require authenticated current policy and correct ownership; operator recovery is the sole command authorized against the old epoch in order to replace it. Scope-wide commands also validate authority over every affected member. Replays of committed requests use HF-02.

| Body type | Additional preconditions | Atomic result / accounting effect |
|---|---|---|
| commitBoundary | Correct basis, pinned output and evidence, durable artifacts, derived recipients; BLOCKED requires validated hold | Checkpoint + manifest + delivery intents + skip/hold lineage; records settled iteration, never clears exposure |
| claimDelivery | PENDING or safely expired/fenced claim; no affected hold | New generation/token; no operation or spend admission |
| acknowledgeDelivery | Exact live claim and material; no affected hold | Durable receipt; no task completion or reservation release |
| releaseDelivery | Current claimant/generation/epoch | PENDING; no effect or accounting reset |
| admitConsumer | Complete compatible receipt set, current gates, unique activation | Consumption and governed operation admission/reservation, or a control-node checkpoint entitlement |
| invalidateHandoff | Authorized invalidator, attributable reason/evidence | Invalid deliveries/consumption/assessments plus affected hold; effects remain accountable |
| placeHold | Authorized operator/rule/runtime, trusted resolved scope | OPEN gate and stop disposition; no new allowance |
| resolveHold | Authorized decision, OPEN hold, permitted decision, verified clear blockers for RECHECK | RELEASED or CANCELED; no bypass, new work or automatic refund |
| recoverOwnership | Trusted recovery authority, CAS on current epoch/revision | New epoch; unacknowledged claims fenced; policy hold as needed; no adapters |
| recordSummary | Exact manifest basis, authorized author, any model cost settled through governed operation | Optional immutable explanatory record; no changed manifest, gate or authority |

`admitConsumer.admissionRef` names a separately checked effect-admission record/proposal prepared by the integrating runtime, including full action, grant, approval and amount. The transaction must validate and commit it with consumption, not merely trust a caller's reference. For a side-effect-free control node it is null. Defining native bindings to existing admission commands is an M2 task. No code example here invokes a nonexistent SDK method.

### 7.1 Relational checks beyond JSON Schema

The following are mandatory runtime checks; the M1 shape validator does not establish them:

| Relationship | Required check |
|---|---|
| Envelope and record identity | mission/run/epoch agree with the active authority domain and producing/consuming run |
| Boundary basis | source revision/hash equals the last committed ledger position; checkpoint is new for this activation or an exact duplicate |
| Manifest references | digest recomputes from canonical material; referenced operations, attempts, criteria, controls and inputs exist and belong to the declared lineage |
| Manifest recipients | no duplicate delivery identity or recipient tuple; exact approved downstream mapping, including generated skipped dispositions |
| Delivery recipient | outer delivery ID equals recipient delivery ID; producer manifest contains that recipient and digest; claim generation equals projection generation |
| Claim | token hash, authenticated principal, generation, epoch and trusted expiry all match the current claim |
| Consumption | input deliveries are unique and acknowledged, belong to this run/recipient activation, satisfy join selection and remain valid; operation/action/admission binding is unique |
| Hold placement | record state is OPEN with no resolution; owner, reason and members match trusted policy/scope resolution; blocker's subject/evidence are authoritative |
| Hold resolution | decision actor/type/evidence match authenticated authority; reasons are historically retained but their live predicates are reevaluated and clear before release |
| Summary | exact immutable manifest digest; any MODEL operation has its real cost and effect settled through the governed ledger; summary text is never interpreted as policy |
| Revision/time fields | assigned from the successful serialized transaction and trusted clock; projected revisions cannot be supplied to overwrite newer state |

Control-record IDs refer to immutable snapshots in the authority domain. `resume.eligibleNodeIds` is advisory at that basis revision; it never overrides the live scheduler/gates. `requiredChecks` must include the integrating profile's mandatory authority, material, limits, ownership and hold checks even when a client omits them.

## 8. Error and replay contract

| Code | Meaning / action |
|---|---|
| UNSUPPORTED_PROTOCOL | Unknown version/feature; reject before execution |
| SCHEMA_INVALID | Closed-wire shape or strict JSON violation |
| IDENTITY_CONFLICT | Stable identity reused with different material |
| REVISION_CONFLICT | Stale authority-ledger revision; reread before a new decision |
| AUTHORIZATION_DENIED | Authenticated policy does not authorize the command |
| HUMAN_REQUIRED | Actor/decision lacks the required genuine human authority |
| SCOPE_UNSUPPORTED | Scope cannot be authoritatively resolved/fenced |
| BASIS_STALE | Producer/consumer graph, plan, source revision or material is stale |
| ARTIFACT_UNAVAILABLE | Immutable material cannot be obtained under valid access/retention |
| ARTIFACT_MISMATCH | Digest or size differs from the manifest |
| INPUT_INCOMPATIBLE | Outcome or consumer schema/input mapping rejects the material |
| STALE_OWNER | Claim token/generation/principal or run epoch is stale |
| CLAIM_EXPIRED | Trusted time has reached the lease expiry |
| DELIVERY_STATE | Operation is not permitted in current receipt state |
| INPUT_SET_CONFLICT | An activation is already bound to different inputs/operation |
| JOIN_UNSETTLED | ANY exclusion would abandon admitted/active/unsettled work |
| HOLD_ACTIVE | An applicable gate blocks new ordinary work |
| HOLD_NOT_CLEAR | A blocker or an applicable bound still prevents release |
| HOLD_STATE | Hold is closed or requested decision is not allowed |
| TERMINAL_EXECUTION | Execution cannot be resumed from a terminal state |

Error precedence is: protocol/shape; authentication; request replay/conflict; revision; ownership; scoped authorization/human rule; applicable hold/pause/cancellation gates; object/basis/material validity and delivery/hold state; admission/accounting checks. Gate checks apply only to commands that launch or enable ordinary work; maintenance and hold-resolution commands follow their stated exceptions. Exact scenario tests isolate a single violated rule unless they explicitly test precedence. None of these errors authorizes a best-effort partial mutation. A rejected dispatch must never be retried as a different effect merely to avoid its identity.

## 9. Migration and negotiation

**HM-01 — Explicit opt-in.** Negotiate `aiws-handoff/1` and its exact schema/contract revision before activating any graph that requires it. A runtime must declare accepted protocol IDs and supported scope/transport bindings. A graph's required extension is checked before starting work; absence or unknown protocol is a rejection, never a downgrade. Wire-shape version 1 is immutable once released; incompatible changes need a new protocol ID. Candidate changes before release remain versioned by repository commit and schema digest.

| Source / target | Required behavior |
|---|---|
| finite-v1 SDK 0.3.0 receives new protocol | Reject unsupported fields/messages; no silent pass-through |
| New implementation replays old journal | Select the original codec/reducer and preserve original event hashes and semantics |
| Old LOOP exhausted as FAILED | Remains terminal FAILED, even if the new engine uses holds for new runs |
| Old nonterminal run without handoffs | Continue with its original profile, or migrate at a reviewed quiescent/reconciled boundary into a linked new run |
| New handoff journal sent to old implementation | Archival opaque retention only if explicitly supported; no executable import claim |
| Legacy example-handoff/1 report | Informational artifact; cannot become an acknowledged protocol manifest |

Migration preserves source run/operation identity links, spent amounts, attempts, unresolved reservations, evidence and approval history. The target must reject execution if a complete mapping or authoritative carry-forward is unavailable. An old node result does not prove historical artifact durability or consumer acknowledgement. A target may create a new migration checkpoint after verification, clearly identified as newly produced, without inventing past receipts. UNKNOWN effects require human resolution before automatic continuation. No in-place journal relabeling, hash rewriting, automatic FAILED→HELD conversion, or blanket approval transfer is permitted.

## 10. Scenario package and acceptance boundary

`fixtures.json` supplies valid wire examples and invalid mutations. `scenarios.json` supplies stateful acceptance scenarios with setup, actions, fault boundaries, expected outcomes and requirement IDs. The M1 validator checks schemas, wire examples, rejected shapes and requirement/scenario coverage. It does not implement or certify the state machine. M2 must run the semantic scenarios independently against all three native implementations; M5/M6 add real adapter/storage crash tests.

Every producer/consumer crash boundary must preserve the last durable owner and uncertain-effect exposure. Required cases include orphan artifacts, missing boundary commit, committed pending delivery, expired/fenced claims, lost receipt responses, admitted-but-undispatched work, dispatched-but-unsettled work, invalidation races, joins/skips, held parallel branches, overlapping holds and attempts/time/cost exhaustion. The package explicitly distinguishes these expected behaviors from tests already executed.

## 11. Remaining decisions and implementation handoff

| Item | Disposition |
|---|---|
| Work-order/mission/run mapping and scope registry | Identity decision accepted in WO-01–WO-08; scope registry and accounting implementation remain M3 |
| Exact resource-change and protected-reserve wire format | M3; absent from M1 commands |
| Native atomic admission/boundary APIs and persistence migration | M2; implement the candidate and demonstrate rollback/fencing |
| Engine process/worker/transport/identity/UI choices | M4 with user clarification |
| Dynamic compatible-plan revision and agent replacement | M7; v1 rejects stale revisions |
| Artifact adapters, persistence guarantees, clock tolerance and retention capacity | Engine binding/deployment work; declared limits and real tests required |

M1 is complete as a specification candidate when its records, invariants, migration rules and shared acceptance cases are reviewable and mechanically checked. That completion does not mark M2 or M3 implemented, or claim that the user has selected the still-open architecture choices.


## Accepted identity binding update — 2026-09-08

See the [engine hierarchy specification](../../guide/engine-design.md) and SDK identity design (not in this pack). The `aiws-engine-identity/0.1` draft is an identity-only design representation. Its Handoff/Delivery records do not replace this protocol's complete manifest, receipt, command or digest schemas. Existing handoff-v1 validations and wire records remain authoritative for this protocol. A future adapter must explicitly map graph/node occurrences, operation lists, immutable handoff revisions and receipt/admission state; unsupported mappings fail closed. This update records the user-approved assignment model without claiming M2/M3 implementation.

