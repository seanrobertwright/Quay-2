# Identity, authority and human approval

An authorization record has meaning only when supplied by a trusted component. The coordinator calls your authorizer for every command and replaces caller-supplied context. It also replaces `policy`, `mandatoryChecksOk` and `authorizationCheckedAt` on admission, dispatch and retry.

## Authorizer contract

Return `allowed`, `policy`, `mandatoryChecksOk` and `context`. Context requires actor, policy revision and decision class. TypeScript uses an async callback, typed `Authorizer` in @aiws/sdk/runtime; Python uses a callable returning the same JSON-shaped fields, whose shape current source names `aiws.runtime.Authorizer`; Rust implements `Authorizer` and returns `Authorization`, whose field names follow Rust conventions.

Use an authenticated session or workload identity established by the host. Never read a command's `context.actor` as proof of who sent it. Bind permission evaluation to the selected mission and resource, not just the command name. A valid “approve” command shape is not evidence that the approver is authorized.

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

This example permits `grant`, `revokeGrant`, `approve` and `withdrawApproval` only to a verified human session, and otherwise permits only run creation. It rejects the agent session's grant, records a diagnostic and leaves the mission revision unchanged by the rejection, then accepts the same grant from the human session. Its session flag demonstrates the boundary; it is not authentication. It is a shape and enforcement example, not a complete organizational policy service. Replace its fixed sessions and command allowlist before deployment.

## Grants and delegated scope

A grant defines an exact subject, finite actions/resources, validity interval, allowance, delegation flag and depth. Child grants cannot expand their parent's scope, lifetime or allocation. Wildcards, regular expressions and inferred resource containment are not supported. Ancestor revocation is checked again at dispatch.

**Reject an expanded child grant** (Executable control simulation). Full program: [recipes/grant-scope.rs](../recipes/grant-scope.rs)

```rust
use aiws_sdk::*;
use serde_json::json;

fn main() -> Result<()> {
    // Trusted simulation: no external calls.
    let contract = Contract::parse(&json!({
  "id": "c",
  "missionId": "m",
  "aiwsEdition": "0.4",
  "profile": "finite-v1",
  "budget": "100",
  "deadline": "10000",
  "criteria": [
    "review"
  ],
  "actions": [
    "write"
  ],
  "resources": [
    "doc"
  ],
  "requiresApproval": false,
  "maxAttempts": "2",
  "maxAuthorizationAgeMs": "10",
  "features": [
    "triggers",
    "graphs"
  ]
}).to_string())?;
    let mut state = create_mission(&contract)?;

    // Step 1
    state = reduce(&state, &Command::from_value(json!({
  "type": "grant",
  "grant": {
    "id": "g",
    "subject": "agent",
    "profile": "finite-v1",
    "actions": [
      "write"
    ],
    "resources": [
      "doc"
    ],
    "notBefore": "0",
    "expiresAt": "10000",
    "limit": "100",
    "canDelegate": true,
    "depth": "2"
  }
}))?, "10")?;

    // Step 2
    let rejected = Command::from_value(json!({
  "type": "grant",
  "grant": {
    "id": "child",
    "subject": "agent",
    "profile": "finite-v1",
    "actions": [
      "write"
    ],
    "resources": [
      "doc"
    ],
    "notBefore": "0",
    "expiresAt": "10000",
    "limit": "100",
    "canDelegate": true,
    "depth": "2",
    "parentId": "g"
  }
})).and_then(|command| reduce(&state, &command, "10"));
    assert_eq!(rejected.unwrap_err().code, "AUTHORITY_DENIED");
    println!("PASS: grant-scope");
    Ok(())
}

```

`CONTAINED` means the supported finite comparison succeeded. `INDETERMINATE` is not a permissive result. Failure to interpret authority must block admission. Grant containment alone does not authenticate a principal or enforce operating-system and network access.

## Material-bound action approval

Approval covers a run and action fingerprint, with expiry and a use count. The fingerprint includes capability, resource, payload and preconditions. Changing those values requires a new material decision rather than reusing approval for the old action.

**Bind approval to action material and use count** (Executable control simulation). Full program: [recipes/approval.rs](../recipes/approval.rs)

```rust
use aiws_sdk::*;
use serde_json::json;

fn main() -> Result<()> {
    // Trusted simulation: no external calls.
    let contract = Contract::parse(&json!({
  "id": "c",
  "missionId": "m",
  "aiwsEdition": "0.4",
  "profile": "finite-v1",
  "budget": "100",
  "deadline": "10000",
  "criteria": [
    "review"
  ],
  "actions": [
    "write"
  ],
  "resources": [
    "doc"
  ],
  "requiresApproval": true,
  "maxAttempts": "2",
  "maxAuthorizationAgeMs": "10",
  "features": [
    "triggers",
    "graphs"
  ]
}).to_string())?;
    let mut state = create_mission(&contract)?;

    // Step 1
    state = reduce(&state, &Command::from_value(json!({
  "type": "startRun",
  "runId": "r"
}))?, "10")?;

    // Step 2
    state = reduce(&state, &Command::from_value(json!({
  "type": "grant",
  "grant": {
    "id": "g",
    "subject": "agent",
    "profile": "finite-v1",
    "actions": [
      "write"
    ],
    "resources": [
      "doc"
    ],
    "notBefore": "0",
    "expiresAt": "10000",
    "limit": "100",
    "canDelegate": true,
    "depth": "2"
  }
}))?, "10")?;

    // Step 3
    state = reduce(&state, &Command::from_value(json!({
  "type": "approve",
  "approval": {
    "id": "ap",
    "runId": "r",
    "approver": "owner",
    "fingerprint": "sha256:50487a924d1b8f40e5051f0f8d278469acb1cd15d08dbef8f1010e7f54ae9ef0",
    "expiresAt": "1000",
    "uses": "1"
  }
}))?, "10")?;

    // Step 4
    state = reduce(&state, &Command::from_value(json!({
  "type": "admit",
  "runId": "r",
  "operationId": "o",
  "attemptId": "a",
  "grantId": "g",
  "subject": "agent",
  "action": {
    "capability": "write",
    "resource": "doc",
    "payload": {
      "value": 1
    },
    "preconditions": {
      "revision": 1
    }
  },
  "amount": "10",
  "authorizationCheckedAt": "10",
  "policy": "ALLOW",
  "mandatoryChecksOk": true,
  "approvalId": "ap"
}))?, "10")?;

    // Step 5
    let rejected = Command::from_value(json!({
  "type": "admit",
  "runId": "r",
  "operationId": "o2",
  "attemptId": "a2",
  "grantId": "g",
  "subject": "agent",
  "action": {
    "capability": "write",
    "resource": "doc",
    "payload": {
      "value": 1
    },
    "preconditions": {
      "revision": 1
    }
  },
  "amount": "10",
  "authorizationCheckedAt": "10",
  "policy": "ALLOW",
  "mandatoryChecksOk": true,
  "approvalId": "ap"
})).and_then(|command| reduce(&state, &command, "10"));
    assert_eq!(rejected.unwrap_err().code, "APPROVAL_CONSUMED");

    // Step 6
    state = reduce(&state, &Command::from_value(json!({
  "type": "withdrawApproval",
  "approvalId": "ap"
}))?, "10")?;

    // Step 7
    let rejected = Command::from_value(json!({
  "type": "dispatch",
  "attemptId": "a",
  "authorizationCheckedAt": "10",
  "policy": "ALLOW",
  "mandatoryChecksOk": true
})).and_then(|command| reduce(&state, &command, "10"));
    assert_eq!(rejected.unwrap_err().code, "APPROVAL_INVALID");
    println!("PASS: approval");
    Ok(())
}

```

The SDK binds approval use to logical operations, not every retry attempt. It rechecks current approval validity before dispatch. It does not send an approval notification or authenticate the approver. Store the human decision and relevant evidence in your application, and issue the command through a policy that verifies the human's authority.

## Engine rule: humans control permissions and resource limits

The proposed engine requires human approval for any agent-requested change to its permissions or resource limits. Enforce this in the trusted application policy; the low-level SDK contains no built-in concept of an authenticated human. Dynamic graph proposals must not smuggle in new grants, reset budgets or choose an alternate policy revision. Read [engine decisions](./engine-design.md) for the adopted design direction.
