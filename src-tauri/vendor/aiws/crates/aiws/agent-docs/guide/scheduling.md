# Schedules, waits and time

The implemented scheduler is a fixed UTC interval calculator with a durable trigger cursor. It is not a cron parser, operating-system service or daemon. A hosting application periodically calls tickTrigger through its trusted coordinator.

## Fixed intervals today

The schedule fields are startMs, intervalMs, catchUp and maxCatchUp. Time is a canonical UTC epoch-millisecond string. Catch-up is SKIP, LATEST or ALL. ALL processes at most the configured batch. The tick commits its nextSlot cursor with admitted run receipts, so rollback does not lose occurrences.

**Advance a scheduled trigger cursor atomically** (Executable control simulation). Full program: [recipes/schedule.rs](../recipes/schedule.rs)

```rust
use aiws_sdk::*;
use serde_json::json;

fn main() -> Result<()> {
    // Trusted simulation: no external calls.
    let contract = Contract::parse(&json!({
  "id": "c",
  "missionId": "m",
  "aiwsEdition": "0.4",
  "profile": "finite-v1",
  "budget": "100",
  "deadline": "10000",
  "criteria": [
    "review"
  ],
  "actions": [
    "write"
  ],
  "resources": [
    "doc"
  ],
  "requiresApproval": false,
  "maxAttempts": "2",
  "maxAuthorizationAgeMs": "10",
  "features": [
    "triggers",
    "graphs"
  ]
}).to_string())?;
    let mut state = create_mission(&contract)?;

    // Step 1
    state = reduce(&state, &Command::from_value(json!({
  "type": "registerTrigger",
  "trigger": {
    "id": "t",
    "revision": "1",
    "kind": "SCHEDULED",
    "source": "trusted",
    "eventType": "doc.changed",
    "contractId": "c",
    "action": "START_RUN",
    "enabled": true,
    "notBefore": "0",
    "expiresAt": "10000",
    "maxAgeMs": "100",
    "maxConcurrent": "10",
    "rateLimit": "10",
    "rateWindowMs": "100",
    "maxDepth": "3",
    "schedule": {
      "startMs": "0",
      "intervalMs": "10",
      "catchUp": "ALL",
      "maxCatchUp": "2"
    }
  }
}))?, "10")?;

    // Step 2
    state = reduce(&state, &Command::from_value(json!({
  "type": "tickTrigger",
  "triggerId": "t"
}))?, "10")?;

    // Step 3
    state = reduce(&state, &Command::from_value(json!({
  "type": "tickTrigger",
  "triggerId": "t"
}))?, "10")?;
    assert_eq!(state.as_value()["triggers"]["t"]["count"], json!("2"));
    assert_eq!(state.as_value()["triggers"]["t"]["nextSlot"], json!("2"));
    println!("PASS: schedule");
    Ok(())
}

```

SKIP has precise behavior: it only emits the latest slot when evaluated exactly at that slot's timestamp; a late tick skips it. If a real polling service is normally late, choose LATEST or a deliberately bounded ALL policy. Do not describe SKIP as a lateness-tolerant cron scheduler. Retain original occurrence time when delivering late events; maxAgeMs can reject stale slots.

A batch may fail entirely because an occurrence exceeds age, concurrency or rate bounds. Repeating the same invalid tick will not make progress. Align the catch-up batch with configured admission limits, or intervene with an approved replacement trigger policy. New trigger identity means a new deduplication namespace; account for previously executed effects before changing it.

## Time model for the proposed engine

The agreed design distinguishes calendar deadlines, total work-order lifetime, aggregate task execution time, approval expiry, retry delays and schedule occurrences. Calendar deadlines, lifetime and authorization expiry advance during pause or outage. Active execution accounting excludes confirmed stopped intervals; it never assumes an unreachable remote task stopped spending resources. Retries retain previous cost and attempt counts.

A retry delay may elapse during an outage, but eligibility does not override pause, authority or limits. Clock corrections must not make recorded resource use negative. Use a monotonic clock for durations within one process and durable wall-clock instants for external deadlines; reconcile uncertain intervals after restart instead of recreating a monotonic timestamp from another process.

## Calendar schedules planned for the engine

Recommended defaults are an explicit time zone, no overlapping execution for a schedule, and skipping missed occurrences unless catch-up was configured. Calendar schedules also require explicit treatment of missing or repeated daylight-saving times, maximum lateness, catch-up count and age. These remain engine requirements; passing a cron expression to intervalMs is invalid.

Kubernetes documents distinct schedule suspension and already-running job behavior, plus missed-start deadlines and overlap policies. We use those distinctions as design inputs without adopting Kubernetes as the engine. [Primary reference](https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/).

For durable human waits and callbacks continue to [waits and approvals](./waits.md).
