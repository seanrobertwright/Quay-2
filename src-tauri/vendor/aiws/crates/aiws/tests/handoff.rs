use aiws_sdk::{canonical,Contract};
use aiws_sdk::sqlite::SqliteStore;
use aiws_sdk::handoff::{initial,transition,sha};
use aiws_sdk::handoff_store::HandoffStore;
use serde_json::Value;
use std::{fs,time::{SystemTime,UNIX_EPOCH}};

#[test]
fn native_handoff_vectors_and_atomic_storage(){
 let corpus:Value=serde_json::from_str(include_str!("../../../spec/handoff-v1/runtime-cases.json")).unwrap();
 for case in corpus["cases"].as_array().unwrap(){
  let name=case["id"].as_str().unwrap();
  let dir=std::env::temp_dir().join(format!("aiws-handoff-{}-{}",std::process::id(),SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));fs::create_dir(&dir).unwrap();
  let path=dir.join("state.db");let path=path.to_str().unwrap();let contract=Contract::from_value(case["contract"].clone()).unwrap();
  let mut store=HandoffStore::open(path,Some(&contract),Some(&case["config"])).unwrap();let mut state=initial(&contract,&case["config"]).unwrap();
  match SqliteStore::open(path,Some(&contract)){Err(e)=>assert_eq!(e.code,"UNSUPPORTED_PROTOCOL"),Ok(_)=>panic!("mixed journal opened")};
  for step in case["steps"].as_array().unwrap(){
   let before=canonical(state.as_value()).unwrap();let r=&step["request"];let now=step["at"].as_str().unwrap();let facts=&step["facts"];
   if let Some(expected)=step.get("error"){
    match transition(&state,r,now,facts,false){Err(e)=>assert_eq!(&e.code,expected.as_str().unwrap(),"{name}"),Ok(_)=>panic!("{name}: expected rejection")};
    match store.apply(r,now,facts){Err(e)=>assert_eq!(&e.code,expected.as_str().unwrap(),"{name}"),Ok(_)=>panic!("{name}: expected storage rejection")};
    assert_eq!(canonical(state.as_value()).unwrap(),before);
   }else{
    let next=transition(&state,r,now,facts,false).unwrap_or_else(|e|panic!("{name}: {e:?}"));
    assert_eq!(next.event.as_ref().unwrap_or(&Value::Null),&step["event"],"{name}: event");assert_eq!(next.result,step["result"]);assert_eq!(canonical(state.as_value()).unwrap(),before);
    if ["commitBoundary","admitConsumer"].contains(&next.result["type"].as_str().unwrap())&&next.event.is_some(){
     let cut=store.apply_with_hook(r,now,facts,||Err(aiws_sdk::AiwsError{code:"INJECTED_POWER_CUT".into()}));assert!(cut.is_err());assert_eq!(sha(store.snapshot().unwrap().as_value()).unwrap(),sha(state.as_value()).unwrap());
    }
    let committed=store.apply(r,now,facts).unwrap();state=next.state;assert_eq!(sha(committed.state.as_value()).unwrap(),step["stateDigest"].as_str().unwrap());
   }
   assert_eq!(sha(store.snapshot().unwrap().as_value()).unwrap(),step["stateDigest"].as_str().unwrap(),"{name}");
  }
  assert_eq!(sha(state.as_value()).unwrap(),case["finalDigest"].as_str().unwrap());assert_eq!(aiws_sdk::handoff::metrics(&state).unwrap(),case["metrics"]);
  let events=store.export_events().unwrap();let mut replay=initial(&contract,&case["config"]).unwrap();for e in &events{let next=transition(&replay,&e["request"],e["at"].as_str().unwrap(),&e["facts"],true).unwrap();assert_eq!(next.event.as_ref(),Some(e));replay=next.state;}
  assert_eq!(sha(replay.as_value()).unwrap(),case["finalDigest"].as_str().unwrap());
  let pending=store.pending_events(100).unwrap();assert_eq!(pending.len(),events.len());if let Some(e)=pending.first(){store.acknowledge_event(e["sequence"].as_str().unwrap()).unwrap();assert_eq!(store.pending_events(100).unwrap().len(),pending.len()-1);}
  drop(store);let reopened=HandoffStore::open(path,None,None).unwrap();assert_eq!(sha(reopened.snapshot().unwrap().as_value()).unwrap(),case["finalDigest"].as_str().unwrap());drop(reopened);fs::remove_dir_all(dir).unwrap();
 }
}

#[test]
fn coordinator_checks_material_authority_and_duplicate_responses(){
 use aiws_sdk::handoff_store::{ArtifactProvider,FileArtifacts,HandoffCoordinator};
 use std::{cell::Cell,rc::Rc};
 struct Provider{files:FileArtifacts,mode:&'static str,now:Rc<Cell<u64>>}
 impl ArtifactProvider for Provider{fn read(&self,a:&Value)->aiws_sdk::Result<Vec<u8>>{if self.mode=="stale"{self.now.set(21);}if self.mode=="lying"{return Ok(b"wrong".to_vec());}self.files.read(a)}}
 let corpus:Value=serde_json::from_str(include_str!("../../../spec/handoff-v1/runtime-cases.json")).unwrap();let case=&corpus["cases"][0];
 for mode in ["ok","missing","lying","stale","denied"]{
  let dir=std::env::temp_dir().join(format!("aiws-provider-{}-{}",std::process::id(),SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));fs::create_dir(&dir).unwrap();
  let contract=Contract::from_value(case["contract"].clone()).unwrap();let mut store=HandoffStore::open(dir.join("state.db").to_str().unwrap(),Some(&contract),Some(&case["config"])).unwrap();
  let steps=case["steps"].as_array().unwrap();let index=steps.iter().position(|s|s["result"]["type"]=="commitBoundary").unwrap();
  for s in &steps[..index]{store.apply(&s["request"],s["at"].as_str().unwrap(),&s["facts"]).unwrap();}
  let step=&steps[index];let before=sha(store.snapshot().unwrap().as_value()).unwrap();let files=FileArtifacts::new(dir.join("material").to_str().unwrap()).unwrap();
  let artifact=files.put(b"hello","artifact:1","text/plain","human:operator","10000",None).unwrap();assert_eq!(files.read(&artifact).unwrap(),b"hello");
  if mode=="missing"{fs::remove_file(dir.join("material").join(artifact["sha256"].as_str().unwrap())).unwrap();}
  let now=Rc::new(Cell::new(10u64));let clock=now.clone();let mut facts=step["facts"].clone();facts["allowed"]=serde_json::json!(mode!="denied");
  let authority=move |_:&Value,_:&aiws_sdk::handoff::HandoffState,_:&str|->aiws_sdk::Result<Value>{Ok(facts.clone())};
  let mut host=HandoffCoordinator::new(store,authority,move ||clock.get().to_string(),Provider{files,mode,now});
  let result=host.apply(&step["request"]);
  if mode=="ok"{let result=result.unwrap();assert!(result.event.is_some());assert_eq!(sha(result.state.as_value()).unwrap(),step["stateDigest"].as_str().unwrap());assert!(host.apply(&step["request"]).unwrap().event.is_none());assert!(host.verified_material().is_empty());}
  else{let code=match mode{"missing"=>"ARTIFACT_UNAVAILABLE","lying"=>"ARTIFACT_MISMATCH","stale"=>"AUTHORITY_STALE",_=>"AUTHORIZATION_DENIED"};match result{Err(e)=>assert_eq!(e.code,code),Ok(_)=>panic!("invalid provider committed")};assert_eq!(sha(host.store.snapshot().unwrap().as_value()).unwrap(),before);assert!(host.verified_material().is_empty());}
  for event in host.store.pending_events(100).unwrap(){assert!(event["eventId"].is_string());assert_eq!(event["missionId"],"m");}
  drop(host);fs::remove_dir_all(dir).unwrap();
 }
}

#[test]
fn schema_artifact_validation_is_atomic(){
 use aiws_sdk::handoff_store::{FileArtifacts,HandoffCoordinator};
 let corpus:Value=serde_json::from_str(include_str!("../../../spec/handoff-v1/runtime-cases.json")).unwrap();let case=&corpus["cases"][0];
 for valid in [true,false]{
  let dir=std::env::temp_dir().join(format!("aiws-schema-{}-{}",std::process::id(),SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));fs::create_dir(&dir).unwrap();
  let contract=Contract::from_value(case["contract"].clone()).unwrap();let mut store=HandoffStore::open(dir.join("state.db").to_str().unwrap(),Some(&contract),Some(&case["config"])).unwrap();let steps=case["steps"].as_array().unwrap();let index=steps.iter().position(|s|s["result"]["type"]=="commitBoundary").unwrap();for s in &steps[..index]{store.apply(&s["request"],s["at"].as_str().unwrap(),&s["facts"]).unwrap();}
  let files=FileArtifacts::new(dir.join("material").to_str().unwrap()).unwrap();let schema=files.put(br#"{"type":"string"}"#,"schema:1","application/schema+json","human:operator","10000",None).unwrap();let data=files.put(if valid{b"\"hello\""}else{b"42"},"artifact:1","application/json","human:operator","10000",Some(&serde_json::json!({"id":"schema:1","digest":schema["sha256"]}))).unwrap();
  let mut request=steps[index]["request"].clone();request["command"]["body"]["manifest"]["artifacts"]=serde_json::json!([data,schema]);let facts=steps[index]["facts"].clone();let before=sha(store.snapshot().unwrap().as_value()).unwrap();let authority=move |_:&Value,_:&aiws_sdk::handoff::HandoffState,_:&str|->aiws_sdk::Result<Value>{Ok(facts.clone())};let mut host=HandoffCoordinator::new(store,authority,||"10".into(),files);
  if valid{assert!(host.apply(&request).unwrap().event.is_some());}else{assert!(host.apply(&request).is_err());assert_eq!(sha(host.store.snapshot().unwrap().as_value()).unwrap(),before);}drop(host);fs::remove_dir_all(dir).unwrap();
 }
}

#[cfg(windows)]
#[test]
fn file_artifacts_publish_on_windows_without_a_directory_sync(){
 use aiws_sdk::handoff_store::{ArtifactProvider,FileArtifacts};
 let dir=std::env::temp_dir().join(format!("aiws-dirsync-{}-{}",std::process::id(),SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
 let files=FileArtifacts::new(dir.to_str().unwrap()).unwrap();let artifact=files.put(b"hello","artifact:1","text/plain","human:operator","10000",None).unwrap();assert_eq!(files.read(&artifact).unwrap(),b"hello");
 fs::remove_dir_all(dir).unwrap();
}

#[cfg(unix)]
#[test]
fn file_artifacts_refuse_a_failed_directory_sync(){
 use aiws_sdk::handoff_store::FileArtifacts;use std::os::unix::fs::PermissionsExt;
 let dir=std::env::temp_dir().join(format!("aiws-dirsync-{}-{}",std::process::id(),SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
 let files=FileArtifacts::new(dir.to_str().unwrap()).unwrap();
 // Write and search without read: put can still link the file but cannot open the directory to sync it.
 fs::set_permissions(&dir,fs::Permissions::from_mode(0o300)).unwrap();
 let enforced=fs::File::open(&dir).is_err();let result=files.put(b"hello","artifact:1","text/plain","human:operator","10000",None);
 fs::set_permissions(&dir,fs::Permissions::from_mode(0o700)).unwrap();fs::remove_dir_all(&dir).unwrap();
 if enforced{assert_eq!(result.unwrap_err().code,"ARTIFACT_UNAVAILABLE");}
}
