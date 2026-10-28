# Praxis backups and same-machine restore

> **Praxis naming:** This page documents **Praxis**, the AIWS workflow engine. Existing `engine/*` source paths, `/engine/...` routes, `aiws-engine/*` protocol identifiers, and existing script names remain unchanged for compatibility.

M6 slice 3 adds **local administrative backup and restore APIs** to the Node 24 + SQLite engine source. A backup contains a consistent SQLite checkpoint, immutable artifacts and a versioned manifest. Restore publishes a separate installation directory with execution held until verified reconciliation permits startup.

This builds on [clock recovery](./engine-clock-recovery.md) and [recurring schedules](./engine-recurring-schedules.md). It does not change the released TypeScript, Python or Rust SDK packages. [Lossless history compaction](./engine-history-compaction.md) is implemented in slice 4. Cross-machine failover, database migrations and automatic deletion remain outside this slice.

An interactive [engine backup and restore](./diagrams.md#engine-backup-and-restore) diagram shows checkpoint, sealed manifest, publication, verified restore and human activation.

## What is preserved

| Material | Backup and restore behavior |
|---|---|
| Database | SQLite `VACUUM INTO` captures a consistent checkpoint including committed WAL contents; copying only a live `.sqlite` file is unsupported |
| History and state | Ordered audit prefix seal, full table projection seal, database size/digest, SQLite integrity and foreign-key checks |
| Accounting | Attempts, reservations, consumed resources and unresolved outcomes remain intact |
| Idempotency | Command receipts, occurrence identities and scheduler cursors remain intact |
| Artifacts | Complete content-addressed root copied; inventory records every digest and size; known workflow, handoff and execution-evidence references must exist |
| Credentials | External credentials stay disconnected; host reviews source content before staging and completed content before publication |
| Restored authority | Fresh ownership/auth epoch from an external protected allocator; old dispatch approvals revoked and policies made indeterminate |
| Future work | Active recurring schedules and running work-order controls paused; installation-wide hold blocks coordinator startup and final dispatch |
| Time | Restored high-water time is at least the snapshot, verified live high-water and current local time; existing clock state becomes uncertain |

The engine's current audit events are not a complete reducer for every operational table. The backup therefore seals the complete database projection as well as the audit prefix. It does **not** claim event-only reconstruction or automatic repair of inconsistent state.

## Host responsibilities

The APIs run in a local administrative process. There is no new public HTTP, worker, CLI or browser command. `RecoveryAdapter` is a trusted host boundary, comparable to the existing authentication and human-approval adapters. A raw user-submitted proof is not a verified adapter result.

Before calling the APIs, the host must:

1. Authenticate an authorized human and acquire exclusive installation maintenance ownership. Stop the host loop, quiesce workers and fence every old process. Keep that maintenance ownership through the operation and cutover. Closing a connection alone does not prove external work stopped.
2. Use protected, operator-owned directories outside worker workspaces. Paths with symlinks are rejected; protection against concurrent directory replacement still depends on host ownership. Existing destinations are rejected.
3. Establish the installation and machine identity through an external protected identity source. A caller-supplied machine name alone is insufficient.
4. Review database payloads, task output and all artifacts for secrets before backup staging. The engine cannot reliably identify arbitrary secrets in application content and does not silently redact state. Resolve sensitive content under an approved process or do not create the backup. Encryption/key management, if required, belongs to the OS/organization provider outside this bundle.
5. Maintain a durable ownership/auth-epoch high-water mark outside the files being restored. `reserveEpoch` must atomically reserve above **all** live/restored/previously reserved epochs, persist before returning and fence old owners. Failed restores consume their reservation. If the high-water is unavailable, fail and use owner recovery; never guess zero or use the old snapshot alone.
6. Retain the live clock high-water independently and provide it in verified restore evidence. Protect external provider/audit evidence for the interval the backup may omit.

The adapter's `verify(context)` receives the exact material digest, operation, installation, machine, destination and `inspectionPath`. For backup it is called twice: first for source review/maintenance, then for the completed staged snapshot. It returns fresh human evidence bound to that material. The host keeps maintenance ownership across both calls. A source projection change between review and copying rejects the backup.

## Create and verify a backup

```ts
  createBackup,
  inspectBackup,
} from './engine/src/backup-restore.ts';

// recoveryAdapter is your authenticated maintenance/content-review adapter.
const manifest = await createBackup({
  database: '/srv/aiws/engine.sqlite',
  artifacts: '/srv/aiws/artifacts',
  destination: '/srv/aiws-backups/2026-09-10',
  namespace: 'development',
  machineId: protectedMachineIdentity,
  adapter: recoveryAdapter,
});

const verified = inspectBackup('/srv/aiws-backups/2026-09-10');
console.log(manifest.eventPosition, verified.manifestDigest);
```

The destination's parent must already exist. The final directory contains `engine.sqlite`, `artifacts/`, `inventory.json`, `configuration.json` and `manifest.json`. Configuration contains only the machine identity, source epoch, projection digest and clock high-water. No external credential store is copied.

The manifest implements the existing `SnapshotManifest` wire schema: `aiws-engine-snapshot/1`, engine/projection version 1 and codec 1.1.0. Its database, inventory and configuration descriptors bind exact bytes. Empty audit history uses position zero and the 64-zero event digest. Staging manifests with `completed=false` are rejected.

Files are written and flushed in a private staging directory; directory publication is an atomic rename followed by parent-directory flush on the qualified Linux host. A failure before publication leaves no final backup. A failure after publication may report an error despite a complete result: inspect the destination before retrying. A process kill can leave a `.recovery-*` staging directory; it is not a published backup. Remove abandoned staging only after verifying the owning administrative process has stopped and a valid published copy exists where required.

`inspectBackup` verifies integrity, not authenticity. A matching digest does not make an uploaded bundle trusted. Restore still requires the configured host's trusted-backup provenance verification.

## Restore into a new directory

```ts
  restoreBackup,
  inspectRestore,
} from './engine/src/backup-restore.ts';

const result = await restoreBackup({
  backup: '/srv/aiws-backups/2026-09-10',
  destination: '/srv/aiws-recovery/restored-2026-09-10',
  installationId: existingInstallationId,
  machineId: protectedMachineIdentity,
  adapter: recoveryAdapter,
});

console.log(result.database, inspectRestore(result.database).status); // HELD
```

All material is copied and verified again after host approval. The epoch is reserved before changing restored state. SQLite then commits the installation-wide hold, authority rotation, conservative clock and work pauses with recovery audit evidence. Publication occurs only after that transaction commits.

The original database and backup remain intact. The transformed database is not falsely labeled with its source digest: the restored directory uses `restore-source.json` for provenance, and removes the source `manifest.json`. Use `inspectRestore` for this directory. Create a new backup to produce a new completed manifest.

The restored hold survives process restart. Backing up and restoring an already-held installation retains the earliest uncertain interval and prior recovery evidence. Normal workflow resume, clock restoration or coordinator startup cannot clear it. Old worker delivery is independently fenced. Even after the hold is verified, workflows/schedules stay paused and dispatch requires fresh current policy and approvals. Existing clock uncertainty requires the separate [clock-trust procedure](./engine-clock-recovery.md).

## Reconcile before startup

A daily backup can omit real effects, spending, attempts, permission revocations and deduplication records. Restoring old bytes cannot undo any of them.

```ts

await activateRestore(result.database, recoveryAdapter);
```

This requires fresh human evidence bound to the current restored projection. The adapter must affirm both `noUnrecordedEffects` and `accountingAndAuthorityComplete`, supported by provider evidence and retained audit/dispatch records covering the omitted interval. It is not a checkbox that lets a human waive unknown exposure. All restored `DISPATCH_AUTHORIZED`, `UNKNOWN` and unsettled `STOPPED` attempts independently block activation.

The API rechecks the state under the writer lock and rechecks artifact bytes after verification. Changed state, expired proof or missing artifacts leaves the hold intact. Successful verification is recorded durably and allows a new coordinator epoch; it does not start workers or reconnect credentials.

If omitted effects or accounting/authority gaps exist, **keep the hold and recover forward using complete trusted records**. This slice does not implement an arbitrary missing-history importer, provider reconciliation engine or event-only fallback. When necessary evidence is unavailable, there is no supported activation shortcut. Reconcile known attempts through their existing evidence/settlement contracts under trusted maintenance, preserving all consumption.

Only after successful verification should the operator switch the stopped host to the new database/artifact directory, refresh identity and provider credentials, restore clock trust, review current policies and explicitly resume approved work. Retain the old files as recovery evidence; never run old and restored installations simultaneously.

## Schedule, retention and restore drills

The accepted default remains **daily backups retained for 30 days**. The host schedules the administrative backup job; this API does not silently install an OS job or start a background maintenance service. Use unique date/run destinations and monitor backup failures and the age of the last verified backup.

At each restore drill, use a fresh isolated directory with credentials disconnected. Verify the manifest and inventory, exercise the held restore, confirm preserved accounting/identities, and record the evidence. A drill with real active work must not release its hold merely to test startup; use a separate no-effect fixture for that check.

Automatic pruning is deliberately absent. Active/unresolved references and recovery dependencies override age. [Lossless history packing](./engine-history-compaction.md) is available in slice 4; destructive retention coordination remains slice 6. No database or artifact deletion should be enabled before restoration has been verified.

## Run the verification

```bash
npm run engine:typecheck
npm run test:engine:m6-backup
npm run test:engine
npm run example:engine:backup
```

The example uses a clearly labeled offline fixture with no external effects. Its in-memory epoch allocator is **not** a production `RecoveryAdapter`.

Tests cover committed WAL data, audit/projection seals, corrupt/missing artifacts, invalid manifests/schema/identity, stale verification, epoch/clock refusal, installation holds, preserved UNKNOWN/accounting, recurring identities, authority revocation, six actual process-kill boundaries and artifact loss during activation approval.

The verified execution profile is Node 24 on local Linux storage. Directory durability on Windows/macOS, device power loss, platform volume behavior and capacity/long-duration results remain slices 8–9. JSON inventory/metadata parsing is bounded to 20 MiB; database verification iterates rows, but individual SQLite rows and artifact files are read in memory. These are stated implementation limits, not benchmarked capacity claims.
