# Graph construction and node semantics

A graph declares node dependencies and completion obligations. Registration validates its shape; attachment binds one graph to a READY run before any operations begin. The library exposes ready nodes and checks completion proofs, but the application supplies a scheduler and task implementations.

## Structure and readiness

A valid graph has unique node IDs, existing dependencies, no graph cycles, at least one END and an END path for every node. Use bounded LOOP nodes for repetition. Node configuration is closed by kind: extra configuration keys are rejected. An executionKind label does not create an LLM, human inbox, function registry or sandbox.

**Bind execution to a ready graph node** (Executable control simulation). Full program: [recipes/graph.rs](../recipes/graph.rs)

```rust
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
    let rejected = Command::from_value(json!({
  "type": "dispatch",
  "attemptId": "a",
  "authorizationCheckedAt": "10",
  "policy": "ALLOW",
  "mandatoryChecksOk": true
})).and_then(|command| reduce(&state, &command, "10"));
    assert_eq!(rejected.unwrap_err().code, "NODE_NOT_READY");

    // Step 7
    state = reduce(&state, &Command::from_value(json!({
  "type": "dispatch",
  "attemptId": "a",
  "authorizationCheckedAt": "10",
  "policy": "ALLOW",
  "mandatoryChecksOk": true,
  "nodeId": "task"
}))?, "10")?;

    // Step 8
    state = reduce(&state, &Command::from_value(json!({
  "type": "settle",
  "attemptId": "a",
  "effect": "CONFIRMED_APPLIED",
  "actualCost": "3"
}))?, "10")?;

    // Step 9
    state = reduce(&state, &Command::from_value(json!({
  "type": "completeNode",
  "runId": "r",
  "nodeId": "task",
  "result": {
    "operationId": "o"
  }
}))?, "10")?;

    // Step 10
    state = reduce(&state, &Command::from_value(json!({
  "type": "completeNode",
  "runId": "r",
  "nodeId": "end",
  "result": {
    "disposition": "COMPLETED"
  }
}))?, "10")?;

    // Step 11
    state = reduce(&state, &Command::from_value(json!({
  "type": "transition",
  "runId": "r",
  "to": "COMPLETED"
}))?, "10")?;
    println!("PASS: graph");
    Ok(())
}

```

A graph-bound dispatch names a ready TASK, LOOP or COMPENSATION node. The SDK checks dependencies and binds the operation to that node before execution. Completing a TASK requires a same-run, same-node operation with a confirmed applied effect. Writing a result object with a convenient string is not enough to bypass that check.

## Node catalog

| Kind | Configuration | Required completion result or condition |
|---|---|---|
| TASK | executionKind: AGENT, FUNCTION, TOOL or HUMAN | operationId of a confirmed applied operation bound to this node |
| DECISION | field, equals, then, else | data containing the field; SDK chooses one successor |
| FORK | empty object | Explicit checkpoint; downstream dependencies become eligible |
| JOIN | mode: ALL or ANY | Appropriate completed predecessors; ANY cannot discard an active operation |
| LOOP | maxIterations | Distinct applied operationId and boolean done |
| WAIT | empty object | waitId of a satisfied same-run wait |
| APPROVAL | empty object | approvalId for a current same-run approval |
| SUBWORKFLOW | empty object | childRunId with verified successful acceptance |
| VERIFICATION | empty object | Current passed assessment revision |
| ACCEPTANCE | empty object | Current accepted assessment revision |
| RECONCILIATION | empty object | operationId whose effect is known |
| COMPENSATION | empty object | Applied operationId and distinct applied originalOperationId |
| END | empty object | disposition: COMPLETED |

An APPROVAL node is a checkpoint, not proof that the next action matches its fingerprint; dispatch still performs material checks. END completion does not itself complete the run. The separate run transition verifies outstanding nodes, attempts and waits. Verification and acceptance can be recorded before an END node when those checkpoints appear inside the graph; the final success predicate still requires terminal execution.

## Input and output contracts

Use inputSchema for operation payloads before dispatch and outputSchema for completeNode results. Both must be within the SDK's JSON Schema subset. For TASK results, an output schema must permit the required operationId field. Validate actual artifact content in your adapter or assessor; a URI-shaped string is not proof that an artifact exists.

**Validate task input before dispatch** (Executable control simulation). Full program: [recipes/node-schema.rs](../recipes/node-schema.rs)

```rust
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
        },
        "inputSchema": {
          "type": "object",
          "required": [
            "requiredField"
          ]
        }
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
    let rejected = Command::from_value(json!({
  "type": "dispatch",
  "attemptId": "a",
  "authorizationCheckedAt": "10",
  "policy": "ALLOW",
  "mandatoryChecksOk": true,
  "nodeId": "task"
})).and_then(|command| reduce(&state, &command, "10"));
    assert_eq!(rejected.unwrap_err().code, "DATA_SCHEMA");
    println!("PASS: node-schema");
    Ok(())
}

```

For branches, loops and child workflows continue to [control flow](./control-flow.md). For transfer of artifacts and authority between steps read [handoffs](./handoffs.md).
