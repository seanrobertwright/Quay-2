# Reconcile held work and stale results

> **Praxis naming:** This page documents **Praxis**, the AIWS workflow engine. Existing `engine/*` source paths, `/engine/...` routes, `aiws-engine/*` protocol identifiers, and existing script names remain unchanged for compatibility.

M7 Slice 7 adds **reviewed recovery of held coding work** and separates historical evidence from evidence that can satisfy the current workflow. Stale or reconciled attempts cannot publish into a new task or satisfy current acceptance. Old evidence stays available for inspection.

Use current GitHub source on Node.js 24. These experimental TypeScript engine APIs are separate from the baseline SDK packages and source download.

```sh
npm run engine:typecheck
npm run test:engine:m7-reconciliation
npm run example:engine:reconciliation
```

## What the example proves

The demo interrupts execution after dispatch authorization but before worker delivery. It records a hold, simulates independent verification that no effect occurred, obtains exact human retry approval, and executes a new implementation/validation pair through final acceptance. The original attempt remains charged: three cumulative attempts, with the interrupted attempt's full time reservation retained.

The demo identities and effect proof are explicitly simulated. Production hosts must establish worker cessation and effect safety independently.

## Review the evidence before retry

1. Inspect the held [bound coding workflow](./engine-execution-bindings.md). If needed, use the exact human-approved `HOLD_REPLACEMENT` action described in [agent replacement](./engine-agent-replacement.md).
2. Choose a unique reconciliation ID and call `registry.inspectReconciliation(ref, reconciliationId)`. Inspect the workflow, attempts, deliveries, handoffs, claims, holds and accounting in this snapshot.
3. Establish that the prior owner has stopped, all relevant effects are known, retry is safe, and unresolved exposure stayed within its reservation. A timeout or missing result alone proves none of these.
4. Review a `RECONCILE_CODING` command with `decision: 'RETRY_STAGE'`, the exact work-order/run, expected workflow revision, reconciliation ID, evidence reference and approval ID. Match the inspection digest to `registry.review(...).reconciliationDigest` before issuing approval.
5. Execute with the human's lease. Before the command, outside any database transaction, the host's independent `verifyReconciliation(review)` runs against a fresh review. It must return a matching, unexpired proof of cessation, bounded exposure and either `NO_EFFECT` or `RETRY_SAFE`, carrying that review's `subjectDigest`. The registry rechecks the proof inside its write transaction. A proof made against an earlier review fails with `STALE_REVISION`.
6. Renew stage approval. The workflow retries the same stage under a new task identity. A replacement agent must also acknowledge its assignment in the current coordinator epoch.

The full runnable sequence is `engine/examples/coding-reconciliation.ts`. These are trusted local host APIs. Native SDKs, remote CLI/web controls and parity remain Slice 8 work.

## What changes—and what remains charged

| Record or condition | Reconciliation behavior |
|---|---|
| Old attempts and result evidence | Retained; permanently excluded from new publication or current acceptance |
| Unresolved attempt | Settled by explicit reconciliation; prior state and proof retained |
| Prior cost/time reservations and attempt count | Unchanged, including full reservations for uncertain attempts |
| Active scheduler claim | Released only after verified cessation |
| Replacement hold | Resolved with an immutable decision link |
| Separate accounting hold or paused/canceled control | Blocks reconciliation |
| Plan, stage inputs, ordinal and correction history | Preserved |
| Stage approval and final validation pointer | Cleared; new approval and fresh validation required |
| Retry task | New identity; ordinary admission and resource limits apply |

An exhausted budget can still block the new attempt. Reconciliation does not add attempts, expand permissions, reset correction limits, refund resources or compensate external effects. The engine records verified cessation; it does not terminate an external process itself.

## Stale assessments and historical results

A definition change conservatively invalidates all prior assessments in that bound run, covering downstream dependencies and possible shared effects. Reconciliation also invalidates prior assessments before retry. Invalidations record their cause while preserving the original validation/evidence records.

Historical integrity checks still work. Current completion and acceptance additionally require the exact current task instance, definition and agent assignment, with no reconciliation marker, invalidation or unresolved replacement hold. An artifact already consumed as a reviewed stage input can remain an input; its old assessment does not become proof that new work passed.

This slice rejects stale-result reuse. It provides no compatibility grant for using another revision's result as current evidence.

## Recovery limits

Uncertain effects, an owner that may still be running, unrelated holds, known excess exposure and exhausted correction rules remain blocked. Eligible recovery covers the current coding stage; it cannot skip branches or invent a successful outcome. A previously passing validation can be held and retried, but cannot retain its old acceptance authority.

Transactions and durable receipts cover retries and process termination before/after commit. An uncommitted decision needs fresh review after restart. Input-manifest checks continue to protect retry inputs. Full-snapshot review uses existing record-size limits; oversized decisions fail closed.

The contract is `spec/engine-v1/CODING-RECONCILIATION.md`; local verification is in `docs/M7-CODING-RECONCILIATION.md`. M6 platform and long-duration qualification remains open independently.
