# Handoffs between steps and recovery boundaries

A handoff is the durable transfer of a specific result and responsibility from one workflow step to the next. It serves normal execution, observability, human review and recovery after interruption. It must identify what is being transferred, the evidence supporting it and what the consumer is authorized to do.

**Status:** M2 implements the opt-in `handoff-v1` source profile natively in TypeScript, Rust and Python. The SDK 0.4.0 packages include these APIs; the earlier **0.3.0 packages remain the finite-v1 baseline** and do not contain them. A background engine, nested work-order accounting and protected summary allowance are separate milestones.

## Runtime contract and identity

The handoff contract (not in this pack) defines `aiws-handoff/1`. Work order and mission identify the same assignment under the accepted WO-01–WO-08 decision. A run is an execution within that assignment. This profile supports same-run deliveries and RUN/BRANCH holds; WORK_ORDER hold resolution and nested resource accounting remain M3 and fail with `SCOPE_UNSUPPORTED`.

The wire schema (not in this pack) validates shapes. The 40 original M1 scenarios are a requirements inventory. The executable M2 corpus separately compares committed events, state hashes, rejections, replay and transaction rollback across the native implementations. See the source `docs/M2-IMPLEMENTATION.md` for measured coverage and limits.

A receipt validates delivery only. Admission reserves work and fixes its inputs; dispatch authorizes an external attempt. Keep these three decisions separate. Releasing a hold preserves spending, attempts, approvals and outstanding exposure. A bounded loop produces a BLOCKED checkpoint at exhaustion; the old finite-v1 journal retains terminal FAILED semantics.

## Public API map

| Purpose | TypeScript | Rust | Python |
|---|---|---|---|
| Import | `@aiws/sdk/handoff` | `aiws_sdk::handoff_store` and `handoff` | `aiws.handoff_store` and `aiws.handoff` |
| Validate immutable record | `new HandoffManifest(value)` | `HandoffManifest::from_value(value)` | `HandoffManifest(value)` |
| Open/create journal | `new HandoffStore(path, contract, config)` | `HandoffStore::open(path, Some(&contract), Some(&config))` | `HandoffStore(path, contract, config)` |
| Reopen existing journal | `new HandoffStore(path)` | `HandoffStore::open(path, None, None)` | `HandoffStore(path)` |
| Application boundary | `HandoffCoordinator` | `HandoffCoordinator` | `HandoffCoordinator` |
| Durable bytes | `FileArtifacts.put/read` | `FileArtifacts::put/read` through `ArtifactProvider` | `FileArtifacts.put/read` |
| Apply/claim | `await host.apply/claim(request)` | `host.apply/claim(&request)` | `host.apply/claim(request)` |
| Committed report | `handoffReport(state)` | `handoff::report(&state)` | `report(state)` |
| Bounded metric counts | `handoffMetrics(state)` | `handoff::metrics(&state)` | `metrics(state)` |
| Notifications | `pendingEvents/acknowledgeEvent` | `pending_events/acknowledge_event` | `pending_events/acknowledge_event` |

`HandoffDelivery`, `HandoffConsumption`, `HandoffHold`, `HandoffSummary`, `HandoffCommand` and `HandoffInvalidation` use the same checked-record pattern. Construction validates shape, not caller authority or current state. Python records are imported from `aiws.handoff_records`; Rust from `aiws_sdk::handoff_records`.

**Validate an immutable handoff record** (Unreleased M2 source; shape validation only). Full program: [recipes/handoff-records.rs](../recipes/handoff-records.rs)

```rust
use aiws_sdk::{Result,handoff::sha,handoff_records::HandoffManifest};
use serde_json::{Value,json};
fn main()->Result<()> {
    // Run from the repository root. This validates shape, not execution authority.
    let fixtures:Value=serde_json::from_str(&std::fs::read_to_string("spec/handoff-v1/fixtures.json").unwrap()).unwrap();
    let value=fixtures["valid"].as_array().unwrap().iter().find(|x|x["id"]=="manifest").unwrap()["value"].clone();
    let record=HandoffManifest::from_value(value)?;
    let digest=sha(record.as_value())?;
    let mut detached=record.as_value().clone();detached["result"]["changed"]=json!(true);
    assert_eq!(sha(record.as_value())?,digest);
    detached["unknownField"]=json!(true);
    assert!(HandoffManifest::from_value(detached).is_err());
    println!("PASS: handoff-records");Ok(())
}

```

## Create durable material before announcing it

Use a dedicated host-owned artifact directory. `put` writes a temporary file, syncs it, publishes an exclusive digest-addressed file and syncs the directory. Existing content must match its digest. If either sync fails, so does `put`. TypeScript, Rust and Python share one platform difference: Windows does not support syncing a directory, so on Windows the directory entry is committed with the file's NTFS metadata and no separate directory sync is made. Keep a Windows artifact directory on an NTFS volume. Do not let an untrusted agent write directly into the store directory.

The host is responsible for retention and backups. `retentionOwner` and `retainUntilMs` record responsibility and an access boundary; they do not schedule garbage collection. Retain bytes while deliveries, recovery or evidence obligations require them. Credentials and expiring signed URLs belong in a private resolver, never immutable locators.

A custom artifact provider returns bytes. The coordinator independently checks SHA-256, size and any referenced schema, with no automatic remote schema retrieval. Verification is repeated at receipt, admission and dispatch. Use the coordinator's verified byte copies for external execution. A digest check does not make artifact text safe instructions.

**Publish and verify immutable local artifacts** (Executable local filesystem example; directory sync required except on Windows). Full program: [recipes/handoff-artifacts.rs](../recipes/handoff-artifacts.rs)

```rust
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

```

## Drive the coordinator from a trusted host

The equivalent examples below create a journal, commit a producer boundary, claim and acknowledge its delivery, admit its consumer, complete the run, reopen the journal and acknowledge safe notifications. They simulate adapter outcomes; they do not run a coding agent or authenticate a real person.

**Run the handoff, receipt and recovery protocol** (Executable local control simulation; fixed identity, clock and adapter outcomes). Full program: [recipes/handoff-coordinator.rs](../recipes/handoff-coordinator.rs)

```rust
use aiws_sdk::{Contract,Result,handoff::{activation,report,sha,HandoffState},handoff_store::{HandoffStore,HandoffCoordinator,FileArtifacts}};
use serde_json::{Value,json};
use std::{collections::BTreeMap,time::{SystemTime,UNIX_EPOCH}};
fn main()->Result<()> {
    // Local control simulation: template settle outcomes do not perform real effects.
    let corpus:Value=serde_json::from_str(&std::fs::read_to_string("spec/handoff-v1/runtime-cases.json").unwrap()).unwrap();
    let demo=&corpus["cases"][0];let contract=Contract::parse(&demo["contract"].to_string())?;
    let root=std::env::temp_dir().join(format!("aiws-handoff-example-{}-{}",std::process::id(),SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
    std::fs::create_dir(&root).unwrap();let path=root.join("run.db");
    let store=HandoffStore::open(path.to_str().unwrap(),Some(&contract),Some(&demo["config"]))?;
    let artifacts=FileArtifacts::new(root.join("material").to_str().unwrap())?;
    artifacts.put(b"hello","artifact:1","text/plain","human:operator","10000",None)?;
    // Fixed demo host principal. Production must authenticate and evaluate policy;
    // a client must never supply this authority object.
    let authority=json!({"allowed":true,"actorId":"human:operator","actorKind":"HUMAN",
        "policy":{"id":"policy","revision":"1"},"authorizedAtMs":"10","materials":{},"materialErrors":{},
        "admissions":demo["steps"].as_array().unwrap().last().unwrap()["facts"]["admissions"],
        "clearEvidence":["material:1","evidence:1"],"restartAllowed":true});
    let authorize=move|_:&Value,_:&HandoffState,_:&str|Ok(authority.clone());
    let mut coordinator=HandoffCoordinator::new(store,authorize,||"10".into(),artifacts);
    let mut tokens:BTreeMap<String,String>=BTreeMap::new();
    for template in demo["steps"].as_array().unwrap(){
        let snapshot=coordinator.store.snapshot()?;let s=snapshot.as_value();let mut request=template["request"].clone();
        let epoch=s["core"]["runs"]["r"].get("epoch").cloned().unwrap_or(json!("0"));
        request["expectedRevision"]=s["revision"].clone();request["ownerEpoch"]=epoch.clone();
        if request["command"].get("body").is_some(){
            request["command"]["expectedRevision"]=s["revision"].clone();request["command"]["ownerEpoch"]=epoch.clone();
            let b=&mut request["command"]["body"];
            if b["type"]=="commitBoundary"{
                let m=&mut b["manifest"];m["basis"]=json!({"revision":s["revision"],"eventHash":s["lastHash"]});
                m["controls"]["accounting"]["revision"]=s["revision"].clone();
                m["inputs"]=s["consumptions"].as_object().unwrap().values().find(|c|c["nodeId"]==m["producer"]["nodeId"]).unwrap()["inputs"].clone();
                m["producer"]["activationId"]=json!(activation(&snapshot,"r",m["producer"]["nodeId"].as_str().unwrap())?);
            }
            if b["type"]=="acknowledgeDelivery"{
                let id=b["deliveryId"].as_str().unwrap().to_owned();let d=&s["deliveries"][&id];
                b["claimToken"]=json!(tokens[&id]);b["generation"]=d["generation"].clone();b["handoff"]=d["handoff"].clone();
            }
            if b["type"]=="admitConsumer"{
                let c=&mut b["consumption"];c["ownerEpoch"]=epoch;c["revision"]=json!((s["revision"].as_str().unwrap().parse::<u64>().unwrap()+1).to_string());
                for input in c["inputs"].as_array_mut().unwrap(){input["handoff"]=s["deliveries"][input["deliveryId"].as_str().unwrap()]["handoff"].clone();}
            }
        }
        if request["command"]["body"]["type"]=="claimDelivery"{
            let (_,token)=coordinator.claim(&request)?;tokens.insert(request["command"]["body"]["deliveryId"].as_str().unwrap().to_owned(),token);
        }else{coordinator.apply(&request)?;}
    }
    let before=sha(coordinator.store.snapshot()?.as_value())?;drop(coordinator);
    let mut reopened=HandoffStore::open(path.to_str().unwrap(),None,None)?;
    assert_eq!(sha(reopened.snapshot()?.as_value())?,before);assert_eq!(report(&reopened.snapshot()?)?["spent"],"3");
    // A real exporter acknowledges after durable acceptance by its receiver.
    for event in reopened.pending_events(100)?{assert!(event["eventId"].is_string());reopened.acknowledge_event(event["sequence"].as_str().unwrap())?;}
    assert!(reopened.pending_events(100)?.is_empty());drop(reopened);std::fs::remove_dir_all(root).unwrap();
    println!("PASS: handoff-coordinator");Ok(())
}

```

The host authorizer receives the request, current snapshot and time. It must authenticate the actor, evaluate the exact command under current policy, resolve approved admission references, and validate evidence IDs against its trusted evidence store. Never copy client-supplied `allowed`, actor kind, evidence or admission facts into this callback. The callback's authorization timestamp is preserved through artifact reads and checked again at commit. A concurrent state change yields a revision conflict; refresh and reauthorize the request.

Pure reducers and direct `store.apply` calls are trusted/offline APIs. Do not expose them to clients. The coordinator overrides caller material assertions with independent verification. On a failed transaction, no new material handle is available. Serialize calls to a coordinator when using its last-result material accessor; each worker should have its own coordinator and request lifecycle.

**Duplicate dispatch rule:** TypeScript and Python responses contain `committed`; Rust responses contain an optional `event`. A duplicate returns its original logical result with `committed: false` or `event: None`. Never perform an external action from that response. A newly committed dispatch still needs an idempotent adapter and outcome reconciliation if its response is lost. The SDK cannot make an arbitrary external API exactly-once.

## Checkpoints, holds and intervention

- `commitBoundary` commits a checkpoint, immutable manifest, recipient intents and any required hold together. A rollback leaves none of those records visible. Artifacts written before a failed commit can remain orphaned; the host later cleans them up under retention policy.
- A non-success BLOCKED checkpoint must carry an appropriately scoped hold and every outstanding producing attempt. FAILED and CANCELED checkpoints terminate the run in this profile while retaining exposure and accepting truthful late settlements. They never resume terminal execution.
- `claimDelivery` establishes actor-bound, leased receipt ownership. `acknowledgeDelivery` requires the current claim, matching material and trusted evidence. Lost responses do not duplicate admission. Recovery fences stale epochs and restores unacknowledged claims to pending.
- `admitConsumer` atomically fixes the input set and reservation. An ALL join may accept a skipped input only when explicitly listed in immutable `optionalInputs`. An ANY join cannot abandon another predecessor's reserved or active work.
- `placeHold` derives RUN or branch-descendant membership from the pinned graph. `resolveHold(RECHECK)` releases only a demonstrably cleared hold. An invalidated input stays blocked pending a separately governed replacement; there is no force-clear command.
- On material failure the attempted command is rejected without a partial commit. The host records an owned artifact hold using `placeHold` and presents repair options. Repairing the identical bytes permits revalidation; changed bytes require a new result and invalidation/replanning.
- `recoverOwnership` applies AUTO, HUMAN or RULE policy and preserves admitted work. Uncertain effects require human intervention. It does not restart an agent process, restore a sandbox or schedule tasks.

A hold is an independent gate. The current run lifecycle field is not a complete scheduler aggregate: hosts should combine it with ready-node and hold projections. Task-aware draining, automated timer services and lifecycle aggregation belong to the engine.

## Reports, summaries and telemetry

Reports and metric counts derive from committed state without a model call. Counts cover delivery states, open holds, blocked nodes, manifests and consumptions. Notifications carry stable event IDs and mission/run/request correlation; the durable outbox survives restart. Acknowledge after the receiving system has stored an event. Delivery is at least once, so receivers deduplicate by event ID.

No material bytes, locator credentials, summary text or claim token is automatically included in notification projections. Host-assigned identifiers must themselves be non-secret. The full audit export is a privileged record containing command data; never treat it as a redacted telemetry payload. Hosts own export scheduling, rejection counters, alert routing and telemetry retention.

`recordSummary` records an optional explanation with exact manifest basis and authenticated author. HUMAN attribution requires a human actor. MODEL summaries require a matching, successfully settled governed operation in the same run. The host supplies generation through an already admitted and bounded task; the SDK never starts a paid model call automatically. If the generator is unavailable or no approved budget remains, omit the summary and use the deterministic report. This does not implement M3's protected summary allowance.

## Compatibility and recovery procedure

1. Open the original journal with its original profile. Legacy and handoff stores reject each other's databases; do not relabel or import historical terminal loops into the new decoder.
2. Reopen the handoff journal and inspect holds, pending deliveries, reservations and unresolved operations. Replay verifies every event against the native reducer.
3. Apply the authorized ownership recovery policy. Investigate uncertain external outcomes before considering another dispatch.
4. Restore required immutable bytes and recheck current authorization. Resolve only holds whose actual blockers are clear.
5. Resume through the coordinator with the original operation/consumption identities. Do not reconstruct control state from summary prose.

SQLite uses FULL synchronous WAL transactions. A failed callback before commit is tested for rollback; close/reopen and lost-response paths are tested separately. Hardware power-loss durability still depends on the filesystem and device honoring synchronization. History compaction and months-long operational qualification remain later work.

## Design rationale and remaining engine work

The following design rationale includes requirements for later engine milestones. The API boundary above states what M2 implements.

### Two layers of a handoff

The authoritative layer is machine-readable: immutable IDs, revisions, artifact digests, outcomes, outstanding effects, policy references and delivery state. The explanatory layer is a human/agent-readable summary derived from that record. The summary may explain intent and caveats, but cannot grant authority, change criteria or replace the underlying evidence.

The engine should create a minimal handoff automatically at every committed step boundary. An agent can supplement it within the reserved allowance. During an abrupt power failure no final agent call is possible; the next process must rebuild the handoff from already-committed state.

## Proposed handoff record

| Field family | Purpose and required interpretation |
|---|---|
| Identity | handoff ID, schema version and immutable revision |
| Ownership | work-order, workflow/run, producer node, logical operation and producing attempt IDs |
| Basis | committed source event/sequence, plan/graph revision and authoritative state reference |
| Delivery | recipient node or recipient set, delivery identity, claim generation and acknowledgement |
| Artifacts | immutable reference, digest, media type, schema/version, size and declared retention |
| Outcome | result disposition, completed criteria, pending obligations and uncertain effects |
| Controls | current policy/approval references and recorded resource accounting; these are references, not new grants |
| Context | approved intent, relevant decisions, assumptions and limitations; no hidden reasoning requirement |
| Resume | next eligible task/checkpoint and blockers, with required revalidation |
| Summary | human-readable narrative, its author/generator and the exact basis revision |

Artifact content must be durably available before the handoff announces it. For a local file adapter, that can require durable file writes and directory metadata before committing a reference. For an object store, verify successful upload and its immutable reference before the ledger transaction. Orphan uploads can be garbage-collected; a committed handoff must never point at an upload merely planned in memory.

## Proposed commit and delivery sequence

1. The producer completes or reconciles its effect and validates its output contract.
2. It durably stores output artifacts and obtains immutable references and digests.
3. The engine atomically records node completion, the handoff manifest and downstream delivery intents.
4. An eligible consumer claims its delivery under current ownership, authenticates its authority and verifies artifact/schema/plan compatibility.
5. The consumer durably acknowledges receipt of that exact handoff revision before starting governed work.
6. Its eventual completion creates another handoff linked to the consumed revision.

An acknowledgement means “received and validated,” not “task succeeded.” Separate consumer execution and acceptance records establish those outcomes. Use one delivery identity per consumer at fan-out; a join records exactly which predecessor handoffs it consumed. Retries preserve logical identity while changing attempt identity.

No consumer should execute untrusted instructions hidden inside artifact text as engine policy. Context is input material. The authorizer and approved workflow decide which capabilities may be used.

## Failure cases and required behavior

| Failure | Proposed behavior |
|---|---|
| Artifact stored, ledger commit fails | No delivery becomes visible; retain or collect orphan artifact |
| Node completion commits, process crashes | Delivery intent survives in the same transaction |
| Delivery is duplicated | Same consumer delivery ID prevents duplicate admission |
| Consumer crashes after claim | Resolve ownership before another consumer proceeds |
| Receipt acknowledged, execution crashes | Resume from consumer state; acknowledgement alone is not proof of an effect |
| Artifact missing or digest mismatches | Block consumer, retain evidence and require repair/review |
| Plan changes before consumption | Reject stale assumptions or explicitly authorize a compatible transition |
| Producer result is invalidated | Mark dependent handoffs stale; pause affected downstream work and assess already-applied effects |
| Branch skipped | Record the disposition so joins do not wait forever for a nonexistent success handoff |
| External effect remains uncertain | Issue a blocked handoff for human review; never represent it as ready work |
| Summary generation fails | Preserve the machine record and provide an engine-generated basic report |

## Current SDK recipe

**Build a human-readable handoff from a verified audit snapshot** (Executable application recipe). Full program: [recipes/handoff.rs](../recipes/handoff.rs)

```rust
use aiws_sdk::*;
use aiws_sdk::sqlite::{SqliteStore,import_audit};
use serde_json::{json,Value};
fn main() -> std::result::Result<(),Box<dyn std::error::Error>> {
    let contract=Contract::parse(&std::fs::read_to_string("examples/guide/contract.json")?)?;
    let mut store=SqliteStore::open(":memory:",Some(&contract))?;
    store.apply(&Command::from_value(json!({"type":"startRun","runId":"r"}))?,"10",None)?;
    let audit=store.export_audit()?;
    let state=import_audit(&audit)?;
    let s=state.as_value();
    let bundle:Value=serde_json::from_str(&audit)?;
    let unresolved:Vec<_>=s["attempts"].as_object().unwrap().values()
        .filter(|a|a["status"]=="DISPATCHED"||a["status"]=="UNKNOWN")
        .map(|a|a["id"].clone()).collect();
    println!("{}",json!({"format":"example-handoff/1","missionId":s["contract"]["missionId"],
        "revision":s["revision"],"auditDigest":bundle["digest"],"spent":s["spent"],"reserved":s["reserved"],
        "unresolved":unresolved,"nextDecision":"Inspect current authority and pending work before resuming."}));
    Ok(())
}

```

The example imports one audit bundle and derives the report from that exact snapshot, avoiding a separate live-state read that could describe a later revision. The resulting example-handoff/1 object is application data, not an AIWS Command. It intentionally prints a report rather than pretending to implement the proposed queue or artifact protocol.

Today you can include additional application artifact references in a completeNode result and validate their shape with outputSchema. Verification of artifact bytes, cross-step input mapping, transactional handoff delivery and acknowledgements must be supplied by the application or future engine. Never add handoff fields to closed wire commands or contracts; they will be rejected.

## Budget and intervention rules

The user-approved design protects a small reserve within the existing allowance for checkpointing and handoff. Main work cannot borrow it automatically. Agent-written summaries use that reserve and stop when it is exhausted. The engine-generated record does not depend on another paid model call.

A branch limit holds that branch and dependent work; a work-order limit holds all descendants. Human intervention is required for uncertain outcomes and any change to agent permission or resource limits. Resuming later preserves spent resources, outstanding reservations and approval history.
