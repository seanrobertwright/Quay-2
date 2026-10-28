# Errors and recovery decisions

Errors are stable codes carried by AiwsError. TypeScript exposes error.code, Rust returns Result with an error code, and Python raises AiwsError with code. Shape errors often use INVALID_RECORD; the SDK does not expose every underlying schema diagnostic through a standardized rich error object.

## Diagnose by phase

| Code or family | Likely cause | Appropriate response |
|---|---|---|
| INVALID_RECORD / UNSAFE_NUMBER | Unsupported fields, wrong edition/types or unsafe numeric material | Validate against the exact shared schema; preserve decimal strings |
| DUPLICATE_KEY / INPUT_LIMIT | Ambiguous JSON or parser resource limit | Reject at ingress; use bounded transport for large records |
| AUTHORITY_DENIED / AUTHORITY_INDETERMINATE | Principal, scope, validity or policy does not permit work | Obtain authorized correction; never turn uncertainty into ALLOW |
| ATTRIBUTION_REQUIRED | Authorizer omitted actor or policy revision | Repair trusted authorizer output |
| REVISION_CONFLICT | State changed after inspection | Reload, reauthorize and decide whether the original command remains appropriate |
| APPROVAL_INVALID / APPROVAL_CONSUMED | Material, expiry, withdrawal or allowed uses | Obtain the correct new approval; do not mutate prior evidence |
| BUDGET_EXHAUSTED / GRANT_BUDGET_EXHAUSTED | Reservation would exceed an applicable allowance | Hold affected work and request a human decision |
| EXPOSURE_EXCEEDED | Observed cost exceeds reserved exposure | Retain incident and external receipt; fix integration/accounting through an authorized path |
| UNSAFE_RETRY / EFFECT_UNKNOWN | External outcome is not known to be nonapplication | Human-controlled reconciliation |
| STALE_OWNER | Prepared attempt belongs to an earlier recovery epoch | Do not reuse the old worker's dispatch claim |
| NODE_NOT_READY / NODE_EFFECT | Dependency or effect proof missing | Inspect graph and bound operation; do not bypass completion checks |
| GRAPH_CYCLE / NO_END_PATH | Unsupported graph topology | Use bounded LOOP and valid END paths |
| LOOP_LIMIT / RETRY_LIMIT | A configured attempt/iteration bound is reached | Preserve consumed allowance; follow stop/intervention rules |
| WAIT_EXPIRED / CORRELATION_MISMATCH | Late or unrelated response | Record and review; never rewrite the old wait's identity |
| EVENT_ID_CONFLICT / EVENT_SOURCE | Changed duplicate or source/type mismatch | Reject and investigate upstream identity handling |
| TRIGGER_RATE / TRIGGER_CONCURRENCY | Admission capacity bound | Defer with original identity only when policy permits |
| JOURNAL_INTEGRITY / EVENT_MISMATCH | Stored records disagree with digest/semantic replay | Stop execution and inspect an authoritative backup |
| CLOCK_REGRESSION / METRIC_RANGE | Unsupported telemetry time or numeric representation | Correct measurement source; do not silently round accounting |

For exact command requirements use the generated [wire reference](./wire-reference.md). A service should map these codes to suitable application responses without disclosing secrets or returning raw database exceptions to untrusted callers.

## Symptoms that are not SDK defects

A registered trigger does nothing if no host invokes it. A ready TASK does nothing if no scheduler dispatches its adapter. A TIMER wait does not wake a sleeping process by itself. An AUTHORIZATION wait does not send a human notification. A graph END node does not automatically accept a deliverable. A queued trace is not exported until the application flushes it.

## Preserve evidence while repairing

Never delete the mission database to remove a conflict, manually flip an UNKNOWN attempt to SUCCEEDED, overwrite the stored contract, or grant an agent broader authority merely to silence an error. Save the error, relevant IDs, current revision and operator decision. Sensitive prompts, tokens and evidence contents belong in protected records rather than indiscriminate log messages.
