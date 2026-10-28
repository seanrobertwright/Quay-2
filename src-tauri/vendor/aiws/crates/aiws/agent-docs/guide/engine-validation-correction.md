# Praxis validation, settlement and correction

> **Praxis naming:** This page documents **Praxis**, the AIWS workflow engine. Existing `engine/*` source paths, `/engine/...` routes, `aiws-engine/*` protocol identifiers, and existing script names remain unchanged for compatibility.

The executable engine now separates **worker execution success** from **workflow validation**. A command that exits successfully is evidence that the worker ran successfully; it does not by itself prove that the implementation satisfies the workflow's acceptance criteria.

## Validation boundary

Validation is recorded against an exact dispatch attempt and task. The record includes:

- validation outcome: `PASSED`, `FAILED` or `UNKNOWN`
- criteria reference
- evidence reference
- actual cost
- actual active time
- validation timestamp

`PASSED` and `FAILED` are settled outcomes. `UNKNOWN` is not.

## Settlement

Dispatch admission reserves the maximum authorized cost and active time across every applicable ancestor scope. After validation, the engine can reduce that conservative exposure to the actual measured usage.

For example, if an attempt was authorized for a maximum cost of `30` and `5000` ms active time but validation reports actual usage of `12` and `1200` ms, every ancestor scope retains `12` cost and `1200` ms active-time exposure for that attempt rather than the original maximum reservation.

This is a release of unused reservation, not a refund of work that actually happened.

HANDOFF-purpose attempts use the same settlement rule while remaining inside the protected handoff partition.

## Failed validation and correction

A work order may configure a bounded correction rule:

```ts
await storage.validationConfigureCorrectionRule({
  workOrderId: 'wo-123',
  maxCorrections: 2,
  reapprovalRequired: true,
});
```

When validation fails and allowance remains, the engine creates a new READY correction task. The correction receives a new task identity and carries durable references to the failed attempt, source validation, source task and evidence.

The correction payload also records whether reapproval is required. This flag does not authorize execution; the correction must still pass the normal supervised-admission and `DISPATCH_AUTHORIZED` gate.

## Correction exhaustion

If the configured correction count is exhausted, the failed attempt is still settled to actual usage. No further task is created, and the validation records `correction_exhausted=1`.

This is intentionally not an automatic terminal failure. The next human-control layer can turn that condition into a hold, cancellation choice, replanning request or human-approved resource change.

## UNKNOWN validation

`UNKNOWN` means the engine cannot truthfully establish whether the material outcome satisfies the criteria. In this case:

- maximum exposure remains reserved;
- the attempt moves to `UNKNOWN`;
- no correction task is generated;
- reconciliation or human intervention is required before potentially duplicating work.

A timeout, worker loss or incomplete external observation is never treated as proof that nothing happened.

## Idempotency

Validation is unique per dispatch attempt. Re-submitting the same attempt after the validation has committed returns the durable result instead of creating duplicate settlement or corrective work.

## Current M5 status

The Node 24 engine verification suite passes 44/44 tests covering persistence, scheduling, coordinator recovery, supervised dispatch, worker delivery/execution, validation settlement and bounded correction.

The remaining M5 work is primarily orchestration: durable stage handoffs, human pause/hold/cancel/resume controls, a complete coding workflow with correction and revalidation, and restart/conformance proof across the full scenario.

## Composed workflow follow-up

The [governed coding workflow](./engine-coding-workflow.md) now connects these primitives into real approval, implementation, validation, correction and acceptance. Its source suite includes a real coordinator-termination/restart test. Earlier counts and next-step descriptions on this page record the original component delivery; M5 still needs broader interface and conformance integration.
