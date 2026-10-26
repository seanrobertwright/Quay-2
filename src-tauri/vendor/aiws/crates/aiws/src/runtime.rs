//! Trusted synchronous execution coordinator. Use a blocking worker in async applications.
use crate::core::{check, st};
use crate::sqlite::SqliteStore;
use crate::*;
use serde_json::{json, Value};
pub struct Authorization {
    pub allowed: bool,
    pub policy: String,
    pub mandatory_checks_ok: bool,
    pub context: Value,
}
pub trait Authorizer {
    fn authorize(
        &mut self,
        command: &Command,
        state: &Snapshot,
        now: &str,
    ) -> Result<Authorization>;
}
pub trait Clock {
    fn now_ms(&self) -> String;
}
#[derive(Debug, Clone)]
pub struct Outcome {
    pub effect: String,
    pub actual_cost: String,
}
pub trait EffectAdapter {
    fn execute(&mut self, operation: &Value, attempt: &Value) -> Result<Outcome>;
    /// Read-only lookup of the external effect; this must never repeat the action.
    fn reconcile(&mut self, operation: &Value, attempt: &Value) -> Result<Outcome>;
}
pub struct Coordinator<A: Authorizer, C: Clock> {
    pub store: SqliteStore,
    authorizer: A,
    clock: C,
}
impl<A: Authorizer, C: Clock> Coordinator<A, C> {
    pub fn new(store: SqliteStore, authorizer: A, clock: C) -> Self {
        Self {
            store,
            authorizer,
            clock,
        }
    }
    pub fn apply(&mut self, command: &Command, expected: Option<&str>) -> Result<Snapshot> {
        let before = self.store.snapshot()?;
        if let Some(rev) = expected {
            check(before.0["revision"] == rev, "REVISION_CONFLICT")?;
        }
        let now = self.clock.now_ms();
        let d = self.authorize_or_refuse(command, &before, &now)?;
        self.refuse_unless_allowed(command, &d, &now)?;
        let mut checked = command.0.clone();
        checked["context"] = d.context.clone();
        if ["admit", "dispatch", "retry"].contains(&st(&checked["type"])) {
            checked["authorizationCheckedAt"] = json!(now);
            checked["policy"] = json!(d.policy);
            checked["mandatoryChecksOk"] = json!(d.mandatory_checks_ok);
        }
        let result = Command::from_value(checked).and_then(|c| {
            self.store
                .apply(&c, &self.clock.now_ms(), Some(st(&before.0["revision"])))
        });
        if let Err(e) = &result {
            self.store.record_rejection(
                command.as_value(),
                &e.code,
                &self.clock.now_ms(),
                Some(&d.context),
            )?;
        }
        result
    }
    pub fn dispatch(
        &mut self,
        attempt_id: &str,
        adapter: &mut impl EffectAdapter,
        node_id: Option<&str>,
    ) -> Result<Snapshot> {
        let before = self.store.snapshot()?;
        let attempt = crate::core::get(&before.0["attempts"], attempt_id)?;
        let oid = st(&attempt["operationId"]).to_owned();
        let op = &before.0["operations"][&oid];
        let run = &before.0["runs"][st(&op["runId"])];
        if run["graphId"].is_string() {
            check(
                node_id.is_some_and(|id| {
                    workflow::ready_nodes(&before, st(&run["id"]))
                        .is_ok_and(|nodes| nodes.contains(&id.to_owned()))
                }),
                "NODE_NOT_READY",
            )?;
        }
        let mut dispatch = json!({"type":"dispatch","attemptId":attempt_id,"authorizationCheckedAt":"0","policy":"INDETERMINATE","mandatoryChecksOk":false});
        if let Some(id) = node_id {
            dispatch["nodeId"] = json!(id);
        }
        let dispatched = self.apply(
            &Command::from_value(dispatch)?,
            Some(st(&before.0["revision"])),
        )?;
        let result = adapter
            .execute(
                &dispatched.0["operations"][oid],
                &dispatched.0["attempts"][attempt_id],
            )
            .unwrap_or(Outcome {
                effect: "UNKNOWN".into(),
                actual_cost: "0".into(),
            });
        self.apply(&Command::from_value(json!({"type":"settle","attemptId":attempt_id,"effect":result.effect,"actualCost":result.actual_cost}))?,None)
    }
    pub fn reconcile(
        &mut self,
        attempt_id: &str,
        adapter: &mut impl EffectAdapter,
    ) -> Result<Snapshot> {
        let s = self.store.snapshot()?;
        let a = crate::core::get(&s.0["attempts"], attempt_id)?;
        let now = self.clock.now_ms();
        let command = Command::from_value(
            json!({"type":"settle","attemptId":attempt_id,"effect":"UNKNOWN","actualCost":"0"}),
        )?;
        let d = self.authorize_or_refuse(&command, &s, &now)?;
        self.refuse_unless_allowed(&command, &d, &now)?;
        let result = adapter.reconcile(&s.0["operations"][st(&a["operationId"])], a)?;
        self.apply(&Command::from_value(json!({"type":"settle","attemptId":attempt_id,"effect":result.effect,"actualCost":result.actual_cost}))?,None)
    }
    /// An authorizer that fails is recorded, without context, and refused as `AUTHORIZATION_ERROR`, in `apply` and
    /// `reconcile` alike (AT-55).
    fn authorize_or_refuse(
        &mut self,
        command: &Command,
        state: &Snapshot,
        now: &str,
    ) -> Result<Authorization> {
        match self.authorizer.authorize(command, state, now) {
            Ok(d) => Ok(d),
            Err(_) => {
                self.store.record_rejection(
                    command.as_value(),
                    "AUTHORIZATION_ERROR",
                    now,
                    None,
                )?;
                Err(error("AUTHORIZATION_ERROR"))
            }
        }
    }
    /// A denied or unattributed decision is recorded and refused, in `apply` and `reconcile` alike (AT-55).
    fn refuse_unless_allowed(
        &mut self,
        command: &Command,
        d: &Authorization,
        now: &str,
    ) -> Result<()> {
        if !(d.allowed && d.policy == "ALLOW" && d.mandatory_checks_ok) {
            self.store.record_rejection(
                command.as_value(),
                "AUTHORITY_DENIED",
                now,
                Some(&d.context),
            )?;
            return Err(error("AUTHORITY_DENIED"));
        }
        if !d.context["actor"].is_string() || !d.context["policyRevision"].is_string() {
            self.store
                .record_rejection(command.as_value(), "ATTRIBUTION_REQUIRED", now, None)?;
            return Err(error("ATTRIBUTION_REQUIRED"));
        }
        Ok(())
    }
    pub fn recover(&mut self, run_id: &str, segment_id: &str) -> Result<(Snapshot, Vec<String>)> {
        let s = self.apply(
            &Command::from_value(
                json!({"type":"continueRun","runId":run_id,"segmentId":segment_id}),
            )?,
            None,
        )?;
        let unresolved = crate::core::vs(&s.0["attempts"])
            .filter(|a| {
                s.0["operations"][st(&a["operationId"])]["runId"] == run_id
                    && ["DISPATCHED", "UNKNOWN"].contains(&st(&a["status"]))
            })
            .map(|a| st(&a["id"]).to_owned())
            .collect();
        Ok((s, unresolved))
    }
}
