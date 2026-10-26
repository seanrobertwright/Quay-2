//! Credentials and the persisted request arrive through protected stdin, never argv.
use std::{io::{self,Read},env,fs};
use serde_json::Value;
use aiws_sdk::dynamic_controls::{DynamicClient,DynamicContext,https_transport};
fn main()->Result<(),String>{
 let args:Vec<String>=env::args().collect();if args.len()!=3{return Err("HTTPS_ORIGIN CA_FILE required".into())}
 let mut text=String::new();io::stdin().take(1056768).read_to_string(&mut text).map_err(|_|"STDIN_FAILED")?;
 let value:Value=serde_json::from_str(&text).map_err(|_|"INVALID_INPUT")?;
 let request=&value["request"];let token=value["authorization"].as_str().ok_or("CREDENTIAL_REQUIRED")?.to_owned();
 let context=DynamicContext{installation_id:request["installationId"].as_str().ok_or("CONTEXT_REQUIRED")?.into(),namespace:request["namespace"].as_str().ok_or("CONTEXT_REQUIRED")?.into(),epoch:request["epoch"].as_u64().ok_or("CONTEXT_REQUIRED")?,auth_epoch:request["authEpoch"].as_str().ok_or("CONTEXT_REQUIRED")?.into()};
 let client=DynamicClient{context,transport:https_transport(&args[1],&fs::read(&args[2]).map_err(|_|"CA_REQUIRED")?,move||token.clone())?};
 println!("{}",client.send(request)?);Ok(())
}
