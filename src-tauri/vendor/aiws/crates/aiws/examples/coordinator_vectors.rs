//! Reads the reconciliation scenario of scripts/coordinator-parity.mjs on stdin, replays it through this SDK's
//! Coordinator and prints what each reconcile call returned, what the authorizer was asked, the diagnostics and the
//! final state digest, for the script to compare across SDKs.
use aiws_sdk::runtime::*;
use aiws_sdk::sqlite::SqliteStore;
use aiws_sdk::*;
use serde_json::{json, Value};
use std::cell::{Cell, RefCell};
use std::io::{self, Read};
use std::rc::Rc;
/// Returns the scenario's current decision, or fails when it has none, and logs each request it is asked to decide.
struct Scripted {
    decision: Rc<RefCell<Value>>,
    asked: Rc<RefCell<Vec<Value>>>,
}
impl Authorizer for Scripted {
    fn authorize(&mut self, command: &Command, _: &Snapshot, now: &str) -> Result<Authorization> {
        self.asked
            .borrow_mut()
            .push(json!([now, command.as_value()]));
        let d = self.decision.borrow();
        if d.is_null() {
            return Err(error("AUTHORIZER_UNAVAILABLE"));
        }
        Ok(Authorization {
            allowed: d["allowed"] == true,
            policy: d["policy"].as_str().unwrap().into(),
            mandatory_checks_ok: d["mandatoryChecksOk"] == true,
            context: d["context"].clone(),
        })
    }
}
/// Advances by one millisecond on every reading, so a reading more or fewer than another SDK shows in every later time.
struct Counter(Cell<u64>);
impl Clock for Counter {
    fn now_ms(&self) -> String {
        let now = self.0.get();
        self.0.set(now + 1);
        now.to_string()
    }
}
/// The dispatch loses its response; the read-back finds the scenario's outcome.
struct ReadBack {
    outcome: Value,
    reads: usize,
}
impl EffectAdapter for ReadBack {
    fn execute(&mut self, _: &Value, _: &Value) -> Result<Outcome> {
        Err(error("LOST_RESPONSE"))
    }
    fn reconcile(&mut self, _: &Value, _: &Value) -> Result<Outcome> {
        self.reads += 1;
        Ok(Outcome {
            effect: self.outcome["effect"].as_str().unwrap().into(),
            actual_cost: self.outcome["actualCost"].as_str().unwrap().into(),
        })
    }
}
fn main() -> Result<()> {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input).unwrap();
    let s: Value = serde_json::from_str(&input).unwrap();
    let decision = Rc::new(RefCell::new(s["allow"].clone()));
    let asked = Rc::new(RefCell::new(vec![]));
    let store = SqliteStore::open(
        ":memory:",
        Some(&Contract::from_value(s["contract"].clone())?),
    )?;
    let authorizer = Scripted {
        decision: decision.clone(),
        asked: asked.clone(),
    };
    let mut c = Coordinator::new(
        store,
        authorizer,
        Counter(Cell::new(s["clock"].as_str().unwrap().parse().unwrap())),
    );
    for command in s["setup"].as_array().unwrap() {
        c.apply(&Command::from_value(command.clone())?, None)?;
    }
    let attempt = s["attemptId"].as_str().unwrap();
    let mut adapter = ReadBack {
        outcome: s["readBack"].clone(),
        reads: 0,
    };
    c.dispatch(attempt, &mut adapter, None)?;
    asked.borrow_mut().clear();
    let mut calls = vec![];
    for call in s["reconcile"].as_array().unwrap() {
        *decision.borrow_mut() = call["decision"].clone();
        let mut result = match c.reconcile(attempt, &mut adapter) {
            Ok(_) => json!({}),
            Err(e) => json!({"error":e.code}),
        };
        result["revision"] = c.store.snapshot()?.as_value()["revision"].clone();
        result["reads"] = json!(adapter.reads);
        calls.push(result);
    }
    let state = c.store.snapshot()?;
    let out = json!({"calls":calls,"asked":*asked.borrow(),"diagnostics":c.store.diagnostics()?,"digest":digest(state.as_value())?});
    println!("{}", serde_json::to_string(&out).unwrap());
    Ok(())
}
