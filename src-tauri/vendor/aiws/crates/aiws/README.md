# aiws-sdk 0.4.0

Independent native Rust SDK for the AIWS-001 edition 0.4 proposal, finite-v1 profile. No TypeScript subprocess or Node dependency is used.

```rust
use aiws_sdk::{Contract, Command, create_mission, reduce};
use serde_json::json;
# fn example(contract_text: &str) -> aiws_sdk::Result<()> {
let contract = Contract::parse(contract_text)?;
let state = create_mission(&contract)?;
let command = Command::from_value(json!({"type":"startRun","runId":"r"}))?;
let state = reduce(&state, &command, "10")?;
# Ok(())
# }
```

`sqlite::SqliteStore` provides atomic journaled writes and replay-verified snapshots. `runtime::Coordinator` accepts `Authorizer`, `Clock` and `EffectAdapter` implementations. These APIs are synchronous; use a blocking worker in an async service. `workflow` exports graph validation, readiness and bounded schedule calculations. Checked record constructors validate the shared JSON schema and return `Result` on errors.

Run `cargo test` and `cargo run --example review`. The example uses a fixed demonstration identity and clock and writes an artifact, SQLite mission and audit bundle in a temporary directory. Replace those demonstration integrations before deployment.

The `aiws-sdk` binary supports `validate`, `graph`, `replay`, `fixtures`, `snapshot` and `observe`, each followed by one file path. `observe` is an interoperability test projection evaluated at fixed timestamp 4000000 ms, not a live monitoring command. Results are canonical JSON on stdout. A failure writes `{"error":"CODE"}` to stderr and exits 1; a usage error writes the usage text to stderr and exits 2. The TypeScript `aiws` and Python `aiws-python` CLIs behave identically. The source workspace includes exact cross-language parity tests and the standard/profile documents. Registry publication is not part of this release.
## Release 0.4.0

**Breaking change: readiness 2.0.0 is the current readiness schema.** Encoding produces only 2.0.0
records and refuses a 1.0.0 record with `UNSUPPORTED_VERSION`; decoding still accepts both
versions. The exported readiness types now describe 2.0.0, and the 1.0.0 types moved to `v1`.
Readiness evaluation still takes 1.0.0 inputs only. See the release notes in the
[versioning chapter](https://github.com/seanrobertwright/AI-WS-SDK/blob/main/src/content/docs/migration.md).

## Protocol correlation helper

SDK 0.4.0, unlike the earlier 0.3.0 archives, includes portable protocol-correlation records for associating AIWS/Praxis work with an exact protocol binding revision and remote identity. The helper is non-authoritative and does not implement MCP, A2A or AG-UI transport behavior. Use official protocol SDKs/Praxis adapters for wire operations; use the correlation record only for integration metadata and evidence indexing.

