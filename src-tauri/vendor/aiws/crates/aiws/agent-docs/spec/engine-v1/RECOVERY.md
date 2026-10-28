# Failure boundaries and recovery — M4 specification

Status: specified acceptance behavior, **not executed fault-injection evidence**.
All rows preserve WO-01–WO-08 and M1–M3 accounting. Default unexpected-shutdown
resume requires human confirmation; automatic/rule modes never bypass UNKNOWN,
expired authority, missing artifacts, active holds or exhausted limits.

| Boundary | Last authoritative fact | Required recovery |
|---|---|---|
| Crash before admission commit | No committed attempt/reservation/dispatch | A missing result alone proves nothing about concurrent commit; retry identical key/material through serialized admission and current policy |
| Commit succeeds, HTTP response lost | Recorded command result and RESERVED attempt | Return exact deduplicated result; do not create another attempt |
| Worker dies during preparation | RESERVED, no dispatch authorization committed | Fence ownership; verify no dispatch authorization exists, then safely requeue/release preparation |
| Crash during final dispatch transaction | Either complete dispatch commit or none | Inspect committed request/attempt records; never infer from the caller's missing response |
| Dispatch committed before worker receives message | DISPATCH_AUTHORIZED and full exposure | Reconcile responsibility; no blind refund/retry based on absent acknowledgement |
| External request accepted, response lost | Authorized attempt; outcome unproven | UNKNOWN hold, retain cost/time/capacity and route provider evidence to a human |
| Worker heartbeat expires during external work | Liveness unknown; effect may still run | Fence new state changes; retain exposure and attempt slot until verified stop/outcome |
| Stale worker returns a real result | Evidence exists but ownership is obsolete | Preserve evidence for reconciliation; do not accept stale completion or discard possible cost |
| Stop requested, no acknowledgement | Request receipt only | Continue accounting; OBSERVE_TO_COMPLETION where stop is unsupported |
| Verified stop, billing still unknown | Execution ceased, cost unresolved | Freeze active time, retain cost exposure and reconciliation ownership |
| Artifact staged, completion not committed | No announced reference | Verify whether a later commit references bytes; reclaim only safely unreferenced material |
| Artifact published, completion transaction fails | Durable bytes; node not completed | Retry atomic completion with same material basis; do not dispatch the producer again |
| Completion commits, event notification lost | Settlement/handoff/delivery intent persisted | Redeliver notification; downstream deduplicates; no repeat producer effect |
| Consumer claim/acknowledgement response lost | Durable per-consumer delivery state | Return/replay recorded receipt; acknowledgement never authorizes duplicate execution |
| Due timer found, occurrence transaction fails | Old schedule cursor; no committed occurrence | Retry using unique occurrence key; no double schedule advancement |
| Restart after many recurring ticks | Persisted schedule policy and last cursor | Default coalesces to one; skip/bounded replay follow exact recorded policy |
| Clock rollback/boot change | Prior persisted time basis | CLOCK_UNCERTAIN hold; never compare boot-relative counters or grant extra lifetime |
| Credentials expire during pause | Workflow/history intact; access expired | CREDENTIAL_REQUIRED; refresh/reconnect, then recheck every dispatch gate |
| Policy or approval changes during preparation | New current policy/material basis | Reject stale dispatch decision and obtain required human approval |
| Storage full/unavailable before dispatch commit | Commit unconfirmed | Stop new dispatch; recover by durable command lookup, never proceed optimistically |
| Parent paused or budget exhausted mid-work | Durable scope gate, effects still live | Block descendants/dependents as applicable; request task-aware stop, preserve exposure |
| Cancel requested with UNKNOWN effect | New dispatch blocked, cancellation pending | Keep reconciliation owner; CANCELED closure waits for safe settlement |
| Backup restored from before a known external effect | Local records may lag real effects | Hold dispatch until the possible lost interval is reconciled; backup is not external rollback |
| Cleanup encounters a live parent reference | Child closed, artifact still needed | Retain artifact/history regardless of age |

## Recovery owner and interface contract

Each unresolved material effect has a durable responsible owner or escalation queue,
affected scope, evidence references, blockers and allowed next decisions. Human
options include remain held, reconcile verified evidence, safely cancel, narrow/replan
within existing authority or approve a specific resource/permission change. A text
summary never clears a blocker. Record who resolved which blocker and the exact basis.

Releasing a hold changes eligibility, not execution by itself. Recheck independent
holds, handoff inputs, ownership, acceptance basis, time/cost/attempt bounds and current
authority. A terminal run cannot be reopened; linked fresh work preserves cumulative
accounting and prior effects. A stopped task may need a new attempt rather than reuse
of an already-terminal attempt; neither path resets consumed allowance.

## Verification plan

Inject process termination before/after each transaction boundary, notification loss,
duplicate requests, stale worker messages, provider timeout, missing artifacts, revoked
credentials, clock movement and storage failure. Assert database state and external
effect evidence independently. Use a fake clock for deterministic scenarios and real
subprocess/database tests for actual crash boundaries. Report which tests are real,
simulated, specified-only and platform-specific. Months-long reliability and PostgreSQL
support require their own measured evidence; this matrix alone proves neither.

The finalized harness and failpoint catalog are in [CONFORMANCE.md](./CONFORMANCE.md)
and conformance-plan.json (not in this pack). The clock/occurrence oracle is in
[FAKE-CLOCK.md](./FAKE-CLOCK.md). All engine behavior remains specified-only until those
checks execute against the implementation.
