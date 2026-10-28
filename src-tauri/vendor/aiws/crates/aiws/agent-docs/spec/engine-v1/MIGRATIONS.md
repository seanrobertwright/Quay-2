# Version, migration and restore rules — engine v1

Status: finalized M4 specification baseline, 2026-09-09. This defines behavior to build;
it does not ship a migration executable or database implementation.

## Independent version axes

| Axis | Initial value | Compatibility rule |
|---|---|---|
| Public/worker/adapter protocol | aiws-engine/1, schema 1.1.0 | Exact negotiated codec; reject unsupported semantics before mutation |
| Engine database schema | Decimal string 1 | Read metadata before writes; only explicit registered migration edges |
| Snapshot manifest | aiws-engine-snapshot/1 | Exact supported format, complete integrity and state checks |
| Projection version | Decimal string 1 | Snapshot projection must match reducer; rebuild only from complete verified history |
| Existing SDK profiles | finite-v1, handoff-v1, limits-v1 | Preserve each source version and original bytes; archive-only initial engine import |

Package semver does not identify database format. Persist schema version, migration ID,
installation identity, auth epoch and event-prefix position in engine metadata. A fresh
database is initialized transactionally as version 1. There is no implied version-0
upgrade, down migration, cross-database atomicity or automatic alias reinterpretation.
Never run a newer schema with an older writer. Unknown versions enter read-only diagnostic
mode or fail without writing; generic SQLite tooling is not a supported writable fallback.

## Existing SDK data

Initial engine v1 supports **read-only legacy archives only**, not execution resumption
from finite-v1/handoff-v1/limits-v1 stores. Existing SDK profiles remain usable with their
matching SDK implementation. Distinct mission/handoff/ledger databases do not become an
atomic engine store by being copied together.

An explicit legacy archive operation validates source profile/schema/hash chain and
captures original files, graph/contract revisions, namespace/mission/run identities,
all known accounting/evidence, source hashes and provenance in an immutable inventory.
Preserve `missionId` bytes; an external projection may label it workOrderId but cannot
rewrite or rehash original records. Missing data is reported as unavailable; invent no
parent links, accepted deliveries, closure evidence or zero costs. Archive IDs remain
qualified by source profile/namespace to prevent collisions with executable engine IDs.

Reject an executable import or migration-continuation request. Archive ingestion of
active legacy data is permitted only as a clearly timestamped forensic copy, never as
a resumable engine run or authoritative claim that legacy effects stopped. A historical
closed-work projection requires all mandatory legacy closure/accounting checks and no
unresolved dispatch/reservation/handoff dependency. An archive cannot issue credentials,
spend, approve, resume, release a reservation or clear UNKNOWN.

The same assignment must not be recreated with a fresh budget to evade cumulative
limits. Completing legacy work remains in its original runtime. A genuinely new assignment
requires explicit human authorization and independent budget/identity; linking an archive
is evidence, not a continuation migration. Executable legacy conversion needs a future
versioned migration profile with demonstrated identity/accounting equivalence.

## Engine upgrade protocol

1. Inspect source/target versions, platform prerequisites, storage backend and registered
   migration path. Produce a MigrationPlan with source digest, backup descriptor, expected
   auth epoch and exact human approval reference. No unreviewed arbitrary script is
   obtained from a migration manifest. Migration tooling is local administrative tooling,
   not a public worker/API operation.
2. Stop new admissions and enter maintenance mode under an exclusive writer lock.
   Quiesce workers and settle all outstanding effects. An unresolved attempt blocks a
   schema upgrade unless that exact migration edge has conformance evidence preserving
   its full UNKNOWN/reservation/reconciliation state; no such exception exists initially.
   Fence old processes and retain elapsed deadlines. Closing a pipe is not quiescence.
3. Create and verify a consistent backup plus artifact inventory and nonsecret config.
   Test restoration into an isolated no-dispatch staging directory before proceeding.
   Record PREPARED with migration ID/source/target/backup/material digest durably.
4. Apply the registered schema/data transform atomically with target metadata and an
   APPLIED record. Preserve event/identity/ledger meaning. SQLite uses one transaction
   in the engine database; PostgreSQL uses the same transactional guarantees. No split
   workflow/ledger migration, unordered dual writers or autocommit partial transformation.
5. Verify referential integrity, canonical accounting, event-prefix hash, projection
   equivalence, artifact/checkpoint availability, revision/epoch monotonicity, pending
   timer positions and idempotency records. Failed checks keep maintenance mode. Mark
   VERIFIED only when all succeed. A new binary cannot interpret APPLIED as ACTIVATED.
6. Activate the verified version under the exclusive lock, increment authority/boot
   fencing state, revoke old sessions/worker permits, record ACTIVATED and require human
   recovery/resume approval before dispatch. Release the lock to the new coordinator
   only. A previous process cannot continue from its cached database version.

Crash before APPLIED leaves the old schema intact; inspect PREPARED and either retry
the same migration ID or abort. Crash after APPLIED resumes verification, never reruns
the transform blindly. Crash after VERIFIED resumes activation idempotently. Failed
activation leaves dispatch disabled. Keep source and target binaries and migration
evidence until rollback eligibility has expired and retention permits removal.

Rollback before any post-upgrade external execution may restore the verified source
backup, with fresh auth/boot epochs and new recovery audit evidence. Once new effects
may exist, do not roll state/history/budgets backward. Recover forward or reconcile
explicitly; restoring old bytes cannot undo an external action. No automatic downgrade.
Changing SQLite to PostgreSQL is a separate offline migration edge, disabled until
both backends pass equivalent semantics plus copy/replay/restore tests. PostgreSQL
availability does not imply its adapter or migration is already supported.

## Snapshot and backup manifest

SnapshotManifest in wire.schema.json (not in this pack) identifies database bytes,
event position/hash, projection/schema versions, nonsecret configuration, authority
epoch and the complete immutable artifact inventory. All referenced bytes must exist
and match exact size/digest before `completed=true`; false is a staging manifest and
must never restore. Empty history uses eventPosition zero and a 64-zero event digest.
The database descriptor refers to a consistent engine-format checkpoint, not a generic
Record summary from a query. Its internal tables are an implementation detail constrained
by the versioned invariants; snapshots cannot substitute arbitrary JSON state.

Hash integrity is not authenticity. Restore accepts only a backup from the configured
trusted backup location/identity, verified by the local operator or a configured signing
adapter. A user-uploaded manifest with matching hashes is not automatically trusted.
Backup encryption uses an external OS/organization key provider; raw keys, session
credentials and task secrets are excluded. Recovery credentials are stored separately.

Restore checks the whole snapshot against a consistent event prefix and all material
references. Missing/corrupt/incompatible snapshot may fall back to a verified complete
event log and compatible reducer; if history or required bytes are incomplete, stop in
recovery hold. Never splice a newer snapshot into an older history or silently zero an
unavailable balance. Archived history must remain available for required replay.

Only same-installation, same-machine restore is initially supported, on a qualified host
class. Copying a backup to another machine is forensic export, not enabled failover.
Fencing epochs are allocated above both restored state and the live installation's
protected high-water mark; if that mark cannot be established, use owner recovery to
replace installation authority before any dispatch. Old permits must never revive.

Restore starts with dispatch disabled and external credentials disconnected. A daily
backup can omit up to a backup interval of real effects. Treat the interval after its
last trusted event as uncertain, including attempts absent from the restored database;
reconcile against provider evidence and retained audit/dispatch records. If evidence
cannot establish exposure, retain a human reconciliation hold rather than issue new
attempts under a guessed balance. Human resume cannot waive mandatory UNKNOWN resolution.

Retention remains ED-15: active/unresolved dependencies indefinitely; closed history
hot 90 days, archived through one year after closure; routine logs 30 days, failure logs
90 days; final artifacts follow history; temporary workspaces eligible seven days after
closure only after outputs are preserved; daily backups for 30 days. Live references,
idempotency safety tombstones and recovery dependencies override age. No destructive
cleanup until verified restoration; no deletion of still-needed history to make an
upgrade fit disk. Cleanup decisions are audited and checked again at deletion.

## Required failure fixtures

Implementation conformance must cover unsupported/future versions without writes,
altered source/backup digests, incomplete manifests, failed restore probes, crash at
every migration phase, duplicate migration invocation, stale writer epochs, artifact
loss, inconsistent event prefixes, retained UNKNOWN, rollback after possible effects,
archived replay dependencies, legacy ID collisions and attempted budget-reset imports.
Shape fixtures validate only the manifest/plan DTOs; they do not execute these flows.

The earlier 1.0.0 wire design remains frozen as historical schema/fixture files. The
current codec requires explicit schemaVersion 1.1.0. This pre-implementation design
amendment is not a database migration or a released-client compatibility claim;
engine database/snapshot format 1 remains the initial implementation target.
