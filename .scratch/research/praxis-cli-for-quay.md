# What the praxis CLI gives Quay to read the catalog and follow template runs

Research for [Quay-2 #361](https://github.com/seanrobertwright/Quay-2/issues/361), under map
[#227](https://github.com/seanrobertwright/Quay-2/issues/227). It feeds
[#362](https://github.com/seanrobertwright/Quay-2/issues/362) and
[#363](https://github.com/seanrobertwright/Quay-2/issues/363).

## Source and method

- Everything below was read from AI-WS-SDK (`seanrobertwright/AI-WS-SDK`) at `origin/main`, commit
  `8a05a867` (2026-10-28). The SDK's default branch is `main`; it has no `master`.
- Code read: `engine/src/praxis.ts`, `praxis-arguments.ts`, `praxis-client.ts`, `praxis-workflows.ts`,
  `praxis-runs.ts`, `praxis-follow.ts`, `praxis-profile.ts`, `praxis-login.ts`, `praxis-logout.ts`,
  `praxis-setup.ts`, `praxis-serve.ts`, `praxis-trust.ts`, `workflow-runs.ts`, `workflow-templates.ts`,
  `workflow-template-name.ts`, `passkey-adapter.ts`, `control-service.ts`, `control-http.ts`,
  `control-host.ts`, `control-wire.ts`, `owner-only.ts`, `engine/examples/praxis.ts`, `engine/package.json`.
- Docs read: `docs/S6-PRAXIS-CLI.md`, `src/content/docs/engine-praxis-cli.md`,
  `spec/engine-v1/WORKFLOW-TEMPLATES.md`, `spec/engine-v1/AUTHENTICATION.md`,
  `spec/engine-v1/READ-MODELS.md`, `spec/engine-v1/read-models.schema.json`, and SDK issue
  [#261](https://github.com/seanrobertwright/AI-WS-SDK/issues/261).
- Where code and docs disagree, this note follows the code and lists the disagreement in
  [Code and docs disagree](#code-and-docs-disagree).
- No Praxis host was run. Anything that only a live host would show is listed in
  [Not established from source](#not-established-from-source).

## Common ground for every command

### Invocation

- Entry point: `engine/src/praxis.ts` `runPraxis`. `engine/package.json` names `"bin": {"praxis": "src/praxis.ts"}`;
  it runs as TypeScript on Node 24 with no runtime dependency. Quay can run `node <checkout>/engine/src/praxis.ts …`.
  The entry check compares real paths, so running the linked file directly works.
- Arguments are parsed strictly by `praxis-arguments.ts` `parseArguments`: only `--name` flags the command
  declares, none twice, a value flag needs a non-empty value not starting with `--`, and exactly the named
  positionals. Any breach is `PraxisUsageError`, exit 2, before any file or host is read.
- No read command, nor `run`, reads stdin, prompts, or needs a terminal. Only `praxis trust` asks a question
  (`confirmOnStdin`, where end of stdin is "no").

### Output channels

- stdout carries the command's result only. stderr carries every other line (`PraxisOutput` `err`).
- `--json` prints the raw host read model, pretty-printed (`praxis-client.ts` `printJson`). Against a simulated host
  the CLI adds `simulatedIdentity: true` to the object and writes
  `Simulated identity: nothing decided on this host is a human decision.` to stderr (`simulatedIdentityLine`).
- **Errors are never JSON.** Every failure, `--json` or not, is one line on stderr,
  `praxis: <message>`, followed by the usage text for exit 2. The one exception is `praxis run`'s exit 7 with `--json`,
  which prints the refusal record on stdout (see [Starting a run](#2-starting-a-run)).
- The CLI adds fields to some records: `runPageAddress` (`run`, `status`, `follow`), `blockingRunAddress`
  (`run` exit 7) and `simulatedIdentity`. The schema's objects are open (`READ-MODELS.md`, "Form"), so a lenient
  reader is fine; a strict schema check of CLI output would reject them.

### Exit codes (`runPraxis` docstring, matched by the code)

| Code | Meaning |
| --- | --- |
| 0 | Read succeeded; run created (without `--follow`); followed run `SUCCEEDED`; `trust` done |
| 1 | Engine, connection or authentication error (every `PraxisFailure` that is not usage), declined trust, no browser for `open`, or an unexpected error (`praxis: an unexpected error stopped the command.`) |
| 2 | Usage error |
| 3 | Followed run awaits acceptance |
| 4 | Followed run is held |
| 5 | Followed run closed without success (cancellation final) |
| 6 | `--timeout` elapsed |
| 7 | `run` created nothing: an earlier run needs a human first |

Exit 1 covers "no host", "no login", "expired session", "unknown template" and "host refused"
alike. Quay can tell them apart only from the stderr wording, which is not a contract.

## 1. Each read command's output

### `praxis workflows list [--state DIR] [--json]`

- Route: `GET /engine/workflow-catalog/v1` (`praxis-workflows.ts` `workflowsCommand`, `catalogRead`).
- `--json`: the `WorkflowCatalog` record, `format: "aiws-workflow-catalog/1"`, stability `PROVISIONAL`:
  `{format, templates: [{name, revision, description, validity, diagnostics}]}`. Entries are in file-name order.
  `revision` is `null` for an entry the host never opened. `validity` is `VALID` or `INVALID`. **The list carries no
  `templateDigest`, no readiness and no `reviewDigest`.**
- Text: one line per template, `name  revision N  VALID  description`, plus diagnostics under an `INVALID` one
  (`renderCatalogList`). An empty catalog prints `This host's workflow catalog is empty.`
- Host with no template directory: `422 UNSUPPORTED_CAPABILITY`, so the CLI exits 1 with
  `This host offers no workflow templates: it has no workflow template directory configured.` (`noTemplates`).
  `praxis serve` without `--templates DIR` is such a host.
- A 200 whose `format` is not `aiws-workflow-catalog/1` is exit 1:
  `The host answered with something other than its workflow catalog.` The CLI checks only the `format` string.

### `praxis workflows show NAME [--state DIR] [--json]`

- `NAME` is checked by `workflow-template-name.ts` `templateNameRefusal` before anything is read:
  `^[a-z][a-z0-9-]{0,62}$`, and not `con`, `prn`, `aux`, `nul`, `com1`-`com9` or `lpt1`-`lpt9`. A breach is exit 2.
- Route: `GET /engine/workflow-catalog/v1/templates/<name>`.
- `--json`: the `WorkflowTemplateDetail` record. Its `format` is also `"aiws-workflow-catalog/1"`, the same string
  as the list, so Quay must tell list from detail by the command it ran, not by `format`. All fields are required:
  `format, name, revision, description, validity, diagnostics, templateDigest, plan, requirements, limits, readiness,
  runnable, bindingReviewLines, reviewDigest`.
  - `limits` holds `maxCorrections, maxAttempts, maxTaskMs, maxTotalActiveMs, maxTotalCost`, and is `null` when the
    template is `INVALID`.
  - `readiness` (`aiws-readiness/2`) is inspected fresh on every request (`WorkflowCatalog` detail, conformance case
    WT-04).
  - `runnable` is true when the review digest exists, readiness is `READY` and the fresh review has no `ERROR`.
- Unknown name: `404 NOT_FOUND`, so exit 1 with `This host's workflow catalog has no template named <name>.`
- Text: `Workflow template <name>, revision <n>: VALID`, the description, `Runnable: yes` or `Runnable: no, because:`
  with reasons (`notRunnableReasons`), limits, warnings and the binding review lines (`renderTemplateDetail`).

### `praxis runs NAME [--limit N] [--state DIR] [--json]`

- `--limit` must match `^[1-9][0-9]{0,2}$` and be at most 100, or it is exit 2. The host's
  `workflow-runs.ts` `runListLimit` uses 20 when the flag is absent.
- Route: `GET /engine/workflow-catalog/v1/templates/<name>/runs[?limit=N]`.
- `--json`: the `WorkflowRuns` record, `format: "aiws-workflow-runs/1"`, `PROVISIONAL`:
  `{format, template, runs: [{workOrderId, runId, revision, createdAt, status, stage, control, held}]}`.
  `control` is one of `RUNNING | PAUSED | CANCEL_PENDING | CANCELED`.
- Runs are newest first by creation sequence, across every revision of the name. **There is no continuation cursor**
  (`WORKFLOW-TEMPLATES.md`, run list). A name the catalog no longer lists still returns its runs, or an empty list,
  and never `NOT_FOUND`. Each entry needs `inspect` on its work order.
- Text: one line per run (`runLine`), or `Workflow template <name> has no runs.`
- The CLI checks `format === "aiws-workflow-runs/1"` and that `runs` is an array, or it exits 1.

### `praxis status RUN [--state DIR] [--json]`

- `RUN` is a work order id matching `praxis-client.ts` `runIdPattern`, `^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$`
  (`praxis-follow.ts` `runArgument`), or exit 2. Template runs are `wo-<uuid>`.
- Route: `GET /engine/operator-view/v1/<encoded id>` (`operatorView`). The CLI requires
  `format === "coding-operator-view/1"` and a matching `workOrderId`, or it exits 1.
- `--json`: the operator view plus `runPageAddress` (`<browserOrigin>/#work-order=<encoded id>`). While the run
  waits for a browser decision, a trust hint goes to stderr.
- Unknown run: `404 NOT_FOUND`, so exit 1 with `This host has no run with work order <id>.`
- **`coding-operator-view/1` is not a contracted read model.** It has no `$def` in `read-models.schema.json`.
  `READ-MODELS.md` says the operator view, the hold card, the attempt history and the binding review "get rows here when
  their schema entries are written". Until then they are host-internal and "may change without notice".

### `praxis follow RUN [--timeout DURATION] [--state DIR] [--json]`

- `--timeout` takes `^([1-9][0-9]{0,5})([smh])$`, from 1 s to 24 h (`parseDuration`, `maxDurationMs`). A bare number is
  exit 2.
- **How it streams.** `followRun` polls the operator view in a loop. It reads once a second while the run changes and
  backs off by doubling to once every 4 s while it does not (`followPollMs = {first: 1000, max: 4000}`).
  - It prints human lines when an attempt starts or finishes (`attemptProgress`):
    `Implementation started (attempt <id>).`,
    `Validation finished: delivery SUCCEEDED, validation <outcome>.`, and the same for correction and revalidation.
  - It also prints a line each time the run starts waiting for a decision, such as
    `Waiting for approval in the web view: <address>`, `The correction needs approval again before it runs.`,
    the lapse line, `Waiting for the restart review …`, `The run is paused …` and `Cancellation was requested …`.
- Without `--json` those lines go to stdout. **With `--json` they go to stderr, and stdout gets exactly one JSON
  object, the operator view the follow stopped on, plus `runPageAddress`, when it ends.** There is no NDJSON or
  per-event JSON stream. A client that wants structured progress must poll `praxis status RUN --json` itself.
- **How it ends** (`outcome`):

| Exit | When |
| --- | --- |
| 0 | `status === "SUCCEEDED"` |
| 3 | `AWAITING_ACCEPTANCE` |
| 4 | Held: `status === "HELD"`, a `holdCard`, or `RECONCILIATION` pending (`isHeld`) |
| 5 | `control.status === "CANCELED"` |
| 6 | `--timeout` elapsed, checked after each read, so at most one read late |
| 1 | Any read failing, for example a 401 mid-follow |

- It keeps waiting through approval, correction re-approval, a lapsed approval, a restart review, a pause and
  `CANCEL_PENDING`. Without `--timeout` it has no deadline.
- It only reads. Interrupting it sends nothing.

### `praxis hold RUN` and `praxis open RUN` (for completeness)

- `hold --json` prints the operator view's `holdCard` (`aiws-hold-card/1`, not contracted) or the literal `null`.
  The `null` carries no `simulatedIdentity`.
- `open` takes no `--json`. It checks that the run exists, then hands the address to the platform opener.

### Is SDK #261 (`--format`) still needed?

**Yes.** #261 is open and nothing of it is built:

- No `praxis` command declares a `format` flag in its `parseArguments` spec.
- The host serves one format per route. `READ-MODELS.md` says "The discovery route `GET /engine/read-models/v1` and
  `?format=` negotiation are not built yet; until they are, each route serves its one format."
- `control-http.ts` refuses any query string except `limit` on the run list. The guard is
  `if(url.search&&!(req.method==='GET'&&runList)) … INVALID_MESSAGE`, so a `?format=` sent today is a 400.

So #261 needs host work (`?format=`) as well as a CLI flag. Until then, Quay must check `format` on every record
and refuse one it does not know. Four records Quay would follow runs with are not contracted at all:
`coding-operator-view/1`, `aiws-hold-card/1`, the attempt history and the binding review.

## 2. Starting a run

`praxis run NAME [--follow [--timeout DURATION]] [--state DIR] [--json]` (`praxis-runs.ts` `runCommand`).

- **Takes:** a template name only, checked by `templateNameRefusal` (exit 2 if bad). There is no `--request-id`.
  `--timeout` without `--follow` is exit 2. It never prompts and needs no terminal.
- **What it does:**
  1. Opens the host.
  2. Looks for a pending creation for `NAME` in the CLI profile's `pendingCreations`. If one exists, it writes
     `Resending the earlier creation of a run of <name>, whose outcome was not known.` to stderr and resends it.
  3. Otherwise it reads the template detail. If `runnable !== true` it exits 1 with the reasons.
  4. It builds `{profile: "aiws-workflow-run/1", requestId: randomUUID(), template, revision, reviewDigest}` from the
     detail and saves it in the profile before sending.
  5. It POSTs `/engine/workflow-runs/v1`. While the outcome is unknown (a timeout, a cut connection, a 503 or
     `commitStatus !== "NOT_COMMITTED"`), it resends the identical request after 500, 1000 and 2000 ms
     (`resendDelaysMs`), so at most 4 sends. If the outcome is still unknown, it exits 1 and keeps the pending creation
     for the next `praxis run NAME`.
- **Success** (`200`, `aiws-workflow-run-result/1`, `disposition` `COMMITTED` or `REPLAYED`):
  - `--json` prints `{format: "aiws-workflow-run-result/1", requestId, disposition, workOrderId, runId, revision,
    status, template: {name, revision, templateDigest, reviewDigest}, runPageAddress}` and exits 0. `status` is the
    run's state at creation, normally `AWAITING_APPROVAL`.
  - Text mode prints `Created run <runId> of workflow template <name>, revision <r>: work order <wo>, <status>.`
    It then reads `GET /engine/binding-review/v1/<wo>`, prints its lines, and prints
    `Approve it in the web view: <address>`.
- **`--follow --json` hides the work order id.** With both flags, the creation result is not printed. Stdout gets
  only the final operator view when the follow ends. Quay should run `praxis run NAME --json` and then
  `praxis follow <workOrderId> --json` (or poll `status`) as separate processes.
- **Refusals:**
  - `WORKFLOW_RUN_HELD` and `WORKFLOW_RUN_PENDING_APPROVAL` are 409s with `blockingWorkOrderId`, and `reason`
    (`HELD` or `UNRESOLVED_RESPONSIBILITY`) for the held code. They give **exit 7**. Text mode names the run, the
    reason and the address. `--json` prints the `aiws-workflow-run-error/1` record plus `blockingRunAddress` on stdout.
    `WORKFLOW_RUN_HELD` takes precedence, and the oldest blocking run is named.
  - `HUMAN_REQUIRED` (403) never applies to `praxis run`. `workflow-run` is in the CLI session scope
    (`AUTHENTICATION.md`, "CLI sessions and simulated identity"; `control-service.ts` `permit`). If a host ever
    returned it, `creationRefused` would fall through to `The host refused to create the run (HUMAN_REQUIRED).`,
    exit 1, and keep the pending creation (`beforeReceipt`). Every decision verb would be refused `HUMAN_REQUIRED`
    by the host, but `praxis` has none.
  - The other refusals are all exit 1, with prose only and no JSON, even under `--json`:
    - `NOT_FOUND`
    - `WORKFLOW_TEMPLATE_INVALID`
    - `STALE_WORKFLOW_TEMPLATE` (names `currentRevision`)
    - `STALE_AUTHORING_REVIEW`
    - `READINESS_BLOCKED` (names `reasons`)
    - `UNSUPPORTED_CAPABILITY`
    - 401
    - any other code, as `The host refused to create the run (<code>).`
  - A pending creation is dropped on a definite answer: success, or a `NOT_COMMITTED` refusal that is not one of
    `UNAUTHENTICATED`, `FORBIDDEN`, `HUMAN_REQUIRED` or `UNSUPPORTED_CAPABILITY`.

## 3. Reaching the host

- **Per-user directory** (`praxis-client.ts` `praxisUserDirectory`, read from the environment at call time):
  - `%LOCALAPPDATA%\Praxis` on Windows
  - `~/Library/Application Support/Praxis` on macOS
  - `${XDG_STATE_HOME:-~/.local/state}/praxis` elsewhere

  If `LOCALAPPDATA` (or `HOME`) is missing or not absolute, the command exits 1. Quay's child process must inherit it.
- **Default installation:** `<per-user dir>/installation`, unless `--state DIR` is given (`openHost`).
  `praxis serve` uses the same root and port 8443 by default.
- **Connection descriptor:** `<state>/identity/connection.json` (`connectionDescriptorFile`), format
  `praxis-connection/1`. It must be owner-only. It holds `controlAddress` (must be `https://127.0.0.1:<port>`;
  anything else is refused before connecting), `browserOrigin` (`https://praxis-<10 chars>.localhost:<port>`), a PEM
  `certificate`, and optionally `simulatedIdentity: true`, `generatedCertificate`, `nextCertificate` and `rollover`.
- **Profile:**
  - A real host's profile is `<per-user dir>/cli/<installationId>.json` (`praxis-profile/1`).
  - A simulated host's profile is `<state>/simulated-cli/<installationId>.json` (`simulatedProfileDirectory`), and the
    CLI never uses it against a non-simulated host, nor the reverse.
  - The CLI finds the profile whose installation id maps to the descriptor's browser host (`findProfile`).
  - The profile holds `controlAddress`, `browserOrigin`, the pinned `certificate`, `accessToken`, `refreshCredential`
    and `pendingCreations`. It must match the descriptor's address and origin.
- **Pin:**
  - Each request uses TLS 1.3, carries the profile's certificate as the only CA, and checks the leaf fingerprint
    (`hostRequest`).
  - A certificate that differs from the descriptor's is accepted only through a valid signed `praxis-rollover/1`
    statement. The CLI then rewrites the profile with the new pin. Otherwise the command exits 1 with "log in again".
  - The CLI never follows a redirect.
- **What a second process under the same user shares:** everything above. That is the descriptor, the profile and
  so the bearer token, and `pendingCreations`.
  - `updateProfile` reads, edits and writes the profile through a unique temporary file and a rename
    (`owner-only.ts` `writeOwnerOnlyFile`). Each write is atomic, but there is **no lock**, so two `praxis` processes
    that write at once can lose one of the writes. That covers concurrent `run`s, or a `run` alongside a rollover
    rewrite.
  - A pending creation is keyed by template name. If Quay and a terminal both run `praxis run X` while one is pending,
    both resend the same request and get `REPLAYED`, which is safe.
- **What each command reports:**

| Situation | Exit | stderr message (after the `praxis:` prefix) |
| --- | --- | --- |
| No descriptor (host never started at this root, or a simulated host stopped and deleted its installation) | 1 | `There is no Praxis host connection descriptor at <path>. Start the host, or pass --state DIR for its installation.` |
| Descriptor present, host not running (`praxis serve` leaves `connection.json` behind on shutdown; `control-host.ts` `close` deletes nothing) | 1 | `Could not connect to the host at https://127.0.0.1:<port>; is it running?` |
| Something else on the port | 1 | `The host at <origin> did not present the certificate pinned in the CLI profile, so nothing was sent.` |
| No login | 1 | `There is no CLI session for this host in <dir>. Run praxis login --state <root>.` |
| Expired or revoked session (`401`) | 1 | `The host did not accept the CLI session (UNAUTHENTICATED). Run praxis login --state <root>.` |
| Simulated host | — | `Simulated identity: …` on stderr every time; `simulatedIdentity: true` in JSON; a 401 says `A simulated session ends when the simulated host stops; start it again.` |
| Request over 15 s | 1 | `The host at <origin> did not answer within 15 seconds.` |

- **Session lifetime on a passkey host (important).** `passkey-adapter.ts` sets `CLI_ACCESS_TOKEN_LIFETIME_MS` to
  5 minutes and `CLI_SESSION_ABSOLUTE_TIMEOUT_MS` to 8 hours. `authenticate` returns null once
  `accessTokenExpiresAt` has passed, and the host answers `UNAUTHENTICATED` 401.
  - The host has a refresh route, `POST /identity/cli/token/refresh` (`refreshCliToken`).
  - **No `praxis` command calls it.** `refreshCredential` is saved by `praxis login` and never read again.
  - So, from source, a real-host CLI session stops working about 5 minutes after `praxis login`, not 8 hours.
  - CLI sessions also live only in memory (`cliSessions` and `cliAccessTokens` are `Map`s), so a host restart ends
    them all.
  - Refresh rotates the credential, and reusing an old one revokes the session. If a later CLI refreshes, two
    processes sharing one profile could revoke each other. That is an inference from `refreshCliToken`; nothing ships
    that does it today.

## 4. Matching a local template

What a client can learn without reading the host's template directory:

- **Presence:** `workflows list --json` gives every name the host read at its last startup ("Editing one takes a
  restart"). A local file copied in after startup is not listed until the host restarts.
- **Content equality:** `workflows show NAME --json` gives `templateDigest`, the SHA-256 hex of the template's
  RFC 8785 canonical JSON (`workflow-templates.ts` `reviewWorkflowTemplate`, `control-wire.ts` `wireDigest` and
  `canonicalWire`). For a file that is not JSON, it is the SHA-256 of its bytes.
  - Quay can compute the same digest locally, so key order and whitespace do not count as a difference.
  - Quay already vendors `aiws_sdk::digest` (`src-tauri/vendor/aiws`, `core.rs` `canonical` and `digest`). It sorts
    keys by UTF-16 and writes safe integers. It returns `sha256:<hex>`, so strip the prefix before comparing.
  - That this equals the engine's digest for every template is inferred from reading both canonicalisers. No test
    proves it.
  - The list has no digest, so a full comparison costs one `show` subprocess per template. Each `show` re-inspects
    readiness on the host.
- **Revision:** the host assigns it, as an integer per name starting at 1. Every startup that sees a new digest takes
  the next revision, a revert included. A client cannot predict it, and it says nothing about local content on its
  own. `revision` is `null` for an entry the host never opened.
- **Template review digest (`reviewDigest`):** SHA-256 of the canonical
  `{purpose: "aiws-workflow-template-review/1", name, revision, templateDigest, plan, binding}`, where `binding` is
  the agent id, the capability manifest digest and the requirements (`templateReviewDigest`). It depends on the
  host's revision and agent manifest, so **a client cannot compute it locally**. It only proves that a client saw a
  current review. `praxis run` copies it from the detail.
- **Name grammar mismatch:**
  - The host and `praxis` accept only `^[a-z][a-z0-9-]{0,62}$` minus the reserved device names.
  - Quay's builder lets a definition be named with letters, digits, `.`, `_` and `-`, up to 128 characters (README,
    the builder's New dialog).
  - A Quay template named `Fix_Bug` or `fix.bug` would be listed `INVALID` on the host with `revision: null` and never
    opened. `praxis workflows show` and `praxis run` would refuse it with exit 2.
  - Quay should apply `templateNameRefusal`'s rule to `.praxis/templates/<name>.json`.

## 5. Bounds

| Bound | Value | Source |
| --- | --- | --- |
| Per-request deadline (connect to last byte) | 15 s | `praxis-client.ts` `requestTimeoutMs` |
| Response size | 1 MiB, else exit 1 | `hostRequest` `maxResponseBytes` |
| `runs` page | 1-100, default 20, newest first, **no cursor** | `runsCommand`, `workflow-runs.ts` `runListLimit` |
| Catalog size | at most 256 template files (the host will not start with more); the list is not paged | `workflow-templates.ts` `maxTemplateFiles` |
| `follow` poll | 1 s, doubling to 4 s while unchanged; one GET per poll | `followPollMs` |
| `follow --timeout` | 1 s to 24 h; without it, no deadline | `parseDuration`, `maxDurationMs` |
| `run` resends | 3 resends after 500, 1000 and 2000 ms; worst case about 4 × 15 s + 3.5 s | `resendDelaysMs` |
| CLI access token | 5 min, not refreshed by the CLI | `CLI_ACCESS_TOKEN_LIFETIME_MS` |
| CLI session | 8 h absolute; at most 16 per host (`CLI_SESSION_LIMIT_REACHED`) | `CLI_SESSION_ABSOLUTE_TIMEOUT_MS`, `MAX_CLI_SESSIONS` |
| `login` wait | host-given expiry, defaulting to 300 s; poll every 2 s | `loginCommand` |

For Quay's polling, as #228 requires:

- Use `praxis runs NAME --limit N --json` with `N` of 100 or less.
- Use `praxis status RUN --json` at no more than the follow cadence.
- Use `praxis follow --timeout`, or Quay's own kill timer.
- Expect at most 15 s per request.
- Runs beyond the newest 100 of a template cannot be listed through the CLI.

## Code and docs disagree

1. **CLI session lifetime.** `AUTHENTICATION.md` ("CLI sessions (device code flow)") says "CLI tokens rotate every
   5 minutes", and `S6-PRAXIS-CLI.md` claims "8-hour lifetime, 5-minute token rotation". The CLI never calls the
   refresh route, so in code the usable life is the 5-minute access token.
2. **Credential storage.** `AUTHENTICATION.md` ("Trust model and transport") says session and refresh secrets live
   in the OS credential store, with "never plaintext fallback", and names only the simulated profile as an exception.
   `praxis-login.ts` writes `accessToken` and `refreshCredential` in plain text into the owner-only
   `cli/<installationId>.json` for real hosts too.
3. **Ticket premise.** The ticket says the SDK's `master`; its default branch is `main`.
4. **`engine-praxis-cli.md`:**
   - It says "Every command but `open` and `trust` takes `--json`". `login`, `logout`, `setup` and `serve` also take
     none.
   - Its "Known gap" section opens by describing rollover-following, which is built.
   - `S6-PRAXIS-CLI.md` still says "Until claim B, `praxis` reaches only the simulated host", which claim B has
     superseded.
5. **`praxis-login.ts`.** It falls back to installation id `local` when the poll gives none. The host's
   `pollCliLogin` always returns one, so this is latent only.
6. **`praxis-serve.ts`.** It converts `--port` with an unchecked `Number()`. That breaks the SDK's own
   parse-at-the-boundary rule, but it does not affect a client.

## Not established from source

- **Session expiry on a real passkey host.** That a real-host session really fails about 5 minutes after login was
  not observed. No `praxis` test drives a read past token expiry, and no host was run.
- **The 401 refusal code.** The exact `code` a 401 body carries for an expired CLI token was read from
  `control-service.ts` `authenticate` (`UNAUTHENTICATED`), not seen on the wire.
- **Readiness cost.** How long `workflows show` takes. It re-inspects the agent on each call, so it may be slow, and
  each call counts toward the 15 s deadline.
- **Operator-view size.** Whether an operator view or run list for a long-lived run can exceed the 1 MiB response
  cap.
- **Digest equality.** That Quay's `aiws_sdk::digest` matches the engine's `templateDigest` for every accepted
  template, including string escaping edge cases. Both canonicalisers look equivalent for the host's safe-integer,
  strict-UTF-8 domain, but nothing tests the pair.
- **Live behaviour.** How `praxis` behaves when spawned by Tauri on Windows without a console: environment
  inheritance, `windowsHide`, the exit code delivered through the `.ts` entry. Nothing here was run.
- **Operator-view shape over time.** It is not contracted, so its fields can change on any SDK commit.
