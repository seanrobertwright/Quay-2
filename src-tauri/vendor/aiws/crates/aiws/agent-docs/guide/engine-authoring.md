# Guided coding workflow authoring

> **Praxis naming:** This page documents **Praxis**, the AIWS workflow engine. Existing `engine/*` source paths, `/engine/...` routes, `aiws-engine/*` protocol identifiers, and existing script names remain unchanged for compatibility.

S2 helps you turn commands, expected output files and acceptance criteria into the coding plan AIWS already runs. It asks for the required fields, explains errors and shows the execution sequence. It uses [S1 readiness](./engine-readiness.md) to identify missing tools and unsupported requirements.

Authoring is read-only. It does not execute your commands, install tools, create a run or approve work. A successful preview means the plan is structurally valid and its requirements are supported by the observed environment. It does not prove that the commands will produce correct results.

## Start with the questionnaire

From the current GitHub source checkout, using Node 24:

```sh
npm run engine:author -- --interactive
```

The questionnaire asks for the work order and run identities, intended result, implementation/validation/correction commands, output files, acceptance criteria reference and resource limits. Correction approval defaults to `true` if you press Enter. Other answers must be supplied explicitly. Invalid answers produce a field-specific explanation and the same question is asked again.

Commands are **JSON argument arrays**. The first item identifies the executable; subsequent items are its arguments. The author does not split a shell string, run a shell for you, add commands or silently change your limits.

```json
["/absolute/path/to/node", "-e", "require('node:fs').writeFileSync('result.txt','ready')"]
```

Use the actual Node executable path printed by `node -p process.execPath`; on Windows, escape backslashes inside JSON. The built-in inspector recognizes that exact executable as the verified `node` capability. A bare `node` or another command needs a trusted host inspector that verifies the corresponding `command:<executable>` capability. There is no automatic PATH substitution.

Output paths use forward slashes and are relative to the run workspace, for example `["result.txt"]`. Acceptance criteria are a reference to what a human will use to judge the result. Validation must exit zero and preserve the delivered output files to support acceptance.

A plan document may also declare the run's cost not applicable, with its justification, as `"exposure": {"kind": "NOT_APPLICABLE", "justification": "..."}`. The questionnaire does not ask for it. The preview refuses it with `COST_NOT_APPLICABLE_REFUSED` unless the observed agent has an empty model set; the built-in local agent has one.

## Inspect an existing draft

```sh
npm run engine:author -- --input plan.json
node engine/src/authoring-cli.ts --stdin < plan.json
```

Use the direct Node command when another program needs clean JSON stdout; npm may print its own script banner. Questionnaire prompts go to stderr. The CLI does not overwrite input files. To save a new preview without overwriting an existing file, choose a new filename:

```sh
node engine/src/authoring-cli.ts --input plan.json > plan-preview.json
```

The CLI exits **0** only for a valid plan with READY capability inspection and a review digest. Invalid plans, blocked requirements, inspection failures and malformed input exit **1**. Read the report for the explanation.

| Output | Meaning |
|---|---|
| `valid` | Whether the draft satisfies authoring and existing coding-plan validation |
| `plan` | Exact validated plan; no command or budget substitutions |
| `diagnostics` | Field, code, severity and suggested correction; warnings leave your settings unchanged |
| `steps` | Existing execution stages, possible preceding stages (`afterAny`) and conditions |
| `readiness` | S1 report explaining declared/verified capabilities and gaps |
| `binding` | Current capability digest and effective requirements to pin when creating a run |
| `reviewDigest` | Digest identifying the exact plan and capability binding; null if unavailable |
| `authorized` | Always `false`; authoring cannot grant authority |

`afterAny` describes possible transitions in the existing state machine. It is not a custom dependency graph or an instruction to wait for every listed predecessor. Successful implementation leads to validation. Failed validation can enter a correction cycle, followed by validation again. Implementation or correction failures stop for inspection. Successful validation still needs separate human acceptance.

## Include additional capability requirements

Supply an existing S1 requirements document:

```sh
node engine/src/authoring-cli.ts --input plan.json --requirements requirements.json
```

For example, a requirements document requesting verified `ISOLATION / network-deny` will be blocked by the built-in local worker because it has no network isolation. Minimum command, file-artifact and fresh-context requirements are always retained and verified; an empty custom list cannot weaken them. Use the same requirements with the runner preview and creation calls.

The standalone CLI observes its own local runtime. A deployment host can inspect its installed environment through `runner.previewAuthoring`. If that environment differs, the host preview must be reviewed again.

## Create the exact reviewed plan

The TypeScript engine exposes the authoring API. This slice does not add a new workflow execution format or claim a new native SDK authoring codec. Python, Rust and other callers can generate the existing plan JSON and inspect it with the CLI; S1 native readiness evaluators remain available separately.

In a host with an already opened `CodingWorkflowRunner`:

```ts
const preview = await runner.previewAuthoring(draft, requirements);
// Present plan, diagnostics, steps, readiness and reviewDigest for review.
if (!preview.valid || preview.readiness?.status !== 'READY' || !preview.reviewDigest) {
  throw new Error('Resolve the preview findings before creating this run.');
}

// Call only after the exact preview has been reviewed.
const created = await runner.createAuthored(draft, preview.reviewDigest, requirements);
// created.state.status is AWAITING_APPROVAL.
// Use existing authenticated runner.approve(...) before execution,
// and runner.accept(...) after successful validation.
```

The review digest includes all plan fields and the effective capability binding. It excludes observation timestamps so a refreshed, unchanged observation does not require a different digest. Creation performs fresh host inspection: changed commands, paths, identities, limits, correction approval policy, requirements or manifest produce `STALE_AUTHORING_REVIEW`. Expired or unsupported observations produce `READINESS_BLOCKED` even if the digest is unchanged.

The digest is an exact-match check, not a credential or proof of human identity. The existing authentication adapter and human approval remain authoritative. Created runs retain S1's immutable pins and final dispatch/delivery checks.

## Edit and review again

Edit a draft, preview again and review the new result before creating it. Calling `createAuthored` with an existing work order does not replace that run. For a running workflow, use the existing governed M7 revision proposal and approval mechanism where supported; authoring is for new coding runs. S1 capability bindings cannot be rebound in place.

Arbitrary branches, parallel tasks, custom nodes/edges/dependencies, triggers and embedded approvals are explicitly refused by this author. A plan may name one catalog agent for every node in its `agent` field, and a model-using agent's cost figures in `exposure` and `maxTotalCost`; with `--interactive --agents AGENT_PICKER.json` the questionnaire asks for the agent after the limits, and for those figures once such an agent is picked (see [agent selection](https://github.com/seanrobertwright/AI-WS-SDK/blob/main/docs/M10-AGENT-SELECTION.md)). Additional properties are errors. The supported built-in validation/correction loop remains available.

The author requires at least two attempts because implementation and validation each consume an attempt. Each complete correction cycle needs two more. It warns if your limit cannot cover every configured cycle, if the total time is smaller than a task reservation, or if you permit corrections without renewed approval. It does not increase budgets or change policy. The correction command remains required by the existing contract even when `maxCorrections` is zero; it will not run in that case.

Input is bounded to 1 MiB with duplicate-key, unsafe-number and malformed-Unicode rejection. Authoring also bounds field sizes and collections. It is not a command security audit or an OS sandbox.

## Write a workflow template

A workflow template is a reviewed coding plan without work-order or run identities, which a host publishes in its workflow catalog and the [`praxis` CLI](/engine-praxis-cli/) runs. `--template NAME` authors one, with `--interactive`, `--stdin` or `--input FILE`, and optionally `--requirements FILE`:

```sh
npm run engine:author -- --template greeting --interactive
node engine/src/authoring-cli.ts --template greeting --input plan.json > greeting.json
```

- NAME is a lowercase letter followed by at most 62 lowercase letters, digits and hyphens, and is not a Windows reserved device name such as `con` or `com1`. A name breaking that rule is refused.
- Input carrying `workOrderId` or `runId` is refused: the host gives each run fresh identities. The questionnaire does not ask for them.
- The author reviews the result with the host's own startup review. When that accepts it, the bare template goes to standard output and the exit code is 0. The offline preview goes to standard error either way. It has no review digest, because the template review digest names the revision the host assigns.

Save the template as `NAME.json` in the host's template directory (the `templateDirectory` host option) and restart the host, which reads templates only at startup. Only the host's own checks can still refuse a printed template, such as fresh readiness that is not READY or an agent the host does not offer. `praxis` has no authoring verb: a client never writes the host's private configuration.

## Run the complete example

```sh
npm run example:engine:authoring
```

The example uses real local runtime inspection and commands in a temporary workspace, with explicitly simulated human identity. It rejects an edited draft using an old review digest, creates the original plan awaiting approval, implements, validates and separately accepts the output. The temporary workspace is cleaned up afterward. These demo credentials are not production authentication.

S2 is implemented for this local source profile. [S3 handoff diagnostics](./engine-handoff-diagnostics.md) now expose input/output expectations and current material checks. External-provider, platform, browser and release qualification remain separate work.
