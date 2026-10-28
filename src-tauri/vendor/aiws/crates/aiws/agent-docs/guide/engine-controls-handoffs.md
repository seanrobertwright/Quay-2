# Praxis human controls and handoffs

> **Praxis naming:** This page documents **Praxis**, the AIWS workflow engine. Existing `engine/*` source paths, `/engine/...` routes, `aiws-engine/*` protocol identifiers, and existing script names remain unchanged for compatibility.

> **Implementation status:** M5 source implementation. These engine APIs are not part of the released SDK package surface.

The M5 engine now has durable human controls and engine-owned handoffs layered on top of the scheduler, supervised dispatch, controlled worker execution, and validation/correction pipeline.

## Work-order control state

Each work order may have one durable control state:

- `RUNNING` — new material dispatch is allowed when every other admission check passes.
- `PAUSED` — new material dispatch is blocked, but existing responsibility remains.
- `CANCEL_PENDING` — new material dispatch is blocked while live/unknown responsibility is settled.
- `CANCELED` — cancellation is final after unresolved responsibility is cleared.

Pause and cancellation never imply that an external action stopped. A previously committed `DISPATCH_AUTHORIZED` or `UNKNOWN` attempt remains accountable until it is settled or reconciled.

## Dispatch race protection

The control subsystem installs a SQLite trigger at the authoritative dispatch table. If a work order becomes paused or cancel-pending while admission is racing toward commit, insertion of the material dispatch attempt is rejected.

This means a pre-check is not the final safety mechanism. The durable database boundary remains authoritative.

## Human-only control actions

The implementation records authenticated human evidence for:

- pause;
- resume;
- cancel request;
- cancel finalization;
- reconciliation retry decisions;
- agent replacement.

Rule/agent actors cannot use these APIs to change human control state or replace their own agent assignment. Agent replacement increments a durable assignment revision and does not reset budgets, attempts, approvals, or evidence.

## Cancellation and unknown outcomes

Cancellation may enter `CANCEL_PENDING` immediately, but it cannot become final while the work order still owns `DISPATCH_AUTHORIZED` or `UNKNOWN` material responsibility.

This keeps cancellation truthful: "cancel requested" is different from "all material work is safely settled."

## Engine-owned handoffs

M5 handoffs connect the major coding stages:

```text
planning -> implementation -> validation -> correction
```

A handoff records:

- work-order and run identity;
- producer task and consumer task;
- stage;
- immutable artifact reference;
- artifact digest;
- a non-authoritative summary;
- claim/acknowledgement/consumption state.

The durable lifecycle is:

```text
PENDING -> CLAIMED -> ACKNOWLEDGED -> CONSUMED
```

Acknowledgement means the intended consumer has durably received the handoff. It does **not** mean the consumer's work succeeded or was accepted.

## What survives pause, resume, or replacement

Control changes do not reset:

- cost or active-time usage;
- attempt counts;
- protected handoff usage;
- approval expiry/history;
- dispatch responsibility;
- validation evidence;
- correction history;
- consumed handoffs.

This is critical for resumability: a new worker or agent continues the same governed mission rather than receiving a fresh budget or authority window.

## Current tested behavior

The Node 24 engine suite currently covers 50 scenarios total. New control/handoff coverage verifies durable pause/resume, the database-level pause-vs-dispatch race, cancellation blocked by unresolved responsibility, human-only revisioned agent replacement, restart-safe handoff lifecycle, and append-only reconciliation decisions.

## Remaining M5 work

The next step is to compose the implemented primitives into the first complete coding workflow:

```text
plan
  -> human approval
  -> implementation
  -> handoff
  -> validation
  -> correction when needed
  -> revalidation
  -> acceptance
```

After that workflow works end to end, M5 still requires a restart/conformance closure pass that interrupts it at critical boundaries and proves recovery without duplicate material effects, lost responsibility, or stale approvals.

## Composed workflow follow-up

The [governed coding workflow](./engine-coding-workflow.md) now connects these primitives into real approval, implementation, validation, correction and acceptance. Its source suite includes a real coordinator-termination/restart test. Earlier counts and next-step descriptions on this page record the original component delivery; M5 still needs broader interface and conformance integration.
