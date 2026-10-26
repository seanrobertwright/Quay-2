use aiws_sdk::{limits,Result};
use serde_json::{json,Value};
pub fn run()->Result<Value>{
 let fixtures:Value=serde_json::from_str(include_str!("../../../spec/limits-v1/cases.json")).unwrap();let mut output=vec![];
 for c in fixtures["cases"].as_array().unwrap(){let mut state=limits::initial(&c["config"])?;let mut events=vec![];
  for (i,step) in c["steps"].as_array().unwrap().iter().enumerate(){
   if let Some(at)=step["reportAt"].as_str(){let r=limits::report(&state,at)?;for(key,value)in step["expected"].as_object().unwrap(){if key=="blocked"{let mut want:Vec<_>=value.as_array().unwrap().iter().map(|v|v.as_str().unwrap()).collect();want.sort();let mut got:Vec<_>=r["scopes"].as_array().unwrap().iter().filter(|v|!v["blockers"].as_array().unwrap().is_empty()).map(|v|v["scopeId"].as_str().unwrap()).collect();got.sort();assert_eq!(want,got,"{}",c["id"]);}else{let row=r["scopes"].as_array().unwrap().iter().find(|v|v["scopeId"]==key.as_str()).unwrap();for(field,want)in value.as_object().unwrap(){assert_eq!(&row["usage"][field],want,"{}:{field}",c["id"]);}}}events.push(r);continue;}
   let request=json!({"requestId":step.get("requestId").cloned().unwrap_or(json!(i.to_string())),"expectedRevision":step.get("expectedRevision").unwrap_or(&state["revision"]),"command":step["command"]});let facts=json!({"allowed":true,"actorId":format!("actor-{}",step["actorKind"].as_str().unwrap()),"actorKind":step["actorKind"],"policyRef":"policy:1","evidenceRef":step["evidenceRef"],"authorizedAtMs":step["at"]});let before=state.clone();
   match limits::transition(&state,&request,step["at"].as_str().unwrap(),&facts){Ok(out)=>{assert!(step["error"].is_null(),"{}",c["id"]);state=out.state;events.push(json!({"result":out.result,"event":out.event}));},Err(e)=>{assert_eq!(json!(e.code),step["error"],"{}",c["id"]);assert_eq!(state,before);events.push(json!({"error":e.code}));}}
  }output.push(json!({"id":c["id"],"digest":limits::hash(&json!({"state":state,"events":events}))?}));
 }
 for c in fixtures["invalidConfigs"].as_array().unwrap(){assert_eq!(limits::initial(&c["config"]).unwrap_err().code,c["error"].as_str().unwrap(),"{}",c["id"]);}Ok(json!(output))
}
#[allow(dead_code)]
fn main(){println!("{}",run().unwrap());}
