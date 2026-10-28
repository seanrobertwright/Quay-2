# The AI Workflow Standard

AIWS-001, *AI workflows: governed execution, authority, evidence and interoperability*, is the proposed standard that every part of this project implements, tests or documents. Edition 0.4, dated 8 September 2026, is the current working draft. The SDKs implement its finite-v1 profile; the engine source implements the accepted engine design on top of it. This chapter explains the standard itself. The research behind it (not in this pack) has its own chapter.

The standard is an independent proposal. It has not been adopted, approved or endorsed by ISO, IEC, OMG, NIST, AAIF, CNCF or any other standards organization. Its identifier is a working project identifier, and an organization adopts it through its own document-control process. External certification and interoperability with third-party runtimes have not been demonstrated. Download edition 0.4 (not in this pack) or the previous edition 0.3 (not in this pack).

## The problem it addresses

An AI workflow coordinates humans, AI agents, services and deterministic steps toward a declared outcome, often over hours or days, often with effects on external systems. Existing orchestration engines, agent protocols and observability tools each solve part of that, but they leave four questions to convention:

1. **May this participant act right now,** and who enforces that outside the model's own instructions?
2. **What actually happened** when a tool call timed out or a process died after the external change was committed?
3. **Did execution finish,** as distinct from a process exiting?
4. **Was the result accepted** by someone accountable, against criteria fixed before the work began?

AIWS-001 answers those questions with a semantic contract that can be implemented on existing engines and protocols. It specifies what must be recorded, checked and enforced. It does not prescribe a model, prompt format, user interface, transport, orchestration product, memory database or private reasoning representation, and it does not set domain safety limits or determine legal obligations. Those come from the adopting organization's controlled policies.

## How the document is organized

| Part | Content | Status |
|---|---|---|
| Part A | Research-driven revision history and the decisions each finding produced | Informative |
| Part B, clauses 1 to 19 | The numbered requirements | Normative |
| Annex A | 58 conformance scenarios, AT-01 to AT-58 | Normative |
| Annex B | A worked environmental health and safety corrective-action example | Informative |
| Annex C | Adoption guidance, release gates and the minimum adoption record | Informative |
| Annexes D and E | Source register, edition transition notes and primary references | Informative |
| Annex F | Minimum allocation of every requirement to a responsible role | Normative |
| Annex G | The companion finite-v1 implementation profile and its boundaries | Informative |

Requirements use the conventional keywords: **SHALL** is mandatory, **SHALL NOT** is a prohibition, **SHOULD** is a recommendation that a documented justification may override, and **MAY** is a permitted option. One rule governs all the others. If two mandatory requirements cannot both be satisfied, the deployment stops the affected work and reports the conflict; it never silently chooses the weaker interpretation.

## The object model

Clause 4 defines the objects every other clause refers to. The identity chain in [the execution model](./concepts.md) is the SDK's rendering of this table.

| Object | Role in the standard |
|---|---|
| Mission | The durable authorized objective and the container for cumulative resource accounting. It is OPEN, SUSPENDED or CLOSED, and closure never implies verified success. |
| ContractRevision and Intent | An immutable, approved combination of intent, definition revision, policy references and authorized envelope. A material change creates a new revision and a linked new run, never an edit in place. |
| Run, ExecutionSegment | One execution within a mission. A segment is an engine continuation or recovery boundary; starting one never creates fresh authority, budget or logical operations. |
| Plan, Task | A versioned strategy and its accountable units of work. Fixed workflows also have a plan, which may be derived mechanically from the definition. |
| Step, StepAttempt | A logical operation, and one dispatch of it. Retries create new attempts under the same step; a changed intended effect is a new step. |
| Participant, Capability | Who is responsible, and a versioned operation contract. Discovery of a capability describes availability; it never confers permission. |
| AuthorityGrant, Approval | A permission record with issuer, subject, scope, expiry and revocation state, and an attributable decision for one specific action. Approval does not create broader authority. |
| WaitCondition | A durable, task-scoped wait with owner, type, correlation, deadline and explicit ALL or ANY join membership. |
| Artifact, Evidence, VerificationRecord, AcceptanceRecord | Produced content, information with provenance about a criterion, an attributable verdict on that criterion, and an accountable decision to accept, reject or defer. |
| Event | An append-only record of an execution or control occurrence. Corrections are additional events. |
| Side effect, Reconciliation, Compensation | An externally observable change, the act of establishing its true outcome, and a separately authorized operation that counteracts it. |

## The requirement clauses

Each requirement has a stable identifier. The prefix says which clause it belongs to, which is also how the [capability matrix](./capabilities.md) and the conformance mapping refer to them.

| Clause | Identifiers | What it requires |
|---|---|---|
| 2 and 3, Normative language and conformance scope | N-01, C-01 to C-03 | Claims state edition, role, features, limits, exclusions and evidence. Unsupported features are rejected before execution. Every obligation is assigned to a named component and operator. |
| 4, Objects | M-01 to M-04 | Unambiguous identities, pinned revisions for every material action, mission continuity across runs and recovery, and segments that preserve operations, waits, budgets and decisions. |
| 5, Accountability and admission | G-01 to G-03 | Named owner, approval authority, operator and verification authority. A risk assessment before activation. Admission validates definition, policy, eligibility, capabilities, budgets and persistence before READY. |
| 6, Intent, definitions and plans | I-01, I-02, P-01 to P-03 | The intent names outcome, scope, prohibitions, criteria, acceptance methods and evidence. Each run pins one contract revision. Plan revisions are retained, validated and activated atomically, with explicit dependency and loop bounds. |
| 7, Lifecycle | L-01 to L-06 | Execution, verification and acceptance are separate state dimensions. A normative transition table governs execution. Terminal states never reopen. Cancellation does not imply rollback. Late callbacks cannot regress state or manufacture success. |
| 8, Authority | AU-01 to AU-08 | Grants are enforced at a trusted dispatch boundary outside the participant's instructions, attenuated on delegation, revalidated at dispatch and resumption, compared under a versioned authority profile, and blocked when a mandatory policy check cannot answer. |
| 9, Approvals and limits | H-01 to H-04, B-01 to B-03 | Approvals bind an eligible approver to the exact action, material revision and policy, with expiry and use counts. Budgets are reserved before dispatch and reconciled after, mission-wide. Deadlines use wall-clock time including waits. |
| 10, Effects | E-01 to E-09 | Capabilities declare their effect class. Attempts move through PREPARED, DISPATCHED, SUCCEEDED, FAILED or UNKNOWN, and uncertainty stays UNKNOWN until reconciled. Intent is recorded durably before dispatch. Retries need current authority and proof or a target guarantee. Compensation is its own authorized operation. |
| 11, Durability and replay | D-01 to D-04 | Control state is persisted before it is acknowledged. Recovery revalidates before dispatching. Stale executors are fenced. Audit playback, recovery continuation and new execution are distinct modes. |
| 12, Context and data | X-01 to X-05 | Inputs carry provenance and trust classification. Context survives participant replacement. Data destinations, retention and memory writes are governed. Retention is minimized. |
| 13, Evidence and outcomes | V-01 to V-08 | Evidence has provenance and validity limits. Every mandatory criterion gets PASS, FAIL or INCONCLUSIVE. A run is verified successful only when execution is COMPLETED, verification PASSED and acceptance is currently ACCEPTED for that verification revision. |
| 14, Records and observability | O-01 to O-09 | Required control events with a standard envelope, decision transparency, ledger integrity, telemetry correlation, defined metrics, alert governance, a privacy allowlist and durable export. |
| 15, Export, bindings and migration | EX-01, EX-02, BI-01, MG-01 to MG-03 | Evidence export manifests, declared semantic loss, versioned protocol bindings, and an experimental profile for moving runs between runtimes. |
| 16 and 17, Assessment and change control | T-01 to T-05, CH-01 to CH-03 | A requirement matrix, scenario execution, report contents, interoperability evidence, and separate tracks for control conformance, outcome quality, adversarial robustness and interoperability. Controlled adoption and impact assessment of material changes. |
| 18, Triggers | TR-01 to TR-07 | Occurrence receipt is distinct from authorization. Event data cannot select more privileged authority. Duplicates return their recorded disposition. Schedules declare time basis and catch-up policy. Resume responses correlate to one pending wait. |
| 19, Nodes | ND-01 to ND-06 | Node contracts, graph validation before activation, recorded branch selection, explicit joins, executors that receive only declared context and permissions, and completion that validates output and evidence. |

## Six ideas that recur throughout

**Three state dimensions, not one.** A run's execution state, its verification state and its acceptance state are recorded and reported separately. A process that exits cleanly is COMPLETED. It is verified successful only after every mandatory criterion has a current PASS and an accountable person has accepted that verification revision. Annex B shows a run that is COMPLETED, INCONCLUSIVE and DEFERRED at the same time, and why that is the honest answer.

**Authority is enforced outside the model.** Permission comes from grants and policy checked at a trusted dispatch boundary, never from a capability listing, a remote promise or the participant's own instructions. Delegated authority can only narrow. When the policy engine cannot answer, dispatch stops.

**Approvals bind to the exact action.** An approval names the approver's verified role, the run, task and operation, the intended effect and target, the material input revision and the policy revision. Change any of those and the approval no longer applies.

**Uncertainty is a first-class state.** A timeout, a lost acknowledgement or a crashed worker leaves an attempt UNKNOWN. Nothing retries it automatically. Reconciliation against the external system, or a target-level idempotency guarantee, is required before the operation can proceed, and budgets account for the uncertain effect conservatively.

**Everything material is durable before it is acted on.** Intent, authority decision, approval consumption, reservation and ownership epoch are committed before an external effect is dispatched. Recovery replays that record; it never re-derives it.

**Claims are scoped and assessed.** A library, a definition, a deployment and a binding are different claims. Each requirement is assigned to a role in Annex F, exercised by scenarios in Annex A, and reported on separate tracks. Passing one run proves nothing about an implementation.

## Lifecycle states

Clause 7 fixes the execution transitions. Verification and acceptance have their own small state machines in clause 13.

| Dimension | States |
|---|---|
| Execution | CREATED, READY, RUNNING, WAITING, PAUSED, CANCELING, then terminal COMPLETED, FAILED, CANCELED or REJECTED |
| Verification | NOT_STARTED, PENDING, PASSED, FAILED, INCONCLUSIVE, INVALIDATED |
| Acceptance | NOT_REQUESTED, PENDING, ACCEPTED, REJECTED, DEFERRED, INVALIDATED |
| Attempt and effect | PREPARED, DISPATCHED, SUCCEEDED, FAILED, UNKNOWN; effects settle to CONFIRMED_APPLIED or CONFIRMED_NOT_APPLIED |

A run with any active work remains RUNNING even while another branch waits. With no active work and something runnable it is READY. With neither it is WAITING. An unsatisfiable dependency is a recorded failure, never an unexplained indefinite wait.

## Conformance and adoption

The standard distinguishes five claims: a **definition** claim about a versioned workflow and its policy package, a **core execution** claim about an identified deployment boundary including runtime, enforcement, persistence and adapters, an **evidence export** claim, a **binding** claim about a named external protocol, and an **experimental migration** claim. A definition-only claim is never presented as runtime conformance, and a library that validates records may claim tested support for those checks but not core execution conformance.

Assessment follows clauses 16 and 17. The assessor enumerates every applicable requirement with an evidence reference and a PASS, FAIL or NOT_APPLICABLE verdict, executes the Annex A scenarios including crash and negative cases, and reports control conformance separately from domain outcome quality, adversarial robustness and interoperability. Adoption starts with a controlled record naming the edition, owner, scope, effective date, profiles and review interval, and every material change to runtime, model configuration, policy or persistence triggers reassessment. Annex C suggests starting with one bounded document-review or corrective-action workflow, using a simulated external target that can commit an update while dropping its acknowledgement, because that exposes failures a successful demo hides.

## Edition history

| Edition | Change |
|---|---|
| 0.1 | Initial reviewed draft. |
| 0.2 | Research-driven revision. Introduced Mission, ContractRevision and ExecutionSegment; the versioned authority profile and three-result containment; blocking on policy errors; measurable revocation freshness; the three replay modes; independent wait records with ALL and ANY joins; approval ownership, quorum and action fingerprints; the durable admission boundary with conservative uncertainty accounting; the AcceptanceRecord; and role-assigned assessment. |
| 0.3 | Trigger admission and event handling, TR-01 to TR-07, and the normative node catalog, ND-01 to ND-06, with scenarios AT-42 to AT-52. |
| 0.4 | Correlated observability, metric definitions, alert governance, telemetry privacy and reliable export, O-05 to O-09, with scenarios AT-53 to AT-58. |

Records from one edition are not automatically records of the next. Annex E describes the explicit mapping an import requires and forbids relabeling an old contract or recomputing its journal as a substitute for migration.

## How the SDKs and engine relate to it

SDK 0.4.0 and standard edition 0.4 are different version numbers with different purposes. The three SDKs implement the **finite-v1 profile** described in Annex G: exact finite authority sets, integer accounting units, immutable per-mission contracts, explicit joins, bounded loops, local JSON schemas and conservative UNKNOWN accounting. The [implementation profile](./profile.md) states exactly what is implemented, the [capability matrix](./capabilities.md) maps requirements to the SDK, the application or engine work, and the [conformance chapter](./conformance.md) describes the shared scenarios the three languages run.

The profile deliberately leaves things out. The libraries are not a hosted ingress service, do not authenticate event producers, do not provide calendar schedules, arbitrary policy comparison, cross-runtime migration or external exactly-once effects, and have no permissive authorization default. Unsupported requirements are rejected before execution. An organization claiming conformance assesses its complete composed deployment, including the identity, policy, adapters and evidence assessment it supplies around the SDK.

**Praxis**, implemented under `engine/src`, realizes the accepted [Praxis design](./engine-design.md): a governed coding workflow, control API, worker dispatch, backup and restore, and the dynamic workflow plane. The [architecture diagrams](./diagrams.md) show how those pieces embody the standard's boundaries.
