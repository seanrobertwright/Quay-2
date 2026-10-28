# History compaction and continuation

> **Praxis naming:** This page documents **Praxis**, the AIWS workflow engine. Existing `engine/*` source paths, `/engine/...` routes, `aiws-engine/*` protocol identifiers, and existing script names remain unchanged for compatibility.

M6 slice 4 adds **lossless audit-history packing** to the local Node 24 + SQLite engine. It replaces a bounded prefix of ordinary audit rows with verified compressed segments in the **same database**. All event bytes remain available through the engine's history reader and in [backups](./engine-backup-restore.md).

Existing runs continue from their existing materialized state. Packing does not create a new run, reset a budget, change an attempt, release a hold or alter an approval. This is storage continuation for the same history, not a new workflow-version or cross-machine continuation protocol.

## Preserved invariants

| Material | Behavior |
|---|---|
| Audit events | Exact original row values, IDs, ordering, payload JSON and timestamps reconstruct from segments plus the ordinary tail |
| Current state | Aggregate identities/revisions, run IDs, accounting, reservations, UNKNOWN outcomes and approval state are untouched |
| Request idempotency | Original command receipts remain; retries return their original results |
| Event idempotency | Archived event IDs and sequence numbers retain permanent unique identity records; an insert cannot reuse them |
| Timers and recurrence | Wake-ups, occurrence identities, cursors and schedule revisions are untouched |
| Backup and restore | Full segments and identities are part of the SQLite snapshot; verification reads the complete logical audit prefix |
| Restart | Before allocating a new ownership epoch, the engine verifies packed history and its ordinary tail; corrupt/missing history blocks startup |

No event or artifact is discarded. The 90-day hot-history, one-year closed-history and indefinite live/unresolved-reference retention rules remain unchanged. Packing is transparent local storage compression; it does not move history to an unavailable archive or authorize age-based deletion. Automatic pruning belongs to later retention work.

## Bounded segments and atomic replacement

A plan selects the **oldest unpacked contiguous prefix**. Defaults are 500 events and 1 MiB of uncompressed canonical row data per transaction. Supported settings are 1–10,000 events and 2 bytes–4 MiB. Both caps apply; a row is never split.

If the first row exceeds the byte cap, planning fails with `HISTORY_ROW_TOO_LARGE`, and nothing is packed. Increase the cap within the supported limit or leave that prefix unpacked. Later smaller rows cannot bypass an oversized first row. SQL checks text sizes before fetching the complete row; canonical encoding is then checked against the exact byte limit.

Each transaction:

1. Checks the current epoch, installation restore hold, exact plan and fresh material-bound human approval.
2. Compresses the selected rows and verifies exact reconstruction, row digest and ordered prefix digest.
3. Inserts the segment and its durable approval evidence.
4. Inserts the event identity records, then removes the replaced ordinary rows.
5. Commits all changes together.

A process failure before commit retains the original rows. After commit, the segment and identities contain the complete history. A retry of the exact committed plan returns `replayed: true`; a conflicting plan for that range fails. New events appended during human verification do not invalidate an unchanged approved prefix. A changed prefix or stale epoch does.

Segments use zlib/deflate, stored as base64 text with compressed and uncompressed digests, declared byte sizes, sequence endpoints and linked prefix digests. Decompression is capped at the declared size and never above 4 MiB. Segment and identity updates/deletions are blocked by database triggers.

## Use the trusted host entry point

```ts
const packed = await coordinator.compactHistory(
  operatorCredential,
  historyApprovalAdapter,
  { maxEvents: 500, maxBytes: 1024 * 1024 },
);

if (packed) {
  console.log(packed.fromSequence, packed.throughSequence, packed.replayed);
}
```

`historyApprovalAdapter.verify(credential, context)` authenticates an authorized human and approves the exact `context.plan` and `context.subjectDigest`. It returns `HistoryApproval`, or `null` to deny:

```ts
{
  kind: 'HUMAN',
  principalId: authenticatedHumanId,
  evidenceRef: durableApprovalReference,
  materialDigest: context.subjectDigest,
  expiresAtMs: verifiedExpiry,
}
```

The host supplies the credential, identity verifier and durable evidence. Worker output or an HTTP body is not already-verified approval. The plan given to the adapter is a copy; mutation cannot change the plan submitted to storage. The original epoch stays bound while verification is pending. Expiry is checked inside the storage transaction against local time and persisted conservative clock high-water.

Work runs on the existing bounded storage worker. Each call packs at most one segment. There is no newly exposed HTTP/CLI/browser endpoint, automatic packing loop or implicit background retention policy. The host chooses when to request further plans and approvals.

## Inspect and continue

```ts
const status = await storage.historyInspect();
console.log(status.segments, status.archivedEvents, status.hotEvents);

// Existing SqliteEngineStore.snapshot() reconstructs the complete logical history.
const snapshot = engineStore.snapshot();
```

`historyInspect()` verifies the complete retained chain and reports the last sequence and prefix digest. `historyPlan(epoch, bounds)` and `historyCompact(plan, verifiedApproval)` are the lower-level trusted storage APIs. `HistoryRepository` provides equivalent synchronous methods for a local administrative process; keep that synchronous work off a live HTTP/coordinator event loop.

`SqliteEngineStore.snapshot()` keeps its existing shape. The raw `audit_events` SQL table now represents only unpacked rows. Direct queries against that table are not full-history inspection; use the engine reader. Control inspection uses a logical head lookup that includes a fully packed tail.

The existing materialized run state is the continuation checkpoint. A new event receives the next installation sequence even after all previous rows have been packed. Restart preserves run identity and accounting. Packing does not itself authorize a paused run to resume, change a graph or convert a terminal run into a new assignment.

## Backup, compatibility and operating limits

Take and verify a normal backup before introducing this format to an installation. Slice 3 backup/restore now reconstructs the packed prefix when validating event position/digest, and retains every segment and identity record in its database snapshot. Restore still enforces all existing fencing, clock and reconciliation holds.

History tables initialize transactionally under `history_format=1` within engine schema 1. Unknown history formats and missing versioned tables are rejected before normal writers mutate the database. Use matching updated engine source for every component; older engine code does not understand packed history, and downgrade is unsupported. No SDK package release or database migration edge is introduced.

Packing makes ordinary audit tables smaller and allows SQLite to reuse freed pages. It does not promise that the allocated database file immediately shrinks: no automatic `VACUUM` or filesystem truncation runs. Compression benefit depends on event contents, and identity records add overhead. Total retained history still grows.

Full inspection, snapshot output and startup integrity validation still scale with total retained history. Segments bound decoding and individual packing transactions, but `snapshot()` still assembles its complete result in memory. This slice does not claim bounded total replay cost, a complete event reducer or a capacity benchmark. [Slice 5](./engine-replay-limits.md) adds indexed pages, bounded startup-verification steps and record streaming. Total work remains proportional to retained history; retention/telemetry, platform and long-duration qualification remain later slices.

## Verification

```bash
npm run engine:typecheck
npm run test:engine:m6-history
npm run test:engine
npm run example:engine:history
```

The example packs twenty events into four segments and verifies exact reconstructed history and unchanged run/budget values. Its human evidence is a labeled offline fixture.

Focused tests cover whole-row bounds, exact reconstruction, appended tails, duplicate events/requests, stale approval, conservative expiry, empty history, five actual process-kill boundaries, two competing processes, immutable segments, corrupt/missing formats, coordinator restart and backup/restore continuation. Process-kill tests do not establish device power-loss durability; platform and storage-volume qualification remain separate work.
