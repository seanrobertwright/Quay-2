use aiws_sdk::*;
use aiws_sdk::{sqlite::SqliteStore,observability::*};
use serde_json::{json,Value};
struct FakeCollector{calls:usize}
impl TelemetryExporter for FakeCollector{
    fn send(&mut self,_:&str,_:&Value)->Value{
        self.calls+=1;
        classify_response(if self.calls==1{503}else{200},"{}",None)
    }
}
fn main()->std::result::Result<(),Box<dyn std::error::Error>>{
    let contract=Contract::parse(&std::fs::read_to_string("examples/guide/contract.json")?)?;
    let mut store=SqliteStore::open(":memory:",Some(&contract))?;
    store.apply(&Command::from_value(json!({"type":"startRun","runId":"r"}))?,"10",None)?;
    let mut exporter=FakeCollector{calls:0};
    assert_eq!(store.flush_telemetry(&mut exporter,"10",100)?[0]["status"],"PENDING");
    assert_eq!(store.flush_telemetry(&mut exporter,"1010",100)?[0]["status"],"SENT");
    assert_eq!(store.snapshot()?.as_value()["revision"],"1");
    store.purge_sent_telemetry()?;
    Ok(())
}

