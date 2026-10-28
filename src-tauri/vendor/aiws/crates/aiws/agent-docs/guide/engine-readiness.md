# Agent capability and readiness checks

> **Praxis naming:** This page documents **Praxis**, the AIWS workflow engine. Existing `engine/*` source paths, `/engine/...` routes, `aiws-engine/*` protocol identifiers, and existing script names remain unchanged for compatibility.

S1 adds a readiness check to standalone AIWS. It answers **“Does this agent support what this work requires, and what is missing?”** Approval and permission checks still decide whether the work may run.

A report can say READY while execution remains AWAITING_APPROVAL. Every report explicitly contains `authorized: false`.

## What the report explains

| Result | What it means |
|---|---|
| Missing | The selected agent declares no matching capability |
| Unsupported | The implementation explicitly cannot meet the requirement |
| Unverified | Support is claimed, but independent host evidence is missing |
| Evidence expired | The capability needs verification again |
| Stale | The host observation is too old or dated in the future |
| Satisfied | The requested declaration or verification is present; approval is still required |

Requirements cover tools, outputs, context/resume support and isolation. Isolation requirements always demand verification. A caller-provided snapshot cannot prove its own claims; the execution host must obtain its observations independently.

The built-in local inspector checks the current Node executable and worker implementation without running a discovery command. It supports file artifacts, text output and fresh process context. It explicitly reports filesystem sandboxing, denied network access and provider-session resume as unsupported. Working in a directory does not establish an OS sandbox.

## Review, then pin

```typescript
// Integration fragment: runner is configured by a trusted host; plan is a CodingPlan.
const report = await runner.previewReadiness(plan, requirements);
if (report.status !== 'READY') {
  console.log(report.reasons, report.checks);
} else {
  // requirements is a readiness 2.0.0 Requirements record; new work binds under 2.0.0.
  const record = await runner.create(plan, {
    profile: 'aiws-readiness-binding/2',
    version: '2.0.0',
    manifestDigest: report.manifestDigest,
    requirements,
  });
  // record remains AWAITING_APPROVAL.
}
```

The complete runnable example is `npm run example:engine:readiness`. Its simulated human decisions are labeled; its implementation and validation commands really run in a temporary workspace.

The binding fixes the selected capabilities and requirements for the run. It participates in human approval and dispatch material, survives restart and is checked again before execution. A provider/model/tool configuration change cannot silently satisfy the old pin. If a change is detected after dispatch has already been recorded, the runner blocks delivery and retains resource responsibility for reconciliation.

S1 pins are immutable: a pin is never edited. [Agent replacement](./engine-agent-replacement.md) (M10 slice 7) gives a run a successor binding beside the old one; for any other change of capabilities, create separately reviewed new work. Existing unpinned workflows keep their existing behavior. Inspection does not automatically migrate or bind them.

## Readiness versions

Praxis reads readiness 1.0.0 and 2.0.0 and evaluates each run under the version its binding names. New bindings are 2.0.0: authoring and `runner.previewReadiness` work in 2.0.0, and `runner.create` refuses a 1.0.0 binding for new work with `READINESS_VERSION_RETIRED`. A run bound under 1.0.0 before the upgrade keeps its reviewed binding and 1.0.0 semantics until it ends. It is never converted. Its snapshots, minimum requirements, pin and reports stay 1.0.0, and the built-in inspector's 1.0.0 digest still covers the host environment, as it did when the binding was reviewed. Repeating the exact `runner.create` call for a run bound before the upgrade still succeeds, so a host restarting with its existing `readinessBindings` keeps working.

A host `capabilityInspector(agentId, version)` must return a snapshot of the version it is asked for; a snapshot of the other version blocks the run. Under 2.0.0 an agent with a non-empty model set also gets a VERIFIED `MODEL` requirement for each model confinement condition. The operator view, its CLI JSON and the web view show the version each pinned run is bound under. Agent replacement is the route from a 1.0.0 binding onto 2.0.0: the successor binds under 2.0.0, and the run's 1.0.0 binding stays as history ([agent replacement](./engine-agent-replacement.md#replace-the-agent-of-a-run-bound-under-readiness)).

## Inspect existing work

```sh
node engine/src/control-cli.ts https://127.0.0.1:7443 host-ca.pem readiness work-order-id < protected-credential.json
```

The authenticated endpoint is `GET /engine/readiness/v1/<work-order-id>`. The host must authorize the `readiness` action for that work order. The report is read-only; it does not reserve resources or approve a task. The initial HTTP route uses the existing verified human session policy.

Hosts enable pins using `readinessBindings[workOrderId]` in `startControlHost` configuration, and can supply an independent read-only `capabilityInspector(agentId, version)` for installed implementations. Supply the same bindings on restart. The runtime also adds minimum requirements from implementation, validation, applicable correction and preparation commands; an empty caller list cannot remove those checks.

## Native SDKs

| Language | Module | Main functions |
|---|---|---|
| TypeScript | `@aiws/sdk/readiness` | `evaluateReadiness`, `manifestDigest`, `decodeReadiness` |
| Python | `aiws.readiness` | `evaluate_readiness`, `manifest_digest`, `decode_readiness` |
| Rust | `aiws_sdk::readiness` | `evaluate_readiness`, `manifest_digest`, `decode_readiness` |

All three decode readiness 1.0.0 and 2.0.0, encode only 2.0.0 and evaluate only 1.0.0 (SDK 0.4.0). Praxis itself also evaluates 2.0.0. Use current GitHub source; baseline published packages do not include these additions. Fixed-input runnable examples are `examples/readiness.ts`, `examples/readiness.py` and Cargo example `readiness`, using `spec/engine-v1/readiness.example.json`. Those inputs are demonstration claims, not authenticated host evidence.

The shared corpus, `spec/engine-v1/readiness.fixtures-1.0.0.json` and `readiness.fixtures.json`, covers every 1.0.0 and 2.0.0 codec case and the 1.0.0 semantic scenarios in each language and in Praxis. The optional guarded storage component, trust model, exact expiry rules and compatibility limits are documented in `spec/engine-v1/READINESS.md` in the repository. S2 will use this foundation to improve workflow authoring; it is not implemented yet.

## Guided plan authoring

[S2 guided authoring](./engine-authoring.md) now uses these readiness reports to inspect drafts and create exact reviewed coding plans. [S3 handoff diagnostics](./engine-handoff-diagnostics.md) are implemented; [S4 governing context](./engine-context-policy.md) is implemented; S5 is next.
