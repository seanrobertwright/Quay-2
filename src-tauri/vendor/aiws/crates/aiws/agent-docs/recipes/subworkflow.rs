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
  "type": "registerGraph",
  "graph": {
    "id": "graph",
    "revision": "1",
    "nodes": [
      {
        "id": "task",
        "kind": "SUBWORKFLOW",
        "dependsOn": [],
        "config": {}
      },
      {
        "id": "end",
        "kind": "END",
        "dependsOn": [
          "task"
        ],
        "config": {}
      }
    ]
  }
}))?, "10")?;

    // Step 3
    state = reduce(&state, &Command::from_value(json!({
  "type": "attachGraph",
  "runId": "r",
  "graphId": "graph"
}))?, "10")?;

    // Step 4
    state = reduce(&state, &Command::from_value(json!({
  "type": "startRun",
  "runId": "child"
}))?, "10")?;

    // Step 5
    let rejected = Command::from_value(json!({
  "type": "completeNode",
  "runId": "r",
  "nodeId": "task",
  "result": {
    "childRunId": "child"
  }
})).and_then(|command| reduce(&state, &command, "10"));
    assert_eq!(rejected.unwrap_err().code, "CHILD_NOT_ACCEPTED");

    // Step 6
    state = reduce(&state, &Command::from_value(json!({
  "type": "transition",
  "runId": "child",
  "to": "COMPLETED"
}))?, "10")?;

    // Step 7
    state = reduce(&state, &Command::from_value(json!({
  "type": "verify",
  "runId": "child",
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

    // Step 8
    state = reduce(&state, &Command::from_value(json!({
  "type": "accept",
  "runId": "child",
  "authority": "owner",
  "verificationRevision": "v1",
  "decision": "ACCEPTED",
  "rationale": "Accepted deliverable"
}))?, "10")?;

    // Step 9
    state = reduce(&state, &Command::from_value(json!({
  "type": "completeNode",
  "runId": "r",
  "nodeId": "task",
  "result": {
    "childRunId": "child"
  }
}))?, "10")?;
    println!("PASS: subworkflow");
    Ok(())
}

