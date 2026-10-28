# Praxis SQLite persistence and recovery tests

> **Praxis naming:** This page documents **Praxis**, the AIWS workflow engine. Existing `engine/*` source paths, `/engine/...` routes, `aiws-engine/*` protocol identifiers, and existing script names remain unchanged for compatibility.

The TypeScript engine source is in `engine/`. SQLite persistence, scheduling, dispatch, worker execution, validation and human-control primitives exist, and the [composed coding workflow](./engine-coding-workflow.md) executes a local approval-to-acceptance sequence. [BUILD-PLAN](https://github.com/seanrobertwright/AI-WS-SDK/blob/main/BUILD-PLAN.md) records M5 status. These engine APIs are separate from the released TypeScript, Python and Rust SDK packages.

## Run the persistence slice

Use Node.js 24 and a local, durable filesystem. From the repository root:

```sh
npm run test:engine:persistence
npm run test:engine
npm run engine:typecheck
node engine/examples/persistence.ts
```

The example creates a temporary installation, commits a work-order record with an event and queue intent, reopens the database and retries the same request. Its assertions require one committed event and one intent. It removes its temporary database afterward. It does not execute a tool or demonstrate authentication.

## Storage API and transaction boundary

| API | Behavior |
|---|---|
| `new SqliteEngineStore(filename, busyTimeoutMs?)` | Inspect schema compatibility, configure WAL/FULL/foreign keys and initialize transactionally |
| `apply(command)` | Commit aggregate mutations, events, queue/timer intents and the command response in one write transaction |
| `getAggregate(kind, id)` | Inspect one aggregate and its revision |
| `snapshot()` | Read the base store's tables from one committed database snapshot |
| `acquireEpoch(expectedPrevious?)` | Advance the durable ownership epoch with an optional compare-and-swap check |
| `close()` | Close this connection; committed records remain available on reopen |

The bounded storage executor exposes `runtimeApply`, `runtimeGetAggregate` and `runtimeSnapshot` for coordinator use. Production coordinator writes use the storage worker so SQLite work does not block the control event loop. Direct store calls are useful for tests and administrative embedding.

`EngineCommand` contains a host-established `principalId`, `requestId`, canonical `commandDigest`, expected aggregate revisions, mutations and a response. Optional events, queue intents and timers join the same transaction. The host must bind the digest to the complete command material. A repeated principal/request with the same digest returns the saved response; different material raises `COMMAND_ID_REUSE`.

Coordinator writes also supply `expectedEpoch`. The store checks this epoch **inside** `BEGIN IMMEDIATE`, before replay or mutation, so a superseded coordinator cannot write through a previous pre-check. This internal persistence API does not itself authenticate a human or authorize dispatch. Omitting the epoch is reserved for existing trusted storage-only callers; the coordinator always supplies it.

A queue intent is durable responsibility to do later work. Its presence alone does not authorize an external effect. Dispatch requires the separate approval, policy, budget and worker checks.

`snapshot()` covers the base store tables only. It is a consistent inspection result, not a backup manifest, an authenticated audit export, or a single snapshot of all engine subsystem tables. Native `ApplyResult.revisions` on a replay still describes currently observed revisions; full historical wire receipts remain a later integration obligation.

## Database compatibility and initialization

Every engine repository uses the same opener. It inspects metadata before persistent pragmas or schema writes. Supported installations retain schema version `1`, their installation ID and epoch. A fresh installation creates metadata and component tables in one transaction. A failed initializer rolls back both and closes its connection.

| Error | Meaning and action |
|---|---|
| `UNSUPPORTED_SCHEMA` | Version is not exactly `1`; use compatible software or a separately approved migration |
| `UNSUPPORTED_DATABASE` | Existing tables do not identify an engine installation; do not treat an SDK mission database as an engine database |
| `STORE_CORRUPT` | Required installation identity or epoch metadata is missing/invalid; stop and investigate |
| `SQLITE_PREFLIGHT_FAILED` | Required durability settings were not retained; do not start execution |
| `EPOCH_CONFLICT` | Coordinator ownership changed; the stale caller must stop writing |
| `EPOCH_EXHAUSTED` | The base store cannot increment the epoch exactly within its supported integer range |

Version `1` storage layout is unchanged. There is no executable legacy import, automatic schema upgrade or metadata repair. Older experimental component-only databases lacking installation metadata are rejected rather than assigned a new identity. Supported complete version `1` installations reopen without rewriting their logical records.

The opener verifies WAL, `synchronous=FULL`, foreign keys and bounded busy timeout. On macOS it also requests and reads back full-sync/checkpoint full-sync settings. Those settings do not constitute macOS qualification or proof of power-loss durability.

## What the harness proves

The persistence command test changes a work-order aggregate and a ledger aggregate together, with one event, intent, timer and response. Expected balances and counts are asserted independently of the storage implementation. The ledger values in this test are storage payloads; this test alone does not establish M3 accounting semantics.

`engine/test/sqlite-recovery.test.ts` adds 22 tests to the existing 50 engine tests:

- Unsupported schema rejection through all six repository constructors, including a before/after database-byte comparison.
- Rejection of legacy and incomplete metadata, initializer rollback, and preservation of existing installation records.
- Snapshot consistency while a second connection commits and stale-epoch rejection without partial writes.
- Exact-integer fencing boundaries.
- Nine real child-process terminations: during initialization, after transaction begin, after aggregate/event/queue/timer/result writes, before commit, and after commit before reply.
- Two independent connections released from a shared start barrier, with exactly one complete winner at a shared revision.

For each process termination the parent must observe the requested barrier and confirm termination. Reopening must show either no command writes or the complete committed result. After a post-commit lost reply, retry must return the saved response without duplicate records. SQLite integrity is checked on the actual reopened file.

The synchronous barrier hook is an internal constructor test seam, never a serialized worker/public command. Production callers leave it unset.

## Evidence and remaining work

The local Node 24 Linux run passes **72 engine tests**, including **29 persistence tests** (seven original plus 22 new). Nine cases terminate an actual process. These are process-crash tests, not simulated power loss or certification for Windows/macOS, PostgreSQL, months-long operation, every dispatch fault boundary, or the complete M4 conformance catalog.

The next source slice now provides a [composed coding workflow](./engine-coding-workflow.md) with real validation, bounded correction and restart tests. The counts above record the earlier persistence increment. CLI/web integration, exact public wire handlers, full historical receipts and remaining recovery/conformance obligations stay open.
