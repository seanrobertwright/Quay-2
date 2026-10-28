# Verification, acceptance and evidence

Successful execution, successful verification and accepted delivery are separate outcomes. `assessSuccess` or `assess_success` checks that the run is COMPLETED, the current verification is PASSED, acceptance is ACCEPTED and no operation for the run remains UNKNOWN. It does not perform tests or inspect evidence bytes.

## What to record

A verification command names the assessor, a unique assessment revision, every mandatory criterion, evidence references and a rationale. Each criterion is PASS, FAIL or INCONCLUSIVE. A missing required criterion is rejected. Empty evidence prevents a PASSED assessment. Evidence strings are opaque identifiers in this profile; the application must ensure the evidence exists and supports the result.

A production coding assessment should bind results to the exact repository revision, test suite/configuration and generated artifact digests. Record failures and uncertainty honestly. The engine must not change acceptance criteria merely to obtain a passing result after corrective work.

Acceptance names the accountable authority and the exact verification revision. Recording a new verification resets the current acceptance; it cannot inherit approval for an old assessment. An authorized automatic acceptance policy is possible, but it must be explicit, versioned and independent of the agent's own claim of success.

## Invalidating evidence

**Invalidate verification and dependent acceptance** (Executable control simulation). Full program: [recipes/invalidation.rs](../recipes/invalidation.rs)

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

```

When evidence becomes invalid, the SDK marks verification INVALIDATED and propagates invalidation to accepted status. It does not rewrite the terminal execution record. A workflow can have completed execution yet no longer qualify as verified successful.

## Planning and corrective work

**Activate a new plan identity using an expected revision** (Executable control simulation). Full program: [recipes/plan.rs](../recipes/plan.rs)

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
  "type": "activatePlan",
  "runId": "r",
  "planId": "p2",
  "expectedPlan": "initial"
}))?, "10")?;

    // Step 3
    let rejected = Command::from_value(json!({
  "type": "activatePlan",
  "runId": "r",
  "planId": "p3",
  "expectedPlan": "initial"
})).and_then(|command| reduce(&state, &command, "10"));
    assert_eq!(rejected.unwrap_err().code, "REVISION_CONFLICT");
    println!("PASS: plan");
    Ok(())
}

```

Plan activation is a compare-and-swap lineage operation. It does not authenticate a human approval, switch an attached graph or revise contract limits. Apply the user-defined reapproval rules in your trusted application. Keep the original approved plan and the reason for each revision available for assessment and recovery.

A failed verification does not always require repeating every earlier step. The proposed engine's handoff and artifact dependency model will identify the affected descendants, invalidate their stale assumptions and execute authorized corrective work. The SDK packages do not supply that incremental recomputation engine.
