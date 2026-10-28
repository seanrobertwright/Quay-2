# Bounded history reads and parser limits

> **Praxis naming:** This page documents **Praxis**, the AIWS workflow engine. Existing `engine/*` source paths, `/engine/...` routes, `aiws-engine/*` protocol identifiers, and existing script names remain unchanged for compatibility.

M6 slice 5 adds **indexed history pages and resumable verification** to the local Node 24 + SQLite engine. It also separates control-message parser limits from stored-document limits and supplies an audit stream that can exceed 1 MiB without parsing the complete export as one JSON document.

This extends [lossless history compaction](./engine-history-compaction.md) and [backup/restore](./engine-backup-restore.md). It does not change the released native SDKs' finite-v1 audit bundle format or their 1 MiB strict-parser contract. The stream below is a separate engine inspection format, not an executable legacy import.

## Read a pinned history in bounded pages

```ts
let cursor = null;
do {
  const page = await storage.historyPage(cursor, {
    maxEvents: 500,
    maxBytes: 1024 * 1024,
  });
  await consumeInspectionPage(page.events);
  cursor = page.cursor;
} while (cursor);
```

A page returns the installation identity, raw audit rows, pinned head sequence, exact canonical row-array byte count, next cursor and `done`. Rows retain their original `payload_json` strings and sequence numbers. The cursor is an internal inspection cursor, not an authorization token.

The first page pins the current logical head. Later appends do not enter that export. Reopening the same installation can continue the cursor. Rewrites or compaction change its revision and produce `HISTORY_CURSOR_STALE`; discard the partial inspection and restart. Invalid installation identity, sequence bounds or cursor version fail explicitly.

Queries start at the cursor's indexed sequence and select only relevant packed segments and ordinary rows. They do not rescan the entire prefix to skip earlier events. A relevant segment is decoded as a unit, so up to two partly used segments add bounded decoding overhead beyond returned rows.

Default page limits are 500 events and 1 MiB. Supported limits remain 10,000 events and 4 MiB, matching compaction. Rows are never split. An event larger than the selected cap produces `HISTORY_ROW_TOO_LARGE`; select a larger supported cap or keep the history in its existing format. No rows are silently skipped. Bounds apply to the row-array payload, not every byte of transport/envelope overhead.

`SqliteEngineStore.snapshot()` remains a compatibility API that assembles a complete snapshot. Use pages for large-history inspection. A page alone is not a claim that all earlier history has been verified.

## Startup verification with durable checkpoints

The coordinator now verifies retained history in bounded storage-worker calls **before allocating its new ownership epoch**. Startup defaults are 500 events and 4 MiB per step; `historyVerificationBatchSize` and `historyVerificationByteLimit` configure them within the supported limits. Each step checks a contiguous range, segment integrity/anchors, event identities and aggregate revision references, then commits a checkpoint with the verified position and running prefix digest.

The checkpoint binds the ownership epoch, logical head and history mutation revision and has an integrity digest. If a process stops between steps, the next start resumes committed progress when the source is unchanged. Any history mutation resets verification; stale epochs cannot reuse progress. Repeated mutations during startup eventually fail with `HISTORY_BUSY` rather than loop indefinitely.

The final checkpoint is checked again inside epoch acquisition. Appends or rewrites between verification and acquisition invalidate it. No worker dispatch is authorized by a partial checkpoint.

For an administrative process, equivalent methods are available:

```ts
let verified;
do {
  verified = await storage.historyVerify(currentEpoch, {
    maxEvents: 500,
    maxBytes: 1024 * 1024,
  });
} while (!verified.complete);
```

`HistoryReplayRepository` provides synchronous `page` and `verify` methods for offline tools. Keep synchronous work off a live request/event loop. Direct epoch acquisition retains a small-history verification fallback; beyond 500 events or 4 MiB it requires staged verification and reports `HISTORY_VERIFICATION_REQUIRED`.

Total verification time is still proportional to retained history. This change bounds individual work steps and makes progress resumable; it does not make total work constant or establish a throughput benchmark. Current materialized workflow state remains authoritative for execution—there is no new event-only workflow reducer.

## Export and verify a record stream

```ts
  exportAuditStream,
  verifyAuditStream,
} from './engine/src/audit-stream.ts';

const stream = exportAuditStream(storage, installationId, {
  maxEvents: 100,
  maxBytes: 512 * 1024,
});
const summary = await verifyAuditStream(stream);
console.log(summary.eventCount, summary.prefixDigest);
```

The format is newline-delimited `aiws-engine-audit-stream/1`: one header, sequential event records and one trailer carrying the complete count and prefix digest. Exports use pinned history pages. Missing/reordered events, changed digest, missing trailer, extra content and truncated records fail verification. If export is interrupted or its cursor becomes stale, its partial output is not a valid completed stream.

The verifier retains one bounded record buffer and returns a summary only after validating the trailer and EOF. Default record size is 1 MiB; an explicit record cap may be selected up to 4 MiB. Set page byte bounds below the desired record cap to leave room for the event envelope. A single event that exceeds the record cap cannot be made acceptable by splitting arbitrary JSON bytes into separate records.

A checksum is not authenticity. Use trusted provenance or external signatures when needed. Verification checks stream structure and its integrity chain; it does not establish human authority, independently enforce global event-ID uniqueness, semantically replay native SDK contracts, mutate a database or call effect providers. There is no executable stream-import API. Do not feed this format to the SDK's existing bundle importer.

## Explicit parser profiles

| Limit | Control messages | Stored documents |
|---|---:|---:|
| Encoded bytes | 1 MiB | 20 MiB |
| Nesting depth | 64 | 64 |
| Items per array | 1,024 | 100,000 |
| Keys per object | 4,096 | 100,000 |
| Total value nodes | 100,000 | 1,000,000 |
| Encoded string token bytes | 1 MiB | 20 MiB |

Both profiles reject malformed UTF-8, duplicate decoded keys, trailing JSON, unpaired surrogates and unsafe/nonintegral JSON number values. Object results have no prototype. Numeric resource budgets and timestamps remain decimal strings where required by the wire contract.

`parseWire` retains the existing control profile. `parseJsonDocument(bytes, limits)` exposes explicit validated limits; excessively large depth/resource settings are rejected. Compressed audit segments use a separate bounded specialization: 4 MiB, 10,000 rows and 160,000 value nodes. Their opaque `payload_json` strings retain the original engine payload representation.

Backup inventories use the stored-document profile. A valid content-addressed inventory with more than 1,024 artifacts no longer fails merely because it inherited the control-message array cap. Actual backup file reads, artifact memory usage and full snapshot verification retain their separately documented limits; this is not a general unlimited-upload facility.

The native TypeScript/Python/Rust SDK audit parser still limits a single input to 1 MiB. That contract was deliberately preserved. Large engine audit inspection now has the bounded stream above; native legacy bundle transport/import improvements require their own compatibility work.

## Verification and remaining work

```bash
npm run engine:typecheck
npm run test:engine:m6-replay
npm run test:engine
npm run example:engine:replay
```

Tests cover packed/tail paging, cursor invalidation, exact budgets, durable verification progress, a real process kill, stale certificates, coordinator startup with growing history, segment corruption, streams larger than 1 MiB, fragmented/truncated streams, parser boundary failures and backup inventories above 1,024 artifacts.

History mutation counters and checkpoints initialize additively within schema 1. All engine components must use matching source; direct SQL edits or older writers that bypass the tracked format are unsupported. These integrity digests do not defend against an administrator who can rewrite all database metadata and triggers.

Retention/telemetry is slice 6. Comprehensive fault coverage, platform qualification and measured long-duration/capacity limits remain later slices. No source ZIP refresh, hosted-site deployment or new SDK package release is implied.
