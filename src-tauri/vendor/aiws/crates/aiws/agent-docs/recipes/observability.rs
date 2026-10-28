use aiws_sdk::*;
use aiws_sdk::{sqlite::SqliteStore,observability::*};
use serde_json::json;
fn main() -> std::result::Result<(),Box<dyn std::error::Error>> {
    let contract=Contract::parse(&std::fs::read_to_string("examples/guide/contract.json")?)?;
    let mut store=SqliteStore::open(":memory:",Some(&contract))?;
    let state=store.apply(&Command::from_value(json!({"type":"startRun","runId":"r","context":{"actor":"private:actor","policyRevision":"policy:1","decisionClass":"HUMAN"}}))?,"10",None)?;
    assert!(!trace_payload(&state.as_value()["events"][0])?.to_string().contains("private:actor"));
    let summary=operational_summary(&state,"4000000",None,Some(&store.export_state()?))?;
    println!("{}",metric_payload(&summary,"4000000")?);
    Ok(())
}

