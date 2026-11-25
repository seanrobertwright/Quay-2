//! What Quay's MCP server gives each terminal, as that terminal's CLI sees it: `POST /mcp` over a
//! real loopback listener, with the terminal's token.

use serde_json::{json, Value};

use super::mcp_tests::TestBridge;
use crate::slices::pty::models::{BusLevel, ClaudeStatus, RunKind, ALL_RUN_KINDS};
use crate::slices::pty::plugin_watch::LaunchRef;

/// The tools every full peer has had since before surfaces.
const BUS_TOOLS: [&str; 7] = [
    "quay_list_agents",
    "quay_send_message",
    "quay_broadcast",
    "quay_get_agent_status",
    "machina_submit_work_order",
    "machina_get_work_order",
    "machina_submit_deliverable",
];

const SURFACE_TOOLS: [&str; 6] = [
    "quay_ask",
    "quay_review",
    "quay_board",
    "quay_surface",
    "quay_surface_guide",
    "quay_surface_read",
];

const FULL_PEERS: [RunKind; 4] = [RunKind::Claude, RunKind::Codex, RunKind::OpenCode, RunKind::Pig];

async fn reply(bridge: &TestBridge, method: &str, params: Value) -> Value {
    bridge.post(&json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params })).await.json()
}

async fn result(bridge: &TestBridge, method: &str, params: Value) -> Value {
    let reply = reply(bridge, method, params).await;
    assert!(reply["error"].is_null(), "{reply}");
    reply["result"].clone()
}

async fn listed(bridge: &TestBridge) -> Vec<String> {
    let list = result(bridge, "tools/list", json!({})).await;
    list["tools"].as_array().unwrap().iter().map(|tool| tool["name"].as_str().unwrap().to_string()).collect()
}

#[tokio::test]
async fn a_full_peer_is_listed_the_bus_tools_before_the_surface_tools_and_any_other_terminal_only_these() {
    for run_kind in ALL_RUN_KINDS {
        let bridge = TestBridge::start_with(run_kind).await;

        let tools = listed(&bridge).await;

        let bus: &[&str] = if FULL_PEERS.contains(&run_kind) { &BUS_TOOLS } else { &[] };
        assert_eq!(tools, [bus, &SURFACE_TOOLS].concat(), "{run_kind:?}");
    }
}

#[tokio::test]
async fn the_tools_a_terminal_is_listed_are_the_tools_it_may_call() {
    for run_kind in ALL_RUN_KINDS {
        let bridge = TestBridge::start_with(run_kind).await;
        let listed = listed(&bridge).await;

        let mut accepted = Vec::new();
        for tool in [&BUS_TOOLS[..], &SURFACE_TOOLS, &["quay_unheard_of", ""]].concat() {
            let reply = reply(&bridge, "tools/call", json!({ "name": tool, "arguments": {} })).await;
            if reply["error"]["message"] != format!("Unknown tool: {tool}") {
                accepted.push(tool);
            }
        }

        assert_eq!(accepted, listed, "{run_kind:?}");
        assert!(SURFACE_TOOLS.iter().all(|tool| accepted.contains(tool)), "{run_kind:?}: {accepted:?}");
    }
}

#[tokio::test]
async fn a_terminal_is_refused_a_tool_it_is_not_listed_before_anything_is_done() {
    for run_kind in [RunKind::Antigravity, RunKind::Grok, RunKind::Copilot] {
        let bridge = TestBridge::start_with(run_kind).await;

        for tool in BUS_TOOLS {
            let arguments = json!({
                "target_terminal_id": "term-mcp",
                "terminal_id": "term-mcp",
                "message": "hi",
                "wait_for_reply": false,
                "text": "hi",
                "work_order_id": "WO-1",
            });

            let reply = reply(&bridge, "tools/call", json!({ "name": tool, "arguments": arguments })).await;

            assert_eq!(
                (&reply["result"], &reply["error"]),
                (&Value::Null, &json!({ "code": -32602, "message": format!("Unknown tool: {tool}") })),
                "{run_kind:?}"
            );
        }
        assert!(bridge.pty_manager.test_input("term-mcp").is_empty(), "{run_kind:?}");
    }
}

#[tokio::test]
async fn a_terminal_without_the_bus_tools_still_has_the_surface_tools() {
    let bridge = TestBridge::start_with(RunKind::Antigravity).await;

    let rejected = result(&bridge, "tools/call", json!({ "name": "quay_ask", "arguments": {} })).await;

    assert_eq!(rejected["isError"], true, "quay_ask read the call: {rejected}");
}

#[tokio::test]
async fn the_guide_is_returned_to_every_terminal() {
    for run_kind in ALL_RUN_KINDS {
        let bridge = TestBridge::start_with(run_kind).await;

        let guide = result(&bridge, "tools/call", json!({ "name": "quay_surface_guide" })).await;

        let text = guide["content"][0]["text"].as_str().unwrap_or_else(|| panic!("{run_kind:?}: {guide}"));
        assert!(guide["isError"].is_null() && text.starts_with("# Raw surfaces"), "{run_kind:?}: {text}");
    }
}

#[tokio::test]
async fn a_claude_terminal_whose_plugin_is_silent_keeps_the_bus_tools() {
    let bridge = TestBridge::start_with(RunKind::Claude).await;
    bridge.pty_manager.update_status("term-mcp", ClaudeStatus::Unknown);
    let level = bridge.pty_manager.get_info("term-mcp").unwrap().bus_level();
    assert_eq!(level, Some(BusLevel::Listener));

    assert_eq!(listed(&bridge).await[..BUS_TOOLS.len()], BUS_TOOLS);
    let agents = result(&bridge, "tools/call", json!({ "name": "quay_list_agents" })).await;
    assert!(agents["content"][0]["text"].is_string(), "{agents}");
}

/// The words of `text` that are written as Quay names its tools.
fn tools_named_in(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_ascii_alphanumeric() && c != '_')
        .filter(|word| word.starts_with("quay_") || word.starts_with("machina_"))
        .map(str::to_string)
        .collect()
}

#[tokio::test]
async fn the_instructions_name_each_tool_the_terminal_has_once_and_no_other() {
    for run_kind in ALL_RUN_KINDS {
        let bridge = TestBridge::start_with(run_kind).await;
        let params = json!({ "protocolVersion": "2025-11-25", "capabilities": {} });

        let initialized = result(&bridge, "initialize", params).await;

        let text = initialized["instructions"].as_str().unwrap_or_else(|| panic!("{run_kind:?}: {initialized}"));
        assert_eq!(tools_named_in(text), listed(&bridge).await, "{run_kind:?}");
    }
}

fn handshake() -> Value {
    let params = json!({ "protocolVersion": "2025-11-25", "capabilities": {} });
    json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": params })
}

/// The handshake of the CLI that `launch` started, at the URL Quay starts it with.
async fn shake_hands(bridge: &TestBridge, launch: &LaunchRef) {
    let reply = bridge.post_to(&format!("/mcp/{}", launch.launch), &handshake()).await;
    assert_eq!(reply.status, 200, "{}", reply.body);
    assert_eq!(reply.json()["result"]["serverInfo"]["name"], "quay-a2a", "{}", reply.body);
}

#[tokio::test]
async fn a_terminals_handshake_is_recorded_for_it_alone_and_no_other_request_is_one() {
    let bridge = TestBridge::start_with(RunKind::Antigravity).await;
    let terminals = &bridge.pty_manager;
    let launch = terminals.begin_launch("term-mcp", RunKind::Antigravity);
    let other = terminals.begin_launch("term-other", RunKind::Claude);
    result(&bridge, "ping", json!({})).await;
    listed(&bridge).await;
    assert!(!terminals.handshake_seen("term-mcp"));

    shake_hands(&bridge, &other).await;
    assert!(!terminals.handshake_seen("term-other"), "the token is not its own");

    shake_hands(&bridge, &launch).await;

    assert!(terminals.handshake_seen("term-mcp"));
    assert!(!terminals.handshake_seen("term-other"));
}

#[tokio::test]
async fn a_handshake_is_cleared_when_its_terminal_exits() {
    let bridge = TestBridge::start_with(RunKind::Claude).await;
    let terminals = &bridge.pty_manager;
    let launch = terminals.begin_launch("term-mcp", RunKind::Claude);
    shake_hands(&bridge, &launch).await;
    assert!(terminals.handshake_seen("term-mcp"));

    terminals.exit_launch(&launch, Some(0));

    assert!(!terminals.handshake_seen("term-mcp"));
    shake_hands(&bridge, &launch).await;
    assert!(!terminals.handshake_seen("term-mcp"), "it is from a process that outlived the terminal's");
}

#[tokio::test]
async fn a_handshake_is_cleared_at_relaunch_and_an_old_launchs_exit_leaves_the_new_ones() {
    let bridge = TestBridge::start_with(RunKind::Claude).await;
    let terminals = &bridge.pty_manager;
    let old = terminals.begin_launch("term-mcp", RunKind::Claude);
    shake_hands(&bridge, &old).await;
    assert!(terminals.handshake_seen("term-mcp"));

    let new = terminals.begin_launch("term-mcp", RunKind::Claude);
    assert!(!terminals.handshake_seen("term-mcp"));

    // The terminal is listed as it was until the relaunch has finished
    terminals.update_status("term-mcp", ClaudeStatus::Exited);
    shake_hands(&bridge, &new).await;
    terminals.exit_launch(&old, Some(0));
    assert!(terminals.handshake_seen("term-mcp"));
}

#[tokio::test]
async fn an_old_launchs_handshake_after_a_relaunch_is_not_the_new_ones() {
    let bridge = TestBridge::start_with(RunKind::Claude).await;
    let terminals = &bridge.pty_manager;
    let old = terminals.begin_launch("term-mcp", RunKind::Claude);
    let new = terminals.begin_launch("term-mcp", RunKind::Claude);

    shake_hands(&bridge, &old).await;
    assert!(!terminals.handshake_seen("term-mcp"));

    shake_hands(&bridge, &new).await;
    assert!(terminals.handshake_seen("term-mcp"));
}

#[tokio::test]
async fn a_handshake_that_names_no_launch_is_answered_and_not_recorded() {
    let bridge = TestBridge::start_with(RunKind::Claude).await;
    bridge.pty_manager.begin_launch("term-mcp", RunKind::Claude);

    let reply = bridge.post_to("/mcp", &handshake()).await;

    assert_eq!(reply.json()["result"]["serverInfo"]["name"], "quay-a2a", "{}", reply.body);
    assert!(!bridge.pty_manager.handshake_seen("term-mcp"));
}

#[tokio::test]
async fn a_launch_that_is_no_number_is_refused() {
    let bridge = TestBridge::start_with(RunKind::Claude).await;

    for launch in ["-1", "1.5", "x", "99999999999999999999"] {
        let reply = bridge.post_to(&format!("/mcp/{launch}"), &handshake()).await;
        assert_eq!(reply.status, 400, "{launch}: {}", reply.body);
    }
}

#[tokio::test]
async fn a_closed_terminal_has_no_handshake() {
    let bridge = TestBridge::start_with(RunKind::Claude).await;
    let launch = bridge.pty_manager.begin_launch("term-mcp", RunKind::Claude);
    shake_hands(&bridge, &launch).await;
    assert!(bridge.pty_manager.handshake_seen("term-mcp"));

    bridge.pty_manager.kill("term-mcp").unwrap();

    assert!(!bridge.pty_manager.handshake_seen("term-mcp"));
}
