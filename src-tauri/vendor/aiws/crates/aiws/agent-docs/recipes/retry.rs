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
  "type": "grant",
  "grant": {
    "id": "g",
    "subject": "agent",
    "profile": "finite-v1",
    "actions": [
      "write"
    ],
    "resources": [
      "doc"
    ],
    "notBefore": "0",
    "expiresAt": "10000",
    "limit": "100",
    "canDelegate": true,
    "depth": "2"
  }
}))?, "10")?;

    // Step 3
    state = reduce(&state, &Command::from_value(json!({
  "type": "admit",
  "runId": "r",
  "operationId": "o",
  "attemptId": "a",
  "grantId": "g",
  "subject": "agent",
  "action": {
    "capability": "write",
    "resource": "doc",
    "payload": {
      "value": 1
    },
    "preconditions": {
      "revision": 1
    }
  },
  "amount": "10",
  "authorizationCheckedAt": "10",
  "policy": "ALLOW",
  "mandatoryChecksOk": true
}))?, "10")?;

    // Step 4
    state = reduce(&state, &Command::from_value(json!({
  "type": "dispatch",
  "attemptId": "a",
  "authorizationCheckedAt": "10",
  "policy": "ALLOW",
  "mandatoryChecksOk": true
}))?, "10")?;

    // Step 5
    state = reduce(&state, &Command::from_value(json!({
  "type": "settle",
  "attemptId": "a",
  "effect": "CONFIRMED_NOT_APPLIED",
  "actualCost": "0"
}))?, "10")?;

    // Step 6
    state = reduce(&state, &Command::from_value(json!({
  "type": "retry",
  "operationId": "o",
  "attemptId": "a2",
  "amount": "10",
  "authorizationCheckedAt": "10",
  "policy": "ALLOW",
  "mandatoryChecksOk": true
}))?, "10")?;

    // Step 7
    state = reduce(&state, &Command::from_value(json!({
  "type": "dispatch",
  "attemptId": "a2",
  "authorizationCheckedAt": "10",
  "policy": "ALLOW",
  "mandatoryChecksOk": true
}))?, "10")?;

    // Step 8
    state = reduce(&state, &Command::from_value(json!({
  "type": "settle",
  "attemptId": "a",
  "effect": "CONFIRMED_NOT_APPLIED",
  "actualCost": "0"
}))?, "10")?;

    // Step 9
    state = reduce(&state, &Command::from_value(json!({
  "type": "settle",
  "attemptId": "a2",
  "effect": "CONFIRMED_APPLIED",
  "actualCost": "2"
}))?, "10")?;
    assert_eq!(state.as_value()["spent"], json!("2"));
    assert_eq!(state.as_value()["reserved"], json!("0"));
    println!("PASS: retry");
    Ok(())
}

