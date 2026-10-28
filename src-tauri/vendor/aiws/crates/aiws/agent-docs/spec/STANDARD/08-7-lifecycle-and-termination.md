# 7 Lifecycle and termination

**L-01 — Separate dimensions.** The runtime SHALL maintain execution, verification, and acceptance as separate run-state dimensions. Task execution SHALL follow the execution rules; task verification and acceptance are required where specified by the contract. Attempts and effects SHALL follow Clause 10. The transition table is normative; aggregate state rules in L-06 SHALL additionally apply.

The allowed execution transitions are:

| Current state | Permitted next states | Condition |
|---|---|---|
| CREATED | READY, REJECTED, CANCELED | Admission succeeds, fails, or is withdrawn before dispatch. |
| READY | RUNNING, WAITING, COMPLETED, PAUSED, CANCELED, FAILED | Dispatch begins, operator pauses/cancels, or a pre-dispatch failure occurs. |
| RUNNING | READY, WAITING, PAUSED, CANCELING, COMPLETED, FAILED | Work becomes runnable without an active worker, waits, dispatch is paused, cancellation starts, work finishes, or execution fails. |
| WAITING | READY, PAUSED, CANCELING, FAILED | Wait condition is satisfied and revalidated, pause/cancel occurs, or the wait fails. |
| PAUSED | READY, CANCELING, FAILED | Authorized resumption or disposition. |
| CANCELING | CANCELED, FAILED | Cancellation settles, or its controlled shutdown fails. |
| COMPLETED, FAILED, CANCELED, REJECTED | None | Execution is terminal. |

**L-02 — Wait and pause.** The runtime SHALL persist each WaitCondition independently, including task/run identity, INPUT/AUTHORIZATION/EXTERNAL/TIMER/RECONCILIATION type, owner, correlation, deadline, expected input revision, and pending/satisfied/expired/canceled status. Joins SHALL declare ALL or ANY over an identified condition set and the disposition of remaining conditions. Duplicate satisfaction SHALL be idempotent; stale or mismatched inputs SHALL NOT release work. PAUSED SHALL stop new dispatch without implying that in-flight work stopped. Satisfaction and resumption SHALL trigger fresh authority, policy, input, and budget checks.

**L-03 — Terminal execution.** COMPLETED SHALL mean that the plan's required execution obligations have finished and no required child work remains active. FAILED SHALL carry a cause and remaining-work disposition. Terminal execution SHALL never be reopened; additional work requires a linked new task within a nonterminal run, or a linked new run if the original run is terminal. A failed or canceled run may retain unresolved external effects, which SHALL remain visible in its effect ledger and be assigned to a reconciliation owner or linked recovery run.

**L-04 — Cancellation.** On an authorized cancellation request, the runtime SHALL stop new ordinary work, record the request, propagate cancellation to active children where supported, and track acknowledgments and unresolved effects. It SHALL publish its cancellation response limit. If shutdown cannot settle within that limit, it SHALL record FAILED with unresolved disposition rather than falsely reporting a successful cancellation. CANCELED SHALL NOT imply rollback.

**L-05 — Race handling.** The runtime SHALL serialize competing lifecycle transitions for each object using a durable revision or equivalent mechanism. Late or duplicate callbacks SHALL NOT regress terminal execution, duplicate an effect, or manufacture verification success. They MAY append evidence or resolve an effect record without reopening execution.

**L-06 — Parallel aggregation.** The runtime SHALL retain child states even when presenting an aggregate run state. Subject to terminal, cancellation, and pause precedence, a run with active work SHALL remain RUNNING even when another child waits. With no active work and eligible runnable work, it SHALL be READY; with neither active nor eligible runnable work and outstanding required waits, it SHALL be WAITING. An unsatisfied dependency without a satisfiable predecessor or wait SHALL cause a recorded failure, not an indefinite unexplained wait. COMPLETED SHALL require all required execution obligations to settle. Aggregate updates SHALL obey the transition table, including intermediate READY before dispatch after a wait.
