//! The seam the surface tools are tested at: `/mcp` over a real loopback listener, with a fake CLI
//! that posts tool calls with a terminal's token and a fake webview that checks, draws and answers.

use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;

use super::check::{CheckRequest, Verdict};
use super::store::{SurfaceKey, SurfaceRecord};
use super::timing::Timing;
use super::tools::{SurfaceTools, Webview};
use crate::slices::bridge::routes::mcp_router;
use crate::slices::bridge::BridgeState;
use crate::slices::machina::MachinaManager;
use crate::slices::orchestrator::mcp::McpContext;
use crate::slices::orchestrator::A2ARouter;
use crate::slices::pty::manager::PtyManager;
use crate::slices::pty::models::{test_terminal, ClaudeStatus, RunKind};
use crate::test_support::TempDir;
use crate::webview::WebviewEvents;

/// How long a test waits for something that should happen at once.
const SOON: Duration = Duration::from_secs(5);

/// How long a test watches for something that must not happen.
pub const A_WHILE: Duration = Duration::from_millis(200);

/// Waits until `holds`, for as long as something that should happen at once may take.
pub async fn until(holds: impl Fn() -> bool, what: &str) {
    let polling = async {
        while !holds() {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    };
    tokio::time::timeout(SOON, polling).await.expect(what);
}

struct Sent {
    checks: mpsc::UnboundedSender<CheckRequest>,
    shown: mpsc::UnboundedSender<SurfaceRecord>,
    removed: mpsc::UnboundedSender<SurfaceKey>,
}

impl Webview for Sent {
    fn check(&self, request: &CheckRequest) {
        let _ = self.checks.send(request.clone());
    }

    fn show(&self, record: &SurfaceRecord) {
        let _ = self.shown.send(record.clone());
    }

    fn remove(&self, key: &SurfaceKey) {
        let _ = self.removed.send(key.clone());
    }
}

/// What the window was sent.
pub struct FakeWebview {
    checks: mpsc::UnboundedReceiver<CheckRequest>,
    shown: mpsc::UnboundedReceiver<SurfaceRecord>,
    removed: mpsc::UnboundedReceiver<SurfaceKey>,
}

impl FakeWebview {
    /// The next check the window is sent.
    pub async fn next_check(&mut self) -> CheckRequest {
        tokio::time::timeout(SOON, self.checks.recv()).await.expect("no check was sent").unwrap()
    }

    /// The next surface the window is sent to draw.
    pub async fn next_shown(&mut self) -> SurfaceRecord {
        tokio::time::timeout(SOON, self.shown.recv()).await.expect("no surface was sent").unwrap()
    }

    /// The next surface the window is sent to take off the screen.
    pub async fn next_removed(&mut self) -> SurfaceKey {
        tokio::time::timeout(SOON, self.removed.recv()).await.expect("no surface was removed").unwrap()
    }

    /// Whether the window has been sent no surface to take off the screen.
    pub fn none_removed(&mut self) -> bool {
        self.removed.try_recv().is_err()
    }

    /// Whether the window is sent no check for a while.
    pub async fn no_check(&mut self) -> bool {
        tokio::time::timeout(A_WHILE, self.checks.recv()).await.is_err()
    }

    /// Whether the window is sent nothing to draw for a while.
    pub async fn nothing_shown(&mut self) -> bool {
        tokio::time::timeout(A_WHILE, self.shown.recv()).await.is_err()
    }
}

/// A Quay server on loopback with two terminals, `term-a` and `term-b`.
pub struct Seam {
    pub surfaces: SurfaceTools,
    bridge_state: BridgeState,
    port: u16,
    _dir: TempDir,
}

pub async fn start(timing: Timing) -> (Seam, FakeWebview) {
    start_with(true, timing).await
}

/// `offered` is whether the build lists and accepts the surface tools.
pub async fn start_with(offered: bool, timing: Timing) -> (Seam, FakeWebview) {
    let dir = TempDir::new("surface-seam");
    let surfaces = SurfaceTools::with(offered, timing);
    let (checks_tx, checks) = mpsc::unbounded_channel();
    let (shown_tx, shown) = mpsc::unbounded_channel();
    let (removed_tx, removed) = mpsc::unbounded_channel();
    surfaces.set_webview(Sent { checks: checks_tx, shown: shown_tx, removed: removed_tx });

    let pty_manager = PtyManager::new();
    for id in ["term-a", "term-b"] {
        pty_manager.insert_test_terminal(test_terminal(id, RunKind::Claude, ClaudeStatus::Working));
    }
    let bridge_state = BridgeState::new();
    let app = mcp_router(McpContext {
        bridge_state: bridge_state.clone(),
        pty_manager,
        a2a_router: A2ARouter::new(),
        machina_manager: MachinaManager::with_paths(dir.join("state.json"), dir.join("vault")),
        surfaces: surfaces.clone(),
        webview: WebviewEvents::to(|_, _| {}),
    });
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        axum::serve(listener, app.into_make_service()).await.unwrap();
    });
    (Seam { surfaces, bridge_state, port, _dir: dir }, FakeWebview { checks, shown, removed })
}

impl Seam {
    /// A CLI in `terminal_id`, with that terminal's own token.
    pub fn cli(&self, terminal_id: &str) -> FakeCli {
        FakeCli { port: self.port, token: self.bridge_state.token_for(terminal_id) }
    }
}

#[derive(Clone)]
pub struct FakeCli {
    port: u16,
    token: String,
}

/// A request that is open, and its reply once it ends.
pub struct OpenCall(tokio::task::JoinHandle<Value>);

impl OpenCall {
    /// The JSON-RPC reply.
    pub async fn reply(self) -> Value {
        tokio::time::timeout(SOON, self.0).await.expect("the call never returned").unwrap()
    }

    /// The tool result.
    pub async fn result(self) -> Value {
        let reply = self.reply().await;
        assert!(reply["error"].is_null(), "{reply}");
        reply["result"].clone()
    }

    /// The text of a tool result that is no error, read as JSON.
    pub async fn answer(self) -> Value {
        let result = self.result().await;
        assert!(result["isError"].is_null(), "{result}");
        serde_json::from_str(result["content"][0]["text"].as_str().unwrap()).unwrap()
    }

    /// The text of a tool result that says the call failed.
    pub async fn failure(self) -> String {
        let result = self.result().await;
        assert_eq!(result["isError"], true, "{result}");
        result["content"][0]["text"].as_str().unwrap().to_string()
    }

    pub fn is_open(&self) -> bool {
        !self.0.is_finished()
    }

    /// Closes the connection, as a CLI that gives up does.
    pub fn hang_up(self) {
        self.0.abort();
    }
}

impl FakeCli {
    /// Posts a JSON-RPC request and leaves it open.
    pub fn post(&self, method: &str, params: Value) -> OpenCall {
        let body = json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params }).to_string();
        let request = format!(
            "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nAuthorization: Bearer {}\r\n\
             Content-Type: application/json\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{body}",
            self.port,
            self.token,
            body.len()
        );
        let port = self.port;
        OpenCall(tokio::spawn(async move {
            let mut stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
            stream.write_all(request.as_bytes()).await.unwrap();
            let mut reply = String::new();
            stream.read_to_string(&mut reply).await.unwrap();
            let (_, body) = reply.split_once("\r\n\r\n").unwrap_or_else(|| panic!("no body in {reply:?}"));
            serde_json::from_str(body).unwrap_or_else(|e| panic!("{e} in {reply:?}"))
        }))
    }

    pub fn call(&self, tool: &str, arguments: Value) -> OpenCall {
        self.post("tools/call", json!({ "name": tool, "arguments": arguments }))
    }

    /// The names of the tools the server lists to this CLI.
    pub async fn tools(&self) -> Vec<String> {
        let list = self.post("tools/list", json!({})).result().await;
        list["tools"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap().to_string()).collect()
    }
}

/// The verdict of a webview that accepts a surface. Its state stands for what the engine would give.
pub fn accepted(asks: bool) -> Verdict {
    serde_json::from_value(json!({
        "state": { "version": "1.0", "createSurface": { "surfaceId": "ask_1" } },
        "asks": asks,
        "components": 6,
        "images": 0,
    }))
    .unwrap()
}

/// The spec's own question.
pub fn question() -> Value {
    json!({ "questions": [{
        "question": "Which base should this branch take?",
        "options": [
            { "label": "Rebase onto master", "description": "Two conflicts", "recommended": true },
            { "label": "Merge master in" },
        ],
    }] })
}

/// An answer to `question`.
pub fn answer() -> Value {
    json!({ "answers": [{
        "question": "Which base should this branch take?",
        "chosen": ["Rebase onto master"],
        "text": "skip the suite",
    }] })
}

/// A call from `terminal_id` whose question has been drawn.
pub async fn asked(seam: &Seam, webview: &mut FakeWebview, terminal_id: &str) -> OpenCall {
    let call = seam.cli(terminal_id).call("quay_ask", question());
    seam.surfaces.verdict(webview.next_check().await.call, accepted(true));
    webview.next_shown().await;
    call
}

/// What a test captures of the error log, on the thread it runs on.
#[derive(Clone, Default)]
pub struct CapturedLog(Arc<Mutex<Vec<u8>>>);

impl CapturedLog {
    /// Captures what is logged as an error on this thread until the guard goes.
    pub fn start() -> (Self, tracing::subscriber::DefaultGuard) {
        let log = Self::default();
        let writer = log.clone();
        let subscriber = tracing_subscriber::fmt()
            .with_ansi(false)
            .with_max_level(tracing::Level::ERROR)
            .with_writer(move || writer.clone())
            .finish();
        (log, tracing::subscriber::set_default(subscriber))
    }

    pub fn text(&self) -> String {
        String::from_utf8_lossy(&self.0.lock()).into_owned()
    }
}

impl std::io::Write for CapturedLog {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0.lock().extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
