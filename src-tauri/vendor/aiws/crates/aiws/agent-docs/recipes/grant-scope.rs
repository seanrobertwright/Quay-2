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

    // Step 2
    let rejected = Command::from_value(json!({
  "type": "grant",
  "grant": {
    "id": "child",
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
    "depth": "2",
    "parentId": "g"
  }
})).and_then(|command| reduce(&state, &command, "10"));
    assert_eq!(rejected.unwrap_err().code, "AUTHORITY_DENIED");
    println!("PASS: grant-scope");
    Ok(())
}

