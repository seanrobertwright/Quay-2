# Insert governed coding tasks

> **Praxis naming:** This page documents **Praxis**, the AIWS workflow engine. Existing `engine/*` source paths, `/engine/...` routes, `aiws-engine/*` protocol identifiers, and existing script names remain unchanged for compatibility.

M7 Slice 4 lets a human activate additional preparation tasks before a [bound coding plan](./engine-execution-bindings.md) starts. An authorized agent may propose them. The tasks execute in order, then hand off to the original implementation → validation → correction workflow.

The first profile supports **insertion before the first dispatch**. It refuses changes to claimed, dispatched or completed work. Arbitrary branches and changes to running work need later lifecycle and effect controls.

## Run the example

```sh
npm run example:engine:insertion
npm run test:engine:m7-insertion
```

The example creates a coding plan that needs `prepared.txt`, binds it, proposes and approves a task to produce that file, then executes and validates the final output. It prints the insertion receipt and immutable record counts. Human identities and approvals are explicitly simulated; production hosts must independently authenticate and authorize them.

Use current GitHub source with Node 24. Native SDK packages, baseline source downloads and dynamic CLI/web commands do not yet expose this API.

## Propose executable material

```typescript

const tasks = [{
  taskId: 'prepare-input',
  command: [process.execPath, '-e',
    "require('node:fs').writeFileSync('prepared.txt','ready')"],
  outputPaths: ['prepared.txt'],
  criteriaRef: 'prepared input exists',
  maxTaskMs: 1000,
}];
const head = registry.getHead({ workOrderId, runId });
const candidate = definitionWithInsertions(head.definition, tasks);
```

This fragment assumes a bound run and initialized trusted registry. Store `candidate` through the existing [PROPOSE flow](./engine-dynamic-registry.md). Each new task declares its exact argument array, outputs, criteria reference and duration. The command must perform its required checks: a criteria reference alone does not run a semantic validator. Tasks execute with the existing local worker's permissions and workspace.

The helper preserves existing tasks and policies, creates a serial preparation chain, and connects it to the coding plan. Further insertions before dispatch append to that chain.

## Review and activate

```typescript
const command = {
  action: 'ACTIVATE_INSERTION' as const,
  ref: { workOrderId, runId },
  proposalId,
  expectedWorkflowRevision: currentRecord.revision,
  tasks,
  approvalId: reviewedApprovalId,
};
const review = registry.review(runner.coordinator.epoch, command);
// Host presents the exact review and resolves independently verified human approval.
const result = registry.execute({
  epoch: runner.coordinator.epoch,
  requestId,
  credential: authenticatedHumanSession,
  command,
});
```

The review includes the proposed graph, command material and current workflow state. An old approval cannot authorize changed commands or a changed coding state. Plain `ACTIVATE` cannot bypass the insertion checks.

After activation, fetch the new state and use `approvalSubject(state)` with `runner.approve(...)`. The run awaits this fresh stage approval; activation does not dispatch. The complete integration is in `engine/examples/coding-insertion.ts`.

## Limits and existing work

| Situation | Result |
|---|---|
| Initial bound run awaiting approval | Insert and await fresh approval |
| Initial queued task, no claim or attempt | Retain old task/handoff and pins, explicitly supersede them, create new execution IDs |
| Claimed task or acquired handoff | Refuse insertion |
| Dispatched, completed or uncertain work | Refuse insertion; preserve effects and accounting |
| Pause, cancel, open hold or stale owner | Refuse until the applicable control/recovery requirements are satisfied |

Inserted tasks inherit the plan's worker, authority and accounting scope. Their durations cannot exceed its per-task maximum. The prefix must fit the original attempt/time limits with room for core implementation and validation. This does not guarantee correction capacity; runtime admission still charges actual work and enforces the unchanged limits.

Superseded queued instances are marked CANCELED and their IDs are recorded. Their logical definition tasks and historical pins remain retained. No effects are refunded or silently deleted.

## Observe failures and recovery

Each inserted task gets its own task, handoff, attempt, result and validation pins. Inspect them with `registry.executionRecords(ref, after, limit)`. The aggregate exposes `insertions` and `insertionIndex`; preparation handoffs use the IMPLEMENTATION stage and identify the inserted logical task through its pin and dispatch action.

A failed inserted command holds the run before core implementation. An uncertain result keeps outstanding responsibility. After restart, the existing human resume flow can consume a committed result without re-running its effect. Retry an identical activation request to recover its receipt; this never resets execution progress.

The contract is `spec/engine-v1/CODING-INSERTION.md`; local verification is in `docs/M7-CODING-INSERTION.md`. Slice 5 now supports [plan/dependency revisions before dispatch](./engine-coding-revisions.md). Slice 6 adds [agent replacement at settled stage boundaries](./engine-agent-replacement.md). Slice 7 adds [stale-result rejection and reviewed reconciliation](./engine-coding-reconciliation.md); compatibility grants remain unsupported. M6 platform and long-duration qualification remains open.
