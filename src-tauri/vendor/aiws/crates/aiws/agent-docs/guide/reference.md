# Records, commands and strict input

The shared schema is JSON Schema Draft 2020-12 in spec/schema.json. Its closed records are the cross-language wire contract. The [generated wire reference](./wire-reference.md) lists every record, command and field. The [API reference](./api-reference.md) maps the native entry points.

## Parse once at the boundary

**Parse untrusted JSON and canonicalize action material** (Executable example). Full program: [recipes/strict-json.rs](../recipes/strict-json.rs)

```rust
use aiws_sdk::*;
use serde_json::json;
fn main() -> Result<()> {
    assert_eq!(parse_strict(r#"{"id":"a","id":"b"}"#).unwrap_err().code, "DUPLICATE_KEY");
    let action = Action::from_value(json!({"capability":"write","resource":"doc","payload":{"value":1},"preconditions":{"revision":1}}))?;
    println!("{}", fingerprint(&action)?);
    Ok(())
}

```

This example intentionally rejects duplicate JSON keys and verifies canonical action fingerprinting. Parsing with an ordinary JSON decoder first can discard duplicate-key evidence. Hand the original text to parseContract/Contract::parse/parse_contract or parseCommand/Command::parse/parse_command. Validate already-trusted native values with checked record constructors before using them.

The strict parser bounds input to 1 MiB, nesting to 64, and JSON integer literals to the interoperable safe-integer range. Decimal accounting values and timestamps are strings, not floating-point numbers. Canonical unsigned decimal strings have no plus sign, leading zeroes or decimal point; the general quantity schema permits up to 100 digits. Specific telemetry APIs have tighter numeric limits.

## Command families

| Family | Commands | What the family does not do |
|---|---|---|
| Mission/run | startRun, continueRun, activatePlan, missionState, transition | Start a process or change an attached graph |
| Authority | grant, revokeGrant, approve, withdrawApproval | Authenticate a person or silently elevate an agent |
| Effects | admit, dispatch, settle, retry | Prove an external effect without adapter evidence |
| Waits | wait, resume, join | Send notifications or run a background timer |
| Outcomes | verify, accept, invalidate | Execute the tests named in an evidence record |
| Triggers | registerTrigger, fireTrigger, tickTrigger | Operate an ingress server or cron daemon |
| Graph | registerGraph, attachGraph, completeNode | Automatically schedule ready nodes |

Every command optionally carries observation context; the coordinator replaces it with trusted authorizer attribution. The wire schema alone does not prove permission. The reducer also enforces state-dependent invariants not expressible by the structural schema.

## Application data schemas

Node inputSchema and outputSchema validate data supplied to the relevant checkpoint. The supported subset deliberately excludes remote reference fetching and unsupported constructs. A schema that is invalid or outside the supported subset is an error, not a best-effort validation request. Review data_validator/validate_data in the selected SDK and pin fixtures for the schemas your application relies on.

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

The example checks that a bad node input is rejected before the effect is dispatched. Schema validation establishes shape, not safety of executing a shell command contained in a string, authenticity of a URI or integrity of the bytes stored at that URI.

## Evolution

Unknown commands, fields, features and editions are rejected. Do not monkey-patch the schema to make an engine proposal appear available. Keep application handoff manifests outside closed SDK commands; store their references in permitted result material. A schema/profile change requires compatible implementations and shared fixtures in all three languages.
