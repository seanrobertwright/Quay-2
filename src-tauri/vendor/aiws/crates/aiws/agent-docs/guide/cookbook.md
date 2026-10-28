# Examples and application recipes

Every recipe below has a complete TypeScript, Rust and Python program in the source archive. The concept pages show synchronized language tabs; the offline handbook includes all three versions. Examples marked trusted simulation exercise SDK semantics without external effects. The coordinator, persistence, handoff and exporter recipes use local adapters or databases and explicitly label their remaining application boundaries.

Run every recipe, in all three languages, from the source root after installing/building the libraries:

```bash
node scripts/check-guide-examples.mjs
```

Set AIWS_PYTHON or AIWS_CARGO if those executables have nonstandard paths. The runner stops at the first failed assertion and reports the failing language and recipe. Rust programs are compiled before execution.

## Select a recipe

| Recipe ID | Integration lesson | Start here |
| first-run | Execution, verification and acceptance | [Source and examples](./quickstart.md) |
| grant-scope | Reject an expanded child grant | [Source and examples](./quickstart.md) |
| approval | Bind approval to action material and use count | [Source and examples](./quickstart.md) |
| retry | Retry confirmed nonapplication and handle duplicate results | [Source and examples](./quickstart.md) |
| budget | Reject reservations beyond the shared allowance | [Source and examples](./quickstart.md) |
| waits | Correlated waits and an ALL join | [Source and examples](./quickstart.md) |
| trigger | Preserve event identity and reject changed duplicates | [Source and examples](./quickstart.md) |
| condition | Edge-triggered conditions and reset samples | [Source and examples](./quickstart.md) |
| external-response | Satisfy one wait with a correlated event | [Source and examples](./quickstart.md) |
| graph | Bind execution to a ready graph node | [Source and examples](./quickstart.md) |
| branching | Choose a branch and complete an ANY join | [Source and examples](./quickstart.md) |
| loop | Bound loop iterations and preserve the terminal outcome | [Source and examples](./quickstart.md) |
| node-schema | Validate task input before dispatch | [Source and examples](./quickstart.md) |
| subworkflow | Require accepted child work | [Source and examples](./quickstart.md) |
| compensation | Record reconciliation and a separate compensating effect | [Source and examples](./quickstart.md) |
| plan | Activate a new plan identity using an expected revision | [Source and examples](./quickstart.md) |
| invalidation | Invalidate verification and dependent acceptance | [Source and examples](./quickstart.md) |
| schedule | Advance a scheduled trigger cursor atomically | [Source and examples](./quickstart.md) |
| strict-json | Parse untrusted JSON and canonicalize action material | [Source and examples](./quickstart.md) |
| storage | Commit, reopen and verify an audit bundle | [Source and examples](./quickstart.md) |
| observability | Inspect telemetry without contacting a collector | [Source and examples](./quickstart.md) |
| coordinator | Execute an adapter through the trusted coordinator | [Source and examples](./quickstart.md) |
| handoff | Build a human-readable handoff from a verified audit snapshot | [Source and examples](./quickstart.md) |
| authorization | Deny agent attempts to issue new grants | [Source and examples](./quickstart.md) |
| exporter | Retry a telemetry delivery without re-running workflow work | [Source and examples](./quickstart.md) |
| corrective-action | Run the Annex B corrective action through a reference host | [Reference host](./reference-host.md) |

## Assemble a coding workflow

Start with the coordinator tutorial, then add authenticated approval, a grant constrained to the intended checkout and an adapter with a bounded operation. Attach a graph before admitting graph-bound work. Record the actual test command, source revision, artifact digest and observed validation result. Require the configured acceptance decision for the current deliverable. For failed validation, use a bounded corrective path and invalidate assessments whose subject changed.

Use the handoff recipe to produce a deterministic operator report from one audit snapshot. The proposed engine protocol extends that report with durable artifact delivery and acknowledgements; the current recipe does not provide that transport.

## Adapt to document review

The [reference host](./reference-host.md) is a worked document-review host: a corrective-action package whose drafted content and record revisions are content-addressed artifacts, an approval bound to their exact digests, and verification and acceptance against that evidence. Start from it.

Treat the reviewed document version as immutable material. Bind approval and acceptance to that version, record comments as artifacts, and require explicit disposition for unresolved review findings. A revised document can invalidate previous acceptance. An external reviewer response should enter through an authenticated correlated wait/trigger path, not through a forged actor field.

## Adapt to scheduled work

The `schedule` recipe in [scheduling](./scheduling.md) shows a fixed-interval trigger cursor advancing atomically. Start from it.

Use fixed-interval trigger ticks only when their UTC cadence and catch-up behavior match the requirement. A calendar schedule with timezone/DST rules needs a host scheduler. Preserve event identity across retries, limit catch-up and concurrency, and hold external outcomes that cannot be determined after an interruption. See scheduling for why SKIP is sensitive to exact slot timing.

## Adapt to a human approval queue

The [reference host](./reference-host.md) runs an approval queue end to end: each human step in a run's graph opens a durable wait routed to one principal, the inbox is answered by that principal, and the run resumes through a `join`. Its inbox is simulated and marked for replacement before deployment.

Create a durable authorization wait and route its identity to an authenticated application inbox. A notification is an application effect with its own delivery behavior. When the response arrives, verify the principal, correlation, expiry and scope; recording wait satisfaction alone is not a new approval for arbitrary actions. Reevaluate authorization when execution resumes.

Each adaptation needs application integration tests for its real external system. The runnable recipes establish local SDK behavior and API usage; they do not substitute for those tests.
