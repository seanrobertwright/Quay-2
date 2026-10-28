# Workflow templates and the workflow catalog

Status: source-only engine profile, Node 24 + SQLite, part of the first tier of the Praxis CLI and workflow templates work ([#148](https://github.com/seanrobertwright/AI-WS-SDK/issues/148)). Decided in [Wire contract for template runs](https://github.com/seanrobertwright/AI-WS-SDK/issues/155) and [praxis versus engine:control and engine:author](https://github.com/seanrobertwright/AI-WS-SDK/issues/157).

The catalog routes and the run list are host read models of the local profile, and the run creation messages are profile messages; none of them is a wire 1.1.0 record. Capabilities, the wire schema and the `aiws-local-coding-controls/1` profile header do not change. A later wire version could carry template runs through `createWorkOrder`; that would be a separate effort. All of them are contracted records at stability `PROVISIONAL` ([READ-MODELS.md](./READ-MODELS.md)).

Built so far: the template file, names, revisions, the template review digest, the catalog routes, `engine:author --template`, creating a run from a template, the template association, the per-template run list, the refusal of a new run while an earlier open run of the template needs a human (`WORKFLOW_RUN_HELD`, `WORKFLOW_RUN_PENDING_APPROVAL`), the host step loop, `praxis run` and `praxis runs`, `praxis follow`, `praxis status`, `praxis hold` and `praxis open`, and the web view's deep link and template display.

## The template file

A workflow template is a named, host-reviewed coding plan without work-order or run identities. Its file holds the **bare template** and nothing else, so a template file copied from a repository is exactly what the host reviews:

- the guided-authoring coding plan fields (`description`, `implementation`, `validation`, `correction`, `outputPaths`, `criteriaRef`, `maxCorrections`, `reapproveCorrections`, `maxAttempts`, `maxTaskMs`, `maxTotalActiveMs`, and optionally `exposure`, `maxTotalCost` and `agent`), with the authoring field limits;
- optionally `requirements`, readiness requirements as an `aiws-requirements/2` record ([READINESS.md](./READINESS.md)); a readiness 1.0.0 record is refused `READINESS_VERSION_RETIRED`;
- never `workOrderId` or `runId`. Either one is refused `TEMPLATE_IDENTITY`: the host gives each run fresh identities.

The host parses it with the same bounded, duplicate-key-rejecting parser as authoring input (1 MiB, strict UTF-8, safe integers). Any other field is refused as authoring refuses it (`UNKNOWN_FIELD`, or `UNSUPPORTED_FEATURE` for branches, parallel tasks, embedded approvals and the like).

## Names

A template name is a lowercase letter followed by at most 62 lowercase letters, digits and hyphens (`^[a-z][a-z0-9-]{0,62}$`), and is not a Windows reserved device name: `con`, `prn`, `aux`, `nul`, `com1` to `com9` and `lpt1` to `lpt9`. Windows opens those as the device whatever the file extension, so the rule refuses them on every platform. Near misses such as `con-x` and `com10` keep the rule.

One shared check, `engine/src/workflow-template-name.ts` `templateNameRefusal`, is applied by the host before a name is used in any path and by `engine:author --template`. It imports nothing, so the `praxis` CLI can apply the same check without importing the host's configuration.

## The template directory

The host configuration names the directory (`ControlHostOptions` `templateDirectory`). It belongs inside the host's private configuration and takes the launcher's checks: a canonical local directory with no symlink or junction on its path, owner-only, and refused when an existing directory allows broader access. A host without one does not serve the catalog.

- Every entry of the directory is a template file, and the directory holds at most 256. With more, the host does not start, and both launchers print the limit.
- A template's file is `<name>.json`. An entry with another name, one whose name breaks the name rule, and one that is not a regular file (a link, a junction or a directory) is listed `INVALID` under the name its file gives, and is never opened.
- Templates are read at startup. Editing one takes a restart.

## Startup review

At startup the host reviews each template file and assigns its revision. A template that fails is listed `INVALID` with its field-level diagnostics and is not runnable; the host starts anyway, and its launcher prints one warning per `INVALID` template naming the field and code of each error. The others are `VALID`.

Readiness is not decided at startup. The detail route inspects the template's agent again, read-only, on every request, so readiness and the template review digest are current whenever they are shown. A `VALID` template is runnable when that fresh review has no error and readiness is READY.

## Revisions

A template's revision is an integer per name, starting at 1, stored durably by the storage writer.

- The template digest is the SHA-256 of the template's RFC 8785 canonical JSON, so key order and white space are not an edit. A file whose bytes are not JSON is digested as its bytes.
- Every startup that finds a template's digest different from its latest revision's gives it the next revision. A revert to earlier content is a change too, so revisions only increase and an older revision is always a stale one.
- The (name, revision) pair is unique, by a unique index; the (name, digest) pair is not.
- A file named by the rule has a revision even when it is `INVALID`. An entry that is never opened has none (`revision: null`).
- A removed template keeps its stored revisions. The catalog stops listing it and its detail is `NOT_FOUND`. If its file returns, the numbering continues: content equal to its latest revision keeps that revision, and other content takes the next.

Revision assignment is the repository method `WorkflowTemplateRepository.assignRevisions`, the storage-worker case `workflowTemplateAssignRevisions` and the executor proxy `BoundedStorageExecutor.workflowTemplateAssignRevisions`.

## Template review digest

The SHA-256 of the RFC 8785 canonical JSON of:

```json
{"purpose": "aiws-workflow-template-review/1", "name": "...", "revision": 1, "templateDigest": "...", "plan": {}, "binding": {}}
```

`plan` is the template's identity-free plan and `binding` its readiness binding (`aiws-readiness-binding/2`: the agent id, the capability manifest digest and the requirements). It changes when the agent's manifest changes. A run's own authoring review digest cannot serve, because it covers the identities the host generates at creation. The digest proves only that a client saw a current review; a human approves later, against the run's binding review.

## Catalog routes

The list, the detail and the run list are GET routes on the control address and the browser host. Reading them needs the installation-scoped `workflow-catalog` permission. A host without a template directory answers them as it answers any route it does not serve, `422 UNSUPPORTED_CAPABILITY`.

### `GET /engine/workflow-catalog/v1`

The list (`aiws-workflow-catalog/1`, `WorkflowCatalog` in read-models.schema.json (not in this pack)). It carries no readiness, because readiness is shown only when fresh. An empty directory gives an empty list.

| Field | Value |
|---|---|
| `format` | `aiws-workflow-catalog/1` |
| `templates` | One entry per template file, in file-name order |
| `templates[].name` | The template name, or the name its file gives |
| `templates[].revision` | The current revision, or `null` for an entry never opened |
| `templates[].description` | The template's description, or `null` when it has none within the field limit |
| `templates[].validity` | `VALID` or `INVALID` |
| `templates[].diagnostics` | The startup review's diagnostics: `field`, `code`, `severity` (`ERROR` or `WARNING`) and `message` |

### `GET /engine/workflow-catalog/v1/templates/<name>`

One template's detail (`aiws-workflow-catalog/1`, `WorkflowTemplateDetail`). A name breaking the name rule is `400 INVALID_MESSAGE`; a name the catalog does not list is `404 NOT_FOUND`.

| Field | Value |
|---|---|
| `format`, `name`, `revision`, `description`, `validity` | As in the list |
| `diagnostics` | For a `VALID` template, the fresh review's diagnostics, including the host's (`AGENT_NOT_OFFERED`, `MODEL_SET_REFUSED`, `MANIFEST_REFUSED` and the like); otherwise the startup review's |
| `templateDigest` | The template digest, or `null` for a file never opened |
| `plan` | The identity-free plan, or `null` when `INVALID` |
| `requirements` | The template's readiness requirements, or `null` |
| `limits` | `maxCorrections`, `maxAttempts`, `maxTaskMs`, `maxTotalActiveMs` and `maxTotalCost` (`null` without a cost bound), or `null` when `INVALID` |
| `readiness` | Fresh readiness (`aiws-readiness/2`), or `null` when `INVALID` or when the host could not inspect the agent |
| `runnable` | `VALID`, no error in the fresh review, and readiness READY |
| `bindingReviewLines` | The binding review a run of this revision would start from, as text. It names the template and its revision instead of identities, and the scope tree says each run gets its own scope |
| `reviewDigest` | The template review digest, or `null` when `INVALID` or when no readiness binding could be made |

### `GET /engine/workflow-catalog/v1/templates/<name>/runs?limit=N`

A template's run list (`aiws-workflow-runs/1`, `WorkflowRuns`): the runs of every revision of that name, newest first by creation sequence. `limit` is an integer from 1 to 100, 20 without it, and the only query parameter; there is no continuation cursor. Anything else is `400 INVALID_MESSAGE`, as is a name breaking the name rule. A name the catalog does not list, a removed template's among them, still gives its runs, or an empty list, never `NOT_FOUND`. Each entry needs `inspect` on its work order, as the wire `list` does. The list is read through the index on (template name, creation sequence), so it never scans other templates' runs.

| Field | Value |
|---|---|
| `format` | `aiws-workflow-runs/1` |
| `template` | The template name |
| `runs` | At most `limit` runs, newest first |
| `runs[].workOrderId`, `runs[].runId` | The run's identities, which the host generated |
| `runs[].revision` | The template revision the run was created from |
| `runs[].createdAt` | When the run was created |
| `runs[].status`, `runs[].stage` | The run's coding status and stage, as a read reports them |
| `runs[].control` | The work order's control status: `RUNNING`, `PAUSED`, `CANCEL_PENDING` or `CANCELED` |
| `runs[].held` | Whether the run is `HELD` or any scope of its tree has an open dispatch hold, as for `WORKFLOW_RUN_HELD` reason `HELD` |

## Creating a run

`POST /engine/workflow-runs/v1` on the control address and the browser host. It is a profile route, not wire 1.1.0's `createWorkOrder`: the wire `ErrorResponse` codes hold none of its refusals, the wire `Capabilities` cannot advertise it, and its `contractRef` and assignment are values a client cannot know in advance. A host without a template directory answers it `422 UNSUPPORTED_CAPABILITY`.

### The request

A closed `aiws-workflow-run/1` request (`WorkflowRunRequest`). It is the one contracted record that names its format in `profile` rather than `format`, as the hold-exit request does. Duplicate keys, a missing field and any other field are `400 INVALID_MESSAGE`.

| Field | Value |
|---|---|
| `profile` | `aiws-workflow-run/1` |
| `requestId` | A lowercase UUID the client generates and keeps until it has a definite answer |
| `template` | The template name, keeping the name rule |
| `revision` | The revision the client reviewed, a JSON integer of at least 1 |
| `reviewDigest` | The template review digest from the template's detail |

### What the host does

- It authorises the request as the action `workflow-run`, with no work order and the template name in the context the identity adapter is given (`template`). A CLI session may take it.
- It looks up the request's receipt before any refusal. An exact retry is answered `REPLAYED` with the original run, even after the template's revision has changed, once the caller may `inspect` that work order. The same request id with other material is `REQUEST_ID_CONFLICT`.
- It generates the work-order and run identities (`wo-<uuid>` and `run-<uuid>`); the client never chooses them.
- It runs its inspection again and creates the run through the exact-reviewed creation path, the one `createAuthored` uses. The run is `AWAITING_APPROVAL`. The `workflow-run` permission is asked again after that review, and checked as a control lease in the write transaction.
- The run keeps `contractRef` `local-plan:<planDigest>`: its governing contract is its own plan. Its definition revision is its own, and its node assignment is made at creation, as for any local run.
- In the same storage-writer transaction as the work order, it records the run's **template association** (name, revision, template digest and the template review digest the request carried) and the request's **receipt**. The receipt is keyed by principal and `requestId`, and holds the RFC 8785 digests of the request and the result, the result, and the actor the permit names. The receipt's primary key and a lookup inside that transaction keep one request from creating two runs, even when two identical requests arrive together. Neither row is ever updated or deleted.
- The wire `commandResult` query does not see these receipts.

Creation is the repository method `CodingWorkflowRepository.createTemplateRun`, the storage-worker case `workflowRunCreate` and the executor proxy `BoundedStorageExecutor.workflowRunCreate`. The receipt lookup is `replayTemplateRun` (`workflowRunReplay`), and the run list is `templateRuns` (`workflowTemplateRuns`).

### Refusals

After the receipt lookup, in this order. Each is `409` unless stated, and each has `commitStatus: NOT_COMMITTED`.

| Order | Code | When | Extra field |
|---|---|---|---|
| 1 | `NOT_FOUND` (404) | The catalog lists no such template | |
| 2 | `WORKFLOW_TEMPLATE_INVALID` | The template failed startup review | |
| 3 | `STALE_WORKFLOW_TEMPLATE` | `revision` is not the current revision | `currentRevision` |
| 4 | `STALE_AUTHORING_REVIEW` | The host's fresh review gives another template review digest, including after the agent's manifest changed and for a digest the catalog never published | |
| 5 | `READINESS_BLOCKED` | The fresh review has an error, or fresh readiness is not READY | `reasons` |
| 6 | `WORKFLOW_RUN_HELD` or `WORKFLOW_RUN_PENDING_APPROVAL` | An earlier open run of the template needs a human first (see "The held-run refusal") | `blockingWorkOrderId`, and `reason` for `WORKFLOW_RUN_HELD` |

`INVALID_MESSAGE` (400), and the authentication and authorisation refusals (`UNAUTHENTICATED` 401, `FORBIDDEN` and `HUMAN_REQUIRED` 403), come before the receipt lookup. They therefore say nothing about an earlier send of the same request.

### The held-run refusal

A new run of a template is refused while an earlier open run of that template carries something only a human can clear, so that starting fresh work is never a way around a limit, an uncertain outcome or a missing approval. Decided in [Runs that block a new run of a template](https://github.com/seanrobertwright/AI-WS-SDK/issues/156) and [Runs whose approval expired](https://github.com/seanrobertwright/AI-WS-SDK/issues/172).

- **Open.** A run is open until it has SUCCEEDED or its cancellation is final (`CANCELED`). A closed run never blocks, whatever its stored coding status, so a run cancelled while held does not block its template for ever.
- **`WORKFLOW_RUN_HELD`, reason `HELD`,** while an open run's coding status is HELD or any scope of its tree has an open dispatch hold. Reaching a time, cost or attempt limit holds the run, so this covers limits.
- **`WORKFLOW_RUN_HELD`, reason `UNRESOLVED_RESPONSIBILITY`,** while an open run carries an UNKNOWN attempt, or, when the run's execution epoch is earlier than the host's current epoch, a `DISPATCH_AUTHORIZED` attempt with no SUCCEEDED or FAILED delivery. Restart review (`resume`) refuses on the same attempt query, so the two cannot disagree. An authorized attempt in the current epoch is running. A run that is held reports `HELD` even when it also carries unresolved responsibility, because its hold card offers the way out.
- **`WORKFLOW_RUN_PENDING_APPROVAL`** while an open run has never been approved. A run back in AWAITING_APPROVAL for a correction re-approval, or after its approval window lapsed, was approved once and does not count. Every open run of a template beyond the first therefore exists because a human approved it.
- **Precedence.** `WORKFLOW_RUN_HELD` takes precedence over `WORKFLOW_RUN_PENDING_APPROVAL`. Within a code, the oldest blocking run by creation order is named in `blockingWorkOrderId`.
- **Nothing else blocks on its own:** a run that is approved, running, paused, cancel pending, awaiting acceptance or awaiting restart review with nothing in flight. Each of these still blocks when it is held or carries unresolved responsibility.
- **Receipts first.** An exact retry is answered from its receipt before either check, so a lost response is never refused because of the run it created.

**Enforcement.** Both checks and the insert happen in the creation's one storage-writer transaction (`CodingWorkflowRepository.createTemplateRun`), not in a check made beforehand in the service. Of two concurrent requests for a template with no open run, one therefore creates a run and the other is refused `WORKFLOW_RUN_PENDING_APPROVAL`. The checks read only the template's open runs, from the table `workflow_template_open_runs` through its index on template name and creation sequence; closed runs are never scanned.

- The creation writes a run's row there beside its association.
- Triggers delete the row when the run's coding status is written SUCCEEDED or its work order control is written `CANCELED`, and mark it approved when the run's first plan approval decision is recorded.
- Because the pending-approval refusal bounds a template's open runs by human approvals, it bounds the check too.

The template association itself never changes.

### The result

A closed `aiws-workflow-run-result/1` (`WorkflowRunResult`). It carries no page address; a client builds that from the browser origin and the run's deep link.

| Field | Value |
|---|---|
| `format` | `aiws-workflow-run-result/1` |
| `requestId` | The request's id |
| `disposition` | `COMMITTED`, or `REPLAYED` for an exact retry |
| `workOrderId`, `runId` | The run's identities |
| `revision`, `status` | The work order's revision and status when the run was created |
| `template` | The template association: `name`, `revision`, `templateDigest` and `reviewDigest` |

### Errors

A closed `aiws-workflow-run-error/1` (`WorkflowRunError`) with only the fields its code carries. Any unexpected failure, including one after the run committed, is `503 STORAGE_UNAVAILABLE` with `commitStatus: UNKNOWN`; exception text never leaves the host. `code` is open: a client shows an unknown code with the `requestId` and acts on `commitStatus`.

| Field | Value |
|---|---|
| `format` | `aiws-workflow-run-error/1` |
| `requestId` | The request's id, or `null` when the body gave none the parser could read |
| `code` | The refusal code |
| `commitStatus` | `NOT_COMMITTED` or `UNKNOWN` |
| `currentRevision` | `STALE_WORKFLOW_TEMPLATE` only |
| `reasons` | `READINESS_BLOCKED` only |
| `blockingWorkOrderId` | `WORKFLOW_RUN_HELD` and `WORKFLOW_RUN_PENDING_APPROVAL` only: the earlier open run that needs a human first |
| `reason` | `WORKFLOW_RUN_HELD` only: `HELD` or `UNRESOLVED_RESPONSIBILITY` |

### The template association

A run created from a template keeps its association for good. It is in the run's inspect details (`template`, in the profile projection, not a wire reference), in the operator view (`template`, `null` for any other run) and in the run list. Editing the template changes nothing in an existing run: it keeps its pinned plan and the revision it was created from.

### `praxis run` and `praxis runs`

- `praxis run NAME [--state DIR] [--json]` reads the template's detail. It saves the creation request in the CLI profile as a **pending creation**, keyed by the template name and written atomically, and only then sends it.
  - On a timeout, a cut connection or `commitStatus: UNKNOWN`, it resends the identical request a bounded number of times, with backoff.
  - If the outcome is still unknown, it exits 1 and says so. The next `praxis run NAME` resends the pending creation unchanged, and replays the run if it was created.
- A pending creation is deleted only on a definite answer: `COMMITTED`, `REPLAYED`, or a refusal with `commitStatus: NOT_COMMITTED` that comes after the receipt lookup. A resent one that is refused as stale is dropped, and the CLI says to run the command again.
- On success it prints the run's binding review and the address of its decision page on the browser origin, `<browser origin>/#work-order=<encoded work order id>`. The work order id is in the fragment, so it never reaches the host in a request line.
- When an earlier run of the template needs a human first, it exits 7. It names that run's work order, the reason (held, an attempt whose outcome nobody has established, or never approved, with the refusal code) and the address of that run's page in the web view.
- `--json` prints the result with the decision page address as `runPageAddress`, or a refusal that exits 7 with the blocking run's address as `blockingRunAddress`.
- There is no `--request-id` flag.
- `praxis runs NAME [--limit N] [--state DIR] [--json]` prints the run list, one run per line, newest first; `--json` prints the read model.
- `praxis run NAME --follow [--timeout DURATION]` follows the run it created, or replayed, as `praxis follow` does, and exits as that does.

### `praxis follow`, `praxis status`, `praxis hold` and `praxis open`

A run is named by its work order id, as `praxis runs` lists it: a letter or digit, then letters, digits, `.`, `_`, `:` or `-`, at most 256 characters. Each command checks it before reading anything. Every one of them only reads, through the CLI session, from the run's operator view (`coding-operator-view/1`).

- `praxis status RUN [--state DIR] [--json]` prints the operator view: status, stage and execution control, the template name and revision, the milestones, the next decisions, the reason, the exposure and the evidence. While a decision is pending it prints the decision page address. A run back in AWAITING_APPROVAL after its approval window lapsed shows the reason `APPROVAL_LAPSED` and a line saying the approval lapsed before work started and must be given again. `--json` prints the read model with the page address as `runPageAddress`.
- `praxis follow RUN [--timeout DURATION] [--state DIR] [--json]` follows a run until it stops where a human or a script must look. It never decides, changes or retries anything.

  | Exit | When |
  |---|---|
  | 0 | The run SUCCEEDED: its deliverable was accepted |
  | 3 | Awaiting acceptance |
  | 4 | Held, or an attempt or hold awaits reconciliation: it prints the hold card, whose lines give the reason and every exit, or, for a hold without a card, the run's reason and the decisions pending |
  | 5 | Closed without success: the run's cancellation is final |
  | 6 | `--timeout` elapsed; praxis changed nothing |

  - It keeps waiting through the first approval, a correction re-approval, an approval that lapsed before work started, a restart review, a pause and a pending cancellation. Each time a run starts to wait for a decision it prints the decision page again; for a correction it says that the correction needs approval again, and for a lapse it prints the lapse line. A lapse has no exit code of its own.
  - It prints each stage's attempts as they start and finish: implementation, validation, correction and revalidation. The stages of a coding run run in one order, each one task, so the order of the tasks among the run's attempts names each attempt's stage. Attempts already finished when following began are left to `praxis status`.
  - It reads the operator view once a second while the run changes and backs off to once every four seconds while it does not, never more often than once a second (`followPollMs`, exported by `praxis-follow.ts`).
  - `--timeout` takes a whole number with an explicit unit, `s`, `m` or `h`, from one second to 24 hours. A number without a unit is a usage error. The timeout is checked after each read, so the command stops at most one read late.
  - Interrupting it stops only the watch: it sends nothing.
  - `--json` sends its lines to stderr and prints the operator view it stopped on, with `runPageAddress`.
- `praxis hold RUN [--state DIR] [--json]` prints why a held run is held, as `praxis follow` does at exit 4, or that the run is not held. `--json` prints the hold card read model (`aiws-hold-card/1`), or `null` when the run has none.
- `praxis open RUN [--state DIR]` checks that the host has the run, then hands the run page address to the platform opener as one argument, never through a shell: System32 `rundll32.exe url.dll,FileProtocolHandler` on Windows, `/usr/bin/open` on macOS and `xdg-open` elsewhere. When no browser starts it exits 1 and names the address.
- **Trust hint.** While `praxis follow` or `praxis status` shows a run waiting for a decision in the web view, the CLI runs the same read-only trust-store check as the host's startup output. When the user's store does not hold the host's generated certificate, it says the browser does not trust it yet and to run `praxis trust` first. Where the check reports unknown, on Linux, it says to run `praxis trust` if the browser warns. A bring-your-own certificate's trust is the operator's.
- There is no approve, accept, resume, pause, cancel or hold-exit verb. Those decisions are taken in the web view.

### The web view

- The web view takes the deep link `praxis` prints, `<browser origin>/#work-order=<encoded work order id>`. It decodes the id, checks it against the same grammar as the CLI, preselects the work order and inspects it, which only reads. A link naming no valid work order reads nothing and says so. Every decision still needs its own click and confirmation.
- The run page shows the template name and revision a run was created from, and says when a run was not created from a template.

### The host step loop

- The host's loop steps the configured plans and then the open template runs whose stored status is READY, one step at a time. A run awaiting approval is never stepped, and a run created after startup is picked up once a human approves it.
- Each tick reads a bounded page of those runs, at most `storedRunsPerTick` (exported by `control-host.ts`), in work order id order after a cursor kept from the previous tick, and starts again from the beginning once a page comes back short. A run that cannot step therefore never keeps later runs from their turn.
- The read goes through the partial index `coding_ready_runs` on the coding runs stored READY, which the query names with `INDEXED BY`, so it never walks the other work orders. It is the repository method `CodingWorkflowRepository.readyTemplateRuns`, the storage-worker case `workflowReadyRuns` and the executor proxy `BoundedStorageExecutor.workflowReadyRuns`.
- Template runs follow the existing restart rules. Opening the host advances the epoch. A run stored READY in an earlier epoch is picked up, reported `RECOVERY_REQUIRED` to the host's `onExecutionBlocked`, and shown in the operator view with `needsRestart` and `RESTART_REVIEW` pending. Nothing is stepped until a human takes the resume decision.
- The trusted host option `stepStoredRuns: false` leaves template runs to explicit steps; configured plans are stepped either way.

## Writing a template

`engine:author --template NAME`, with `--interactive`, `--stdin` or `--input FILE`, and optionally `--requirements FILE`:

- it refuses a NAME breaking the name rule, and input carrying `workOrderId` or `runId`, printing the reason;
- the questionnaire skips the two identity questions;
- it reviews the result with the host's own startup review. When that accepts it, the bare template goes to stdout, for the operator to save in the template directory as `NAME.json`, and the exit code is 0. The offline preview goes to stderr either way; it has no review digest, because the template review digest names the revision the host assigns;
- only the host's own checks can still refuse a printed template, such as fresh readiness that is not READY or an agent the host does not offer.

`praxis` has no authoring verb: a client never writes the host's private configuration.

## Conformance cases

conformance-plan.json (not in this pack) lists these cases under `workflowTemplateCases`; the engine spec check confirms that each names an engine test that exists.

| Case | Behaviour | Engine test |
|---|---|---|
| WT-01 | One name check refuses every reserved device name and accepts near misses | `workflow-templates.test.ts` `the template name rule refuses every Windows reserved device name and accepts near misses` |
| WT-02 | The list gives name, revision, description and validity; an empty directory lists none | `workflow-templates.test.ts` `the catalog lists each template with its revision, description and validity, and an empty directory lists none` |
| WT-03 | No template directory answers 422; reading needs `workflow-catalog` | `workflow-templates.test.ts` `a host without a template directory does not serve the catalog, and reading it needs the workflow-catalog permission` |
| WT-04 | The detail inspects readiness again on every request; an agent unready after startup shows the template blocked | `workflow-templates.test.ts` `the detail shows the identity-free plan, its limits, binding review lines and fresh readiness under the template review digest` |
| WT-05 | Across restarts an edit and a revert each get the next revision; a removed template keeps its revisions | `workflow-templates.test.ts` `across restarts an edit and a revert each get the next revision, and a removed template keeps its revisions` |
| WT-06 | An invalid template is listed with field-level diagnostics and does not stop the host; a reserved file name is listed INVALID | `workflow-templates.test.ts` `an invalid template is listed INVALID with field-level diagnostics and does not stop the host` |
| WT-07 | More than 256 template files fails startup naming the limit | `workflow-templates.test.ts` `more than 256 template files fails startup with a message naming the limit` |
| WT-08 | The launcher reports invalid templates and prints the limit | `workflow-templates.test.ts` `the control host launcher reports invalid templates at startup and names the limit when the directory holds too many` |
| WT-09 | `engine:author --template` refuses a name breaking the rule and input carrying an identity | `authoring.test.ts` `engine:author --template refuses a name breaking the template name rule and input carrying an identity` |
| WT-10 | `engine:author --template` skips the identity questions | `authoring.test.ts` `engine:author --template skips the identity questions` |
| WT-11 | `engine:author --template` prints the bare template to stdout and the preview to stderr | `authoring.test.ts` `engine:author --template prints the bare template to stdout and its offline preview to stderr` |
| WT-12 | A printed template is accepted VALID by the host's startup review | `workflow-templates.test.ts` `the template engine:author --template prints is accepted VALID by the host startup review` |
| WT-13 | Each catalog record validates in strict mode against its PROVISIONAL schema entry | `workflow-templates.test.ts` `every catalog record carries its format and validates in strict mode against a PROVISIONAL read-model entry` |
| WT-14 | Creation commits a run awaiting approval with host-generated identities, authorised as `workflow-run` with the template name | `workflow-runs.test.ts` `creating a run from a template commits a run awaiting approval with host-generated identities and the template association` |
| WT-15 | An exact retry replays the original run, also after a revision change and when two arrive together; other material is `REQUEST_ID_CONFLICT` | `workflow-runs.test.ts` `an exact retry replays the original run, even after the template revision changed; the same request id with other material is REQUEST_ID_CONFLICT` |
| WT-16 | Creation refuses in order, and refuses a malformed request; no refusal creates a run | `workflow-runs.test.ts` `creation refuses in order NOT_FOUND, WORKFLOW_TEMPLATE_INVALID, STALE_WORKFLOW_TEMPLATE, STALE_AUTHORING_REVIEW and READINESS_BLOCKED, and refuses a malformed request` |
| WT-17 | An unexpected failure is 503 `UNKNOWN` without exception text, and resending replays | `workflow-runs.test.ts` `an unexpected failure is 503 STORAGE_UNAVAILABLE with commitStatus UNKNOWN and no exception text, and resending the request replays the run it committed` |
| WT-18 | The run list gives every revision's runs newest first within `limit`, needs `inspect` on each, and outlives the template | `workflow-runs.test.ts` `a template run list gives the runs of every revision newest first by creation sequence, bounded by limit, each needing inspect; a removed template keeps its list` |
| WT-19 | The run list query uses the template association index | `workflow-runs.test.ts` `the run list reads the runs of one template through the template association index, never scanning other runs` |
| WT-20 | The association is in inspect details and the operator view; runs keep their pinned plan and revision across edits | `workflow-runs.test.ts` `the template association is in inspect details and the operator view, and a run keeps its pinned plan and revision across template edits` |
| WT-21 | Each creation message and run list validates in strict mode against its PROVISIONAL schema entry | `workflow-runs.test.ts` `every run creation message and run list carries its format and validates in strict mode against a PROVISIONAL read-model entry` |
| WT-22 | `praxis run` creates a run and prints its review summary and decision page address | `praxis-cli.test.ts` `praxis run creates a run awaiting approval and prints its review summary and the address of its decision page on the browser origin` |
| WT-23 | A response lost after commit: `praxis run` exits 1 with the outcome unknown, and the next one replays the same run | `praxis-cli.test.ts` `praxis run saves a pending creation before sending; with the response lost after the host commits it exits 1 saying the outcome is unknown, and the next praxis run resends it and replays the same run` |
| WT-24 | `praxis run` resends on `commitStatus: UNKNOWN` and drops a stale pending creation | `praxis-cli.test.ts` `praxis run resends a creation answered commitStatus UNKNOWN until the answer is definite, and drops a pending creation that was never created and has gone stale` |
| WT-25 | `praxis runs` lists runs within `--limit`, and `--json` prints the read model | `praxis-cli.test.ts` `praxis runs lists the runs of a template newest first, bounded by --limit, and --json prints the run list read model with the simulated flag` |
| WT-26 | Usage errors of `praxis run` and `praxis runs`; no `--request-id` flag | `praxis-cli.test.ts` `praxis run and praxis runs refuse a usage error with exit 2 before any host is read, and praxis run takes no request id` |
| WT-27 | A never-approved open run refuses a new run `WORKFLOW_RUN_PENDING_APPROVAL`, naming it; once approved it does not | `workflow-runs.test.ts` `a new run of a template is refused WORKFLOW_RUN_PENDING_APPROVAL while an earlier open run was never approved, and allowed once it is approved` |
| WT-28 | A held run refuses a new run `WORKFLOW_RUN_HELD` reason `HELD`, ahead of a never-approved run | `workflow-runs.test.ts` `a held run refuses a new run WORKFLOW_RUN_HELD with reason HELD, which takes precedence over a run never approved` |
| WT-29 | A run at its attempt limit refuses a new run `WORKFLOW_RUN_HELD`; a correction re-approval does not, and a final cancellation lifts it | `workflow-runs.test.ts` `a run awaiting a correction re-approval does not refuse a new run, one that reached its attempt limit refuses it WORKFLOW_RUN_HELD, and once cancelled it no longer does` |
| WT-30 | A run left across a restart with an authorized attempt and no delivery refuses `UNRESOLVED_RESPONSIBILITY`; running, or restarted with nothing in flight, it does not | `workflow-runs.test.ts` `a run left across a host restart with an authorized attempt and no delivery refuses a new run WORKFLOW_RUN_HELD with reason UNRESOLVED_RESPONSIBILITY; running, or restarted with nothing in flight, it does not` |
| WT-31 | Approved, paused, cancel pending, awaiting acceptance and lapsed runs refuse no new run | `workflow-runs.test.ts` `no refusal for a run that is approved, paused, cancel pending, awaiting acceptance, or back in AWAITING_APPROVAL after its approval lapsed` |
| WT-32 | An exact retry replays rather than being refused; of two concurrent creations one is refused `WORKFLOW_RUN_PENDING_APPROVAL` | `workflow-runs.test.ts` `an exact retry of a created run replays it rather than being refused for it, and of two concurrent requests for a template with no open run one creates a run and the other is refused WORKFLOW_RUN_PENDING_APPROVAL` |
| WT-33 | The refusal reads only open runs through their index; a closed run leaves them | `workflow-runs.test.ts` `the held-run refusal reads the open runs of a template through the open-run index, and a closed run leaves it` |
| WT-34 | `praxis run` exits 7 naming the blocking run, the reason and its address, in text and `--json` | `praxis-cli.test.ts` `praxis run exits 7 when an earlier run of the workflow needs a human first, naming that run, the reason and its web-view address, in text and --json` |
| WT-35 | A run created through `praxis run` after startup is stepped by the host once approved in the web view, and not before | `praxis-cli.test.ts` `a run created through praxis run after the host started is stepped by the host once approved in the web view, and not before` |
| WT-36 | The step loop's read is a bounded page of READY template runs after a cursor, through their partial index | `workflow-runs.test.ts` `the host step loop reads a bounded page of the template runs stored READY through their partial index, after a cursor, never a run awaiting approval` |
| WT-37 | After a restart stored template runs are picked up and need the resume decision; a run approved since is still stepped | `workflow-runs.test.ts` `after a host restart the step loop picks up stored template runs and reports each needs restart review, steps none of them until a human resumes it, and still steps a run approved since` |
| WT-38 | Configured plans and stored template runs are stepped one step at a time | `workflow-runs.test.ts` `the step loop steps the configured plans and the stored template runs one step at a time, each reaching its correction approval` |
| WT-39 | `praxis status` shows the operator view with its template and decision page; `--json` prints the read model | `praxis-follow.test.ts` `praxis status shows the operator view of a run waiting for approval, with its decision page, and --json prints the read model with the simulated flag` |
| WT-40 | `--follow` waits for approval, prints each stage and the decision page again for a correction re-approval, exits 3 awaiting acceptance; `praxis follow` exits 0 once accepted | `praxis-follow.test.ts` `praxis run --follow waits for approval, prints each stage and the decision page again for a correction re-approval, and exits 3 awaiting acceptance; praxis follow then exits 0 once it is accepted` |
| WT-41 | `praxis follow` exits 4 for a held run and 5 once its cancellation is final | `praxis-follow.test.ts` `praxis follow exits 4 when the run is held, printing why and the decisions pending, and 5 when it closes without success` |
| WT-42 | `praxis hold` and `praxis follow` print a hold card, whose lines give the reason and every exit; `--json` prints the card | `praxis-cli.test.ts` `a run whose operator view carries a hold card: praxis hold prints the card, whose lines give the reason and every exit, --json prints the card read model, and praxis follow exits 4 printing it` |
| WT-43 | `--timeout` exits 6 with the run unchanged; `--json` prints the operator view it stopped on | `praxis-follow.test.ts` `praxis run --follow --timeout exits 6 once the timeout elapses, with the run unchanged, and --json prints the operator view it stopped on` |
| WT-44 | `praxis hold` prints why a held run is held, or that a run is not held | `praxis-follow.test.ts` `praxis hold prints why a held run is held and the decisions pending, says a run that is not held is not, and --json prints its hold card read model or null` |
| WT-45 | A lapsed approval: `--follow` keeps waiting with the lapse line, `praxis status` shows `APPROVAL_LAPSED`, a fresh approval proceeds | `praxis-follow.test.ts` `a lapsed approval: --follow keeps waiting and prints the decision page again with the lapse line, praxis status shows APPROVAL_LAPSED with the decision page, and a fresh approval lets the run proceed` |
| WT-46 | The trust hint on `--follow` and `praxis status` while a run waits for a browser decision | `praxis-follow.test.ts` `while a run waits for a browser decision and the served leaf is not in the user trust store, --follow and praxis status say to run praxis trust; on Linux, to run it if the browser warns` |
| WT-47 | `praxis open` opens the run page through the opener once the host confirms the run | `praxis-follow.test.ts` `praxis open opens the run page on the browser origin through the platform opener, after checking the run exists, and says where to go when no browser opens` |
| WT-48 | No decision verb; usage errors of `follow`, `status`, `hold` and `open`, and `--timeout` needing a unit | `praxis-follow.test.ts` `the CLI has no approve, accept, resume, pause, cancel or hold-exit verb, and follow, status, hold and open refuse a usage error with exit 2 before any host is read` |
| WT-49 | Continuous polling during an attempt leaves its outcome unchanged (a regression guard) | `praxis-follow.test.ts` `continuous polling during an attempt leaves the run outcome unchanged (a regression guard; the proof is the clock race test at Seam 3)` |
| WT-50 | The web view inspects the work order a valid deep link names, a read only | `praxis-web-view.test.ts` `the web view takes a deep link naming a work order, validated and decoded, and inspects it: reads only, no decision without a click` |
| WT-51 | The web view reads nothing for a deep link naming no valid work order | `praxis-web-view.test.ts` `the web view refuses a deep link whose work order is not valid, and reads nothing for it` |
| WT-52 | The run page shows the template name and revision | `praxis-web-view.test.ts` `the run page shows the workflow template and revision a run was created from, and says when a run has none` |
