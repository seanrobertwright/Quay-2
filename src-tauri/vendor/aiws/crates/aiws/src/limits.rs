//! Native nested resource accounting. Facts are authenticated host output.
use crate::{core::{check,st,q},error,Result,canonical};
use serde_json::{json,Value};
use num_bigint::BigUint;
use sha2::{Digest,Sha256};
use std::{collections::{BTreeSet,BTreeMap},sync::OnceLock};

pub fn checked(name:&str,value:&Value)->Result<()> {
 static V:OnceLock<BTreeMap<String,jsonschema::Validator>>=OnceLock::new();
 let validators=V.get_or_init(||{
  let schema:Value=serde_json::from_str(include_str!("limits-schema.json")).unwrap();
  ["Config","Request","Facts","Quantity"].into_iter().map(|name|{let mut s=schema.clone();s["$ref"]=json!(format!("#/$defs/{name}"));(name.to_string(),jsonschema::validator_for(&s).unwrap())}).collect()
 });
 check(validators.get(name).is_some_and(|v|v.is_valid(value)),"SCHEMA_INVALID")
}
pub fn hash(value:&Value)->Result<String>{Ok(format!("{:x}",Sha256::digest(canonical(value)?.as_bytes())))}
fn get<'a>(v:&'a Value,key:&str,code:&str)->Result<&'a Value>{v.get(key).ok_or_else(||error(code))}
fn limits_valid(l:&Value)->Result<()>{check((!l["cost"].is_null()&&q(&l["handoff"])<=q(&l["cost"]))||(l["cost"].is_null()&&l["handoff"]=="0"),"LIMIT_INVALID")}
pub fn ancestry(s:&Value,id:&str)->Result<Vec<String>>{
 let mut out=vec![];let mut key=Some(id.to_owned());while let Some(k)=key{let v=get(&s["scopes"],&k,"SCOPE_UNSUPPORTED")?;check(!out.contains(&k),"SCOPE_CYCLE")?;out.push(k);key=v["parentId"].as_str().map(str::to_owned);}Ok(out)
}
fn gates(s:&Value,id:&str)->Result<Vec<String>>{
 let mut seen=BTreeSet::new();let mut pending=vec![id.to_owned()];while let Some(k)=pending.pop(){if seen.contains(&k){continue;}let v=get(&s["scopes"],&k,"SCOPE_UNSUPPORTED")?;seen.insert(k);if let Some(p)=v["parentId"].as_str(){pending.push(p.to_owned());}pending.extend(v["dependsOn"].as_array().unwrap().iter().map(|v|st(v).to_owned()));}Ok(seen.into_iter().collect())
}
pub fn initial(config:&Value)->Result<Value>{
 checked("Config",config)?;let mut scopes=json!({});for v in config["scopes"].as_array().unwrap(){check(scopes.get(st(&v["id"])).is_none(),"IDENTITY_CONFLICT")?;scopes[st(&v["id"])]=v.clone();}
 let s=json!({"protocol":"aiws-limits/1","config":config,"scopes":scopes,"attempts":{},"requests":{},"revision":"0","lastTime":"0","lastHash":hash(config)?});
 for (key,v) in scopes.as_object().unwrap(){limits_valid(&v["limits"])?;ancestry(&s,key)?;let p=if v["parentId"].is_null(){None}else{Some(get(&scopes,st(&v["parentId"]),"SCOPE_UNSUPPORTED")?)};
  let valid=match st(&v["kind"]){
   "WORK_ORDER"=>v["id"]==v["workOrderId"]&&v["runId"].is_null()&&v["nodeId"].is_null()&&p.is_none_or(|p|p["kind"]=="WORK_ORDER"),
   "RUN"=>p.is_some_and(|p|p["kind"]=="WORK_ORDER"&&v["workOrderId"]==p["workOrderId"]&&v["id"]==v["runId"]&&v["nodeId"].is_null()),
   _=>p.is_some_and(|p|["RUN","BRANCH"].contains(&st(&p["kind"]))&&v["workOrderId"]==p["workOrderId"]&&v["runId"]==p["runId"]&&!v["nodeId"].is_null())};check(valid,"IDENTITY_CONFLICT")?;
  if let Some(p)=p{check(q(&v["startMs"])>=q(&p["startMs"]),"CLOCK_INVALID")?;}
 }
 fn visit(scopes:&Value,key:&str,visiting:&mut BTreeSet<String>,done:&mut BTreeSet<String>)->Result<()>{let v=get(scopes,key,"SCOPE_UNSUPPORTED")?;check(!visiting.contains(key),"SCOPE_CYCLE")?;if done.contains(key){return Ok(());}visiting.insert(key.to_owned());for dep in v["dependsOn"].as_array().unwrap(){visit(scopes,st(dep),visiting,done)?;}if let Some(p)=v["parentId"].as_str(){visit(scopes,p,visiting,done)?;}visiting.remove(key);done.insert(key.to_owned());Ok(())}
 let mut visiting=BTreeSet::new();let mut done=BTreeSet::new();for key in scopes.as_object().unwrap().keys(){visit(&scopes,key,&mut visiting,&mut done)?;}Ok(s)
}
pub fn usage(s:&Value,id:&str,now:&str)->Result<BTreeMap<String,BigUint>>{
 let mut u:BTreeMap<String,BigUint>=["cost","ordinary","handoff","activeMs","attempts"].into_iter().map(|k|(k.into(),BigUint::from(0u8))).collect();
 for a in s["attempts"].as_object().unwrap().values(){if !ancestry(s,st(&a["scopeId"]))?.contains(&id.to_owned()){continue;}*u.get_mut("attempts").unwrap()+=1u8;
  let cost=match st(&a["status"]){"SETTLED"=>q(&a["actualCost"]),"RELEASED"=>BigUint::from(0u8),_=>q(&a["amount"])};
  let mut active=BigUint::from(0u8);if a["status"]=="RESERVED"{active=q(&a["maxActiveMs"]);}else if !a["dispatchedAt"].is_null(){let end=if a["stoppedAt"].is_null(){q(&json!(now))}else{q(&a["stoppedAt"])};check(end>=q(&a["dispatchedAt"]),"CLOCK_INVALID")?;active=end-q(&a["dispatchedAt"]);if a["stoppedAt"].is_null(){active=active.max(q(&a["maxActiveMs"]));}}
  *u.get_mut("cost").unwrap()+=&cost;*u.get_mut(if a["purpose"]=="HANDOFF"{"handoff"}else{"ordinary"}).unwrap()+=cost;*u.get_mut("activeMs").unwrap()+=active;
 }Ok(u)
}
fn reasons(s:&Value,key:&str,now:&str,purpose:&str,dispatch:bool)->Result<Vec<String>>{
 let v=&s["scopes"][key];let l=&v["limits"];let u=usage(s,key,now)?;let mut out=vec![];let n=q(&json!(now));let start=q(&v["startMs"]);
 if n<start{out.push("NOT_STARTED".into());}if !l["elapsedMs"].is_null()&&n>=start&&&n-&start>=q(&l["elapsedMs"]){out.push("ELAPSED_LIMIT".into());}
 let reached=|a:&BigUint,b:BigUint|if dispatch{a>&b}else{a>=&b};
 for (field,code) in [("cost","COST_LIMIT"),("activeMs","ACTIVE_LIMIT"),("attempts","ATTEMPT_LIMIT")]{if !l[field].is_null()&&reached(&u[field],q(&l[field])){out.push(code.into());}}
 if !l["cost"].is_null(){let (field,bound,code)=if purpose=="HANDOFF"{("handoff",q(&l["handoff"]),"HANDOFF_LIMIT")}else{("ordinary",q(&l["cost"])-q(&l["handoff"]),"ORDINARY_LIMIT")};if reached(&u[field],bound){out.push(code.into());}}Ok(out)
}
fn fits(s:&Value,key:&str,now:&str)->Result<()>{let u=usage(s,key,now)?;let l=&s["scopes"][key]["limits"];for field in ["cost","activeMs","attempts"]{check(l[field].is_null()||u[field]<=q(&l[field]),"LIMIT_EXHAUSTED")?;}if !l["cost"].is_null(){check(u["ordinary"]<=q(&l["cost"])-q(&l["handoff"])&&u["handoff"]<=q(&l["handoff"]),"LIMIT_EXHAUSTED")?;}Ok(())}
pub fn report(s:&Value,now:&str)->Result<Value>{
 checked("Quantity",&json!(now))?;check(q(&json!(now))>=q(&s["lastTime"]),"CLOCK_INVALID")?;let mut scopes=vec![];
 for key in s["scopes"].as_object().unwrap().keys(){let mut blockers=vec![];for g in gates(s,key)?{let r=reasons(s,&g,now,"ORDINARY",false)?;if !r.is_empty(){blockers.push(json!({"scopeId":g,"reasons":r}));}}let used:BTreeMap<_,_>=usage(s,key,now)?.into_iter().map(|(k,v)|(k,v.to_string())).collect();scopes.push(json!({"scopeId":key,"usage":used,"blockers":blockers}));}
 let outstanding:Vec<_>=s["attempts"].as_object().unwrap().iter().filter(|(_,a)|!["SETTLED","RELEASED"].contains(&st(&a["status"]))).map(|(k,_)|k).collect();
 Ok(json!({"ledgerId":s["config"]["ledgerId"],"revision":s["revision"],"at":now,"scopes":scopes,"outstanding":outstanding,"options":["REMAIN_HELD","CANCEL","NARROW_REPLAN","REQUEST_HUMAN_ADJUSTMENT"]}))
}
pub struct Transition{pub state:Value,pub result:Value,pub event:Option<Value>}
pub fn transition(state:&Value,request:&Value,now:&str,facts:&Value)->Result<Transition>{
 checked("Request",request)?;checked("Facts",facts)?;checked("Quantity",&json!(now))?;check(facts["allowed"]==true&&facts["authorizedAtMs"]==now,"AUTHORIZATION_DENIED")?;check(q(&json!(now))>=q(&state["lastTime"]),"CLOCK_INVALID")?;
 let key=canonical(&json!([facts["actorId"],request["requestId"]]))?;if let Some(prior)=state["requests"].get(&key){check(prior["request"]==*request,"REQUEST_CONFLICT")?;return Ok(Transition{state:state.clone(),result:prior["result"].clone(),event:None});}
 check(request["expectedRevision"]==state["revision"],"REVISION_CONFLICT")?;let mut s=state.clone();let c=&request["command"];let kind=st(&c["type"]);
 if kind=="reserve"{
  let aid=st(&c["attemptId"]);check(s["attempts"].get(aid).is_none(),"IDENTITY_CONFLICT")?;let scope=get(&s["scopes"],st(&c["scopeId"]),"SCOPE_UNSUPPORTED")?;check(scope["runId"]==c["runId"],"IDENTITY_CONFLICT")?;for prior in s["attempts"].as_object().unwrap().values(){if prior["operationId"]==c["operationId"]{check(["scopeId","runId","purpose"].iter().all(|k|prior[*k]==c[*k]),"IDENTITY_CONFLICT")?;}}
  for g in gates(&s,st(&c["scopeId"]))?{check(reasons(&s,&g,now,st(&c["purpose"]),false)?.is_empty(),"LIMIT_EXHAUSTED")?;}
  let mut a=c.clone();a.as_object_mut().unwrap().remove("type");a["status"]=json!("RESERVED");a["dispatchedAt"]=Value::Null;a["stoppedAt"]=Value::Null;a["actualCost"]=Value::Null;s["attempts"][aid]=a;for g in ancestry(&s,st(&c["scopeId"]))?{fits(&s,&g,now)?;}
 }else if kind=="adjust"{
  check(facts["actorKind"]=="HUMAN"&&!facts["evidenceRef"].is_null(),"HUMAN_REQUIRED")?;let id=st(&c["scopeId"]);get(&s["scopes"],id,"SCOPE_UNSUPPORTED")?;limits_valid(&c["limits"])?;s["scopes"][id]["limits"]=c["limits"].clone();fits(&s,id,now)?;
  let n=q(&json!(now));let start=q(&s["scopes"][id]["startMs"]);check(c["limits"]["elapsedMs"].is_null()||n<start||n-start<=q(&c["limits"]["elapsedMs"]),"LIMIT_EXHAUSTED")?;
 }else{
  let id=st(&c["attemptId"]);let mut a=get(&s["attempts"],id,"NOT_FOUND")?.clone();
  match kind{
   "dispatch"=>{check(a["status"]=="RESERVED","ATTEMPT_STATE")?;let own=ancestry(&s,st(&a["scopeId"]))?;for g in gates(&s,st(&a["scopeId"]))?{check(reasons(&s,&g,now,st(&a["purpose"]),own.contains(&g))?.is_empty(),"LIMIT_EXHAUSTED")?;}a["status"]=json!("DISPATCHED");a["dispatchedAt"]=json!(now);},
   "release"=>{check(a["status"]=="RESERVED","UNCERTAIN_EXPOSURE")?;a["status"]=json!("RELEASED");},
   "unknown"=>{check(a["status"]=="DISPATCHED","ATTEMPT_STATE")?;a["status"]=json!("UNKNOWN");},
   "stop"|"settle"=>{check(!facts["evidenceRef"].is_null(),"EVIDENCE_REQUIRED")?;check(a["status"]!="UNKNOWN"||facts["actorKind"]=="HUMAN","HUMAN_REQUIRED")?;check(["DISPATCHED","UNKNOWN","STOPPED"].contains(&st(&a["status"])),"ATTEMPT_STATE")?;if kind=="stop"{check(a["status"]!="STOPPED","ATTEMPT_STATE")?;}else{check(q(&c["actualCost"])<=q(&a["amount"]),"EXPOSURE_EXCEEDED")?;a["actualCost"]=c["actualCost"].clone();}if a["stoppedAt"].is_null(){a["stoppedAt"]=json!(now);}a["status"]=json!(if kind=="stop"{"STOPPED"}else{"SETTLED"});},
   _=>return Err(error("SCHEMA_INVALID"))
  }s["attempts"][id]=a;
 }
 s["revision"]=json!((q(&s["revision"])+BigUint::from(1u8)).to_string());s["lastTime"]=json!(now);let result=json!({"type":kind,"revision":s["revision"]});s["requests"][key]=json!({"request":request,"result":result});
 let mut event=json!({"sequence":s["revision"],"previousHash":s["lastHash"],"request":request,"at":now,"facts":facts,"result":result});event["hash"]=json!(hash(&event)?);s["lastHash"]=event["hash"].clone();Ok(Transition{state:s,result,event:Some(event)})
}
