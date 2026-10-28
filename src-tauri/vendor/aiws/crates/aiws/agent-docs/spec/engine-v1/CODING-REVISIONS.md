# M7 Slice 5 — governed plan and dependency revisions

Status: experimental TypeScript engine source, Node 24 + SQLite. Extends [coding insertion](./CODING-INSERTION.md) and [execution binding](./EXECUTION-BINDINGS.md). This profile revises work only before first dispatch; M6 qualification remains open.

M10 amends this contract: a revision keeps each node's bound agent instead of a hard-coded local agent, and agent changes go through agent replacement (not in this pack). The amendment is specified, not implemented; the sentences that state it name the M7 behaviour they replace.

## Supported changes and compatibility

`CodingRevision` contains exactly `plan`, `tasks` and `dependencies`. The plan is a closed `CodingPlan`; tasks contain complete material for every existing preparation task; dependencies contain one closed `{taskId, dependsOn}` record for every preparation node and the `coding-plan` composite.

| Change | Behavior |
|---|---|
| Coding description or implementation/validation/correction command | Allowed with exact human review and a new immutable plan artifact |
| Existing preparation command, outputs, criteria reference or duration | Allowed with exact human review; duration remains within inherited limits |
| Dependencies among retained preparation nodes and the coding composite | Allowed for an acyclic graph in which every node is required by the coding composite |
| Work-order/run identity, authority, cost/time/attempt/correction bounds or correction approval policy | Refused |
| Core output paths or acceptance criteria | Refused; acceptance digest remains unchanged |
| Adding/removing task identities | Refused by revision; additions use Slice 4 insertion, removal remains disabled |
| A node's exposure allowance or stop threshold (M10) | Allowed with exact human review as a definition revision; scope bounds change only by the ledger's human adjustment (§6 (not in this pack)) |
| Changing a node's agent | Refused; agent replacement (not in this pack) is the only route |
| Conditional branch skipping, after-dispatch changes or reuse of old effects/results | Refused or unsupported; later lifecycle work is required |

`normalizeCodingRevision(input)` validates closed JSON material, including descriptors before reading caller properties. `definitionWithCodingRevision(base, change)` compiles the exact successor candidate. Task IDs are retained, and each task keeps the agent of its node's current assignment (§4 (not in this pack)); a revision never substitutes a hard-coded agent. The M7 implementation writes the local coding worker `engine:local-coding` for every task and refuses a definition naming any other agent with `AGENT_REPLACEMENT_DISABLED`; material and dependency changes appear in the normal preflight impact report. No-op changes, cycles, detached branches and duplicate preparation output paths fail. All existing tasks must be ancestors of the required coding composite, so removing a dependency cannot silently discard a branch.

## Execution of branches

The local worker still executes one task at a time. A deterministic topological ordering chooses the lexically first ready task ID, respecting every declared dependency. Independent branches are supported structurally but are not executed concurrently. This profile does not evaluate conditional predicates or skip a branch.

The ordered task material is durably pinned to the successor revision. All preparation tasks must finish before the original coding-stage interpreter proceeds. The run retains successful preparation manifests in `preparationOutputs`; before another preparation task or core implementation starts, every previously completed preparation artifact is verified against both immutable storage and the workspace. This deliberately checks more than the immediate predecessor, so one intact branch cannot hide a changed input on another branch at a join. Declared preparation outputs must not collide. Hosts remain responsible for hidden file dependencies, command semantics and external permissions in the shared workspace.

Core implementation may consume and transform the inputs. The existing implementation → validation → correction loop and human acceptance remain intact. Each actual task/attempt/handoff/result/validation binds its current definition, material and worker epoch. After the core starts, preparation workspace files are not frozen indefinitely; final validation and acceptance verify the core deliverable.

## Approval and artifact publication

Publish the normalized revised plan with `runner.publishPlan(change.plan)` before execution. This stores canonical immutable bytes and returns their SHA-256 digest; it grants no activation or dispatch authority. `definitionWithCodingRevision` and activation derive the same artifact digest from the normalized plan. The registry stores exact reviewed material but does not access the filesystem to verify publication. A missing artifact prevents the runner from dispatching; it is not silently reconstructed.

Store the candidate through the existing authenticated `PROPOSE` API. Agents with propose authority may suggest changes. `ACTIVATE_CODING_REVISION` requires exactly `ref`, `proposalId`, `expectedWorkflowRevision`, `change` and `approvalId`.

The trusted host must independently verify human identity, action/run scope and current approval evidence. Review binds installation, ownership/authority epochs, action, base/candidate/proposal digests, exact coding-state revision and digest, plus the normalized revision material digest. An approval for changed commands, dependencies or state fails. Plain registry `ACTIVATE` cannot bypass operation-specific execution checks.

Successful activation creates a new definition and plan, supersedes any initial queued execution instances, clears stage approval and sets AWAITING_APPROVAL with REVISION_REAPPROVAL_REQUIRED. Fetch the updated state and issue fresh stage approval with `approvalSubject(state)` and the existing `runner.approve` flow. Proposal approval never dispatches work.

## Lifecycle, history and accounting

Activation reuses Slice 4's conservative initial-boundary checks: initial IMPLEMENTATION stage/ordinal zero, no input/deliverable/acceptance, no completed prefix task, no historical dispatch attempt, no active claim or acquired handoff, current owner epoch, healthy clock, RUNNING controls, no open holds, replacement history or non-pristine accounting.

Queued task and handoff rows are explicitly marked CANCELED as superseded execution instances. Their IDs, old pins, old definitions, plan artifacts and audit records remain retained. Logical tasks are not removed or claimed to have executed. New execution IDs and approval prevent an old queued task from becoming authority for revised commands.

The complete preparation graph must fit the original attempt/time limits with core implementation/validation headroom. It uses the same accounting scope; no cost, attempts or active time is reset/refunded. Correction capacity is still subject to runtime limits. Refused revisions do not stop existing work, reconcile effects or settle exposure. Because no dispatched work can cross an activation, this slice grants no cross-revision result compatibility.

Additional insertion remains possible before dispatch: the first new task depends on all current coding-composite predecessors, then the new serial prefix tail precedes the coding composite. The approved revised plan and existing dependency branches remain retained.

## Storage, atomicity and recovery

Optional `coding_revision_version=1` adds immutable `coding_revision_material` containing the exact normalized plan/task/dependency records and their definition reference. It requires the prior insertion/binding/registry components. Execution transitions reuse `coding_insertion_revisions` for the pinned task order, source revision/digest and explicit superseded IDs. Current aggregate plan identity is checked against the current definition's composite material and protected policy digests, while old execution pins remain tied to their historical revisions.

New revision/head, normalized material, execution transition, superseded statuses, coding aggregate/audit event, proposal decision, approval consumption and receipt commit in one SQLite writer transaction. Unsupported component versions, missing metadata/tables or missing immutability guards fail closed.

Exact principal/request/command retries return the historical committed receipt after progress without resetting the plan or counters. Current authorization, clock and ownership checks still apply. A lost reply or process kill yields the entire old run or the entire revised run awaiting approval. The existing human resume path can consume already committed revised evidence without repeating the effect.

These checks do not establish device power-loss durability, full component backup/restore certification, production identity integration, cross-machine failover or downgrade support. Verification (not in this pack) and the example (not in this pack) record the local evidence.
