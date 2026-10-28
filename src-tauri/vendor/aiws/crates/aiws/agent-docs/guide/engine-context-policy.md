# Governing context and session lineage

> **Praxis naming:** This page documents **Praxis**, the AIWS workflow engine. Existing `engine/*` source paths, `/engine/...` routes, `aiws-engine/*` protocol identifiers, and existing script names remain unchanged for compatibility.

S4 adds an optional governing-context policy to the local coding runner. It identifies the original instructions that every execution must receive, retained evidence and an optional advisory summary. The policy is immutable once a run is created, participates in human approval and dispatch material, and survives restart and agent replacement.

The engine verifies and delivers context. It does not prove that a model understood or followed the instructions. The existing permission, approval, validation and acceptance mechanisms remain authoritative.

## Define a policy

Publish the original documents to the host-owned artifact store, then reference their exact digests. In a host with an opened runner:

```ts

const rules = await runner.artifacts.publish(
  'Preserve required approvals. Validate all declared outputs before acceptance.'
);
const evidence = await runner.artifacts.publish('Reviewed reference material.');
const policy: ContextPolicy = {
  format: 'coding-context-policy/1',
  instructions: [{ name: 'governing-rules', artifactDigest: rules }],
  retainedEvidence: [{ name: 'reference', artifactDigest: evidence }],
  summary: null,
  maxBytes: 8192,
};
const created = await runner.create(plan, undefined, policy);
// The run is still AWAITING_APPROVAL.
```

| Field | Requirement |
|---|---|
| `instructions` | 1–16 named artifact references; originals remain mandatory |
| `retainedEvidence` | 0–16 named artifact references; historical evidence is not automatically current acceptance proof |
| `summary` | Null, or an exact artifact digest plus `basedOn`, identifying every unique original instruction/evidence digest |
| `maxBytes` | Total raw document byte budget, including a configured summary; 1–32768 bytes |

Names must be nonblank, unique across instruction/evidence references and at most 128 characters. Records are closed: fields claiming permissions or authority are refused. Digests are lowercase SHA-256 strings.

A configured summary is delivered separately with `advisory: true`. It cannot replace originals, remove approval requirements or widen tool permissions. Missing originals still block execution when the summary is available. If a summary is configured, its exact bytes are also required. The engine does not silently truncate context or regenerate summaries to fit the budget.

## Include context in an authored run

S2's host API accepts the policy separately from the coding-plan JSON:

```ts
const preview = await runner.previewAuthoring(draft, requirements, policy);
// Review preview.plan, preview.contextPolicy and the readiness findings.
const created = await runner.createAuthored(
  draft, preview.reviewDigest!, requirements, policy
);
```

Changing the policy invalidates the authoring review digest. Capability readiness alone does not establish document availability: use `runner.context(workOrderId)` after creation, and the execution gates check again before delivery. The CLI questionnaire continues to author the existing coding plan; policy attachment is a host API/configuration operation.

Hosts that create plans during startup can supply `contextPolicies[workOrderId]` alongside their existing `plans` and optional `readinessBindings`. Supply the same policy on create retries; omitting or changing it cannot remove protection from an existing run.

## Inspect context without executing work

```ts
const report = await runner.context(workOrderId);
console.log(report.status, report.checks, report.lineage);
```

The report contains references and lineage, not document contents. It always has `authorized: false`.

| Status | Meaning |
|---|---|
| NOT_CONFIGURED | This run has no S4 policy; legacy behavior applies |
| READY | Required exact bytes and a current-epoch session are available |
| BLOCKED | Context is missing, changed, unreadable, over budget, or tied to an old session epoch |

READY does not approve a run, clear a hold, acknowledge a replacement or accept a deliverable. Reports also refuse to present a changing run as a stable observation.

The existing authenticated control CLI exposes the same inspection:

```sh
node engine/src/control-cli.ts https://127.0.0.1:8443 ca.pem context WORK_ORDER_ID < protected-session.json
```

The endpoint is `GET /engine/context/v1/{encoded-work-order-id}`. The host checks the authenticated human's scoped `context` permission before and after inspection. Callers must inspect `report.status`; successfully fetching a BLOCKED report is not a transport failure.

## Understand session lineage

Each context-bound run has immutable session records. They identify the work order/run, agent and assignment, policy digest, coordinator epoch, parent session and creation time.

| Kind | When it is recorded |
|---|---|
| FRESH | When the context-bound run is created |
| COLD_RESUME | After governed restart approval in a new coordinator epoch |
| REPLACED | In the existing human-approved agent replacement transaction |

Restarting the engine does not automatically approve a context session. Until governed resume occurs, context inspection is BLOCKED. Repeating resume in the same epoch does not create duplicate session records. A replaced agent still needs its existing exact handoff acknowledgment in the current epoch, as well as human approval.

COLD_RESUME means originals and retained evidence are supplied to a new execution after restart. S4 does not implement opaque provider-session resumption or assume that a previous model conversation survives. The stage handoff's task identity, plan digest, definition reference and incoming artifact digest are included in the delivery envelope; S3 independently verifies current input files.

S1's restriction remains: a capability-pinned run cannot replace its agent. S4 policies can be used on runs without an S1 capability pin when governed replacement is needed. This slice does not weaken either restriction.

## Deliver context to an agent

A context-capable host adapter receives `request.context`, a `coding-context-envelope/1` value containing the session, current handoff identity, original documents as base64 bytes, retained evidence and the separate advisory summary. It must explicitly declare `supportsContext: true`.

```ts

const adapter = {
  capabilityDigest: installedAdapterDigest,
  supportsContext: true as const,
  async execute(request) {
    const context = request.context;
    const receipt = context ? contextEnvelopeDigest(context) : undefined;
    // Deliver the original instructions/evidence and advisory summary to the
    // agent using the host integration; execute through its approved adapter.
    const evidence = await executeWithInstalledAgent(request);
    return { ...evidence, ...(receipt ? { contextDigest: receipt } : {}) };
  },
};
```

This is an integration sketch: `executeWithInstalledAgent` must actually deliver the context. Returning a digest is an adapter receipt, not proof of model comprehension or compliance. Compute the digest over the exact received envelope before asynchronous execution.

The built-in local worker supplies JSON through the child environment variable `AIWS_CONTEXT_BUNDLE`. Document bodies use base64; scripts can decode them explicitly. Its execution evidence records `contextDigest`. Both the expected receipt and the durable result remain associated with the current task and session.

## Failure and recovery behavior

Context is checked before acknowledgment, before dispatch admission and immediately before adapter execution. Missing required material blocks execution. If delivery has already committed, missing context or a wrong/missing adapter receipt retains UNKNOWN responsibility and holds the run. It cannot be interpreted as a free attempt or automatic permission to retry.

Policies and session rows have immutable database guards. Removing the policy from mutable run state cannot disable its durable binding. Unknown component versions, missing tables or missing guards are rejected on database open. The optional component is installed transactionally when a context-bound run is first created; inspecting legacy runs does not migrate them.

Policy edits require separately reviewed new work. Summaries cannot grant authority, and retaining evidence does not make invalidated assessments current. Hosts remain responsible for access controls, artifact retention and truthful adapter delivery. This local profile provides no OS isolation guarantee.

## Run the example

```sh
npm run example:engine:context
```

The example uses actual local execution and stored instruction bytes with explicitly simulated human identity. It creates an authored, context-bound run, restarts the engine, verifies that context is blocked until resume approval, and completes validation and separate acceptance. Its output shows the linked FRESH and COLD_RESUME sessions.

S4 is implemented as an optional local engine feature. It does not add a portable native SDK codec, external provider integration or browser view. S5—the operator run view—is next. M6 operational qualification and M8 release/browser gates remain open.
