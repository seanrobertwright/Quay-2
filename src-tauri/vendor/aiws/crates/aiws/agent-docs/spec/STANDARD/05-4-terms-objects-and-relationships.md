# 4 Terms, objects, and relationships

| Term | Definition and required relationship |
|---|---|
| Mission | Durable authorized objective, lineage, and cumulative resource-accounting container. It has one or more approved contract revisions and zero or more runs. |
| ContractRevision | Immutable approved combination of intent, definition revision, governing policy references, and authorized envelope within one mission. |
| Intent | The authorized outcome, constraints, success criteria, and acceptance policy pinned by a contract revision. |
| ExecutionSegment | Engine-specific continuation or recovery segment within one run; starting a segment does not create fresh authority, budget, or logical operations. |
| WorkflowDefinition | An immutable, versioned contract for permitted work and execution obligations. Each run pins exactly one contract revision and its definition revision. |
| Run | One execution instance within one mission and contract revision, with a unique identity and accountable owner. A run has zero or more plan revisions before activation and exactly one active plan revision during work dispatch. |
| Plan | A versioned strategy and task/dependency structure for achieving the intent. Fixed workflows also have a plan, which may be mechanically derived from their definition. |
| Task | An accountable unit of work within exactly one run. Each task has one responsible participant at a time, zero or one parent task, and zero or more dependencies. |
| Step | A logical operation within exactly one task. Its identity persists across retries. A changed intended effect creates a new step. |
| StepAttempt | One dispatch attempt for a step, with its own immutable identity and attempt number. |
| Participant | A human, AI agent, service, or deterministic workflow responsible for work. A participant's identity is distinct from its credentials. |
| Capability | A versioned operation contract, including accepted inputs, outputs, and effect classification. Discovery describes availability; it does not confer permission. |
| AuthorityGrant | A permission record with issuer, subject, scope, constraints, expiry, revocation state, and optional parent grant. |
| Approval | An attributable authorization decision for a specific action or explicitly bounded set of actions. Approval is subject to governing policy and does not automatically create broader authority. |
| Checkpoint | A consistent durable snapshot or reconstructable boundary sufficient to determine what can safely resume. |
| Artifact | Identified, versioned content produced or consumed by a workflow. |
| Evidence | Information with provenance that supports, contradicts, or leaves unresolved a specific criterion or control obligation. It may refer to one or more artifacts. |
| WaitCondition | Durable task-scoped condition with owner, type, correlation, deadline, satisfaction state, and join membership. |
| AcceptanceRecord | Attributable decision to accept, reject, or defer an assessed outcome against a pinned verification revision and acceptance policy. |
| VerificationRecord | An attributable assessment of a criterion using identified evidence, a method, and a verdict. |
| Event | An append-only record of an observable execution or control occurrence. Corrections are additional events. |
| Side effect | An externally observable change beyond internal planning or computation, including publication, communication, record mutation, and physical actuation. |
| Reconciliation | Establishing the external outcome of an uncertain operation using reliable external state or attestation. |
| Compensation | A separately authorized operation intended to counteract an earlier effect; it need not restore the original state completely. |

**M-01 — Identity and lineage.** The runtime SHALL assign unambiguous identities to runs, tasks, steps, attempts, grants, approvals, artifacts, evidence, and events within its declared namespace. References SHALL include the namespace where ambiguity is possible. Retries SHALL preserve the step and logical operation identities while creating new attempt identities. Parent-task and grant-parent relationships SHALL be acyclic.

**M-02 — Revisions.** The runtime SHALL preserve the definition, intent, plan, policy, capability, and artifact revisions applicable to every material action. Mutable references such as “latest” SHALL resolve to an identified revision before use. If an external provider does not disclose an immutable model revision, the runtime SHALL record the identifier supplied, invocation time, configuration, and the resulting reproducibility limitation.

**M-03 — Mission continuity.** The runtime SHALL preserve mission and contract lineage across runs, segments, delegation, recovery, and migration. Mission state SHALL be OPEN, SUSPENDED, or CLOSED. OPEN permits otherwise authorized admissions; SUSPENDED blocks ordinary new dispatch but MAY permit separately authorized bounded recovery; CLOSED permits no new dispatch. Closure SHALL require terminal runs, settled reservations, and no unresolved material effects. CLOSED SHALL be terminal; later assessments MAY append records, and corrective work SHALL use a linked newly authorized mission. Mission closure SHALL NOT imply verified success.

**M-04 — Segments.** Each segment SHALL identify its run, predecessor where present, engine identity, and durable ownership epoch. A new segment SHALL preserve operation identities, waits, budgets, approvals, and recorded decisions. Concurrent task workers MAY exist within a segment; they SHALL NOT acquire conflicting ownership of the same dispatch operation.
