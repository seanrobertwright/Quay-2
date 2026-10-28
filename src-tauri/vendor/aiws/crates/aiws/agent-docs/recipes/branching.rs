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
        "id": "d",
        "kind": "DECISION",
        "dependsOn": [],
        "config": {
          "field": "ok",
          "equals": true,
          "then": "yes",
          "else": "no"
        }
      },
      {
        "id": "yes",
        "kind": "FORK",
        "dependsOn": [
          "d"
        ],
        "config": {}
      },
      {
        "id": "no",
        "kind": "FORK",
        "dependsOn": [
          "d"
        ],
        "config": {}
      },
      {
        "id": "j",
        "kind": "JOIN",
        "dependsOn": [
          "yes",
          "no"
        ],
        "config": {
          "mode": "ANY"
        }
      },
      {
        "id": "end",
        "kind": "END",
        "dependsOn": [
          "j"
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
  "type": "completeNode",
  "runId": "r",
  "nodeId": "d",
  "result": {
    "data": {
      "ok": true
    }
  }
}))?, "10")?;

    // Step 5
    let rejected = Command::from_value(json!({
  "type": "completeNode",
  "runId": "r",
  "nodeId": "no",
  "result": {}
})).and_then(|command| reduce(&state, &command, "10"));
    assert_eq!(rejected.unwrap_err().code, "NODE_NOT_READY");

    // Step 6
    state = reduce(&state, &Command::from_value(json!({
  "type": "completeNode",
  "runId": "r",
  "nodeId": "yes",
  "result": {}
}))?, "10")?;

    // Step 7
    state = reduce(&state, &Command::from_value(json!({
  "type": "completeNode",
  "runId": "r",
  "nodeId": "j",
  "result": {}
}))?, "10")?;

    // Step 8
    state = reduce(&state, &Command::from_value(json!({
  "type": "completeNode",
  "runId": "r",
  "nodeId": "end",
  "result": {
    "disposition": "COMPLETED"
  }
}))?, "10")?;
    println!("PASS: branching");
    Ok(())
}

