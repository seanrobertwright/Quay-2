//! Experimental dynamic controls: persist exact requests, correlate replies, retain unknown outcomes.
use serde::{Serialize,Deserialize};
use serde_json::{Value,json};
use crate::{parse_strict,canonical};
pub const PROFILE:&str="aiws-dynamic-controls/1";
pub const VERSION:&str="1.0.0";
#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct DynamicContext {pub installation_id:String,pub namespace:String,pub epoch:u64,pub auth_epoch:String}
pub type ClientResult<T>=std::result::Result<T,String>;
fn limits(v:&Value,depth:usize,nodes:&mut usize)->ClientResult<()> {
 *nodes+=1;if *nodes>100000||depth>64{return Err("INPUT_LIMIT".into())}
 match v {Value::Array(a)=>{if a.len()>1024{return Err("INPUT_LIMIT".into())}for x in a {limits(x,depth+1,nodes)?;}},Value::Object(a)=>{if a.len()>4096{return Err("INPUT_LIMIT".into())}for x in a.values(){limits(x,depth+1,nodes)?;}},_=>{}} Ok(())
}
pub fn decode_dynamic(text:&str,kind:&str)->ClientResult<Value>{
 if !["Request","Response","Command"].contains(&kind){return Err("INVALID_KIND".into())}
 let v=parse_strict(text).map_err(|e|e.to_string())?;limits(&v,0,&mut 0)?;
 let mut schema:Value=serde_json::from_str(include_str!("dynamic-controls.schema.json")).map_err(|e|e.to_string())?;
 schema["$ref"]=json!(format!("#/$defs/{kind}"));
 let validator=jsonschema::validator_for(&schema).map_err(|e|e.to_string())?;
 if !validator.is_valid(&v){return Err("INVALID_DYNAMIC_MESSAGE".into())} Ok(v)
}
pub fn encode_dynamic(value:&Value,kind:&str)->ClientResult<String>{let text=canonical(value).map_err(|e|e.to_string())?;decode_dynamic(&text,kind)?;Ok(text)}
pub fn dynamic_request(context:&DynamicContext,operation:&str,payload:&Value,request_id:&str)->ClientResult<Value>{
 let mut v=serde_json::to_value(context).map_err(|e|e.to_string())?;let m=v.as_object_mut().unwrap();
 m.insert("profile".into(),json!(PROFILE));m.insert("version".into(),json!(VERSION));m.insert("operation".into(),json!(operation));m.insert("requestId".into(),json!(request_id));
 for(k,value)in payload.as_object().ok_or("PAYLOAD_REQUIRED")? {if m.contains_key(k){return Err("PAYLOAD_OVERRIDE".into())}m.insert(k.clone(),value.clone());}
 decode_dynamic(&encode_dynamic(&v,"Request")?,"Request")
}
pub struct DynamicClient<T:Fn(&str,&str)->ClientResult<String>>{pub context:DynamicContext,pub transport:T}
impl<T:Fn(&str,&str)->ClientResult<String>> DynamicClient<T>{
 pub fn prepare(&self,operation:&str,payload:&Value,request_id:&str)->ClientResult<Value>{dynamic_request(&self.context,operation,payload,request_id)}
 pub fn send(&self,prepared:&Value)->ClientResult<Value>{
  let body=encode_dynamic(prepared,"Request")?;
  let result=decode_dynamic(&(self.transport)("/engine/dynamic/v1/requests",&body)?,"Response")?;
  if result["requestId"]!=prepared["requestId"]{return Err("RESPONSE_MISMATCH".into())}Ok(result)
 }
}
pub fn https_transport(origin:&str,ca_pem:&[u8],authorization:impl Fn()->String+'static)->ClientResult<impl Fn(&str,&str)->ClientResult<String>>{
 let url=reqwest::Url::parse(origin).map_err(|_|"INVALID_ORIGIN")?;
 if url.scheme()!="https"||url.host_str()!=Some("127.0.0.1")||url.path()!="/"||url.query().is_some()||url.fragment().is_some()||!url.username().is_empty()||url.password().is_some(){return Err("LOOPBACK_TLS_REQUIRED".into())}
 let client=reqwest::blocking::Client::builder().no_proxy().tls_built_in_root_certs(false).add_root_certificate(reqwest::Certificate::from_pem(ca_pem).map_err(|_|"INVALID_CA")?).min_tls_version(reqwest::tls::Version::TLS_1_3).redirect(reqwest::redirect::Policy::none()).timeout(std::time::Duration::from_secs(15)).build().map_err(|_|"TLS_CLIENT_FAILED")?;
 Ok(move|path:&str,body:&str|{
  use std::io::Read;
  if path!="/engine/dynamic/v1/requests"{return Err("INVALID_PATH".into())}
  let token=authorization();if token.is_empty()||token.contains(['\r','\n']){return Err("INVALID_CREDENTIAL".into())}
  let response=client.post(url.join(path).map_err(|_|"INVALID_PATH")?).header("Authorization",token).header("Content-Type","application/json").body(body.to_owned()).send().map_err(|_|"RESPONSE_UNKNOWN_RETRY_IDENTICAL_REQUEST")?;
  let mut bytes=Vec::new();response.take(1048577).read_to_end(&mut bytes).map_err(|_|"RESPONSE_UNKNOWN_RETRY_IDENTICAL_REQUEST")?;
  if bytes.len()>1048576{return Err("INPUT_LIMIT".into())}String::from_utf8(bytes).map_err(|_|"INVALID_UTF8".into())
 })
}
