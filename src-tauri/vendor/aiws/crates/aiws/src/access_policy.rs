//! Experimental 4A contract codec; no authorization or OS enforcement.
use serde_json::{Value,json};
use sha2::{Digest,Sha256};
use std::collections::HashSet;
use crate::{parse_strict,canonical};
pub use crate::access_policy_types::*;
type Result<T>=std::result::Result<T,String>;
fn key(v:&Value)->String{format!("{}:{}",v["kind"],v["resource"])}
fn unique(v:&Value,identity:fn(&Value)->String)->Result<()>{let mut seen=HashSet::new();for x in v.as_array().unwrap(){if !seen.insert(identity(x)){return Err("DUPLICATE_ACCESS_ENTRY".into())}}Ok(())}
pub fn validate_access_policy(value:&Value,kind:&str)->Result<Value>{
 let mut schema:Value=serde_json::from_str(include_str!("access-policy.schema.json")).unwrap();
 if schema["$defs"].get(kind).is_none(){return Err("INVALID_KIND".into())}schema["$ref"]=json!(format!("#/$defs/{kind}"));
 let v=parse_strict(&canonical(value).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
 if !jsonschema::validator_for(&schema).map_err(|e|e.to_string())?.is_valid(&v){return Err("INVALID_ACCESS_POLICY".into())}
 match kind{
  "Policy"=>unique(&v["grants"],key)?,
  "NodeAccess"=>unique(&v["requirements"],key)?,
  "WorkflowAccess"=>{
   validate_access_policy(&v["policy"],"Policy")?;unique(&v["nodes"],|n|n["taskId"].as_str().unwrap().to_string())?;
   for node in v["nodes"].as_array().unwrap(){validate_access_policy(node,"NodeAccess")?;for req in node["requirements"].as_array().unwrap(){
    let grant=v["policy"]["grants"].as_array().unwrap().iter().find(|g|key(g)==key(req));
    if grant.is_none()||req["actions"].as_array().unwrap().iter().any(|a|!grant.unwrap()["actions"].as_array().unwrap().contains(a)){return Err("ACCESS_EXCEEDS_WORKFLOW".into())}
   }}
  },_=>{}
 }
 Ok(v)
}
pub fn decode_access_policy(text:&str,kind:&str)->Result<Value>{validate_access_policy(&parse_strict(text).map_err(|e|e.to_string())?,kind)}
pub fn encode_access_policy(value:&Value,kind:&str)->Result<String>{canonical(&validate_access_policy(value,kind)?).map_err(|e|e.to_string())}
pub fn access_policy_digest(value:&Value,kind:&str)->Result<String>{Ok(format!("{:x}",Sha256::digest(encode_access_policy(value,kind)?.as_bytes())))}
