# M7 Slice 4 — governed coding task insertion

Status: implemented experimental TypeScript engine source, Node 24 + SQLite. Extends [execution binding](./EXECUTION-BINDINGS.md) and the [dynamic registry](./DYNAMIC-REGISTRY.md). Native SDKs and dynamic CLI/web commands remain Slice 8. M6 qualification is independent.

M10 amends this contract: agent binding §4 (not in this pack) removes the hard-coded local agent from inserted tasks and replaces the refusal on a bound run with replacement history with the activation bar. The amendment is specified, not implemented; the sentences that state it name the M7 behaviour they replace.

Slice 5 adds [plan and dependency revisions](./CODING-REVISIONS.md) through a separate guarded action; insertion continues to preserve existing node material.

## Supported operation

Insert one or more serial preparation tasks before the immutable `coding-plan` composite node. Additional pre-dispatch insertions append to that prefix. The existing plan, agents, policies, acceptance conditions, correction rules and resource maxima are preserved. This slice does not support insertion after execution starts, arbitrary DAG execution, removal of definition nodes, replacement or edits to existing task material.

`CodingInsertionTask` is a closed record with `taskId`, `command` (argument array), `outputPaths` (unique relative file paths), `criteriaRef`, and `maxTaskMs`. Task identity must be new and cannot be `coding-plan`. Each inserted task is a `PREPARATION` node (§4 (not in this pack)) bound to the agent its insertion proposal names, chosen with the same picker, figure prompts and binding review as the run's other nodes (§7 (not in this pack)). Insertion creates a node assignment and readiness binding for the inserted node, which meets the same activation bar as an agent replacement successor (§4 (not in this pack)). Inserted tasks use the approved coding plan's workspace. The M7 implementation binds every inserted task to the local coding worker `engine:local-coding`. Successful execution means a successful command with captured declared artifacts; `criteriaRef` labels the evidence and does not execute a separate semantic validator. Hosts must review commands and criteria accordingly. These local commands are not an OS sandbox.

`normalizeInsertionTasks(input)` refuses ambiguous material, accessors, sparse/extra array fields, symbols, unsupported values, invalid paths and unbounded durations. Stored parser limits apply. `definitionWithInsertions(base,tasks)` returns the exact successor candidate: inserted task material digests bind profile `coding-insertion/1` and the complete normalized task record. New nodes form a serial chain following all current coding-composite predecessors; the coding composite depends on the last new node. All existing node material, agents and protected policy digests remain unchanged.

## Proposal and approval

1. Compile the candidate with `definitionWithInsertions` and store it through the existing authenticated `PROPOSE` command. Agents with scoped propose authority may do this; proposals grant no execution authority.
2. Prepare `ACTIVATE_INSERTION` with exactly `ref`, `proposalId`, `expectedWorkflowRevision`, `tasks` and `approvalId`.
3. Obtain human review through the trusted registry authority integration. Its subject binds the existing installation/epoch/authority/action/base/candidate/proposal identity, plus the coding aggregate revision, complete source-state digest and normalized insertion-material digest.
4. Execute under current verified human authority. The writer transaction checks the current head, exact workflow state/revision, exact compiled insertion-only candidate and execution eligibility.
5. Fetch the updated coding state and issue fresh stage approval using `approvalSubject(state)` and the existing runner approval flow. Activation itself never dispatches.

The existing plain `ACTIVATE` command continues to refuse bound execution. It cannot bypass the new operation-specific checks. Arbitrary branch, agent or existing material changes hidden in an insertion proposal fail even if separately human-approved. Approval IDs resolve independently verified host evidence; reviewing or echoing request claims does not authorize activation.

## Work lifecycle and accounting

| Existing work | Insertion behavior |
|---|---|
| Bound initial AWAITING_APPROVAL with no task yet | Activate successor; await fresh stage approval |
| Initial READY/WAITING task and PENDING handoff, no claim/attempt | Retain old rows and immutable pins, explicitly mark them CANCELED as superseded execution instances, record IDs in the insertion revision; use new execution IDs |
| Active scheduler claim or acquired/acknowledged handoff | Refuse; preserve ownership and records |
| Any dispatched attempt, completed prefix/core work or uncertain effect | Refuse; preserve responsibility, evidence and accounting |
| Pause/cancel, open hold, non-pristine accounting or old owner epoch | Refuse; use the existing applicable control/recovery path |
| Bound run | Under M10 the inserted node meets the activation bar (§4 (not in this pack)); the M7 implementation refuses with `AGENT_BOUND_CHANGE_UNSUPPORTED` once the run has replacement history |

Eligibility is limited to the initial IMPLEMENTATION stage, ordinal zero, with no input/output/acceptance and insertion cursor zero. Superseding queued execution instances does not remove their logical definition tasks or claim they executed. A complete audit record and old pins remain available.

Every inserted task's duration must be within the original per-task maximum. The complete prefix plus two attempts for core implementation/validation must fit `maxAttempts`; the prefix's maximum durations plus two core task maxima must fit `maxTotalActiveMs`. This is an activation feasibility check, not a reservation or a promise of enough correction capacity. Actual dispatch still uses the original scope and charges attempts/time under existing admission rules. Correction can exhaust the unchanged limits and hold the run. Activation neither resets accounting nor grants new cost/credential authority. Under M10 every inserted node's cost charges the NODE scope `insertions`, whose bound is declared at run creation or inherits the run's (§6 (not in this pack)).

## Execution and evidence

`CodingState.insertions` retains the immutable full prefix and `insertionIndex` tracks progress. Preparation steps use the existing IMPLEMENTATION handoff stage; their logical definition task ID and dispatch action `INSERTION:<taskId>` distinguish them from core implementation. Command, output selection and duration come from the active inserted task. Its predecessor manifest is verified before execution.

Each successful task captures declared outputs, settles its own attempt, advances the cursor and creates the next task/handoff atomically. The last inserted task hands off to core implementation, followed by the original validation/correction loop and human acceptance. Failure settles the known failed attempt and holds the run as INSERTION_FAILED; no automatic insertion retry or compensation occurs. UNKNOWN or uncertain worker execution retains responsibility through existing holds.

New tasks, handoffs, attempts, worker evidence and validations pin the new revision. Prior pins remain readable against their immutable historical revisions, while current claim/dispatch checks require the current aggregate material and head. A historical reference is not permission to execute or reuse a result. The conservative no-attempt activation rule prevents live results from crossing revisions; explicit compatibility transitions remain Slice 7.

## Atomicity, schema and recovery

Optional `coding_insertion_version=1` adds immutable `coding_insertion_revisions` with the successor reference, proposal ID, source workflow revision/digest, full task material, superseded IDs and timestamp. It requires the existing binding/registry components; incomplete metadata/tables/guards and unsupported versions fail closed. Opening the component does not activate insertions or alter an existing run.

One `BEGIN IMMEDIATE` transaction writes the new definition/head, insertion record, superseded statuses, coding aggregate/audit event, proposal decision, consumed human proof, registry event and receipt. A lost reply is handled by retrying the identical principal/request/command. The immutable source digest lets that request return its historical receipt even after execution advances, without resetting the run. Current authorization, epoch and clock checks still apply.

Before-commit process death leaves the old runnable definition intact. After-commit death leaves the new definition awaiting approval and its complete receipt. Existing human restart approval can consume an already committed inserted result under its original pin without repeating its effect. No cross-machine failover, device power-loss qualification, automatic compensation, full component backup/restore certification or downgrade support is established here.

Verification evidence (not in this pack) · Executable example (not in this pack)
