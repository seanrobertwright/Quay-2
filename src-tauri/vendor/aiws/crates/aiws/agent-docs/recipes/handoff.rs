use aiws_sdk::*;
use aiws_sdk::sqlite::{SqliteStore,import_audit};
use serde_json::{json,Value};
fn main() -> std::result::Result<(),Box<dyn std::error::Error>> {
    let contract=Contract::parse(&std::fs::read_to_string("examples/guide/contract.json")?)?;
    let mut store=SqliteStore::open(":memory:",Some(&contract))?;
    store.apply(&Command::from_value(json!({"type":"startRun","runId":"r"}))?,"10",None)?;
    let audit=store.export_audit()?;
    let state=import_audit(&audit)?;
    let s=state.as_value();
    let bundle:Value=serde_json::from_str(&audit)?;
    let unresolved:Vec<_>=s["attempts"].as_object().unwrap().values()
        .filter(|a|a["status"]=="DISPATCHED"||a["status"]=="UNKNOWN")
        .map(|a|a["id"].clone()).collect();
    println!("{}",json!({"format":"example-handoff/1","missionId":s["contract"]["missionId"],
        "revision":s["revision"],"auditDigest":bundle["digest"],"spent":s["spent"],"reserved":s["reserved"],
        "unresolved":unresolved,"nextDecision":"Inspect current authority and pending work before resuming."}));
    Ok(())
}

