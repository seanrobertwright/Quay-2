# Revise coding plans and branches

> **Praxis naming:** This page documents **Praxis**, the AIWS workflow engine. Existing `engine/*` source paths, `/engine/...` routes, `aiws-engine/*` protocol identifiers, and existing script names remain unchanged for compatibility.

M7 Slice 5 lets a human revise a [bound coding plan](./engine-execution-bindings.md) and dependencies among its existing preparation tasks **before first dispatch**. Old plans, graphs and task records remain retained. Every activation requires a fresh stage approval before execution.

The local worker can follow preparation forks and joins while executing one task at a time in a stable dependency order. This does not enable conditional branch skipping, task removal, concurrent branch execution or changes to already dispatched work.

## Try it

```sh
npm run example:engine:revision
npm run test:engine:m7-revision
```

The example adds two preparation tasks, revises their serial dependencies into independent branches that join at the coding plan, and revises implementation to verify both inputs before writing the deliverable. It validates and accepts the result, then prints its revision and evidence counts. Identity and approval storage are explicitly simulated; production hosts must independently authenticate and authorize human decisions.

Use current GitHub source and Node 24. Native SDK packages and remote dynamic CLI/web controls remain later work.

## Define the revision

```typescript
  definitionWithCodingRevision,
  normalizeCodingRevision,
} from './engine/src/coding-revision.ts';

const change = normalizeCodingRevision({
  plan: revisedPlan,
  tasks: existingPreparationTasks,
  dependencies: [
    { taskId: 'prepare', dependsOn: [] },
    { taskId: 'configuration', dependsOn: [] },
    { taskId: 'coding-plan', dependsOn: ['prepare', 'configuration'] },
  ],
});
await runner.publishPlan(change.plan);
const candidate = definitionWithCodingRevision(currentHead.definition, change);
```

This fragment assumes a bound run with those two preparation tasks and initialized runner/registry objects. Supply complete material for every existing preparation task and one dependency record for every node, including `coding-plan`. Publish the plan's exact immutable bytes before execution; publication alone grants no authority.

Store `candidate` through the [PROPOSE flow](./engine-dynamic-registry.md). The helper rejects cycles, detached tasks, output collisions and changes to protected policies. Every retained task must be required by the coding composite.

## Review and activate

```typescript
const command = {
  action: 'ACTIVATE_CODING_REVISION' as const,
  ref: { workOrderId, runId },
  proposalId,
  expectedWorkflowRevision: currentRecord.revision,
  change,
  approvalId: reviewedApprovalId,
};
const review = registry.review(runner.coordinator.epoch, command);
// Host obtains independently verified human approval for this exact review.
const result = registry.execute({
  epoch: runner.coordinator.epoch,
  requestId,
  credential: authenticatedHumanSession,
  command,
});
```

Review binds the exact commands, graph and current coding state. If the workflow changes while it is being reviewed, activation fails. An agent's proposal cannot activate itself, and plain `ACTIVATE` cannot bypass the revision checks.

After activation, fetch the updated state and use `approvalSubject(state)` with `runner.approve(...)`. The full runnable integration is `engine/examples/coding-revision.ts`.

## What can change?

| Material | Supported behavior |
|---|---|
| Plan description and implementation/validation/correction commands | May be revised with human approval |
| Existing preparation commands, outputs, criteria references and durations | May be revised within inherited limits |
| Dependencies among retained tasks | May be reordered, forked or joined in an acyclic graph |
| Run identity, authority, resource/correction limits and correction approval policy | Remain unchanged |
| Core output paths and acceptance criteria | Remain unchanged |
| Task identities | All retained; additions use [insertion](./engine-coding-insertion.md), removal stays disabled |

Criteria references do not perform semantic validation by themselves. Reviewed commands must actually check the required conditions. Tasks use the existing local worker's permissions and shared workspace.

## Existing work and recovery

Initial queued task/handoff instances are explicitly superseded and retained with their old pins. Claims, acquired handoffs, prior dispatches, completed work, pause/cancel controls, holds and stale ownership block revision. Accounting is preserved; activation adds no budget and refunds no work.

The worker executes a deterministic topological order. Before a preparation task or core implementation runs, all earlier preparation manifests are checked, including inputs from branches other than the immediately preceding task. A changed declared input holds the workflow as BRANCH_INPUT_CHANGED. Preparation outputs must use distinct paths; hidden dependencies remain the host's responsibility.

Results keep their exact revision, task, attempt and worker identity. Retrying an identical activation request recovers its committed receipt without resetting progress. After restart, existing human resume controls can consume saved evidence without repeating the effect. Uncertain work still requires reconciliation.

The contract is `spec/engine-v1/CODING-REVISIONS.md`; verification is recorded in `docs/M7-CODING-REVISIONS.md`. Slice 6 adds [agent replacement at settled stage boundaries](./engine-agent-replacement.md). Slice 7 adds [stale-result rejection and reviewed effect reconciliation](./engine-coding-reconciliation.md). M6 platform and long-duration qualification is still open.
