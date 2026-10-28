# Budgets, attempts and stopping scope

The finite-v1 budget is mission-wide, with additional accounting on the grant chain. The **M3 source profile, aiws-limits/1**, adds a shared ledger for nested work-order, run, branch and node limits. Amounts are canonical unsigned decimal strings, representing units chosen by the contract owner. Do not put fractional currency into payloads or accounting fields; choose integer minor units and document the unit scale.

## Admission and reservation

Admission reserves exposure before an effect is allowed. Settlement releases the attempt's reservation and adds its actual cost. UNKNOWN preserves the full reservation. Actual cost above the admitted amount is rejected as `EXPOSURE_EXCEEDED`; this flags a control violation and does not make the real external charge disappear.

**Reject reservations beyond the shared allowance** (Executable control simulation). Full program: [recipes/budget.rs](../recipes/budget.rs)

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
  "amount": "80",
  "authorizationCheckedAt": "10",
  "policy": "ALLOW",
  "mandatoryChecksOk": true
}))?, "10")?;

    // Step 4
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
  "amount": "30",
  "authorizationCheckedAt": "10",
  "policy": "ALLOW",
  "mandatoryChecksOk": true
})).and_then(|command| reduce(&state, &command, "10"));
    assert_eq!(rejected.unwrap_err().code, "BUDGET_EXHAUSTED");
    assert_eq!(state.as_value()["reserved"], json!("80"));
    println!("PASS: budget");
    Ok(())
}

```

A rejected command leaves the input state unchanged. SQLite also rolls back the journal and outbox intent together. Concurrent admissions must use the durable store boundary; separate in-memory reducers do not create a shared atomic budget.

## Size allowances from enforceable bounds

A reservation should cover the maximum authorized exposure of that attempt, not an optimistic average. Enforce provider limits, process timeouts and restricted credentials at the target where possible. If an adapter cannot cap its cost, explain that limitation to the operator before claiming a hard bound. Reservations protect admission decisions; they cannot cancel an already submitted external operation by themselves.

## Nested limits: M3 source APIs

The accepted engine model has work orders containing runs and optional child work orders, with limits at work-order, run and branch scopes. Any applicable exhausted limit blocks additional work in its scope. A branch limit holds that branch and dependent tasks. A work-order limit holds all descendants. Independent branches may continue only if their own and all shared allowances permit it.

Use `LimitStore` and `LimitCoordinator` from `@aiws/sdk/limits`, `aiws.limits_store`, or `aiws_sdk::limits_store`. One ledger database owns every scope sharing a parent budget. It reserves cost and active time against all ancestors in one SQLite transaction. Immutable dependencies add admission gates without charging cost twice. The existing mission and handoff stores keep their own contracts and authority checks.

**Reserve ordinary work and protected handoff funds** (M3 source; fixed clock and simulated authenticated host, no external calls). Full program: [recipes/nested-limits.rs](../recipes/nested-limits.rs)

```rust
use aiws_sdk::{limits_store::{LimitStore, LimitCoordinator, LimitAuthorizer}, parse_strict, Result};
use serde_json::{json, Value};
// Demonstration only: a real host verifies the initial approval and each command.
struct DemoHost;
impl LimitAuthorizer for DemoHost {
    fn authorize(&mut self, _: &Value, _: &Value, now: &str) -> Result<Value> {
        Ok(json!({"allowed":true,"actorId":"demo-agent","actorKind":"AGENT","policyRef":"demo-policy","evidenceRef":null,"authorizedAtMs":now}))
    }
}
fn main() -> Result<()> {
    let config = parse_strict(&std::fs::read_to_string("examples/guide/limits-config.json").unwrap())?;
    let store = LimitStore::open(":memory:", Some(&config))?;
    let mut coordinator = LimitCoordinator { store, authorize: DemoHost, clock: || "0".to_owned() };
    for (attempt, purpose, amount) in [("work", "ORDINARY", "90"), ("summary", "HANDOFF", "10")] {
        let revision = coordinator.store.snapshot()?["revision"].clone();
        coordinator.apply(&json!({"requestId":attempt,"expectedRevision":revision,"command":{"type":"reserve","attemptId":attempt,"operationId":attempt,"scopeId":"run","runId":"run","purpose":purpose,"amount":amount,"maxActiveMs":"10"}}))?;
    }
    let report = coordinator.store.report("0")?;
    let usage = &report["scopes"].as_array().unwrap().iter().find(|s|s["scopeId"]=="wo").unwrap()["usage"];
    assert_eq!(usage["cost"], "100"); assert_eq!(usage["handoff"], "10");
    println!("{report}"); // Always available, even when paid work is blocked.
    Ok(())
}

```

The example's `examples/guide/limits-config.json` defines a work order `wo` and its run `run`. The work order has a total cost ceiling of 100, with 10 protected for handoff. The run inherits its parent's bounds. Its fixed clock and simulated authorizer are demonstration inputs; production hosts must authenticate callers, approve the initial config and bind scope/purpose to the trusted workflow definition.

| Limit | Meaning |
|---|---|
| cost | Settled cost plus all unsettled maximum exposure |
| handoff | Protected partition inside cost; only host-authorized HANDOFF work consumes it |
| activeMs | Sum of concurrent execution time, with pre-dispatch maximum reservations |
| elapsedMs | Time since immutable scope start, including pause and downtime |
| attempts | One per successful reservation; release and continuation do not reset it |

Null bounds inherit ancestor restrictions. All bounds apply together. Two concurrent ten-millisecond attempts consume twenty active milliseconds at their parent. UNKNOWN continues accruing active time through downtime. A host-verified `stop` freezes time but keeps financial exposure; settlement releases only unused cost. Human reconciliation is required to resolve UNKNOWN.

## Pair the ledger with existing dispatch gates

Reserve in the ledger before preparing the mission attempt. Record ledger dispatch and pass existing mission/handoff dispatch checks before any external call. These databases do not share an atomic commit: a crash between them conservatively retains exposure and needs reconciliation. Never refund a DISPATCHED attempt merely because the host restarted. Current authority, ownership, artifacts, approvals and handoff inputs still apply. The ledger alone is not authorization to act.

`store.report(now)` identifies blocked scopes, affected dependents, usage and outstanding attempts without an LLM call. Stop and settlement remain available while new work is blocked. The host applies task-specific interruption policy to running effects; the SDK cannot stop an external provider by itself.

## Handoff reserve

The accepted design reserves a small human-approved amount inside the existing allowance for checkpointing and handoff. It is not extra money beyond the limit. Main work cannot consume that protected reserve. The engine produces a basic report from durable state even when no agent allowance remains; an agent-written explanation is optional and must fit the reserve.

No agent may raise permissions, budgets or retry limits, including by generating a new workflow or transferring work to another agent. Human approval is required. SDK contracts are immutable; do not change a persisted contract to bypass a rejected operation. See [migration](./migration.md) before moving into a different contract.

The new ledger's `adjust` command requires authenticated HUMAN facts and a host-verified evidence reference for the exact change. It preserves prior spending, attempts, active time and scope start times. Ordinary work and paid cleanup cannot consume the handoff partition. Paid summaries still obey time and attempt bounds; use the deterministic report when those are exhausted. Previously built 0.3.0 binary downloads do not include these source APIs.
