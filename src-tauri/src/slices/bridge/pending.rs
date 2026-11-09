use std::sync::Arc;
use std::time::Duration;
use serde::Serialize;
use tokio::sync::oneshot;

use super::models::{PermissionRequestPayload, PermissionResponsePayload};
use super::state::BridgeState;

/// How long a permission request waits for the user's answer before it is denied.
pub const PERMISSION_TIMEOUT: Duration = Duration::from_secs(600);

/// What the frontend's `permission-resolved` event carries: the request that left the
/// pending list and how it ended.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PermissionResolved {
    #[serde(rename = "requestId")]
    pub request_id: String,
    pub decision: String,
    pub tool: String,
    pub tag: String,
}

/// Receives each `PermissionResolved`; the bridge route sends it to the frontend.
pub type ResolvedSink = Arc<dyn Fn(PermissionResolved) + Send + Sync>;

fn deny(reason: &str) -> PermissionResponsePayload {
    PermissionResponsePayload {
        decision: "deny".to_string(),
        reason: Some(reason.to_string()),
    }
}

/// A permission request registered as pending, whose answer the bridge route waits for.
pub struct PendingAnswer {
    bridge_state: BridgeState,
    payload: PermissionRequestPayload,
    rx: oneshot::Receiver<PermissionResponsePayload>,
    on_resolved: ResolvedSink,
}

impl PendingAnswer {
    /// Registers `payload` as a pending permission request. `on_resolved` hears when it
    /// leaves the pending list. An error when a request with its id is already pending.
    pub fn register(
        bridge_state: &BridgeState,
        payload: PermissionRequestPayload,
        on_resolved: ResolvedSink,
    ) -> Result<Self, String> {
        let (tx, rx) = oneshot::channel();
        bridge_state.register_pending_permission(payload.request_id.clone(), payload.clone(), tx)?;
        Ok(Self {
            bridge_state: bridge_state.clone(),
            payload,
            rx,
            on_resolved,
        })
    }

    /// Waits up to `timeout` for the user's answer, then reports the request resolved and
    /// returns the answer.
    pub async fn wait(mut self, timeout: Duration) -> PermissionResponsePayload {
        let result = match tokio::time::timeout(timeout, &mut self.rx).await {
            Ok(Ok(resp)) => resp,
            Ok(Err(_)) => deny("Permission request channel cancelled"),
            Err(_) => match self.bridge_state.remove_pending_permission(&self.payload.request_id) {
                Some(_) => deny("Timed out waiting for human approval"),
                // The user's answer took it off the list as the wait ran out
                None => self
                    .rx
                    .try_recv()
                    .unwrap_or_else(|_| deny("Permission request channel cancelled")),
            },
        };
        self.report(&result.decision);
        result
    }

    fn report(&self, decision: &str) {
        (self.on_resolved)(PermissionResolved {
            request_id: self.payload.request_id.clone(),
            decision: decision.to_string(),
            tool: self.payload.tool.clone(),
            tag: self.payload.tag.clone().unwrap_or_default(),
        });
    }
}

/// A wait that ends without returning, because the route was dropped with the connection
/// whose client hung up, takes the request off the pending list and reports it `abandoned`.
/// Whoever takes a request off the list resolves it, so a hang-up, the timeout and the
/// user's answer report it resolved once between them.
impl Drop for PendingAnswer {
    fn drop(&mut self) {
        if self
            .bridge_state
            .remove_pending_permission(&self.payload.request_id)
            .is_some()
        {
            self.report("abandoned");
        } else if let Ok(answer) = self.rx.try_recv() {
            // Answered just before the hang-up, and never read by the wait
            self.report(&answer.decision);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{extract::State, routing::post, Json, Router};
    use parking_lot::Mutex;
    use std::time::Instant;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::{TcpListener, TcpStream};

    /// A bridge whose `/v1/permission` route waits on `await_permission_answer` over a real
    /// loopback HTTP listener, with every `PermissionResolved` it reports.
    struct TestBridge {
        state: BridgeState,
        resolved: Arc<Mutex<Vec<PermissionResolved>>>,
        port: u16,
    }

    async fn start_bridge(timeout: Duration) -> TestBridge {
        let state = BridgeState::new();
        let resolved = Arc::new(Mutex::new(Vec::new()));
        let sink_events = resolved.clone();
        let sink: ResolvedSink = Arc::new(move |event| sink_events.lock().push(event));

        let app = Router::new()
            .route(
                "/v1/permission",
                post(
                    move |State(state): State<BridgeState>,
                          Json(payload): Json<PermissionRequestPayload>| {
                        let sink = sink.clone();
                        async move {
                            Json(PendingAnswer::register(&state, payload, sink).unwrap().wait(timeout).await)
                        }
                    },
                ),
            )
            .with_state(state.clone());
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            axum::serve(listener, app.into_make_service()).await.unwrap();
        });
        TestBridge { state, resolved, port }
    }

    /// Opens a connection and sends a permission request for `request_id` on it.
    async fn send_request(port: u16, request_id: &str) -> TcpStream {
        let body = serde_json::json!({
            "requestId": request_id,
            "sessionId": "sess-1",
            "tag": "term-1",
            "tool": "Bash",
            "input": { "command": "ls" },
        })
        .to_string();
        let mut stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        let request = format!(
            "POST /v1/permission HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
            body.len()
        );
        stream.write_all(request.as_bytes()).await.unwrap();
        stream
    }

    /// Reads the bridge's reply on `stream` and returns the answer in its body.
    async fn read_answer(stream: &mut TcpStream) -> serde_json::Value {
        let mut reply = Vec::new();
        let mut buf = [0u8; 1024];
        loop {
            let n = tokio::time::timeout(Duration::from_secs(5), stream.read(&mut buf))
                .await
                .expect("the bridge never replied")
                .unwrap();
            if n == 0 {
                break;
            }
            reply.extend_from_slice(&buf[..n]);
            let text = String::from_utf8_lossy(&reply);
            if let Some((_, body)) = text.split_once("\r\n\r\n") {
                if let Ok(answer) = serde_json::from_str(body) {
                    return answer;
                }
            }
        }
        panic!("no answer in {:?}", String::from_utf8_lossy(&reply));
    }

    /// Waits up to five seconds for `condition` to hold.
    async fn eventually(mut condition: impl FnMut() -> bool) -> bool {
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            if condition() {
                return true;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        condition()
    }

    #[tokio::test]
    async fn a_request_whose_client_hangs_up_leaves_the_pending_list_and_is_reported_resolved() {
        let bridge = start_bridge(PERMISSION_TIMEOUT).await;
        let stream = send_request(bridge.port, "req-hangup").await;
        assert!(eventually(|| bridge.state.list_pending_permissions().len() == 1).await);

        drop(stream);

        assert!(
            eventually(|| bridge.state.list_pending_permissions().is_empty()).await,
            "the hung-up request is still pending"
        );
        let resolved = bridge.resolved.lock().clone();
        assert_eq!(
            resolved,
            vec![PermissionResolved {
                request_id: "req-hangup".to_string(),
                decision: "abandoned".to_string(),
                tool: "Bash".to_string(),
                tag: "term-1".to_string(),
            }]
        );
        assert!(
            bridge.state.resolve_permission("req-hangup", "allow", None, false).is_err(),
            "answering the hung-up request reported success"
        );
    }

    #[tokio::test]
    async fn a_connected_request_stays_pending_and_gets_the_users_answer() {
        let bridge = start_bridge(PERMISSION_TIMEOUT).await;
        let mut stream = send_request(bridge.port, "req-open").await;
        assert!(eventually(|| bridge.state.list_pending_permissions().len() == 1).await);
        tokio::time::sleep(Duration::from_millis(200)).await;
        assert_eq!(bridge.state.list_pending_permissions().len(), 1);
        assert!(bridge.resolved.lock().is_empty());

        bridge
            .state
            .resolve_permission("req-open", "allow", None, false)
            .unwrap();

        assert_eq!(read_answer(&mut stream).await["decision"], "allow");
        assert!(bridge.state.list_pending_permissions().is_empty());
        let decisions: Vec<String> =
            bridge.resolved.lock().iter().map(|r| r.decision.clone()).collect();
        assert_eq!(decisions, vec!["allow".to_string()]);
    }

    #[tokio::test]
    async fn a_connected_request_is_denied_when_its_wait_runs_out() {
        let bridge = start_bridge(Duration::from_millis(300)).await;
        let mut stream = send_request(bridge.port, "req-slow").await;

        let answer = read_answer(&mut stream).await;

        assert_eq!(answer["decision"], "deny");
        assert_eq!(answer["reason"], "Timed out waiting for human approval");
        assert!(bridge.state.list_pending_permissions().is_empty());
        let decisions: Vec<String> =
            bridge.resolved.lock().iter().map(|r| r.decision.clone()).collect();
        assert_eq!(decisions, vec!["deny".to_string()]);
    }
}
