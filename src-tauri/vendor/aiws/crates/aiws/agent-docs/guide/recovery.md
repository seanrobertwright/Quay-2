# Recover interrupted execution safely

Recovery restores recorded workflow state and determines the next safe action. It does not resurrect a process instruction pointer or guarantee an external action can be repeated. The default safety boundary for the proposed engine is human intervention when an outcome is uncertain.

## Identify the interrupted phase

| Last durable phase | What is known | Recovery action |
|---|---|---|
| No admission | No reserved attempt exists in this mission | Reevaluate current request and authorization |
| PREPARED | Allowance reserved, no SDK dispatch committed | Check ownership and whether any alternate executor could have acted |
| DISPATCHED or UNKNOWN | An external effect may have occurred | Preserve reservation; obtain evidence and human resolution |
| SUCCEEDED or FAILED attempt | A known settlement is committed | Do not perform that attempt again |
| Node completed | Its checked result is durable | Validate artifact availability before transferring to a consumer |
| Run terminal | Execution disposition is final | Do not reopen; use a reviewed new linked run if needed |

## Native recovery APIs

| TypeScript | Rust | Python |
|---|---|---|
| `await coordinator.recover(runId, segmentId)` returns state and unresolved IDs | `coordinator.recover(run_id, segment_id)` returns a snapshot and unresolved IDs | `coordinator.recover(run_id, segment_id)` returns state and unresolved IDs |
| `await coordinator.reconcile(attemptId, adapter)` | `coordinator.reconcile(attempt_id, adapter)` | `coordinator.reconcile(attempt_id, adapter)` |

Use a new segment ID per continuation. Recovery increments the run epoch and fences old PREPARED attempts from dispatch. It does not kill an old worker or fence arbitrary target-side effects. In particular, it does not turn an uncertain external action into confirmed nonapplication. Do not use “recover” as an automatic retry loop.

The current settlement path does not carry a complete distributed worker fencing token. If your integration has multiple independently active workers, add its own ownership and external effect controls; this SDK release is not a distributed exactly-once engine.

## Restore context from durable state

Read the contract, current plan, graph results, attempts, waits and assessment. Resolve artifact locations and verify hashes before rebuilding an agent's context. Never treat a conversational summary as the entire mission state. If a sandbox was ephemeral, detect missing files and reconstruct from durable artifacts or require intervention.

The [handoff recipe](./handoffs.md) constructs a summary from an imported audit snapshot. A production handoff must also establish artifact availability and authorized consumer ownership. The report is a useful view of state, not a command to resume effects.

## Failure handling rules

Do not report an adapter exception as confirmed failure unless you have evidence the target did not act. Do not set actual cost to zero just because the response was lost. If accounting exceeds the reservation, preserve the incident and external receipt instead of editing the database until validation passes. If an approval expired during downtime, request an appropriate new decision before further effect dispatch.

After a power outage, automatic resume policy belongs to the engine configuration. It may permit automatic, human-authorized or rule-based continuation, but no mode overrides uncertainty, current authority, stop conditions or exhausted limits. Recovery on another machine is outside the current engine scope.
