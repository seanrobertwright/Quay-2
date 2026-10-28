# Persistent clock tracking and trust recovery

> **Praxis naming:** This page documents **Praxis**, the AIWS workflow engine. Existing `engine/*` source paths, `/engine/...` routes, `aiws-engine/*` protocol identifiers, and existing script names remain unchanged for compatibility.

M6 clock recovery is implemented for the local Node.js 24 + SQLite engine source. The coordinator persists time observations, detects unsafe changes, and blocks new dispatch until a trusted host verifies recovery. This completes the first remaining slice after bounded scheduler recovery (not in this pack); M6 as a whole remains in progress.

## What the engine records

`ClockReading` contains `wallTime`, `monotonicMs`, `bootId` and `trusted`. `ClockState` adds a revision, coordinator epoch, `highWaterTime`, uncertainty reason and the configured drift tolerance. The high-water time never decreases. This implementation uses one installation-wide high-water mark: it conservatively applies to all accounting scopes, rather than allowing each scope to move time backward independently.

The latest observation is stored under `engine_meta.clock_v1`. Clock transitions and consumed restoration evidence are recorded in `clock_events` in the same SQLite transaction. Normal samples update the latest state without appending an event each time. Restart does not discard a hold or lower the stored time.

`SystemClock.read()` uses UTC wall time and `process.hrtime.bigint()` for monotonic milliseconds. All system-clock instances in one coordinator process share a boot identity. A new process receives a new identity, conservatively treating process restart as a boot boundary. A new coordinator epoch may accept a trusted UTC reading at or above the previous high-water mark without comparing monotonic counters across boots. A boot change within one epoch holds dispatch.

The default adapter treats the host OS clock as trusted under the local deployment profile. It does not verify NTP, authenticate a time server, or prove that the machine clock is correct. Hosts with different assurance requirements must supply an `EngineClock.read()` adapter and mark unverified readings `trusted: false`. A legacy adapter implementing only `now()` produces an untrusted reading and cannot authorize new dispatch.

## Anomaly behavior

| Observation | Durable behavior |
|---|---|
| Wall time moves backward, even 1 ms | Retain the high-water value and hold new dispatch |
| Wall/monotonic deltas differ by more than 1,000 ms | Advance the high-water value when necessary and hold dispatch |
| Difference equals 1,000 ms | No discrepancy hold; real deadline expiry still applies |
| Monotonic counter moves backward in one boot | Hold dispatch |
| Untrusted reading | Hold dispatch |
| New epoch and trusted UTC at/above high-water | Rebase the monotonic origin; preserve any existing uncertainty hold |
| Ordinary readings after an anomaly | Keep the hold until verified restoration |

Configure the initial threshold with `EngineCoordinator` option `clockDriftToleranceMs` (default 1,000). The selected value is persisted. A different value on a later observation is rejected; changing an installation's clock policy requires reviewed offline maintenance. It is not an agent-controlled way to dismiss an anomaly.

One-time wake-ups and abandoned pre-dispatch claims can still become due at the conservative high-water time during an anomaly. The coordinator does not issue new task claims while held. Final dispatch authorization, delivery claiming and delivery acknowledgement independently check the persisted clock state and current epoch. Thus an already-prepared request cannot bypass a hold introduced before its durable execution boundary.

Existing effects may still finish and report evidence. A clock hold does not prove they stopped, cancel them, settle an uncertain result, or refund exposure. Returning an existing dispatch receipt is not permission to deliver it through a clock hold.

## Accounting and control deadlines

Unfinished `DISPATCH_AUTHORIZED` and `UNKNOWN` attempts retain their original reservations. When admitting more work, each ancestor counts any additional elapsed exposure above an unfinished attempt's reserved maximum, using the conservative high-water time. Concurrent attempts are added separately; overlapping time is not counted as a single shared interval. Confirmed terminal outcomes follow the existing settlement/stop contracts.

Elapsed scope limits continue through waits, pauses and downtime. Approval, credential-admission and control-session/challenge checks cannot use a rollback to regain lifetime. The coding runner uses coordinator time; final control transactions also clamp host time to the persisted high-water value.

Clock restoration changes only clock state. It does not change limits, attempts, scope start times, approvals, manual holds or `UNKNOWN` outcomes. A large erroneous forward reading can therefore leave an installation conservatively held or its deadlines exhausted. Restoration cannot lower charged time to make work fit again.

## Inspect and restore trust

```typescript
const state = await coordinator.observeClock();
console.log(state.highWaterTime, state.uncertain, state.reason);
const transitions = await storage.clockEvents();
```

Existing control inspection includes the clock's uncertainty flag and reason, and projects affected work orders as suspended. It does not grant permission to clear the hold.

`coordinator.restoreClockTrust(credential, expectedRevision, adapter)` is the trusted-host recovery entry point. The adapter's `verify` method receives the credential and `{ epoch, revision, reading }`. It must authenticate an authorized human operator or trusted time provider and verify the reading independently. It returns `VerifiedTimeEvidence`, or `null` to deny:

| Evidence field | Requirement |
|---|---|
| `principalId` | Verified operator/provider identity |
| `kind` | `HUMAN` or `TIME_PROVIDER`; agents are not accepted |
| `evidenceRef` | Unique durable reference to the verification evidence |
| `wallTime` | Exact wall reading supplied in the verification context |
| `validUntil` | Evidence expiry, strictly later than the checked wall time |

The engine rejects stale revisions/epochs, expired evidence, reused evidence references, a lower high-water value, changed boot identity and unsafe clock changes while the verifier is running. State and verification evidence commit together. Read the state again after a lost response: a committed restoration cannot consume the same evidence twice.

The storage-level `clockRestore` API accepts already-verified evidence for trusted host composition. Never map an HTTP body, worker output or arbitrary JSON directly into it. Authentication and time-source verification are responsibilities of the injected host adapter, as with existing identity adapters. This slice does not add a public HTTP, CLI or browser command for restoration or a bundled external time provider.

## Compatibility and operation

No released SDK package API changes are implied. These are TypeScript engine source APIs; the released TypeScript, Rust and Python SDK packages do not include them.

Clock metadata and its component audit table initialize transactionally within the existing engine schema-1 installation. A fresh installation has no historical clock evidence before its first observation. Existing data is not rewritten. A current coordinator must observe time before dispatch; the observation is epoch-bound.

Keep every component on this updated source revision. Older engine source does not enforce the new clock metadata, so downgrading would bypass these protections and is unsupported. Formal upgrade/downgrade qualification remains part of release readiness. [Backup and restore](./engine-backup-restore.md) now preserve the clock state and audit table with the complete installation. Restored clock state is held for fresh trust verification.

## Verification and remaining limits

```sh
npm run test:engine:m6-clock
npm run engine:typecheck
npm run test:engine
```

The focused tests cover rollback, forward drift and threshold equality, monotonic rollback, trusted/untrusted boot transitions, sticky holds, evidence rejection/replay, storage failure, process termination around clock commits, final-admission races, delivery holds, parallel unfinished exposure and elapsed deadlines.

`ManualClock.advance(ms)` advances wall and monotonic clocks together. `set(iso)` changes wall time only; `reboot(iso, trusted)` changes boot identity and resets monotonic time. Negative advancement is rejected; use `set` to test rollback. These are test tools, not remote worker commands.

Fake-clock and process-kill tests validate state transitions, not physical power-loss tolerance or months of production reliability. Real sleep/wake and OS clock qualification remain in the platform slice. [Recurring schedule catch-up](./engine-recurring-schedules.md) is implemented in the following slice. [Local backup/restore](./engine-backup-restore.md) is implemented in slice 3; history retention and capacity measurements remain open M6 work.
