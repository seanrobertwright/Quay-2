//! Quay's MCP server as a CLI sees it: `POST /mcp` over a real loopback listener, with a terminal's
//! token. The routes are the app's own; only the webview their events go to is left out.

use serde_json::{json, Value};

use super::mcp::tool_list;
use super::A2ARouter;
use crate::slices::bridge::routes::{create_router, AppContext};
use crate::slices::bridge::server::bind_bridge_listener;
use crate::slices::bridge::BridgeState;
use crate::slices::machina::MachinaManager;
use crate::slices::pty::manager::PtyManager;
use crate::slices::pty::models::{test_terminal, ClaudeStatus, RunKind};
use crate::test_support::loopback::{post_json, read_reply, Reply};
use crate::test_support::TempDir;
use crate::webview::WebviewEvents;

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
            webview: WebviewEvents::to(|_, _| {}),
        });
        let server = tokio::spawn(async move {
            axum::serve(listener, router.into_make_service()).await.unwrap();
        });
        Self { port, token, server, _machina_dir: machina_dir }
    }

    /// Posts `message` to `/mcp` with the open terminal's token.
    async fn post(&self, message: &Value) -> Reply {
        let bearer = format!("Bearer {}", self.token);
        let headers = [
            ("Authorization", bearer.as_str()),
            ("Accept", "application/json, text/event-stream"),
        ];
        read_reply(post_json(self.port, "/mcp", &headers, message).await).await
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
    assert_eq!(listed.json()["result"]["tools"], *tool_list());
}
