//! Records a real graph session for the Topos scale benchmark (#377). Not a test of its own: it
//! is ignored unless named, and `scripts/topos-bench/README.md` says how to run it. It opens a
//! session on `TOPOS_BENCH_REPO` with every row up to the hard cap granted, and writes each
//! channel message to `TOPOS_BENCH_OUT` exactly as the frontend would receive it, framed as
//! `[kind: u8 (0 JSON event, 1 Rows page)][length: u32 LE][bytes]`.

use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::PathBuf;
use std::sync::mpsc::channel;
use std::time::{Duration, Instant};

use tauri::ipc::{Channel, InvokeResponseBody};

use super::session::{GraphOptions, GraphSessions, HARD_CAP};

/// Longest a quiet channel is waited on before the dump gives up.
const QUIET_LIMIT: Duration = Duration::from_secs(300);

fn env_path(name: &str) -> PathBuf {
    match std::env::var_os(name) {
        Some(value) if !value.is_empty() => PathBuf::from(value),
        _ => panic!("{name} must name a path; see scripts/topos-bench/README.md"),
    }
}

#[test]
#[ignore = "benchmark input, run by scripts/topos-bench/dump-pages.ts"]
fn dump_graph_session_for_benchmark() {
    let repo = env_path("TOPOS_BENCH_REPO");
    let out = env_path("TOPOS_BENCH_OUT");
    let (tx, rx) = channel::<(u8, Vec<u8>)>();
    let ch = Channel::new(move |body| {
        let _ = tx.send(match body {
            InvokeResponseBody::Json(json) => (0, json.into_bytes()),
            InvokeResponseBody::Raw(bytes) => (1, bytes),
        });
        Ok(())
    });
    let sessions = GraphSessions::default();
    let started = Instant::now();
    sessions.open(&repo, GraphOptions { soft_cap: Some(HARD_CAP), ..GraphOptions::default() }, ch).unwrap();
    let mut file = BufWriter::new(File::create(&out).unwrap());
    let (mut pages, mut first_page_ms) = (0u32, None);
    loop {
        let (kind, bytes) = rx.recv_timeout(QUIET_LIMIT).expect("the session went quiet");
        file.write_all(&[kind]).unwrap();
        file.write_all(&u32::try_from(bytes.len()).unwrap().to_le_bytes()).unwrap();
        file.write_all(&bytes).unwrap();
        if kind == 1 {
            pages += 1;
            first_page_ms.get_or_insert(started.elapsed().as_millis());
            continue;
        }
        let event: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        match event["event"].as_str() {
            Some("done" | "truncated") => break,
            Some("failed") => panic!("the session failed: {event}"),
            _ => {}
        }
    }
    file.flush().unwrap();
    eprintln!(
        "{pages} pages from {} in {} ms (first page {} ms) -> {}",
        repo.display(),
        started.elapsed().as_millis(),
        first_page_ms.unwrap_or_default(),
        out.display()
    );
}
