# M7 slice 2 — durable definition registry

Status: implemented experimental TypeScript/Node 24 + SQLite host API. Extends the [slice 1 contract](./DYNAMIC-WORKFLOWS.md). Engine database schema 1 gains optional `dynamic_registry_version=1` component metadata. No engine wire-codec or native SDK 0.3.0 API changes.

## Execution boundary

Activation changes the authoritative **registry definition head**, not executable coding state. Standalone registry heads and receipts have `execution: UNBOUND`. The [Slice 3 binding extension](./EXECUTION-BINDINGS.md) adds a separately approved `BIND_CODING` action and effective `CODING_V1` execution marker. Registration and activation reject any existing scheduler task for the work order (including completed tasks), or any composed coding-workflow aggregate. Paused/canceling/canceled work-order controls also block these actions. No task is enqueued, no worker is canceled/replaced, no evidence is reused or invalidated, and no consumed/reserved resource is changed.

REGISTER and ACTIVATE retain this conservative boundary; Slice 3 binding uses its separate guarded transaction. Slices 4–7 supply operation-specific lifecycle and effect handling. Hosts must not treat an activated registry revision as dispatch permission or manually attach it to an existing coding run. Task material/policy digests remain host-resolved immutable references, not automatic artifact-store retention roots or proof that material exists.

Slice 4 adds [ACTIVATE_INSERTION](./CODING-INSERTION.md) for a bound preparation prefix before first dispatch. Plain REGISTER/ACTIVATE retain their existing boundaries.

Slice 5 adds [ACTIVATE_CODING_REVISION](./CODING-REVISIONS.md) for reviewed plan and dependency changes before dispatch.

## Host API

`new DynamicWorkflowRepository(filename, {authority, now?, busyTimeoutMs?, boundary?})` opens the component through the existing guarded WAL/FULL engine database initializer. `authority` is required. `now` is a trusted synchronous host clock, defaulting to current UTC wall time. `boundary` is an internal test hook, never a wire field.

`execute({epoch, requestId, credential, command})` accepts one of these closed commands:

| Action | Required command fields | Permission and effect |
|---|---|---|
| `REGISTER` | `definition`, `approvalId` | Verified human plus exact approval creates revision 1 and the first head for a previously unregistered work order |
| `PROPOSE` | `proposal` | Authenticated human or agent with scoped propose permission; stores immutable proposal against the current head |
| `ACTIVATE` | `ref`, `proposalId`, `approvalId` | Verified human plus exact approval atomically appends the successor revision and advances the head |
| `REJECT` | `ref`, `proposalId`, `approvalId`, `reason` | Verified human plus exact decision approval records rejection; leaves the definition head untouched |

`ref` contains exactly `workOrderId` and `runId`. One current run per work order is supported; another run cannot overwrite it. Existing proposal IDs cannot be replaced, even after rejection. A stale pending proposal may be explicitly rejected after another proposal wins; it cannot activate. Invalid/stale/unauthorized commands throw without changing durable state. These failed command attempts are not durable rejection decisions; only an authorized `REJECT` command creates one.

`review(epoch, command)` returns read-only material for host review. `getHead(ref)` returns the active definition, digest and effective execution marker. `getProposal(ref,id)` returns immutable material/digest plus `PENDING`, `ACTIVATED` or `REJECTED` status. `history(ref,after=0,limit=100)` returns events ordered by global sequence; maximum page size is 1000. These read APIs are trusted local host APIs, not unauthenticated remote endpoints.

## Authentication, approval and time

Authority reaches the repository as data, and no host code runs inside its write transaction. Before each command, trusted engine code authenticates current identity and verifies action-specific, work-order/run-scoped authority, including revocations, through the host's identity adapter. It then passes `execute` a lease record with exactly `principalId`, `kind`, `evidenceRef`, `sessionId`, `workOrderId`, `epoch`, `authorityEpoch` and `expiresAt`. A malformed lease denies the action. Inside the transaction the repository checks that the lease names the work order, ownership epoch and authority epoch of its own review, and fails `FORBIDDEN` otherwise. The repository matches proposal attribution to the lease's identity. Humans may have propose permission without activation permission; the identity adapter must enforce that distinction. The initial profile does not support autonomous activation: only a verified human actor may register, activate or reject.

A human approval is a one-time challenge record the repository issues itself. `challenge` takes a verified human's lease, the command, the `subjectDigest` the human reviewed and the session's expiry. In one write transaction it reviews the command, compares the digests (`STALE_REVISION` when they differ), and issues or reuses the immutable record for that principal and approval ID: `principalId`, `kind: HUMAN`, `evidenceRef`, `subjectDigest` and an `expiresAt` at most 2 minutes away, bound to the lease's session. An approval ID names one reviewed subject for good: asking again for different material, or from another session, fails `FORBIDDEN`. Inside `execute`'s transaction the repository looks the record up by the lease's principal and the command's approval ID, and fails `FORBIDDEN` unless it was issued to the lease's session for the current review's subject digest. Complete external identity and challenge interaction before calling the repository. The host remains responsible for the authenticity and freshness of the external identity source; SQLite cannot atomically transact with an identity provider.

The decision subject binds domain `AIWS_DYNAMIC_DECISION_V1`, installation identity, ownership epoch, current control-authority epoch, action, work-order/run, base definition digest, candidate digest, proposal digest, and rejection reason (null for other actions). It uses existing engine canonical JSON/SHA-256. Approval IDs are lookup references, not semantic material; exact command retry identity still includes them. Approval evidence identified by `(principalId,evidenceRef)` is consumed once, preventing alias lookup IDs from reusing the same proof. Proposer/approver identity and review material are retained in immutable audit events. Raw credentials are not persisted.

Time must be canonical UTC, respect the persisted engine clock high-water and a registry decision high-water, and belong to the current ownership epoch. Restore holds, missing current clock observations and clock uncertainty block commands. Session and approval expiry are checked after the approval lookup and again immediately before commit; expiry equality fails. A changed ownership or authority epoch invalidates old decision approval. Trusted host clock observation and revocation-source integration remain host duties.

## Transaction, retries and recovery

Every mutation uses `BEGIN IMMEDIATE`. The same transaction revalidates schema, clock/epoch, current scoped authorization, immutable proposal material, approval and the current head. Activation writes revision, head, decision, approval consumption, audit event and receipt together. Another writer can win first; a stale candidate then fails without consuming its approval or request ID. No old revision is overwritten. SQL update/delete guards protect revisions, proposals, events, decisions, receipts and consumed proofs.

Receipts are keyed by authenticated principal plus request ID and bind the full normalized command digest. Exact retries return the original receipt, even after reopen, later revisions or a new ownership epoch. Changed command material under the same key fails. Retries still require current authorization, current epoch and healthy clock/recovery state, but do not need to consume or revalidate the original approval: they perform no second activation. The receipt is the historical result of that request, not a fresh head snapshot; use `getHead` to inspect current state. A new request ID targeting an already decided proposal is rejected.

Normalization and persistent reads use the engine stored-record parser profile (20 MiB, depth 64 and documented collection/node limits). Oversized records are refused before write rather than committed into a form the reader cannot reopen. History is paginated; full semantic replay of all registry events is not implemented.

## Migration and qualification

Initialization is additive and transactional. A future component version, missing component tables/metadata or missing immutability guards is rejected without automatic repair. Existing engine databases gain no dynamic heads or task bindings merely by opening this component. Existing engine epoch, clock, accounting, scheduler and control records retain their meaning. Reverting to an older binary that does not understand this component is unsupported; M8 still owns release migration/downgrade qualification.

Seven real process kills cover revision/head/event/decision/receipt writes and both sides of commit. Reopening yields either the prior head with no activation, or the complete new decision with an idempotent receipt. Additional tests cover two concurrent activating processes, rejection, approval mismatch/expiry/replay, authorization/proposer checks, epoch/clock/restore fencing, immutability, corruption detection, pagination and legacy-work guards. Device power loss, production identity adapters, native platforms, full backup/restore qualification for this component and live execution binding remain outside this slice's evidence.
