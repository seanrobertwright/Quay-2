# Failure injection and recovery qualification

> **Praxis naming:** This page documents **Praxis**, the AIWS workflow engine. Existing `engine/*` source paths, `/engine/...` routes, `aiws-engine/*` protocol identifiers, and existing script names remain unchanged for compatibility.

M6 slice 7 qualifies the implemented local Node 24 + SQLite recovery paths with real process termination, deterministic transaction faults, storage capacity errors and independent writer contention. It extends the earlier clock, recurrence, backup, compaction and workflow tests. It does not certify power-loss durability or every scenario in the full standard catalog.

## Run and preserve evidence

```sh
npm run test:engine:m6-faults
npm run qualify:engine -- --output ./qualification-run-001
```

Use a new output directory for each qualification attempt. Existing directories are rejected; failed attempts are not overwritten by later successes. The runner executes engine typecheck and the entire engine test suite, writes their logs, and produces `report.json` with case names/results, runtime and filesystem identity, per-source SHA-256 fingerprints, log digests, timestamps, exit codes and explicit scope exclusions. Its exit status is nonzero if a check fails, times out, skips tests or produces incomplete/empty test accounting. Test-created databases and provider effects use disposable temporary directories.

The source digest binds the exact engine/test files, package scripts and qualification runner. Preserve the report and logs together with the source revision. The report is local implementation evidence; it is not the complete per-scenario certification report specified by the standard.

## Fault coverage

| Area | Injected fault | Required recovery result |
|---|---|---|
| Core persistence and scheduling | Process death around durable writes/commit; rollback exceptions | State, events, queue/timer intents and command results commit together or remain unchanged |
| Clock and recurrence | Process death before/after clock holds and occurrence/cursor commits | Conservative clock state and exactly-once occurrence identity |
| Backup and restoration | Death during staging, publication and restore epoch reservation | No incomplete published backup; restored installations remain held |
| History compaction | Death after segment, tombstone and deletion writes, and around commit | Complete identical logical history and durable identities |
| Telemetry | External kill before/after enqueue, claim and acknowledgement commits | Durable capacity counters; atomic leases; queued idempotency after lost replies |
| Artifact purge | External kill after prepared journal and after unlink | Prepared responsibility survives; retry finishes once without deleting referenced artifacts |
| Storage capacity | SQLite's real `SQLITE_FULL` using `max_page_count` | Whole transaction rolls back; original storage error survives; capacity restoration allows retry |
| Writer contention | Independent connection holds `BEGIN IMMEDIATE` | Real `SQLITE_BUSY`; no partial command; retry commits once |
| Coordinator | Process termination after execution evidence | Workflow resumes with no duplicate implementation effect |
| Worker | Process termination after a fsynced provider-effect marker | Durable `UNKNOWN` responsibility; no automatic redispatch |

The new external-kill harness waits for a named boundary emitted by the child before the parent terminates it. Early exit, missing boundary or watchdog expiry fails the test. Purge tests use real activated restore evidence in an isolated fixture and reopen the actual database after termination. The storage tests exercise SQLite itself, not a thrown imitation of its errors. `max_page_count` models database capacity exhaustion; it is not a full filesystem or an I/O fault.

## Runtime corrections

An execution terminated by a signal, or ending without an exit code, now produces `UNKNOWN`. An ordinary nonzero exit remains `FAILED`; successful exit remains `SUCCEEDED`. A killed process may have already caused effects, so treating its termination as a routine failure could incorrectly allow corrective execution. Durable worker evidence retains that uncertainty for reconciliation.

Telemetry and artifact-retention transactions now preserve the original exception if SQLite has already rolled back automatically or if a post-commit hook reports lost response. A second rollback must not replace `SQLITE_FULL` with a misleading “no transaction active” error.

## Qualification boundary

The recorded run passed **267 tests** plus typecheck on the local Linux environment. This includes 13 additional tests, with 18 tests in the focused faults/worker command. Artifact and telemetry hooks are trusted host/test instrumentation and are not agent controls.

Device power loss, filesystem ENOSPC/EIO, platform sleep/wake behavior, the Windows/macOS/Linux deployment matrix and sustained load remain separate qualification work. PostgreSQL, cross-machine recovery and unsupported migration/dynamic-workflow scenarios are not advertised by this result. The M4 conformance catalog remains a specification with separate execution obligations.

Next: deployment and platform qualification (slice 8), then capacity and long-duration qualification (slice 9). See [artifact retention](./engine-artifact-retention.md) and [backup/restore](./engine-backup-restore.md) for maintenance and reconciliation requirements.
