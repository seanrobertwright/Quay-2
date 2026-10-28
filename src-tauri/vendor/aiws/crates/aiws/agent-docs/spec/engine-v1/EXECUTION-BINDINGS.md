# M7 Slice 3 — coding execution revision binding

Status: experimental TypeScript engine source, Node 24 + SQLite. Extends [the registry](./DYNAMIC-REGISTRY.md). Native SDKs and remote dynamic controls remain Slice 8; M6 qualification remains open.

M10 amends this contract: agent binding §4 (not in this pack) binds an agent per node through node assignments. The amendment is specified, not implemented; the sentences that state it name the M7 behaviour they replace.

## Supported profile

`definitionForCoding(plan, planArtifact)` compiles an existing immutable `CodingPlan` into revision 1 of `aiws-dynamic/1`. The single composite node `coding-plan` binds the complete plan and artifact digest; authority, limits and acceptance digests bind the coding profile's policies. The existing bounded coding interpreter retains implementation, validation and correction stages. This is not a general executable DAG or permission to insert/change tasks. In `coding-workflow/2` the composite splits into implementation, validation and correction stage nodes, each with its own node assignment (§4 (not in this pack)).

`BIND_CODING` is a closed `DynamicCommand` with `ref: {workOrderId,runId}`, `expectedWorkflowRevision` and `approvalId`. The repository's existing verified human identity and exact approval checks apply. Review additionally binds the coding aggregate revision and complete source state digest. `review()` does not grant approval. The host must independently authenticate and authorize the reviewer and resolve current approval evidence.

Binding either creates the exact compiled revision-1 registry genesis or adopts an already registered identical genesis. Another digest, run or registry revision fails. The aggregate revision is checked inside the registry writer transaction. A successful receipt and `getHead()` report `execution: CODING_V1`; standalone registry heads remain `UNBOUND`. The effective marker is derived from the execution component, preserving the original registry table format.

## Conservative migration

Only the initial IMPLEMENTATION stage, ordinal zero, in AWAITING_APPROVAL or READY may bind. There must be no historical dispatch attempts, live claims, prior stage outputs, acceptance, active handoff ownership or agent replacement history. Existing initial tasks and handoffs must match their coding material. Accounting must be pristine, with no outstanding exposure or open holds, and controls must be RUNNING. Existing clock, ownership and restore fences still apply.

Binding preserves plan/artifact, task/handoff identities, history and accounting. It increments the coding aggregate revision, adds `definition`, clears stage approval, sets AWAITING_APPROVAL with reason BOUND_REAPPROVAL_REQUIRED, and moves an existing READY task to WAITING. The human must issue a new stage approval whose subject includes the definition reference. Binding approval is separate from dispatch approval. In-flight/completed legacy runs remain unbound; they cannot be retroactively labeled or automatically reset.

The atomic transaction includes registry genesis when needed, execution binding, initial task/handoff pins, coding aggregate/audit event, human proof consumption, registry event and request receipt. Failure rolls back all of them. Receipt retries use the immutable original source digest, return the committed receipt after workflow progress and require current authorization/epoch/clock; they neither reset state nor consume approval twice.

## Immutable record identity and gates

`DefinitionRef` contains workOrderId, runId, revision and digest. `ExecutionBinding` adds taskId, attemptId, workerId and coordinatorEpoch. Optional fields on legacy records preserve existing unbound behavior.

| Record | Bound material | Enforcement |
|---|---|---|
| TASK | Definition node, stored task identity/class/payload, stage dispatch material digest | Pin with enqueue; verify before claim and dispatch against current coding stage/epoch |
| HANDOFF | Producer/consumer tasks, stage and artifact identity | Pin with creation; verify before composed acknowledgment/dispatch |
| ATTEMPT | Definition, task, attempt, worker, epoch and dispatch material | Pin atomically with admission/reservation/dispatch intent |
| RESULT | Exact attempt binding and full worker evidence digest | Verify before completing delivery; persist pin with evidence |
| VALIDATION | Exact attempt binding and validation input digest | Verify durable evidence in composed completion; pin with validation and settlement |

**Per-node dispatch** (§4 (not in this pack)): dispatch selects the agent adapter from the current node assignment of the node being dispatched, and `assertCodingBinding` runs per node, checking each task's agent id against that node's assignment. The M7 implementation selects one adapter for the whole run, from its current agent or the local worker, and requires every definition task to name that one agent.

Worker dispatch envelopes expose `binding`; `LocalCodingWorker` carries that snapshot into evidence. Missing, stale or cross-attempt/worker/definition bindings cannot complete a bound delivery or settle its exposure. Rejection does not cancel external work or refund accounting. A stale owner epoch cannot publish a new result. Recovery may consume an already committed result under its original ownership pin after the existing human resume/reconciliation path; it does not relabel old evidence.

Generic handoff/replacement controls reject bound work. Standalone validation cannot bypass composed bound completion. Registry ACTIVATE remains blocked for bound executions with EXECUTION_CHANGE_NOT_SUPPORTED. [Slice 4](./CODING-INSERTION.md) adds the separate guarded ACTIVATE_INSERTION command for a preparation prefix before dispatch. Slice 5 adds [plan/dependency revisions before dispatch](./CODING-REVISIONS.md). Replacement, compatibility transitions, assessment invalidation and external-effect reconciliation remain Slices 6–7.

## Storage and inspection

Optional `execution_binding_version=1` requires the dynamic registry component. Immutable `execution_bindings` and `execution_record_bindings` tables retain pins; update/delete guards and additive schema checks reject missing components, unsupported versions and missing guards. Opening the component alone never binds existing work. Binding writes use existing stored-record parser limits. Record pinning must run in the record's writer transaction.

`executionRecords(ref, after=0, limit=100)` returns records ordered by global `seq`, with a maximum page size of 1000; pass the last sequence for continuation. It is a trusted local inspection API, not a remote authorization boundary. Old binaries cannot safely operate this component. Downgrade/release migration and full component backup/restore qualification remain separate acceptance work.

See implementation evidence (not in this pack) and `engine/examples/bound-coding.ts` for the executable local demonstration.
