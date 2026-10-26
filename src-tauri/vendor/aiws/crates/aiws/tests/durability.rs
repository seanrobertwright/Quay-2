use aiws_sdk::runtime::*;
use aiws_sdk::sqlite::{import_audit, SqliteStore};
use aiws_sdk::*;
use serde_json::{json, Value};
fn fixture() -> Value {
    serde_json::from_str::<Value>(include_str!("fixtures.json")).unwrap()[0].clone()
}
#[test]
fn rollback_cas_reopen_and_export() {
    let f = fixture();
    let c = Contract::from_value(f["contract"].clone()).unwrap();
    let path = std::env::temp_dir().join(format!(
        "aiws-{}-{}.db",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let p = path.to_str().unwrap();
    let mut store = SqliteStore::open(p, Some(&c)).unwrap();
    let mut peer = SqliteStore::open(p, None).unwrap();
    let cmd = Command::from_value(f["steps"][0]["command"].clone()).unwrap();
    assert_eq!(
        store
            .apply_with_hook(&cmd, "10", Some("0"), || Err(error("CRASH")))
            .unwrap_err()
            .code,
        "CRASH"
    );
    assert_eq!(peer.snapshot().unwrap().as_value()["revision"], "0");
    store.apply(&cmd, "10", Some("0")).unwrap();
    assert_eq!(
        peer.apply(&cmd, "10", Some("0")).unwrap_err().code,
        "REVISION_CONFLICT"
    );
    drop(store);
    drop(peer);
    let store = SqliteStore::open(p, None).unwrap();
    assert_eq!(
        store.snapshot().unwrap().as_value()["runs"]["r"]["state"],
        "READY"
    );
    assert_eq!(
        import_audit(&store.export_audit().unwrap()).unwrap(),
        store.snapshot().unwrap()
    );
    let db = rusqlite::Connection::open(p).unwrap();
    db.execute("UPDATE journal SET digest='tampered' WHERE seq=1", [])
        .unwrap();
    assert_eq!(store.snapshot().unwrap_err().code, "JOURNAL_INTEGRITY");
    drop(db);
    drop(store);
    std::fs::remove_file(path).unwrap();
}
struct Allow;
impl Authorizer for Allow {
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
struct Lost(usize);
impl EffectAdapter for Lost {
    fn execute(&mut self, _: &Value, _: &Value) -> Result<Outcome> {
        self.0 += 1;
        Err(error("LOST_RESPONSE"))
    }
    fn reconcile(&mut self, _: &Value, _: &Value) -> Result<Outcome> {
        Ok(Outcome {
            effect: "CONFIRMED_APPLIED".into(),
            actual_cost: "3".into(),
        })
    }
}
#[test]
fn lost_response_recovers_without_redispatch() {
    let f = fixture();
    let store = SqliteStore::open(
        ":memory:",
        Some(&Contract::from_value(f["contract"].clone()).unwrap()),
    )
    .unwrap();
    let mut c = Coordinator::new(store, Allow, Fixed);
    let mut adapter = Lost(0);
    for step in f["steps"].as_array().unwrap().iter().take(3) {
        c.apply(&Command::from_value(step["command"].clone()).unwrap(), None)
            .unwrap();
    }
    assert_eq!(
        c.dispatch("a", &mut adapter, None).unwrap().as_value()["reserved"],
        "10"
    );
    assert_eq!(c.recover("r", "recovered").unwrap().1, vec!["a"]);
    assert_eq!(adapter.0, 1);
    assert_eq!(
        c.dispatch("a", &mut adapter, None).unwrap_err().code,
        "ATTEMPT_STATE"
    );
    assert_eq!(adapter.0, 1);
    assert_eq!(
        c.reconcile("a", &mut adapter).unwrap().as_value()["reserved"],
        "0"
    );
    assert!(Command::from_value(json!({"type":"unknown"})).is_err());
}
struct Decide(bool, Value);
impl Authorizer for Decide {
    fn authorize(&mut self, _: &Command, _: &Snapshot, _: &str) -> Result<Authorization> {
        Ok(Authorization {
            allowed: self.0,
            policy: if self.0 { "ALLOW" } else { "DENY" }.into(),
            mandatory_checks_ok: true,
            context: self.1.clone(),
        })
    }
}
struct Reads(usize);
impl EffectAdapter for Reads {
    fn execute(&mut self, _: &Value, _: &Value) -> Result<Outcome> {
        Err(error("LOST_RESPONSE"))
    }
    fn reconcile(&mut self, _: &Value, _: &Value) -> Result<Outcome> {
        self.0 += 1;
        Ok(Outcome {
            effect: "CONFIRMED_APPLIED".into(),
            actual_cost: "3".into(),
        })
    }
}
struct At(&'static str);
impl Clock for At {
    fn now_ms(&self) -> String {
        self.0.into()
    }
}
/// Admits attempt `a` and dispatches it through an allowing coordinator. Its response is lost, so a reconcile is due.
/// Returns the store and its revision.
fn lost_attempt(adapter: &mut Reads) -> (SqliteStore, Value) {
    let f = fixture();
    let store = SqliteStore::open(
        ":memory:",
        Some(&Contract::from_value(f["contract"].clone()).unwrap()),
    )
    .unwrap();
    let mut c = Coordinator::new(store, Allow, Fixed);
    for step in f["steps"].as_array().unwrap().iter().take(3) {
        c.apply(&Command::from_value(step["command"].clone()).unwrap(), None)
            .unwrap();
    }
    c.dispatch("a", adapter, None).unwrap();
    let revision = c.store.snapshot().unwrap().as_value()["revision"].clone();
    (c.store, revision)
}
/// Each rejection the store's diagnostics hold, as its time and command.
fn rejections(store: &SqliteStore) -> Vec<Value> {
    store
        .diagnostics()
        .unwrap()
        .as_array()
        .unwrap()
        .iter()
        .map(|d| json!([d["at"], d["command"]]))
        .collect()
}
#[test]
fn denied_or_unattributed_reconcile_is_recorded() {
    let ctx = json!({"actor":"demo:operator","policyRevision":"policy:1","decisionClass":"DETERMINISTIC"});
    let mut adapter = Reads(0);
    let (store, revision) = lost_attempt(&mut adapter);
    let mut deny = Coordinator::new(store, Decide(false, ctx.clone()), At("11"));
    assert_eq!(
        deny.reconcile("a", &mut adapter).unwrap_err().code,
        "AUTHORITY_DENIED"
    );
    let mut anonymous = Coordinator::new(
        deny.store,
        Decide(true, json!({"decisionClass":"DETERMINISTIC"})),
        At("12"),
    );
    assert_eq!(
        anonymous.reconcile("a", &mut adapter).unwrap_err().code,
        "ATTRIBUTION_REQUIRED"
    );
    assert_eq!(
        rejections(&anonymous.store),
        vec![
            json!(["11",{"type":"commandRejected","code":"AUTHORITY_DENIED","rejectedType":"settle","context":ctx,"attemptId":"a"}]),
            json!(["12",{"type":"commandRejected","code":"ATTRIBUTION_REQUIRED","rejectedType":"settle","attemptId":"a"}]),
        ]
    );
    assert_eq!(adapter.0, 0);
    assert_eq!(
        anonymous.store.snapshot().unwrap().as_value()["revision"],
        revision
    );
}
struct Unavailable;
impl Authorizer for Unavailable {
    fn authorize(&mut self, _: &Command, _: &Snapshot, _: &str) -> Result<Authorization> {
        Err(error("AUTHORIZER_UNAVAILABLE"))
    }
}
#[test]
fn failed_authorizer_reconcile_is_recorded_as_apply_records_it() {
    let mut adapter = Reads(0);
    let (store, revision) = lost_attempt(&mut adapter);
    let settle = Command::from_value(
        json!({"type":"settle","attemptId":"a","effect":"UNKNOWN","actualCost":"0"}),
    )
    .unwrap();
    let mut applying = Coordinator::new(store, Unavailable, At("11"));
    assert_eq!(
        applying.apply(&settle, None).unwrap_err().code,
        "AUTHORIZATION_ERROR"
    );
    let mut reconciling = Coordinator::new(applying.store, Unavailable, At("12"));
    assert_eq!(
        reconciling.reconcile("a", &mut adapter).unwrap_err().code,
        "AUTHORIZATION_ERROR"
    );
    assert_eq!(
        rejections(&reconciling.store),
        vec![
            json!(["11",{"type":"commandRejected","code":"AUTHORIZATION_ERROR","rejectedType":"settle","attemptId":"a"}]),
            json!(["12",{"type":"commandRejected","code":"AUTHORIZATION_ERROR","rejectedType":"settle","attemptId":"a"}]),
        ]
    );
    assert_eq!(adapter.0, 0);
    assert_eq!(
        reconciling.store.snapshot().unwrap().as_value()["revision"],
        revision
    );
}
