use aiws_sdk::*;
use aiws_sdk::runtime::*;
use aiws_sdk::sqlite::SqliteStore;
use serde_json::json;
// A demonstration of the human-only boundary, not authentication. The host verifies each session
// before a command reaches the authorizer; identity never comes from a caller-supplied command field.
struct Session{actor:&'static str,is_human:bool}
static AGENT:Session=Session{actor:"agent:builder",is_human:false};
static HUMAN:Session=Session{actor:"human:owner",is_human:true};
const HUMAN_ONLY:[&str;4]=["grant","revokeGrant","approve","withdrawApproval"];
const ALLOWED_COMMANDS:[&str;1]=["startRun"]; // deliberately narrow teaching policy
struct SessionPolicy(&'static Session);
impl Authorizer for SessionPolicy {
    fn authorize(&mut self,command:&Command,_:&Snapshot,_:&str)->Result<Authorization>{
        let kind=command.as_value()["type"].as_str().unwrap_or_default();
        let allowed=if HUMAN_ONLY.contains(&kind){self.0.is_human}else{ALLOWED_COMMANDS.contains(&kind)};
        Ok(Authorization{allowed,policy:if allowed{"ALLOW"}else{"DENY"}.into(),mandatory_checks_ok:true,
            context:json!({"actor":self.0.actor,"policyRevision":"policy:example:1","decisionClass":if self.0.is_human{"HUMAN"}else{"DETERMINISTIC"}})})
    }
}
struct FixedClock;
impl Clock for FixedClock{fn now_ms(&self)->String{"10".into()}}
fn main()->std::result::Result<(),Box<dyn std::error::Error>>{
    let contract=Contract::parse(&std::fs::read_to_string("examples/guide/contract.json")?)?;
    let store=SqliteStore::open(":memory:",Some(&contract))?;
    // The coordinator owns the store, so each verified session gets its own coordinator.
    let mut coordinator=Coordinator::new(store,SessionPolicy(&AGENT),FixedClock);
    coordinator.apply(&Command::from_value(json!({"type":"startRun","runId":"r"}))?,None)?;
    let grant=Command::from_value(json!({"type":"grant","grant":{"id":"g","subject":AGENT.actor,"profile":"finite-v1","actions":["write"],"resources":["doc"],"notBefore":"0","expiresAt":"10000","limit":"100","canDelegate":false,"depth":"0"}}))?;
    // The agent session cannot grant itself authority.
    assert_eq!(coordinator.apply(&grant,None).unwrap_err().code,"AUTHORITY_DENIED");
    assert_eq!(coordinator.store.snapshot()?.as_value()["revision"],"1");
    assert_eq!(coordinator.store.diagnostics()?[0]["command"]["code"],"AUTHORITY_DENIED");
    // A verified human session can.
    let mut coordinator=Coordinator::new(coordinator.store,SessionPolicy(&HUMAN),FixedClock);
    coordinator.apply(&grant,None)?;
    assert_eq!(coordinator.store.snapshot()?.as_value()["revision"],"2");
    assert_eq!(coordinator.store.snapshot()?.as_value()["grants"]["g"]["subject"],AGENT.actor);
    Ok(())
}

