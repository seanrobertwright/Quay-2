# Deterministic clock and scheduling test protocol

Status: finalized M4 specification. This is an isolated test-controller protocol,
not an engine API or a claim that accelerated time proves months of reliability.

## Clock tuple and test operations

The controller owns `(wallMs, monotonicMs, bootId, trusted, sequence)` as canonical
unsigned decimal strings except bootId and trusted boolean. Workers cannot set time.
Initialization records one tuple. Each operation records a new sequence and its old/new
tuple in the test transcript. The coordinator reads through HC-06; no direct Date.now,
timer-library or worker-clock bypass is allowed for authority/accounting decisions.

| Operation | Input and exact behavior |
|---|---|
| ADVANCE | Nonnegative deltaMs; advance wall and monotonic equally; no implicit dispatch |
| WALL_JUMP | Absolute wallMs and trusted flag; leave monotonic unchanged; exercise forward/backward anomalies |
| REBOOT | New unique bootId, absolute wallMs; reset monotonic to zero; invalidate prior boot comparisons and worker authority |
| TRUST | Verified time-source evidence handle and wallMs; adjudicate uncertainty, never subtract charged exposure or extend a deadline |
| DRAIN | Stop advancing time; release a specified barrier order and process due control/queue work until no further eligible transition exists at this tuple |
| OBSERVE | Return committed clock/accounting/schedule state and external log watermark; no mutation or work execution |

Commands do not auto-advance time. DRAIN cannot complete external work unless the test
provider supplies an explicit outcome. Outstanding holds and waits are a valid fixed
point. A finite maxTransitions/test watchdog bounds a defective drain; exhausting it
fails the test rather than declaring a stable scheduler. The watchdog uses controller
real time, separate from fake clock. A failed controller cannot cause production time
to be trusted. The test channel uses private inherited IPC and is disabled in production.

## Time and anomaly rules

All expiry boundaries use `now >= expiresAt`. With an uninterrupted trusted boot,
monotonic deltas measure live execution and wall UTC anchors persisted deadlines.
Record a conservative time high-water mark per accounting scope. Wall time moving
backward even one millisecond cannot create allowance: clamp chargeable high-water time
and open CLOCK_UNCERTAIN for affected new dispatch. Do not rewrite immutable starts.

Initial anomaly policy compares deltaWall to deltaMonotonic within one boot. A discrepancy
over 1,000 ms between reads opens CLOCK_UNCERTAIN. This is an explicit configurable
detection threshold, not allowed deadline extension: actual trusted forward UTC always
expires crossed deadlines, even below the threshold. A forward anomaly advances due
state conservatively, then holds dispatch until trusted-source reconciliation. Backward
movement always holds regardless of tolerance. The configured time-source assurance and
threshold are owner-reviewed deployment settings; hosts unable to meet them fail closed.

After reboot, never subtract counters from different boots. Charge unfinished DISPATCHED
or UNKNOWN intervals through trusted UTC downtime; keep cost exposure and consumed attempts.
If current UTC is untrusted or below the persisted high-water mark, retain conservative
exposure and CLOCK_UNCERTAIN. Restoring time trust requires authenticated operator/provider
evidence through recovery; it is not a worker-supplied timestamp. It neither clears
UNKNOWN effects nor changes limits. Sleep/wake with stopped monotonic clocks follows
the same anomaly rule; real platform tests verify the selected clock adapter behavior.

M3 active exposure per unfinished dispatched attempt is
`max(maxActiveMs, conservativeNowMs - dispatchedAtMs)`. Sum each attempt at each ancestor;
do not compute the union of concurrent time intervals. A confirmed stop freezes measured
active time, but cost exposure remains until verified settlement. An undispatched RESERVED
attempt holds maxActiveMs; releasing it frees that reservation but not consumed attempts.
Elapsed bounds use immutable scope start and include waits, pauses and downtime.

## Independent expected vectors

| Vector | Setup and actions | Expected result |
|---|---|---|
| CT-01 equality | Lease/approval expires 1,000; observe at 999, 1,000, 1,001 | Valid only at 999; expired at equality and after |
| CT-02 parallel active | Two attempts dispatched at 100, maxActiveMs 10 each; observe 110 and 115 | Parent active exposure 20 then 30, not 10 then 15 |
| CT-03 verified stop | Same attempts; stop one at 112, observe other at 115 | Active total 12 + 15 = 27; stopped attempt's cost exposure retained |
| CT-04 downtime | Dispatch 100; reboot with trusted wall 200; observe unfinished attempt | Active exposure at least 100; fresh boot cannot reset it to zero |
| CT-05 pause/deadline | Scope start 100, elapsed limit 50; pause at 110, resume at 150 | Elapsed bound exhausted; resume and hold release cannot renew it |
| CT-06 rollback | Observe trusted 200 then WALL_JUMP 199 | High-water never decreases; CLOCK_UNCERTAIN and no new dispatch |
| CT-07 forward anomaly | Wall/monotonic 100; wall jumps to 10,000, monotonic remains 100 | Crossed deadlines expire; occurrence intent respects catch-up; anomaly holds dispatch |
| CT-08 same-time duplicates | Due timer at 100; DRAIN twice with duplicate notifications | One occurrence and one cursor advance; second drain creates no duplicate |
| CT-09 catch-up | First tick 100, interval 10, next ordinal 0, recover at 145 | Five due ticks: ordinals 0–4; next ordinal 5, next due 150 |
| CT-10 monotonic mismatch | Reboot resets monotonic 500 to 0 under a new boot | No negative duration or cross-boot lease renewal; recovery gates apply |
| CT-11 restore trust | CT-06 then TRUST at 205 with verified evidence | Clock hold may clear; independent UNKNOWN/resource/manual holds remain |
| CT-12 drift boundary | Delta wall minus delta monotonic = 1,000 then 1,001 | No discrepancy hold at threshold; hold above it; real deadline expiry applies in both |
| CT-13 observation between reading and write | Every clock read advances wall and monotonic 1 ms and is followed by a control request that observes the clock, before the reader's next storage call; run an approved attempt to acceptance | No clock-asserted write fails CLOCK_STALE; the run reaches its terminal state; high-water only rises; no CLOCK_UNCERTAIN |
| CT-14 approval window | Approval at 0 with a 3,600,000 window; implementation dispatched at 10, validation observed at 3,700,000. Second run: approval at 0, pause at 10, nothing dispatched, observe 3,600,000. Third run: approval at 0, pause at 10, resume at 3,000,000, observe 6,000,000 | Validation dispatches with no approval clock. The second run lapses at equality: AWAITING_APPROVAL with `APPROVAL_LAPSED`, nothing dispatched, the pause did not stop the window. The third run's resume opened a fresh window closing at 6,600,000, so it dispatches |

For CT-09: COALESCE_ONE creates one occurrence keyed by ordinal 4, representing ordinal
range 0–4, then advances to 5. SKIP records range 0–4 skipped, creates none and advances
to 5. BOUNDED_REPLAY with replayLimit 2 creates ordinals 0 and 1, records 2–4 skipped,
then advances to 5. Catch-up bound applies to the entire missed range evaluated at the
recovery tuple, not anew to every paging batch. One-time overdue timers always create
one readiness event, even with SKIP configured; repeating-policy fields do not discard
a one-time wait. In all cases subsequent admission separately obeys holds and capacity.

Occurrence key = installation/namespace + schedule ID + immutable schedule revision +
ordinal. A schedule change gets a new revision and explicit effective start; it cannot
reuse prior occurrence identities. A transaction records occurrence(s), skipped range
and next ordinal atomically. At large ranges, store range endpoints rather than enumerating
millions of skipped rows. BOUNDED_REPLAY uses the smaller of replayLimit and a declared
transaction batch bound; if multiple transactions are needed, persist the recovery
range and remaining total allowance so repeated batches cannot reset the cap.

Real timer/OS tests repeat representative boundaries with an external controller and
native processes. Fake time is never used for latency measurements in CAPACITY.md.
