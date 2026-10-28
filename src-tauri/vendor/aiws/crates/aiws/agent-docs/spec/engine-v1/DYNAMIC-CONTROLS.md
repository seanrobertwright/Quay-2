# Dynamic controls transport — 1.0.0

M7 slice 8 defines the opt-in `aiws-dynamic-controls/1` profile. It is separate from `aiws-engine/1` schema 1.1.0. The Node 24 + SQLite host remains authoritative; native clients do not implement a second workflow engine.

## Host and authority

Enable `dynamic: {}` in `startControlHost` options alongside the existing independently verified identity adapter. Supply `verifyReplacement`, `verifyReconciliation`, and installed `agentAdapters` when those operations are needed. Empty authority configuration fails closed for changes needing independent host evidence.

Authority crosses into the dynamic registry as data. For each command the control service runs the identity adapter's checks on the main thread before any database transaction opens. For a human's replacement or reconciliation that already has its approval for the current review, it then runs the host verifier there too, and runs the identity adapter's checks again once the verifier returns. It hands the registry one lease record (principal, kind, evidence reference, session ID, work order, ownership epoch, authority epoch and an expiry of at most 5 seconds) and the verifier's record. A command without its approval never reaches the host verifier. Each verifier record carries the `subjectDigest` of the fresh review it was made against. Inside the write transaction the registry checks every database and review condition: the lease against its review, the challenge the approval ID names, and each record against the review, in that order. A record made against an earlier review fails with `STALE_REVISION`. A request that already has a receipt replays it without consulting the host. A verifier may return its record directly or as a promise. Production identity adapters must establish session identity, HUMAN/AGENT kind, verification time, expiry, current ownership/auth epochs and CSRF protection. Payload claims never establish authority.

Authorize `dynamic:session` and each requested operation (`dynamic:REVIEW`, `dynamic:EXECUTE`, etc.) plus `dynamic:<command action>`, scoped to the target work order. AGENT sessions can propose and acknowledge their own replacement assignment; they cannot issue human approval challenges. Legacy human controls continue to reject AGENT sessions.

Use HTTPS on 127.0.0.1 with explicit certificate trust and TLS 1.3. Browser mutations require same-origin cookies and the session CSRF token. Native transports reject remote origins, redirects, credentials embedded in URLs and alternate paths. Credentials come from a protected callback/input, never command arguments or persisted request JSON.

## Endpoints and closed messages

`GET /engine/dynamic/v1/session` returns profile/version, installationId, namespace, numeric epoch, authEpoch, principalId, kind, csrfToken, message limit and applicable action names. This is context, not an authorization grant.

`POST /engine/dynamic/v1/requests` takes the closed envelope defined in `dynamic-controls.schema.json`: `profile`, `version`, `installationId`, `namespace`, `epoch`, `authEpoch`, `requestId`, `operation`, and the operation payload below.

| Operation | Required payload | Result |
|---|---|---|
| INSPECT | ref, after, limit | Current definition/workflow, paged history and execution records |
| REVIEW | command | Exact current subject digest and impact |
| CHALLENGE | command, subjectDigest | Session-bound human proof |
| EXECUTE | command | Atomic decision receipt and replay flag |
| LOOKUP | ref, commandRequestId | Original actor's durable command receipt |
| RECONCILIATION_INSPECT | ref, reconciliationId | Current effect reconciliation evidence |
| HANDOFF | ref, assignmentId | Immutable replacement handoff |

Commands: REGISTER, BIND_CODING, PROPOSE, ACTIVATE, REJECT, ACTIVATE_INSERTION, ACTIVATE_CODING_REVISION, ACTIVATE_REPLACEMENT, ACK_REPLACEMENT, HOLD_REPLACEMENT, RECONCILE_CODING. The schema defines every required field; the existing registry additionally checks semantic validity, exact identity, revisions, material, permissions and limits.

Messages are at most 1 MiB, depth 64, 100,000 structural nodes, 1,024 array entries and 4,096 object keys. Numbers must be safe integers. Duplicate keys, malformed Unicode, unknown versions and extra fields are rejected. Profile strings generally have a 256-character limit; reason and description allow 4,096. INSPECT limit is 1–1,000; after starts at zero. Reduce pagination when a response exceeds the byte limit. Result bodies remain operation-specific JSON; native codecs validate their enclosing response and request correlation, while server domain logic owns result semantics.

## Review, approval and uncertain responses

1. Fetch authenticated context. Prepare a command using exact current revisions and a fresh approvalId where required.
2. REVIEW the command. The human inspects scope, revisions, impact and any handoff/reconciliation evidence. REVIEW does not approve anything.
3. After an explicit human decision, CHALLENGE the identical command and returned subjectDigest. Human verification must be no more than five minutes old. Proof expires within two minutes, never beyond session expiry, and is bound to actor, session, approvalId, material and authority epochs.
4. Persist the exact EXECUTE envelope and requestId before sending. Execute consumes proof with the durable receipt in the same registry transaction. Workflow activation still requires fresh stage approval; replacement also requires the assigned agent's acknowledgment. Host capability/effect verification remains independent.
5. On an uncertain response retain the original envelope. Retry it unchanged while its epochs remain current, or use LOOKUP as the original actor. Never invent a new request ID to retry an uncertain decision. Changed material under an existing ID is rejected.

Responses contain the profile/version/requestId and either `ok:true,result` or `ok:false,error:{code,commitStatus}`. UNKNOWN means commitment must be resolved by receipt. NOT_COMMITTED applies to that failed submission; it does not undo a possible earlier submission. Clients never retry automatically.

After restart, authenticate a fresh session/context. Old envelopes and unused old review proofs are fenced. LOOKUP with current context can retrieve the old actor's committed receipt. If no receipt exists, resolve outstanding delivery and inspect current state before issuing a fresh reviewed decision. The browser retains uncertain requests across tab reloads in sessionStorage and can download their credential-free JSON for recovery; closing the tab can discard that storage.

## Additive migration and compatibility

Opening dynamic controls installs optional `dynamic_control_version=1` plus immutable challenge records. Existing workflow state and accounting are not rewritten or automatically bound. Registry/execution components retain their own guarded versions. Unknown versions or missing immutable guards fail closed. Use the existing offline consistent backup/restore procedure before changing engine versions; old binaries are not a supported downgrade path for an upgraded database. Restores remain held and fenced under the existing recovery policy.

This source feature does not alter the legacy wire schema, publish new SDK binaries, grant stale-result compatibility, refund dispatch charges, or qualify an operating system. M6 platform/soak acceptance and M7 slice 9 remain separate.
