use std::io::{self,Read};
use serde_json::{Value,json};
use aiws_sdk::access_policy::*;
fn main(){let mut s=String::new();io::stdin().read_to_string(&mut s).unwrap();let f:Value=serde_json::from_str(&s).unwrap();let cases:Vec<Value>=f["cases"].as_array().unwrap().iter().map(|c|{let kind=c["kind"].as_str().unwrap();match decode_access_policy(c["raw"].as_str().unwrap(),kind){Ok(v)=>json!({"valid":true,"canonical":encode_access_policy(&v,kind).unwrap(),"digest":access_policy_digest(&v,kind).unwrap()}),Err(_)=>json!({"valid":false,"canonical":null,"digest":null})}}).collect();println!("{}",json!({"cases":cases}));}
