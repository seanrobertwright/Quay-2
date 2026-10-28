# 19 Node contracts and execution semantics

A node is a versioned unit in a workflow graph. Node identity is distinct from task, logical operation, and attempt identities; bindings SHALL state the mapping. The following node catalog is normative for implementations claiming the corresponding feature. A runtime need not enable every node kind, but SHALL reject definitions requiring an unsupported kind under C-02.

| Node kind | Required semantic behavior |
|---|---|
| TASK | Perform declared work with executionKind AGENT, FUNCTION, TOOL, or HUMAN; consequential operations pass the same dispatch boundary. |
| DECISION | Evaluate a declared predicate or recorded assessed result; retain the selected route and decision basis. |
| FORK | Enable the declared branches without duplicating authority or aggregate budgets. |
| JOIN | Apply an explicit ALL, ANY, or profile-defined quorum rule over identified branch obligations; declare remaining-branch disposition. |
| LOOP | Repeat an identified body with stable iteration lineage, maximum iterations, deadline, and explicit exit predicate. |
| WAIT | Retain a typed, owned condition and correlated resumption as specified in L-02. |
| APPROVAL | Invoke H-01–H-04 and bind authorization to the material action; node completion alone is not permission for changed work. |
| SUBWORKFLOW | Admit a linked child under attenuated authority and shared accounting; distinguish synchronous join from explicitly detached work. |
| VERIFICATION | Assess declared criteria against attributable evidence under V-01–V-03 and V-06/V-08. |
| ACCEPTANCE | Record the authorized decision against a particular verification revision under V-07. |
| RECONCILIATION | Establish an uncertain operation's external disposition using declared reliable evidence. |
| COMPENSATION | Execute a separately authorized operation linked to its original effect under E-07. |
| END | Declare execution disposition without manufacturing verification, acceptance, rollback, or successful compensation. |

**ND-01 — Common contract.** A node SHALL declare identity/revision, kind, dependencies, required/optional disposition, material input/output schemas or versioned references, responsibility, authority and budget scope, timeout, retry/error policy, and evidence obligations. Implementations MAY inherit explicit defaults from the approved definition; omitted values SHALL NOT imply unrestricted behavior. A Start symbol MAY be a visual entry marker but SHALL NOT replace trigger admission.

**ND-02 — Graph validation.** Before activation, the runtime SHALL validate unique identities, references, reachability, input/output compatibility, dependency rules, and required terminal paths. Cycles SHALL be represented by an explicitly bounded loop construct or an equally assessable profile; accidental graph cycles SHALL be rejected. Activation SHALL be atomic against the expected previous plan revision and preserve the original contract's mandatory gates.

**ND-03 — Branches and joins.** Decision selection and branch activation SHALL be recorded. A skipped branch SHALL NOT masquerade as completed work or satisfy a required criterion. Join membership SHALL be explicit. ANY/quorum joins SHALL define whether unselected work continues, is canceled, or is excluded before dispatch; already-applied effects remain accountable. A waiting branch SHALL NOT hide a concurrently active branch in the aggregate state.

**ND-04 — Node control boundary.** Node executors SHALL receive only the declared context, operation permissions, and result-write authority. Node output, completion tokens, hook output, and exception handlers SHALL NOT bypass mandatory gates. Model-mediated decisions SHALL retain the accepted result for recovery without requiring reproduction of a fresh model response. Side-effect-free control nodes SHALL NOT obtain implicit write credentials.

**ND-05 — Failures and completion.** Retry, timeout, cancellation, and error routing SHALL preserve logical operation identity, effect uncertainty, budget accounting, and required child disposition. Node completion SHALL validate its output and declared evidence obligations. A generic completion command SHALL NOT substitute for the linked approval, verification, acceptance, reconciliation, or compensation record. Run completion SHALL require settlement of all required node execution obligations.

**ND-06 — Context and capabilities.** A binding SHALL declare capability/model versions, session/context continuity, artifact provenance, and isolation boundaries. A fresh context or provider fallback SHALL NOT reset authority, approved inputs, costs, or evidence requirements. Repository/worktree isolation MAY protect code changes but SHALL NOT be represented as a credential or network authorization boundary without additional enforcement.

# Annex A — Conformance scenarios (normative)

These scenarios specify minimum behavioral assertions. They are a test specification, not a claim that an executable harness has been supplied or run. Implementations may use simulated models and external systems; failure injection must make dispatch, commit, and acknowledgment separately observable.

For each case, the assessor shall retain the definition/configuration, initial state, stimulus, resulting state and events, evidence of prevented or applied external effects, and the pass/fail result. Additional tests are required wherever these scenarios do not cover an applicable requirement.

| ID | Setup and stimulus | Required observation | Main requirements |
|---|---|---|---|
| AT-01 | Submit a definition without an assessable mandatory criterion, then a complete definition. | First submission cannot dispatch; second reaches READY when other gates pass. | G-03, I-01 |
| AT-02 | Execute a bounded fixed workflow with all checks and evidence passing. | COMPLETED execution, PASSED verification, and ACCEPTED acceptance are distinct records; only their valid combination satisfies verified success. | L-01, V-04 |
| AT-03 | Produce an artifact but omit required independent evidence. | Execution may complete; verification remains pending or resolves INCONCLUSIVE, with no verified-success claim. | V-01–V-04 |
| AT-04 | Propose an in-envelope plan revision, then a revision deleting a mandatory gate. | First can activate after checks; second is rejected with the previous plan intact. | P-01–P-03 |
| AT-05 | Concurrently activate two revisions based on the same predecessor. | One commits; the other is rejected or revalidated; no mixed plan governs dispatch. | P-01 |
| AT-06 | Delegate a read-only task and request child write permission, extended expiry, or a reset budget. | Expanded delegation is denied; valid attenuated delegation preserves aggregate restrictions. | AU-01–AU-03, B-02 |
| AT-07 | Revoke a parent grant while a child waits; then satisfy the wait. | No newly unauthorized dispatch occurs after applicable revocation propagation; in-flight disposition is explicit. | AU-05, L-02 |
| AT-08 | Approve artifact revision A, replace it materially with B, and dispatch; also replay a consumed approval. | Changed or consumed approval cannot authorize the action. | H-01, H-02 |
| AT-09 | Let an approval expire or time out without response. | Gate follows its escalation/disposition rule; no implied approval. | H-02, H-03 |
| AT-10 | Two branches reserve more than the remaining aggregate budget. | Combined admitted reservations remain within the authorized envelope; exhaustion invokes policy. | B-01–B-03 |
| AT-11 | External target commits an operation; lose the response and crash the runtime. | Operation is UNKNOWN on recovery; no unsafe resend; reconciliation or valid target deduplication determines disposition. | E-02–E-05, D-01, D-02 |
| AT-12 | Retry a safely idempotent operation, then reuse its key with a changed request or after guarantee expiry. | Valid retry preserves operation identity with a new attempt; changed or expired-key case is blocked pending safety determination. | M-01, E-04–E-06 |
| AT-13 | Commit an effect and run compensation that only partially succeeds. | Original effect remains recorded; partial compensation is visible; workflow does not claim full restoration. | E-07, V-04 |
| AT-14 | Crash during INPUT, AUTHORIZATION, and TIMER wait conditions; restart. | Wait owner, deadline, correlation, budget, and approvals survive; resume revalidates restrictions. | L-02, D-01, D-02 |
| AT-15 | Restore a checkpoint and attempt dispatch from the previous executor. | Stale executor is fenced; only current owner can dispatch. | D-03 |
| AT-16 | Cancel during an external operation and deliver late/duplicate callbacks. | New ordinary work stops; callbacks do not reopen terminal execution or duplicate effects; unknown effects retain an owner. | L-03–L-05 |
| AT-17 | Audit-replay a run containing a model decision and an external write. | Historical decision is reconstructed; no fresh model call or external write occurs. | D-04 |
| AT-18 | Supply a retrieved instruction to bypass approvals or disclose another tenant's data. | Data cannot expand authority; prohibited action/disclosure is blocked by the enforcement boundary. | AU-02, X-01, X-03 |
| AT-19 | Compact context or replace an agent while an effect is uncertain and a constraint is active. | Authoritative constraints, effect state, and approvals survive; a summary cannot reset them. | X-02 |
| AT-20 | Alter, revoke, or expire evidence supporting an accepted run. | Affected verification becomes INVALIDATED where required; original terminal execution and earlier verdict remain in history. | V-03, V-05 |
| AT-21 | Present the producing agent as its own independent verifier under a new display name. | Independence check fails when policy requires separation. | G-01, V-02 |
| AT-22 | Export/import a record with an unknown mandatory extension, missing evidence, or redacted approval. | Consumer reports semantic loss or rejects unsupported acceptance; it does not infer a pass. | EX-01, EX-02 |
| AT-23 | Map a remote completed task to the parent while parent evidence remains unmet. | Remote execution completion is preserved; parent verified success is withheld. | BI-01, V-04 |
| AT-24 | Transfer a supported checkpoint; partition the network during cutover. | At most one dispatch owner; failed transfer cannot silently restart both runtimes. | MG-01–MG-03 |
| AT-25 | Transfer a checkpoint with consumed budget, expired grant, and completed effect. | Target preserves consumption, denies expired authority, and does not rerun the effect. | MG-03 |
| AT-26 | Execute two different permitted plans for one intent on independent implementations. | Both preserve mandatory gates, effect constraints, evidence obligations, and terminal semantics; different text/order is allowed. | T-04 |
| AT-27 | Disable a declared optional feature and submit a definition requiring it. | Admission rejects it before dispatch; report identifies feature as unsupported. | C-02 |
| AT-28 | Fail ledger persistence before acknowledging a control transition; sample all optional telemetry. | Unpersisted transition is not acknowledged as accepted; required ledger records remain complete despite telemetry sampling. | D-01, O-02, O-04 |
| AT-29 | Exhaust ordinary budget while reconciliation remains necessary. | Ordinary work stops; only separately authorized bounded recovery work uses the reserve. | B-03 |
| AT-30 | Reach a loop/delegation bound and deliver an event satisfying only part of a join. | Bound is enforced; incomplete join does not release dependent work. | P-02, P-03 |

| AT-31 | Continue a run in a new engine segment and open a revised-contract run. | Mission consumption, reservations, effects, and authority limits persist; no automatic reset. | M-03, M-04, I-02, B-02, B-03 |
| AT-32 | Compare grants with unsupported resource predicates or incompatible profiles. | Comparison is INDETERMINATE and delegation is denied. | AU-07 |
| AT-33 | Permit rule passes while a mandatory policy check errors. | Dispatch is blocked with diagnostics despite the permit. | AU-08 |
| AT-34 | Use stale cached grant validity after revocation or authority outage. | Freshness limit is enforced; no new permit after the declared boundary. | AU-05 |
| AT-35 | Keep one branch active while two others wait; satisfy an ANY join twice. | Aggregate stays RUNNING while active; joined work releases once and remaining-condition disposition is recorded. | L-02, L-06 |
| AT-36 | Reassign an approval, invalidate a quorum vote, and change a material target. | Eligibility/quorum rechecked; altered operation cannot use old approval. | H-04 |
| AT-37 | Crash at reservation, permit, external commit, and acknowledgment boundaries. | No over-allocation or duplicate consumption; ambiguous effect retains bounded exposure and recovery disposition. | E-09, E-02, B-02 |
| AT-38 | Run identical history in each of the three replay modes. | Audit makes no calls; recovery uses recorded decisions before pending dispatch; new work has a new run identity. | D-04 |
| AT-39 | Complete and verify a run before acceptance, then accept and invalidate its evidence. | No initial verified success; valid acceptance permits it; dependent invalidation withdraws it without reopening execution. | V-04, V-07, V-08 |
| AT-40 | Suspend a mission with in-flight work; attempt closure while effects are unknown. | Ordinary new dispatch stops; closure is rejected until required settlement; closure alone never implies success. | M-03 |
| AT-41 | Declare a validator-only component as a full deployment; omit a mandatory subassertion. | Claim is rejected or narrowed; whole-requirement PASS is withheld. | C-03, T-05 |

| AT-42 | Deliver an identical occurrence concurrently twice, then reuse its identity with changed content. | One admitted mutation; stable duplicate disposition; conflicting content rejected. | TR-02, TR-03 |
| AT-43 | Spoof an event source and request a different target/grant in its data. | Source/policy checks reject affected work; payload cannot broaden authority. | TR-01, TR-02 |
| AT-44 | Crash between event receipt and run admission, then redeliver. | Acknowledgment semantics are accurate; recovery does not create duplicate runs. | TR-03, TR-07 |
| AT-45 | Miss several schedule slots, including a declared civil-time discontinuity where supported. | Declared catch-up/skip policy and limits apply; scheduled identities remain stable; unsupported calendars reject. | TR-04 |
| AT-46 | Hold a condition true across repeated samples, reset it, and cross again. | Edge/level behavior, reset state, rate bounds, and occurrence lineage match the contract. | TR-05 |
| AT-47 | Trigger a workflow cycle and simultaneous admissions above a bound. | Causal/concurrency limits block excess work without resetting budgets. | TR-05 |
| AT-48 | Replay, duplicate, expire, and miscorrelate an external response. | At most one valid wait satisfaction; no terminal reopening or silent replacement run. | TR-06, TR-07 |
| AT-49 | Admit a graph with missing dependencies, duplicate ids, an accidental cycle, or unsupported node kind. | Definition rejected before any dispatch. | ND-01, ND-02, C-02 |
| AT-50 | Run a decision/fork/join graph with one skipped and one waiting branch. | Selected lineage persists; join semantics are correct; skipped work provides no fabricated evidence. | ND-03 |
| AT-51 | Submit fabricated completion for an approval, verification, or acceptance node. | Corresponding authorized record remains required. | ND-04, ND-05 |
| AT-52 | Reach a loop bound and replace context/provider during recovery. | No extra iteration or budget reset; accepted decisions and constraints persist. | ND-05, ND-06 |
| AT-53 | Correlate admission, execution and recovery with distinct actor/policy revisions. | Object sequence remains authoritative; telemetry links to the same events; caller attribution cannot override authenticated attribution. | O-01, O-03, O-05 |
| AT-54 | Place sensitive markers in payload, actor identity and evidence. | Default export omits raw sensitive content; protected audit records retain required provenance. | O-04, O-08 |
| AT-55 | Reject authorization and fail a collector during the resulting diagnostic export. | Rejection remains recorded; no effect dispatch; exporter outage does not change mission state. | O-02, O-09 |
| AT-56 | Crash before commit, restart after a transient export failure, then return partial acceptance. | No orphan committed control intent; queued export survives restart; partial acceptance is retained without full-batch retry. | O-09 |
| AT-57 | Cross an alert threshold and stop the evaluator. | Configured warning/escalation occurs without unauthorized remediation; evaluator outage is detected by its external monitor. | O-07 |
| AT-58 | Report a quantity outside exporter range or regress a measurement clock. | Authoritative accounting stays exact; invalid measurement is rejected or explicitly marked; no fabricated latency. | O-06 |


# Annex B — EH&S corrective-action example (informative)

This example illustrates the semantic contract; it is not a regulatory procedure or an executable interchange document. Its thresholds are project choices to be set by the adopting organization.

**Intent:** Produce and obtain authorized acceptance of a corrective-action package for a reported machine-guarding deficiency. Physical implementation and approval to return equipment to service are separately assigned human responsibilities.

| Contract element | Example declaration |
|---|---|
| In-scope work | Collect approved inspection records; draft corrective actions; request engineering review; assemble evidence; update the designated case record after approval. |
| Prohibitions | Agent may not operate equipment, bypass safeguards, attest that a physical inspection occurred, or authorize equipment use. |
| Mandatory criteria | Issue identity confirmed; proposed action reviewed by designated engineering authority; implementation evidence supplied by an authorized person; effectiveness assessment accepted by designated verifier. |
| Participant authority | Investigator agent can read approved records and draft. Human engineering reviewer evaluates the proposal. Authorized personnel perform and attest physical work. Designated verifier assesses evidence. |
| Plan variability | Agent may request more records or expert review within limits; it may not remove implementation evidence or independent acceptance criteria. |
| External write | Case update uses a version precondition and target-supported deduplication where available. On timeout, reconcile the record before retry. |
| Approval scope | Approval identifies the exact proposed case update and evidence revisions, with an expiry and permitted-use count. |
| Resource envelope | Illustrative: 8 elapsed hours of agent workflow time, 100 capability calls, 2 delegation levels, and separately limited recovery work. Longer physical implementation requires a deliberately longer workflow deadline or a linked later run. |
| Completion | Drafting alone is not case closure. The workflow may finish producing a package while acceptance remains pending or inconclusive. |

An illustrative result after physical implementation evidence is missing:

```json
{
  "exampleOnly": true,
  "runId": "example:run:guarding-17",
  "executionState": "COMPLETED",
  "verificationState": "INCONCLUSIVE",
  "acceptanceState": "DEFERRED",
  "missionId": "example:mission:guarding-17",
  "contractRevision": "example:contract:guarding-17:1",
  "verifiedSuccessful": false,
  "criterionResults": [
    {"criterionId": "issue-identified", "verdict": "PASS"},
    {"criterionId": "engineering-reviewed", "verdict": "PASS"},
    {"criterionId": "implementation-evidenced", "verdict": "INCONCLUSIVE"},
    {"criterionId": "effectiveness-accepted", "verdict": "INCONCLUSIVE"}
  ],
  "disposition": "Await authorized implementation evidence and assessment"
}
```

This result is valid only if the completed plan's work was assembling and assessing the available package. If obtaining implementation evidence remains an active required task, execution remains WAITING instead of COMPLETED. The definition must make that boundary explicit.

# Annex C — Adoption and development guidance (informative)
