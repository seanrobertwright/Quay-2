# Rust integration

Use the Rust toolchain compatible with the included Cargo.lock and Cargo.toml. Add aiws-sdk as a path dependency pointing to crates/aiws in the source download, or unpack the supplied .crate file and point to that directory. Add serde_json when constructing JSON-backed records. This release is not published to crates.io.

## Runnable coordinator

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

The full program uses a local adapter, fixed trusted demo identity and fixture evidence. Replace those three boundaries with real identity, a scoped adapter and measured validation evidence before using this pattern in production. The tab set includes equivalent Rust, TypeScript and Python implementations.

## Protocol-bound workflow correlation

SDK 0.4.0 includes a small protocol-correlation helper that the earlier 0.3.0 packages lack. It records the exact Praxis binding revision and remote identity alongside the AIWS work/run/operation/attempt identity. It does **not** implement MCP, A2A or AG-UI transport behavior and always validates `authoritative: false`.

**Correlate governed work with a protocol binding** (Executable source-only SDK correlation example; no protocol client or authority is created). Full program: [recipes/protocol-correlation.rs](../recipes/protocol-correlation.rs)

```rust
use aiws_sdk::*;
use serde_json::json;

fn main()->Result<()>{
    let contract=Contract::parse(&json!({"id":"contract:protocol","missionId":"mission:protocol","aiwsEdition":"0.4","profile":"finite-v1","budget":"20","deadline":"1000","criteria":["remote-result-reviewed"],"actions":["remote.invoke"],"resources":["protocol:mcp"],"requiresApproval":false,"maxAttempts":"2","maxAuthorizationAgeMs":"100","features":[]}).to_string())?;
    let mut state=create_mission(&contract)?;
    state=reduce(&state,&Command::from_value(json!({"type":"startRun","runId":"run:1"}))?,"10")?;
    state=reduce(&state,&Command::from_value(json!({"type":"grant","grant":{"id":"grant:1","subject":"agent:1","profile":"finite-v1","actions":["remote.invoke"],"resources":["protocol:mcp"],"notBefore":"0","expiresAt":"1000","limit":"20","canDelegate":false,"depth":"0"}}))?,"10")?;
    state=reduce(&state,&Command::from_value(json!({"type":"admit","runId":"run:1","operationId":"operation:1","attemptId":"attempt:1","grantId":"grant:1","subject":"agent:1","action":{"capability":"remote.invoke","resource":"protocol:mcp","payload":{"tool":"echo"},"preconditions":{}},"amount":"5","authorizationCheckedAt":"10","policy":"ALLOW","mandatoryChecksOk":true}))?,"10")?;

    let correlation=protocol_correlation(
        ProtocolBindingRef{binding_id:"mcp:official-v2".into(),binding_revision:"1".into(),protocol:"MCP".into(),protocol_version:"2026-07-28".into(),manifest_digest:"a".repeat(64),capability_digest:"b".repeat(64)},
        ProtocolOperationRef{work_order_id:"mission:protocol".into(),run_id:"run:1".into(),task_id:None,operation_id:"operation:1".into(),attempt_id:"attempt:1".into(),remote_identity_ref:Some("mcp:praxis-m9-fixture@1.0.0".into()),remote_operation_id:None}
    ).map_err(|code|AiwsError{code})?;
    assert_eq!(correlation.operation.operation_id,"operation:1");
    assert!(!correlation.authoritative);
    assert_eq!(state.as_value()["operations"]["operation:1"]["runId"],json!("run:1"));
    println!("PASS: protocol-correlation");
    Ok(())
}

```

In current source, after the 0.4.0 archives, deserializing a `ProtocolCorrelation` takes an exact key set at every level of the record, and `ProtocolCorrelation::from_value` checks decoded JSON with the same error codes as TypeScript and Python, in the same order; see the [API mapping](./api-reference.md#protocol-correlation-helpers).

Use official protocol SDKs and the Praxis adapters for wire behavior. Use this helper only for portable correlation in application code, evidence indexes or integration metadata.

## Integration details

Checked record constructors return Result and enforce the shared schema. Contract::parse and Command::parse preserve strict JSON ingress checks; from_value is suitable for already-decoded trusted values. Inspect snapshots with as_value(); do not circumvent the record constructors by manipulating internal state.

The crate contains these public modules:

| Module | Contents |
|---|---|
| `aiws_sdk` | Checked records and finite-v1 semantics at the crate root: `Contract`, `Command`, `Snapshot`, `reduce`, `AiwsError` and the protocol-correlation records |
| `aiws_sdk::workflow` | `validate_graph`, `ready_nodes` and `due_slots` |
| `aiws_sdk::runtime` | `Coordinator` and the `Authorizer`, `Clock` and `EffectAdapter` traits |
| `aiws_sdk::sqlite` | `SqliteStore` and `import_audit` |
| `aiws_sdk::observability` | Correlated records, OTLP/HTTP JSON, metrics and alert evaluation ([observability](./observability.md)) |
| `aiws_sdk::handoff`, `aiws_sdk::handoff_records`, `aiws_sdk::handoff_store` | The opt-in handoff profile: journal semantics, checked records, and the SQLite journal with owned artifacts ([handoffs](./handoffs.md)) |
| `aiws_sdk::limits`, `aiws_sdk::limits_store` | Opt-in nested resource accounting and its SQLite ledger ([budgets](./budgets.md)) |
| `aiws_sdk::dynamic_controls`, `aiws_sdk::dynamic_types` | The `aiws-dynamic-controls/1` client and its generated types ([dynamic controls](./engine-dynamic-controls.md)) |
| `aiws_sdk::readiness`, `aiws_sdk::readiness_types`, `aiws_sdk::readiness_types_v1` | Advisory readiness records, with generated types for the current and the frozen readiness versions ([readiness](./engine-readiness.md)) |
| `aiws_sdk::access_policy`, `aiws_sdk::access_policy_types` | The access-policy contract codec and its generated types ([access policy](./engine-access-policy.md)) |
| `aiws_sdk::protocol` | Protocol-correlation records, also re-exported at the crate root |

Implement runtime::Authorizer, runtime::Clock and runtime::EffectAdapter in your host, and limits_store::LimitAuthorizer for the nested resource ledger. The coordinator owns a SqliteStore and its mutable methods serialize work through that object. These APIs are synchronous. In an async server, run blocking database and adapter work in a controlled blocking worker rather than on an executor thread that must stay responsive.

Propagate errors with ? until a boundary can inspect AiwsError.code, preserve state and choose a recovery decision. Do not unwrap external input. Dropping a coordinator does not cancel an already-applied external action. A timeout at the host still requires read-back or human intervention for ambiguous outcomes.

The guide examples form an independent Cargo workspace under examples/guide/rust. Use cargo run --manifest-path examples/guide/rust/Cargo.toml --bin coordinator from the repository root. Cargo builds native Rust; no Node or Python process implements these SDK operations.

## Diagnostics and next steps

Use the [API mapping](./api-reference.md) to translate native calls without changing camelCase wire keys. Use [observability](./observability.md) for exporter configuration and [recovery](./recovery.md) for interrupted effects. All examples are included as individual executable source files under examples/guide/.

The crate's `aiws-sdk` binary offers `aiws-sdk validate FILE` for a contract, `aiws-sdk graph FILE` for a graph, `aiws-sdk replay FILE` for an audit export, `aiws-sdk fixtures FILE` for a shared scenario file, and `aiws-sdk snapshot FILE` and `aiws-sdk observe FILE` for a SQLite mission database. Its output, error codes and exit statuses match the TypeScript and Python CLIs ([command-line tools](./api-reference.md#command-line-tools)). In the 0.4.0 archives its usage text omits snapshot and observe, and a usage error exits 1 with the usage inside an error record. Its observe projection uses a fixed test timestamp and is not a live monitoring service. Run `observability::operational_summary` with a trusted current timestamp in your application instead.
