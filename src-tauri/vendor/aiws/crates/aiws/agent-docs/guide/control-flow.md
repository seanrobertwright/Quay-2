# Branches, loops and child workflows

The graph is a dependency structure. The application chooses when to execute eligible nodes; it cannot manufacture completion of dependencies to reach a desired branch. Independent ready nodes may be scheduled concurrently, but they still share mission and grant allowances.

## Decisions and joins

A DECISION compares one field using canonical JSON equality, with two declared successor IDs. Both successors must depend on the decision. The unselected successor becomes SKIPPED, and downstream unreachable nodes are skipped according to dependency rules.

**Choose a branch and complete an ANY join** (Executable control simulation). Full program: [recipes/branching.rs](../recipes/branching.rs)

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

```

An ALL join requires all predecessors completed. An ANY join accepts a completed predecessor but refuses to abandon an active operation on another direct predecessor. It is not a general cancellation or first-result-wins implementation for arbitrary external tasks. Plan explicit cancellation and reconciliation before abandoning work that may have affected an external system.

## Bounded repetition

**Bound loop iterations and preserve the terminal outcome** (Executable control simulation). Full program: [recipes/loop.rs](../recipes/loop.rs)

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
        "kind": "LOOP",
        "dependsOn": [],
        "config": {
          "maxIterations": "1"
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
    "operationId": "o",
    "done": false
  }
}))?, "10")?;
    assert_eq!(state.as_value()["runs"]["r"]["state"], json!("FAILED"));
    assert_eq!(state.as_value()["runs"]["r"]["nodes"]["task"]["iterations"], json!("1"));
    println!("PASS: loop");
    Ok(())
}

```

Every successful loop iteration has a distinct operation and increments the iteration counter. `done: false` at the configured bound marks the node and run FAILED. This is a terminal outcome in the finite-v1 profile, whichever SDK version implements it; it is not the proposed engine's resumable “limit reached” hold. Do not document a PAUSED state for this existing behavior or try to reopen the failed run. Design the engine's intervention model separately, with a reviewed compatibility change.

A corrective loop must preserve the original acceptance criteria unless an authorized plan change replaces them. Re-running easier tests to obtain PASS is not corrective action. Separate infrastructure retries of a single operation from new corrective iterations that change the material work.

## Accepted child work

**Require accepted child work** (Executable control simulation). Full program: [recipes/subworkflow.rs](../recipes/subworkflow.rs)

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

```

The example uses another run in the same mission and checks its final assessment before completing the SUBWORKFLOW node. The SDK does not launch the child automatically, maintain a cross-database parent/child dispatcher, or implement global multi-mission budgets. Model child ownership and artifact lineage explicitly in the application.

## Dynamic changes

`activatePlan` updates the recorded plan identity with compare-and-swap protection. It does not replace the graph, change the contract, move already-completed nodes or grant permission to alter running work. The SDK does not support arbitrary graph mutation. The [engine design](./engine-design.md) considers bounded task addition and approved plan revision as separate capabilities.
