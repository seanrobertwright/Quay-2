use aiws_sdk::*;
use aiws_sdk::sqlite::{SqliteStore,import_audit};
use serde_json::json;
fn main() -> std::result::Result<(),Box<dyn std::error::Error>> {
    let contract = Contract::parse(&std::fs::read_to_string("examples/guide/contract.json")?)?;
    let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)?.as_nanos();
    let path = std::env::temp_dir().join(format!("aiws-docs-{nonce}.db"));
    let name = path.to_str().ok_or("non-UTF8 path")?;
    let mut store = SqliteStore::open(name,Some(&contract))?;
    store.apply(&Command::from_value(json!({"type":"startRun","runId":"r"}))?,"10",Some("0"))?;
    drop(store);
    let store = SqliteStore::open(name,None)?;
    assert_eq!(store.snapshot()?,import_audit(&store.export_audit()?)?);
    println!("{}",name);
    Ok(())
}

