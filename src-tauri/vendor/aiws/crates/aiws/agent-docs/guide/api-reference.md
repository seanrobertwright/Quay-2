# Native API reference

The tables map the intended application-facing APIs in SDK 0.4.0. TypeScript imports core/workflow symbols from @aiws/sdk, Rust from aiws_sdk plus its modules, and Python from aiws or aiws.core plus its modules. Source definitions and the shared schema are included in the source download.

## Core values and functions

| Purpose | TypeScript | Rust | Python |
|---|---|---|---|
| Checked contract from JSON text | parseContract(text): Contract | Contract::parse(text) → Result&lt;Contract&gt; | parse_contract(text) → dict |
| Checked command from JSON text | parseCommand(text): Command | Command::parse(text) → Result&lt;Command&gt; | parse_command(text) → dict |
| Strict JSON | parseStrict(text) | parse_strict(text) → Result&lt;Value&gt; | parse_strict(text) |
| Validate named record | validate(name, value) returns value | validate(name, &value) → Result&lt;()&gt; | validate(name, value) returns value |
| Canonical JSON | canonical(value): string | canonical(&value) → Result&lt;String&gt; | canonical(value) → str |
| Action fingerprint | fingerprint(action): string | fingerprint(&action) → Result&lt;String&gt; | fingerprint(action) → str |
| General canonical digest | sqlite.digest(value) | digest(&value) → Result&lt;String&gt; | core.digest(value) → str |
| Compare delegation | compareGrants(parent, child) | compare_grants(&parent, &child) → Containment | compare_grants(parent, child) |
| Create state | createMission(contract): Snapshot | create_mission(&contract) → Result&lt;Snapshot&gt; | create_mission(contract) → dict |
| Apply pure command | reduce(state, command, nowMs) | reduce(&state, &command, now_ms) → Result&lt;Snapshot&gt; | reduce(state, command, now_ms) |
| Assess completed result | assessSuccess(state, runId) | assess_success(&state, run_id) → Result&lt;Value&gt; | assess_success(state, run_id) |
| Replay events | auditPlayback(contract, events) | audit_playback(&contract, &events) → Result&lt;Snapshot&gt; | audit_playback(contract, events) |
| Compile a data validator | dataValidator(schema): (data) → boolean | data_validator(&schema) → Result&lt;Validator&gt; | data_validator(schema) → Draft202012Validator |
| Enforce a data schema | validateData(schema, data): void | validate_data(&schema, &data) → Result&lt;()&gt; | validate_data(schema, data) → None |

The Rust checked records also expose from_value(Value), parse(&str) and as_value(). These include Contract, Command, Grant, Approval, Action, TriggerDefinition, TriggerEvent and WorkflowGraph. Snapshot offers as_value() for inspection, rather than public mutable fields. TypeScript types and Python dictionary aliases still require runtime validation for untrusted input.

Containment is CONTAINED, NOT_CONTAINED or INDETERMINATE. Only confirmed containment permits delegated scope. Pure reduction returns a new snapshot; a rejected command must not advance its revision. Result assessment returns verifiedSuccessful and reasons; do not infer success solely from one terminal-state string.

## Protocol correlation helpers

These helpers are **part of SDK 0.4.0 and absent from the earlier 0.3.0 packages**. They correlate governed AIWS/Praxis identity with an external protocol binding; they do not implement protocol transport and cannot grant authority.

| Purpose | TypeScript | Rust | Python |
|---|---|---|---|
| Binding identity record | `ProtocolBindingRef` | `ProtocolBindingRef` | validated dictionary passed to `protocol_correlation` |
| Operation/remote identity record | `ProtocolOperationRef` | `ProtocolOperationRef` | validated dictionary passed to `protocol_correlation` |
| Build checked correlation | `protocolCorrelation(binding, operation)` | `protocol_correlation(binding, operation)` | `protocol_correlation(binding, operation)` |
| Validate existing correlation | `validateProtocolCorrelation(value)` | `validate_protocol_correlation(&value)` | `validate_protocol_correlation(value)` |
| Check decoded JSON | `validateProtocolCorrelation(value)` | `ProtocolCorrelation::from_value(value)` (current source) | `validate_protocol_correlation(value)` |

Every checked correlation has profile `aiws-protocol-correlation/1` and literal `authoritative: false`. The record contains binding ID/revision, exact protocol/version, manifest/capability digests, local work/run/task/operation/attempt identity and optional remote identity/operation references. It has no dispatch, cancellation, reconciliation, verification or acceptance method.

In current source, after the 0.4.0 archives, the record is closed the same way in all three languages. Each of its three objects takes an exact key set: an unknown key or a missing one is refused with `INVALID_PROTOCOL_CORRELATION`, and `taskId`, `remoteIdentityRef` and `remoteOperationId` may be `null` but must be present. Rust's `Deserialize` enforces the same key set. A remote reference is at most 2048 UTF-8 bytes of well-formed text with no C0, DEL or C1 control character. The first failing rule is reported in record order, with the same code in every language. The schema and shared fixtures are in [spec/protocol-correlation-v1](https://github.com/seanrobertwright/AI-WS-SDK/blob/main/spec/protocol-correlation-v1/README.md).

## Workflow helpers

| TypeScript | Rust | Python | Result and ownership |
|---|---|---|---|
| validateGraph(value) | workflow::validate_graph(&value) | workflow.validate_graph(value) | Checked graph; structural and semantic validation |
| readyNodes(state, runId) | workflow::ready_nodes(&state, run_id) | workflow.ready_nodes(state, run_id) | Eligible node IDs; no dispatch |
| dueSlots(start, interval, nextSlot, now, policy, limit) | workflow::due_slots(start, interval, next_slot, now, policy, limit) | workflow.due_slots(start, interval, next_slot, now, policy, limit) | Low-level due-slot calculation; use tickTrigger for durable cursor/admission semantics |

The slot helper has language-specific low-level numeric types. It is not a cross-language wire command. Applications normally use tickTrigger, which commits admission with the cursor, rather than independently computing slots and guessing a persisted state update.

## SQLite store

| Operation | TypeScript | Rust | Python |
|---|---|---|---|
| Create/verify mission database | new SqliteStore(path, contract) | SqliteStore::open(path, Some(&contract)) | SqliteStore(path, contract) |
| Reopen existing mission | new SqliteStore(path) | SqliteStore::open(path, None) | SqliteStore(path) |
| Read verified state | store.snapshot() | store.snapshot()? | store.snapshot() |
| Commit a trusted command | store.apply(command, nowMs, expectedRevision?) | store.apply(&command, now_ms, expected_revision)? | store.apply(command, now_ms, expected_revision=None) |
| Export audit text | store.exportAudit() | store.export_audit()? | store.export_audit() |
| Replay audit text | importAudit(text) from /sqlite | sqlite::import_audit(text)? | sqlite.import_audit(text) |
| Read rejection stream | store.diagnostics() | store.diagnostics()? | store.diagnostics() |
| Release resources | store.close() | Drop store after outstanding work finishes | store.close() or a with block |

apply returns the committed Snapshot. Expected revisions are decimal strings (Option&lt;&str&gt; in Rust); a mismatch is REVISION_CONFLICT. Reload and reevaluate policy before retrying a changed-state command. A pre-commit hook is available for fault-injection tests: TypeScript/Python use the extra beforeCommit/before_commit argument, Rust uses apply_with_hook. It is not a public transaction handle for atomically inserting a custom engine queue.

recordRejection/record_rejection writes a protected diagnostic record and telemetry intent. It does not authorize a command or advance mission revision. Most applications let Coordinator use this hook; avoid arbitrary user-provided diagnostic content. Telemetry methods and their arguments are listed under [observability](./observability.md).

## Coordinator and adapters

| Operation | TypeScript | Rust | Python |
|---|---|---|---|
| Construct | new Coordinator(store, authorize, clock) | Coordinator::new(store, authorizer, clock) | Coordinator(store, authorize, clock) |
| Authorized command | await coordinator.apply(command, expectedRevision?) | coordinator.apply(&command, expected)? | coordinator.apply(command, expected_revision=None) |
| Execute admitted attempt | await coordinator.dispatch(attemptId, adapter, nodeId?) | coordinator.dispatch(attempt_id, &mut adapter, node_id)? | coordinator.dispatch(attempt_id, adapter, node_id=None) |
| Read back uncertainty | await coordinator.reconcile(attemptId, adapter) | coordinator.reconcile(attempt_id, &mut adapter)? | coordinator.reconcile(attempt_id, adapter) |
| Continue with ownership boundary | await coordinator.recover(runId, segmentId) | coordinator.recover(run_id, segment_id)? | coordinator.recover(run_id, segment_id) |

apply, dispatch and reconcile return a Snapshot. recover returns `{state, unresolved}` in TypeScript and Python, and a (Snapshot, Vec&lt;String&gt;) tuple in Rust. It records a new continuation segment and reports unresolved attempt IDs; it does not call the adapter or decide that a machine should restart automatically.

reconcile asks the authorizer about the read-back before calling the adapter. A denial is recorded in the rejection stream as AUTHORITY_DENIED and a decision without actor or policyRevision as ATTRIBUTION_REQUIRED, as apply records them, and the adapter is not called. Rust always did this; TypeScript and Python do it in current source, after the 0.4.0 archives. An authorizer that fails (throws, or in Rust returns `Err`) is recorded as AUTHORIZATION_ERROR without context, and reconcile fails with AUTHORIZATION_ERROR without calling the adapter, as apply does. That is current source in all three SDKs; in the 0.4.0 archives the authorizer's error propagated from reconcile with nothing recorded.

Authorization contains allowed, policy, mandatoryChecksOk and context. Context requires actor, policyRevision and decisionClass. The host supplies authenticated identity and returns a current decision. The clock returns UTC epoch milliseconds as a canonical decimal string. Rust uses the `runtime::Authorizer` and `runtime::Clock` traits. TypeScript's `Authorizer` is a promise-returning callback `(command, state, nowMs)`, and its `Clock` is `() => string`, both from @aiws/sdk/runtime. Python's `aiws.runtime.Authorizer` is a Protocol for a callable `(command, state, now_ms)` returning Authorization, and `aiws.runtime.Clock` is `Callable[[], str]`. The TypeScript `Clock` and the Python `Authorizer` and `Clock` names are in current source, after the 0.4.0 archives; the coordinators accepted the same values before they were named.

EffectAdapter.execute performs the side effect. EffectAdapter.reconcile reads external state without repeating the side effect. Both return Outcome with effect = CONFIRMED_APPLIED, CONFIRMED_NOT_APPLIED or UNKNOWN, and actualCost as a decimal string. TypeScript methods return promises; Rust and Python are synchronous. A thrown execute error becomes UNKNOWN, preserving exposure; a failed reconciliation remains an intervention problem, not permission to execute again.

## Command-line tools

| | TypeScript | Rust | Python |
|---|---|---|---|
| Program | `aiws` | `aiws-sdk` | `aiws-python` |
| Commands | validate, graph, replay, fixtures, snapshot, observe | validate, graph, replay, fixtures, snapshot, observe | validate, graph, replay, fixtures, snapshot, observe |

Each command takes one file. `validate` checks a contract, `graph` a workflow graph, `replay` an audit export, and `fixtures` replays a shared fixture file and prints each step's state digest or error. `snapshot` prints the verified state of a mission database, and `observe` its OTLP traces, metrics and operational summary at the fixed test timestamp 4000000 ms; neither creates a missing database. Results are canonical JSON on stdout. A failure writes `{"error":"CODE"}` to stderr and exits 1: FILE_ERROR for a missing or non-UTF-8 file, STORAGE_ERROR for a file SQLite cannot read, otherwise the SDK's own code. A usage error, including an unknown command, writes the usage text to stderr and exits 2; `-h` or `--help` prints it to stdout. The three CLIs give identical output for the same input. In the 0.4.0 archives the TypeScript CLI has only validate, graph and replay, and the error output and exit codes differ by language; see [versioning](./migration.md).

## Errors and concurrency

TypeScript and Python raise AiwsError with code; Rust returns Result with AiwsError.code. I/O failures can also require host-level handling. Build error handling around phase, committed state and the stable code, not around matching a stack trace. Read [troubleshooting](./troubleshooting.md) before deciding that an exception is safe to retry.

Async TypeScript does not make SQLite calls nonblocking: DatabaseSync blocks its thread. Use suitable workers for synchronous database or adapter calls in a server. Do not share a Python SQLite connection across arbitrary threads or assume the Rust coordinator is a distributed execution lock. All three implementations require an application concurrency and ownership design.


## M3 source: nested resource ledger

Import TypeScript `LimitStore`/`LimitCoordinator` from `@aiws/sdk/limits`, Python equivalents from `aiws.limits_store`, and Rust equivalents from `aiws_sdk::limits_store`. Pure transitions are in the corresponding limits module. `LimitStore(path, config)` (Rust `LimitStore::open`) initializes a human-approved immutable scope tree; reopen without config to replay. `snapshot`, `apply`, `report` and `exportEvents` (Python/Rust `export_events`) expose committed state, commands, deterministic exhaustion reports and journal evidence.

The ledger authorizer is `LimitAuthorizer`: a TypeScript callback `(request, state, now)` returning LimitFacts or a promise of them, a Rust trait with `authorize(&mut self, request, state, now)`, and, in current source, a Python Protocol in `aiws.limits_store` for a callable `(request, state, now)` returning the facts dictionary. The coordinator sets `authorizedAtMs` from its clock.

Commands: reserve, dispatch, release, unknown, stop, settle and adjust. Request fields are requestId, expectedRevision and command. Raw apply is a trusted/offline interface; use the coordinator for application requests. Authorizers bind actor identity, current policy, scope/purpose, ownership and evidence to the exact command. Stop/settle need evidence; uncertain-outcome resolution and limit adjustments need authenticated humans. See [budgets](./budgets.md) for equivalent executable examples, accounting rules and required host ordering.
