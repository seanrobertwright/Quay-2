# Deploy the documentation and host SDK applications

The Astro site and an application using the SDKs are separate deployable artifacts. This repository builds static documentation. It does not deploy a workflow scheduler, agent fleet, database service or approval inbox.

## Build the Astro site

From the source workspace root, use the Node version declared in package.json:

```bash
npm ci
npm run build
```

The build regenerates plain-text documentation, the downloadable handbook and the source ZIP, then renders Astro/Starlight into dist/. Serve the contents of dist/ from your static host. Keep URL handling compatible with directory routes such as /handoffs/ and /api-reference/. No server-side secret or SDK database is needed by the documentation site.

For local writing, npm run dev starts Astro's development server. All concept examples use native Starlight Tabs and TabItem components. The selected language is synchronized across examples and retained on return visits by Starlight's syncKey mechanism. The downloadable handbook includes all languages sequentially so agents do not need to manipulate tabs.

## Install an SDK in your application

Use the individual package links on the home page, or the local source paths documented in each language guide. Package versions are pinned in the download names. Do not assume those names are public registry releases.

**Commit, reopen and verify an audit bundle** (Executable example). Full program: [recipes/storage.rs](../recipes/storage.rs)

```rust
use aiws_sdk::*;
use aiws_sdk::sqlite::{SqliteStore,import_audit};
use serde_json::json;
fn main() -> std::result::Result<(),Box<dyn std::error::Error>> {
    let contract = Contract::parse(&std::fs::read_to_string("examples/guide/contract.json")?)?;
    let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)?.as_nanos();
    let path = std::env::temp_dir().join(format!("aiws-docs-{nonce}.db"));
    let name = path.to_str().ok_or("non-UTF8 path")?;
    let mut store = SqliteStore::open(name,Some(&contract))?;
    store.apply(&Command::from_value(json!({"type":"startRun","runId":"r"}))?,"10",Some("0"))?;
    drop(store);
    let store = SqliteStore::open(name,None)?;
    assert_eq!(store.snapshot()?,import_audit(&store.export_audit()?)?);
    println!("{}",name);
    Ok(())
}

```

This example creates and reopens a mission database in a temporary directory to verify persistence. Real applications should choose an operator-configured persistent directory and an explicit retention/backup policy. Do not put a production mission database in an ephemeral temporary directory merely because the tutorial does so for cleanup.

## Desktop and Docker hosts

A desktop host must run its coordinator and scheduler process explicitly and store state on durable local storage. In Docker, mount the database and artifact directories on persistent volumes; the writable container layer is not a recovery plan. Preserve the SQLite database and its consistency requirements during backup. Do not share a live SQLite file through an arbitrary network filesystem or copy only its main file while ignoring an active WAL.

Process supervisors may restart a host after a crash, but the proposed workflow resume policy must still determine whether work may continue. Restarting a container is not the same event as authorizing an external action. Check state, policy validity, reservations and unresolved effects first.

## Organization-hosted services

Separate user authentication, command admission, worker capability, artifact access and telemetry configuration. Define the ownership/concurrency policy before allowing multiple processes to operate on the same mission. Current SQLite serialization is useful for state commits but does not by itself fence a stale external worker.

Do not claim a throughput or months-long retention guarantee from these examples. The current store replays retained history; large journals, long pauses, growing outboxes and the audit parser's 1 MiB input bound require explicit capacity and lifecycle planning. Cross-machine recovery is outside the currently agreed engine scope.

## Verify a release

Run the documented example suite and SDK checks before shipping your host. Validate local documentation links and rendered tabs with npm run docs:check after a build. Review authentication, effect truth and real validation evidence in your integration tests. A passing docs build demonstrates a usable reference site, not conformance of an arbitrary deployment.
