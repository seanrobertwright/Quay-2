# Worker dispatch and coding execution

> **Praxis naming:** This page documents **Praxis**, the AIWS workflow engine. Existing `engine/*` source paths, `/engine/...` routes, `aiws-engine/*` protocol identifiers, and existing script names remain unchanged for compatibility.

M5 now includes a durable worker-delivery layer for committed `DISPATCH_AUTHORIZED` attempts. This page describes engine source behavior; it does not change the released SDK finite-v1 API surface.

An interactive [worker dispatch lease](./diagrams.md#worker-dispatch-lease) diagram traces the claim, admission, acknowledgement, execution and outcome classification.

## Authority and delivery are separate

A scheduler claim does not authorize execution, and a worker delivery does not create new authority. The material action becomes authorized only when supervised admission commits `DISPATCH_AUTHORIZED`. The worker layer then transports that existing authority to the exact worker and coordinator epoch.

```text
CLAIMED
  -> supervised admission
  -> DISPATCH_AUTHORIZED
  -> durable dispatch intent
  -> worker delivery claim
  -> worker acknowledgement
  -> controlled command execution
  -> execution evidence
```

A worker may claim an intent only when the underlying attempt is still `DISPATCH_AUTHORIZED` and belongs to the same coordinator epoch. Each dispatch intent has at most one durable worker-delivery record.

## Controlled workspace execution

`LocalCodingWorker` executes an argument-vector command with `shell: false` under a configured workspace root. The relative working directory must resolve inside that root. Artifact paths are checked the same way. Parent traversal outside the approved workspace is rejected.

The worker records:

- exact command arguments;
- relative working directory;
- start and finish timestamps;
- exit code and signal;
- stdout and stderr;
- produced artifact paths, sizes, and SHA-256 digests;
- a durable evidence identity;
- execution outcome: `SUCCEEDED`, `FAILED`, or `UNKNOWN`.

Timeout is conservative. If a process is terminated because its time bound expired, the worker reports `UNKNOWN`; timeout is not proof that a material effect did not occur.

## Outcome semantics

`SUCCEEDED` and `FAILED` are worker execution observations. They are not equivalent to workflow verification or acceptance. The following M5 slice binds execution evidence to actual validation, limit settlement, correction rules, and handoffs.

`UNKNOWN` is also propagated to the governed dispatch attempt so the engine does not blindly retry an action whose external effect may be ambiguous.

## Current implementation files

- `engine/src/worker-execution.ts` — durable delivery repository and controlled local coding worker.
- `engine/src/storage-worker.ts` — storage-thread routing for worker delivery operations.
- `engine/src/storage-executor.ts` — coordinator-facing asynchronous delivery API.
- `engine/test/worker-execution.test.ts` — delivery, epoch, UNKNOWN, real process, artifact digest, and workspace containment tests.

The dedicated Node 24 engine CI runs strict TypeScript checking and the complete engine test suite for these sources.

## Composed workflow follow-up

The [governed coding workflow](./engine-coding-workflow.md) now connects these primitives into real approval, implementation, validation, correction and acceptance. Its source suite includes a real coordinator-termination/restart test. Earlier counts and next-step descriptions on this page record the original component delivery; M5 still needs broader interface and conformance integration.
