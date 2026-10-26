//! Advisory evaluation only; input claims do not authenticate a host or authorize execution.
use std::io::{self,Read};
use aiws_sdk::{parse_strict,readiness::evaluate_readiness};
fn main()->Result<(),String>{let mut text=String::new();io::stdin().take(1048577).read_to_string(&mut text).map_err(|e|e.to_string())?;let v=parse_strict(&text).map_err(|e|e.to_string())?;let report=evaluate_readiness(&v["snapshot"],&v["requirements"],v["nowMs"].as_u64().ok_or("INVALID_TIME")?,v["expectedManifestDigest"].as_str())?;println!("{}",serde_json::to_string_pretty(&report).unwrap());Ok(())}
