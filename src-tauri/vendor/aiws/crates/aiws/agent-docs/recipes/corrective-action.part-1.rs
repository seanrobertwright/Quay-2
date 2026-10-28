// Part 1 of 2 of corrective-action.rs: concatenate the parts, without these first lines, for the whole program.
use aiws_sdk::limits_store::{LimitAuthorizer, LimitCoordinator, LimitStore};
use aiws_sdk::observability::{classify_response, TelemetryExporter};
use aiws_sdk::runtime::*;
use aiws_sdk::sqlite::SqliteStore;
use aiws_sdk::workflow::ready_nodes;
use aiws_sdk::*;
use serde_json::{json, Value};
use std::cell::{Cell, RefCell};
use std::collections::{HashMap, VecDeque};
use std::io::Write;
use std::path::PathBuf;
use std::rc::Rc;
// STANDARD.md Annex B, the EH&S corrective action, run by a reference host. Annex B illustrates the semantic
// contract; it is not a regulatory procedure. Every id the run records keeps the example: prefix (principal, policy and
// resource names are local to the recipe) and the result is exampleOnly.
// Out of scope, and not covered here: secrets, sandboxing, child runs and deployment verification.
// Run 1 assembles and assesses the corrective-action package; the linked follow-up run obtains the implementation evidence.
const RUN: &str = "example:run:guarding-17";
const FOLLOW_UP: &str = "example:run:guarding-17:implementation";
const WORK_ORDER: &str = "example:work-order:guarding-17";
const GRANT: &str = "example:grant:investigator";
const CASE: &str = "example:case:guarding-17";
const APPROVAL: &str = "example:approval:engineering-review";
const VERIFICATION: &str = "example:verification:guarding-17:1";
const FOLLOW_UP_VERIFICATION: &str = "example:verification:guarding-17:2";
const CRITERIA: [&str; 4] = ["issue-identified", "engineering-reviewed", "implementation-evidenced", "effectiveness-accepted"];
const POLICY: &str = "policy:example:annex-b:1";
const TERMINAL: [&str; 4] = ["COMPLETED", "FAILED", "CANCELED", "REJECTED"];
type Shared<T> = Rc<RefCell<T>>;

// Two clocks, each trusted UTC time in epoch milliseconds as a canonical decimal string. A deployed host injects the
// real one, read from the system clock. This recipe injects the scripted one, which only moves forward, so every
// language prints the same record; its contract deadline is 8 hours after the epoch, long past on the real clock.
struct UtcClock;
impl Clock for UtcClock {
    fn now_ms(&self) -> String {
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).expect("the system clock reads after 1970").as_millis().to_string()
    }
}
#[derive(Clone)]
struct ScriptedClock(Rc<Cell<u64>>);
impl Clock for ScriptedClock {
    fn now_ms(&self) -> String { self.0.get().to_string() }
}

// Simulated human identity: replace before deployment. A deployed host authenticates every principal before
// its command reaches an authorizer; identity never comes from a command field or an event payload.
struct Session { actor: &'static str, kind: &'static str }
static RUNNER: Session = Session { actor: "host:runner", kind: "RULE" };
static WORKER: Session = Session { actor: "host:worker-1", kind: "RULE" };
static AGENT: Session = Session { actor: "agent:investigator", kind: "AGENT" };
static OWNER: Session = Session { actor: "human:case-owner", kind: "HUMAN" };
static REVIEWER: Session = Session { actor: "human:engineering-reviewer", kind: "HUMAN" };
static TECHNICIAN: Session = Session { actor: "human:authorized-technician", kind: "HUMAN" };
static VERIFIER: Session = Session { actor: "human:designated-verifier", kind: "HUMAN" };
fn is(a: &Session, b: &Session) -> bool { std::ptr::eq(a, b) }

// Deny by default: a command is allowed only when a rule below names its session.
const AGENT_ACTIONS: [&str; 4] = ["read-records inspection-records", "draft case-draft", "update-case case:guarding-17", "notify case-owner-inbox"];
struct Policy { session: &'static Session, routes: Shared<HashMap<String, String>> } // wait id -> the one principal routed to answer it
fn permits(s: &Session, c: &Value, routes: &HashMap<String, String>) -> bool {
    let text = |v: &Value| v.as_str().unwrap_or_default().to_owned();
    match text(&c["type"]).as_str() {
        "startRun" | "continueRun" | "registerGraph" | "attachGraph" | "completeNode" | "wait" | "join" | "transition" => is(s, &RUNNER),
        "admit" => is(s, &AGENT) && c["subject"] == AGENT.actor
            && AGENT_ACTIONS.contains(&format!("{} {}", text(&c["action"]["capability"]), text(&c["action"]["resource"])).as_str())
            && (c["action"]["capability"] != "update-case" || c.get("approvalId").is_some()),
        "dispatch" | "settle" => is(s, &WORKER),
        "grant" => is(s, &OWNER),
        "approve" => is(s, &REVIEWER) && c["approval"]["approver"] == REVIEWER.actor,
        "resume" => routes.get(&text(&c["waitId"])).is_some_and(|actor| actor == s.actor),
        "verify" => is(s, &VERIFIER) && c["assessor"] == VERIFIER.actor,
        "accept" => is(s, &VERIFIER) && c["authority"] == VERIFIER.actor, // Annex B: accepted by the designated verifier
        _ => false,
    }
}
impl Authorizer for Policy {
    fn authorize(&mut self, command: &Command, _: &Snapshot, _: &str) -> Result<Authorization> {
        let allowed = permits(self.session, command.as_value(), &self.routes.borrow());
        Ok(Authorization { allowed, policy: if allowed { "ALLOW" } else { "DENY" }.into(), mandatory_checks_ok: true,
            context: json!({"actor":self.session.actor,"policyRevision":POLICY,"decisionClass":if self.session.kind=="HUMAN"{"HUMAN"}else{"DETERMINISTIC"}}) })
    }
}
struct LedgerPolicy { session: &'static Session, evidence: Shared<HashMap<String, String>> } // attempt id -> digest of the artifact that evidences its outcome
impl LimitAuthorizer for LedgerPolicy {
    fn authorize(&mut self, request: &Value, state: &Value, now: &str) -> Result<Value> {
        let kind = request["command"]["type"].as_str().unwrap_or_default();
        let attempt_id = request["command"]["attemptId"].as_str().unwrap_or_default();
        let evidence_ref = if kind == "settle" { self.evidence.borrow().get(attempt_id).cloned() } else { None };
        let allowed = if kind == "reserve" { is(self.session, &AGENT) }
            // Only a human settles an UNKNOWN ledger attempt, on the evidence that resolved it.
            else if kind == "settle" && is(self.session, &OWNER) { state["attempts"][attempt_id]["status"] == "UNKNOWN" }
            else { ["dispatch", "settle", "unknown", "release"].contains(&kind) && is(self.session, &WORKER) };
        Ok(json!({"allowed":allowed&&(kind!="settle"||evidence_ref.is_some()),"actorId":self.session.actor,"actorKind":self.session.kind,
            "policyRef":POLICY,"evidenceRef":evidence_ref,"authorizedAtMs":now}))
    }
}

// Immutable local artifacts: content-addressed, written once with create-new and fsync, never rewritten.
fn artifact_path(directory: &PathBuf, revision: &str) -> PathBuf { directory.join(format!("{}.json", &revision["sha256:".len()..])) }
fn artifact(directory: &PathBuf, value: &Value) -> Result<String> {
    let (bytes, revision) = (canonical(value)?, digest(value)?);
    let path = artifact_path(directory, &revision);
    match std::fs::OpenOptions::new().write(true).create_new(true).open(&path) {
        Ok(mut file) => { file.write_all(bytes.as_bytes()).and_then(|_| file.sync_all()).map_err(|_| error("FILE_ERROR"))?; }
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists && std::fs::read_to_string(&path).ok() == Some(bytes) => {}
        Err(_) => return Err(error("FILE_ERROR")),
    }
    Ok(revision)
}
fn applied(effect: &str, cost: &str) -> Outcome { Outcome { effect: effect.into(), actual_cost: cost.into() } }

// A local stand-in for the approved-records system: replace before deployment.
fn records() -> Value {
    json!([
        {"id":"example:record:inspection-17","kind":"inspection","approved":true,"text":"Press 4 interlock guard lifts while the ram is energized"},
        {"id":"example:record:field-note-17","kind":"inspection","approved":false,"text":"Unreviewed field note"},
        {"id":"example:record:maintenance-press-4","kind":"maintenance","approved":true,"text":"Guard hinge replaced; interlock switch not retested"},
        {"id":"example:record:training-press-4","kind":"training","approved":true,"text":"Operator lockout training is current"}])
}
struct RecordsReader { directory: PathBuf, evidence: Shared<HashMap<String, String>> }
impl EffectAdapter for RecordsReader {
    fn execute(&mut self, operation: &Value, attempt: &Value) -> Result<Outcome> {
        let kind = &operation["action"]["payload"]["kind"];
        let found: Vec<Value> = records().as_array().unwrap().iter().filter(|r| r["approved"] == true && &r["kind"] == kind).cloned().collect();
        let revision = artifact(&self.directory, &json!({"kind":kind,"records":found}))?;
        self.evidence.borrow_mut().insert(attempt["id"].as_str().unwrap().into(), revision);
        Ok(applied("CONFIRMED_APPLIED", "1"))
    }
    // A read leaves nothing at the source to look up, so a lost response stays UNKNOWN for a human to resolve.
    fn reconcile(&mut self, _: &Value, _: &Value) -> Result<Outcome> { Ok(applied("UNKNOWN", "0")) }
}

// A deterministic stand-in for the investigator agent's model calls: replace before deployment. It asks for the kinds
// of record it still lacks and drafts the corrective action from the records it read.
const REQUIRED_KINDS: [&str; 3] = ["inspection", "maintenance", "training"];
struct Drafter { directory: PathBuf, evidence: Shared<HashMap<String, String>> }
impl EffectAdapter for Drafter {
    fn execute(&mut self, operation: &Value, attempt: &Value) -> Result<Outcome> {
        let mut based_on = vec![];
        for revision in operation["action"]["payload"]["records"].as_array().unwrap() {
            let path = artifact_path(&self.directory, revision.as_str().unwrap());
            let bundle = parse_strict(&std::fs::read_to_string(path).map_err(|_| error("FILE_ERROR"))?)?;
            based_on.extend(bundle["records"].as_array().unwrap().iter().map(|r| r["id"].clone()));
        }
        let revision = artifact(&self.directory, &json!({"caseId":CASE,"basedOn":based_on,
            "proposedAction":"Replace the press 4 interlock switch, retest the guard interlock and brief operators"}))?;
        self.evidence.borrow_mut().insert(attempt["id"].as_str().unwrap().into(), revision);
        Ok(applied("CONFIRMED_APPLIED", "1"))
    }
    fn reconcile(&mut self, _: &Value, _: &Value) -> Result<Outcome> { Ok(applied("UNKNOWN", "0")) }
}

// A local stand-in for the external case-record system: replace before deployment. Its operation contract: it applies
// an update only at the expected version, applies nothing when that precondition fails, and keeps a history of which
// operation wrote each version. So a repeated operation is recognised instead of applied twice, and a failed
// precondition proves non-application only for an operation the history shows wrote no version.
// As STANDARD.md Annex C.1 suggests for a test target, it commits the first update and then drops the acknowledgment:
// the call times out, and the coordinator records UNKNOWN.
struct CaseRecord { directory: PathBuf, evidence: Shared<HashMap<String, String>>, acknowledgments_to_drop: Rc<Cell<u32>> }
impl CaseRecord {
    fn path(&self) -> PathBuf { self.directory.join("case-record.json") }
    fn read(&self) -> Result<Value> { parse_strict(&std::fs::read_to_string(self.path()).map_err(|_| error("FILE_ERROR"))?) }
    fn record(&self, attempt: &Value, value: &Value) -> Result<()> {
        let revision = artifact(&self.directory, value)?;
        self.evidence.borrow_mut().insert(attempt["id"].as_str().unwrap().into(), revision);
        Ok(())
    }
}
impl EffectAdapter for CaseRecord {
    fn execute(&mut self, operation: &Value, attempt: &Value) -> Result<Outcome> {
        let (record, action) = (self.read()?, &operation["action"]);
        if record["history"].as_array().unwrap().iter().any(|h| h["operationId"] == operation["id"]) { self.record(attempt, &record)?; return Ok(applied("CONFIRMED_APPLIED", "1")); }
        if record["version"] != action["preconditions"]["version"] { self.record(attempt, &record)?; return Ok(applied("CONFIRMED_NOT_APPLIED", "1")); }
        let version = record["version"].as_u64().unwrap() + 1;
        let mut history = record["history"].as_array().unwrap().clone();
        history.push(json!({"version":version,"operationId":operation["id"]}));
        let mut next = json!({"caseId":record["caseId"],"version":version,"evidence":action["payload"]["evidence"],"history":history});
        for (key, value) in action["payload"]["update"].as_object().unwrap() { next[key] = value.clone(); }
        let staged = self.directory.join("case-record.json.next");
        std::fs::write(&staged, canonical(&next)?).and_then(|_| std::fs::rename(&staged, self.path())).map_err(|_| error("FILE_ERROR"))?;
        if self.acknowledgments_to_drop.get() > 0 {
            self.acknowledgments_to_drop.set(self.acknowledgments_to_drop.get() - 1);
            return Err(error("TIMEOUT")); // the case-record system did not acknowledge the update
        }
        self.record(attempt, &next)?;
        Ok(applied("CONFIRMED_APPLIED", "1"))
    }
    // Read-only: the history shows this operation wrote its version, or the outcome stays UNKNOWN. The record it read is
    // the evidence.
    fn reconcile(&mut self, operation: &Value, attempt: &Value) -> Result<Outcome> {
        let record = self.read()?;
        let version = operation["action"]["preconditions"]["version"].as_u64().unwrap() + 1;
        let wrote = record["history"].as_array().unwrap().iter().any(|h| h["operationId"] == operation["id"] && h["version"] == version);
        if !wrote { return Ok(applied("UNKNOWN", "0")); }
        self.record(attempt, &record)?;
        Ok(applied("CONFIRMED_APPLIED", "1"))
    }
}

// A placeholder for an adapter not written yet: replace before deployment with the application's notification client.
// It calls nothing and reports UNKNOWN from execute and reconcile alike, so a host wired to it holds the node instead
// of claiming that the notification was, or was not, delivered.
struct Placeholder;
impl EffectAdapter for Placeholder {
    fn execute(&mut self, _: &Value, _: &Value) -> Result<Outcome> { Ok(applied("UNKNOWN", "0")) }
    fn reconcile(&mut self, _: &Value, _: &Value) -> Result<Outcome> { Ok(applied("UNKNOWN", "0")) }
}

// Simulated telemetry export: replace before deployment with a collector client that has a timeout and redirects disabled.
struct Collector;
impl TelemetryExporter for Collector {
    fn send(&mut self, _: &str, _: &Value) -> Value { classify_response(200, "{}", None) }
}

// Simulated inbox: an in-memory queue the script answers. Replace before deployment with an authenticated application
// inbox; delivering a notification is an application effect with its own outcome.
// Each item names the node that opened it; a node's wait id is derived from its id in one place.
struct Ask { to: &'static Session, node_id: String, wait_id: String, correlation: String }
fn wait_id_of(node_id: &str) -> String { format!("example:wait:{node_id}") }
fn attempt_id_of(operation_id: &str) -> String { format!("{operation_id}:attempt:1") } // each operation runs one attempt here
// A host stop: an outcome other than CONFIRMED_APPLIED stops the host, which closes its stores; the next start-up
// recovers. The restart here stays in one process, so the evidence index and the trail stay in memory; a deployed host
// keeps them durable beside its artifacts.
const STOPPED: &str = "HOST_STOPPED";

struct Host {
    store: Option<SqliteStore>, ledger_store: Option<LimitStore>, contract: Contract, envelope: Value, clock: ScriptedClock, directory: PathBuf,
    routes: Shared<HashMap<String, String>>, evidence: Shared<HashMap<String, String>>, acknowledgments_to_drop: Rc<Cell<u32>>,
    trail: Vec<(String, Vec<String>)>, // attempt id -> the steps the host committed, in order
    inbox: VecDeque<Ask>, collected: Vec<String>, record_revisions: Vec<String>, attestation: String,
    start_ups: Vec<Value>, denials: Vec<Value>,
}
impl Host {
    // One worker, so one mission store and one ledger store. Another worker opens its own; a store is never shared.
    // Each verified session gets its own coordinator over the worker's store.
    fn mission(&mut self, session: &'static Session, command: Value) -> Result<Snapshot> {
        self.with_mission(session, |c| c.apply(&Command::from_value(command)?, None))
    }
    fn with_mission<T>(&mut self, session: &'static Session, f: impl FnOnce(&mut Coordinator<Policy, ScriptedClock>) -> Result<T>) -> Result<T> {
        let policy = Policy { session, routes: self.routes.clone() };
        let mut coordinator = Coordinator::new(self.store.take().unwrap(), policy, self.clock.clone());
        let result = f(&mut coordinator);
        self.store = Some(coordinator.store);
        result
    }
    fn ledger(&mut self, session: &'static Session, command: Value) -> Result<()> {
        let clock = self.clock.clone();
        let mut coordinator = LimitCoordinator { store: self.ledger_store.take().unwrap(),
            authorize: LedgerPolicy { session, evidence: self.evidence.clone() }, clock: move || clock.now_ms() };
        let mut apply = || {
            let revision = coordinator.store.snapshot()?["revision"].clone();
            let subject = command.get("attemptId").unwrap_or(&command["scopeId"]).as_str().unwrap();
            let request_id = format!("{}:{}", command["type"].as_str().unwrap(), subject);
            coordinator.apply(&json!({"requestId":request_id,"expectedRevision":revision,"command":command}))
        };
        let result = apply();
        self.ledger_store = Some(coordinator.store);
        result.map(|_| ())
    }
    fn snapshot(&self) -> Result<Value> { Ok(self.store.as_ref().unwrap().snapshot()?.as_value().clone()) }
    fn evidence_of(&self, operation_id: &str) -> String { self.evidence.borrow()[&attempt_id_of(operation_id)].clone() }
    fn steps(&mut self, attempt_id: &str) -> &mut Vec<String> { &mut self.trail.iter_mut().find(|(id, _)| id == attempt_id).unwrap().1 }
    fn case_record(&self) -> CaseRecord {
        CaseRecord { directory: self.directory.clone(), evidence: self.evidence.clone(), acknowledgments_to_drop: self.acknowledgments_to_drop.clone() }
    }

    // One effect, in the documented order: reserve in the ledger, prepare the mission attempt, record ledger dispatch,
    // then the coordinator commits DISPATCHED before calling the adapter and settles its outcome.
    fn perform(&mut self, run_id: &str, node_id: &str, operation_id: &str, action: Value, adapter: &mut impl EffectAdapter, approval_id: Option<&str>) -> Result<String> {
        // A restarted host never repeats an operation: it completes the node only on a confirmed outcome.
        if let Some(existing) = self.snapshot()?["operations"].get(operation_id) {
            if existing["effect"] != "CONFIRMED_APPLIED" { eprintln!("stopped: {operation_id} is {}", existing["effect"]); return Err(error(STOPPED)); }
            return Ok(operation_id.to_owned());
        }
        let (attempt_id, amount) = (attempt_id_of(operation_id), "1");
        let mut steps = vec![];
        self.ledger(&AGENT, json!({"type":"reserve","attemptId":attempt_id,"operationId":operation_id,"scopeId":run_id,"runId":run_id,"purpose":"ORDINARY","amount":amount,"maxActiveMs":"60000"}))?;
        steps.push("ledger reserve".to_owned());
        let mut admit = json!({"type":"admit","runId":run_id,"operationId":operation_id,"attemptId":attempt_id,"grantId":GRANT,"subject":AGENT.actor,"action":action,"amount":amount,
            "authorizationCheckedAt":"0","policy":"INDETERMINATE","mandatoryChecksOk":false}); // the coordinator fills the policy fields
        if let Some(id) = approval_id { admit["approvalId"] = json!(id); }
        if let Err(e) = self.mission(&AGENT, admit) { self.ledger(&WORKER, json!({"type":"release","attemptId":attempt_id}))?; return Err(e); }
        steps.push("mission admit".to_owned());
        self.ledger(&WORKER, json!({"type":"dispatch","attemptId":attempt_id}))?;
        steps.push("ledger dispatch".to_owned());
        let state = self.with_mission(&WORKER, |c| c.dispatch(&attempt_id, adapter, Some(node_id)))?;
        let settled = state.as_value()["attempts"][&attempt_id].clone();
        let effect = settled["effect"].as_str().unwrap().to_owned();
        steps.extend(["mission dispatch".to_owned(), format!("mission settle {effect}")]);
        // UNKNOWN keeps the whole reservation: only reconciliation or a human decision resolves it, never a retry.
        if effect == "UNKNOWN" { self.ledger(&WORKER, json!({"type":"unknown","attemptId":attempt_id}))?; }
        else { self.ledger(&WORKER, json!({"type":"settle","attemptId":attempt_id,"actualCost":settled["actualCost"]}))?; }
        steps.push(if effect == "UNKNOWN" { "ledger unknown" } else { "ledger settle" }.to_owned());
        self.trail.push((attempt_id.clone(), steps));
        // Any other outcome stops the host before the node completes. This recipe records no hold beyond the attempt's
        // outcome and, for UNKNOWN, the ledger's unknown mark.
        if effect != "CONFIRMED_APPLIED" { eprintln!("stopped: {attempt_id} is {effect}"); return Err(error(STOPPED)); }
        Ok(operation_id.to_owned())
    }
    fn missing_kind(&self) -> Option<&'static str> { REQUIRED_KINDS.into_iter().find(|kind| !self.collected.iter().any(|c| c == kind)) }
    fn collect(&mut self, node_id: &str, kind: &str) -> Result<String> {
        let action = json!({"capability":"read-records","resource":"inspection-records","payload":{"caseId":CASE,"kind":kind},"preconditions":{}});
        let mut adapter = RecordsReader { directory: self.directory.clone(), evidence: self.evidence.clone() };
        let operation_id = self.perform(RUN, node_id, &format!("example:operation:records-{kind}"), action, &mut adapter, None)?;
        self.collected.push(kind.to_owned());
        let revision = self.evidence_of(&operation_id);
        self.record_revisions.push(revision);
        Ok(operation_id)
    }
    // The case update the reviewer approves: the exact new state, the evidence revisions behind it and the version it replaces.
    fn case_update(&self) -> Value {
        json!({"capability":"update-case","resource":"case:guarding-17","preconditions":{"version":1},"payload":{"caseId":CASE,
            "update":{"status":"CORRECTIVE_ACTION_PROPOSED","correctiveAction":self.evidence_of("example:operation:draft-action")},"evidence":self.record_revisions}})
    }
    fn ask(&mut self, to: &'static Session, run_id: &str, node_id: &str, kind: &str) -> Result<Option<Value>> {
        let (wait_id, correlation) = (wait_id_of(node_id), format!("example:correlation:{node_id}"));
        let deadline = (self.clock.0.get() + 3600000).to_string();
        self.mission(&RUNNER, json!({"type":"wait","runId":run_id,"waitId":wait_id,"correlation":correlation,"kind":kind,"deadline":deadline}))?;
        self.mission(&RUNNER, json!({"type":"transition","runId":run_id,"to":"WAITING"}))?;
        self.routes.borrow_mut().insert(wait_id.clone(), to.actor.to_owned());
        self.inbox.push_back(Ask { to, node_id: node_id.to_owned(), wait_id, correlation });
        Ok(None)
    }
    // The package: the record revisions, the draft and the case receipt.
    fn package_evidence(&self) -> Vec<String> {
        let mut all = self.record_revisions.clone();
        all.extend([self.evidence_of("example:operation:draft-action"), self.evidence_of("example:operation:update-case")]);
        all
    }
    // The scripted principals answer their inbox items, ten minutes later each. Replace before deployment.
    // The reviewer approves the exact case update it was shown: its review tool derives the fingerprint from that action
    // with the SDK's fingerprint, the function admission uses, so no hash is typed in.
    fn answer(&mut self, item: &Ask) -> Result<()> {
        self.clock.0.set(self.clock.0.get() + 600000);
        let later = (self.clock.0.get() + 3600000).to_string();
        match item.node_id.as_str() {
            "engineering-review" => {
                let reviewed = fingerprint(&Action::from_value(self.case_update())?)?;
                self.mission(&REVIEWER, json!({"type":"approve","approval":{"id":APPROVAL,"runId":RUN,
                    "approver":REVIEWER.actor,"fingerprint":reviewed,"expiresAt":later,"uses":"1"}}))?;
            }
            "implementation-evidence" => {
                // Simulated event ingress: replace before deployment. A deployed host authenticates the event source and the
                // attesting person; the host, not the payload, names who attested.
                let event = json!({"source":"example:maintenance-system","type":"implementation-attested","correlation":item.correlation,
                    "data":{"caseId":CASE,"work":"Interlock switch replaced and guard interlock retested"}});
                let mut attested = event["data"].clone();
                attested["attestedBy"] = json!(item.to.actor);
                self.attestation = artifact(&self.directory, &attested)?;
            }
            "verification" => {
                let results: serde_json::Map<String, Value> = CRITERIA.iter().map(|id| (id.to_string(), json!("PASS"))).collect();
                let mut evidence = self.package_evidence();
                evidence.push(self.attestation.clone());
                self.mission(&VERIFIER, json!({"type":"verify","runId":FOLLOW_UP,"assessor":VERIFIER.actor,"revision":FOLLOW_UP_VERIFICATION,"results":results,
                    "evidence":evidence,"rationale":"Records, reviewed draft, case receipt and implementation attestation support every criterion"}))?;
            }
            "acceptance" => { self.mission(&VERIFIER, json!({"type":"accept","runId":FOLLOW_UP,"authority":VERIFIER.actor,"verificationRevision":FOLLOW_UP_VERIFICATION,
                "decision":"ACCEPTED","rationale":"Corrective-action package accepted; return to service stays a separate decision"}))?; }
            _ => {}
        }
        self.mission(item.to, json!({"type":"resume","waitId":item.wait_id,"correlation":item.correlation}))?;
        Ok(())
    }
    // Each node returns its completion proof, or None after it opens a wait: an operation for TASK, an operation and done
    // for LOOP, an approval for APPROVAL, a satisfied wait for WAIT, the assessment revision for VERIFICATION and
    // ACCEPTANCE, and a disposition for END.
    fn node(&mut self, node_id: &str, state: &Value) -> Result<Option<Value>> {
        let (directory, evidence) = (self.directory.clone(), self.evidence.clone());
        Ok(Some(match node_id {
            "collect-records" => json!({"operationId":self.collect(node_id, "inspection")?}),
            // The bounded loop: each iteration requests one missing kind of record, at most maxIterations times.
            "request-more-records" => {
                let kind = self.missing_kind().unwrap();
                let operation_id = self.collect(node_id, kind)?;
                json!({"operationId":operation_id,"done":self.missing_kind().is_none()})
            }
            "draft-action" => {
                let action = json!({"capability":"draft","resource":"case-draft","payload":{"caseId":CASE,"records":self.record_revisions},"preconditions":{}});
                json!({"operationId":self.perform(RUN, node_id, "example:operation:draft-action", action, &mut Drafter { directory, evidence }, None)?})
            }
            "engineering-review" if state["approvals"].get(APPROVAL).is_some() => json!({"approvalId":APPROVAL}),
            "engineering-review" => return self.ask(&REVIEWER, RUN, node_id, "AUTHORIZATION"),
            // The approval-bound case-record write: the SDK admits it only when its fingerprint matches an unexpired, unused approval.
            "update-case" => {
                let (action, mut adapter) = (self.case_update(), self.case_record());
                json!({"operationId":self.perform(RUN, node_id, "example:operation:update-case", action, &mut adapter, Some(APPROVAL))?})
            }
            "implementation-evidence" if state["waits"][wait_id_of(node_id)]["status"] == "SATISFIED" => json!({"waitId":wait_id_of(node_id)}),
            "implementation-evidence" => return self.ask(&TECHNICIAN, FOLLOW_UP, node_id, "EXTERNAL"),
            "verification" if state["assessments"].get(FOLLOW_UP).is_some() => json!({"revision":FOLLOW_UP_VERIFICATION}),
            "verification" => return self.ask(&VERIFIER, FOLLOW_UP, node_id, "INPUT"),
            "acceptance" if state["assessments"][FOLLOW_UP]["acceptance"] != "NOT_REQUESTED" => json!({"revision":FOLLOW_UP_VERIFICATION}),
            "acceptance" => return self.ask(&VERIFIER, FOLLOW_UP, node_id, "INPUT"),
            // The case owner decides return to service, so the follow-up run notifies them of the acceptance.
            "notify-case-owner" => {
                let action = json!({"capability":"notify","resource":"case-owner-inbox","payload":{"caseId":CASE,"runId":FOLLOW_UP,
                    "message":"The corrective-action package is accepted; return to service is your decision"},"preconditions":{}});
                json!({"operationId":self.perform(FOLLOW_UP, node_id, "example:operation:notify-case-owner", action, &mut Placeholder, None)?})
            }
            _ => json!({"disposition":"COMPLETED"}),
        }))
    }

    // Start-up, before the host takes any work: open the stores, then recover every run left open. recover fences the
    // run with a new segment and lists its unresolved attempts, and each is reconciled read-only through the adapter that
    // dispatched it. A human settles a confirmed outcome in the ledger, on the read-back; an outcome still UNKNOWN stays
    // held for a human, and the host neither retries nor claims it.
    fn start_up(&mut self) -> Result<()> {
        self.store = Some(SqliteStore::open(self.directory.join("mission.db").to_str().unwrap(), Some(&self.contract))?);
        self.ledger_store = Some(LimitStore::open(self.directory.join("ledger.db").to_str().unwrap(), Some(&self.envelope))?);
        let mut recovered = vec![];
        for run in self.snapshot()?["runs"].as_object().unwrap().values() {
            if TERMINAL.contains(&run["state"].as_str().unwrap()) { continue; }
            let run_id = run["id"].as_str().unwrap().to_owned();
            let segment_id = format!("{run_id}:segment:{}", run["segments"].as_array().unwrap().len());
            let (_, unresolved) = self.with_mission(&RUNNER, |c| c.recover(&run_id, &segment_id))?;
            let mut reconciled = vec![];
            for attempt_id in unresolved {
                let before = self.snapshot()?;
                let capability = before["operations"][before["attempts"][&attempt_id]["operationId"].as_str().unwrap()]["action"]["capability"].clone();
                let (directory, evidence, mut case_record) = (self.directory.clone(), self.evidence.clone(), self.case_record());
                let state = self.with_mission(&WORKER, |c| match capability.as_str().unwrap() {
                    "read-records" => c.reconcile(&attempt_id, &mut RecordsReader { directory, evidence }),
                    "draft" => c.reconcile(&attempt_id, &mut Drafter { directory, evidence }),
                    "update-case" => c.reconcile(&attempt_id, &mut case_record),
                    _ => c.reconcile(&attempt_id, &mut Placeholder),
                })?;
                let settled = state.as_value()["attempts"][&attempt_id].clone();
                let effect = settled["effect"].as_str().unwrap().to_owned();
                self.steps(&attempt_id).extend(["mission recover".to_owned(), format!("mission reconcile {effect}")]);
                reconciled.push(json!({"attemptId":attempt_id,"effect":effect}));
                if effect == "UNKNOWN" { continue; }
                // Simulated human decision: replace before deployment. The case owner reviews the read-back and settles the ledger.
                self.ledger(&OWNER, json!({"type":"settle","attemptId":attempt_id,"actualCost":settled["actualCost"]}))?;
                self.steps(&attempt_id).push("ledger settle".to_owned());
            }
            recovered.push(json!({"runId":run_id,"segmentId":segment_id,"reconciled":reconciled}));
        }
        self.start_ups.push(json!({"recovered":recovered}));
        Ok(())
    }
    // Root-grant authoring: the case owner, a human, writes the agent's grant. A root grant has no parent, so the contract
    // is its only bound: the SDK refuses one that lists an action or resource the contract does not, a limit above the
    // budget or an expiry after the deadline. This one is narrower than the contract: 10 capability calls, no delegation.
    fn root_grant(&self) -> Value {
        let c = self.contract.as_value();
        json!({"id":GRANT,"subject":AGENT.actor,"profile":"finite-v1","actions":c["actions"],"resources":c["resources"],
            "notBefore":"0","expiresAt":c["deadline"],"limit":"10","canDelegate":false,"depth":"0"})
    }
    // A deterministic stand-in for an agent that oversteps: replace before deployment. It asks for a wider grant of its own
    // and for a higher cost limit on the work order. Only a human changes permissions or limits, so the mission authorizer
    // denies the grant and the ledger authorizer, which allows no adjust here, denies the adjustment.
    fn refused<T>(&mut self, command: &str, result: Result<T>) {
        match result {
            Err(e) => self.denials.push(json!({"command":command,"actor":AGENT.actor,"refused":e.code})),
            Ok(_) => panic!("{command} was not refused"),
        }
    }
    fn overstep(&mut self) {
        let mut widened = self.root_grant();
        widened["id"] = json!(format!("{GRANT}:widened"));
        widened["limit"] = self.contract.as_value()["budget"].clone();
        let grant = self.mission(&AGENT, json!({"type":"grant","grant":widened}));
        self.refused("grant", grant);
        let adjust = self.ledger(&AGENT, json!({"type":"adjust","scopeId":WORK_ORDER,
            "limits":{"cost":"1000","handoff":"10","activeMs":null,"elapsedMs":"28800000","attempts":"100"}}));
        self.refused("adjust", adjust);
    }
    fn until_stopped(&mut self, run_id: &str) -> Result<()> {
        match self.drive(run_id) {
            Err(e) if e.code == STOPPED => { self.store = None; self.ledger_store = None; Ok(()) }
            other => other,
        }
    }
    // The run loop over the graph: dispatch each ready node and complete it with its proof.
    fn drive(&mut self, run_id: &str) -> Result<()> {
        loop {
            let state = self.store.as_ref().unwrap().snapshot()?;
            let run_state = state.as_value()["runs"][run_id]["state"].as_str().unwrap().to_owned();
            if TERMINAL.contains(&run_state.as_str()) { return Ok(()); }
            if run_state == "WAITING" {
                let item = self.inbox.pop_front().unwrap();
                self.answer(&item)?;
                self.mission(&RUNNER, json!({"type":"join","runId":run_id,"waitIds":[item.wait_id],"mode":"ALL"}))?;
                continue;
            }
            let Some(node_id) = ready_nodes(&state, run_id)?.into_iter().next() else {
                self.mission(&RUNNER, json!({"type":"transition","runId":run_id,"to":"COMPLETED"}))?;
                continue;
            };
            if let Some(proof) = self.node(&node_id, state.as_value())? {
                self.mission(&RUNNER, json!({"type":"completeNode","runId":run_id,"nodeId":node_id,"result":proof}))?;
            }
        }
    }
    fn start(&mut self, run_id: &str, graph: &Value) -> Result<()> {
        self.mission(&RUNNER, json!({"type":"startRun","runId":run_id}))?;
        self.mission(&RUNNER, json!({"type":"registerGraph","graph":graph}))?;
        self.mission(&RUNNER, json!({"type":"attachGraph","runId":run_id,"graphId":graph["id"]}))?;
        Ok(())
    }
}

