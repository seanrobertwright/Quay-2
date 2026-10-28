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

