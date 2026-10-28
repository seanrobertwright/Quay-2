# Durable dynamic workflow registry

> **Praxis naming:** This page documents **Praxis**, the AIWS workflow engine. Existing `engine/*` source paths, `/engine/...` routes, `aiws-engine/*` protocol identifiers, and existing script names remain unchanged for compatibility.

M7 Slice 2 stores definition revisions, proposals and human decisions in SQLite. **Activation advances the definition registry; it does not dispatch tasks or change an executing coding workflow.** Standalone registry heads report `execution: UNBOUND`. Slice 3 adds explicit [coding execution binding](./engine-execution-bindings.md) with `execution: CODING_V1`.

## Try the complete example

From the current repository source on Node.js 24:

```sh
npm run example:engine:dynamic-registry
npm run test:engine:m7-registry
```

`engine/examples/dynamic-registry.ts` registers a definition, submits an agent proposal, simulates an explicit human review, activates revision 2, reopens the database and retries the original command. It verifies that the retry returns the same receipt with `replayed: true`. Its temporary database is removed afterward. Fixed time, identities and material hashes are demonstration inputs, not a production identity/approval service.

## Commands and inspection

| API | Purpose |
|---|---|
| `review(epoch, command)` | Obtain exact subject material for human review; no decision is written |
| `execute({epoch,requestId,credential,command})` | Authorize and transact one command |
| `getHead({workOrderId,runId})` | Read the current registry definition/digest |
| `getProposal(ref,proposalId)` | Read proposal material and pending/activated/rejected status |
| `history(ref,after,limit)` | Read an immutable event page; default 100, maximum 1000 |

Supported command actions are `REGISTER`, `PROPOSE`, `ACTIVATE` and `REJECT`. Registration creates revision 1 for a new work order. Proposals preserve the work-order/run identity and protected policy digests. Activation requires the exact current base and next revision. Rejection stores a human decision and its reason without changing the head.

Integration fragment, assuming your host has already constructed `registry`, authenticated `session`, obtained `epoch`, and reviewed the named approval:

```ts
const command = {
  action: 'ACTIVATE' as const,
  ref: { workOrderId: 'mission', runId: 'run' },
  proposalId: 'change-1',
  approvalId: 'reviewed-change-approval',
};
const result = registry.execute({
  epoch,
  requestId: 'activate-change-1',
  credential: session,
  command,
});
// result.receipt identifies the committed revision; execution remains UNBOUND.
```

## Supply a trusted host adapter

Authority reaches the registry as data, and no host code runs inside its write transaction. Before each command, the host verifies current identity and action/scope permission, then passes `execute` a short-lived lease: principal, kind, evidence reference, session, work order, ownership epoch, authority epoch and expiry. A verified human approves through `challenge`, which issues a one-time approval bound to that session and the exact reviewed subject. Inside its transaction the registry checks the lease against its own review and looks up the approval. There is no allow-all default: a missing, malformed or mismatched lease or approval is refused.

Do not derive authorization by reading `kind: HUMAN` or approval flags from user input. Proposal attribution must match the authenticated principal. Agents can propose when permitted; this initial profile requires a verified human actor and human approval to register, activate or reject. Automatic/rule-based activation policies are not implemented here.

Approval is bound to installation, ownership and authority epochs, action, work-order/run, exact base/candidate/proposal material and rejection reason. An approval for a different proposal, installation or epoch fails. A consumed proof cannot be reused through an alias approval ID. Expired approvals or sessions fail, including expiry during the transaction.

Callbacks run synchronously under the database writer lock. Perform external sign-in and human interaction beforehand; use short local verification at the transaction boundary. The host must resolve the immutable task/policy material, verify external revocation state and maintain trusted clock observations. Raw credentials are not stored by the registry.

## What survives failure

One transaction writes the new revision, current head, human decision, consumed approval, audit event and request receipt. A process crash cannot expose only part of that activation. Two proposals can be reviewed against one base, but only one can activate; the loser stays pending for explicit rejection or replacement with a new proposal.

Retry with the same authenticated principal, request ID and command. The registry returns the original receipt without a second activation or approval consumption. A changed command under the same request ID fails. Retries still require current authorization, a current ownership epoch and a healthy clock/recovery state. An old receipt describes its original result; read the current head separately.

Old revisions, proposals, decisions and events remain immutable. History is paginated. Stored documents follow the existing bounded engine parser profile, and incomplete/future registry schemas fail without silent repair.

## Current boundaries

Registration and activation reject work orders that already have executable scheduler tasks or a composed coding workflow. They also respect paused/canceling/canceled controls. Restore and clock-uncertainty holds block commands. The registry does not clear holds, refund cost, reset attempts, invalidate assessments or settle uncertain effects.

Slice 3 now provides opt-in task/attempt/handoff/result revision binding; Slice 4 adds [executable preparation-task insertion](./engine-coding-insertion.md). Slice 5 adds [plan and dependency revisions before dispatch](./engine-coding-revisions.md). Slice 6 adds [agent replacement and handoff](./engine-agent-replacement.md); Slice 7 adds [reviewed effect reconciliation and stale-result rejection](./engine-coding-reconciliation.md). This API is TypeScript engine source only. Native SDK bindings, remote CLI/web controls and parity arrive in Slice 8. Current M7 work is available in GitHub source; baseline downloadable SDK/source bundles and live-site deployment have separate status.

The full contract is `spec/engine-v1/DYNAMIC-REGISTRY.md`, with evidence in `docs/M7-DYNAMIC-REGISTRY.md`. See the [M7 slice map](./engine-dynamic-workflows.md).
