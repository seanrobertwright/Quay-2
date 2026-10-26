use std::io::{self,Read};
use serde_json::{Value,json};
use aiws_sdk::dynamic_controls::{decode_dynamic,encode_dynamic};
fn main(){let mut input=String::new();io::stdin().read_to_string(&mut input).unwrap();let fixtures:Value=serde_json::from_str(&input).unwrap();let results:Vec<Value>=fixtures["cases"].as_array().unwrap().iter().map(|c|match decode_dynamic(c["raw"].as_str().unwrap(),c["kind"].as_str().unwrap()){Ok(v)=>json!({"valid":true,"canonical":encode_dynamic(&v,c["kind"].as_str().unwrap()).unwrap()}),Err(_)=>json!({"valid":false,"canonical":null})}).collect();println!("{}",serde_json::to_string(&results).unwrap());}
