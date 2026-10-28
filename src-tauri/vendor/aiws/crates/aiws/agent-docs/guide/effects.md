# Effects, operation identities and retries

An operation is one intended external change. An attempt is one authorized effort to perform it. Keeping those identities separate lets the application retry safely without pretending that a second attempt represents a different business action.

An interactive [operation effect lifecycle](./diagrams.md#operation-effect-lifecycle) diagram shows every effect state, UNKNOWN reconciliation and epoch fencing.

## Adapter responsibilities

Implement `execute(operation, attempt)` and `reconcile(operation, attempt)`. Execution may change the external world; reconciliation must discover external truth without repeating that change. Both return an effect disposition and decimal-string actual cost. Exceptions during execution become UNKNOWN in the coordinator. They do not prove that nothing happened.

Use a stable operation ID as the basis for an external idempotency key where the target supports it. Include material/precondition checks so that changed requests cannot reuse a key silently. A target's idempotency retention period is an integration contract; the SDK cannot discover it for you. If no safe target deduplication or reliable readback exists, do not retry an uncertain effect.

| Disposition | Meaning | Permitted next step |
|---|---|---|
| NOT_DISPATCHED | No dispatch has been committed for this operation | Current prepared owner may dispatch after checks |
| UNKNOWN | Dispatch occurred or its outcome cannot be established | Human-controlled reconciliation; retain reservation |
| CONFIRMED_NOT_APPLIED | The intended effect is known not to have occurred | Checked retry if authority and limits still permit |
| CONFIRMED_APPLIED | Intended effect is known to have occurred | Record dependent work; do not replay as a retry |

## Retry a known failure

**Retry confirmed nonapplication and handle duplicate results** (Executable control simulation). Full program: [recipes/retry.rs](../recipes/retry.rs)

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

```

The example also checks a late duplicate settlement. An identical result is accepted without charging again, while inconsistent results are rejected. Accepted duplicates still produce a new control event; semantic idempotence does not mean the event count stays unchanged.

The retry must reuse the operation identity but have a fresh attempt identity. `maxAttempts` includes the initial attempt. Every attempt reserves exposure; prior recorded costs remain spent. Retrying never renews an expired grant, approval or contract deadline.

## Lost-response procedure

Keep the task under human review when the external outcome is uncertain. Read target-side receipts, repository state or provider request status using the original identity. If evidence proves the action applied, settle that attempt with its actual cost. If evidence proves nonapplication, settle accordingly before requesting a retry. If evidence remains ambiguous, keep UNKNOWN. Human intervention must record evidence and a decision; it must not fabricate certainty.

## Compensation

A compensating action is a new governed operation with its own cost, permission and outcome. It references an earlier applied operation but does not delete history or claim that the original action never happened. Some changes are not reversible. Verify the resulting state of the target rather than assuming successful compensation restored every property.

**Record reconciliation and a separate compensating effect** (Executable control simulation). Full program: [recipes/compensation.rs](../recipes/compensation.rs)

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

```

The example exercises current checkpoint semantics. It is not an automatic rollback manager. Your application chooses and authorizes a compensating adapter and must handle uncertainty or failure in that operation too.
