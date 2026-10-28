# Versioning and safe upgrades

SDK 0.4.0 targets proposal edition 0.4. The SDK version and standard edition are different identifiers. The finite-v1 schema and journal event envelopes are version-bound; a package upgrade is not automatic migration of existing data.

## SDK 0.4.0 release notes

**Breaking change: readiness 2.0.0 is the current readiness schema in all three SDKs.** It is the only SDK part of M10 ([agent binding §9](https://github.com/seanrobertwright/AI-WS-SDK/blob/main/spec/engine-v1/AGENT-BINDING.md#readiness-200)); the rest of M10 is a source-only engine profile.

- Each SDK carries 2.0.0 (`https://aiws.dev/readiness/2.0.0`) as `readiness.schema.json` and the frozen 1.0.0 schema beside it as `readiness.schema-1.0.0.json`.
- Encoding produces only 2.0.0 records, with the `aiws-capabilities/2`, `aiws-requirements/2`, `aiws-capability-snapshot/2`, `aiws-readiness-binding/2` and `aiws-readiness/2` profiles. Encoding a 1.0.0 record fails with `UNSUPPORTED_VERSION`; nothing is converted.
- Decoding accepts both versions, and a decoded record keeps its version. A headerless part (`Capability`, `Requirement`, `Evidence`, `Check`) is read under 2.0.0.
- The exported readiness types now describe 2.0.0. The 1.0.0 types moved to `v1`: `v1.Report` in TypeScript (`import type {v1} from '@aiws/sdk/readiness'`), `aiws_sdk::readiness::v1` in Rust and `aiws.readiness.v1` in Python. Code that named the 1.0.0 types by their plain names must switch to `v1`.
- A 2.0.0 manifest has no `provider` or `model`. It has `modelSet`, `configuration`, `usageReporting` and `gaps`, and the `MODEL` capability kind, which is VERIFIED only.
- A number in a 2.0.0 setting value is a safe integer. Record a fraction, such as a sampling temperature, as a string; a non-integer is refused with `UNSAFE_NUMBER`.
- Readiness evaluation still takes 1.0.0 inputs only and returns a 1.0.0 report; 2.0.0 inputs are refused with `UNSUPPORTED_VERSION`. The manifest digest covers both versions, so pins taken under 1.0.0 stay checkable.
- The Rust strict JSON parser now refuses a lone surrogate escape with `INVALID_UNICODE`, as TypeScript and Python do, instead of `INVALID_JSON`.

The 0.4.0 packages are also the first archives to contain the M2 handoff, M3 limits, M7 dynamic-control and M9 protocol-correlation source additions. Finite-v1 records, journals and event hashes are unchanged from 0.3.0.

## SDK source after the 0.4.0 archives: parity fixes

Current source makes the three SDKs agree where the 0.4.0 archives differ by language, and makes `Coordinator.reconcile` record an authorizer failure as `apply` does. These changes reach users in the next 0.4.x release; the source still reports version 0.4.0. Finite-v1 records, journals and event hashes are unchanged.

Behaviour that changes:

- **Denied reconciliation.** In TypeScript and Python, `Coordinator.reconcile` records a denied read-back as AUTHORITY_DENIED and a decision without actor or policyRevision as ATTRIBUTION_REQUIRED, and does not call the adapter, as Rust already did. In 0.4.0 they threw AUTHORITY_DENIED without a record, and an unattributed decision reached the adapter before the settlement was refused. Rust's `reconcile` now reads the clock once and gives the authorizer the time its rejection records, as `apply` does; 0.4.0 read the clock again for the authorizer.
- **Failed authorizer in reconciliation.** When the authorizer throws (in Rust, returns `Err`) during `Coordinator.reconcile`, current source records the rejected settle command as AUTHORIZATION_ERROR, without context and at the time the authorizer was given, and `reconcile` fails with AUTHORIZATION_ERROR without calling the adapter, as `apply` does. In 0.4.0 the authorizer's own error propagated from `reconcile` and no rejection was recorded, in all three SDKs. A caller that caught that error from `reconcile` now receives AUTHORIZATION_ERROR instead.
- **Graph check order.** Rust's `validate_graph` reports INVALID_DEPENDENCY before a node schema error, as TypeScript and Python do.
- **Protocol correlation records.** Every object takes an exact key set and the first failing rule is reported in record order, in all three SDKs; see [spec/protocol-correlation-v1](https://github.com/seanrobertwright/AI-WS-SDK/blob/main/spec/protocol-correlation-v1/README.md). A record a 0.4.0 SDK accepted can now be refused: an unknown key or a missing null-able key (Rust), a remote reference over 2048 UTF-8 bytes, containing a C1 control or a lone surrogate (TypeScript and Python), or a protocol family that is not a string (TypeScript).
- **CLIs.** `aiws`, `aiws-sdk` and `aiws-python` now give identical output. A usage error, including an unknown command, writes the usage text to stderr and exits 2, where TypeScript and Rust exited 1 with the usage inside an error record and reported an unknown command as UNKNOWN_COMMAND. Errors are compact `{"error":"CODE"}` in Python too. A non-UTF-8 file is FILE_ERROR. `snapshot` and `observe` report FILE_ERROR for a missing file instead of creating an empty database, and STORAGE_ERROR for a file SQLite cannot read. `fixtures` uses the strict JSON parser and refuses a file that is not a fixture list with INVALID_RECORD; a fixture whose contract is refused is reported beside the others.

Additions: a TypeScript `Clock` type in @aiws/sdk/runtime; Python `Clock` and `Authorizer` in `aiws.runtime` and `LimitAuthorizer` in `aiws.limits_store`; Rust `ProtocolCorrelation::from_value`; and `fixtures`, `snapshot` and `observe` in the TypeScript CLI. A shared fixture may carry a fixture-level `error` for a contract that `createMission` must refuse.

## Praxis engine source: the attempt environment rule

**Breaking change for every agent the engine runs, in source only; no SDK carries it.** M10 slice 3 builds every attempt's environment from nothing: the platform baseline, the variables the adapter or the engine sets on purpose, and a credential delivered through HC-09, the host credential provider. No other host variable reaches an attempt, so an agent or script that relied on an ambient `GITHUB_TOKEN`, cloud credentials or any other ambient variable stops working. HC-09 delivers only the credential a run's reviewed projection names, at most one, and only to a run bound under readiness 2.0.0.

Before upgrading, run the upgrade preflight (`control-cli upgrade-preflight`, or **Upgrade preflight** in the web view) on the host you are upgrading. It lists every active run that would lose an ambient variable, by name and never by value. Reconcile each listed run to an end, or cancel it and create the work again as reviewed work whose projection names the one credential its agent needs. The full note, with the baseline variables and the preflight's flags, is [the attempt environment release note](https://github.com/seanrobertwright/AI-WS-SDK/blob/main/docs/agent-binding/RELEASE-NOTE-ATTEMPT-ENVIRONMENT.md).

## Existing journals

Edition 0.4 adds observation metadata and changes event hashes. Preserve edition 0.3 journals with the SDK version that produced them for historical playback. Do not relabel a contract or recompute historical events to make the new parser accept them. That would replace evidence rather than prove compatible migration.

Before changing execution ownership or format, reconcile in-flight effects and record the source's final disposition. Create an explicitly linked new mission only through a reviewed migration procedure, carrying forward authorized resource exposure, artifact lineage and relevant decisions. An audit import in this release produces a snapshot; it is not an import-into-store or live migration command.

## Application code and definitions

Keep the workflow definition revision, adapter implementation version and material artifact revisions in your application records. Updating a code package can change behavior even when the graph JSON is unchanged. A months-long workflow needs a strategy for compatibility and dependency availability; the current SDK does not bundle a worker-version router or historical runtime images.

`activatePlan` appends plan identity and checks expectedPlan. It does not migrate graph topology or modify mission limits. Registration of a new trigger ID changes its deduplication namespace; preserve the relationship to past occurrences and prevent repeated external work during transition.

## Release procedure

Run all language examples and the shared corpus, test reopening representative stored missions, review changed error semantics and verify package entrypoints. Test the actual adapter's result parsing and external deduplication contract. Back up databases with a consistent SQLite procedure and retain artifact bytes for the required period.

The documentation source contains a verification script so future changes can detect copied examples that no longer match the package. Update text exports, API tables and executable sources together, then build the site. Never leave a documentation tab showing a new API while the downloadable package still has the old one.


## Adding nested limits from current source

Enable `aiws-limits/1` explicitly using a new, human-approved scope tree and shared ledger. Do not reopen a mission/handoff database as a limit ledger or import running work with zero consumption. Automatic import and topology changes are unsupported. Every affected external call must pass both ledger and existing dispatch checks. The host reconciles crashes between databases conservatively; restarting never proves a dispatched effect did not occur. The SDK 0.4.0 packages include it; the old 0.3.0 packages do not.
