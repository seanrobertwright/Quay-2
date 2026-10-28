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
        "kind": "TASK",
        "dependsOn": [],
        "config": {
          "executionKind": "FUNCTION"
        }
      },
      {
        "id": "reconcile",
        "kind": "RECONCILIATION",
        "dependsOn": [
          "task"
        ],
        "config": {}
      },
      {
        "id": "undo",
        "kind": "COMPENSATION",
        "dependsOn": [
          "reconcile"
        ],
        "config": {}
      },
      {
        "id": "end",
        "kind": "END",
        "dependsOn": [
          "undo"
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

    // Step 5
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

    // Step 6
    state = reduce(&state, &Command::from_value(json!({
  "type": "dispatch",
  "attemptId": "a",
  "authorizationCheckedAt": "10",
  "policy": "ALLOW",
  "mandatoryChecksOk": true,
  "nodeId": "task"
}))?, "10")?;

    // Step 7
    state = reduce(&state, &Command::from_value(json!({
  "type": "settle",
  "attemptId": "a",
  "effect": "CONFIRMED_APPLIED",
  "actualCost": "3"
}))?, "10")?;

    // Step 8
    state = reduce(&state, &Command::from_value(json!({
  "type": "completeNode",
  "runId": "r",
  "nodeId": "task",
  "result": {
    "operationId": "o"
  }
}))?, "10")?;

    // Step 9
    state = reduce(&state, &Command::from_value(json!({
  "type": "completeNode",
  "runId": "r",
  "nodeId": "reconcile",
  "result": {
    "operationId": "o"
  }
}))?, "10")?;

    // Step 10
    state = reduce(&state, &Command::from_value(json!({
  "type": "admit",
  "runId": "r",
  "operationId": "undo",
  "attemptId": "au",
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

    // Step 11
    state = reduce(&state, &Command::from_value(json!({
  "type": "dispatch",
  "attemptId": "au",
  "authorizationCheckedAt": "10",
  "policy": "ALLOW",
  "mandatoryChecksOk": true,
  "nodeId": "undo"
}))?, "10")?;

    // Step 12
    state = reduce(&state, &Command::from_value(json!({
  "type": "settle",
  "attemptId": "au",
  "effect": "CONFIRMED_APPLIED",
  "actualCost": "2"
}))?, "10")?;

    // Step 13
    state = reduce(&state, &Command::from_value(json!({
  "type": "completeNode",
  "runId": "r",
  "nodeId": "undo",
  "result": {
    "operationId": "undo",
    "originalOperationId": "o"
  }
}))?, "10")?;
    println!("PASS: compensation");
    Ok(())
}

