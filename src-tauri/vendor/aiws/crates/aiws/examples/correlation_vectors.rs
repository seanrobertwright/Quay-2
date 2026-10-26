//! Reads spec/protocol-correlation-v1/fixtures.json on stdin and prints, for each case, whether this SDK accepts the
//! record and the record or error code it returns, for scripts/protocol-correlation-parity.mjs to compare across SDKs.
use std::io::{self,Read};
use serde_json::{Value,json};
use aiws_sdk::ProtocolCorrelation;
fn main(){
    let mut input=String::new();io::stdin().read_to_string(&mut input).unwrap();
    let fixtures:Value=serde_json::from_str(&input).unwrap();
    let results:Vec<Value>=fixtures["cases"].as_array().unwrap().iter().map(|c|{
        match ProtocolCorrelation::from_value(c["value"].clone()){Ok(v)=>json!({"valid":true,"record":v}),Err(code)=>json!({"valid":false,"error":code})}
    }).collect();
    println!("{}",serde_json::to_string(&results).unwrap());
}
