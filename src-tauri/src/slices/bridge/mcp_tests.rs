//! Quay's MCP server as a CLI sees it: `POST /mcp` over a real loopback listener, with a terminal's
//! token. The routes are the app's own; only the webview their events go to is left out.

use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

use super::routes::{create_router, AppContext};
use super::server::bind_bridge_listener;
use super::state::BridgeState;
use super::webview::WebviewEvents;
use crate::slices::machina::MachinaManager;
use crate::slices::orchestrator::A2ARouter;
use crate::slices::pty::manager::PtyManager;
use crate::slices::pty::models::{test_terminal, ClaudeStatus, RunKind};
use crate::test_support::TempDir;

/// How long a reply may take before the test fails.
const REPLY_LIMIT: Duration = Duration::from_secs(10);

/// The bridge's routes on a free loopback port, with one open terminal, until dropped.
struct TestBridge {
    port: u16,
    token: String,
    server: tokio::task::JoinHandle<()>,
    _machina_dir: TempDir,
}

impl Drop for TestBridge {
    fn drop(&mut self) {
        self.server.abort();
    }
}

struct Reply {
    status: u16,
    body: String,
}

impl Reply {
    fn json(&self) -> Value {
        serde_json::from_str(&self.body).unwrap_or_else(|e| panic!("{e}: {:?}", self.body))
    }
}

impl TestBridge {
    async fn start() -> Self {
        let machina_dir = TempDir::new("mcp-bridge");
        let bridge_state = BridgeState::new();
        let pty_manager = PtyManager::new();
        pty_manager.insert_test_terminal(test_terminal("term-mcp", RunKind::Claude, ClaudeStatus::Idle));
        let token = bridge_state.token_for("term-mcp");

        let listener = bind_bridge_listener(None).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let router = create_router(AppContext {
            bridge_state,
            pty_manager,
            a2a_router: A2ARouter::new(),
            machina_manager: MachinaManager::with_paths(
                machina_dir.join("state.json"),
                machina_dir.join("vault"),
            ),
            webview: WebviewEvents::to(|_, _| Ok(())),
        });
        let server = tokio::spawn(async move {
            axum::serve(listener, router.into_make_service()).await.unwrap();
        });
        Self { port, token, server, _machina_dir: machina_dir }
    }

    /// Posts `message` to `/mcp` with the open terminal's token.
    async fn post(&self, message: &Value) -> Reply {
        tokio::time::timeout(REPLY_LIMIT, self.exchange(message)).await.expect("a reply from /mcp")
    }

    async fn exchange(&self, message: &Value) -> Reply {
        let body = message.to_string();
        let request = format!(
            "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nAuthorization: Bearer {}\r\n\
             Content-Type: application/json\r\nAccept: application/json, text/event-stream\r\n\
             Content-Length: {}\r\nConnection: close\r\n\r\n{}",
            self.port,
            self.token,
            body.len(),
            body
        );
        let mut stream = TcpStream::connect(("127.0.0.1", self.port)).await.unwrap();
        stream.write_all(request.as_bytes()).await.unwrap();
        let mut reply = String::new();
        stream.read_to_string(&mut reply).await.unwrap();

        let (head, body) = reply.split_once("\r\n\r\n").expect("an HTTP reply");
        let status = head.split(' ').nth(1).and_then(|code| code.parse().ok()).expect("a status code");
        Reply { status, body: body.to_string() }
    }
}

/// MCP 2026-07-28, "Streamable HTTP", section "Backward Compatibility": on `400 Bad Request`, "if the
/// body is empty or is not a recognized modern JSON-RPC error, fall back to `initialize`".
#[tokio::test]
async fn server_discover_is_told_to_fall_back_to_the_handshake() {
    let bridge = TestBridge::start().await;

    let reply = bridge
        .post(&json!({
            "jsonrpc": "2.0",
            "id": "discover-1",
            "method": "server/discover",
            "params": { "_meta": { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } }
        }))
        .await;

    assert_eq!((reply.status, reply.body.as_str()), (400, ""));
}

#[tokio::test]
async fn every_other_unknown_method_is_answered_method_not_found() {
    let bridge = TestBridge::start().await;

    for method in ["server/discovered", "Server/Discover", "server", "resources/read", ""] {
        let reply = bridge.post(&json!({ "jsonrpc": "2.0", "id": 7, "method": method })).await;

        assert_eq!(reply.status, 200, "{method:?}");
        assert_eq!(
            reply.json(),
            json!({
                "jsonrpc": "2.0",
                "id": 7,
                "error": { "code": -32601, "message": format!("Method '{method}' not found") }
            })
        );
    }
}

/// A notification gets no answer whatever it names, so only a `server/discover` request is refused.
#[tokio::test]
async fn a_server_discover_notification_is_accepted_as_any_notification_is() {
    let bridge = TestBridge::start().await;

    let reply = bridge.post(&json!({ "jsonrpc": "2.0", "method": "server/discover" })).await;

    assert_eq!((reply.status, reply.body.as_str()), (202, ""));
}

#[tokio::test]
async fn a_cli_that_falls_back_completes_the_handshake_and_lists_quays_tools() {
    let bridge = TestBridge::start().await;
    bridge.post(&json!({ "jsonrpc": "2.0", "id": 0, "method": "server/discover" })).await;

    let initialized = bridge
        .post(&json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": { "protocolVersion": "2025-11-25", "capabilities": {} }
        }))
        .await;
    let listed = bridge.post(&json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" })).await;

    assert_eq!(initialized.status, 200);
    assert_eq!(initialized.json()["result"]["protocolVersion"], "2025-11-25");
    assert_eq!(listed.status, 200);
    let listed = listed.json();
    let names: Vec<&str> = listed["result"]["tools"]
        .as_array()
        .expect("a tool list")
        .iter()
        .map(|tool| tool["name"].as_str().expect("a tool name"))
        .collect();
    assert_eq!(
        names,
        [
            "quay_list_agents",
            "quay_send_message",
            "quay_broadcast",
            "quay_get_agent_status",
            "machina_submit_work_order",
            "machina_get_work_order",
            "machina_submit_deliverable",
        ]
    );
}
