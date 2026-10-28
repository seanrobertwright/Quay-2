# Nested resource accounting — aiws-limits/1

Status: M3 implementation contract. This opt-in ledger supplements, and never
relaxes, finite-v1 authority and handoff-v1 admission checks. Work order is the
existing mission identity (WO-01–WO-08). No engine scheduler is introduced here.

M10 specifies revision 1.1 of this profile, with optional fields only, and the coding
workflow's use of the full scope tree; see [Revision 1.1](#revision-11). Both are specified
in agent binding §6 (not in this pack). No SDK implements
revision 1.1. The engine's own coding ledger records a reservation's pinned price table version and
each priced settlement's basis, price table digest and flags, and builds a RUN scope with one NODE
scope for a run with an exposure allowance; the rest of the tree and `Config.costUnitDisplay` are
not implemented. For an overrun, the engine's ledger has the human-only adjustment of a scope's cost
bound described under [Authority and exhaustion](#authority-and-exhaustion), and settles the attempt
above its reservation, at its true cost, only after a human raised the bounds for it
(agent binding §6 (not in this pack)).

## Accounting domain and identity

One durable ledger owns the complete configured work-order tree. Every reservation
is charged once to its leaf and once to each ancestor, within one transaction.
Sibling work must use the same ledger database. Summing independent mission
databases is not an admissible replacement. Cross-machine recovery remains out of
scope. Scope membership, parentage and dependencies are immutable in this profile.

Scopes are WORK_ORDER, RUN, BRANCH or NODE. A work-order scope has id = missionId;
a run scope has id = runId. RUN belongs to WORK_ORDER; BRANCH/NODE belongs to a
RUN or BRANCH of the same work order and run. A child WORK_ORDER has one
WORK_ORDER parent. Roots are WORK_ORDERs. IDs are unique within the ledger.
An attempt binds its operation, run and leaf scope permanently. Continuation,
agent replacement, retry and child work cannot erase earlier accounting.

Dependencies are additional admission gates, not additional cost ancestors.
The dependency graph together with parent-to-child edges must be acyclic.
Dependency gates include the prerequisite's ancestors; exhaustion in a branch
therefore blocks dependent work transitively. An independent sibling is allowed
only while its own complete ancestry remains eligible.

## Units and simultaneous bounds

All quantities are canonical unsigned decimal strings. Cost uses one fixed unit
chosen by the host for this ledger; no floating point or currency conversion.
Time is integer milliseconds on the host's trusted clock. Nullable limits inherit
the remaining ancestor bounds; null does not remove those bounds. A zero bound
allows no new work. All applicable bounds must pass, not merely one.

| Limit | Accounting rule |
|---|---|
| cost | Actual settled cost plus maximum unsettled cost exposure |
| handoff | Protected portion of cost; ordinary/cleanup use cost minus handoff, summaries use handoff |
| activeMs | Sum of per-attempt execution intervals, with maximum active-time reservations before dispatch |
| elapsedMs | Time since the immutable scope start, including pauses and downtime |
| attempts | Each successfully reserved attempt consumes one, permanently, even if later abandoned before dispatch |

Handoff must be zero when cost is unbounded at a scope; an ancestor may still
provide a finite bound. At a bounded scope handoff <= cost. Ordinary and cleanup
exposure never consume the protected portion. Summary exposure never exceeds
that portion. Both count inside the total. Changing either partition is a human
resource adjustment. Optional paid summaries still obey time and attempt limits;
the deterministic report has no paid admission and remains available at zero.

Active time is **summed execution time**, not the union of wall-clock intervals:
two concurrent ten-millisecond attempts consume twenty milliseconds at their
parent. A reserved attempt holds maxActiveMs. Once dispatched, its exposure is
max(maxActiveMs, now - dispatchedAt) until a confirmed stop or settlement.
Uncertain external outcomes continue accruing time through pauses and downtime.
A confirmed stop freezes active time but does not release financial exposure.
Settlement retains measured active time, and releases only unused cost exposure.
Rejected admission does not change accounting. Backward clocks fail closed.

## Lifecycle and atomicity

`reserve` creates RESERVED responsibility before any local preparation or external
dispatch. It checks the leaf, all ancestors and dependency gates atomically.
`dispatch` rechecks current bounds and dependencies using the existing reservation;
it does not consume another attempt. RESERVED may be released because dispatch
has not been authorized. DISPATCHED or UNKNOWN may not be released. `unknown`
retains all exposure; `stop` requires authoritative evidence that execution has
ceased; `settle` requires authoritative final outcome/cost evidence. Settlement
above the reserved maximum fails closed and requires a human-approved bound
change/reconciliation outside this initial profile; it must not hide an overrun.

The host records ledger dispatch before external dispatch. A crash between those
steps leaves conservative responsibility, requiring reconciliation rather than
an automatic refund. Hosts also perform the existing handoff/authority dispatch
checks. A ledger reservation is not an authority grant. A stale owner or changed
policy must still be rejected by the host's authorizer. Ledger and mission writes
in different databases are not claimed to be one atomic commit.

The authorizer resolves the operation's configured scope and purpose from trusted
workflow definitions; it must not let an agent choose a less restrictive scope or
label ordinary work as HANDOFF. Later attempts for the same operation cannot change
scope, run or purpose in the ledger. Actual summary-provider calls are external
effects and follow the same reserve/dispatch/outcome sequence as ordinary calls.

Every accepted command has a request ID, expected ledger revision and authenticated
facts. Same-actor identical retries return the original result without new charges;
different content with that ID is rejected. Revision comparison occurs under the
SQLite write lock. Journals are hash-linked and replayed; the same accounting state
must result in all three SDKs. The journal also serves as durable event evidence.

## Authority and exhaustion

Initial configuration is a trusted, human-approved host input. The host must retain
its approval evidence. Only an authenticated HUMAN may adjust limits, with a
nonempty approval/evidence reference bound by the authorizer to the exact command,
scope, revision and current policy. Agents and rules cannot adjust limits, including
reductions or partition changes. Adjustments preserve all consumption, start times,
reservation identities and history. Lowering a bound below current exposure is
rejected. The ledger never authenticates a human from caller-supplied text.

The trusted store/reducer accepts verified facts; application clients use a
coordinator whose host authorizer authenticates and authorizes each exact request.
Evidence for stops/settlements is likewise host-verified, not an agent assertion.
Resolving UNKNOWN with either stop or settlement additionally requires a HUMAN.

Reports identify exhausted scopes, affected descendants/dependents, outstanding
effects and allowed responses: remain held; cancel without assuming refund;
narrow/replan inside current authority; request a human-approved adjustment.
Running effects remain charged. The host applies their declared interruption policy:
request stop where supported; otherwise observe to a truthful terminal outcome.
Stop/settle/report commands remain available while admission is blocked. Paid
cleanup is ordinary budgeted work and has no implicit exemption.

## Revision 1.1

Revision 1.1 of `aiws-limits/1` adds optional fields only
(agent binding §6 (not in this pack)). A record without them
keeps its revision 1.0 meaning, and none of them changes the lifecycle, idempotency or
human-only adjustment rules above.

| Field | Meaning |
|---|---|
| `reserve.priceTable` | `{digest, asOfMs}`: the price table version current at reservation, against which the attempt settles; `null` for a node whose cost is not applicable, which reserves zero |
| Settlement basis | `LIST_EQUIVALENT` for a login, `RATE` otherwise |
| Settlement price table digest | The digest pinned at reservation; a settled cost is never repriced |
| Settlement flags | `possibleRealSpend` and the cumulative-baseline overcharge flag |
| `Config.costUnitDisplay` | `{currency, scale}`, display only: surfaces show amounts in currency with the ledger unit beside them. The ledger still never converts currency |

Token counts get no ledger dimension.

**The coding workflow's scope tree**
(agent binding §6 (not in this pack); specified; the engine builds the RUN
scope and, for a run with an exposure allowance, one NODE scope). A
coding run builds the full
tree at creation, immutable as every scope topology here is: WORK_ORDER; RUN, which carries the
attempt and active-time bounds and the run's total cost bound; one NODE per stage node
(implementation, validation, correction), which carries that node's cost bound across all its
attempts with other bounds null and inherited; and one shared NODE scope with `nodeId`
`insertions`, which every inserted preparation node charges; its bound is declared at creation
or inherits RUN's. Scope ids stay unique within the ledger, as
above. Every correction ordinal charges the correction scope, and a successor node
assignment charges its node's scope; nothing resets. Each attempt reserves its node's whole
exposure allowance.

## Migration and limits

No old journal is silently upgraded. Existing finite-v1 and handoff-v1 APIs retain
their semantics; a host enabling nested accounting must route every relevant
admission and dispatch through this ledger. Importing already-running work or
changing scope topology requires a later explicit migration contract. This module
provides durable accounting primitives, not scheduling, external-effect cancellation,
identity-provider integration, or proof of truthful provider billing.
