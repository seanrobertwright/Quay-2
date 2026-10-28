# Install and run your first workflow

This guide targets SDK **0.4.0**, AIWS proposal **0.4**, profile **finite-v1**. Choose a language tab once; the site keeps matching examples synchronized. All examples are also present as plain source files and in the downloadable handbook for agents that do not execute browser JavaScript.

## Choose a starting point

For application developers, install one SDK and follow the [coordinator tutorial](./tutorial.md). For agent implementers, read [agent integration](./agents.md) and the [capability matrix](./capabilities.md) before generating code. For engine designers, use [handoffs](./handoffs.md) and [engine decisions](./engine-design.md), which explicitly identify features that are not SDK APIs.

The downloads are local distribution artifacts, not packages published to npm, crates.io or PyPI. Do not install an unrelated registry package with the same name. TypeScript requires Node 24 or newer. Python declares 3.11 or newer; the release was tested on 3.12. Rust examples use the current stable toolchain and a path dependency.

## Install from the source archive

Extract the complete source (not in this pack). Run the following from its root. These are shell setup commands; the application code below has a tab for each SDK.

```sh
npm ci
npm run build:sdk
python -m pip install ./packages/python
cargo build --locked
```

Only install the languages you intend to use. The documentation verification suite needs all three. A Python-only application does not require Node or Rust. A Rust-only application does not require Python or Node. The Node requirement belongs to the TypeScript SDK and the Astro documentation build.

To install individual releases, use `npm install ./aiws-sdk-0.4.0.tgz`, `python -m pip install ./aiws_sdk-0.4.0-py3-none-any.whl`, or extract the Rust crate and declare its directory as a Cargo path dependency. Package archives are linked from the [overview](./index.md).

## First successful control sequence

The example below is a **trusted simulation**, with a fixed clock and explicit recorded effect outcomes. It teaches the state machine without calling a provider or writing a repository. The eight stages start a run, register a grant, reserve an operation, dispatch, settle, complete execution, verify and accept. External applications must use the coordinator and real effect adapter described in the next tutorial.

**Execution, verification and acceptance** (Executable control simulation). Full program: [recipes/first-run.rs](../recipes/first-run.rs)

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
  "effect": "CONFIRMED_APPLIED",
  "actualCost": "3"
}))?, "10")?;

    // Step 6
    state = reduce(&state, &Command::from_value(json!({
  "type": "transition",
  "runId": "r",
  "to": "COMPLETED"
}))?, "10")?;

    // Step 7
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

    // Step 8
    state = reduce(&state, &Command::from_value(json!({
  "type": "accept",
  "runId": "r",
  "authority": "owner",
  "verificationRevision": "v1",
  "decision": "ACCEPTED",
  "rationale": "Accepted deliverable"
}))?, "10")?;
    assert_eq!(state.as_value()["assessments"]["r"]["acceptance"], json!("ACCEPTED"));
    assert_eq!(state.as_value()["spent"], json!("3"));
    assert_eq!(state.as_value()["reserved"], json!("0"));
    println!("PASS: first-run");
    Ok(())
}

```

The final assertions demonstrate a recorded accepted assessment and exact accounting. A positive record is only as trustworthy as the authenticated assessor and evidence behind it. A model saying “PASS” is not sufficient proof that tests ran.

## Execute the exact displayed source

Every example has the same ID as its source filename. For this example:

```sh
node examples/guide/typescript/first-run.ts
python examples/guide/python/first-run.py
cargo run --manifest-path examples/guide/rust/Cargo.toml --bin first-run
```

Commands run from the repository root. The Rust examples form a separate Cargo workspace that depends on `crates/aiws`; they do not call the TypeScript implementation. To run all documented examples use `node scripts/check-guide-examples.mjs`. Set `AIWS_PYTHON` or `AIWS_CARGO` when executable names differ.

## Next steps

Follow [application assembly](./tutorial.md) to dispatch a real local effect, then [authorization](./authorization.md), [recovery](./recovery.md) and [observability](./observability.md). Before using production data, understand the [security boundary](./security.md). Do not skip those pages merely because the first simulation passes.
