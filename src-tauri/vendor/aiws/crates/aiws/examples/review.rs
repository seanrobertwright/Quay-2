use aiws_sdk::runtime::*;
use aiws_sdk::sqlite::SqliteStore;
use aiws_sdk::*;
use serde_json::{json, Value};
struct DemoIdentity;
impl Authorizer for DemoIdentity {
    fn authorize(&mut self, _: &Command, _: &Snapshot, _: &str) -> Result<Authorization> {
        Ok(Authorization {
            allowed: true,
            policy: "ALLOW".into(),
            mandatory_checks_ok: true,
            context: json!({"actor":"demo:operator","policyRevision":"policy:1","decisionClass":"DETERMINISTIC"}),
        })
    }
}
struct Fixed;
impl Clock for Fixed {
    fn now_ms(&self) -> String {
        "10".into()
    }
}
struct LocalReview(std::path::PathBuf);
impl EffectAdapter for LocalReview {
    fn execute(&mut self, operation: &Value, _: &Value) -> Result<Outcome> {
        use std::io::Write;
        let mut file = std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&self.0)
            .map_err(|_| error("FILE_ERROR"))?;
        file.write_all(canonical(&operation["action"]["payload"])?.as_bytes())
            .map_err(|_| error("FILE_ERROR"))?;
        file.sync_all().map_err(|_| error("FILE_ERROR"))?;
        Ok(Outcome {
            effect: "CONFIRMED_APPLIED".into(),
            actual_cost: "3".into(),
        })
    }
    fn reconcile(&mut self, operation: &Value, _: &Value) -> Result<Outcome> {
        let effect = if std::fs::read_to_string(&self.0).ok()
            == Some(canonical(&operation["action"]["payload"])?)
        {
            "CONFIRMED_APPLIED"
        } else {
            "UNKNOWN"
        };
        Ok(Outcome {
            effect: effect.into(),
            actual_cost: "3".into(),
        })
    }
}
fn main() -> std::result::Result<(), Box<dyn std::error::Error>> {
    let demo: Value = serde_json::from_str(include_str!("review.json"))?;
    let directory = std::env::temp_dir().join(format!(
        "aiws-review-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_nanos()
    ));
    std::fs::create_dir(&directory)?;
    let store = SqliteStore::open(
        directory.join("mission.db").to_str().unwrap(),
        Some(&Contract::from_value(demo["contract"].clone())?),
    )?;
    let mut c = Coordinator::new(store, DemoIdentity, Fixed);
    let mut adapter = LocalReview(directory.join("review.txt"));
    for raw in demo["commands"].as_array().unwrap() {
        let command = Command::from_value(raw.clone())?;
        if raw["type"] == "dispatch" {
            c.dispatch(
                raw["attemptId"].as_str().unwrap(),
                &mut adapter,
                raw["nodeId"].as_str(),
            )?;
        } else {
            c.apply(&command, None)?;
        }
    }
    println!(
        "{}",
        json!({"directory":directory,"result":assess_success(&c.store.snapshot()?,"r")?})
    );
    std::fs::write(directory.join("audit.json"), c.store.export_audit()?)?;
    Ok(())
}
