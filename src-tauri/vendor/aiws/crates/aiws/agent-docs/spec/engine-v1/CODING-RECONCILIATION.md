# Coding reconciliation and stale assessments — M7 Slice 7

Status: experimental TypeScript/Node 24 + SQLite source profile, 2026-09-10. Extends [execution binding](./EXECUTION-BINDINGS.md) and [agent replacement](./AGENT-REPLACEMENT.md). This slice chooses stale-result rejection; no cross-revision compatibility grant is implemented.

## Applicability versus historical integrity

`verifyDurableResult` verifies historical evidence against its immutable task, attempt, definition, material and ownership pins. It does not authorize current use. Composed completion, validation and acceptance additionally call `assertCurrentResult`: the attempt must match the current task instance, definition and agent assignment, must not have been reconciled, and must not have an invalidated assessment or unresolved replacement hold. Current-owner publication also rejects a superseded task instance, even when the definition, agent and coordinator epoch are unchanged.

Every activated definition change conservatively invalidates all prior bound assessments in the run. This includes dependent assessments and covers opaque shared effects beyond structural DAG edges. Each immutable invalidation retains the validation ID, run, cause, target definition and affected-task context. Reconciliation likewise invalidates prior assessments before retry. The old results, validation records and pins are retained unchanged and remain available for historical verification. Already consumed artifacts can remain reviewed stage inputs; an old assessment cannot satisfy current completion or acceptance.

## Governed retry command

`RECONCILE_CODING` is a closed record with:

| Field | Requirement |
|---|---|
| `ref` | Exact bound work-order/run identity |
| `reconciliationId` | Unique immutable decision identity |
| `expectedWorkflowRevision` | Current aggregate revision |
| `decision` | Exactly `RETRY_STAGE` |
| `evidenceRef` | Reference to independently verified cessation/effect evidence |
| `approvalId` | Exact human approval evidence |

`inspectReconciliation(ref, reconciliationId)` returns the exact read-only snapshot and digest. It includes workflow state, attempts, deliveries, intents, scheduler tasks/claims/reservations, handoffs, dispatch reservations/scope, controls, holds, validations and correction history. The human review binds this digest, current definition, command identity, expected revision, evidence reference, installation, authority epoch and coordinator epoch. A ledger or delivery change invalidates review even if the workflow revision did not change. This local inspection is a trusted-host API, not a public unauthenticated endpoint.

The host must provide independent `verifyReconciliation(review)` evidence. The verifier runs before the command, outside any database transaction, against a fresh review, and returns a proof record as data with exactly `reconciliationDigest`, `evidenceRef`, `expiresAt`, `ownerStopped: true`, `effects: NO_EFFECT | RETRY_SAFE`, `exposureWithinReservation: true` and `subjectDigest`, the subject digest of the review it verified against. Inside the write transaction the engine checks the proof against the review it resolves there: a proof whose `subjectDigest` differs, because the material changed after the host verified, fails with `STALE_REVISION` and commits nothing. Digest and evidence reference must match the review. The proof must be unexpired through commit. No host code runs inside the transaction. Caller claims, a timeout, absence of a result, or human approval alone do not establish effect safety. Production verification must establish that prior execution cannot continue, all relevant effects are known, replay is safe, and unresolved usage stayed within its reservation. A known recorded exposure excess is rejected even if the host asserts otherwise.

## Eligible recovery

Only a HELD, nonterminal bound coding run can retry. Supported hold reasons are uncertain outcome, replacement reconciliation, failed execution or failed insertion. An explicit replacement hold can also suspend a completed assessment pending reviewed revalidation. Controls must remain RUNNING; unrelated open accounting holds and hierarchical scopes are refused. All outstanding attempts, active claims and nonterminal tasks must belong to the current stage. Exhausted correction limits cannot be reset through a replacement hold. Unproven effects or unsupported hold reasons remain held.

The proof can cover a stopped active claim, a dispatched/UNKNOWN attempt, a completed result or an unstarted stage. The transition does not assume a failed outcome, invent worker evidence, mark validation passed, or transfer a stale result to the new task. It retries the same stage with the same plan, inputs, ordinal, scope, policies and correction history. Existing input-manifest checks and dispatch limits still apply.

## Atomic transition and accounting

One registry transaction:

1. Stores an immutable reconciliation snapshot, host proof and transition.
2. Marks every old attempt for the current task as permanently reconciled. Unresolved attempts become SETTLED with a reconciliation evidence reference, preserving their prior status in the snapshot. Existing worker evidence and validation rows remain untouched.
3. Cancels pending old delivery intents; releases active scheduler claims/capacity after proven cessation; cancels uncompleted old queue instances and unconsumed handoffs.
4. Records immutable resolution links for replacement holds and closes only their associated dispatch holds.
5. Invalidates prior assessments, creates a new task identity, clears stage approval and final assessment/acceptance pointers, and enters AWAITING_APPROVAL in the current epoch.
6. Writes audit, human approval consumption and an idempotent command receipt.

**Dispatch scopes and reservations are unchanged.** Prior cumulative attempts and charged cost/time remain exactly as recorded. Unresolved maximum reservations are conservatively retained as charges. This is not a refund or actual-usage adjustment; available capacity may be exhausted after reconciliation. Scheduler slot release does not replenish dispatch budgets. A fresh attempt requires new human stage approval and normal admission. A replacement assignment also requires its current-epoch acknowledgment before dispatch.

The immutable reconciliation marker permanently blocks late publication or current use of the old attempt, including after hold release, restart or another replacement. Reconciliation changes the execution instance, not the definition revision. Retrying the same authenticated request returns the recorded receipt without repeating accounting/state changes. Reusing a reconciliation identity with another request is refused. Restart requires fresh epoch-bound review for an uncommitted decision; a committed decision stays durable.

## Boundaries and evidence

No automatic compensation, rollback of external effects, refunds, permission or limit changes, plan edits or cross-revision result reuse is authorized. The host verifies cessation; the engine does not kill external workers. Uncertain or irreversible effects without a safe retry proof stay held. Arbitrary branch recovery and selective cross-revision compatibility require later explicit contracts. Full-snapshot decisions use existing stored-record size/depth limits and fail closed when too large; no unbounded-history scalability claim is made.

The optional `coding_reconciliation_version=1` component has guarded immutable reconciliation, attempt-disposition, hold-resolution and assessment-invalidation tables. Unsupported versions, missing tables and missing guards fail closed. Local process/SQLite tests do not close M6 platform, device-power-loss, complete backup/migration or long-duration acceptance gates.

See delivery evidence (not in this pack), [guide](../../guide/engine-coding-reconciliation.md) and runnable example (not in this pack).
