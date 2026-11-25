//! Antigravity's entry as Connect writes it, started as Antigravity starts it: the relay this build
//! made, with the terminal's environment.

use serde_json::{Value, json};

use super::mcp_tests::TestBridge;
use crate::slices::connect::Antigravity;
use crate::slices::pty::models::{BusLevel, RunKind};
use crate::slices::surface::names::SURFACE_TOOLS;
use crate::test_support::relay::{built_sidecar, Relay};
use crate::test_support::TempDir;

/// The entry Connect writes for that relay, in a file of the test's own.
fn written_entry() -> Value {
    let dir = TempDir::new("connect-entry");
    let file = dir.join("mcp_config.json");
    Antigravity::new(file.clone(), built_sidecar("quay-relay")).connect(None).unwrap();
    let written: Value = serde_json::from_str(&std::fs::read_to_string(file).unwrap()).unwrap();
    written["mcpServers"]["quay"].clone()
}

/// What the server `entry` names replies to a handshake and a request for its tools, started with
/// `env`.
async fn replies(entry: Value, env: &[(&str, &str)]) -> [Value; 2] {
    let mut relay = Relay::start(entry["command"].as_str().unwrap(), env);
    let params = json!({ "protocolVersion": "2025-11-25", "capabilities": {} });
    relay.send(json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": params }));
    let initialized = relay.next().await;
    relay.send(json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }));
    let list = relay.next().await;
    relay.close_stdin();
    assert!(relay.exits().await, "the relay outlived its stdin");
    [initialized, list]
}

fn names(list: &Value) -> Vec<&str> {
    list["result"]["tools"].as_array().unwrap().iter().map(|tool| tool["name"].as_str().unwrap()).collect()
}

#[tokio::test]
async fn an_antigravity_terminal_that_starts_the_entry_has_the_surface_tools_only_and_stays_a_responder() {
    let bridge = TestBridge::start_with(RunKind::Antigravity).await;
    let launch = bridge.pty_manager.begin_launch("term-mcp", RunKind::Antigravity);
    let url = format!("http://127.0.0.1:{}/mcp/{}", bridge.port, launch.launch);

    let env = [("QUAY_MCP_URL", url.as_str()), ("QUAY_A2A_TOKEN", bridge.token.as_str())];
    let [initialized, list] = replies(written_entry(), &env).await;

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
    let [initialized, list] = replies(written_entry(), &[]).await;

    assert!(initialized["error"].is_null(), "{initialized}");
    assert!(names(&list).is_empty(), "{list}");
}
