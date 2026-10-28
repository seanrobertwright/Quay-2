# Recurring schedules and missed-tick recovery

> **Praxis naming:** This page documents **Praxis**, the AIWS workflow engine. Existing `engine/*` source paths, `/engine/...` routes, `aiws-engine/*` protocol identifiers, and existing script names remain unchanged for compatibility.

M6 slice 2 implements **fixed UTC interval schedules** in the TypeScript engine source. Each occurrence creates a durable ready task. Its identity, the represented or skipped interval and the schedule cursor commit atomically. A timer notification merely prompts the coordinator to inspect SQLite.

This builds on [persistent clock tracking](./engine-clock-recovery.md) and bounded scheduling recovery (not in this pack). Cron expressions, time zones, daylight-saving transitions and calendar rules are unsupported and rejected. The released TypeScript, Python and Rust SDK packages are unchanged.

## Choose what happens after missed ticks

Assume the first tick is at **100 ms**, the interval is **10 ms**, and recovery observes **145 ms**. Five ticks are due: ordinals 0–4, at 100–140 ms.

| Policy | Tasks created | Durable range record | Next tick |
|---|---|---|---|
| `COALESCE_ONE` (default) | One task for ordinal 4 | That task represents ordinals 0–4 | Ordinal 5 at 150 ms |
| `SKIP` | None | Ordinals 0–4 skipped | Ordinal 5 at 150 ms |
| `BOUNDED_REPLAY`, limit 2 | Tasks for ordinals 0 and 1 | Ordinals 2–4 skipped | Ordinal 5 at 150 ms |

`SKIP` suppresses ticks earlier than the observed time. A tick **exactly equal** to the observed time is on time and produces one task; for example, observing 150 ms skips earlier missed ticks and emits ordinal 5. With this policy, even a slightly late poll skips the late tick. Choose the default coalescing policy when eventual periodic execution is required despite polling jitter.

Bounded replay emits the oldest due ticks. Its effective limit is the smaller of the human-approved `replayLimit` and the coordinator's `recurringOccurrenceBatchSize`. The rest of that entire missed range is recorded as skipped. Increasing the batch size or calling reconciliation again at the same time cannot replay the skipped range. A later tick begins a new range.

Large ranges are stored as endpoints rather than millions of rows. Arithmetic uses integer milliseconds and `BigInt` for ordinals and interval calculations. When a next tick would exceed year 9999, the schedule becomes `EXHAUSTED` with no next due time.

## Define and approve a schedule

```typescript
const definition = {
  namespace: 'operations',
  scheduleId: 'document-review',
  revision: 1,
  firstTick: '2026-09-11T12:00:00.000Z',
  intervalMs: 3_600_000,
  catchUp: 'BOUNDED_REPLAY' as const,
  replayLimit: 2,
  task: {
    workOrderId: 'review-work-order',
    runId: 'review-run',
    taskClass: 'document-review',
    payload: { documentRef: 'approved-document-reference' },
  },
};

const schedule = await coordinator.createRecurringSchedule(
  definition,
  operatorCredential,
  scheduleApprovalAdapter,
);
```

The host supplies `operatorCredential` and `scheduleApprovalAdapter`. The adapter's `verify(credential, context)` method must authenticate and authorize a human for the exact `context.subjectDigest` and `context.material`, within `context.epoch`. It returns `null` to deny or a verified `ScheduleApproval`:

| Field | Meaning |
|---|---|
| `kind` | Must be `HUMAN` |
| `principalId` | Verified operator identity |
| `evidenceRef` | Durable approval evidence reference |
| `subjectDigest` | Exact digest supplied in the verification context |
| `expiresAt` | Canonical UTC expiry for applying this approval |

The approval must still be valid when the creation/control transaction runs. It authorizes installing or controlling that schedule, not future external effects. Worker claims, tool execution, artifacts, credentials, limits, manual holds and current policy still pass through the existing dispatch gates.

A schedule's task template names an existing host work-order/run identity and task class. It does not create a new composed coding-workflow instance per tick. A host adapter must consume the ready tasks, map their immutable inputs, and obtain the applicable dispatch authorization. The engine does not execute an arbitrary shell command just because a schedule became due.

## Identity, task inputs and revisions

An occurrence key is an unambiguous JSON tuple of installation ID, namespace, schedule ID, immutable definition revision and ordinal. Its task ID is derived from that key. Ordinals are canonical decimal strings. Separate installations, namespaces and revisions have distinct identities.

Each generated task's payload contains:

- `schedule`: the schedule reference, occurrence key, ordinal, represented range and due time;
- `input`: the approved template payload.

The work-order/run/task-class fields come from the approved template. No budget, permission or approval is silently copied into a new authorization.

Definition revisions are immutable. Repeating creation with identical material returns the existing record without reactivating it. Changing the interval, policy, payload or other material under the same revision fails. Cancel the previous active/paused revision before approving the next consecutive revision with an explicit `firstTick`. Old occurrences and tasks remain intact.

`stateVersion` is separate from the definition revision. Draining or controlling a schedule increments its state version, which makes stale human control requests fail instead of overriding concurrent progress.

## Pause, resume, cancel and inspect

```typescript
const inspection = await storage.recurringInspect({
  namespace: 'operations', scheduleId: 'document-review', revision: 1,
});

await coordinator.controlRecurringSchedule({
  ref: { namespace: 'operations', scheduleId: 'document-review', revision: 1 },
  expectedVersion: inspection.schedule!.stateVersion,
  action: 'PAUSE', // also RESUME or CANCEL
}, operatorCredential, scheduleControlApprovalAdapter);
```

The control adapter verifies a human approval bound to the action, schedule reference and expected state version. Pause stops future occurrence generation and preserves the cursor. Resume applies the original catch-up policy to the accumulated interval; it does not renew deadlines, reset budgets or change the interval. Cancel permanently stops future generation for that revision. It does not cancel, delete or refund tasks already emitted; use the applicable work-order/task controls for those responsibilities.

`recurringInspect` returns a consistent schedule record and its occurrence, recovery-range and decision history. Inspection currently returns the complete history for that schedule; pagination and retention remain later M6 work. A lost control response should be followed by inspection, since retrying the old state version can legitimately fail after a committed change.

## Coordinator and storage settings

```typescript
const coordinator = new EngineCoordinator(storage, {
  automatic: true,
  recurringScheduleBatchSize: 100,
  recurringOccurrenceBatchSize: 100,
});
```

Both values are positive safe integers with defaults of 100. They are deployment tuning settings, not total task/workflow ceilings. Per reconciliation, at most `recurringScheduleBatchSize` due schedules are selected oldest-first. Each schedule processes its missed range in a separate transaction and emits at most its effective occurrence limit. Earlier schedule commits survive a later schedule failure; retry inspects the durable cursor.

Startup and subsequent reconciliation both drain recurring schedules. `reconcileOnce()` reports the committed summaries in `recurringRecoveries`. Call it yourself when `automatic: false`; otherwise the existing coordinator loop supplies periodic reconciliation. Duplicate or lost notifications do not determine schedule truth.

The storage APIs are `recurringCreate`, `recurringControl`, `recurringDrain` and `recurringInspect`. The first three take no time argument: each takes its own reading of the coordinator's clock, which the storage worker observes just before the write, so a concurrent clock observation cannot make it stale. Direct repository users can use `RecurringScheduleRepository`, passing a clock reading they have just observed for the current epoch; a reading that is no longer the latest observation is refused `CLOCK_STALE`. These are trusted-host composition APIs. Never pass unverified HTTP or worker-provided approval objects into them. No new HTTP, CLI or browser schedule-management endpoint is introduced here.

During a clock uncertainty hold, due state can advance at the persisted high-water UTC, while new execution remains blocked by the clock gates. One-time waits retain their independent behavior: a repeating schedule's `SKIP` policy cannot discard an overdue one-time wake-up.

## Persistence and verification

Schedule definitions/cursors, control evidence, emitted occurrences and recovery ranges are persisted in four recurring-schedule tables. Task readiness and its scheduler sequence/fairness records commit with each occurrence and cursor advance. A unique occurrence key and transactional cursor prevent silent duplicate creation after a lost response or restart. Task-ID conflicts or storage failures roll back the entire schedule recovery transaction.

The component tables initialize transactionally in the existing schema-1 source profile. Older source revisions do not process these schedules; keep all engine components on the updated revision. [Local backup/restore](./engine-backup-restore.md) preserves occurrence identities and cursors and pauses active schedules on restoration. Formal upgrade/downgrade and retention qualification remain separate milestones.

```sh
npm run test:engine:m6-recurring
npm run example:engine:recurring
npm run engine:typecheck
npm run test:engine
```

The example uses an explicitly labeled human-approval fixture and a manual clock. It demonstrates all three policies and duplicate suppression without executing external work.

Tests cover the CT-09 vectors, due-time equality, bounded replay across reopen, a year-long millisecond backlog, pause/resume/revision controls, invalid approvals, epoch fencing, storage rollback, competing database connections, four actual process-kill boundaries, coordinator startup recovery and clock holds. These establish the tested transition guarantees; they are not power-loss, sustained-load or months-long production reliability measurements.
