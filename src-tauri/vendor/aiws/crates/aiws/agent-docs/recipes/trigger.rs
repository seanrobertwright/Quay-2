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

