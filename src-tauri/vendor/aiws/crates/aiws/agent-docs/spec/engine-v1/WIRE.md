# Engine wire contract 1.1.0

Status: finalized M4 specification baseline, 2026-09-09. Not a released engine API.
This document and wire.schema.json (not in this pack) supersede candidate transport
and shape details in [HOST-CONTRACTS.md](./HOST-CONTRACTS.md); its HC-01–HC-12 semantic
requirements continue to apply. [AUTHENTICATION.md](./AUTHENTICATION.md) defines trust
boundaries. [MIGRATIONS.md](./MIGRATIONS.md) defines persistence compatibility.

## Encoding and version negotiation

Use UTF-8 JSON, without BOM, duplicate keys, unpaired surrogates, nonfinite numbers or
trailing content.
All objects are closed; unknown fields, enum values and commands are rejected. IDs
are opaque, case-sensitive, 1–256 Unicode characters; normalize neither IDs nor
namespace names. Persist identifiers byte-for-byte after JSON decoding. Quantities,
revisions, epochs and UTC milliseconds since Unix epoch are canonical nonnegative
decimal strings of at most 100 digits. Only bounded pagination counts use JSON
integers. SDKs use bigint/integer or validated decimal strings, never float arithmetic.
Digests are lowercase SHA-256 hex. No implicit cost currency conversion is allowed:
the installation's immutable accounting unit applies to all nested limits.

The protocol is `aiws-engine/1`; this schema is `1.1.0`. The `$id` is an identifier,
not an instruction to fetch a schema. Validators use the checked-in self-contained
schema. Clients first fetch capabilities and require every needed feature. Exact
protocol major matching is mandatory. Unknown required semantics fail before mutation.
Because objects are closed, new fields/variants require a new explicitly negotiated
schema version. Every current envelope carries schemaVersion = 1.1.0, including
worker enrollment, adapter messages and nested command results. A codec version is an
exact selection, not a claim that closed older clients accept additions.
wire.schema-1.0.0.json (not in this pack) and
wire-fixtures-1.0.0.json (not in this pack) preserve the earlier design bytes.
They are historical shape evidence, not an advertised runtime codec. A server that
chooses to advertise 1.0.0 must retain that exact codec and reject work requiring
unrepresentable active/inherited limits or work-order projections; it cannot silently
map them to zero, success or the new codec.
No silent downgrade, ignored field, alias rewrite or finite-v1 reinterpretation.

HTTP responses identify the selected codec with AIWS-Schema-Version: 1.1.0. An
optional request header must agree with the required body schemaVersion; disagreement
is UNSUPPORTED_VERSION before mutation. Capability discovery without a body returns
the current codec; a requested unsupported codec receives an explicit version error.
Worker enrollment binds its selected codec to the private channel; later mismatches
are rejected. Persist the codec with canonical request/result bytes and digest.

Maximum JSON nesting depth is 64, counting the outer object as depth one.
Default control-message maximum: 1,048,576 UTF-8 bytes, checked before parsing; hosts
may lower it and advertise the actual limit. Arrays hold at most 1,024 entries;
paginated reads request 1–1,000 items. These are request safety bounds, not workflow
or task caps. Large plans, results, audit bodies and artifacts use immutable `Blob`
descriptors (SHA-256, exact byte size, media type), with separately authorized streamed
upload/download. A descriptor alone confers no read authority. Reject oversized values
before allocating their advertised size. Schema constraints do not replace admission.

## Transport and routes

One coordinator serves the CLI, browser and all SDKs over HTTPS, loopback by default;
explicit organization gateway exposure follows AUTHENTICATION.md.
`GET /engine/v1/capabilities` returns `Capabilities`, after enrollment requires a
session, and advertises installed/tested features only. Before enrollment it exposes
only protocol/schema/auth-method availability to a protected setup session.
`POST /engine/v1/commands` accepts only `CommandRequest`; `/queries` accepts only
`QueryRequest`. `/enrollment/challenges` returns `EnrollmentChallenge` for the verified
setup/login context; `/enrollment/complete` accepts only `EnrollmentRequest`. Session
creation, refresh, logout and standard provider callbacks follow the authentication
document and do not create workflow commands. Use `Cache-Control: no-store`.
`POST /engine/v1/approval-challenges` accepts ApprovalChallengeRequest and returns
ApprovalChallengeResponse (200) only to a recently verified authorized human. Bind its
single-use challenge to that principal/session, subject, action and exact material.
Issuing the challenge does not approve anything; consume it atomically with the matching
approve/reject/resolveHold command. Reauthentication uses the configured identity flow.

Commands return `CommandResponse` (HTTP 200), queries `QueryResponse` (200), enrollment
`EnrollmentResult` (200). Errors use `ErrorResponse`: 400 invalid shape, 401 authentication,
403 authorization/human gate, 404 absent or inaccessible target, 409 revision/epoch,
request-ID conflict or resource/hold conflict, 410 unavailable cursor, 413 size limit,
422 unsupported version/capability, 429 throttling, 503 storage/uncertain commit.
Size errors use INVALID_MESSAGE. Never return credential values or sensitive free-form
exception text. An error before a trustworthy envelope is parsed uses locally generated
request ID and namespace `unassigned`; clients must not use it for command lookup.

Worker IPC is a private framed byte stream inherited from the launcher, never a public
HTTP route. Frame = four-byte unsigned big-endian JSON byte length followed by exact
UTF-8 bytes, maximum equal to control limit. Separate pipes/handles carry credential
material; JSON contains scoped ephemeral handles only. Apply length checks before
allocation and close malformed streams. WorkerLaunch enrolls; WorkerRequest and
WorkerReport follow. Message kind is restricted by direction and channel, even though
the root schema describes all message kinds.

## Commands, queries and consistency

The command catalog is the schema's `Command` union. `createWorkOrder` records a
proposal, `startRun` requests execution admission, `approve`/`reject` decide an existing
proposal, `pause`/`resume`/`cancel` request lifecycle transitions, `proposeChange` creates
a material-bound permission/definition/limit proposal, `resolveHold` reconciles a hold,
`reconnectCredential` binds an authenticated provider session, and `setSchedule`/
`disableSchedule` manage durable one-time/interval scheduling. No command means
unconditional execution. Supervised and mandatory human gates apply at the server.
createWorkOrder pins its governing contract separately from assignment/workflow identity;
startRun pins its immutable contract and explicit predecessorRun (null for the first run).
A changed contract requires an approved new linked run. proposeChange records a proposal;
it does not permit in-place graph/plan/contract mutation of an existing pinned run.
Such dynamic activation and agent replacement remain M7. Preserve prior operation,
attempt, acceptance and cumulative accounting lineage when starting reviewed fresh work.
Cron/timezone expressions are not in version 1.1.0.

All references are installation/namespace scoped. `Ref.revision` pins exact material;
it is not a mutable latest alias. Work-order fields require WORK_ORDER, definition
fields DEFINITION, contractRef fields CONTRACT, predecessorRun fields RUN, attempt
fields ATTEMPT, hold fields HOLD, schedule fields SCHEDULE,
credential fields CREDENTIAL, and proposal fields APPROVAL. Dispatch is an immutable
ATTEMPT revision. Ref kinds, lineage and actual existence are checked semantically;
the shared Ref schema deliberately does not establish them by shape alone.

For mutation, `expectedRevisions` contains each existing aggregate whose decision
material the caller relies on, including the target; no duplicate (kind,id) keys.
New root creation may supply an empty list. The server additionally reads and compares
every affected ancestor, policy, approval and ownership epoch in its transaction.
Missing caller revisions never opt out of concurrency checks. All-ancestor reservations,
state, durable timers, dispatch intent, audit events and command result commit together.
The server computes authority bindings from pinned definitions and trusted state;
client `Binding` values are expectations, never trusted facts.

Limits are exact integer accounting units. cost, activeMs, elapsedMs and attempts
may be null to inherit remaining ancestor bounds; null is not an override and zero
admits no new work. handoffCost is an explicit nonnegative integer; when cost is null
it must be zero, and otherwise handoffCost <= cost. The scope start is immutable.
Active time sums per-attempt intervals under M3, including conservative UNKNOWN
exposure through downtime; it is not parallel wall-clock union. Every resource change,
including reductions and partition transfers, requires verified human approval and
cannot lower a bound below current exposure. Permission changes retain the same
mandatory human gate. ALLOW cannot waive either. A proposeChange must
change at least one item; grants are the full proposed replacement set, not additive
ambient authority. setSchedule interval is null (one-time) or positive; replayLimit is
positive only for BOUNDED_REPLAY and zero otherwise. Coalescing produces one occurrence
for missed ticks, persists the skipped range, and advances position atomically.

Idempotency key = (installation, namespace, verified principal issuer/id, requestId).
Compute a separate request digest with RFC 8785 canonical JSON over the entire command
envelope, including expected revisions. Retain the canonical bytes/digest with its
committed result for the replay horizon; never log authentication data. Binding.materialDigest instead hashes the exact proposed domain material, excluding
the binding/envelope itself; it is not this request digest. Same key and
same request digest returns the original result/cursor with REPLAYED after current authentication
and read authorization; same key and different digest is REQUEST_ID_CONFLICT. Lookup
precedes stale revision evaluation for an exact recorded retry. Request IDs cannot be
reused after archival: a retained tombstone rejects reuse and directs archive lookup.

COMMITTED/REPLAYED attest to database acceptance, not external completion. A transport
timeout or UNKNOWN commit status requires `commandResult` lookup with the same identity
and request ID. NOT_FOUND is not proof a concurrent transaction cannot still commit;
retry only the identical request ID/material through the serialized idempotency gate.
Never create a new ID to retry an uncertain command. External execution requires its
separate committed attempt authorization and adapter idempotency/read-back policy.

Queries return committed projections and a consistent event cursor. A commandResult
query returns only its commandResult field, with empty records/events; absence returns
NOT_FOUND. inspect/list return records; events returns events; unused arrays are empty
and unused optional-result slots null. Record is a summary, not restorable full state;
evidence descriptors reference authorized immutable material. Record.contractRef is
required and nonnull for work-order/run views. Work-order state is exactly OPEN,
SUSPENDED or CLOSED; only CLOSED has a nonnull COMPLETED/CANCELED closureDisposition.
Record.details identifies the complete immutable domain projection/inventory at the
returned cursor, with pinned lineage references; it must not be confused with a
restorable database. Bounded summary arrays are not proof an omitted dependency or
hold is absent; inspect the complete authorized inventory. Large inventories use
immutable page manifests, with all page digests pinned before publication. Required
producer recipients may never be silently truncated: use approved bounded boundaries
or reject an unsupported oversized boundary before effects. Event.record pins the
canonical audit body governed by its originating domain contract. Event digest covers
the canonical event excluding its digest, including previousDigest; genesis uses 64
zeroes. Cursor is opaque, scoped and persistent, not a wall clock. Duplicate delivery
deduplicates by event ID; expired hot-history cursor returns CURSOR_EXPIRED and requires
an authorized archive read, never silently skips to now. Paginated pages pin one
committed projection/event position; continuation cannot mix snapshots.

## Host adapter ABI and worker rules

`AdapterRequest`/`AdapterResponse` define transport-neutral DTO signatures for the
trusted host ABI. Dispatch is by operation.name, with matching callId and operation
on return. AdapterError is the only error variant. HC-01/HC-12 use public envelopes;
HC-02–HC-06 and HC-08–HC-11 use these named operations; HC-07 uses worker messages.
An adapter DTO is never accepted on a public route or from an arbitrary worker.
Adapters run as trusted coordinator plugins in v1; an arbitrary remote adapter RPC
is not supported. SDK host bindings must preserve these types and trust boundaries.

Handles name coordinator-owned capabilities scoped to the call/principal/attempt and
expire when their scope closes. They are neither paths nor caller-created credentials.
repository.transact uses a private unit-of-work handle created by the coordinator,
holding the complete typed write set described in HC-05; SQL and raw mutations are
not serializable public commands. Host bindings expose begin/read/stage/commit on that
unit of work; staged writes have no effects before its atomic commit. A provider cannot
implement this by sequential calls to existing separate SDK databases. Authentication
output is trusted only from a configured provider. Credential acquisition covers initial
resolution and refresh, rechecking grants; no secret may enter a DTO or audit body.
Artifact/checkpoint publication receipts require verified durable bytes. Retention
reclaim rechecks live references atomically against the eligibility revision.

Worker enrollment pins installation, boot, process identity and declared capabilities.
prepare is side-effect free. execute requires an unexpired dispatch bound to worker,
attempt, epoch and material; one dispatch cannot authorize another attempt. Unlike
nullable scope limits, execute.maximumExposure contains resolved nonnull numeric
bounds, including activeMs. Resolve these from the committed attempt/ancestor state;
a worker cannot select its own inheritance, accounting purpose or cheaper scope. Reports
use monotonically increasing decimal sequence numbers within a lease. Exact duplicate
sequence/material is a no-op; different material at the same sequence is a conflict.
Old epochs cannot mutate state; late evidence is retained for human reconciliation.
Heartbeat expiry fences authority, not external effects. stopped requires actual
cessation evidence; outcome UNKNOWN retains conservative accounting and responsibility.

## Verification boundary

wire-fixtures.json (not in this pack) checks positive/negative message shapes with
Draft 2020-12 validation. Required-field/unknown-field rejection covers every root;
each command/query/worker operation/adapter request and response has a positive case.
Semantic checks above, signatures, cryptography, actual atomicity and recovery require
runtime conformance. A schema-valid message is not an authorized or executable message.

Canonicalization reference: [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785.html).

## Resolved lifecycle bindings

The exact engine mappings for receipt/admission, hold-resolution intents, immutable
operation identity, loop exhaustion, closure and legacy canonicalization are recorded
in REVIEW.md (not in this pack). They are normative supplements to these message shapes.
The engine owns internal handoff control commands in the unified transaction; exposing
raw SDK stores as public mutation handlers would violate this contract.
