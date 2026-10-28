# Handoff expectations and diagnostics

> **Praxis naming:** This page documents **Praxis**, the AIWS workflow engine. Existing `engine/*` source paths, `/engine/...` routes, `aiws-engine/*` protocol identifiers, and existing script names remain unchanged for compatibility.

S3 makes the existing local coding handoff contract visible. It answers **“What does this step need, which task produced it, and do the current files still match?”** It derives expectations from the reviewed plan, immutable producer manifests and current workflow state. It does not guess missing inputs or silently replace them.

A handoff report is read-only and always says `authorized: false`. READY means the inspected handoff material passes these checks. The workflow may still be awaiting human approval, held, paused or awaiting acceptance. A report cannot clear any of those conditions.

## Inspect a handoff

With an already opened TypeScript engine runner:

```ts
const report = await runner.handoff(workOrderId);
console.log(report.inputs, report.outputs, report.checks);
console.log(report.provenance);
```

The authenticated control CLI accepts the work order ID as its final argument:

```sh
node engine/src/control-cli.ts https://127.0.0.1:8443 ca.pem handoff-diagnostics WORK_ORDER_ID < protected-session.json
```

The protected input file uses the existing credential format, such as an `authorization` field containing the session token. Do not put credentials in command arguments. The underlying endpoint is `GET /engine/handoff-diagnostics/v1/{encoded-work-order-id}`. The host checks the authenticated human's `handoff-diagnostics` permission for that work order before and after inspection.

The control CLI reports transport/service errors using its existing convention. A successfully retrieved BLOCKED report is still a successful inspection request: callers must inspect `report.status`. This differs from the standalone S2 authoring CLI's readiness exit code.

## Declarative expectations

| Report field | What it declares |
|---|---|
| `inputs` with `PLAN_JSON` | The exact current plan artifact and its content digest |
| `inputs` with `FILE_MANIFEST` | Required producer/preparation manifests, file paths, byte sizes and SHA-256 digests |
| `outputs.paths` | The current command's required regular output files, from the reviewed plan or insertion task |
| `outputs.criteriaRef` | The current task's acceptance criteria reference |
| `outputs.mustPreserveInput` | Validation must use and preserve the received deliverable files |
| `provenance` | Plan digest, definition revision when bound, producer task and settled attempt when available, input digest and validation attempt reference |
| `bindingError` | Existing engine error code when a durable handoff/task fails its pinned definition check; null otherwise |
| `contextDigest` | Identity of this report's run revision, consumer, expectations and provenance |

These are explicit views of existing declarations, not a new general-purpose input schema language. The supported formats are plan JSON and regular file manifests. Arbitrary MIME types, JSON-schema validation of file contents, optional inputs and automatic format conversion are outside S3.

The report includes completed preparation outputs when the implementation consumes them. A validation step expects paths compatible with its declared outputs. A missing producer manifest cannot be interpreted as an empty successful handoff.

Future output files need not exist before their producer runs. If execution is held because required outputs were unavailable, the report identifies the missing or incompatible output paths. A file that appears later does not retroactively recreate execution evidence or satisfy acceptance.

## Read the diagnostic checks

| Status | Meaning | Next action |
|---|---|---|
| SATISFIED | Current bytes or manifest match the expectation | Continue through the existing approval and execution gates |
| MISSING | Required workspace file, stored content or handoff is absent | Inspect the named path and producer history; restore only verified original content or use governed recovery |
| CHANGED | Current bytes differ from the expected digest or size | Compare expected and observed digests; obtain a governed new result if the change is intentional |
| INCOMPATIBLE | A path is a directory/symlink, or validation paths do not match the declared input contract | Correct the producing contract or material through the supported review process |
| STALE | The report context or durable handoff no longer identifies the current consumer/input | Request a fresh report and review the current revision |
| UNAVAILABLE | Inspection could not read the material for another reason | Check host access and availability before retrying inspection |

Checks expose paths, digests and explanations, not file contents or raw filesystem error messages. `source` identifies the plan, incoming input, preparation task, handoff, context or unavailable output.

## Detect stale observations

Save the context digest if a user or application is looking at an earlier report:

```ts
const first = await runner.handoff(workOrderId);
// Later, request current inspection while retaining the original context identity.
const current = await runner.handoff(workOrderId, first.contextDigest);
if (current.status === 'BLOCKED') {
  console.log(current.checks.filter(check => check.status !== 'SATISFIED'));
}
```

Advancing a stage or changing the run revision makes the old context stale. File changes can leave the context digest unchanged because the expectation is unchanged; they are detected by reading and hashing the current bytes again. If the run changes during inspection, the returned report is BLOCKED with a request to refresh.

The context digest is neither a credential nor an approval token. Producer references identify provenance, not proof that every acceptance criterion passed. In particular, failed validation can legitimately hand the same files to a correction step. Existing M7 result binding, assessment invalidation, replacement/reconciliation and final acceptance checks remain authoritative. Historical or invalidated assessments do not become current evidence merely because their files still match a hash.

## Execution behavior

Existing early input checks remain in place. S3 checks the complete handoff before acknowledgment, then checks again after the host's final dispatch preparation and again immediately before the adapter receives the command. These checks also verify that the inspected run revision matches the pending execution.

If material changes before admission, execution is refused and the unused claim is released. If dispatch has already committed, a failed delivery check marks the attempt UNKNOWN and holds the workflow while retaining responsibility. AIWS does not treat that uncertainty as proof that an attempt was free or safe to repeat.

Inspection does not publish artifacts, rewrite files, restore content, consume handoffs or alter accounting. The authenticated HTTP request may perform the existing authentication/clock bookkeeping. Reports are point-in-time observations; the host must serialize relevant changes. This is not OS-level filesystem sealing, sandboxing or protection against a privileged process racing file operations.

## Try the local example

```sh
npm run example:engine:handoff-diagnostics
```

The example creates an S2-authored run, produces a file and inspects its handoff. It deliberately changes the file and observes BLOCKED, explicitly restores the original producer bytes, then validates and separately accepts the result. The example uses real commands and artifact inspection in a temporary workspace, with explicitly simulated human identity. Inspection itself never repairs the changed file.

S3 is implemented for the local coding source profile. This report is an engine inspection surface; no new portable native SDK handoff codec or browser view is claimed. [S4 governing context](./engine-context-policy.md) now preserves original instructions and session lineage across restart and agent changes. M6 platform/capacity/durability and M8 release/browser qualification remain separate gates.
