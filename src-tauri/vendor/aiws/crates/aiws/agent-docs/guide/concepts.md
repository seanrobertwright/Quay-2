# The execution model

[The AI Workflow Standard](./standard.md) separates the assignment, authority to act, observed effects and assessment of the result. Keeping these records distinct prevents a completed process from being confused with an accepted deliverable.

## Follow the identity chain

| Identity | What it represents | Lifetime |
|---|---|---|
| Mission identity | Durable assignment identity, mapped to engine workOrderId | Preserved across runs; current store is one mission |
| Contract | Immutable criteria, deadline, budget and supported profile | Contract.id is distinct from missionId |
| Run | An execution within that mission | Survives continuation |
| Plan revision | Approved or selected plan lineage | Changes through compare-and-swap activation |
| Segment | A continuation/ownership boundary | New identity on recovery |
| Graph / node | Dependency structure and a checkpoint in it | Graph fixed once attached |
| Operation | One logical external action and its admitted scope | Same operation across safe retries |
| Attempt | A particular dispatch and settlement | New identity for each retry |
| Wait | Correlated pending input, timer or authorization | Explicit expiry and satisfaction |
| Assessment | Verification or acceptance attached to the current subject | Can be invalidated |
| Handoff | Transfer of outputs and responsibility | Proposed engine protocol; see handoffs |

The accepted engine model maps workOrderId to the existing Contract.missionId value. Work order and mission are the same assignment; Contract.id identifies its governing contract. A separate engine WorkOrder record contains runs and optional children. Do not insert workOrderId into the closed current Contract schema. See WO-01 through WO-08 in Engine decisions for the versioned contract and compatibility rules.

## Four separate questions

1. **May this actor act?** The host authenticates the caller and checks current policy. Grants constrain finite resources, actions, purposes, validity and spending. An approval may be required for the exact action fingerprint.
2. **What happened?** The adapter reports confirmed application, confirmed nonapplication or uncertainty. A process exit or HTTP timeout alone may not establish the external effect.
3. **Did execution finish?** Explicit run transitions and graph checkpoints establish completion. Unsettled work blocks completion.
4. **Was the deliverable accepted?** Verification and acceptance must be current and consistent with the contract. Assess success only after execution has completed.

## Pure core and trusted runtime

The reducer is deterministic with an explicit clock value. It evaluates a command and returns a new snapshot or an error; it does not execute tools, start timers or authenticate a user. The SQLite store adds transactions and replayable history. The coordinator adds the application authorizer and the boundary around effect dispatch. A scheduler, identity service, artifact service and human inbox belong to the application or future engine.

Use the pure API for simulations, command planning and cross-language parity. Use the coordinator at an application's command boundary. Never let an untrusted agent obtain the database handle or call store.apply directly.

## Values that cross languages

Use canonical decimal strings for quantities and UTC epoch milliseconds. JSON numbers must be safe integers; floating-point prices, NaN and Infinity are not wire values. Choose an exact accounting unit, such as microcredits, outside the SDK and use it consistently. An SDK cost is not automatically a provider invoice, token counter or currency conversion.

Identifiers are immutable strings. Generate them once and persist them before a network retry. Distinguish a logical operation ID, attempt ID, trigger-event ID and handoff delivery ID; each deduplicates a different boundary.

Continue with the [implementation tutorial](./tutorial.md) and the [capability matrix](./capabilities.md).
