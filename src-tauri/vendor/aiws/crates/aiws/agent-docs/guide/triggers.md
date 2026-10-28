# Event ingress and duplicate handling

Triggers turn authenticated occurrences into run admission or wait satisfaction. The supported kinds are MANUAL, SCHEDULED, EVENT, RESOURCE_CHANGE, CONDITION, WORKFLOW_LIFECYCLE and EXTERNAL_RESPONSE. These identify semantics; the SDK does not provide their HTTP, filesystem, broker or provider connectors.

## Registration contract

A trigger pins its own identity/revision, source, event type, contract ID, validity, maximum event age, concurrency, rate window and causal depth. It chooses START_RUN or RESUME_WAIT. RESUME_WAIT requires a wait ID. A condition trigger also requires a filter and EDGE or LEVEL mode. A scheduled trigger must include a schedule definition.

Trigger IDs are immutable after registration. There is no updateTrigger or disableTrigger command in this release. The `enabled` field is checked on admission but does not imply a mutable settings API. Suspend the containing mission or enforce ingress restrictions when you need an existing integration to stop admitting work.

## Authenticate before admission

Validate the transport signature or user session outside the SDK. Resolve source identity from that result. Treat event data as untrusted material, including any actor, authorization flag or claimed causal depth. Equality between the event source string and trigger source string is a consistency check, not authentication.

**Preserve event identity and reject changed duplicates** (Executable control simulation). Full program: [recipes/trigger.rs](../recipes/trigger.rs)

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
    "kind": "EVENT",
    "source": "trusted",
    "eventType": "doc.changed",
    "contractId": "c",
    "action": "START_RUN",
    "enabled": true,
    "notBefore": "0",
    "expiresAt": "10000",
    "maxAgeMs": "100",
    "maxConcurrent": "2",
    "rateLimit": "10",
    "rateWindowMs": "100",
    "maxDepth": "3"
  }
}))?, "10")?;

    // Step 2
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
    "depth": "0"
  }
}))?, "10")?;

    // Step 3
    let rejected = Command::from_value(json!({
  "type": "fireTrigger",
  "triggerId": "t",
  "runId": "other",
  "event": {
    "id": "e",
    "source": "trusted",
    "type": "doc.changed",
    "occurredAt": "10",
    "data": {
      "flag": false
    },
    "depth": "0"
  }
})).and_then(|command| reduce(&state, &command, "10"));
    assert_eq!(rejected.unwrap_err().code, "EVENT_ID_CONFLICT");
    println!("PASS: trigger");
    Ok(())
}

```

The duplicate key is trigger ID, revision, source and event ID. A repeated identical event does not create a second run; changed material under the same identity is rejected. An accepted duplicate may still add a ledger event. Preserve the original event ID on transport retries and acknowledge a message only after the intended durable admission succeeds.

## Filters and condition transitions

Filters compare one top-level data field by canonical equality. They do not evaluate SQL, arbitrary code or a general expression language. EDGE mode fires on a false-to-true transition and requires a later false sample to reset. LEVEL mode can fire for each matching event, within bounds.

**Edge-triggered conditions and reset samples** (Executable control simulation). Full program: [recipes/condition.rs](../recipes/condition.rs)

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
    "kind": "CONDITION",
    "source": "trusted",
    "eventType": "doc.changed",
    "contractId": "c",
    "action": "START_RUN",
    "enabled": true,
    "notBefore": "0",
    "expiresAt": "10000",
    "maxAgeMs": "100",
    "maxConcurrent": "2",
    "rateLimit": "10",
    "rateWindowMs": "100",
    "maxDepth": "3",
    "conditionMode": "EDGE",
    "filter": {
      "field": "flag",
      "equals": true
    }
  }
}))?, "10")?;

    // Step 2
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
    "depth": "0"
  }
}))?, "10")?;

    // Step 3
    state = reduce(&state, &Command::from_value(json!({
  "type": "fireTrigger",
  "triggerId": "t",
  "runId": "ignored",
  "event": {
    "id": "e2",
    "source": "trusted",
    "type": "doc.changed",
    "occurredAt": "10",
    "data": {
      "flag": true
    },
    "depth": "0"
  }
}))?, "10")?;

    // Step 4
    state = reduce(&state, &Command::from_value(json!({
  "type": "fireTrigger",
  "triggerId": "t",
  "runId": "ignored2",
  "event": {
    "id": "e3",
    "source": "trusted",
    "type": "doc.changed",
    "occurredAt": "10",
    "data": {
      "flag": false
    },
    "depth": "0"
  }
}))?, "10")?;

    // Step 5
    state = reduce(&state, &Command::from_value(json!({
  "type": "fireTrigger",
  "triggerId": "t",
  "runId": "r2",
  "event": {
    "id": "e4",
    "source": "trusted",
    "type": "doc.changed",
    "occurredAt": "10",
    "data": {
      "flag": true
    },
    "depth": "0"
  }
}))?, "10")?;
    assert_eq!(state.as_value()["triggers"]["t"]["count"], json!("2"));
    println!("PASS: condition");
    Ok(())
}

```

Filtered occurrences are recorded as receipts. If the source omits a false sample, the engine cannot invent the reset. Persist and authenticate observations according to the source's actual delivery semantics. A rate-limit rejection may need delayed retry; do not alter occurredAt to make an old event appear current.

## Failed deliveries

Your ingress layer must distinguish transient storage/availability failure from permanent schema, source or material conflict. Persist enough failure information to diagnose a rejected message. Coordinator diagnostics are not a complete broker dead-letter service, and preflight errors do not all become SDK diagnostics. Route permanent invalid input to an operator-visible disposition rather than repeatedly retrying it without change.
