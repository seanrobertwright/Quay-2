# Assemble a governed application

The application owns identity, user interaction, credentials, adapters and evidence assessment. The SDK owns validation and the finite-v1 state transitions it checks. Keeping those responsibilities explicit avoids accidentally giving untrusted agent code a raw ledger connection.

## The execution path

A request enters your authenticated application. Your policy evaluates the requested command, actor, mission and current restrictions. The coordinator injects that decision, checks the expected state revision and asks SQLite to commit it. Only a successful dispatch commit permits the adapter call. The adapter reports a known outcome or uncertainty. Completion, verification and acceptance follow as separate recorded decisions.

Construct one store for one mission, supply a trusted clock and an authorizer, then pass only controlled command operations to callers. In Rust and Python the coordinator is synchronous; move blocking calls to dedicated workers in an async application. TypeScript awaits the authorizer and adapter, while its SQLite operations remain synchronous.

## Run an actual local effect

This complete example writes a local artifact in a new temporary directory, records a graph checkpoint, completes the run and demonstrates the verification/acceptance sequence. It reads `examples/review.json`. The identity, clock, cost and evidence values in this fixture are explicitly demonstrations; they must be replaced for a real coding service.

**Execute an adapter through the trusted coordinator** (Executable local adapter demonstration; fixed demo identity and fixture evidence). Full program: [recipes/coordinator.rs](../recipes/coordinator.rs)

```rust
use aiws_sdk::runtime::*;
use aiws_sdk::sqlite::SqliteStore;
use aiws_sdk::*;
use serde_json::{json, Value};
struct DemoIdentity;
impl Authorizer for DemoIdentity {
    fn authorize(&mut self, _: &Command, _: &Snapshot, _: &str) -> Result<Authorization> {
        Ok(Authorization {
            allowed: true,
            policy: "ALLOW".into(),
            mandatory_checks_ok: true,
            context: json!({"actor":"demo:operator","policyRevision":"policy:1","decisionClass":"DETERMINISTIC"}),
        })
    }
}
struct Fixed;
impl Clock for Fixed {
    fn now_ms(&self) -> String {
        "10".into()
    }
}
struct LocalReview(std::path::PathBuf);
impl EffectAdapter for LocalReview {
    fn execute(&mut self, operation: &Value, _: &Value) -> Result<Outcome> {
        use std::io::Write;
        let mut file = std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&self.0)
            .map_err(|_| error("FILE_ERROR"))?;
        file.write_all(canonical(&operation["action"]["payload"])?.as_bytes())
            .map_err(|_| error("FILE_ERROR"))?;
        file.sync_all().map_err(|_| error("FILE_ERROR"))?;
        Ok(Outcome {
            effect: "CONFIRMED_APPLIED".into(),
            actual_cost: "3".into(),
        })
    }
    fn reconcile(&mut self, operation: &Value, _: &Value) -> Result<Outcome> {
        let applied = std::fs::read_to_string(&self.0).ok()
            == Some(canonical(&operation["action"]["payload"])?);
        let (effect, actual_cost) = if applied {
            ("CONFIRMED_APPLIED", "3")
        } else {
            ("UNKNOWN", "0")
        };
        Ok(Outcome {
            effect: effect.into(),
            actual_cost: actual_cost.into(),
        })
    }
}
fn main() -> std::result::Result<(), Box<dyn std::error::Error>> {
    let demo: Value = serde_json::from_str(include_str!("../../../../../examples/review.json"))?;
    let directory = std::env::temp_dir().join(format!(
        "aiws-review-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_nanos()
    ));
    std::fs::create_dir(&directory)?;
    let store = SqliteStore::open(
        directory.join("mission.db").to_str().unwrap(),
        Some(&Contract::parse(&demo["contract"].to_string())?),
    )?;
    let mut c = Coordinator::new(store, DemoIdentity, Fixed);
    let mut adapter = LocalReview(directory.join("review.txt"));
    for raw in demo["commands"].as_array().unwrap() {
        let command = Command::from_value(raw.clone())?;
        if raw["type"] == "dispatch" {
            c.dispatch(
                raw["attemptId"].as_str().unwrap(),
                &mut adapter,
                raw["nodeId"].as_str(),
            )?;
        } else {
            c.apply(&command, None)?;
        }
    }
    println!(
        "{}",
        json!({"directory":directory,"result":assess_success(&c.store.snapshot()?,"r")?})
    );
    std::fs::write(directory.join("audit.json"), c.store.export_audit()?)?;
    Ok(())
}

```

The expected output contains a temporary directory and `verifiedSuccessful: true`. Inspect the artifact, `mission.db` and `audit.json` there. The directory is intentionally retained for inspection. The mock evidence string in the supplied review fixture is not a cryptographic attestation; production assessment must compute and verify actual evidence.

## Turn the demonstration into a coding service

1. Authenticate the user outside the agent and resolve the repository and permitted branch from trusted application state.
2. Store an approved plan artifact with an immutable revision and explicit test criteria. The current SDK's plan ID records lineage; your application must enforce the human plan-approval gate.
3. Resolve capabilities such as repository editing or test execution through a fixed adapter registry. An agent must not select arbitrary shell commands or credential scopes merely by filling a JSON property.
4. Create an isolated working directory, record its base commit and give the adapter only authorized paths and tools.
5. Capture test command, exit status, output artifact digest, tool versions and repository revision. Read those results when creating the assessment.
6. Request acceptance from the configured human or authorized policy for that exact verification revision. A materially changed artifact requires reassessment.

The SDK does not execute an LLM, clone a repository, open a pull request, launch a sandbox or validate a domain claim automatically. It provides the checked command boundary around your implementations of those operations.

## Success and failure paths

Never put a generic “retry on every exception” wrapper around `dispatch`. A response can be lost after the external change happened. Let the coordinator preserve uncertainty, then use a human-controlled reconciliation path. If a result is known not to have applied, a checked retry can create another attempt of the same operation.

If the authorizer or ledger is unavailable, do not call the adapter through an alternate path. If recording settlement fails after the adapter returns, preserve the external receipt and reconcile after storage recovers. Re-running the whole HTTP request is not a substitute for identifying which phase committed.

Application integration is complete only when both its happy path and its interrupted path are exercised against the real adapter. Use [testing recipes](./testing.md) to build those checks.
