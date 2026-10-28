# Reference host: the Annex B corrective action

The other recipes each isolate one rule. This one assembles them into a host. It runs the corrective action from [STANDARD.md Annex B](./standard.md) end to end, with released SDK 0.4.0 APIs, and prints the same record in TypeScript, Rust and Python.

Annex B is informative. It illustrates the semantic contract; it is not a regulatory procedure, and its thresholds are project choices for the adopting organisation. The recipe keeps that status: every id the run records, such as the mission, contract, run, case, operation, approval and wait ids, carries the `example:` prefix, and the result record is marked `exampleOnly`. Principal, policy and resource names such as `human:designated-verifier`, `policy:example:annex-b:1` and `case:guarding-17` are local to the recipe and do not take the prefix. Physical implementation and the decision to return the equipment to service stay separate human responsibilities, outside the workflow.

The recipe runs the working path and the failure paths a host must handle truthfully: a case write that times out and is resolved by a read-only `reconcile` at the next start-up, an agent's denied attempt to widen its own grant, a denied `adjust`, a placeholder adapter that reports UNKNOWN, and an acceptance that ends INCONCLUSIVE and DEFERRED. It is the known-good host the agent skills compare against.

## The workflow

The work order has two runs. Run 1, `example:run:guarding-17`, assembles the corrective-action package. Its plan is assembling and assessing the available package, so it can complete while acceptance is deferred, as Annex B allows:

| Node | Kind | What happens | Completion proof |
| --- | --- | --- | --- |
| `collect-records` | TASK (AGENT) | The investigator agent reads the approved inspection records | The confirmed read operation |
| `request-more-records` | LOOP, at most 3 iterations | The agent requests each kind of record it still lacks | One confirmed read per iteration, and `done` |
| `draft-action` | TASK (AGENT) | The agent drafts the corrective action from the records it read | The confirmed draft operation |
| `engineering-review` | APPROVAL | The engineering reviewer approves the exact case update | The unexpired approval |
| `update-case` | TASK (TOOL) | The case record is updated under that approval and a version precondition | The confirmed write operation |
| `end` | END | The package is assembled | Disposition COMPLETED |

Once run 1 completes, the designated verifier assesses it. No implementation evidence exists yet, so the two criteria that need it are INCONCLUSIVE, and the verifier defers acceptance. The run's result is Annex B's illustrative result exactly: COMPLETED, INCONCLUSIVE, DEFERRED, and not a verified success.

The assessment of run 1 sits outside its graph because the SDK completes a VERIFICATION node only on a PASSED verification and an ACCEPTANCE node only on an ACCEPTED decision. Those nodes belong to the linked follow-up run, `example:run:guarding-17:implementation`, whose active task is obtaining the evidence:

| Node | Kind | What happens | Completion proof |
| --- | --- | --- | --- |
| `implementation-evidence` | WAIT | The authorized technician's attestation arrives as an event | The satisfied wait |
| `verification` | VERIFICATION | The designated verifier assesses every criterion against the package and the attestation | The PASSED verification revision |
| `acceptance` | ACCEPTANCE | The designated verifier accepts that verification revision, as Annex B's criteria require | The ACCEPTED revision |
| `notify-case-owner` | TASK (TOOL) | The host notifies the case owner, who decides return to service | The confirmed notification operation |
| `follow-up-end` | END | The follow-up is complete | Disposition COMPLETED |

The notification goes through a placeholder adapter, so it never confirms: the follow-up run is verified and accepted but stays held at `notify-case-owner`, and is not a verified success either.

The run loop is plain host code. It reads the snapshot, answers the inbox while the run is WAITING, otherwise takes the next node from `readyNodes`, performs that node's work and completes it with its proof. The SDK checks each proof by kind in `completeNode`, so a node cannot complete without a confirmed effect, a live approval, a satisfied wait or the right assessment. A wait opens a durable `wait` record, moves the run to WAITING, and routes the wait to exactly one principal; `join` brings the run back to READY once that principal resumes it.

## What is real, what is simulated

Real, not mocked:

- the run loop over the graph, with ready nodes, dispatch, per-kind completion proofs, waits and the loop bound;
- a deny-by-default authorizer that returns an attributed decision: the session's actor, the decision class (`HUMAN` for a human principal, `DETERMINISTIC` otherwise) and the policy revision;
- the limits ledger reservation paired with mission dispatch in the order the [budgets chapter](./budgets.md) documents;
- truthful effect outcomes, evidence and verification;
- start-up recovery: the host closes its stores when it stops and reopens them at the next start-up, where `recover` and a read-only `reconcile` run before any new work;
- one mission store and one ledger store for the one worker;
- an injected clock, the same one for both stores;
- immutable local artifacts: content-addressed, created once with create-new and fsync, never rewritten.

Simulated, and each marked "replace before deployment" in the code:

| Simulated part | In the recipe | Replace it with |
| --- | --- | --- |
| Human identity | Fixed sessions for the runner, worker, agent, owner, reviewer, technician and verifier | Authenticated principals, verified before a command reaches the authorizer |
| The inbox | An in-memory queue that the script answers | An authenticated application inbox; a notification is an application effect with its own outcome |
| Event ingress | The technician's attestation built in the script | An authenticated event source and a check of the attesting person's authority |
| Telemetry export | A collector that accepts every payload | A collector client with a timeout and redirects disabled |
| The records system, the agent and the case-record system | Local stand-ins with fixed records, a deterministic drafter and a versioned JSON file | The real systems, each behind its own effect adapter and operation contract |
| The notification client | A placeholder adapter that calls nothing and reports UNKNOWN | The application's notification client, behind an adapter with its own operation contract |
| An agent that oversteps | A scripted request for a wider grant and a higher cost limit | Nothing: a real agent's requests reach the same authorizers |
| The ledger settlement after reconciliation | The case owner settles the ledger on the read-back, scripted | An authenticated human decision on the reconciliation evidence |

The restart happens inside one process. It closes and reopens both stores, but the recipe's evidence index (which artifact evidences which attempt) and its trail of committed steps stay in memory; a deployed host keeps them durable beside its artifacts.

The clock the recipe injects is scripted, so every language prints the same record. Beside it the recipe defines the real clock a deployed host injects instead, which reads trusted UTC time in epoch milliseconds from the system clock. The recipe's contract deadline is 8 hours after the epoch, long past on the real clock, so it checks only that the real clock reads canonical epoch milliseconds past that deadline.

Out of scope, and nothing here covers them: secrets, sandboxing, child runs and deployment verification. The recipe delivers no credential, isolates no process, starts no child run and does not verify a deployment.

## Authority

The authorizer allows a command only when a rule names its session; everything else is denied. The rules:

| Session | Allowed |
| --- | --- |
| Runner (`host:runner`) | `startRun`, `continueRun` (which `recover` issues), `registerGraph`, `attachGraph`, `wait`, `transition`, `join`, `completeNode` |
| Agent (`agent:investigator`) | `admit` for its own subject, for an action on the contract's list; `update-case` only with an approval |
| Worker (`host:worker-1`) | `dispatch` and `settle`, which the coordinator issues around the adapter call and in `reconcile` |
| Case owner (`human:case-owner`) | `grant` |
| Engineering reviewer | `approve`, naming itself as approver |
| Designated verifier | `verify`, naming itself as assessor, and `accept`, naming itself as authority |
| The principal a wait is routed to | `resume` of that wait |

The agent can request work but cannot report its outcome, approve it, verify it or change any grant. The ledger has its own deny-by-default authorizer: the agent may `reserve`; the worker may `dispatch`, `settle`, `unknown` and `release`; the case owner may `settle` an attempt the ledger holds as UNKNOWN; and a `settle` is allowed only with the digest of the artifact that evidences the outcome. No session may `adjust`.

### Root-grant authoring

The case owner, a human, writes the agent's root grant. A root grant has no parent, so the contract is its only bound: the SDK refuses a grant that lists an action or resource the contract does not, a limit above the budget or an expiry after the deadline. This one is narrower than the contract: 10 capability calls against a budget of 100, with no delegation.

### Denied escalation

Before the run loop starts, a scripted agent oversteps. It submits a `grant` for a wider grant of its own, with the contract's whole budget as its limit; the mission authorizer denies it as `AUTHORITY_DENIED`, and the store records the rejection, attributed to the agent. It then requests a ledger `adjust` to raise the work order's cost limit; the ledger authorizer allows no adjustment, so the ledger refuses it as `AUTHORIZATION_DENIED` and records nothing. The record shows the grant and the work order's limit unchanged. Only a human changes an agent's permissions or limits, and in the ledger an `adjust` also needs a human actor with an evidence reference.

## The approval binding

The `engineering-review` node opens an authorization wait routed to the reviewer. The case update under review is one exact action: the new status, the digest of the drafted corrective action, the digests of the record revisions behind it, and the precondition that the record is still at version 1. The reviewer approves that action's fingerprint, with an expiry an hour ahead and a use count of one. The `update-case` admission carries the approval. The SDK recomputes the fingerprint from the admitted action, so a changed draft, a different set of records or another version would be refused as `APPROVAL_INVALID`, and a second write would be refused as `APPROVAL_CONSUMED`. The record shows the approval consumed by that one operation.

The reviewer's tool derives the fingerprint from the action it shows, with the SDK's `fingerprint` function, the same function admission uses; no hash is typed in. The recipe's assertions check it against a known value.

## Effects in the documented order

Every effect, the reads, the draft, the case write and the notification alike, runs through one host function, `perform`:

1. reserve the attempt in the limits ledger;
2. admit the mission attempt; a refused admission releases the unused reservation;
3. record ledger dispatch, before any external call;
4. call `Coordinator.dispatch`, which commits DISPATCHED, calls the adapter and settles its outcome;
5. settle the ledger with the actual cost and the evidence digest, or mark it `unknown`, which keeps the whole reservation.

The two stores do not share a commit. A crash between them conservatively keeps exposure, and only reconciliation or a human decision resolves it. An outcome other than CONFIRMED_APPLIED stops the host before the node completes, so no further work starts; the host never retries on its own. A restarted host never repeats an operation it already admitted: it completes the node only when that operation's outcome is confirmed. The record of an UNKNOWN attempt is its outcome and the ledger's `unknown` mark; the recipe writes no separate hold.

## Start-up recovery

Before it takes any work, the host opens its stores and recovers every run that is not terminal. `Coordinator.recover` continues the run in a new segment, which fences any attempt prepared under the old one, and lists the run's unresolved attempts. The host reconciles each through the adapter that dispatched it, read-only. When reconciliation confirms the outcome, the case owner settles the ledger on the read-back; the ledger accepts a settlement of an UNKNOWN attempt only from a human with evidence. When the outcome is still UNKNOWN, nothing settles it and the run stays held for a human.

The recipe starts the host at each of these points:

- At the first start-up there is no open run.
- The case write commits and then loses its acknowledgment, as STANDARD.md Annex C.1 suggests a test target should, so the attempt is UNKNOWN and the host stops. At the next start-up, `reconcile` finds the operation's own version in the case record and settles the attempt CONFIRMED_APPLIED, with the record it read as evidence; the case owner settles the ledger on it, and run 1 continues to completion.
- The follow-up run's notification is UNKNOWN and the host stops again. At the next start-up the placeholder's `reconcile` reports UNKNOWN too, so the notification keeps its reservation in both stores and the follow-up run stays held.

## Outcomes the adapters report

The adapters follow the SDK forms of NG-01 and NG-02 from the [governance rule set](https://github.com/seanrobertwright/AI-WS-SDK/blob/main/docs/research/skill-governance-rule-set.md). A thrown error reaches the coordinator, which records UNKNOWN; no adapter turns a timeout or an exception into CONFIRMED_APPLIED or CONFIRMED_NOT_APPLIED.

- The records reader and the drafter report CONFIRMED_APPLIED once their artifact is durable. A read leaves nothing at the source to look up, so their `reconcile` reports UNKNOWN for a human to resolve.
- The case-record stand-in has an operation contract: it applies an update only at the expected version, applies nothing when that precondition fails, and keeps a history of which operation wrote each version. A repeated operation is therefore recognised rather than applied twice, and a failed precondition is CONFIRMED_NOT_APPLIED, with the record it read as evidence, only for an operation the history shows wrote no version. Its `reconcile` is read-only: CONFIRMED_APPLIED, with the record it read as evidence, when the history shows this operation wrote its version, otherwise UNKNOWN.
- The placeholder adapter calls nothing and reports UNKNOWN from `execute` and `reconcile` alike. A host wired to an adapter that is not written yet therefore holds the node, instead of claiming the effect happened or did not.

## The record it prints

Each language prints one canonical JSON record, and the records are identical:

- `result`, in the shape of Annex B's illustrative result, with `exampleOnly: true`: run 1 is COMPLETED, INCONCLUSIVE and DEFERRED, `issue-identified` and `engineering-reviewed` are PASS, and the two criteria that need implementation evidence are INCONCLUSIVE.
- `followUp`: the follow-up run is RUNNING, PASSED and ACCEPTED, and not a verified success, with the reasons `EXECUTION_NOT_COMPLETED` and `EFFECT_UNKNOWN`.
- `approval`: the approver, fingerprint, expiry, use count and consuming operation, beside the case update it is bound to.
- `effects`: for each operation, its node, outcome and actual cost, the steps the host committed in order, including recovery and reconciliation, and the ledger attempt's final status, amount, cost, evidence digest and the actor that settled it.
- `startUps`: for each start-up, the runs it recovered, each with its new segment and the outcome reconciliation reached for each unresolved attempt.
- `grant`, `denials` and `rejections`: the root grant as authored and who granted it, each request of the agent's that was refused, with its code, and the mission store's record of the refused grant.
- `assessments`: for each run, the assessor, the evidence digests, the verification state, the acceptance authority and the decision.
- `accounting`: mission spend and reservation beside the ledger's cost and attempt usage, with the notification's reservation still held, and `telemetry`, the export result.

**Run the Annex B corrective action through a reference host** (Executable reference host; simulated identity, inbox, event ingress, telemetry export and external systems, each marked replace before deployment). The program is too long to show here: read [recipes/corrective-action.rs](../recipes/corrective-action.part-1.rs).

Run it with every other recipe, from the source root, with `node scripts/check-guide-examples.mjs`. Adapting it to a real case system starts with the simulated parts above, then the integration tests the [cookbook](./cookbook.md) asks for.
