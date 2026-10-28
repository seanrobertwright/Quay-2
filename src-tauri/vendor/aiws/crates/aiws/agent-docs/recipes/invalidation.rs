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
  "type": "verify",
  "runId": "r",
  "assessor": "reviewer",
  "revision": "v1",
  "results": {
    "review": "PASS"
  },
  "evidence": [
    "sha256:evidence"
  ],
  "rationale": "Review performed"
}))?, "10")?;

    // Step 3
    state = reduce(&state, &Command::from_value(json!({
  "type": "accept",
  "runId": "r",
  "authority": "owner",
  "verificationRevision": "v1",
  "decision": "ACCEPTED",
  "rationale": "Accepted deliverable"
}))?, "10")?;

    // Step 4
    state = reduce(&state, &Command::from_value(json!({
  "type": "invalidate",
  "runId": "r",
  "reason": "Evidence changed"
}))?, "10")?;
    assert_eq!(state.as_value()["assessments"]["r"]["acceptance"], json!("INVALIDATED"));
    println!("PASS: invalidation");
    Ok(())
}

