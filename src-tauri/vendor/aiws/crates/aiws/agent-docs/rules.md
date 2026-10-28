# Governance rules

Generated from `skills/rules.json`, the one rules source. A never-generate rule names code an agent must never write; a host obligation names what a host you build must do.

## Scoping

- Exhaustion depends on the profile. Under finite-v1 an exhausted loop or attempt bound is terminal (FAILED). Under handoff-v1 it is a resumable hold (HS-02). Either way, no new work starts in that scope.
- Automatic retry belongs to the layer that dispatches. The SDK coordinator may retry only under STANDARD E-05, which requires proof of non-application or a target guarantee. Praxis starts no corrective work after a timeout, and a model-selection hold or provider refusal is never retried automatically (AGENT-BINDING section 5).

## Never generate

### NG-01

Protects: Uncertain outcomes need a human; a timeout or restart never proves an action did not happen.

- Praxis: Code that classifies a timeout, signal, null exit code, failure between commit and spawn, or thrown adapter or transport error as FAILED, SUCCEEDED or CONFIRMED_NOT_APPLIED
  - Short form: Never call a timeout, signal, null exit or thrown error FAILED or success: it is UNKNOWN
  - Sources: `CLAUDE.md` "Non-negotiable semantics"; `BUILD-PLAN.md` "Agreed requirements to preserve"; `STANDARD.md` "10 Effects, attempts, retries, and compensation" (E-02); `spec/engine-v1/HOST-CONTRACTS.md` "HC-07 — Worker/task adapter"; `spec/engine-v1/AGENT-BINDING.md` "Delivered credentials"; `spec/engine-v1/AGENT-BINDING.md` "Settlement"
- SDK effect adapter: An effect adapter that reports `CONFIRMED_APPLIED` or `CONFIRMED_NOT_APPLIED` for a timeout, a signal, a null exit code, a crash between the dispatch record and the call, or a thrown adapter or transport error. Report UNKNOWN: only reconciliation or a human decision resolves it.
  - Short form: Timeout, signal, null exit or thrown error → UNKNOWN, never CONFIRMED_*.
  - Sources: `STANDARD.md` "10 Effects, attempts, retries, and compensation" (E-02); `spec/engine-v1/HOST-CONTRACTS.md` "HC-07 — Worker/task adapter"

### NG-02

Protects: The attempt keeps its true outcome; a violation holds the result, not the evidence.

- Praxis: Code that rewrites a true execution outcome: a nonzero exit that the adapter can attribute to the command's own normal completion reported as UNKNOWN or success, an UNKNOWN that the adapter reported for a nonzero exit it could not attribute rewritten as FAILED, or a zero exit rewritten as FAILED because the result breaks its binding
  - Short form: Never relabel an exit or a binding violation: a reported outcome is never rewritten
  - Sources: `CLAUDE.md` "Non-negotiable semantics"; `spec/engine-v1/HOST-CONTRACTS.md` "HC-07 — Worker/task adapter"; `spec/engine-v1/AGENT-BINDING.md` "Held results"
- SDK effect adapter: An effect adapter that reports `CONFIRMED_NOT_APPLIED` for a nonzero exit without evidence that nothing changed, or that rewrites an outcome it has reported. Evidence is either the operation contract (E-01) declaring that the command changes nothing on a nonzero exit, or a read-only reconcile showing the target unchanged. Without it, report UNKNOWN. A check with no side effect that ran to completion reports `CONFIRMED_APPLIED`, and its negative result is recorded as a verification FAIL.
  - Short form: Nonzero exit → CONFIRMED_NOT_APPLIED only with proof nothing changed; else UNKNOWN.
  - Sources: `STANDARD.md` "10 Effects, attempts, retries, and compensation" (E-01, E-02, E-05); `spec/engine-v1/HOST-CONTRACTS.md` "HC-07 — Worker/task adapter"

### NG-03

Protects: Unknown, non-idempotent outcomes block automatic retry and need reconciliation.

- Automatic retry of an UNKNOWN operation; a "retry on any exception" wrapper around dispatch; a retry justified only by a compensation procedure
  - Short form: Never auto-retry an UNKNOWN operation or wrap dispatch in retry-on-any-exception
  - Sources: `STANDARD.md` "10 Effects, attempts, retries, and compensation" (E-05); `spec/engine-v1/RECOVERY.md` "Failure boundaries and recovery — M4 specification"; `spec/engine-v1/AGENT-BINDING.md` "5. Holds, notices and recovery"

### NG-04

Protects: Idempotency key and request digest; never create a new ID to retry an uncertain command.

- A client that mints a new request ID to retry an uncertain command, or that reads `NOT_FOUND` from a `commandResult` lookup as proof nothing committed
  - Short form: Never retry an uncertain command with a new request ID or read NOT_FOUND as "nothing committed"
  - Sources: `spec/engine-v1/WIRE.md` "Commands, queries and consistency"; `spec/engine-v1/HOST-CONTRACTS.md` "HC-05 — Transactional repository"

### NG-05

Protects: Unknown liability keeps its reservation; only RESERVED may be released.

- Releasing a DISPATCHED or UNKNOWN reservation, refunding exposure on timeout, or stopping or settling without authoritative evidence
  - Short form: Never release or refund a DISPATCHED/UNKNOWN reservation without authoritative evidence
  - Sources: `spec/limits-v1/CONTRACT.md` "Lifecycle and atomicity"; `STANDARD.md` "9 Human approvals and resource limits" (B-02)

### NG-06

Protects: Settlement above the reserved maximum fails closed and needs a human-approved bound change.

- Capping, absorbing, hiding or charging to a sibling a cost overrun; settling above the reservation silently
  - Short form: Never cap, hide, absorb or shift a cost overrun to a sibling; overruns hold for a human
  - Sources: `spec/limits-v1/CONTRACT.md` "Lifecycle and atomicity"; `spec/engine-v1/AGENT-BINDING.md` "Settlement"

### NG-07

Protects: Reserve before dispatch; durable dispatch record precedes the effect.

- Dispatching an external effect before the reservation and dispatch intent are durably committed
  - Short form: Never dispatch an effect before its reservation and dispatch intent are durably committed
  - Sources: `STANDARD.md` "10 Effects, attempts, retries, and compensation" (E-03, E-09); `spec/limits-v1/CONTRACT.md` "Lifecycle and atomicity"

### NG-08

Protects: Human identity comes only from trusted authentication.

- Trusting an `actor`, `isHuman`, `actorKind`, proposer label or "HUMAN" string from a request body; a permissive or allow-all authorizer
  - Short form: Never trust actor, isHuman or "HUMAN" from a request body; never write an allow-all authorizer
  - Sources: `spec/engine-v1/HOST-CONTRACTS.md` "HC-02 — Authentication provider"; `spec/handoff-v1/CONTRACT.md` "2. Objects and trust boundaries"; `spec/limits-v1/CONTRACT.md` "Authority and exhaustion"; `src/content/docs/agents.md` "Rules that prevent invented integrations"

### NG-09

Protects: Only an authenticated human approves any change to an agent's permissions or resource limits; denying or holding work under the existing limits is not a change.

- Any path by which an agent or rule changes permissions or limits, including reductions, partition and handoff-split changes and exposure allowances, directly or through a workflow edit, delegation, continuation, replacement or insertion; any `raiseBudget` or `grantSelfPermission` command
  - Short form: Never let an agent or rule change permissions or limits, reductions included, by any route
  - Sources: `CLAUDE.md` "Non-negotiable semantics"; `BUILD-PLAN.md` "Agreed requirements to preserve"; `spec/limits-v1/CONTRACT.md` "Authority and exhaustion"; `spec/engine-v1/WIRE.md` "Commands, queries and consistency"; `spec/handoff-v1/CONTRACT.md` "6. Holds, limits and human intervention" (HS-03); `spec/engine-v1/AGENT-BINDING.md` "Exposure allowance and stop threshold"; `spec/engine-v1/HOST-CONTRACTS.md` "HC-03 — Authorization provider"

### NG-10

Protects: Nothing resets; cumulative accounting survives every continuation.

- Resetting attempt counts, consumed budget, reservations, approvals or deadlines on resume, hold release, retry, new run, agent replacement, insertion or restore
  - Short form: Never reset attempts, spend, reservations, approvals or deadlines on resume, retry or restore
  - Sources: `BUILD-PLAN.md` "Agreed requirements to preserve"; `STANDARD.md` "9 Human approvals and resource limits" (B-02, B-03); `STANDARD.md` "15 Export, bindings, and optional migration" (MG-03); `spec/handoff-v1/CONTRACT.md` "6. Holds, limits and human intervention" (HS-02, HS-04); `spec/engine-v1/AGENT-BINDING.md` "Agent replacement"

### NG-11

Protects: Calendar time keeps running during pauses; pause stops new dispatch only.

- Freezing elapsed deadlines, approval expiry or lifetime during a pause, hold or downtime; treating PAUSED or a stop request as proof that in-flight work stopped
  - Short form: Never freeze deadlines or expiry during a pause; PAUSED does not prove in-flight work stopped
  - Sources: `BUILD-PLAN.md` "Agreed requirements to preserve"; `STANDARD.md` "9 Human approvals and resource limits" (B-03); `STANDARD.md` "7 Lifecycle and termination" (L-02); `spec/engine-v1/HOST-CONTRACTS.md` "HC-06 — Clock and schedule provider"; `spec/handoff-v1/CONTRACT.md` "6. Holds, limits and human intervention" (HS-04, HS-05)

### NG-12

Protects: Protocols provide connectivity; Praxis owns authority, approval, verification and acceptance.

- Treating a tool result, protocol observation, remote task state, AG-UI event or handoff summary as approval, verification PASS, acceptance or authority; setting `authoritative: true`; adding `accepted`, `verified`, `approval` or `completed` fields to a dispatch receipt
  - Short form: Never treat a tool result, protocol event or summary as approval, PASS, acceptance or authority
  - Sources: `spec/engine-v1/PROTOCOL-BINDINGS.md` "2. Core rule"; `spec/engine-v1/PROTOCOL-BINDINGS.md` "5. External observations are never authority"; `STANDARD.md` "12 Context, data, memory, and trust boundaries" (X-01, X-02); `spec/handoff-v1/CONTRACT.md` "7.1 Relational checks beyond JSON Schema"

### NG-13

Protects: Attributable, independent assessment; acceptance is a separate decision.

- Recording PASS or acceptance from agent self-report or a model's statement; recording unavailable evidence as PASS instead of INCONCLUSIVE; treating a digest or signature as proof that a criterion is true
  - Short form: Never record PASS or acceptance from an agent's self-report; missing evidence is INCONCLUSIVE
  - Sources: `STANDARD.md` "13 Evidence and verified outcomes" (V-01, V-02, V-04, V-08); `src/content/docs/agents.md` "Rules that prevent invented integrations"

### NG-14

Protects: Never collapse remote identity into local durable identity.

- Collapsing remote identity into local identity (an A2A task ID used as a Praxis task or attempt ID, a remote task rebound to another operation); appending to a terminal A2A task
  - Short form: Never reuse a remote (A2A/MCP) task ID as a local identity or append to a terminal A2A task
  - Sources: `spec/engine-v1/PROTOCOL-BINDINGS.md` "8.2 A2A"; `spec/engine-v1/PROTOCOL-BINDINGS.md` "9. Identity model"

### NG-15

Protects: Reviewed capability material is digest-bound and drift blocks before the effect.

- MCP or A2A dispatch without re-observing capability material and comparing it with the reviewed `expectedCapabilityDigest`; silently migrating in-flight work to a changed binding
  - Short form: Never dispatch MCP/A2A without re-checking the capability digest against the reviewed one
  - Sources: `spec/engine-v1/PROTOCOL-BINDINGS.md` "8.1 MCP"; `spec/engine-v1/PROTOCOL-BINDINGS.md` "11. Compatibility"

### NG-16

Protects: Exact decimal accounting in one fixed integer unit.

- Floating-point or JSON-number arithmetic for cost, time, revisions or epochs; currency conversion; non-canonical decimal strings
  - Short form: Never use floats or JSON numbers for cost, time, revisions or epochs; use decimal strings
  - Sources: `spec/engine-v1/WIRE.md` "Encoding and version negotiation"; `spec/engine-v1/HOST-CONTRACTS.md` "HC-01 — Common request and response"; `spec/limits-v1/CONTRACT.md` "Units and simultaneous bounds"; `spec/handoff-v1/CONTRACT.md` "3. Wire representation and identity" (HF-01)

### NG-17

Protects: Closed records, exact version match, no silent downgrade.

- Lenient parsing: accepting unknown fields, enum values, commands or versions; duplicate keys; silent downgrade or alias rewrite; ignoring an unknown required extension
  - Short form: Never parse leniently: no unknown fields, enum values or versions, no duplicate keys
  - Sources: `spec/engine-v1/WIRE.md` "Encoding and version negotiation"; `spec/handoff-v1/CONTRACT.md` "3. Wire representation and identity" (HF-01); `spec/handoff-v1/CONTRACT.md` "9. Migration and negotiation" (HM-01); `STANDARD.md` "15 Export, bindings, and optional migration" (EX-02)

### NG-18

Protects: Attached graphs are immutable; dynamic changes are versioned and authority-gated.

- Mutating an attached graph, plan or contract in place; a dynamic change without a base-plus-one revision, parent digest and authority gate; changing work-order or run identity
  - Short form: Never mutate an attached graph, plan or contract in place; propose a versioned, gated revision
  - Sources: `CLAUDE.md` "Non-negotiable semantics"; `BUILD-PLAN.md` "Agreed requirements to preserve"; `STANDARD.md` "6 Intent, definitions, and plans" (I-02, P-01); `spec/engine-v1/WIRE.md` "Commands, queries and consistency"

### NG-19

Protects: Terminal execution is never reopened; cancellation never implies success or rollback.

- Reopening terminal execution; reporting a canceled work order as successful; treating CANCELED as rollback
  - Short form: Never reopen terminal execution or report a canceled work order as success or rollback
  - Sources: `STANDARD.md` "7 Lifecycle and termination" (L-03, L-04); `spec/handoff-v1/CONTRACT.md` "6. Holds, limits and human intervention" (HS-06); `spec/engine-v1/HOST-CONTRACTS.md` "HC-12 — CLI/web command parity"

### NG-20

Protects: Fencing and clock trust.

- Accepting a stale owner's or stale epoch's result as completion; comparing monotonic values across boots; letting a backward clock create allowance or extend a lease
  - Short form: Never accept a stale owner's or epoch's result; never let a backward clock extend a lease
  - Sources: `spec/engine-v1/HOST-CONTRACTS.md` "HC-06 — Clock and schedule provider"; `spec/engine-v1/HOST-CONTRACTS.md` "HC-07 — Worker/task adapter"; `spec/engine-v1/WIRE.md` "Host adapter ABI and worker rules"; `spec/handoff-v1/CONTRACT.md` "5. Delivery and consumer admission" (HD-02)

### NG-21

Protects: Scope and purpose come from trusted definitions.

- Letting an agent or worker choose its accounting scope, purpose or a cheaper ancestor, or labelling ordinary work HANDOFF
  - Short form: Never let an agent choose its accounting scope or purpose, or label ordinary work HANDOFF
  - Sources: `spec/engine-v1/HOST-CONTRACTS.md` "HC-03 — Authorization provider"; `spec/limits-v1/CONTRACT.md` "Lifecycle and atomicity"; `spec/engine-v1/WIRE.md` "Host adapter ABI and worker rules"

### NG-22

Protects: A basic engine-generated report needs no paid model request.

- Making the basic checkpoint or handoff report depend on a paid model request; paying for a summary outside the protected handoff allowance
  - Short form: Never make the basic checkpoint or handoff report depend on a paid model request
  - Sources: `CLAUDE.md` "Non-negotiable semantics"; `BUILD-PLAN.md` "Agreed requirements to preserve"; `spec/handoff-v1/CONTRACT.md` "6. Holds, limits and human intervention" (HS-04); `spec/limits-v1/CONTRACT.md` "Units and simultaneous bounds"

### NG-23

Protects: Skips never masquerade as completion.

- Treating a missing or skipped input as completed; a join that counts skipped, failed or merely dispatched branches as success; an ANY join that abandons active work
  - Short form: Never count a skipped, failed or merely dispatched input or branch as completed
  - Sources: `STANDARD.md` "6 Intent, definitions, and plans" (P-03); `STANDARD.md` "19 Node contracts and execution semantics" (ND-03); `spec/handoff-v1/CONTRACT.md` "5. Delivery and consumer admission" (HD-04)

### NG-24

Protects: Approvals are material-bound, single-use where limited, and attributable.

- Reusing a material-bound approval after the material changed; treating a challenge being issued, a notification or a button event as an approval
  - Short form: Never reuse an approval after its material changed; a notification or click is not approval
  - Sources: `STANDARD.md` "9 Human approvals and resource limits" (H-01, H-02, H-04); `spec/engine-v1/HOST-CONTRACTS.md` "HC-04 — Approval policy and decision store"; `spec/engine-v1/WIRE.md` "Transport and routes"; `spec/engine-v1/PROTOCOL-BINDINGS.md` "8.3 AG-UI"

### NG-25

Protects: Credentials travel only as references and protected handles.

- Secrets in argv, plans, journals, logs, handoff manifests, artifact locators, endpoint URLs, UI events, telemetry or database state
  - Short form: Never put secrets in argv, plans, logs, handoffs, URLs, telemetry or database state
  - Sources: `spec/engine-v1/HOST-CONTRACTS.md` "HC-09 — Credential provider"; `spec/engine-v1/PROTOCOL-BINDINGS.md` "10. Credential and endpoint handling"; `spec/handoff-v1/CONTRACT.md` "4. Manifest and material" (HF-04); `STANDARD.md` "12 Context, data, memory, and trust boundaries" (X-03); `STANDARD.md` "14 Execution records and observability" (O-08)

### NG-26

Protects: The attempt environment is built from nothing; no secret passes through by name.

- Building an attempt's environment from the host environment (spreading `process.env`), or a credential provider that reads the host environment
  - Short form: Never build an attempt's environment from the host environment (no spreading process.env)
  - Sources: `spec/engine-v1/AGENT-BINDING.md` "Attempt environment rule"; `spec/engine-v1/AGENT-BINDING.md` "Credential providers"; `spec/engine-v1/HOST-CONTRACTS.md` "HC-07 — Worker/task adapter"; `spec/engine-v1/HOST-CONTRACTS.md` "HC-09 — Credential provider"

### NG-27

Protects: No automatic fallback; only pinned, registered identifiers.

- Model fallback in any form: an ordered alternate list, switching models on a refusal, a retry scheduled at a reported reset time, or an alias identifier (`-latest`, `auto`, `opusplan`, a family alias) in a model set
  - Short form: Never fall back to another model, use a moving alias, or retry at a reported reset time
  - Sources: `spec/engine-v1/AGENT-BINDING.md` "Model set"; `spec/engine-v1/AGENT-BINDING.md` "Pinned identifiers"; `spec/engine-v1/AGENT-BINDING.md` "5. Holds, notices and recovery"; `spec/engine-v1/AGENT-BINDING.md` "Model unavailability"

### NG-28

Protects: DECLARED never dispatches a model-using agent.

- Dispatching a model-using agent on DECLARED model requirements, or letting a caller drop the VERIFIED confinement minimums
  - Short form: Never dispatch a model-using agent on DECLARED model requirements
  - Sources: `spec/engine-v1/AGENT-BINDING.md` "Model assurance"

### NG-29

Protects: Praxis never holds the login; exclusive hold per directory.

- Code that reads, copies, stores or delivers a subscription login; passes `--bare` to Claude Code; or lets two attempts share one login directory at once
  - Short form: Never read, copy or store a subscription login, or share a login directory between attempts
  - Sources: `spec/engine-v1/AGENT-BINDING.md` "Login custody"

### NG-30

Protects: The adapter normalises and never prices; corrections are forward-only; register writes need the `model-register` permission.

- Settling with a tool's own cost estimate; settling an attempt below its exposure allowance other than on a COMPLETE usage report that prices it lower or by a human decision backed by authoritative external evidence; repricing a settled cost; letting an agent or automatic process write the model register
  - Short form: Never settle on a tool's estimate or below the allowance without a COMPLETE report or human evidence
  - Sources: `spec/engine-v1/AGENT-BINDING.md` "Model usage report"; `spec/engine-v1/AGENT-BINDING.md` "Settlement"; `spec/engine-v1/AGENT-BINDING.md` "Who writes the register"

### NG-31

Protects: Process separation does not implement filesystem or network sandboxing.

- Code or docs that treat a workspace directory, worktree or process separation as a sandbox or a credential boundary
  - Short form: Never treat a workspace directory, worktree or separate process as a sandbox
  - Sources: `spec/engine-v1/HOST-CONTRACTS.md` "HC-10 — Workspace/checkpoint provider"; `STANDARD.md` "19 Node contracts and execution semantics" (ND-06); `spec/engine-v1/AGENT-BINDING.md` "8. Stated limits"

### NG-32

Protects: Fixed UTC interval recurrence only, until a separate capability is advertised.

- Cron expressions, time zones or DST handling in engine schedules; local wall-clock due times
  - Short form: Never use cron, time zones or local wall-clock times in engine schedules; fixed UTC only
  - Sources: `spec/engine-v1/HOST-CONTRACTS.md` "HC-06 — Clock and schedule provider"; `spec/engine-v1/WIRE.md` "Commands, queries and consistency"; `src/content/docs/agents.md` "Rules that prevent invented integrations"

### NG-33

Protects: Commands run as argv with no shell.

- Shell-string commands (`shell: true`, `sh -c` concatenation) for attempt commands or credential-provider commands
  - Short form: Never run attempt or credential commands through a shell string; use argv
  - Sources: `spec/engine-v1/HOST-CONTRACTS.md` "HC-09 — Credential provider"; `spec/engine-v1/AGENT-BINDING.md` "Credential providers"

### NG-34

Protects: The coordinator is the only mutation path.

- Exposing raw SDK stores, reducers or adapter DTOs as public mutation handlers, or giving workers raw database access
  - Short form: Never expose raw stores or reducers as mutation handlers or give workers database access
  - Sources: `spec/handoff-v1/CONTRACT.md` "2. Objects and trust boundaries"; `spec/engine-v1/WIRE.md` "Host adapter ABI and worker rules"; `spec/engine-v1/WIRE.md` "Resolved lifecycle bindings"; `spec/engine-v1/HOST-CONTRACTS.md` "HC-05 — Transactional repository"

### NG-35

Protects: A work-order limit holds all descendants; unsupported scope is rejected (`SCOPE_UNSUPPORTED`).

- Approximating a scope hold (stopping one branch for a work-order limit), or starting work under a scope the runtime cannot fence
  - Short form: Never approximate a scope hold or start work under a scope the runtime cannot fence
  - Sources: `CLAUDE.md` "Non-negotiable semantics"; `spec/handoff-v1/CONTRACT.md` "6. Holds, limits and human intervention" (HS-01)

### NG-36

Protects: One durable ledger owns the whole work-order tree.

- Summing separate mission databases as a substitute for one ledger, or splitting sibling work across ledgers
  - Short form: Never split one work-order tree across ledgers or sum separate mission databases
  - Sources: `spec/limits-v1/CONTRACT.md` "Accounting domain and identity"

## Host obligations

### HC-01

Accept only versioned, closed request envelopes; carry authentication outside recorded payloads; return committed-or-not plus revisions and cursor; reject unknown required capabilities before mutation; use distinct error classes; resume event streams from a durable cursor

Sources: `spec/engine-v1/HOST-CONTRACTS.md` "HC-01 — Common request and response"; `spec/engine-v1/WIRE.md` "Encoding and version negotiation"

### HC-02

Verify principal, kind (HUMAN, AGENT, SERVICE), issuer, audience, expiry and revocation from trusted provenance; fail closed; never derive humanity from a profile field or request claim

Sources: `spec/engine-v1/HOST-CONTRACTS.md` "HC-02 — Authentication provider"

### HC-03

Authorize inspection and mutation against exact material and current revisions; reject stale decisions at commit; map scope and purpose from trusted definitions; keep the human gate for every permission or resource-limit change (increases, reductions and partition transfers alike) and every uncertainty reconciliation regardless of ALLOW. M10: `model-register` and `agent-setup` installation permissions

Sources: `spec/engine-v1/HOST-CONTRACTS.md` "HC-03 — Authorization provider"

### HC-04

Evaluate approval policy against exact material; record attributable human decisions with expiry; reject stale material-bound approvals; keep resume approval distinct from any budget or permission change; never let an agent or rule edit policy to remove its own human gates

Sources: `spec/engine-v1/HOST-CONTRACTS.md` "HC-04 — Approval policy and decision store"

### HC-05

Commit workflow, ledger, queue, timer, handoff, audit, dedup and outbox writes atomically; retry only known-uncommitted transactions; never expose raw database access to workers; never weaken durability settings

Sources: `spec/engine-v1/HOST-CONTRACTS.md` "HC-05 — Transactional repository"; `spec/engine-v1/WIRE.md` "Host adapter ABI and worker rules"

### HC-06

Provide trusted wall time, monotonic time, boot identity and anomaly state; persist UTC due times and occurrence keys atomically; bound catch-up; hold dispatch on clock anomaly; never freeze deadlines during pause; advertise cron or time zones only as a separate tested capability

Sources: `spec/engine-v1/HOST-CONTRACTS.md` "HC-06 — Clock and schedule provider"

### HC-07

Declare worker capabilities and interruption mode; keep prepare side-effect free; execute only under an unexpired dispatch bound to worker and epoch; treat stop acknowledgement as verified cessation; classify outcomes truthfully: UNKNOWN whenever authoritative evidence cannot establish whether the action applied, FAILED for a nonzero exit only when the adapter can attribute it to the command's own normal completion, and no reported outcome rewritten; fence stale workers. M10: build the attempt environment from nothing; classify authentication failures and model unavailability without changing the true outcome

Sources: `spec/engine-v1/HOST-CONTRACTS.md` "HC-07 — Worker/task adapter"; `spec/engine-v1/AGENT-BINDING.md` "Attempt environment rule"

### HC-08

Stage, verify, publish and resolve immutable artifacts; announce only after durable publication; hold on missing or changed bytes; let live references override age-based cleanup

Sources: `spec/engine-v1/HOST-CONTRACTS.md` "HC-08 — Artifact provider"

### HC-09

Resolve authorized secret references; deliver per attempt; keep secrets out of arguments, logs, handoffs, database state and backups; reconnect without widening grants; distinguish `CREDENTIAL_REQUIRED` before dispatch from uncertain effects after. M10: scope markings, delivery forms, acquire before commit, release and revoke outcomes, redaction, the secret-manager command provider; no provider reads the host environment

Sources: `spec/engine-v1/HOST-CONTRACTS.md` "HC-09 — Credential provider"; `spec/engine-v1/AGENT-BINDING.md` "Delivered credentials"; `spec/engine-v1/AGENT-BINDING.md` "Credential providers"

### HC-10

Provision isolated task directories per attempt; scope paths so traversal and symlinks cannot escape; verify checkpoint bytes before reporting resumable; never present process separation as a sandbox; rely on a declared containment adapter

Sources: `spec/engine-v1/HOST-CONTRACTS.md` "HC-10 — Workspace/checkpoint provider"

### HC-11

Produce consistent backups with artifact inventory and integrity evidence; restore without dispatch until reconciliation succeeds; never reissue restored dispatch blindly; evaluate retention against live references; redact events before persistence and export; never replay work on export retry

Sources: `spec/engine-v1/HOST-CONTRACTS.md` "HC-11 — Backup, retention and event export"

### HC-12

Expose the same governed commands on CLI and web, including holds, resource-change requests and credential reconnection; show exact scope and material on confirmation; repeat every check on the server; never label a canceled work order successful. M10: one read model per surface rendered by both

Sources: `spec/engine-v1/HOST-CONTRACTS.md` "HC-12 — CLI/web command parity"

### HO-13

Enforce authority at a trusted dispatch boundary outside generated instructions, with no bypass through a shell, browser or sub-agent; block dispatch when a mandatory policy check is unavailable or INDETERMINATE

Sources: `STANDARD.md` "8 Authority, delegation, and enforcement" (AU-02, AU-08)

### HO-14

Supply effect adapters with a declared operation contract (idempotency key scope, read-only reconciliation, cancellation semantics) that report outcomes truthfully

Sources: `STANDARD.md` "10 Effects, attempts, retries, and compensation" (E-01, E-04); `spec/engine-v1/HOST-CONTRACTS.md` "HC-07 — Worker/task adapter"

### HO-15

Collect evidence and run the assessment the criteria require; keep the assessor independent of the producing agent where required

Sources: `STANDARD.md` "13 Evidence and verified outcomes" (V-01, V-02)

### HO-16

Authenticate event and trigger sources, deduplicate durably, reject conflicting duplicates, bound causal depth

Sources: `STANDARD.md` "18 Trigger admission and event handling" (TR-02, TR-03, TR-05)

### HO-17

Supply the nested limits ledger with a human-approved initial configuration and its approval evidence, one fixed integer cost unit, one ledger per work-order tree, and route every relevant admission and dispatch through it

Sources: `spec/limits-v1/CONTRACT.md` "Accounting domain and identity"; `spec/limits-v1/CONTRACT.md` "Authority and exhaustion"; `spec/limits-v1/CONTRACT.md` "Migration and limits"

### HO-18

Export telemetry through an allowlist with secrets and payloads excluded, deliver outside the authoritative commit, and never report exporter failure as a workflow outcome

Sources: `STANDARD.md` "14 Execution records and observability" (O-08, O-09)

### HO-19

Give every unresolved material effect a durable owner, affected scope, evidence and allowed next decisions; never let a text summary clear a blocker; record who resolved which blocker on what basis

Sources: `spec/engine-v1/RECOVERY.md` "Recovery owner and interface contract"

### HO-20

Resolve protocol endpoint and credential material at invocation time, scoped to the remote capability, and fail closed when credentials, identity or protocol version cannot be established

Sources: `spec/engine-v1/PROTOCOL-BINDINGS.md` "10. Credential and endpoint handling"

### HO-21

Authenticate, route and authorize inbound protocol work before admission, and map remote identity to fresh local identity

Sources: `spec/engine-v1/PROTOCOL-BINDINGS.md` "8.2 A2A"

### HO-22

Run agent setup under the `agent-setup` permission: create one host-owned login directory per subscription agent outside workspace and artifact roots, exclude it from ordinary backups, retire it only when no running or UNKNOWN attempt holds it

Sources: `spec/engine-v1/AGENT-BINDING.md` "Agent setup"; `spec/engine-v1/AGENT-BINDING.md` "Login custody"

### HO-23

Keep the agent catalog and model register as host data written only by authenticated command from a human holding `model-register`; keep tool auto-update off for bound agents

Sources: `spec/engine-v1/AGENT-BINDING.md` "Agent catalog"; `spec/engine-v1/AGENT-BINDING.md` "Who writes the register"; `spec/engine-v1/AGENT-BINDING.md` "Model-relevant configuration projection"

### HO-24

Deliver approval and hold notifications to accountable humans, with escalation; treat delivery as an integration that never grants or resumes anything

Sources: `spec/handoff-v1/CONTRACT.md` "6. Holds, limits and human intervention" (HS-07); `STANDARD.md` "9 Human approvals and resource limits" (H-03); `STANDARD.md` "14 Execution records and observability" (O-07)

### HO-25

Apply each task's declared interruption policy: request stop where supported, otherwise observe to a truthful terminal outcome, and keep running effects charged

Sources: `spec/limits-v1/CONTRACT.md` "Authority and exhaustion"; `spec/engine-v1/HOST-CONTRACTS.md` "HC-07 — Worker/task adapter"
