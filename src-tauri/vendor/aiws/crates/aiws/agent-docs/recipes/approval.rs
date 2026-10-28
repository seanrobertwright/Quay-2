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
  "requiresApproval": true,
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
  "type": "approve",
  "approval": {
    "id": "ap",
    "runId": "r",
    "approver": "owner",
    "fingerprint": "sha256:50487a924d1b8f40e5051f0f8d278469acb1cd15d08dbef8f1010e7f54ae9ef0",
    "expiresAt": "1000",
    "uses": "1"
  }
}))?, "10")?;

    // Step 4
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
  "mandatoryChecksOk": true,
  "approvalId": "ap"
}))?, "10")?;

    // Step 5
    let rejected = Command::from_value(json!({
  "type": "admit",
  "runId": "r",
  "operationId": "o2",
  "attemptId": "a2",
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
  "mandatoryChecksOk": true,
  "approvalId": "ap"
})).and_then(|command| reduce(&state, &command, "10"));
    assert_eq!(rejected.unwrap_err().code, "APPROVAL_CONSUMED");

    // Step 6
    state = reduce(&state, &Command::from_value(json!({
  "type": "withdrawApproval",
  "approvalId": "ap"
}))?, "10")?;

    // Step 7
    let rejected = Command::from_value(json!({
  "type": "dispatch",
  "attemptId": "a",
  "authorizationCheckedAt": "10",
  "policy": "ALLOW",
  "mandatoryChecksOk": true
})).and_then(|command| reduce(&state, &command, "10"));
    assert_eq!(rejected.unwrap_err().code, "APPROVAL_INVALID");
    println!("PASS: approval");
    Ok(())
}

