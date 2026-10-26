use aiws_sdk::{limits_store::LimitStore,error};
use serde_json::{json,Value};
#[path="../examples/limits_vectors.rs"]mod vectors;
#[test]fn shared_vectors(){vectors::run().unwrap();}
#[test]fn durable_race_and_rollback(){
 let cases:Value=serde_json::from_str(include_str!("../../../spec/limits-v1/cases.json")).unwrap();let cfg=&cases["cases"][0]["config"];
 let dir=std::env::temp_dir().join(format!("aiws-limits-{}-{}",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));std::fs::create_dir_all(&dir).unwrap();let path=dir.join("ledger.db");let path=path.to_str().unwrap();let mut a=LimitStore::open(path,Some(cfg)).unwrap();let mut b=LimitStore::open(path,None).unwrap();
 let request=json!({"requestId":"a","expectedRevision":"0","command":cases["cases"][0]["steps"][0]["command"]});let facts=json!({"allowed":true,"actorId":"a","actorKind":"AGENT","policyRef":"p","evidenceRef":null,"authorizedAtMs":"0"});
 assert!(a.apply_with_hook(&request,"0",&facts,||Err(error("CRASH"))).is_err());assert_eq!(b.snapshot().unwrap()["revision"],"0");let state=a.apply(&request,"0",&facts).unwrap().state;let mut other=request.clone();other["requestId"]=json!("b");other["command"]["attemptId"]=json!("b");
 assert_eq!(b.apply(&other,"0",&facts).err().unwrap().code,"REVISION_CONFLICT");drop(a);drop(b);let a=LimitStore::open(path,None).unwrap();assert_eq!(a.snapshot().unwrap(),state);assert_eq!(a.export_events().unwrap().len(),1);drop(a);std::fs::remove_dir_all(dir).unwrap();
}
