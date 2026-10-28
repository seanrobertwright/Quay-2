# Governed dynamic workflows

> **Praxis naming:** This page documents **Praxis**, the AIWS workflow engine. Existing `engine/*` source paths, `/engine/...` routes, `aiws-engine/*` protocol identifiers, and existing script names remain unchanged for compatibility.

M7 adds governed changes to running workflows. **It provides change preflight, a supervised registry, coding binding, preparation-task insertion and plan/dependency revisions before dispatch, reviewed agent replacement at settled stage boundaries, explicit effect reconciliation with stale-result rejection, and native clients for the dynamic controls.** See the [registry guide](./engine-dynamic-registry.md) for persistence, approval and atomic definition activation. These experimental engine APIs are in the repository and the source download, not in the SDK packages; the SDK packages carry only the [dynamic-controls client](./engine-dynamic-controls.md).

## Status

This page describes behavior, not delivery status. [BUILD-PLAN](https://github.com/seanrobertwright/AI-WS-SDK/blob/main/BUILD-PLAN.md) records which M7 slices are complete, and the [capability matrix](./capabilities.md) states what each capability supports. M7 does not close the separate M6 platform or M8 qualification gates.

See [agent replacement and handoff](./engine-agent-replacement.md) for transfer authority, adapter installation, acknowledgment and uncertain-work holds.

See [held-work reconciliation](./engine-coding-reconciliation.md) for effect proofs, stale assessments and retry without replenishing accounting.

## Run the first slice

From the repository root, on Node.js 24:

```sh
npm run example:engine:dynamic
npm run test:engine:m7-contract
```

The executable example is `engine/examples/dynamic-workflow.ts`. It proposes inserting a lint task between implementation and verification. Its result identifies lint and verification as affected, with `activation: NOT_AUTHORIZED`. It does not enqueue or execute tasks.

The experimental host API lives in `engine/src/dynamic-workflow.ts`:

```ts
  workflowDefinitionDigest,
  preflightWorkflowChange,
} from './engine/src/dynamic-workflow.ts';

// base is a validated aiws-dynamic/1 definition loaded by your host.
const baseDigest = workflowDefinitionDigest(base);
const candidate = structuredClone(base);
candidate.revision = base.revision + 1;
candidate.parentDigest = baseDigest;
candidate.tasks.push({
  taskId: 'lint',
  materialDigest: lintMaterialDigest,
  agentId: 'tester',
  dependsOn: ['implement'],
});
candidate.tasks.find(task => task.taskId === 'verify')!.dependsOn = ['lint'];

const review = preflightWorkflowChange(base, {
  format: 'aiws-change/1',
  proposalId: 'insert-lint',
  baseDigest,
  proposedBy: { kind: 'AGENT', principalId: 'planner' },
  reason: 'Check style before validation',
  candidate,
});
```

This integration fragment assumes `base` and `lintMaterialDigest` are host-supplied. The executable example supplies a complete definition and explicitly labeled demonstration digests. Slice 8 adds [native TypeScript/Rust/Python clients and remote CLI/web controls](./engine-dynamic-controls.md) over the optional dynamic HTTPS profile.

## What the contract checks

A definition contains a stable work-order/run identity, revision and parent digest, immutable authority/limits/acceptance digests, and tasks with material digests, agent identities and dependency lists. Task material must eventually resolve to the exact intended command, inputs, outputs and credentials. The host must verify that material and enforce current authority before execution.

Preflight rejects missing/unknown fields, invalid identities or digests, duplicate tasks/edges, missing dependencies, cycles, stale base/parent references, revision gaps, no-op edits and changes to protected policy digests. It rejects protected-policy changes even when the proposer labels itself human. A proposer label is not authentication.

Definition and proposal digests are deterministic and domain-separated. Task/dependency order does not change identity. The proposal digest binds its candidate, proposer, reason and proposal ID. Returned objects are detached from the input.

## Impact and stale work

The affected set includes directly changed tasks and their downstream dependents in both the old and new graphs. Removing an edge therefore cannot hide its previous downstream impact. An independent branch is reported as structurally unaffected, but that does not establish safe reuse: shared files, external effects and other hidden dependencies still require host assessment.

All results carry `resultCompatibility: REJECT_UNLESS_EXPLICITLY_APPROVED`. This is a contract obligation for future consumption, not an implemented result-admission gate. Preflight does not invalidate assessments, cancel work, reconcile effects or reset resource consumption.

## Activation boundary

Successful preflight means the proposal can be reviewed. The Slice 2 registry checks the current persisted head again, verifies exact approval material, fences stale ownership epochs, and records a durable decision atomically. It leaves ledgers/holds untouched and rejects existing executable work. Slice 3 adds explicit [revision binding for initial coding runs](./engine-execution-bindings.md), with fresh human stage approval and immutable evidence pins. Existing coding workflows retain their immutable plans. Slice 4 adds [approved serial preparation-task insertion](./engine-coding-insertion.md) before dispatch; Slice 5 adds [plan and dependency revisions](./engine-coding-revisions.md) with retained nodes and sequential execution of preparation forks/joins. There is no implicit conversion into an arbitrary executing graph.

The full contract and future invariants are in `spec/engine-v1/DYNAMIC-WORKFLOWS.md`. Validation evidence and remaining scope are in `docs/M7-DYNAMIC-CONTRACT.md`.
