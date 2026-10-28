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

