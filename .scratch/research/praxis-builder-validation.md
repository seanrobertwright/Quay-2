# Research: how Quay validates Praxis definitions and stays in step with the SDK

Ticket: [#220](https://github.com/seanrobertwright/Quay-2/issues/220), on the map
[#227](https://github.com/seanrobertwright/Quay-2/issues/227) ("Praxis visual builder in Quay").

Sources are the AI-WS-SDK checkout at `main` (merge commit `9970459`), Quay at `origin/master`,
and throwaway experiments described under [Experiments](#experiments). Every claim names the file
and symbol it rests on.

## Answer in brief

- **Validation runs in Quay's Rust backend.** Quay's backend calls a vendored copy of the SDK's
  Rust crate `aiws-sdk` through one Tauri command. The frontend never runs the SDK validators. The
  TypeScript validators bundle for a browser, but Ajv compiles schemas with `Function(...)` at
  runtime. Under any CSP without `'unsafe-eval'` the module fails to load. Precompiling the schemas
  does not help, because node `inputSchema` and `outputSchema` are user data and are compiled at
  validation time.
- **Contracts, grants and triggers are checked against a scratch mission.** Their real rules are
  in the reducer and depend on a contract, so Quay checks them by running `create_mission` and
  `reduce` on a throwaway snapshot. Coding plans are the exception. Their validator lives in the
  private `@aiws/engine`, not the SDK. Quay ports `validateAuthoringField` for offline per-field
  hints and treats the host's `POST /engine/authoring-preview/v1` as the real verdict.
- **Quay pins the SDK by vendoring it at a recorded commit.** It does not use a git dependency.
  `seanrobertwright/AI-WS-SDK` is private while Quay-2 is public, the SDK has no tags, and the
  crate has no Cargo features, so `rusqlite` (bundled) and `reqwest` always come along. The SDK is
  CC0, so vendoring is legally clean. A sync script copies the crate. A cargo test runs the SDK's
  own graph vectors from `spec/fixtures.json`.
- **Quay maps errors to nodes and fields in a wrapper.** The SDK returns one bare code for the
  first failure. Quay's wrapper adds JSON Schema instance paths and locates the node or field for
  each semantic code, while the SDK's code stays the verdict. The SDK should gain a
  `diagnose_graph` that returns every `{code, path}`, with paths in the parity vectors. That is the
  main change asked of upstream.

## What the SDK has today

### Rust: `crates/aiws` (`aiws-sdk` 0.4.0)

- `crates/aiws/Cargo.toml` declares no `[features]` table. `rusqlite` (with `bundled`) and
  `reqwest` (`blocking`, `rustls-tls`) are unconditional, so `default-features = false` drops
  nothing.
- `workflow::validate_graph` takes a `serde_json::Value`. It first runs
  `WorkflowGraph::from_value`, which is the `record!` macro in `core.rs` calling `core::validate`
  against the bundled `schema.json`. It then checks, in this order, and stops at the first failure:
  `DUPLICATE_NODE`, `MISSING_END`, then for each node `INVALID_DEPENDENCY`, the node's
  `inputSchema`/`outputSchema` through `data_validator` (`SCHEMA_UNSUPPORTED`, `SCHEMA_INVALID`),
  and `NODE_CONFIG`. After the node loop come `GRAPH_CYCLE` and `NO_END_PATH`.
- `core::validate` calls `jsonschema::Validator::is_valid`, so every schema failure becomes the
  one code `INVALID_RECORD`, with no path.
- `AiwsError` is `{ code: String }` and nothing else.
- Validation itself needs only `serde`, `serde_json`, `sha2`, `thiserror`, `num-bigint` and
  `jsonschema`. The crate cannot simply be trimmed to those, though. `core::reduce` calls
  `crate::observability::event_envelope`, and `observability.rs` also holds the `reqwest` OTLP
  exporter. `rusqlite` is used by `sqlite.rs`, `handoff_store.rs`, `limits_store.rs`,
  `telemetry_store.rs` and `dynamic_controls.rs`.

### TypeScript: `packages/typescript` (`@aiws/sdk` 0.4.0)

- `validateGraph` in `src/workflow.ts` follows the same steps as the Rust version, in the same
  order, and throws `AiwsError` (`src/index.ts`) with a bare `code`.
- `src/index.ts` builds one `Ajv2020({ strict: false, allErrors: true })` and compiles a validator
  for each record when the module loads. `validate` throws `INVALID_RECORD`, and `allErrors` is
  computed but thrown away. `dataValidator` compiles each node schema at call time.
- `node:crypto` (`createHash`) is imported by `index.ts`, `workflow.ts` and `observability.ts`.
  `Buffer` appears in `parseStrict` and in `protocol.ts`. None of these is on the path that
  `validateGraph` runs.

### Schema and parity

- `scripts/generate-schema.py` writes four byte-identical copies: `spec/schema.json`,
  `packages/typescript/src/schema.json`, `crates/aiws/src/schema.json` and the Python package's
  copy. The schema carries no `$id` and no version, so a copy cannot say which SDK revision it came
  from.
- `$defs.Node.config` is only `{"type": "object"}`. The per-kind config rules (TASK
  `executionKind`, DECISION `field/equals/then/else`, JOIN `mode`, LOOP `maxIterations`, and an
  empty config for every other kind) are written in code in both `validate_graph` and
  `validateGraph`, not in the schema.
- `spec/fixtures.json` holds the shared vectors, each a contract plus steps with an expected
  `error`. `scripts/parity.mjs` and `scripts/cli-parity.mjs` assert that the TypeScript, Rust and
  Python SDKs agree on them. Of these vectors, 21 include a `registerGraph` step, and these are the
  graph-validation conformance cases.

### Contracts, grants and triggers

These records have no standalone validator beyond the schema. Their real rules live in the reducer
and depend on a mission:

- **Contract:** the schema, then `create_mission` / `createMission` (`parseContract` in TS)
  require a nonempty `criteria` and a positive `maxAttempts` (`INVALID_CONTRACT`).
- **Grant:** the `"grant"` arm of `core::reduce` returns `AUTHORITY_INDETERMINATE` (profile, time
  window), `AUTHORITY_DENIED` (actions, resources, limit or expiry outside the contract), and
  checks containment in a parent through `compare_grants`.
- **Trigger:** the `registerTrigger` arm of `workflow::apply_extension` returns `TRIGGER_CONTRACT`
  (contract id, and a window inside the contract deadline), `TRIGGER_LIMIT`, `TRIGGER_TARGET`,
  `TRIGGER_CONDITION` and `SCHEDULE_CONFIG`. It also needs `"triggers"` in the contract's
  `features`.

### Coding plans

- `validatePlan` (`engine/src/coding-workflow-types.ts`) throws `CodingWorkflowError('INVALID_PLAN', message)`
  on the first failure.
- `authorCodingPlan` and `validateAuthoringField` (`engine/src/coding-authoring.ts`) return
  `AuthoringDiagnostic { field, code, severity, message }` for every field, plus warnings
  (`PARTIAL_CORRECTION_BUDGET`, `TASK_EXCEEDS_TOTAL`, `CORRECTIONS_PREAUTHORIZED`). This is the
  per-field shape the builder wants. The `field` is a top-level key or `$`, not a nested path.
- These live in `@aiws/engine` (`engine/package.json`: `"private": true`, version `0.0.1-m5`),
  not the SDK. They cannot be imported into a browser or easily into Quay.
  `coding-workflow-types.ts` imports `digestCommand` from `sqlite-store.ts`, which imports
  `node:sqlite`, and `coding-authoring.ts` also reaches `node:fs` through `control-wire.ts`.
- The host exposes the same check remotely. `control-http.ts` routes `/engine/authoring-preview/v1`
  to `ControlService.authoringPreview`, which is read-only and needs the `authoring-preview`
  permission.
- The two engine validators disagree. `validateAuthoringField` requires `maxAttempts >= 2`, while
  `validatePlan` accepts `maxAttempts >= 1`.

## What Quay has

- `src-tauri/Cargo.toml` already has `serde` and `serde_json`. It lacks `sha2`, `thiserror`,
  `num-bigint`, `jsonschema` and `rusqlite`. It has `reqwest` 0.13 only through
  `tauri-plugin-updater`, while `aiws-sdk` wants `reqwest` 0.12, so the build would carry two
  copies.
- `package.json` lists no Ajv or `jsonc-parser`. `vite.config.ts` has no Node polyfills or
  aliases.
- `src-tauri/tauri.conf.json` sets `"csp": null`. The global review rules forbid that, so a CSP
  is coming, and any frontend validator must work under it.
- The frontend already calls the backend through Tauri `invoke` (for example
  `src/slices/machina/WorkOrderDetail.tsx`).

## The three options

| | Rust crate in the backend | TS validators in the frontend | Port inside Quay |
| --- | --- | --- | --- |
| Same rules as Praxis | Yes, held there by the SDK parity suite | Yes | Only while a conformance test keeps it there |
| Bundles today | Yes. `cargo build` of a path dependency passes all 21 graph vectors | Yes. Vite externalises `node:crypto` and tree-shakes it away, and the bundle passes all 21 vectors | n/a |
| Works under a CSP | Yes, nothing runs in the webview | **No.** Ajv's `Function(...)` raises `EvalError` at import without `'unsafe-eval'` | Yes |
| Cost | 24 to 32 new crates, plus a C build of SQLite | About 197 kB minified (48 kB gzip) of Ajv and the SDK | A rewrite that drifts silently |
| Field paths | Available from the `jsonschema` crate's `iter_errors` | Available from Ajv `errors` | Whatever Quay writes |

Decision: **the Rust crate, vendored, behind one Tauri command.** The frontend's own model can still
flag obvious structural slips instantly (such as a dangling edge while dragging), but only the
backend command decides validity. Precompiling Ajv to standalone code would remove `eval` for the
fixed record schemas only. It cannot cover node `inputSchema`/`outputSchema`, which
`dataValidator` compiles from user data. The TS route would therefore need `'unsafe-eval'`
permanently.

## Recommendation

### Where validation runs

One Tauri command, sketched as
`praxis_validate(kind, value, context) -> { valid, diagnostics: [{ code, path, nodeId?, severity }] }`:

- **Graph:** `workflow::validate_graph(value)`.
- **Contract:** `Contract::from_value`, then `create_mission`.
- **Grant, trigger, or a graph against a contract:** `create_mission(contract)` on a scratch
  snapshot, then `reduce` with a `grant`, `registerTrigger` or `registerGraph` command and a
  synthetic `now`. A grant with a `parentId` also replays the parent grant first. `reduce` is pure,
  so nothing persists. In the experiment this returned `TRIGGER_CONTRACT` for a trigger that
  outlives the contract deadline, `AUTHORITY_DENIED` for a grant wider than the contract, and
  `INVALID_RECORD` for a trigger missing a field.
- **Coding plan:** a small Quay port of `validateAuthoringField` and the cross-field checks in
  `authorCodingPlan`, for offline per-field diagnostics. When Quay is connected to a host, the
  host's `/engine/authoring-preview/v1` gives the real answer, including readiness and the review
  digest. The port is a stopgap until upstream moves this validator into the SDK. Note that
  #246 on the paired map ("how do coding plans and finite-v1 graphs relate?") may change this
  record altogether.

The frontend calls the command with a short debounce after each edit. A local `invoke` round
trip is far below an edit's cadence, so per-keystroke validation is affordable.

### How Quay pins the SDK

- Vendor `crates/aiws` into Quay (for example as a path crate next to `src-tauri`), copied
  verbatim, with a `SOURCE` file that records the upstream commit SHA and the SHA-256 of
  `schema.json`.
- A Quay script copies the crate from a local AI-WS-SDK checkout at a named commit and rewrites
  `SOURCE`. A check fails CI when the vendored `schema.json` digest does not match `SOURCE`, so a
  hand edit to the vendored code cannot slip through.
- Copy `spec/fixtures.json` alongside, and add a cargo test that feeds every `registerGraph` step
  to the Tauri command's code path and asserts the expected `error`. The same test asserts that
  Quay's locator (below) never reports "valid" where the SDK fails, and that its first code equals
  the SDK's.
- Reasons against a git dependency: the SDK repository is private while Quay-2 is public, so
  public CI, release builds and contributors could not fetch it without a deploy key. It also has
  no tags to pin, and with no Cargo features it would still pull `rusqlite` and `reqwest`.
- Reasons for a verbatim copy over a trimmed subset: a verbatim copy keeps the sync mechanical,
  while a subset has to patch `lib.rs` and the `core::reduce` call into `observability`. Trimming
  saves only 8 of 32 new crates. Once upstream adds features, Quay sets
  `default-features = false` on the same copy.
- Hazard: `libsqlite3-sys` declares `links = "sqlite3"`, so Cargo allows only one version in a
  build. If Quay later adds its own `rusqlite` at a different version, the build fails until the
  SDK's dependency is feature-gated or aligned.

### How errors map to nodes and fields

The SDK's code stays the verdict, and the wrapper only adds location:

- **Schema failures (`INVALID_RECORD`):** Quay runs `jsonschema::validator_for` on the vendored
  `schema.json` (with `$ref` set to the record) and reads `iter_errors`. Each error carries an
  `instance_path` such as `/nodes/0/kind` or `/nodes/1/id`, which maps to a node index and a field.
  The experiment printed exactly these paths for a misspelt kind, an empty id and an unknown
  property.
- **Semantic codes:** a Quay locator repeats the SDK predicate over every node, so it can report
  all failures at once rather than only the first:
  - `DUPLICATE_NODE`: every node that shares the id, at `/nodes/i/id`.
  - `MISSING_END`: the graph as a whole.
  - `INVALID_DEPENDENCY`: `/nodes/i/dependsOn/j` for each unknown or self dependency.
  - `NODE_CONFIG`: `/nodes/i/config`, or `/nodes/i/config/<key>` for a missing, extra or
    wrong-valued key. DECISION also points at `then`/`else` when the target does not depend on the
    decision.
  - `SCHEMA_UNSUPPORTED`, `SCHEMA_INVALID`: `/nodes/i/inputSchema` or `/nodes/i/outputSchema`.
  - `GRAPH_CYCLE`: the nodes on the cycle.
  - `NO_END_PATH`: every node that cannot reach an END.
- **Graph-level context codes** from the scratch mission (such as `UNSUPPORTED_FEATURE` when the
  contract lacks `"graphs"`) attach to the record, not to a node.

## What upstream should change

These are asks for the paired map,
[AI-WS-SDK #247](https://github.com/seanrobertwright/AI-WS-SDK/issues/247). Each one removes a part
of Quay's wrapper.

1. **A `diagnose_graph` / `diagnoseGraph` in all three SDKs** that returns every
   `{ code, path, nodeId? }`, with `validate_graph` defined as "fail on the first diagnostic". The
   `registerGraph` vectors in `spec/fixtures.json` would gain expected paths, so `parity.mjs`
   keeps the three languages in step on locations as well as codes. This removes Quay's locator.
2. **Schema-error paths.** `core::validate` and TS `validate` would expose the `jsonschema`
   `iter_errors` instance paths and Ajv's `errors`, instead of collapsing everything to
   `INVALID_RECORD`.
3. **Per-kind node config in `spec/schema.json`.** Express it as `oneOf`/`if-then` on `kind` in
   `$defs.Node`. The builder's inspector could then derive its forms from the schema, and config
   errors would get schema paths for free.
4. **Cargo features in `crates/aiws`.** Put `rusqlite` behind a `sqlite` feature and `reqwest`
   behind an `otlp` feature, and keep `observability::event_envelope` outside the `otlp` gate. With
   that, `default-features = false` gives validation alone.
5. **Standalone validators for contextual records.** Add `validate_trigger(contract, trigger)` and
   `validate_grant(contract, parent?, grant)`, or document the scratch-mission recipe as supported
   API.
6. **A version marker.** Tag SDK releases, and stamp `schema.json` with an `$id` or version, so
   Quay's `SOURCE` file can name a release rather than a bare commit.
7. **Coding-plan authoring in the SDK, or with vectors.** Move `validateAuthoringField` and
   `authorCodingPlan` out of the private engine, or at least publish authoring vectors, and settle
   the `maxAttempts` minimum (2 in `validateAuthoringField`, 1 in `validatePlan`).

## Experiments

These were throwaway, outside both repositories, and did not run the SDK's test suites.

- **Path dependency.** A probe crate depending on `aiws-sdk` with `default-features = false`
  still resolves `rusqlite` 0.40 and `reqwest` 0.12 (`cargo tree -i`). It adds 32 crates that are
  not in Quay's tree. A crate with only the validation dependencies adds 24. The release build
  took 55 seconds. The probe's `validate_graph` gave the expected result for all
  21 `registerGraph` steps in `spec/fixtures.json`.
- **Vite bundle.** `vite build` (Vite 8, from Quay's `node_modules`) of an entry that imports
  `validateGraph` and `AiwsError` from `packages/typescript/dist/index.js` succeeded. Vite warned
  that `node:crypto` was externalised for `index.js`, `workflow.js` and `observability.js`, and the
  output contains no `createHash` or `Buffer`. Output size was 197 kB (48 kB gzip).
- **Browser run.** The bundle was loaded in headless Edge. With no CSP it matched all 21 graph
  vectors. With `script-src 'self'` the import failed with
  `EvalError: Evaluating a string as JavaScript violates the following Content Security Policy directive`,
  raised from Ajv's schema compilation.
- **Schema paths.** `jsonschema::validator_for(...).iter_errors` on the vendored schema reported
  `/nodes/0/kind`, `/nodes/1/id` and `/nodes/1` (additional property) for a deliberately broken
  graph.
- **Scratch mission.** In Node, `createMission` followed by `reduce` with `registerTrigger` and
  `grant` commands returned `TRIGGER_CONTRACT`, `AUTHORITY_DENIED` and `INVALID_RECORD` for the
  bad records, and accepted a trigger inside the contract window.
