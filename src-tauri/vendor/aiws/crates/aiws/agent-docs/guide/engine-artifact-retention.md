# Artifact retention and telemetry capacity

> **Praxis naming:** This page documents **Praxis**, the AIWS workflow engine. Existing `engine/*` source paths, `/engine/...` routes, `aiws-engine/*` protocol identifiers, and existing script names remain unchanged for compatibility.

M6 slice 6 adds `ArtifactRetention` and `TelemetryQueue` to the local Node 24 + SQLite source profile. The released native SDK packages are unchanged.

## Retain references before considering age

`ArtifactRetention` scans persisted state, retained audit history (including packed segments), and host-provided SHA-256 pins. It follows digest references through artifact contents using 64 KiB reads. References from active work, unresolved outcomes, parent/shared manifests, retained closed history and recovery metadata override age. Conservative digest matching can retain extra files.

Only unreferenced immutable digest files are eligible. A first observation starts a **7-day orphan grace period**; filesystem modification times do not establish age. Approved candidates enter **logical quarantine for 30 days**: bytes remain readable at their original path and remain included in ordinary backups. A separately approved purge rechecks references and verifies file digests before unlinking. References discovered again reset eligibility. Republished digests start a new grace period.

The accepted history defaults (90 days hot, archival through one year), routine logs (30 days), failure logs (90 days), temporary execution files (7 days after closure with outputs preserved), and daily backups (30 days) remain minimum retention responsibilities. This implementation deliberately retains referenced history/artifacts longer. It does not delete audit segments, workspaces, temporary execution files, application logs or backup directories, and introduces no timer that silently deletes them.

## Trusted maintenance contract

```ts
const retention = new ArtifactRetention(database, artifactRoot);
try {
  const result = retention.run(epoch, 'QUARANTINE', trustedHost, {
    maxArtifacts: 100,
  });
  // After quarantine ages, request a fresh review for action 'PURGE'.
} finally {
  retention.close();
}
```

The trusted host supplies `withMaintenance`, `pins`, and `approve`. Maintenance must fence every artifact publisher, reader, database writer and competing maintenance operation until the call returns, including after crash recovery. SQLite alone cannot fence filesystem publishers. This administrative API is not exposed as an agent control endpoint.

Approval must identify a human principal and evidence reference, bind `retentionMaterialDigest(plan)`, and remain unexpired. It must point to an actual same-installation restore database whose slice 3 reconciliation was activated as `VERIFIED`. The host verifies the operator identity and exclusive maintenance ownership; self-asserted agent data is not a substitute. Held restores and stale epochs reject cleanup.

Purge commits a `PREPARED` journal before touching bytes, fsyncs the containing directory after unlink, then commits `PURGED`. Interruption leaves a retryable responsibility record. A missing file is accepted only for a previously prepared purge; a new reference to a missing interrupted purge fails closed. Review and retry must occur under maintenance before publishers resume. Logical quarantine avoids an unbacked second artifact directory. Paths are installation-local; after restore into a different root, a new observation starts a fresh grace period.

A call handles at most 1,000 candidates (100 by default). Reference scanning is a full offline maintenance scan; total scan duration and directory/reference inventory memory are not bounded independently of installation size. Large artifact bytes are streamed. Broader capacity and filesystem/power-loss qualification remain slices 7–9.

## Best-effort telemetry with explicit pressure

The storage worker initializes a durable telemetry outbox. An audit insert transaction also attempts to enqueue only event identity, type, aggregate identity and timestamp. Authoritative event payloads and artifact bytes are excluded. Host identifiers must still follow the host's privacy policy. Queue overflow increments a persisted drop counter and allows the authoritative audit transaction to commit.

Default persisted limits are **1,000 records, 8 MiB, and 5 delivery attempts**. Trusted hosts may choose different limits when first initializing `TelemetryQueue`; conflicting reopen configuration rejects instead of silently expanding resource authority. Queue counters expose accepted, delivered, dropped, exhausted, live records and bytes. This bounds logical payload capacity, not SQLite file size, WAL growth or filesystem free space.

```ts
const batch = telemetry.claim(epoch, 'host-exporter', now, {
  maxRecords: 100, maxBytes: 1024 * 1024, leaseMs: 30_000,
});
for (const record of batch) {
  await approvedExporter.send(record.id, record.payload);
  telemetry.acknowledge(epoch, 'host-exporter', record.id,
    record.leaseToken, new Date().toISOString());
}
```

Transport, credentials and remote exporter approval remain host responsibilities; this API does not contact a collector. Delivery is at least once within the retry window and best effort overall. Stable record IDs support receiver deduplication. Acknowledgement requires the current epoch, owner and unexpired random lease token. Expired leases retry; exhausted records release capacity and increment `exhausted`. A new epoch can reclaim old leases. Restore holds prevent claiming or acknowledging delivery.

Custom `enqueue` is available to trusted hosts for sanitized JSON. Duplicate IDs are idempotent while queued; changed payloads reject. Delivered IDs have no permanent tombstones, so receivers must own long-term deduplication. A batch byte cap smaller than its oldest record rejects explicitly. Telemetry loss never authorizes deleting the authoritative audit history. Disk exhaustion itself can still prevent SQLite writes; reserved space and platform load qualification remain separate work.

## Verification

Run `npm run test:engine:m6-retention` for focused lifecycle, recovery, reference, approval, lease and capacity checks. See [backup/restore](./engine-backup-restore.md), [history compaction](./engine-history-compaction.md) and [bounded replay](./engine-replay-limits.md) for the prerequisites.
