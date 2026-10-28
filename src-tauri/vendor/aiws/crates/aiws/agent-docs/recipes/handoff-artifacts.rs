use aiws_sdk::{Result,handoff_store::{ArtifactProvider,FileArtifacts}};
use serde_json::json;
use std::time::{SystemTime,UNIX_EPOCH};
fn main()->Result<()> {
    let root=std::env::temp_dir().join(format!("aiws-material-example-{}-{}",std::process::id(),SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
    let provider=FileArtifacts::new(root.to_str().unwrap())?;
    // The retention owner keeps these bytes available; there is no deletion scheduler.
    let reference=provider.put(b"reviewed output","output:1","text/plain","owner:operator","4102444800000",None)?;
    assert_eq!(provider.read(&reference)?,b"reviewed output");
    let mut changed=reference.clone();changed["sizeBytes"]=json!("1");
    assert_eq!(provider.read(&changed).unwrap_err().code,"ARTIFACT_MISMATCH");
    std::fs::remove_dir_all(root).unwrap(); // Demo cleanup, never a production retention policy.
    println!("PASS: handoff-artifacts");Ok(())
}

