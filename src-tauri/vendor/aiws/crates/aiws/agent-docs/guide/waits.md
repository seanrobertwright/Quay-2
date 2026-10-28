# Human waits and external callbacks

A wait records what a run is waiting for, a correlation token, deadline and kind. It is durable state, not a sleeping thread. INPUT, AUTHORIZATION, EXTERNAL, TIMER and RECONCILIATION describe the wait's purpose. The host remains responsible for asking the human, receiving the callback or evaluating a timer.

## Create, satisfy and join

**Correlated waits and an ALL join** (Executable control simulation). Full program: [recipes/waits.rs](../recipes/waits.rs)

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
  "type": "startRun",
  "runId": "r"
}))?, "10")?;

    // Step 2
    state = reduce(&state, &Command::from_value(json!({
  "type": "wait",
  "runId": "r",
  "waitId": "w",
  "correlation": "corr",
  "deadline": "100",
  "kind": "INPUT"
}))?, "10")?;

    // Step 3
    state = reduce(&state, &Command::from_value(json!({
  "type": "transition",
  "runId": "r",
  "to": "WAITING"
}))?, "10")?;

    // Step 4
    let rejected = Command::from_value(json!({
  "type": "resume",
  "waitId": "w",
  "correlation": "wrong"
})).and_then(|command| reduce(&state, &command, "10"));
    assert_eq!(rejected.unwrap_err().code, "CORRELATION_MISMATCH");

    // Step 5
    state = reduce(&state, &Command::from_value(json!({
  "type": "resume",
  "waitId": "w",
  "correlation": "corr"
}))?, "10")?;

    // Step 6
    state = reduce(&state, &Command::from_value(json!({
  "type": "join",
  "runId": "r",
  "waitIds": [
    "w"
  ],
  "mode": "ALL"
}))?, "10")?;
    assert_eq!(state.as_value()["runs"]["r"]["state"], json!("READY"));
    println!("PASS: waits");
    Ok(())
}

```

Creating a wait does not automatically transition the run to WAITING. The transition requires at least one pending wait and no unsettled attempts. `resume` satisfies a wait with the matching token; `join` moves a WAITING run to READY when the required waits are satisfied. ANY cancels unselected pending waits. These operations do not automatically dispatch subsequent work.

Correlation tokens should be opaque and scoped to the intended decision. Do not expose them as proof of identity. Authenticate the callback principal, check its mission/wait association and verify that its content is appropriate before allowing satisfaction. A replayed or late callback must not apply to a new wait with unrelated material.

## Correlated external-response trigger

**Satisfy one wait with a correlated event** (Executable control simulation). Full program: [recipes/external-response.rs](../recipes/external-response.rs)

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
  "type": "startRun",
  "runId": "r"
}))?, "10")?;

    // Step 2
    state = reduce(&state, &Command::from_value(json!({
  "type": "wait",
  "runId": "r",
  "waitId": "w",
  "correlation": "corr",
  "deadline": "100",
  "kind": "INPUT"
}))?, "10")?;

    // Step 3
    state = reduce(&state, &Command::from_value(json!({
  "type": "registerTrigger",
  "trigger": {
    "id": "t",
    "revision": "1",
    "kind": "EXTERNAL_RESPONSE",
    "source": "trusted",
    "eventType": "doc.changed",
    "contractId": "c",
    "action": "RESUME_WAIT",
    "enabled": true,
    "notBefore": "0",
    "expiresAt": "10000",
    "maxAgeMs": "100",
    "maxConcurrent": "2",
    "rateLimit": "10",
    "rateWindowMs": "100",
    "maxDepth": "3",
    "waitId": "w"
  }
}))?, "10")?;

    // Step 4
    let rejected = Command::from_value(json!({
  "type": "fireTrigger",
  "triggerId": "t",
  "runId": "r",
  "event": {
    "id": "e",
    "source": "trusted",
    "type": "doc.changed",
    "occurredAt": "10",
    "data": {
      "flag": true
    },
    "depth": "0"
  }
})).and_then(|command| reduce(&state, &command, "10"));
    assert_eq!(rejected.unwrap_err().code, "WAIT_CORRELATION");

    // Step 5
    state = reduce(&state, &Command::from_value(json!({
  "type": "fireTrigger",
  "triggerId": "t",
  "runId": "r",
  "event": {
    "id": "e",
    "source": "trusted",
    "type": "doc.changed",
    "occurredAt": "10",
    "data": {
      "flag": true
    },
    "depth": "0",
    "correlation": "corr"
  }
}))?, "10")?;
    assert_eq!(state.as_value()["waits"]["w"]["status"], json!("SATISFIED"));
    println!("PASS: external-response");
    Ok(())
}

```

The trigger must target the same run and a pending, unexpired wait, and the event must carry the matching correlation. Generic resume and trigger-based resume have distinct duplicate paths; application tests should exercise the API actually used by the integration.

## Human decisions

An AUTHORIZATION wait and an action Approval are different records. Satisfying the wait tells the application a response arrived. It does not create the material-bound approval used at effect dispatch. The application must authenticate, interpret and record that approval separately. Similarly, satisfying a verification wait does not itself establish PASS.

If a decision arrives after deadline or after material changes, preserve the receipt in the application audit trail and request an appropriate new decision. Do not bypass WAIT_EXPIRED by rewriting historical timestamps. If the human rejects a plan, use the workflow's authorized rejection/disposition path instead of pretending approval was never requested.

## Pause and wake-up

The SDK can record run PAUSED or mission SUSPENDED states. It cannot freeze an external process, stop provider billing or revoke an already-submitted request automatically. Engine-level pausing will distinguish preventing new work, requesting a checkpoint, and confirmed stopped work. Wake-up and automatic restart policies remain host/engine responsibilities.
