//! Portable protocol correlation records.
//! They correlate identity; they never grant authority or implement protocol wire behavior.
//! Deserializing takes an exact key set: an unknown key or a missing one, including a null-able one, is refused.
use serde::{Deserialize,Deserializer,Serialize};
use serde_json::{Map,Value};
use std::sync::OnceLock;

#[derive(Debug,Clone,PartialEq,Eq,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProtocolBindingRef{
    #[serde(rename="bindingId")] pub binding_id:String,
    #[serde(rename="bindingRevision")] pub binding_revision:String,
    pub protocol:String,
    #[serde(rename="protocolVersion")] pub protocol_version:String,
    #[serde(rename="manifestDigest")] pub manifest_digest:String,
    #[serde(rename="capabilityDigest")] pub capability_digest:String,
}
#[derive(Debug,Clone,PartialEq,Eq,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProtocolOperationRef{
    #[serde(rename="workOrderId")] pub work_order_id:String,
    #[serde(rename="runId")] pub run_id:String,
    #[serde(rename="taskId",deserialize_with="present")] pub task_id:Option<String>,
    #[serde(rename="operationId")] pub operation_id:String,
    #[serde(rename="attemptId")] pub attempt_id:String,
    #[serde(rename="remoteIdentityRef",deserialize_with="present")] pub remote_identity_ref:Option<String>,
    #[serde(rename="remoteOperationId",deserialize_with="present")] pub remote_operation_id:Option<String>,
}
#[derive(Debug,Clone,PartialEq,Eq,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProtocolCorrelation{
    pub profile:String,
    pub binding:ProtocolBindingRef,
    pub operation:ProtocolOperationRef,
    pub authoritative:bool,
}
fn id(v:&str)->bool{
    let mut chars=v.chars();match chars.next(){Some(c) if c.is_ascii_alphanumeric()=>{},_=>return false}
    v.len()<=256&&chars.all(|c|c.is_ascii_alphanumeric()||"._:/-".contains(c))
}
fn decimal(v:&str)->bool{
    if v=="0"{return true}if v.is_empty()||v.len()>100||v.starts_with('0'){return false}v.bytes().all(|b|b.is_ascii_digit())
}
fn digest(v:&str)->bool{v.len()==64&&v.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b))}
fn version(v:&str)->bool{
    let mut chars=v.chars();match chars.next(){Some(c) if c.is_ascii_alphanumeric()=>{},_=>return false}
    v.len()<=64&&chars.all(|c|c.is_ascii_alphanumeric()||"._+-".contains(c))
}
fn remote(v:&str)->bool{!v.is_empty()&&v.len()<=2048&&v.chars().all(|c|!c.is_control())}
/// A field with deserialize_with has no implicit default, so a missing null-able key is refused.
fn present<'de,D:Deserializer<'de>>(d:D)->Result<Option<String>,D::Error>{Option::deserialize(d)}
fn closed<'a>(v:&'a Value,keys:&[&str])->Result<&'a Map<String,Value>,String>{
    let o=v.as_object().ok_or_else(||String::from("INVALID_PROTOCOL_CORRELATION"))?;
    if o.len()!=keys.len()||!keys.iter().all(|k|o.contains_key(*k)){return Err("INVALID_PROTOCOL_CORRELATION".into())}
    Ok(o)
}
fn text<'a>(v:&'a Value,valid:fn(&str)->bool,code:&str)->Result<&'a str,String>{v.as_str().filter(|x|valid(x)).ok_or_else(||code.into())}
fn remote_value(v:&Value)->Result<(),String>{
    if v.is_null()||v.as_str().is_some_and(remote){Ok(())}else{Err("INVALID_PROTOCOL_REMOTE_IDENTITY".into())}
}
/// Checks in record order, as TypeScript and Python do: the outer record, then binding (protocol, revision, version,
/// digests, bindingId), then operation (identifiers, then remote references). The shared schema is the final gate.
fn checked(value:&Value)->Result<(),String>{
    let v=closed(value,&["profile","binding","operation","authoritative"])?;
    if v["profile"]!="aiws-protocol-correlation/1"||v["authoritative"]!=false{return Err("INVALID_PROTOCOL_CORRELATION".into())}
    let b=closed(&v["binding"],&["bindingId","bindingRevision","protocol","protocolVersion","manifestDigest","capabilityDigest"])?;
    text(&b["protocol"],|x|matches!(x,"MCP"|"A2A"|"AG_UI"),"INVALID_PROTOCOL_FAMILY")?;
    text(&b["bindingRevision"],decimal,"INVALID_PROTOCOL_BINDING_REVISION")?;
    text(&b["protocolVersion"],version,"INVALID_PROTOCOL_VERSION")?;
    text(&b["manifestDigest"],digest,"INVALID_PROTOCOL_DIGEST")?;text(&b["capabilityDigest"],digest,"INVALID_PROTOCOL_DIGEST")?;
    text(&b["bindingId"],id,"INVALID_PROTOCOL_CORRELATION_ID")?;
    let o=closed(&v["operation"],&["workOrderId","runId","taskId","operationId","attemptId","remoteIdentityRef","remoteOperationId"])?;
    for key in ["workOrderId","runId","taskId","operationId","attemptId"]{
        if !(key=="taskId"&&o[key].is_null()){text(&o[key],id,"INVALID_PROTOCOL_CORRELATION_ID")?;}
    }
    remote_value(&o["remoteIdentityRef"])?;remote_value(&o["remoteOperationId"])?;
    static SCHEMA:OnceLock<jsonschema::Validator>=OnceLock::new();
    let schema=SCHEMA.get_or_init(||jsonschema::validator_for(&serde_json::from_str(include_str!("protocol-correlation.schema.json")).unwrap()).expect("bundled schema"));
    if schema.is_valid(value){Ok(())}else{Err("INVALID_PROTOCOL_CORRELATION".into())}
}
impl ProtocolCorrelation{
    /// Checks a decoded JSON record with the same codes and order as TypeScript and Python `validateProtocolCorrelation`.
    pub fn from_value(value:Value)->Result<Self,String>{
        checked(&value)?;serde_json::from_value(value).map_err(|_|"INVALID_PROTOCOL_CORRELATION".into())
    }
}
pub fn validate_protocol_correlation(v:&ProtocolCorrelation)->Result<ProtocolCorrelation,String>{
    checked(&serde_json::to_value(v).map_err(|_|String::from("INVALID_PROTOCOL_CORRELATION"))?)?;Ok(v.clone())
}
pub fn protocol_correlation(binding:ProtocolBindingRef,operation:ProtocolOperationRef)->Result<ProtocolCorrelation,String>{
    validate_protocol_correlation(&ProtocolCorrelation{profile:"aiws-protocol-correlation/1".into(),binding,operation,authoritative:false})
}
