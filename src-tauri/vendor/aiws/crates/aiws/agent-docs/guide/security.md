# Secure application integration

The SDK enforces finite record semantics. Your host establishes who is acting, which policy applies, what credentials an adapter receives and whether an external report is authentic. Keep that boundary explicit when agents generate applications.

## Authenticate before constructing authority

**Deny agent attempts to issue new grants** (Executable application recipe). Full program: [recipes/authorization.rs](../recipes/authorization.rs)

```rust
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

```

The example uses fixed trusted-host sessions to demonstrate the human-only boundary: the agent session's grant is denied and the human session's is accepted. Replace them with a verified session, service identity or worker capability from your actual identity system. Do not read isHuman, actor, role or ALLOW from an untrusted request body. An approval record represents a decision only after the host has verified who made it and what they approved.

Permission and resource-limit changes for agents always require human approval under the agreed engine design. Enforce this in the authorizer for every relevant operation. A delegated agent must not edit the policy document or identity claims that would allow it to approve its own expansion.

## Limit adapter capabilities

Give each adapter only the filesystem roots, outbound hosts, credentials and tool actions it needs. Validate artifact references and resolved paths before access. For coding tasks, use an isolated checkout or execution environment with explicit command and network policy. A graph node named VERIFICATION does not sandbox the command used to run a test suite.

Treat source files, retrieved documents, webhook payloads, model output and handoff summaries as untrusted input. Embedded instructions cannot change engine policy, grant capabilities or approve new spending. Keep approved intent and machine-readable controls distinct from narrative context.

## Approval and evidence integrity

Bind approval to the exact canonical action fingerprint and valid use count. Reevaluate current policy at dispatch; admission is not a permanent right to act. Avoid logging approval secrets, callback correlation tokens or provider credentials. Verify callback signatures and replay protections in the host before constructing TriggerEvent.

A digest detects changed content under a trusted reference. It does not establish authorship if an attacker can rewrite both the content and digest. Protect the SQLite database, backups, artifact store and audit exports with access controls. Where attestation is required, add a reviewed application signature/provenance mechanism; the SDK does not supply a universal signature protocol.

## Operate with bounded resources

Enforce limits at ingress before parsing, and limit external response sizes and adapter execution time. Choose conservative reservations before dispatch. Monitor the journal and telemetry outbox: disk-backed storage is not an unlimited queue. Do not release an UNKNOWN reservation just to let a new request proceed.

Use secret references in configuration and resolve credentials at execution. Rotate credentials independently of durable workflow history. If a credential expires while a workflow is paused, reauthenticate and reauthorize at continuation rather than relying on a saved token.

## Incident handling

For suspected tampering or an uncertain side effect, block affected work, preserve IDs and receipts, and route a specific decision to an authorized human. Do not delete history, fabricate verification or automatically broaden permissions as a repair strategy. See [recovery](./recovery.md) and [handoffs](./handoffs.md) for the durable record needed to resume safely.
