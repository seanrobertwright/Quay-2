//! Quay's view of an OpenCode 2.x terminal's turns. Each OpenCode 2.x terminal has its own
//! `opencode serve` (see `opencode_serve`), which answers only its launch's password, sent as
//! Basic auth. Quay reads two things from its `/api`: the event stream, `GET /api/event`, for when
//! the main session's execution starts and ends, and the session's messages, `GET
//! /api/session/:id/message`, newest first, for the reply once a turn ends. Quay only reads from
//! that server: messages are still typed into the terminal.

use std::collections::{HashMap, HashSet};

use http_body_util::{BodyExt, Empty};
use hyper::body::{Bytes, Incoming};
use hyper::Request;
use hyper_util::rt::TokioIo;
use serde_json::Value;

use super::opencode_serve::OpenCodeServer;
use super::opencode_watch::{
    is_plain_id, SseDecoder, TurnEvent, WatchEnd, CONNECT_BUDGET, CONNECT_TIMEOUT, READ_TIMEOUT, RETRY,
};

/// The event stream, with only the events the turn tracker reads, so a turn's streamed text
/// doesn't come along. OpenCode's heartbeat comments still do.
const EVENTS_PATH: &str = "/api/event?types=session.created&types=session.execution.started\
    &types=session.execution.succeeded&types=session.execution.failed&types=session.execution.interrupted";

/// The most of a session's messages, newest first, read for a turn's reply.
const REPLY_PAGE: usize = 50;

/// Why a read from an OpenCode 2.x server failed. `status` is the HTTP status the server
/// answered with, and `None` when it answered nothing Quay could read as a response.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct GetError {
    pub status: Option<u16>,
    message: String,
}

impl GetError {
    fn unreached(message: impl ToString) -> GetError {
        GetError { status: None, message: message.to_string() }
    }
}

impl std::fmt::Display for GetError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

/// Sends `GET path` to `server`, with its launch's password, and returns the response, once its
/// status says it succeeded. Nothing else is sent, and a redirect is not followed.
async fn get(server: &OpenCodeServer, path: &str) -> Result<hyper::Response<Incoming>, GetError> {
    let port = server.port();
    let stream = tokio::time::timeout(CONNECT_TIMEOUT, tokio::net::TcpStream::connect(("127.0.0.1", port)))
        .await
        .map_err(|_| GetError::unreached("connecting timed out"))?
        .map_err(GetError::unreached)?;
    let (mut sender, connection) =
        hyper::client::conn::http1::handshake(TokioIo::new(stream)).await.map_err(GetError::unreached)?;
    tokio::spawn(connection);
    let request = Request::get(path)
        .header("host", format!("127.0.0.1:{}", port))
        .header("authorization", server.authorization())
        .body(Empty::<Bytes>::new())
        .map_err(GetError::unreached)?;
    let response = sender.send_request(request).await.map_err(GetError::unreached)?;
    if !response.status().is_success() {
        return Err(GetError {
            status: Some(response.status().as_u16()),
            message: format!("{} answered {}", path, response.status()),
        });
    }
    Ok(response)
}

/// Reads one JSON document from `server`. A success that isn't JSON, such as the web app's page,
/// fails with its status.
pub(super) async fn get_json(server: &OpenCodeServer, path: &str) -> Result<Value, GetError> {
    let read = async {
        let response = get(server, path).await?;
        let status = response.status().as_u16();
        let body = response.into_body().collect().await.map_err(GetError::unreached)?;
        serde_json::from_slice(&body.to_bytes())
            .map_err(|e| GetError { status: Some(status), message: format!("{} isn't JSON: {}", path, e) })
    };
    tokio::time::timeout(READ_TIMEOUT, read)
        .await
        .map_err(|_| GetError::unreached(format!("reading {} timed out", path)))?
}

/// What one event from OpenCode's stream means for the terminal's turn.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Step {
    Nothing,
    Started,
    /// The main session `0`'s execution ended; its reply is to be read.
    Ended(String),
    /// Session `0`'s execution started, and the tracker can't tell whether it is a main session
    /// or a child until it learns its `parentID`.
    Unknown(String),
}

/// Follows OpenCode 2.x's session events and reports each main session's turn: from its
/// execution starting to its execution ending, whether that succeeded, failed or was
/// interrupted. A child session, one with a `parentID` (a subagent's), never starts or ends one.
#[derive(Default)]
struct TurnTracker {
    /// Each session seen, and whether it is a child.
    child: HashMap<String, bool>,
    /// The main sessions now in a turn.
    busy: HashSet<String>,
}

impl TurnTracker {
    /// Records whether session `id` is a child.
    fn learn(&mut self, id: &str, is_child: bool) {
        self.child.insert(id.to_string(), is_child);
    }

    fn step(&mut self, event: &Value) -> Step {
        let data = &event["data"];
        let Some(id) = data["sessionID"].as_str() else {
            return Step::Nothing;
        };
        match event["type"].as_str() {
            Some("session.created") => {
                self.learn(id, data.get("parentID").is_some_and(|p| !p.is_null()));
                Step::Nothing
            }
            Some("session.execution.started") => match self.child.get(id) {
                None => Step::Unknown(id.to_string()),
                Some(true) => Step::Nothing,
                Some(false) if self.busy.insert(id.to_string()) => Step::Started,
                Some(false) => Step::Nothing,
            },
            Some("session.execution.succeeded" | "session.execution.failed" | "session.execution.interrupted")
                if self.busy.remove(id) =>
            {
                Step::Ended(id.to_string())
            }
            _ => Step::Nothing,
        }
    }

    /// Ends the turn of each main session that `active` (`GET /api/session/active`, which lists
    /// only the sessions that are running) doesn't show running, and returns their ids: their
    /// end came while Quay wasn't subscribed.
    fn settle(&mut self, active: &Value) -> Vec<String> {
        let running = &active["data"];
        let mut ended: Vec<String> = self
            .busy
            .iter()
            .filter(|id| running[id.as_str()]["type"] != "running")
            .cloned()
            .collect();
        ended.sort();
        for id in &ended {
            self.busy.remove(id);
        }
        ended
    }
}

/// An assistant message's text, from its text content.
fn assistant_text(message: &Value) -> String {
    message["content"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|part| part["type"] == "text")
        .filter_map(|part| part["text"].as_str())
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

/// The reply in a page of a session's messages (`GET /api/session/:id/message`, newest first):
/// the text of the newest assistant message since the latest prompt, a `user` message. A
/// compaction or a message OpenCode adds itself has a type of its own, so it is not a prompt.
/// `None` when nothing since the prompt has text.
fn reply_text(page: &Value) -> Option<String> {
    page["data"]
        .as_array()?
        .iter()
        .take_while(|message| message["type"] != "user")
        .filter(|message| message["type"] == "assistant")
        .map(assistant_text)
        .find(|text| !text.is_empty())
}

/// What a sender waiting on the turn gets, from a page of the session's messages or the error
/// that stopped Quay reading them.
fn answer_from(page: Result<Value, GetError>) -> String {
    match page {
        Ok(page) => reply_text(&page).unwrap_or_else(|| "(OpenCode's turn ended without a text reply.)".to_string()),
        Err(e) => format!("(OpenCode's turn ended, but Quay couldn't read its reply: {})", e),
    }
}

/// The reply of session `id`'s latest turn, from `server`.
async fn read_answer(server: &OpenCodeServer, id: &str) -> String {
    answer_from(get_json(server, &format!("/api/session/{}/message?limit={}&order=desc", id, REPLY_PAGE)).await)
}

/// Watches `server`, an OpenCode 2.x terminal's own, until `running` says the launch has stopped,
/// and hands `on_turn` each turn of the terminal's main session. It keeps trying to reach the
/// server while OpenCode starts, and again if the stream drops; after `CONNECT_BUDGET` without
/// one it gives up. `running` is checked between attempts and at each chunk of the stream, which
/// OpenCode's heartbeat comments keep coming, so a watch ends soon after its launch stops.
pub async fn watch(server: &OpenCodeServer, running: impl Fn() -> bool, mut on_turn: impl FnMut(TurnEvent)) -> WatchEnd {
    let mut tracker = TurnTracker::default();
    let mut trying_since = tokio::time::Instant::now();

    loop {
        if !running() {
            return WatchEnd::Stopped;
        }
        if trying_since.elapsed() >= CONNECT_BUDGET {
            return WatchEnd::GaveUp;
        }
        let Ok(stream) = get(server, EVENTS_PATH).await else {
            tokio::time::sleep(RETRY).await;
            continue;
        };

        // A turn that ended while the stream was down never sends its end again
        let active = match tracker.busy.is_empty() {
            true => None,
            false => get_json(server, "/api/session/active").await.ok(),
        };
        for id in active.map(|a| tracker.settle(&a)).unwrap_or_default() {
            on_turn(TurnEvent::Ended { answer: read_answer(server, &id).await });
        }

        let mut body = stream.into_body();
        let mut decoder = SseDecoder::default();
        while let Some(Ok(frame)) = body.frame().await {
            if !running() {
                return WatchEnd::Stopped;
            }
            let Ok(chunk) = frame.into_data() else {
                continue;
            };
            for data in decoder.push(&chunk) {
                let Ok(event) = serde_json::from_str::<Value>(&data) else {
                    continue;
                };
                let mut step = tracker.step(&event);
                if let Step::Unknown(id) = &step {
                    if !is_plain_id(id) {
                        continue;
                    }
                    // A session the stream never announced, such as one OpenCode made before
                    // Quay connected: its own record says whether it is a child
                    let Ok(session) = get_json(server, &format!("/api/session/{}", id)).await else {
                        continue;
                    };
                    tracker.learn(id, session["data"].get("parentID").is_some_and(|p| !p.is_null()));
                    step = tracker.step(&event);
                }
                match step {
                    Step::Started => on_turn(TurnEvent::Started),
                    Step::Ended(id) if is_plain_id(&id) => {
                        on_turn(TurnEvent::Ended { answer: read_answer(server, &id).await });
                    }
                    _ => {}
                }
            }
        }
        trying_since = tokio::time::Instant::now();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::slices::pty::opencode_serve::{launch_of, OpenCodeLaunch};
    use serde_json::json;
    use std::time::Duration;

    /// An event as OpenCode 2.4.1 streams it.
    fn event(kind: &str, session: &str) -> Value {
        json!({"id": "evt_1", "created": 1, "type": kind, "data": {"sessionID": session}})
    }

    fn created(session: &str, parent: Option<&str>) -> Value {
        let mut data = json!({"sessionID": session, "slug": "kind-cabin", "version": "2.4.1"});
        if let Some(parent) = parent {
            data["parentID"] = json!(parent);
        }
        json!({"id": "evt_0", "created": 1, "type": "session.created", "data": data})
    }

    fn steps(tracker: &mut TurnTracker, events: &[Value]) -> Vec<Step> {
        events.iter().map(|e| tracker.step(e)).filter(|s| *s != Step::Nothing).collect()
    }

    #[test]
    fn a_main_session_turn_runs_from_its_execution_start_to_its_end() {
        let mut tracker = TurnTracker::default();
        let events = [
            created("ses_main", None),
            event("session.execution.started", "ses_main"),
            event("session.execution.started", "ses_main"),
            event("session.execution.succeeded", "ses_main"),
            event("session.execution.succeeded", "ses_main"),
        ];
        assert_eq!(steps(&mut tracker, &events), [Step::Started, Step::Ended("ses_main".into())]);
    }

    #[test]
    fn a_failed_or_interrupted_execution_ends_the_turn_too() {
        let mut tracker = TurnTracker::default();
        let events = [
            created("ses_main", None),
            event("session.execution.started", "ses_main"),
            event("session.execution.failed", "ses_main"),
            event("session.execution.started", "ses_main"),
            event("session.execution.interrupted", "ses_main"),
        ];
        assert_eq!(
            steps(&mut tracker, &events),
            [Step::Started, Step::Ended("ses_main".into()), Step::Started, Step::Ended("ses_main".into())]
        );
    }

    #[test]
    fn a_child_sessions_executions_are_ignored() {
        let mut tracker = TurnTracker::default();
        let events = [
            created("ses_main", None),
            event("session.execution.started", "ses_main"),
            created("ses_child", Some("ses_main")),
            event("session.execution.started", "ses_child"),
            event("session.execution.succeeded", "ses_child"),
            event("session.execution.succeeded", "ses_main"),
        ];
        assert_eq!(steps(&mut tracker, &events), [Step::Started, Step::Ended("ses_main".into())]);
    }

    #[test]
    fn an_execution_of_a_session_never_announced_asks_what_it_is() {
        let mut tracker = TurnTracker::default();
        let started = event("session.execution.started", "ses_early");
        assert_eq!(tracker.step(&started), Step::Unknown("ses_early".into()));
        tracker.learn("ses_early", false);
        assert_eq!(tracker.step(&started), Step::Started);
        // An end with no turn running ends nothing
        assert_eq!(tracker.step(&event("session.execution.succeeded", "ses_other")), Step::Nothing);
    }

    #[test]
    fn a_turn_that_ended_while_disconnected_ends_when_the_server_no_longer_lists_it_running() {
        let mut tracker = TurnTracker::default();
        steps(&mut tracker, &[created("ses_a", None), created("ses_b", None)]);
        steps(&mut tracker, &[event("session.execution.started", "ses_a"), event("session.execution.started", "ses_b")]);

        // `GET /api/session/active` as OpenCode 2.4.1 answers it
        assert_eq!(tracker.settle(&json!({"data": {"ses_b": {"type": "running"}}})), ["ses_a"]);
        assert!(tracker.settle(&json!({"data": {"ses_b": {"type": "running"}}})).is_empty());
        assert_eq!(tracker.settle(&json!({"data": {}})), ["ses_b"]);
        assert!(steps(&mut tracker, &[event("session.execution.succeeded", "ses_b")]).is_empty());
    }

    /// A page of messages as OpenCode 2.4.1 answered it, newest first, for a turn that called a
    /// tool and then answered.
    fn live_page() -> Value {
        json!({"data": [
            {"id": "msg_4", "type": "idle", "outcome": "succeeded"},
            {"id": "msg_3", "type": "assistant", "agent": "build",
             "content": [{"type": "text", "text": "GOT PONG {\"word\":\"hi\"}"}], "finish": "stop"},
            {"id": "msg_2", "type": "assistant", "agent": "build",
             "content": [{"type": "tool", "id": "c1", "name": "quay_quay_ping",
                          "state": {"status": "completed", "content": [{"type": "text", "text": "PONG"}]}}],
             "finish": "tool-calls"},
            {"id": "msg_1", "type": "user", "text": "CALL quay_ping {\"word\":\"hi\"}"}
        ], "cursor": {"previous": "x", "next": "y"}})
    }

    #[test]
    fn the_reply_is_the_newest_assistant_text_since_the_latest_prompt() {
        assert_eq!(reply_text(&live_page()).as_deref(), Some("GOT PONG {\"word\":\"hi\"}"));

        let page = json!({"data": [
            {"id": "msg_6", "type": "assistant", "content": [{"type": "reasoning", "text": "hmm"}]},
            {"id": "msg_5", "type": "assistant", "content": [{"type": "text", "text": "Two findings:"}, {"type": "text", "text": "1. a bug"}]},
            {"id": "msg_4", "type": "synthetic", "text": "Continue if you have next steps"},
            {"id": "msg_3", "type": "user", "text": "[Peer agent (alpha)]: review it"},
            {"id": "msg_2", "type": "assistant", "content": [{"type": "text", "text": "old answer"}]},
            {"id": "msg_1", "type": "user", "text": "old question"}
        ]});
        assert_eq!(reply_text(&page).as_deref(), Some("Two findings:\n1. a bug"));
    }

    #[test]
    fn a_prompt_with_no_text_back_has_no_reply() {
        let page = json!({"data": [
            {"id": "msg_3", "type": "assistant", "content": [{"type": "tool", "name": "shell"}]},
            {"id": "msg_2", "type": "user", "text": "do it"},
            {"id": "msg_1", "type": "assistant", "content": [{"type": "text", "text": "an earlier turn's"}]}
        ]});
        assert_eq!(reply_text(&page), None);
        assert_eq!(answer_from(Ok(page)), "(OpenCode's turn ended without a text reply.)");
        assert!(answer_from(Err(GetError::unreached("timed out"))).contains("couldn't read its reply: timed out"));
    }

    fn server_on(port: u16) -> OpenCodeServer {
        match launch_of(Some("opencode v2.4.1"), port) {
            OpenCodeLaunch::Server(server) => server,
            OpenCodeLaunch::Tui(_) => panic!("2.4.1 is launched as 2.x"),
        }
    }

    /// Serves `events` as OpenCode 2.x's event stream to the first subscriber only, and `page`
    /// as session `ses_main`'s messages, which is a main session, to a request with `server`'s
    /// password and no other, as `opencode serve` does. Returns the server Quay would watch.
    async fn fake_opencode(events: Vec<Value>, page: Value) -> OpenCodeServer {
        use axum::{
            extract::{Path, Query},
            http::{HeaderMap, StatusCode},
            routing::get,
            Json, Router,
        };
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::Arc;

        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let server = server_on(listener.local_addr().unwrap().port());
        let authorization = server.authorization();
        let authorized = move |headers: &HeaderMap| {
            headers.get("authorization").and_then(|v| v.to_str().ok()) == Some(authorization.as_str())
        };
        let (events_auth, session_auth, messages_auth) = (authorized.clone(), authorized.clone(), authorized);
        let served = Arc::new(AtomicBool::new(false));
        let stream: String = events.iter().map(|e| format!("data: {}\n\n: heartbeat\n\n", e)).collect();
        let app = Router::new()
            .route(
                "/api/event",
                get(move |headers: HeaderMap, Query(query): Query<Vec<(String, String)>>| async move {
                    if !events_auth(&headers) {
                        return Err(StatusCode::UNAUTHORIZED);
                    }
                    let types: Vec<&str> =
                        query.iter().filter(|(k, _)| k == "types").map(|(_, v)| v.as_str()).collect();
                    assert!(types.contains(&"session.execution.started"), "{types:?}");
                    if served.swap(true, Ordering::SeqCst) {
                        Err(StatusCode::SERVICE_UNAVAILABLE)
                    } else {
                        Ok(([("content-type", "text/event-stream")], stream))
                    }
                }),
            )
            .route(
                "/api/session/{id}",
                get(move |headers: HeaderMap, Path(id): Path<String>| async move {
                    if !session_auth(&headers) {
                        return Err(StatusCode::UNAUTHORIZED);
                    }
                    Ok(Json(json!({"data": {"id": id}})))
                }),
            )
            .route(
                "/api/session/{id}/message",
                get(move |headers: HeaderMap, Path(id): Path<String>| async move {
                    if !messages_auth(&headers) {
                        return Err(StatusCode::UNAUTHORIZED);
                    }
                    if id == "ses_main" { Ok(Json(page)) } else { Err(StatusCode::NOT_FOUND) }
                }),
            );
        tokio::spawn(async move { axum::serve(listener, app).await });
        server
    }

    /// Watches `server` until a turn ends, for at most `limit`, and returns the turns seen.
    async fn turns_of(server: &OpenCodeServer, limit: Duration) -> Vec<TurnEvent> {
        let turns = std::sync::Arc::new(parking_lot::Mutex::new(Vec::new()));
        let (seen, done) = (turns.clone(), turns.clone());
        let end = tokio::time::timeout(
            limit,
            watch(
                server,
                move || !done.lock().iter().any(|t| matches!(t, TurnEvent::Ended { .. })),
                move |turn| seen.lock().push(turn),
            ),
        )
        .await
        .expect("the watcher never saw the turn end");
        assert_eq!(end, WatchEnd::Stopped);
        turns.lock().clone()
    }

    #[tokio::test]
    async fn the_watcher_reports_a_main_session_turn_with_its_reply_and_skips_a_child() {
        // ses_main is never announced, as when the TUI made it before Quay subscribed
        let server = fake_opencode(
            vec![
                json!({"id": "evt_0", "type": "server.connected", "data": {}}),
                event("session.execution.started", "ses_main"),
                created("ses_child", Some("ses_main")),
                event("session.execution.started", "ses_child"),
                event("session.execution.succeeded", "ses_child"),
                event("session.execution.succeeded", "ses_main"),
            ],
            live_page(),
        )
        .await;

        assert_eq!(
            turns_of(&server, Duration::from_secs(10)).await,
            [TurnEvent::Started, TurnEvent::Ended { answer: "GOT PONG {\"word\":\"hi\"}".into() }]
        );
    }

    #[tokio::test]
    async fn the_watcher_stops_once_its_launch_stops_running() {
        let free = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let server = server_on(free.local_addr().unwrap().port());
        drop(free);
        let end = tokio::time::timeout(Duration::from_secs(5), watch(&server, || false, |_| panic!("no turn was expected")))
            .await
            .unwrap();
        assert_eq!(end, WatchEnd::Stopped);
    }

    /// The text of a chat message as an OpenAI-compatible request carries it.
    fn chat_text(message: &Value) -> String {
        match &message["content"] {
            Value::String(text) => text.clone(),
            Value::Array(parts) => parts.iter().filter_map(|p| p["text"].as_str()).collect::<Vec<_>>().join("\n"),
            _ => String::new(),
        }
    }

    /// A scripted OpenAI-compatible model on a free loopback port. To a last user message
    /// `CALL <tool> <json>` it answers with a call of the tool whose name ends in `<tool>`;
    /// to anything else, `GOT <the last message's text>`. Returns its port.
    async fn scripted_model() -> u16 {
        use axum::{routing::post, Json, Router};
        let app = Router::new()
            .route(
                "/v1/chat/completions",
                post(|Json(body): Json<Value>| async move {
                    let messages = body["messages"].as_array().cloned().unwrap_or_default();
                    let last = messages.last().cloned().unwrap_or(Value::Null);
                    let text = chat_text(&last);
                    let tools: Vec<String> = body["tools"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(|t| t["function"]["name"].as_str().map(str::to_string))
                        .collect();
                    let call = (last["role"] == "user")
                        .then(|| text.strip_prefix("CALL "))
                        .flatten()
                        .and_then(|rest| rest.split_once(' '))
                        .and_then(|(name, args)| tools.iter().find(|t| t.ends_with(name)).map(|t| (t.clone(), args.to_string())));
                    let (delta, finish) = match call {
                        Some((tool, args)) => (
                            json!({"role": "assistant", "tool_calls": [{"index": 0, "id": "call_1", "type": "function",
                                   "function": {"name": tool, "arguments": args}}]}),
                            "tool_calls",
                        ),
                        None => (json!({"role": "assistant", "content": format!("GOT {}", text)}), "stop"),
                    };
                    let base = json!({"id": "x", "object": "chat.completion.chunk", "created": 1, "model": "fixed"});
                    let mut first = base.clone();
                    first["choices"] = json!([{"index": 0, "delta": delta, "finish_reason": null}]);
                    let mut end = base;
                    end["choices"] = json!([{"index": 0, "delta": {}, "finish_reason": finish}]);
                    end["usage"] = json!({"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2});
                    let stream = format!("data: {}\n\ndata: {}\n\ndata: [DONE]\n\n", first, end);
                    ([("content-type", "text/event-stream")], stream)
                }),
            )
            .route("/v1/models", axum::routing::get(|| async { Json(json!({"object": "list", "data": [{"id": "fixed"}]})) }));
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move { axum::serve(listener, app).await });
        port
    }

    /// A stand-in for Quay's MCP server on a free loopback port, at any `/mcp/...` path, with one
    /// tool, `quay_ping`, which answers `PONG <its arguments>`. Returns its port.
    async fn fake_quay_mcp() -> u16 {
        use axum::{http::StatusCode, routing::post, Json, Router};
        let app = Router::new().route(
            "/mcp/{launch}",
            post(|Json(message): Json<Value>| async move {
                let Some(id) = message.get("id").cloned() else {
                    return Err(StatusCode::ACCEPTED);
                };
                let result = match message["method"].as_str() {
                    Some("initialize") => json!({"protocolVersion": message["params"]["protocolVersion"],
                        "capabilities": {"tools": {}}, "serverInfo": {"name": "quay", "version": "1"}}),
                    Some("tools/list") => json!({"tools": [{"name": "quay_ping", "description": "Ping Quay",
                        "inputSchema": {"type": "object", "properties": {"word": {"type": "string"}}}}]}),
                    Some("tools/call") => json!({"content": [{"type": "text",
                        "text": format!("PONG {}", message["params"]["arguments"])}]}),
                    _ => json!({}),
                };
                Ok(Json(json!({"jsonrpc": "2.0", "id": id, "result": result})))
            }),
        );
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move { axum::serve(listener, app).await });
        port
    }

    /// Launches the real OpenCode 2.x the way Quay does: the version probe, `opencode serve`
    /// with the launch's password as the terminal's sidecar, waited for as Quay waits for it,
    /// and the TUI connected to it in a PTY with a launch prompt that calls a tool of Quay's MCP
    /// server, then a message typed in as Quay types an A2A one. It watches the server, as
    /// `watch` does for a terminal, for both turns and their replies, and checks the server ends
    /// with its sidecar. Everything OpenCode writes stays in
    /// a scratch home, and its model is a scripted local one, so no account is used and no
    /// prompt leaves the machine; the test fails if a turn ran on any other model.
    /// It is skipped unless `QUAY_OPENCODE2_BIN` names an OpenCode 2.x executable; run it with
    /// `cargo test --lib live_opencode2_turn -- --nocapture`.
    #[tokio::test]
    async fn live_opencode2_turn() {
        use crate::slices::pty::models::{PermissionMode, RunKind, SpawnTerminalRequest};
        use crate::slices::pty::opencode_serve::Sidecar;
        use crate::slices::pty::plugin_watch::LaunchRef;
        use crate::slices::pty::session::{build_serve, opencode_launch};
        use portable_pty::{native_pty_system, PtySize};
        use std::io::{Read, Write};
        use std::sync::Arc;

        let Some(bin) = std::env::var_os("QUAY_OPENCODE2_BIN") else {
            println!("skipped: QUAY_OPENCODE2_BIN names no OpenCode 2.x executable");
            return;
        };
        let bin = std::path::PathBuf::from(bin);
        let bin_dir = bin.parent().expect("the executable's folder").to_path_buf();

        let root = crate::test_support::TempDir::new("live-opencode2");
        let dir = |name: &str| {
            let path = root.join(name);
            std::fs::create_dir_all(&path).unwrap();
            path.to_string_lossy().to_string()
        };
        let model_port = scripted_model().await;
        let bridge_port = fake_quay_mcp().await;
        let workspace_config = json!({
            "provider": {"fake": {"npm": "@ai-sdk/openai-compatible", "name": "Fake",
                "options": {"baseURL": format!("http://127.0.0.1:{}/v1", model_port), "apiKey": "x"},
                "models": {"fixed": {"name": "Fixed"}}}},
            "model": "fake/fixed"
        });
        let home = dir("home");
        let mut path = std::env::join_paths([bin_dir]).unwrap();
        if let Some(system) = std::env::var_os("PATH") {
            path = std::env::join_paths(std::iter::once(path).chain(std::env::split_paths(&system).map(Into::into))).unwrap();
        }
        let env_vars = [
            ("PATH", path.to_string_lossy().to_string()),
            ("USERPROFILE", home.clone()),
            ("HOME", home),
            ("XDG_CONFIG_HOME", dir("home/.config")),
            ("XDG_DATA_HOME", dir("home/.local/share")),
            ("XDG_STATE_HOME", dir("home/.local/state")),
            ("XDG_CACHE_HOME", dir("home/.cache")),
            ("APPDATA", dir("home/AppData/Roaming")),
            ("LOCALAPPDATA", dir("home/AppData/Local")),
            ("TEMP", dir("tmp")),
            ("TMP", dir("tmp")),
            ("OPENCODE_CONFIG_CONTENT", workspace_config.to_string()),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_string(), v))
        .collect();
        let request = SpawnTerminalRequest {
            id: None,
            name: None,
            project_path: dir("project"),
            run_kind: RunKind::OpenCode,
            permission_mode: Some(PermissionMode::Skip),
            command_text: None,
            rows: None,
            cols: None,
            env_vars: Some(env_vars),
            custom_flags: None,
            initial_prompt: Some(r#"CALL quay_ping {"word":"hi"}"#.to_string()),
        };
        let launch = LaunchRef { terminal_id: "term-live-oc2".to_string(), launch: 7 };
        let mcp_url = format!("http://127.0.0.1:{}/mcp/7", bridge_port);

        // The probe and the wait block, as they do on the thread a terminal is spawned on
        let port = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        let started = tokio::task::spawn_blocking(move || {
            let OpenCodeLaunch::Server(server) = opencode_launch(&request, port) else {
                panic!("the probe didn't read OpenCode 2.x");
            };
            let (serve, tui) = build_serve(&request, &launch, bridge_port, "tok-live", &server);
            println!("tui argv: {:?}", tui.get_argv());
            let sidecar = Sidecar::start(serve, &server, &mcp_url, Duration::from_secs(60)).expect("the server is ready");
            (server, sidecar, tui)
        })
        .await
        .unwrap();
        let (server, sidecar, tui) = started;

        let turns = Arc::new(parking_lot::Mutex::new(Vec::new()));
        let (seen, done) = (turns.clone(), turns.clone());
        let watched = server.clone();
        let watcher = tokio::spawn(async move {
            watch(
                &watched,
                move || done.lock().iter().filter(|t| matches!(t, TurnEvent::Ended { .. })).count() < 2,
                move |turn| {
                    println!("turn: {:?}", turn);
                    seen.lock().push(turn);
                },
            )
            .await
        });

        let pair = native_pty_system().openpty(PtySize { rows: 40, cols: 140, pixel_width: 0, pixel_height: 0 }).unwrap();
        let mut child = pair.slave.spawn_command(tui).expect("spawn the OpenCode TUI");
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().unwrap();
        let writer = Arc::new(parking_lot::Mutex::new(pair.master.take_writer().unwrap()));
        let shown = Arc::new(parking_lot::Mutex::new(String::new()));
        let (answers, screen) = (writer.clone(), shown.clone());
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            while let Ok(n) = reader.read(&mut buf) {
                if n == 0 {
                    break;
                }
                let text = String::from_utf8_lossy(&buf[..n]).to_string();
                // Answer ConPTY's cursor-position query so the TUI starts
                if text.contains("\x1b[6n") {
                    let _ = answers.lock().write_all(b"\x1b[1;1R");
                }
                screen.lock().push_str(&text);
            }
        });

        // Once the launch prompt's turn is over, a message typed in as Quay types one: the text,
        // and its Enter after a pause
        let limit = Duration::from_secs(120);
        let ended = |turns: &[TurnEvent]| turns.iter().filter(|t| matches!(t, TurnEvent::Ended { .. })).count();
        let since = std::time::Instant::now();
        while ended(&turns.lock()) < 1 && since.elapsed() < limit {
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
        writer.lock().write_all(b"[Peer agent (alpha)]: are you there").unwrap();
        tokio::time::sleep(Duration::from_millis(250)).await;
        writer.lock().write_all(b"\r").unwrap();
        let end = tokio::time::timeout(limit, watcher).await;
        let _ = child.kill();
        assert!(!shown.lock().contains(server.password()), "the pane showed the password");
        // The launch prompt ran on the configured model, not on one of OpenCode's own
        let sessions = get_json(&server, "/api/session").await.expect("the sessions");
        let models: Vec<&Value> = sessions["data"].as_array().into_iter().flatten().map(|s| &s["model"]).collect();
        assert!(!models.is_empty() && models.iter().all(|m| m["providerID"] == "fake"), "{models:?}");
        let end = end.unwrap_or_else(|_| panic!("no turn end within {}s", limit.as_secs()));
        assert_eq!(end.unwrap(), WatchEnd::Stopped);
        // The launch prompt called Quay's tool, and its reply is the model's answer to it; the
        // typed message is a turn of its own, with its own reply
        assert_eq!(
            *turns.lock(),
            [
                TurnEvent::Started,
                TurnEvent::Ended { answer: r#"GOT PONG {"word":"hi"}"#.to_string() },
                TurnEvent::Started,
                TurnEvent::Ended { answer: "GOT [Peer agent (alpha)]: are you there".to_string() },
            ]
        );

        // Ending the sidecar ends the server
        tokio::task::spawn_blocking(move || sidecar.ender().end()).await.unwrap();
        assert!(get_json(&server, "/api/session/active").await.is_err_and(|e| e.status.is_none()));
    }

    #[tokio::test]
    async fn a_read_with_another_launchs_password_is_turned_down() {
        let theirs = fake_opencode(vec![], json!({"data": []})).await;
        let ours = server_on(theirs.port());
        let refused = get_json(&ours, "/api/session/ses_main/message").await.unwrap_err();
        assert_eq!(refused.status, Some(401));
        assert!(get_json(&theirs, "/api/session/ses_main/message").await.is_ok());
    }
}
