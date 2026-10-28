use aiws_sdk::{Result,handoff::sha,handoff_records::HandoffManifest};
use serde_json::{Value,json};
fn main()->Result<()> {
    // Run from the repository root. This validates shape, not execution authority.
    let fixtures:Value=serde_json::from_str(&std::fs::read_to_string("spec/handoff-v1/fixtures.json").unwrap()).unwrap();
    let value=fixtures["valid"].as_array().unwrap().iter().find(|x|x["id"]=="manifest").unwrap()["value"].clone();
    let record=HandoffManifest::from_value(value)?;
    let digest=sha(record.as_value())?;
    let mut detached=record.as_value().clone();detached["result"]["changed"]=json!(true);
    assert_eq!(sha(record.as_value())?,digest);
    detached["unknownField"]=json!(true);
    assert!(HandoffManifest::from_value(detached).is_err());
    println!("PASS: handoff-records");Ok(())
}

