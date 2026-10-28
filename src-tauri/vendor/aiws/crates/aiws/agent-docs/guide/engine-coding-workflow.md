# Run a governed coding workflow

> **Praxis naming:** This page documents **Praxis**, the AIWS workflow engine. Existing `engine/*` source paths, `/engine/...` routes, `aiws-engine/*` protocol identifiers, and existing script names remain unchanged for compatibility.

The M5 source now composes an executable **approval → implementation → validation → correction → revalidation → acceptance** workflow. The same contracts also run a document-review example. The released SDK packages and the public engine wire API have separate scope; these APIs live in the TypeScript `engine/` source.

M5 is complete for the local Node 24 + SQLite profile. This page describes the runner, a local, sequential workflow with trusted commands. Its decisions are also exposed through the [HTTPS API, CLI and web controls](./engine-control-api.md), and catalog workflows run through the [`praxis` CLI](/engine-praxis-cli/). Organization enrollment and the remaining M6 and M8 qualification obligations are outside this profile.

Interactive diagrams accompany this page: the [governed coding workflow](./diagrams.md#governed-coding-workflow) and the [work order lifecycle](./diagrams.md#coding-work-order-lifecycle).

## Run the example

Use Node.js 24 from the repository root:

```sh
node engine/examples/coding-workflow.ts --demo
npm run test:engine:workflow
npm run engine:typecheck
```

The example deliberately implements subtraction where addition is required. A real Node assertion fails, one approved corrective command changes the implementation to addition, and the assertion passes. The workflow waits for acceptance before it records success. Four attempts are retained.

`--demo` explicitly selects a **simulated human session**. SQLite, subprocess execution, generated source, tests, artifact hashing and corrective work are real. This is not an organizational authentication example. The program prints its result and removes its temporary database, workspace and artifacts.

## Configure the runner and authentication boundary

```typescript

const runner = await CodingWorkflowRunner.open({
  database: '/trusted/state/engine.sqlite',
  workspaceRoot: '/trusted/workspaces',
  artifactRoot: '/trusted/artifacts',
  authentication: yourAuthenticationAdapter,
});
```

`yourAuthenticationAdapter` must implement both operations:

| Method | Host responsibility |
|---|---|
| `authenticate(credential)` | Verify the real session/token and return a human principal with an auditable, nonsecret evidence reference, or return `null` |
| `authorize(human, action, workOrderId, subjectDigest)` | Apply current permission policy for `APPROVE`, `RESUME` or `ACCEPT` on the exact work and material |

The runner never treats a caller-supplied `{ kind: 'HUMAN' }` as authentication. The adapter is trusted host code, and adapter verification is what establishes identity. Credentials are passed to it and are not serialized into the workflow. A fabricated adapter can fabricate authority; repository DTO checks alone cannot prevent that.

The artifact directory must remain outside tool-writable workspaces and under host control. Each work order/run receives a dedicated workspace derived from its identity. Commands are argument arrays executed without a shell wrapper. They run with the host process's privileges: this is **process execution, not an OS sandbox**. Use only reviewed local commands in this slice; external provider billing and hostile-tool isolation need their respective adapters.

## The immutable plan

`create(plan)` records a draft and publishes its canonical plan bytes. It does not dispatch anything. Repeating creation with the same identity and plan returns the existing work; a changed plan is rejected instead of resetting its budget or history.

| Field | Meaning |
|---|---|
| `workOrderId`, `runId` | Stable assignment and execution identities |
| `description`, `criteriaRef` | Intended result and named acceptance criteria |
| `implementation`, `validation`, `correction` | Exact approved command/argument arrays for the three stages |
| `outputPaths` | Unique relative files that form the deliverable and validation subject |
| `maxCorrections` | Maximum corrective tasks for this work order |
| `reapproveCorrections` | Whether each correction waits for a new human approval |
| `maxAttempts` | Total dispatch attempts, including implementation, validation and correction |
| `maxTaskMs` | Per-attempt active-time reservation; must fit the local Node timer range |
| `maxTotalActiveMs` | Cumulative active-time ceiling for the work order |
| `exposure` (optional) | `{ "kind": "NOT_APPLICABLE", "justification": "..." }` declares the run's cost not applicable. It is refused unless the run binds, under readiness 2.0.0, an agent whose model set is empty. It is part of the reviewed plan, a revision cannot add, change or drop it, and the operator view shows it |

The built-in adapter is for unmetered local execution: it reserves and settles cost as `"0"`. Active time and attempt counts still accumulate. It does not measure model/API charges or introduce a paid handoff summary. Handoffs are deterministic records.

The plan author must choose a trustworthy validation command. Keep validation logic outside agent-writable files or embed it in approved arguments, as the example does. The pinned deliverable consists of `outputPaths`; unspecified workspace files are not implicitly validated or accepted.

## Approve, execute and accept

```typescript
const draft = await runner.create(plan);
await runner.approve(
  plan.workOrderId,
  draft.revision,
  approvalSubject(draft.state),
  approvalExpiresAt,
  protectedSession,
);

const result = await runner.runUntilBlocked(plan.workOrderId);
```

`runUntilBlocked` advances the local sequence until a human gate, hold or acceptance is reached. `step(workOrderId)` executes or reconciles one stage. One runner performs one step at a time; this sequential executor is a slice implementation, not an advertised ceiling for the general scheduler.

| Status | Meaning |
|---|---|
| `AWAITING_APPROVAL` | Draft or correction requires a human decision; the task cannot dispatch |
| `READY` | Stage can progress if control, ownership, approval, inputs and resource checks permit it |
| `AWAITING_ACCEPTANCE` | Current deliverable passed its real validation; success is still pending |
| `HELD` | Execution failed, a limit was reached, an artifact changed, or responsibility is uncertain |
| `SUCCEEDED` | A permitted human accepted the exact validated deliverable and no owned work/responsibility remained unresolved |

For a correction requiring reapproval, read the current record and approve its new `approvalSubject`. The original attempt history, scope and usage remain. When correction reapproval is disabled, only the correction commands and bounds already contained in the human-approved immutable plan can run.

Final acceptance is explicit:

```typescript
const current = await runner.get(plan.workOrderId);
await runner.accept(
  plan.workOrderId,
  current.revision,
  current.state.deliverable!.digest,
  protectedSession,
);
await runner.close();
```

Acceptance checks current revision, successful validation, deliverable digest, immutable artifact bytes, current workspace outputs, unresolved attempts/tasks, holds and work-order controls. Passing a test or receiving a handoff is not acceptance. A canceled or paused work order cannot pass this acceptance gate.

This fixed-plan runner does not yet expose every remediation operation. An approval opens an approval window of 60 minutes, or shorter under host policy, that runs until the first dispatch it releases; later stages of the same approved material run with no approval clock. A run whose window closes with nothing dispatched returns to `AWAITING_APPROVAL` with reason `APPROVAL_LAPSED` and needs one fresh approval; it is not a hold. Held work requires an appropriate resolution capability; do not recreate it under a fresh ID to reset limits. Comprehensive limit-adjustment, reconciliation and approval-renewal interfaces remain integration work.

## What is atomic

The final dispatch transaction checks the composed workflow's ready state and epoch, immutable command material, scope and resource maxima, the approval window of the first dispatch a decision released and acknowledged input handoff. It consumes the handoff together with dispatch responsibility and ancestor reservations. A failed dispatch leaves the handoff unconsumed.

Stage completion is another single SQLite transaction. It records validation/settlement, marks the task complete, applies the correction bound, creates the next task and handoff when needed, and advances the workflow record and audit event. The validation repository now uses the scheduler's real `scheduler_sequence` and fairness tables; the former component-only test table mismatch is fixed.

Artifacts are published and fsynced before references commit. A crash before the database transaction may leave an unused artifact, which grants no authority. Manifest and content hashes are verified at input and acceptance. Validation is bound to the same declared output manifest before and after the test; changed source cannot borrow an older successful result.

The completed worker evidence contains the executed command, exit code, stdout/stderr, timestamps, measured monotonic duration and artifact digests. A repeated attempt cannot substitute different validation evidence.

## Pause and restart

The runner uses the existing durable controls through its bounded storage executor. `controlPause`, `controlResume` and cancellation APIs remain **trusted host APIs**; their actor DTOs do not authenticate a caller. The [control API](./engine-control-api.md) verifies identity through the host's identity adapter before it constructs those commands. Pause blocks new dispatch; already-authorized responsibility is preserved.

Opening the runner advances the coordinator epoch. That does not authorize a previously active workflow to resume. A subsequent `step` reports `RECOVERY_REQUIRED` until an authorized human records:

```typescript
const stopped = await runner.get(plan.workOrderId);
await runner.resume(
  plan.workOrderId,
  stopped.revision,
  approvalSubject(stopped.state),
  protectedSession,
);
```

If durable worker evidence already exists, the runner finishes the recorded stage without executing its command again. If dispatch was authorized but completion evidence is absent, restart approval returns `RECONCILIATION_REQUIRED`. It cannot establish that the external action never ran. Timeouts retain `UNKNOWN` responsibility and active-time exposure, with no automatic correction or retry.

## Verification and current limits

The source suite passes **87 engine tests**, including **15 composed-workflow integration tests**. It covers real failing/passing commands, correction reapproval/exhaustion, attempts, stale artifacts, pause/cancel, authentication/authorization failures, transaction rollback, timeout uncertainty, and a non-coding review workflow.

A real child coordinator is killed after it stores execution evidence. After reopening the actual database and recording a human restart decision, the workflow completes with exactly the expected four command executions. This supplements the earlier persistence crash tests; it does not complete all M4 failure scenarios or prove power-loss durability.

Native Windows/macOS qualification, process-tree cancellation and hostile-worker sandboxing, public wire/CLI/web handlers, full identity/enrollment integration, PostgreSQL, retention/restore and the full conformance catalog remain outside this slice's evidence. See [persistence](./engine-persistence.md), [worker execution](./engine-worker-execution.md), [validation and correction](./engine-validation-correction.md), and [human controls](./engine-controls-handoffs.md).


## Authenticated control follow-up

The next source increment exposes this lifecycle through the [engine API, CLI and web controls](./engine-control-api.md). It adds exact wire decoding, verified host sessions, single-use approval challenges and atomic command receipts. The 87-test count above is this composition slice's historical evidence; the control follow-up expands it. Production identity-provider enrollment and full engine conformance remain open.
