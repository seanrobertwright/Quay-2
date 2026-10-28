# Bind coding execution to a revision

> **Praxis naming:** This page documents **Praxis**, the AIWS workflow engine. Existing `engine/*` source paths, `/engine/...` routes, `aiws-engine/*` protocol identifiers, and existing script names remain unchanged for compatibility.

M7 Slice 3 connects the [durable definition registry](./engine-dynamic-registry.md) to the existing [coding workflow](./engine-coding-workflow.md). A human can explicitly bind a pre-dispatch run to its compiled revision-1 definition. Tasks, handoffs, attempts, worker results and validations then retain the exact revision and digest.

This is an experimental TypeScript engine source API for Node 24 + SQLite. Use current GitHub source. Native SDK packages, baseline source downloads and remote dynamic CLI/web controls do not yet expose it.

## Try the complete example

```sh
npm run example:engine:bound-coding
npm run test:engine:m7-bindings
```

The example writes and validates a real local artifact, binds the run, issues a fresh stage approval and accepts the result. It prints the committed receipt, definition and record counts. Human identity and review storage are explicitly simulated; production hosts must supply authenticated sessions, scoped permissions and independently verified approval evidence.

## Bind before dispatch

Create a coding run through `CodingWorkflowRunner`, then use `DynamicWorkflowRepository` against the same database:

```typescript
const command = {
  action: 'BIND_CODING' as const,
  ref: { workOrderId, runId },
  expectedWorkflowRevision: created.revision,
  approvalId: reviewedApprovalId,
};
const review = registry.review(runner.coordinator.epoch, command);
// Host presents this exact review and independently resolves human approval.
const result = registry.execute({
  epoch: runner.coordinator.epoch,
  requestId,
  credential: authenticatedHumanSession,
  command,
});
```

This fragment assumes initialized runner/registry instances and host-supplied identity, request and approval values. Reviewing alone grants no authority. `engine/examples/bound-coding.ts` supplies a complete runnable integration.

Binding creates or adopts only the exact compiled genesis definition. `definitionForCoding(plan, planArtifact)` represents the immutable coding plan as one composite node; the existing bounded implementation/validation/correction loop still executes its stages. A successful receipt and current head report `execution: CODING_V1`.

## Approval and migration rules

Only an initial run in AWAITING_APPROVAL or READY is eligible. Prior attempts, active claims, acquired handoffs, holds, nonzero resource exposure and replacement history prevent binding. Existing plan, task/handoff IDs, audit history and accounting are retained.

Binding clears any previous stage approval and returns the run to AWAITING_APPROVAL. Fetch the updated state and use the existing `approvalSubject(state)` and `runner.approve(...)` flow to approve the bound material. Binding approval does not authorize dispatch. In-flight or completed legacy runs remain unbound.

## Evidence and recovery

Dispatch envelopes and worker results carry definition identity plus task, attempt, worker and ownership epoch. The local worker preserves that snapshot. Missing or mismatched result bindings are rejected before delivery completion or accounting settlement. Rejection leaves outstanding responsibility intact.

Tasks and handoffs are checked before dispatch; durable results are checked again during composed validation and acceptance. Standalone validation and generic handoff/replacement APIs cannot bypass the bound coding path. After a restart, the existing human resume path may consume already committed evidence under its original pin without re-running its effect. A stale worker cannot publish a new result.

`registry.executionRecords({workOrderId, runId}, after, limit)` provides paginated immutable pins for TASK, HANDOFF, ATTEMPT, RESULT and VALIDATION. Retry the same binding request ID and command to recover its receipt; this does not reset a progressed run.

## Remaining scope

Slice 4 now supports [governed preparation-task insertion before dispatch](./engine-coding-insertion.md); Slice 5 adds [plan and dependency revisions before dispatch](./engine-coding-revisions.md). Replacement and explicit compatibility/effect handling remain later work. These tests establish local SQLite/process behavior, not device power-loss durability, production identity integration or M6 platform qualification.

The contract is `spec/engine-v1/EXECUTION-BINDINGS.md`; verification is recorded in `docs/M7-EXECUTION-BINDINGS.md`. See the [M7 slice map](./engine-dynamic-workflows.md).
