# Protocol operations and recovery runbook

> **Praxis naming:** This page documents **Praxis**, the AIWS workflow engine. Protocol adapters provide connectivity; AIWS/Praxis remains authoritative for identity, admission, budgets, approval, verification, acceptance and recovery.

This runbook is for operators and host implementers using the M9 source profile. It assumes the exact compatibility versions listed in M9 completion and compatibility (not in this pack). It does **not** convert an M9 protocol pass into an M8 production/platform qualification claim.

## Normal operating sequence

Before any external effect:

1. Resolve the current Praxis work order, run, task and attempt.
2. Resolve the installed binding ID and exact binding revision from the durable `ProtocolRegistry`.
3. Confirm protocol/version and endpoint identity match the reviewed binding.
4. Re-observe the selected capability material where the adapter requires it and compare the current capability digest with the reviewed digest.
5. Re-check current authority, policy, applicable human approval, budget/limits and assignment/handoff state.
6. Resolve host-owned credentials outside durable workflow material.
7. Dispatch the already-admitted `AdmittedProtocolOperation`.
8. Persist remote identity/operation/task mapping before returning a task-backed receipt.
9. Treat all remote messages, task states, artifacts and UI events as evidence.
10. Reconcile ambiguous effects before retrying.
11. Run independent verification and the applicable acceptance decision after the effect is known.

Praxis protocol architecture (not in this pack)

## Version or capability drift

**Signals:** `MCP_PROTOCOL_VERSION_MISMATCH`, `A2A_PROTOCOL_VERSION_MISMATCH`, interface mismatch, capability digest change, missing reviewed capability, changed Agent Card, changed endpoint identity.

**Procedure:**

1. Stop before remote dispatch. Do not silently migrate an in-flight operation.
2. Preserve the old binding revision and any active operation mapping.
3. Discover the new protocol/capability material as a new candidate binding revision.
4. Re-run readiness/review for the changed capability material.
5. Obtain any required fresh approval.
6. Admit new work only after the new binding revision is selected explicitly.
7. If an old remote operation is still active, keep it under its old binding revision until reconciled or explicitly fenced.

## Response loss or remote endpoint outage

**Signals:** timeout after possible dispatch, socket loss, remote 5xx/unavailability, missing response after a request may have taken effect.

**Procedure:**

1. Record/retain the outcome as `UNKNOWN`; do not translate transport failure into rejection or success.
2. Keep the original operation/attempt responsibility and budget exposure.
3. Do not create a new request ID merely because the response was lost.
4. Use the protocol-specific recovery path:
   - MCP Tasks: durable task ID/reference → `tasks/get`/resume.
   - A2A: durable remote task/context → get/resubscribe.
   - synchronous MCP: target-specific read-back when available.
   - Praxis control command: durable `commandResult` lookup using the same request identity.
5. If target truth cannot be established, remain held for human intervention.

UNKNOWN and recovery lifecycle (not in this pack)

## Cancellation ambiguity

Cancellation is cooperative for MCP/A2A external work.

1. Send cancellation only for the exact bound remote operation/task.
2. Persist the cancellation receipt/evidence.
3. A remote `canceled` result does not prove the underlying business effect rolled back.
4. If the effect can still have occurred, keep reconciliation `UNKNOWN`.
5. Release responsibility only after target-specific evidence confirms the effect state.

AG-UI `status: "cancelled"` is different: it means the human dismissed/cancelled the UI interrupt. M9.7 treats that resume entry as a non-authoritative no-op; it does not mutate Praxis work.

## Restart before or after dispatch

On process restart:

1. Reopen Praxis durable state and acquire the new engine epoch.
2. Reopen the M9.8 `ProtocolRegistry`.
3. Reopen protocol-specific stores (`McpTaskStore`, `A2ATaskStore`, `A2AInboundStore`) where applicable.
4. Recover active operations by **local operation identity**, then compare their saved binding revision, endpoint, protocol version, capability digest and remote identity.
5. Refuse silent ownership transfer if any pinned material changed.
6. Resume polling/subscription only for the saved remote identity.
7. If dispatch was authorized but external truth is uncertain, enter/retain the existing reconciliation hold instead of treating the work as pre-dispatch.

## Stale remote result after reassignment

A late result from a superseded agent, endpoint or operation must not settle current work.

1. Put the affected responsibility into the existing replacement/reconciliation hold when required.
2. Mark the cross-protocol registry operation `SUPERSEDED` when responsibility has changed.
3. Reject later observations against the fenced registry operation.
4. Preserve late evidence for audit/reconciliation; do not discard it.
5. Never copy its result into the replacement attempt merely because the payload looks successful.
6. Verification must reference the current assignment/attempt and current artifact material.

Durable protocol identity and evidence (not in this pack)

## Credential revocation or authentication failure

1. Fail closed. Do not fall back to a weaker credential or anonymous mode.
2. Keep credentials out of plans, registry rows, evidence summaries, telemetry and AG-UI events.
3. Reauthenticate through the configured host/provider flow.
4. Re-check authorization after reauthentication.
5. If the external request may already have been sent before revocation was observed, preserve `UNKNOWN` and reconcile.

For AG-UI human control, a resume payload never supplies trusted identity. `PraxisAguiControlBridge` authenticates the host credential/session again and checks current authorization before command commit.

## Malformed or untrusted protocol payload

1. Reject closed-record/schema violations at the protocol boundary.
2. Do not accept unknown fields that would change authority, approval, verification, acceptance or identity.
3. Sanitize transport exceptions before durable evidence/telemetry.
4. Treat remote `approved`, `verified`, `accepted` or similar payload values as ordinary external data.
5. Never set `ProtocolObservation.authoritative` to true.

## Artifact mismatch

When a remote result refers to or produces material that differs from the reviewed/validated artifact:

1. Do not accept the deliverable.
2. Capture the current artifact bytes/digest.
3. Invalidate stale verification/acceptance material.
4. Re-run validation/verification against the current artifact.
5. Require fresh acceptance when policy/workflow rules require it.

The static control API and AG-UI human-control bridge both fail closed when the acceptance artifact changes after the human reviewed it.

## Incident evidence checklist

Retain enough evidence to answer:

- Which Praxis work/run/task/attempt and operation were responsible?
- Which binding ID and **binding revision** were selected?
- Which exact protocol/version and endpoint identity were pinned?
- Which manifest/capability digest was reviewed?
- Which remote identity and remote operation/task were bound?
- What dispatch evidence exists?
- What observations were received, in what order?
- Did cancellation occur, and what did it actually prove?
- Was reconciliation `CONFIRMED_APPLIED`, `CONFIRMED_NOT_APPLIED` or still `UNKNOWN`?
- Which verification evidence and assessor were current?
- Which human/policy authority made the final acceptance decision?

The telemetry pipeline intentionally cannot answer every item because it exports only an allowlisted, privacy-preserving projection. Use the durable registry, protocol-specific store, workflow journal and artifact store for investigation.

## Operator quick table

| Situation | Required action | Never do |
|---|---|---|
| Version/capability drift | New reviewed binding revision | Silent upgrade |
| Response lost after possible effect | Preserve `UNKNOWN`, read back | Blind retry |
| Remote task completed | Capture as evidence, verify independently | Mark accepted |
| Cancellation acknowledged | Reconcile actual effect | Assume rollback |
| Endpoint/agent changed after restart | Fence old mapping | Rebind silently |
| Credential revoked | Reauthenticate + authorize | Fall back to weaker auth |
| AG-UI resume arrives | Authenticate, bind current material, use control API | Treat click as approval |
| Artifact changed | Reverify and reaccept | Reuse stale acceptance |
| Late result after replacement | Preserve evidence, reject current settlement | Attach to new attempt |

For the executable evidence behind these procedures, see M9 completion and compatibility (not in this pack) and the repository `spec/engine-v1/protocol-conformance.json`.
