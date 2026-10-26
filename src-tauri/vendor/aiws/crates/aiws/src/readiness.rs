//! Advisory readiness. Verification claims must originate in a trusted host.
use serde_json::{Value,json};
use sha2::{Digest as _,Sha256};
use std::collections::{HashMap,HashSet};
use std::sync::{Arc,Mutex,OnceLock};
use crate::{parse_strict,canonical};
// The plain type names describe 2.0.0, the current version; the frozen 1.0.0 types are under v1.
pub use crate::readiness_types::*;
pub use crate::readiness_types_v1 as v1;
type Result<T>=std::result::Result<T,String>;
// Readiness 1.0.0 stays readable and 2.0.0 is the only version encoded (AGENT-BINDING.md section 9).
// A record with a header is read under the version it names; a headerless part is read under 2.0.0.
const KINDS:[&str;9]=["Manifest","Requirements","Snapshot","Binding","Report","Capability","Requirement","Evidence","Check"];
const HEADERED:[&str;5]=["Manifest","Requirements","Snapshot","Binding","Report"];
fn validator(version:&str,kind:&str)->Result<Arc<jsonschema::Validator>>{
 static CACHE:OnceLock<Mutex<HashMap<String,Arc<jsonschema::Validator>>>>=OnceLock::new();
 let id=format!("{version}#{kind}");let mut cache=CACHE.get_or_init(Default::default).lock().unwrap_or_else(|e|e.into_inner());
 if let Some(v)=cache.get(&id){return Ok(v.clone())}
 let mut schema:Value=serde_json::from_str(if version=="1.0.0"{include_str!("readiness.schema-1.0.0.json")}else{include_str!("readiness.schema.json")}).map_err(|e|e.to_string())?;schema["$ref"]=json!(format!("#/$defs/{kind}"));
 let compiled=Arc::new(jsonschema::validator_for(&schema).map_err(|e|e.to_string())?);cache.insert(id,compiled.clone());Ok(compiled)
}
fn key(v:&Value)->String{format!("{}\0{}",v["kind"],v["name"])}
fn unique(v:&Value)->Result<()>{let mut seen=HashSet::new();for item in v.as_array().unwrap(){if !seen.insert(key(item)){return Err("DUPLICATE_CAPABILITY".into())}}Ok(())}
pub fn validate_readiness_value(v:&Value,kind:&str)->Result<Value>{
 if !KINDS.contains(&kind){return Err("INVALID_KIND".into())}
 let copy=parse_strict(&canonical(v).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
 let version=if HEADERED.contains(&kind)&&copy["version"]=="1.0.0"{"1.0.0"}else{"2.0.0"};
 if !validator(version,kind)?.is_valid(&copy){return Err("INVALID_READINESS_MESSAGE".into())}
 match kind{
 "Manifest"|"Requirements"=>unique(&copy["capabilities"] )?,
 "Snapshot"=>{validate_readiness_value(&copy["manifest"],"Manifest")?;unique(&copy["evidence"])?;if copy["validUntilMs"].as_u64()<=copy["observedAtMs"].as_u64(){return Err("INVALID_VALIDITY".into())}for e in copy["evidence"].as_array().unwrap(){if !copy["manifest"]["capabilities"].as_array().unwrap().iter().any(|c|key(c)==key(e)){return Err("UNKNOWN_EVIDENCE".into())}}},
 "Binding"=>{validate_readiness_value(&copy["requirements"],"Requirements")?;},_=>{}}
 Ok(copy)
}
/// Decodes a 1.0.0 or 2.0.0 record; the decoded value keeps the version it was written in.
pub fn decode_readiness(text:&str,kind:&str)->Result<Value>{validate_readiness_value(&parse_strict(text).map_err(|e|e.to_string())?,kind)}
/// Encodes 2.0.0 only; a 1.0.0 record is refused with UNSUPPORTED_VERSION and is never converted.
pub fn encode_readiness(v:&Value,kind:&str)->Result<String>{let copy=validate_readiness_value(v,kind)?;if HEADERED.contains(&kind)&&copy["version"]!="2.0.0"{return Err("UNSUPPORTED_VERSION".into())}canonical(&copy).map_err(|e|e.to_string())}
fn hash(text:&str)->String{format!("{:x}",Sha256::digest(text.as_bytes()))}
/// Digest of the canonical manifest of either version, so pins taken under 1.0.0 stay checkable.
pub fn manifest_digest(v:&Value)->Result<String>{Ok(hash(&canonical(&validate_readiness_value(v,"Manifest")?).map_err(|e|e.to_string())?))}
/// Evaluates 1.0.0 inputs only and returns a 1.0.0 report (`v1::Report` as JSON); 2.0.0 inputs are refused with UNSUPPORTED_VERSION.
pub fn evaluate_readiness(snapshot:&Value,requirements:&Value,now_ms:u64,expected:Option<&str>)->Result<Value>{
 let s=validate_readiness_value(snapshot,"Snapshot")?;let r=validate_readiness_value(requirements,"Requirements")?;
 if s["version"]!="1.0.0"||r["version"]!="1.0.0"{return Err("UNSUPPORTED_VERSION".into())}
 if now_ms>9007199254740991{return Err("INVALID_TIME".into())}if let Some(d)=expected{if d.len()!=64||!d.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b)){return Err("INVALID_DIGEST".into())}}
 let digest=manifest_digest(&s["manifest"])?;let agent=s["manifest"]["agentId"]==r["agentId"];let pin=expected.is_none_or(|d|d==digest);let fresh=s["observedAtMs"].as_u64().unwrap()<=now_ms&&now_ms<s["validUntilMs"].as_u64().unwrap();
 let mut checks=vec![];
 for req in r["capabilities"].as_array().unwrap(){
  let c=s["manifest"]["capabilities"].as_array().unwrap().iter().find(|c|key(c)==key(req));let e=s["evidence"].as_array().unwrap().iter().find(|e|key(e)==key(req));
  let observed=match c{None=>"MISSING",Some(v) if v["supported"]==true=>"SUPPORTED",_=>"UNSUPPORTED"};
  let status=if !fresh{"STALE"}else if c.is_none(){"MISSING"}else if c.unwrap()["supported"]!=true{"UNSUPPORTED"}else if req["assurance"]=="VERIFIED"&&e.is_none(){"UNVERIFIED"}else if req["assurance"]=="VERIFIED"&&e.unwrap()["validUntilMs"].as_u64().unwrap()<=now_ms{"EVIDENCE_EXPIRED"}else{"SATISFIED"};
  let fix=match status{"MISSING"=>"Install an agent declaring this capability.","UNSUPPORTED"=>"Select an agent that supports this requirement.","UNVERIFIED"=>"Obtain independent host verification.","EVIDENCE_EXPIRED"=>"Refresh independent host verification.","STALE"=>"Refresh the host capability snapshot.",_=>""};
  checks.push(json!({"requirement":req,"observed":observed,"status":status,"evidenceRef":e.map(|v|v["evidenceRef"].clone()),"remediation":fix}));
 }
 let mut reasons=vec![];if !agent{reasons.push("Selected agent does not match requirements.")}if !pin{reasons.push("Effective capability manifest changed; review a new binding.")}if !fresh{reasons.push("Host capability snapshot is stale or from the future.")}if checks.iter().any(|c|c["status"]!="SATISFIED"){reasons.push("One or more requirements are not satisfied.")}
 Ok(json!({"profile":"aiws-readiness/1","version":"1.0.0","agentId":s["manifest"]["agentId"],"manifestDigest":digest,"requirementsDigest":hash(&canonical(&r).map_err(|e|e.to_string())?),"expectedManifestDigest":expected,"evaluatedAtMs":now_ms,"status":if reasons.is_empty(){"READY"}else{"BLOCKED"},"authorized":false,"agentMatches":agent,"pinMatches":pin,"fresh":fresh,"reasons":reasons,"checks":checks}))
}
