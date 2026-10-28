use aiws_sdk::{limits_store::{LimitStore, LimitCoordinator, LimitAuthorizer}, parse_strict, Result};
use serde_json::{json, Value};
// Demonstration only: a real host verifies the initial approval and each command.
struct DemoHost;
impl LimitAuthorizer for DemoHost {
    fn authorize(&mut self, _: &Value, _: &Value, now: &str) -> Result<Value> {
        Ok(json!({"allowed":true,"actorId":"demo-agent","actorKind":"AGENT","policyRef":"demo-policy","evidenceRef":null,"authorizedAtMs":now}))
    }
}
fn main() -> Result<()> {
    let config = parse_strict(&std::fs::read_to_string("examples/guide/limits-config.json").unwrap())?;
    let store = LimitStore::open(":memory:", Some(&config))?;
    let mut coordinator = LimitCoordinator { store, authorize: DemoHost, clock: || "0".to_owned() };
    for (attempt, purpose, amount) in [("work", "ORDINARY", "90"), ("summary", "HANDOFF", "10")] {
        let revision = coordinator.store.snapshot()?["revision"].clone();
        coordinator.apply(&json!({"requestId":attempt,"expectedRevision":revision,"command":{"type":"reserve","attemptId":attempt,"operationId":attempt,"scopeId":"run","runId":"run","purpose":purpose,"amount":amount,"maxActiveMs":"10"}}))?;
    }
    let report = coordinator.store.report("0")?;
    let usage = &report["scopes"].as_array().unwrap().iter().find(|s|s["scopeId"]=="wo").unwrap()["usage"];
    assert_eq!(usage["cost"], "100"); assert_eq!(usage["handoff"], "10");
    println!("{report}"); // Always available, even when paid work is blocked.
    Ok(())
}

