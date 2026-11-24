//! The seam the surface tools are tested at: `/mcp` over a real loopback listener, with a fake CLI
//! that posts tool calls with a terminal's token and a fake webview that checks, draws and answers.

use std::future::Future;
use std::sync::{Arc, OnceLock};
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
use crate::slices::bridge::routes::{create_router, AppContext};
use crate::slices::bridge::BridgeState;
use crate::slices::machina::MachinaManager;
use crate::slices::orchestrator::{connect_surfaces, A2ARouter};
use crate::slices::pty::manager::PtyManager;
use crate::slices::pty::models::{test_terminal, ClaudeStatus, RunKind};
use crate::slices::pty::plugin_watch::LaunchRef;
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

/// A Quay server on loopback with two Claude terminals in a turn, `term-a` and `term-b`.
pub struct Seam {
    pub surfaces: SurfaceTools,
    pub pty_manager: PtyManager,
    bridge_state: BridgeState,
    port: u16,
    _dir: TempDir,
}

pub async fn start(timing: Timing) -> (Seam, FakeWebview) {
    start_with(true, timing).await
}

/// `offered` is whether the build lists and accepts the surface tools.
pub async fn start_with(offered: bool, timing: Timing) -> (Seam, FakeWebview) {
    keep_errors_logged();
    let dir = TempDir::new("surface-seam");
    let surfaces = SurfaceTools::with(offered, timing);
    let (checks_tx, checks) = mpsc::unbounded_channel();
    let (shown_tx, shown) = mpsc::unbounded_channel();
    let (removed_tx, removed) = mpsc::unbounded_channel();
    surfaces.set_webview(Sent { checks: checks_tx, shown: shown_tx, removed: removed_tx });

    let pty_manager = PtyManager::new();
    let a2a_router = A2ARouter::new();
    a2a_router.follow_turns(&pty_manager);
    connect_surfaces(&surfaces, &pty_manager, &a2a_router);
    let bridge_state = BridgeState::new();
    let app = create_router(AppContext {
        bridge_state: bridge_state.clone(),
        pty_manager: pty_manager.clone(),
        a2a_router,
        machina_manager: MachinaManager::with_paths(dir.join("state.json"), dir.join("vault")),
        surfaces: surfaces.clone(),
        webview: WebviewEvents::to(|_, _| {}),
    });
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        axum::serve(listener, app.into_make_service()).await.unwrap();
    });
    let seam = Seam { surfaces, pty_manager, bridge_state, port, _dir: dir };
    for id in ["term-a", "term-b"] {
        seam.open_terminal(id, RunKind::Claude, ClaudeStatus::Working);
    }
    (seam, FakeWebview { checks, shown, removed })
}

impl Seam {
    /// A CLI in `terminal_id`, with that terminal's own token.
    pub fn cli(&self, terminal_id: &str) -> FakeCli {
        let token = self.bridge_state.token_for(terminal_id);
        FakeCli { terminal_id: terminal_id.to_string(), port: self.port, token }
    }

    /// Opens a terminal, or launches an open one again, with nothing typed into it.
    pub fn open_terminal(&self, id: &str, kind: RunKind, status: ClaudeStatus) -> LaunchRef {
        self.pty_manager.insert_test_terminal(test_terminal(id, kind, status));
        self.pty_manager.begin_launch(id, kind)
    }

    /// The question `title` as `terminal_id`'s request `id`, once it has been drawn.
    pub async fn asked_as(&self, webview: &mut FakeWebview, terminal_id: &str, id: Value, title: &str) -> OpenCall {
        self.drawn(webview, terminal_id, id, title, true).await
    }

    /// The question `title` of `terminal_id`, once it has been drawn.
    pub async fn asked(&self, webview: &mut FakeWebview, terminal_id: &str, title: &str) -> OpenCall {
        self.drawn(webview, terminal_id, json!(1), title, true).await
    }

    /// `asked`, for a surface that asks for nothing.
    pub async fn shown(&self, webview: &mut FakeWebview, terminal_id: &str, title: &str) -> OpenCall {
        self.drawn(webview, terminal_id, json!(1), title, false).await
    }

    async fn drawn(&self, webview: &mut FakeWebview, terminal_id: &str, id: Value, title: &str, asks: bool) -> OpenCall {
        let call = self.cli(terminal_id).call_as(id, "quay_ask", question(title));
        self.surfaces.verdict(webview.next_check().await.call, accepted(asks));
        webview.next_shown().await;
        call
    }

    /// The operator types `data` into `terminal_id`'s pane.
    pub fn operator_types(&self, terminal_id: &str, data: &str) {
        self.pty_manager.write_from_operator(terminal_id, data).unwrap();
    }

    /// Everything typed into `terminal_id` so far.
    pub fn typed(&self, terminal_id: &str) -> String {
        self.pty_manager.test_input(terminal_id).concat()
    }

    /// Everything typed into `terminal_id` once an Enter ends it.
    pub async fn typed_soon(&self, terminal_id: &str) -> String {
        let entered = async {
            while !self.typed(terminal_id).ends_with('\r') {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        };
        tokio::time::timeout(SOON, entered).await.expect("nothing was typed");
        self.typed(terminal_id)
    }
}

#[derive(Clone)]
pub struct FakeCli {
    terminal_id: String,
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
        self.post_as(json!(1), method, params)
    }

    /// `post`, with `id` as the request's id.
    pub fn post_as(&self, id: Value, method: &str, params: Value) -> OpenCall {
        let sent = self.send("/mcp", json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }));
        OpenCall(tokio::spawn(async move {
            let (_, body) = sent.await;
            serde_json::from_str(&body).unwrap_or_else(|e| panic!("{e} in {body:?}"))
        }))
    }

    /// Posts a JSON-RPC notification, which is accepted with no answer.
    pub async fn notify(&self, method: &str, params: Value) {
        let (head, _) = self.send("/mcp", json!({ "jsonrpc": "2.0", "method": method, "params": params })).await;
        assert!(head.starts_with("HTTP/1.1 202"), "{head}");
    }

    /// Posts an event of this terminal's, as the event-bridge plugin does, and returns once Quay has
    /// applied it.
    pub async fn event(&self, event_type: &str, data: Value) {
        let event = json!({
            "v": 1, "boot": "boot-1", "seq": 1, "ts": 0, "sessionId": "sess-1",
            "tag": self.terminal_id, "type": event_type, "data": data,
        });
        let (head, _) = self.send("/v1/events", json!({ "events": [event] })).await;
        assert!(head.starts_with("HTTP/1.1 200"), "{head}");
    }

    /// Posts `body` to `path` with this terminal's token. Returns the reply's head and body.
    fn send(&self, path: &str, body: Value) -> impl Future<Output = (String, String)> + Send + 'static {
        let body = body.to_string();
        let request = format!(
            "POST {path} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nAuthorization: Bearer {}\r\n\
             Content-Type: application/json\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{body}",
            self.port,
            self.token,
            body.len()
        );
        let port = self.port;
        async move {
            let mut stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
            stream.write_all(request.as_bytes()).await.unwrap();
            let mut reply = String::new();
            stream.read_to_string(&mut reply).await.unwrap();
            let (head, body) = reply.split_once("\r\n\r\n").unwrap_or_else(|| panic!("no body in {reply:?}"));
            (head.to_string(), body.to_string())
        }
    }

    pub fn call(&self, tool: &str, arguments: Value) -> OpenCall {
        self.call_as(json!(1), tool, arguments)
    }

    /// `call`, with `id` as the request's id.
    pub fn call_as(&self, id: Value, tool: &str, arguments: Value) -> OpenCall {
        self.post_as(id, "tools/call", json!({ "name": tool, "arguments": arguments }))
    }

    /// The names of the tools the server lists to this CLI.
    pub async fn tools(&self) -> Vec<String> {
        let list = self.post("tools/list", json!({})).result().await;
        list["tools"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap().to_string()).collect()
    }
}

pub fn key(terminal_id: &str, id: &str) -> SurfaceKey {
    SurfaceKey::new(terminal_id, id)
}

/// A question with this title and the options Yes and No.
pub fn question(title: &str) -> Value {
    json!({ "questions": [{ "question": title, "options": [{ "label": "Yes" }, { "label": "No" }] }] })
}

/// An answer to the question `title`.
pub fn answer_to(title: &str) -> Value {
    json!({ "answers": [{ "question": title, "chosen": ["Yes"], "text": "skip the suite" }] })
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

/// `accepted` for a question with this many images, of the files `paths`.
pub fn accepted_with_images(images: usize, paths: &[&str]) -> Verdict {
    let Verdict::Accepted(mut surface) = accepted(true) else { unreachable!() };
    surface.images = u32::try_from(images).unwrap();
    surface.image_paths = paths.iter().map(ToString::to_string).collect();
    Verdict::Accepted(surface)
}

/// What a test captures of the error log, on the thread it runs on.
#[derive(Clone, Default)]
pub struct CapturedLog(Arc<Mutex<Vec<u8>>>);

/// Keeps every error worth logging to some subscriber for as long as the tests run. The level of a
/// log statement is cached by what subscribers there are when it is first reached, and a test without a
/// capture that reaches one first, as another starts its capture, would leave it off for that capture.
fn keep_errors_logged() {
    static KEPT: OnceLock<tracing::Dispatch> = OnceLock::new();
    KEPT.get_or_init(|| {
        let nowhere = tracing_subscriber::fmt().with_max_level(tracing::Level::ERROR).with_writer(std::io::sink);
        tracing::Dispatch::new(nowhere.finish())
    });
}

impl CapturedLog {
    /// Captures what is logged as an error on this thread until the guard goes.
    pub fn start() -> (Self, tracing::subscriber::DefaultGuard) {
        keep_errors_logged();
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
