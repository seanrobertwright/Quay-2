//! Antigravity's entry as Connect writes it, started as Antigravity starts it: the relay this build
//! made, with the terminal's environment.

use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde_json::{Value, json};

use super::mcp_tests::TestBridge;
use crate::slices::connect::Antigravity;
use crate::slices::pty::models::{BusLevel, RunKind};
use crate::slices::surface::names::SURFACE_TOOLS;
use crate::test_support::TempDir;

fn built_relay() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries").join(format!(
        "quay-relay-{}{}",
        env!("QUAY_SIDECAR_TARGET"),
        std::env::consts::EXE_SUFFIX
    ))
}

/// The entry Connect writes for that relay, in a file of the test's own.
fn written_entry() -> Value {
    let dir = TempDir::new("connect-entry");
    let file = dir.join("mcp_config.json");
    Antigravity::new(file.clone(), built_relay()).connect(None).unwrap();
    let written: Value = serde_json::from_str(&std::fs::read_to_string(file).unwrap()).unwrap();
    written["mcpServers"]["quay"].clone()
}

/// What the server `entry` names replies to a handshake and a request for its tools, started with
/// `env` and without the variables this process has for a relay, if any.
async fn replies(entry: Value, env: Vec<(&'static str, String)>) -> [Value; 2] {
    tokio::task::spawn_blocking(move || {
        let mut command = crate::spawn::hidden_command(entry["command"].as_str().unwrap());
        for name in ["QUAY_MCP_URL", "QUAY_A2A_TOKEN"] {
            command.env_remove(name);
        }
        let mut child = command.envs(env).stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().unwrap();
        let mut stdin = child.stdin.take().unwrap();
        let mut lines = BufReader::new(child.stdout.take().unwrap()).lines();
        let params = json!({ "protocolVersion": "2025-11-25", "capabilities": {} });
        let replies = [
            json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": params }),
            json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }),
        ]
        .map(|request| {
            writeln!(stdin, "{request}").unwrap();
            serde_json::from_str(&lines.next().unwrap().unwrap()).unwrap()
        });
        drop(stdin);
        child.wait().unwrap();
        replies
    })
    .await
    .unwrap()
}

fn names(list: &Value) -> Vec<&str> {
    list["result"]["tools"].as_array().unwrap().iter().map(|tool| tool["name"].as_str().unwrap()).collect()
}

#[tokio::test]
async fn an_antigravity_terminal_that_starts_the_entry_has_the_surface_tools_only_and_stays_a_responder() {
    let bridge = TestBridge::start_with(RunKind::Antigravity, true).await;
    let launch = bridge.pty_manager.begin_launch("term-mcp", RunKind::Antigravity);
    let url = format!("http://127.0.0.1:{}/mcp/{}", bridge.port, launch.launch);

    let env = vec![("QUAY_MCP_URL", url), ("QUAY_A2A_TOKEN", bridge.token.clone())];
    let [initialized, list] = replies(written_entry(), env).await;

    assert!(initialized["error"].is_null(), "{initialized}");
    assert!(bridge.pty_manager.handshake_seen("term-mcp"));
    let tools = names(&list);
    assert!(tools.contains(&"quay_ask"), "{tools:?}");
    assert!(tools.iter().all(|tool| SURFACE_TOOLS.contains(tool)), "{tools:?}");
    let level = bridge.pty_manager.get_info("term-mcp").unwrap().bus_level();
    assert_eq!(level, Some(BusLevel::Responder));
}

#[tokio::test]
async fn outside_quay_the_entry_is_a_server_with_no_tools() {
    let [initialized, list] = replies(written_entry(), Vec::new()).await;

    assert!(initialized["error"].is_null(), "{initialized}");
    assert!(names(&list).is_empty(), "{list}");
}
