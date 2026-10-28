# Agent replacement and handoff

> **Praxis naming:** This page documents **Praxis**, the AIWS workflow engine. Existing `engine/*` source paths, `/engine/...` routes, `aiws-engine/*` protocol identifiers, and existing script names remain unchanged for compatibility.

M7 Slice 6 supports **human-approved replacement before dispatch or between fully settled stages** in an opt-in [bound coding workflow](./engine-execution-bindings.md). The replacement receives an immutable handoff, acknowledges it under its authenticated agent identity, and executes through a host-installed adapter. Use current GitHub source on Node.js 24; baseline SDK packages and source downloads do not contain this API.

```sh
npm run engine:typecheck
npm run test:engine:m7-replacement
npm run example:engine:replacement
```

The example uses explicitly simulated human/agent identities and capability evidence. It runs implementation with the original worker, transfers validation to the replacement, and verifies human acceptance, preserved original evidence and cumulative attempts.

## Review, acknowledge and continue

The host installs a `CodingWorkflowRunner` adapter in `agentAdapters[agentId]` with the reviewed `capabilityDigest` and `execute(request)`. The host also authorizes each caller, a verified human approves through a challenge, and the host supplies an independent `verifyReplacement(target, review)` capability check. That check runs before the command, outside any database transaction, against a fresh review. It returns a record: the target, its capability digest, an evidence reference, an expiry and the review's `subjectDigest`. The registry rechecks the record inside its write transaction. A record made against an earlier review fails with `STALE_REVISION`. Production hosts must establish these identities and proofs; the example's tokens are only local simulation.

1. Read the current bound definition and workflow state. Build a candidate with `definitionWithAgentReplacement(head.definition, {agentId, capabilityDigest})` and submit it through `PROPOSE`.
2. Present the exact `ACTIVATE_REPLACEMENT` review to the human. The command includes the proposal, expected workflow revision, replacement and approval ID. Reviewing does not itself authorize activation.
3. Execute the approved command. The engine preserves the plan, stage, inputs, old evidence and accounting; records the replacement and handoff; cancels superseded queued instances; and requires fresh stage approval.
4. Read `registry.replacementHandoff(assignmentId)` through the trusted host. The assigned agent submits `ACK_REPLACEMENT` with the exact assignment and handoff digest. A human session cannot substitute for the agent's acknowledgment.
5. Renew human stage approval and run the workflow. Dispatch requires both approvals and the exact installed adapter. After restart, use human resume and obtain an acknowledgment for the new coordinator epoch before new dispatch.

The complete runnable sequence is `engine/examples/agent-replacement.ts`. These are local TypeScript repository/runner APIs; remote CLI/web commands and native SDK parity remain Slice 8 work.

## Replace the agent of a run bound under readiness

M10 slice 7 lifts `READINESS_PINNED`: a run bound under readiness takes the same route, replacing the agent of every node, as a source-only engine profile. Run `npm run test:engine:m10-successor-rules` to see it.

- **Name the successor.** The proposal may carry `successor: {agentId, capabilityDigest}`. The same agent id with a new capability digest, a tool update for example, is a valid successor and needs the field, because the definition names agent ids only. The identical pair is restore, not replacement, and is refused with `SUCCESSOR_NOT_DISTINCT`.
- **The activation bar.** For every review, challenge and execution of `ACTIVATE_REPLACEMENT`, the runner evaluates the successor from a fresh host snapshot: READY under readiness 2.0.0 against the run's stated requirements and the runner's minimums, with the manifest digest the replacement names, through its installed adapter, and the binding-time credential checks. It also refuses an agent the catalog does not offer (`AGENT_NOT_OFFERED`), a model set the register refuses (`MODEL_SET_REFUSED`) and an exposure the successor's manifest does not admit. A failure refuses with `READINESS_BLOCKED` or `CREDENTIAL_REQUIRED`, consumes no attempt and makes no reservation. The review carries the result's `successorDigest`, so the approval names the successor's binding.
- **What activation writes.** The successor's node assignment, superseding the current one, and its readiness binding, stored one row per node assignment with the manifest it pins. The superseded ones stay as history, reachable from the handoff record. A run bound under 1.0.0 moves onto 2.0.0 this way.
- **Nothing resets.** The successor charges the same node scope. When its exposure allowance does not fit the remaining capacity, the review's `allowanceWarning` says so, activation is still allowed, and dispatch holds `COST_LIMIT_EXHAUSTED` before commit, with no attempt and no reservation, until a ledger-adjust holder takes Raise limits on the hold card.

The successor acknowledges its handoff as an agent principal, so the built-in local agent cannot be one. Naming a subset of nodes is not built.

## Replace the agent after a failed attempt

A node held after a failed attempt is replaced only after `RECONCILE_CODING`: `ACTIVATE_REPLACEMENT` on a run held for a reason that reconciliation clears is refused with `RECONCILIATION_REQUIRED` and changes nothing. M10 slice 7 adds a resumable stepper that leads the human through the sequence, as a source-only engine profile. Run `npm run test:engine:m10-replacement-stepper` to see it.

- **Start it from the hold card.** Replace the agent (`REPLACE`) is offered on a `CREDENTIAL_REQUIRED` or `MODEL_UNAVAILABLE` hold raised after an attempt, on a run bound to a workflow definition, to the run's approver. Taking it records where the stepper starts and changes nothing else.
- **One confirmation per step.** Reconcile, with the evidence reference of the host's effect proof; choose the successor from the agents the authoring picker offers; review and activate; then the successor acknowledges and the human approves the stage, in either order. `control-cli replace WORK_ORDER` and the web view's "Replace the agent" section prepare each step. The dynamic control API reviews the step, and one confirmation sends it.
- **It resumes where it stopped.** Each step's command id and time are read from that step's own record, so a closed tab, a new CLI session or a host restart resumes the stepper at the step reached. After a restart the successor acknowledges again in the new epoch.
- **The replacement review.** Before activation the stepper shows the categorised manifest diff: only the changed categories with before and after, and one line naming the unchanged ones. It also shows the requirement and figure diffs, the remaining capacity of each scope, the nodes left untouched, the account crossings after activation, and that attempts, the correction count, elapsed time and spent cost do not reset.

Replacing the agent from a hold raised before commit, or from a held result, is not built.

## What can be transferred?

| State | Behavior |
|---|---|
| Unstarted next stage, no live claim or attempt | Eligible for reviewed replacement |
| Previous stage fully settled, next stage unstarted | Eligible; prior evidence and accounting are retained |
| Active claim, acquired handoff or unresolved attempt | Replacement refused |
| Paused controls or open accounting hold | Replacement refused |
| Awaiting final acceptance or succeeded | Replacement refused |
| Target has not acknowledged | Dispatch blocked; another reviewed replacement is possible |
| Adapter missing or capability digest differs | Dispatch blocked before stage handoff acquisition |

Replacement changes the one coding agent across all graph nodes. Commands, task identities, dependencies, acceptance criteria, resource limits and correction policy stay fixed. The immutable handoff includes the exact source state, previous agent, new definition and queue supersession. Renewed human stage approval creates the next stage handoff from that reviewed transfer.

## Hold uncertain work

An exact human-approved `HOLD_REPLACEMENT` command moves the workflow to HELD and records a durable dispatch hold. It fences new delivery, acknowledgment and live result publication. The engine retains outstanding attempts and exposure: a late or disconnected worker may still have caused external effects.

A hold does not terminate the worker, undo effects, settle attempts or refund resources. Generic resume cannot release it. Slice 7 adds [explicit same-stage retry after verified effect reconciliation](./engine-coding-reconciliation.md). Stale results remain rejected; no compatibility grant is implemented. Do not treat entering a hold as successful agent transfer.

## Ownership and recovery

Worker identity includes the coordinator epoch and assignment generation. Dispatch material and result pins bind the logical agent, reviewed capability digest and exact handoff. Superseded owners cannot publish under the new assignment. Historical results keep their original ownership; completed work is not relabeled or rerun during transfer.

Activation, acknowledgment and hold receipts are durable and idempotent. Replacement commit tests cover rollback and real process termination before and after commit. Existing saved-result recovery avoids repeating committed effects under the same assignment. New execution after restart requires the current epoch acknowledgment.

Plan/dependency edits and preparation insertion after replacement are currently blocked until a combined capability-review path is defined. Repeated whole-agent replacement is supported. Concurrent heterogeneous agents, remote adapter transport, external process termination and cross-revision reuse of unsettled results remain outside this profile.

The contract is `spec/engine-v1/AGENT-REPLACEMENT.md`; verification is in `docs/M7-AGENT-REPLACEMENT.md`. M6 platform and long-duration qualification remains open independently.
