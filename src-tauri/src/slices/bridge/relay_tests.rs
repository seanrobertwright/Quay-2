//! The relay sidecar this build made, run as a CLI runs it, against a loopback listener that
//! serves and authenticates `/mcp` as Quay's bridge does. The relay's own package tests the
//! rest of what it does.

use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, Stdio};
use std::time::{Duration, Instant};

use axum::extract::State;
use axum::http::HeaderMap;
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{Json, Router};
use serde_json::{json, Value};
use tokio::net::TcpListener;
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver, UnboundedSender};

use super::routes::authenticate_mcp_caller;
use super::state::BridgeState;

const SOON: Duration = Duration::from_secs(10);

/// What the listener saw.
#[derive(Debug, PartialEq)]
enum Seen {
    Refused,
    Called(Value),
    /// The connection of the call with this id closed before its reply.
    HungUp(Value),
}

/// Reports a hang-up when it is dropped with the call it belongs to.
struct Waiting(Value, UnboundedSender<Seen>);

impl Drop for Waiting {
    fn drop(&mut self) {
        let _ = self.1.send(Seen::HungUp(self.0.clone()));
    }
}

/// `/mcp`, whose `wait` method never replies and whose other methods reply at once.
async fn mcp(
    State((bridge, seen)): State<(BridgeState, UnboundedSender<Seen>)>,
    headers: HeaderMap,
    Json(request): Json<Value>,
) -> Response {
    if let Err(rejection) = authenticate_mcp_caller(&bridge, &headers, ["term-ag".to_string()]) {
        let _ = seen.send(Seen::Refused);
        return rejection.into_response();
    }
    let id = request["id"].clone();
    let _ = seen.send(Seen::Called(request["method"].clone()));
    if request["method"] == "wait" {
        let _waiting = Waiting(id, seen);
        std::future::pending::<()>().await;
        unreachable!();
    }
    Json(json!({ "jsonrpc": "2.0", "id": id, "result": {} })).into_response()
}

async fn start_quay() -> (String, String, UnboundedReceiver<Seen>) {
    let bridge = BridgeState::new();
    let token = bridge.token_for("term-ag");
    let (sender, seen) = unbounded_channel();
    let app = Router::new().route("/mcp", post(mcp)).with_state((bridge, sender));
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let url = format!("http://127.0.0.1:{}/mcp", listener.local_addr().unwrap().port());
    tokio::spawn(async move {
        axum::serve(listener, app.into_make_service()).await.unwrap();
    });
    (url, token, seen)
}

async fn next(seen: &mut UnboundedReceiver<Seen>) -> Seen {
    tokio::time::timeout(SOON, seen.recv()).await.expect("nothing reached Quay").unwrap()
}

/// The built relay as a child process, killed when dropped.
struct Relay {
    child: Child,
    replies: UnboundedReceiver<Value>,
}

impl Relay {
    fn start(url: &str, token: &str) -> Relay {
        let program = Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries").join(format!(
            "quay-relay-{}{}",
            env!("QUAY_SIDECAR_TARGET"),
            std::env::consts::EXE_SUFFIX
        ));
        let mut child = crate::spawn::hidden_command(&program)
            .env("QUAY_MCP_URL", url)
            .env("QUAY_A2A_TOKEN", token)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap_or_else(|e| panic!("the app's build makes {}: {e}", program.display()));
        let (sender, replies) = unbounded_channel();
        let stdout = BufReader::new(child.stdout.take().unwrap());
        std::thread::spawn(move || {
            for line in stdout.lines().map_while(Result::ok) {
                let reply = serde_json::from_str(&line).expect("only protocol on stdout");
                if sender.send(reply).is_err() {
                    break;
                }
            }
        });
        Relay { child, replies }
    }

    fn send(&mut self, message: Value) {
        writeln!(self.child.stdin.as_mut().unwrap(), "{message}").unwrap();
    }

    async fn next(&mut self) -> Value {
        tokio::time::timeout(SOON, self.replies.recv()).await.expect("no reply").unwrap()
    }

    async fn exits(&mut self) -> bool {
        let deadline = Instant::now() + SOON;
        while Instant::now() < deadline {
            if self.child.try_wait().unwrap().is_some() {
                return true;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        false
    }
}

impl Drop for Relay {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[tokio::test]
async fn the_bundled_relay_reaches_mcp_as_its_terminal_and_a_cancel_hangs_up_one_call() {
    let (url, token, mut seen) = start_quay().await;
    let mut relay = Relay::start(&url, &token);

    relay.send(json!({ "jsonrpc": "2.0", "id": 1, "method": "wait" }));
    assert_eq!(next(&mut seen).await, Seen::Called(json!("wait")));
    relay.send(json!({ "jsonrpc": "2.0", "id": 2, "method": "wait" }));
    assert_eq!(next(&mut seen).await, Seen::Called(json!("wait")));
    relay.send(json!({ "jsonrpc": "2.0", "id": 3, "method": "ping" }));
    assert_eq!(next(&mut seen).await, Seen::Called(json!("ping")));
    assert_eq!(relay.next().await, json!({ "jsonrpc": "2.0", "id": 3, "result": {} }));

    relay.send(json!({ "jsonrpc": "2.0", "method": "notifications/cancelled", "params": { "requestId": 1 } }));
    let told = [next(&mut seen).await, next(&mut seen).await];
    assert!(told.contains(&Seen::HungUp(json!(1))), "{told:?}");
    assert!(told.contains(&Seen::Called(json!("notifications/cancelled"))), "{told:?}");

    // The other call hangs up only with the relay, which ends with its stdin
    assert!(seen.try_recv().is_err());
    relay.child.stdin = None;
    assert_eq!(next(&mut seen).await, Seen::HungUp(json!(2)));
    assert!(relay.exits().await, "the relay outlived its stdin");
}

#[tokio::test]
async fn the_bundled_relay_tells_the_cli_when_quay_refuses_its_token() {
    let (url, _, mut seen) = start_quay().await;
    let mut relay = Relay::start(&url, "stale");

    relay.send(json!({ "jsonrpc": "2.0", "id": 1, "method": "ping" }));
    assert_eq!(next(&mut seen).await, Seen::Refused);
    assert_eq!(relay.next().await["error"]["message"], "Quay's MCP server answered HTTP 401.");
}

#[test]
fn the_installer_holds_the_relay() {
    let config: Value = serde_json::from_str(include_str!("../../../tauri.conf.json")).unwrap();
    let sidecars = config["bundle"]["externalBin"].as_array().unwrap();
    assert!(sidecars.contains(&json!("binaries/quay-relay")), "{sidecars:?}");
}
