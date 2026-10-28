# Engine host contracts — specification 1

Status: M4 semantic specification complete, not SDK exports. Each contract below must be represented
equivalently for TypeScript, Python and Rust SDK hosts. The finalized DTO signatures,
transport rules and compatibility fixtures are in [WIRE.md](./WIRE.md) and
wire.schema.json (not in this pack); enrollment is specified in
[AUTHENTICATION.md](./AUTHENTICATION.md). These supplement the semantic obligations below.

M10 agent binding (not in this pack) extends HC-03, HC-07, HC-09 and HC-12 in place; it adds
no host contract. Each extension below is marked "M10" and links the section that carries it.
The extensions are specified. Built so far, as a source-only engine profile: the HC-07 attempt
environment rule, and the HC-09 acquisition before commit with its scope and lifetime checks,
delivery at spawn, release with revocation (also after an engine restart), redaction of
delivered secrets, and the hold for a credential failure during an attempt with Recheck, with
the in-memory test provider and the secret-manager command provider.
The M10 build plan (not in this pack)
records the rest.

## HC-01 — Common request and response

Requests identify protocol version, request ID, target installation/namespace, command
type, target work-order/run/operation references, expected revisions and command payload.
Sensitive authentication material travels in the transport's protected authentication
channel, not inside recorded payloads. Responses identify whether a command committed,
the resulting revisions/event cursor and either the recorded result or stable error.

All identifiers are opaque case-sensitive strings; quantities are canonical decimal
strings. No JavaScript floating-point cost/time conversion. Reject unknown required
capabilities/versions before mutation. Duplicate command results are not execution
permits. Error responses distinguish authentication failure, authorization denial,
human decision required, revision/epoch conflict, exhausted limit, credential/artifact
unavailability, uncertain outcome, unsupported platform capability and storage failure.

Queries return committed projections and their event cursor. Event streaming resumes
from an opaque durable cursor; disconnect/reconnect cannot lose authoritative records.
Notification delivery may repeat. Receivers deduplicate by event identity. Neither
stream availability nor telemetry success is necessary for a committed command to exist.

## HC-02 — Authentication provider

Input: protected caller credentials/session context and requested installation audience.
Output: verified principal ID, principal kind (HUMAN/AGENT/SERVICE), issuer, verified
assurance information, authentication time and expiry/session reference. The provider
must establish principal kind through trusted identity provenance. A user-editable
profile field or request claim cannot convert a service identity into a human.

Validate signature/session integrity, issuer/audience, expiry and configured revocation
behavior. Failure is fail-closed; provider unavailability never creates anonymous admin
access. Local owner bootstrap and organizational login can use different adapters but
must satisfy the same verified-principal contract. No concrete login protocol is mandated
by the adapter interface; initial local and organization enrollment/web/CLI flows are
specified in AUTHENTICATION.md and still require runtime testing.

## HC-03 — Authorization provider

Input: verified principal, exact canonical command/material digest, target references,
current policy/approval/ownership revisions and proposed resource use. Output: ALLOW or
DENY, policy revision, decision reference, binding digest, expiration and any required
restrictions. Reject decisions whose target/material/revision/epoch is stale at commit.

Authorize inspection as well as mutation. Map operation scope/purpose from trusted
definitions; never let an agent select a cheaper ancestor or label ordinary work as
HANDOFF. SDK public clients do not supply their own trusted authorization Facts.

Every permission or resource-limit change (increases, reductions and partition transfers
alike) and every uncertainty reconciliation retains a mandatory human gate regardless of an
ALLOW decision. Agents and rules never make such a change, directly or through a workflow
edit, delegation or continuation. Denying or holding work under the existing limits is not a
change. Authorization is not approval-policy evaluation.

M10 (§1 (not in this pack), §3 (not in this pack)) adds
two installation-scoped permissions. Each command under them needs one verified human holding the
permission, with no second approval, checked through the control host identity adapter's `authorize` callback and separate from approving runs; `agent-setup` for Recheck is checked on the run's work order.
`model-register` covers every model register write, with no second approval and no approval
subject; a write without it is refused, and no agent or automatic process ever writes the
register. `agent-setup` covers agent setup, reconnection (of a login directory or a delivered
credential) and login directory retirement.

The engine checks two more actions on a run's work order for the hold exits of
§7 (not in this pack). `ledger-adjust` covers Raise limits, the human ledger
adjustment of an overrun's scope bounds, and its refusal; `approve`, the run's approver's action,
covers Discard and Admit of a held result. Raising a bound is a resource-limit change, and only a
verified human takes any of these exits. Slice 7 adds two installation-scoped permissions for availability notices: `notice-list`
reads the notice list, and `notice-clear` clears a notice as a governed command with no second approval; a host grants `notice-clear`
to those who may approve runs (§5, "Clearing" (not in this pack)). Slice 4 also checks `model-register-view` for the register's
read models, `agent-picker` and `authoring-preview` with no work order, and `binding-review` on a
run's work order; the web view reads the binding review on every inspection.

## HC-04 — Approval policy and decision store

Input: proposed transition and exact plan/graph/contract/material/limit revisions plus
existing verified human decisions. Output: satisfied or an explicit set of required
human decisions. The supervised default approves the plan and authority/resource
envelope before ordinary execution. Additional workflow approval nodes are configurable.

A human decision records decision ID, verified principal/issuer, scope, exact accepted
material and policy revision, approve/reject disposition, timestamp and expiry/revocation
rules. Reject stale material-bound approvals. Resume approval is distinct from a new
budget, changed plan or permission change; record each required decision explicitly.
An agent/rule cannot edit policy to remove its own mandatory human requirements.

**Approval window.** A human decision that releases work opens an approval window: an
approval, a correction re-approval, a resume after a pause or a restart, and a hold exit
that returns the run to READY. The window runs from the decision to the first dispatch it
releases. It closes when that work's first attempt is `DISPATCH_AUTHORIZED`, or it lapses.
Later stages of the same approved material, validation and corrections without
`reapproveCorrections`, run under the run's own limits with no approval clock. Every other
gap a run can sit in (a pause, a hold, a restart) is ended by a human decision that opens
its own window.

The window is 60 minutes from the decision by default. A host policy may shorten it.
Lengthening it takes an owner-approved policy change with an audit record; the engine
offers none, so a longer host setting is refused (`APPROVAL_WINDOW_POLICY_REFUSED`). The
window is independent of the approving session: signing out or a session ending does not
withdraw the decision, while the session still bounds the act of deciding (the two-minute
challenge and the five-minute verification age). The window keeps advancing during a
pause, and a resume opens a fresh window rather than extending one. The material digest,
readiness and the input artifacts are re-checked at dispatch whatever the window.

The M5 dispatch rule is that human approval must be active, and unexpired at its first
dispatch. The dispatch authorizer refuses a first dispatch whose window has closed
(`APPROVAL_EXPIRED`) and records the window closed by that attempt in the same
transaction. A dispatch approval record's expiry likewise bounds only the first dispatch
under it.

**Lapse.** When the host's step finds a READY run whose window has closed with nothing
dispatched, one storage-writer transaction clears the run's approval, sets
AWAITING_APPROVAL with reason `APPROVAL_LAPSED`, records the window as lapsed and appends
an `APPROVAL_LAPSED` event naming the decision whose window lapsed and when the window
closed. It is not a hold, and the step does not report the run blocked. The lapsed
approval stays in the decision history, and anything else that decision recorded, such as
raised limits or an added price, stays recorded. The human gives one fresh approval of the
same reviewed material through the existing decision page, challenge and verification. A
read before that step reports the run as the lapse will write it, so no read shows a lapsed
run as running, and a decision on a run so reported applies the lapse first. A window that
closes while a step is admitting work lapses the run in the same way. A run whose
cancellation is pending or final is never returned to AWAITING_APPROVAL.

## HC-05 — Transactional repository

The unit of work exposes a consistent snapshot, revision/epoch comparison, atomic
workflow/ledger/queue/timer/handoff mutation, append-only audit events, command result
deduplication and durable outbox intent. The implementation must commit or roll back
them together. Retry only known uncommitted transactions; an unknown commit response
is resolved through request-result lookup.

Prevent partial parent reservations and inconsistent lock ordering. Support schema and
snapshot versions explicitly. Do not expose workers to raw database access. SQLite and
PostgreSQL must pass the same conformance suite before support claims; neither backend
may silently weaken durability settings. Cross-database atomicity is not offered.

## HC-06 — Clock and schedule provider

Expose trusted wall time, process monotonic time, boot identity and clock-anomaly state.
Persist UTC due times and occurrence keys. Schedule evaluation returns deterministic
due occurrences, next position and skipped/coalesced records under the pinned policy.
Creating occurrences/advancing schedule state is atomic. Bound catch-up batches.

Clock anomalies block affected dispatch; elapsed deadlines and approval expiry do not
freeze during a pause. Do not infer a stopped interval from a missing heartbeat or
compare monotonic values across boots. Cron/timezone support must be advertised as a
separate capability after DST/missed-tick tests.

## HC-07 — Worker/task adapter

Capabilities declare supported task kinds, execution/containment prerequisites,
maximum exposure enforcement, provider idempotency/read-back behavior, interruption
mode and checkpoint support. Interruption modes are COOPERATIVE_STOP, CHECKPOINT_STOP
or OBSERVE_TO_COMPLETION; unsupported hard termination must never be assumed safe.

Prepare receives pinned task/material identities, scoped artifact access and a lease;
it must not perform the material action. Execute additionally requires a committed,
unexpired attempt dispatch authorization bound to worker and epoch. Progress, heartbeat,
stop acknowledgement and results identify attempt, epoch and a sequence for deduplication.

Stop acknowledgement means verified execution cessation, not merely request receipt.
Outcome includes truthful effect classification, cost evidence and immutable output
references.

Outcome classification. An outcome is UNKNOWN whenever authoritative evidence cannot
establish whether the action applied: for example uncertain dispatch, missing or ambiguous
evidence, a failure between commit and spawn, a host-initiated stop, a thrown transport error,
and, for a local process, a timeout, a signal or a null exit code. UNKNOWN retains
responsibility and is resolved only by reconciliation or a human decision, never relabelled
FAILED or success. A nonzero exit is FAILED when the adapter can attribute it to the command's
own normal completion; the default local worker treats every ordinary nonzero exit that way.
An adapter that cannot tell normal completion from outside termination reports UNKNOWN; the
opt-in Windows native helper does so when its nonce-bound completion marker is missing. Once
an adapter reports an outcome, nothing rewrites it.
Expired/stale workers cannot update authoritative state or authorize follow-on tasks;
their evidence is routed to reconciliation if relevant to real effects.

M10 attempt environment rule (not in this pack): every dispatched
attempt, of every agent kind, gets an environment built from nothing, in three layers: a
platform baseline (`PATH`, `HOME` or `USERPROFILE`, `SYSTEMROOT`, `TEMP`, `TMP`, `TMPDIR` and the
locale variables, and on Windows the variables Node's process launcher supplies to every child),
variables the adapter or the engine sets on purpose, and credentials only through HC-09 delivery.
Nothing passes through from the host's environment beyond the baseline. The adapter turns on the tool's subprocess
scrub switch where one exists. The rule covers environment variables only.

M10 failure classification (not in this pack): a recogniser installed with
the harness's adapter classifies an authentication failure where the tool's machine-readable
output distinguishes it, and Praxis records the recognised failure in the attempt's evidence. The attempt keeps its true outcome (FAILED, or UNKNOWN on a
timeout), its consumption settles under §6 (not in this pack) (an UNKNOWN attempt
keeps its reservation whole), and it counts against the attempt limit; the node then holds
`CREDENTIAL_REQUIRED`. A failure no recogniser recognises stays a plain FAILED. Model
unavailability is classified per adapter in the same way and holds `MODEL_UNAVAILABLE` with its
cause, with no automatic retry (§5 (not in this pack)).

## HC-08 — Artifact provider

Operations: stage bytes privately, verify digest/schema/size, publish durably, resolve
an immutable reference, grant scoped read access, enumerate retention references and
reclaim only verified unreferenced material. Store metadata and pinned source revision
in the transaction repository. References never mean mutable “latest.”

Completion can announce an artifact only after durable publication. Missing, expired or
changed bytes create an input/restore hold. A valid receipt is not proof of successful
execution or acceptance. Live parent/consumer references override age-based cleanup.

## HC-09 — Credential provider

Operations: resolve an authorized secret reference, obtain/refresh scoped credentials,
report expiry/revocation, deliver to the assigned attempt and release/revoke a session
where supported. Inputs bind principal, provider, target audience, granted actions,
attempt and permitted scope. Outputs to engine records contain only nonsecret metadata
and opaque handles. Secret-bearing objects are excluded from generic serialization.

Secrets must not enter arguments, logs, handoffs, database state, ordinary backups or
unrelated workers. Reconnection verifies the same authority again; refreshed credentials
never widen grants. Distinguish CREDENTIAL_REQUIRED before dispatch from uncertain
external effects after dispatch. Local OS stores and organization providers share this
contract; unsupported local services fail clearly rather than storing plaintext silently.

M10 (§3 (not in this pack)) extends this contract for credentials
delivered to model-using agents:

- **Scope fields and markings.** A credential's scope is `provider`, `endpoint`,
  `accountBoundary`, `grantedActions`, `modelRestriction` and `lifetime`; each field is
  `{value, marking}`, marked `CONFIRMED` (observed from the provider) or `RECORDED` (entered by
  an operator). The reference and scope are reviewed material; the secret, its rotation and its
  expiry are not.
- **Delivery forms.** `HELPER`, `FILE`, `ENVIRONMENT` or `IN_PROCESS`, the last for a host
  adapter that is its own harness and redeems the handle in memory. Command-line arguments are
  never used; where the tool supports a helper, the adapter must use it.
- **Acquire before commit.** The credential admission slot acquires the credential and checks
  the reference, scope and any reported expiry or revocation before the attempt commits.
  Unavailable, expired, revoked or too short-lived is `CREDENTIAL_REQUIRED` before commit, with
  no attempt counted and no reservation made; a scope differing from the reviewed one is
  `READINESS_BLOCKED`. The provider reports the scope as `scopeDigest`, SHA-256 of the RFC 8785
  canonical JSON of the scope with its markings. Too short-lived means remaining validity that
  does not cover the attempt's maximum duration plus a margin of 60 seconds, for a delivery form
  that does not renew during the attempt. The worker redeems the handle only at spawn.
- **Release outcomes.** Whatever the outcome, the handle is released and per-attempt files are
  deleted; a credential issued for that attempt alone is revoked where the provider supports
  it, and a shared one never is. The release outcome, `RELEASED`, `REVOKED` or
  `VALID_UNTIL_EXPIRY`, is nonsecret evidence on the attempt. On UNKNOWN, release and revoke
  happen at once without proving the process stopped. The engine keeps a durable, nonsecret lease
  on each handle from the attempt's commit until its release record, and a durable record of each
  per-attempt directory from the attempt's commit until the directory is deleted; a directory that
  cannot be deleted when the attempt ends makes the attempt UNKNOWN and stays recorded. A restart
  deletes every recorded directory a stopped process left, at its recorded path whatever adapters
  the restart has, then releases the handle of every committed attempt a stopped process never
  released, revoking a per-attempt credential, before any new dispatch, again without proving the
  process stopped. A handle
  acquired but not yet committed, or acquired by a Recheck, has no lease. A provider therefore releases handles
  across a restart: it accepts a handle it issued before the engine restarted, and one it already
  released, since the process can stop between the release and its record. The worker redacts
  every secret it delivered from captured output and evidence before persistence, and refuses at
  redemption a secret shorter than 16 characters (UTF-16 code units), which it could not redact
  (§3 (not in this pack)).
- **Failure during an attempt and reconnection.** An authentication failure the recogniser
  installed for the harness recognises keeps the attempt's outcome and counts it (a FAILED attempt
  settles; an UNKNOWN one keeps its reservation until it is reconciled), then holds the node
  `CREDENTIAL_REQUIRED`, and Praxis marks the reference for reconnection; until a human rechecks it,
  admission holds the reference before commit. Reconnection of a delivered credential acquires it
  again and repeats the scope, expiry and lifetime checks without redeeming it
  (§3 (not in this pack), §7 (not in this pack)).
- **Providers.** No provider reads the host's own environment. Conformance uses an in-memory
  test provider. The first real provider is a [secret-manager command
  adapter](AGENT-BINDING.md#credential-providers): per credential reference, host configuration
  names an argv command, run with no shell and a timeout, that prints the secret; a timeout or
  empty output is `CREDENTIAL_REQUIRED`, and nothing is logged. The command receives only the
  attempt environment's platform baseline and the literal variables its configuration sets, so it
  cannot read a secret from the host's environment either.

M10: a subscription login is not delivered under this contract: it stays in a host-owned login
directory that Praxis never reads, copies, stores or delivers
(§3 (not in this pack)).

## HC-10 — Workspace/checkpoint provider

Provision an isolated task directory bound to work-order/run/node occurrence/attempt.
Checkpoint references pin source revision, necessary patches/files, artifact manifests
and environment prerequisites. Verify required bytes before reporting it resumable.
Restore checks compatibility and authority; missing work requires repair or an explicit
decision, not fabrication of a successful checkpoint.

Cleanup requires safe terminal work, durable required outputs and no live references.
Task paths are scoped by the host; user-controlled traversal/symlink targets cannot
grant access outside the approved workspace. Process separation does not implement
filesystem/network sandboxing; the declared containment adapter must enforce it.

## HC-11 — Backup, retention and event export

Backup produces a consistent database checkpoint plus the referenced artifact inventory,
schema/version information and integrity evidence. Restoration is tested on the same
supported host class without dispatch until recovery/reconciliation succeeds. Daily
backups imply a potential interval of data loss; restored stale dispatch responsibility
must not be blindly reissued. Cross-machine recovery remains excluded.

Retention evaluation returns eligibility and blocking live references, including parent
work, uncertainty, accepted evidence and replay dependencies. It cannot directly delete
needed history. Logs have separate retention from authoritative evidence. Events are
redacted before persistence/export and correlate installation/work-order/run/attempt
without including secret values. Export retries do not replay work.

## HC-12 — CLI/web command parity

Both surfaces expose create/inspect, approve/reject, pause/resume, cancel, list/resolve
holds, request/approve resource changes, reconnect credentials and inspect recovery.
Human confirmation presents exact affected scope and proposed material changes. The
server repeats all checks regardless of client affordances. A disabled button is not
authorization enforcement. Interfaces report pending cancellation when effects remain
unsettled and never label a canceled work order successful.

M10 (§7 (not in this pack)): the engine builds one read model
per surface (binding review, hold card, node table and scope tree, notice list, register view
and proposals inbox), and both the CLI and the web view render it, so both show the same model
and digest. An exit prepares its governed command and is confirmed once; nothing is pasted.
`control-cli` renders text by default and prints the raw read model with `--json`.

## Conformance obligations

[CONFORMANCE.md](./CONFORMANCE.md) specifies the shared adapter/storage harness and
independent oracles. [FAKE-CLOCK.md](./FAKE-CLOCK.md) pins time/batch behavior;
[CAPACITY.md](./CAPACITY.md) pins fairness and measurements. REVIEW.md (not in this pack)
resolves identity, M1/M2 handoff and M3 accounting bindings, including the requirement
that every resource adjustment is human-authorized. Implementation must satisfy both
these semantics and the selected closed wire codec.
