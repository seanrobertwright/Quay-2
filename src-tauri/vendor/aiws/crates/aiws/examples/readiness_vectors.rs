use std::io::{self,Read};
use serde_json::{Value,json};
use aiws_sdk::canonical;
use aiws_sdk::readiness::*;
// Reads {"v1":<1.0.0 fixtures>,"v2":<2.0.0 fixtures>} and prints the SDK version and what it decodes, encodes and
// evaluates, for scripts/readiness-parity.mjs to compare across the three SDKs.
fn case(c:&Value)->Value{
 let kind=c["kind"].as_str().unwrap();
 match decode_readiness(c["raw"].as_str().unwrap(),kind){
  Ok(v)=>{let (encoded,encode_error)=match encode_readiness(&v,kind){Ok(t)=>(json!(t),Value::Null),Err(e)=>(Value::Null,json!(e))};json!({"valid":true,"canonical":canonical(&v).unwrap(),"error":null,"encoded":encoded,"encodeError":encode_error})}
  Err(e)=>json!({"valid":false,"canonical":null,"error":e,"encoded":null,"encodeError":null})}
}
fn cases(f:&Value)->Vec<Value>{f["cases"].as_array().unwrap().iter().map(case).collect()}
fn main(){
 let mut s=String::new();io::stdin().read_to_string(&mut s).unwrap();let f:Value=serde_json::from_str(&s).unwrap();
 let scenarios:Vec<Value>=f["v1"]["scenarios"].as_array().unwrap().iter().map(|c|evaluate_readiness(&c["snapshot"],&c["requirements"],c["nowMs"].as_u64().unwrap(),c["expectedManifestDigest"].as_str()).unwrap()).collect();
 println!("{}",json!({"sdkVersion":env!("CARGO_PKG_VERSION"),"v1":{"cases":cases(&f["v1"]),"scenarios":scenarios},"v2":{"cases":cases(&f["v2"])}}));
}
