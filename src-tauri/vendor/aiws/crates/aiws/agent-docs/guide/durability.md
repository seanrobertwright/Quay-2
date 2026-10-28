# SQLite persistence and audit replay

Each SqliteStore holds one immutable mission contract and its event journal. SQLite is configured with WAL and FULL synchronization. State-changing commands are checked and appended in a transaction; their redacted trace outbox record commits with them. An effect adapter is called only after a successful coordinator dispatch commit.

## Reopen the same mission

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

Opening an existing store without a contract reads the stored contract. Supplying a conflicting contract is rejected. Do not delete and recreate the database when recovering a failed request; doing so loses the identities, reservations and evidence needed to determine what remains safe.

The example intentionally creates a temporary directory and keeps it for inspection. In an application use a stable, access-controlled data directory. For Docker, mount persistent storage for the database and artifact directory. Removing a container without retained state is not a recoverable workflow pause.

## Expected revisions

Every accepted command advances the mission revision, even some semantically idempotent duplicate commands. Use an expected revision to detect concurrent changes. The coordinator checks a snapshot and compares its revision again during commit. On REVISION_CONFLICT reload and reevaluate the command; do not blindly replace the expected revision with the latest value.

SQLite provides a local transaction boundary. It is not the proposed distributed work-order service, and this release does not implement remote failover. Avoid sharing a live database file through ad hoc network synchronization. Choose a deployment architecture with one authoritative mission store and tested file-locking behavior.

## Replay and integrity

Audit export includes contract, events, diagnostics, profile and a digest. Import verifies the bundle and replays accepted events without calling adapters. Altering an observation envelope while recomputing only the bundle checksum still fails semantic replay. Diagnostic export has a separate stream and is not re-executed as workflow commands.

A hash chain detects accidental or partial alteration. A party able to replace an entire database can recompute hashes; use external integrity roots or signatures when the deployment requires authenticated evidence. Do not call hash verification proof of who authorized an event.

## Backups and large histories

Use a consistent SQLite backup operation or a coordinated stopped-store backup, preserving artifacts separately. Copying only a live main database file can omit uncheckpointed WAL state. SQLite documents an online backup API for coherent snapshots. [SQLite backup reference](https://www.sqlite.org/backup.html).

Replay is linear in retained history on each store transaction. Large mission histories require measurement before production use. The strict text parser limits one input to 1 MiB and depth 64; a large audit bundle may need an application transport that validates and streams bounded events to audit playback. The SDK does not provide automatic checkpoint compaction, pagination or a multi-gigabyte import API.
