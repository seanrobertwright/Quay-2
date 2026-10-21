//! Quay's view of an OpenCode terminal's turns. Quay launches OpenCode with `--port`, so
//! its TUI serves an HTTP server there, and reads two things from it: the event stream,
//! `GET /event`, for when the main session goes busy and idle, and the session's messages,
//! `GET /session/:id/message`, for the reply once a turn ends. Quay only reads from that
//! server: messages are still typed into the terminal.

use std::collections::{HashMap, HashSet};
use std::time::Duration;

use http_body_util::{BodyExt, Empty};
use hyper::body::{Bytes, Incoming};
use hyper::Request;
use hyper_util::rt::TokioIo;
use serde_json::Value;

/// How long the watcher keeps trying to reach OpenCode's server, from the launch or from
/// losing its stream, before it gives up.
pub const CONNECT_BUDGET: Duration = Duration::from_secs(60);

/// Pause between attempts to reach OpenCode's server.
const RETRY: Duration = Duration::from_millis(250);

/// How long connecting to OpenCode's server may take.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(2);

/// How long one read of a session or its messages may take.
const READ_TIMEOUT: Duration = Duration::from_secs(5);

/// A turn of the terminal's main session, as the watcher reports it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TurnEvent {
    /// The main session went busy.
    Started,
    /// The main session went idle again, with the reply the turn ended on.
    Ended { answer: String },
}

/// How a watch ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WatchEnd {
    /// The launch stopped running: the terminal exited, closed, or was relaunched.
    Stopped,
    /// OpenCode's server couldn't be reached for `CONNECT_BUDGET`.
    GaveUp,
}

/// Splits a server-sent event stream into the `data` of each event. Other fields and
/// comments are dropped.
#[derive(Default)]
struct SseDecoder {
    pending: Vec<u8>,
    data: Option<String>,
}

impl SseDecoder {
    /// Takes the next chunk of the stream and returns the data of each event it completes.
    fn push(&mut self, chunk: &[u8]) -> Vec<String> {
        self.pending.extend_from_slice(chunk);
        let mut events = Vec::new();
        while let Some(end) = self.pending.iter().position(|&b| b == b'\n') {
            let raw: Vec<u8> = self.pending.drain(..=end).collect();
            let line = String::from_utf8_lossy(&raw[..end]);
            let line = line.strip_suffix('\r').unwrap_or(&line);
            if line.is_empty() {
                events.extend(self.data.take());
            } else if let Some(value) = line.strip_prefix("data:") {
                let value = value.strip_prefix(' ').unwrap_or(value);
                match &mut self.data {
                    Some(data) => {
                        data.push('\n');
                        data.push_str(value);
                    }
                    None => self.data = Some(value.to_string()),
                }
            }
        }
        events
    }
}

/// What one event from OpenCode's stream means for the terminal's turn.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Step {
    Nothing,
    Started,
    /// The main session `0` went idle; its reply is to be read.
    Ended(String),
    /// A status for session `0`, which the tracker can't tell is a main session or a
    /// child until it learns its `parentID`.
    Unknown(String),
}

/// Follows OpenCode's session events and reports each main session's busy-to-idle turn.
/// A child session, one with a `parentID` (a subagent's), never starts or ends a turn.
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
        let properties = &event["properties"];
        match event["type"].as_str() {
            Some("session.created" | "session.updated") => {
                if let Some(id) = properties["info"]["id"].as_str() {
                    self.learn(id, properties["info"].get("parentID").is_some_and(|p| !p.is_null()));
                }
                Step::Nothing
            }
            Some("session.status") => {
                let Some(id) = properties["sessionID"].as_str() else {
                    return Step::Nothing;
                };
                match self.child.get(id) {
                    None => return Step::Unknown(id.to_string()),
                    Some(true) => return Step::Nothing,
                    Some(false) => {}
                }
                match properties["status"]["type"].as_str() {
                    Some("busy" | "retry") if self.busy.insert(id.to_string()) => Step::Started,
                    Some("idle") if self.busy.remove(id) => Step::Ended(id.to_string()),
                    _ => Step::Nothing,
                }
            }
            _ => Step::Nothing,
        }
    }

    /// Ends the turn of each main session that `statuses` (`GET /session/status`, which
    /// lists only sessions that aren't idle) shows idle, and returns their ids: their idle
    /// came while Quay wasn't subscribed.
    fn settle(&mut self, statuses: &Value) -> Vec<String> {
        let mut ended: Vec<String> = self
            .busy
            .iter()
            .filter(|id| statuses[id.as_str()]["type"].as_str().is_none_or(|kind| kind == "idle"))
            .cloned()
            .collect();
        ended.sort();
        for id in &ended {
            self.busy.remove(id);
        }
        ended
    }
}

/// Whether `id` is safe to put in a URL path: OpenCode's ids are letters, digits and `_`,
/// and this also lets `-` through.
fn is_plain_id(id: &str) -> bool {
    !id.is_empty() && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// A message's text, from its text parts that OpenCode didn't write itself.
fn own_text(message: &Value) -> String {
    message["parts"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|part| part["type"] == "text" && part["synthetic"] != true)
        .filter_map(|part| part["text"].as_str())
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

/// The reply in a session's messages (`GET /session/:id/message`, oldest first): the text
/// of the last assistant message answering the latest prompt. A prompt is a user message
/// with text OpenCode didn't write itself, so a compaction and the "Continue" nudge
/// OpenCode adds after one are not prompts, and what answers them is not the reply.
/// `None` when the prompt got no text back.
fn reply_text(messages: &Value) -> Option<String> {
    let messages = messages.as_array()?;
    let prompt = messages.iter().rev().find(|m| {
        m["info"]["role"] == "user"
            && !own_text(m).is_empty()
            && !m["parts"]
                .as_array()
                .is_some_and(|parts| parts.iter().any(|p| p["type"] == "compaction"))
    })?;
    let prompt_id = prompt["info"]["id"].as_str()?;
    messages
        .iter()
        .rev()
        .filter(|m| m["info"]["role"] == "assistant" && m["info"]["parentID"] == prompt_id)
        .map(own_text)
        .find(|text| !text.is_empty())
}

/// What a sender waiting on the turn gets, from the session's messages or the error that
/// stopped Quay reading them.
fn answer_from(messages: Result<Value, String>) -> String {
    match messages {
        Ok(messages) => reply_text(&messages)
            .unwrap_or_else(|| "(OpenCode's turn ended without a text reply.)".to_string()),
        Err(e) => format!("(OpenCode's turn ended, but Quay couldn't read its reply: {})", e),
    }
}

/// Sends `GET path` to OpenCode's server on loopback `port` and returns the response, once
/// its status says it succeeded. Nothing is sent but the path: Quay holds no credential for
/// this server, and a redirect is not followed.
async fn get(port: u16, path: &str) -> Result<hyper::Response<Incoming>, String> {
    let stream = tokio::time::timeout(CONNECT_TIMEOUT, tokio::net::TcpStream::connect(("127.0.0.1", port)))
        .await
        .map_err(|_| "connecting timed out".to_string())?
        .map_err(|e| e.to_string())?;
    let (mut sender, connection) = hyper::client::conn::http1::handshake(TokioIo::new(stream))
        .await
        .map_err(|e| e.to_string())?;
    tokio::spawn(connection);
    let request = Request::get(path)
        .header("host", format!("127.0.0.1:{}", port))
        .body(Empty::<Bytes>::new())
        .map_err(|e| e.to_string())?;
    let response = sender.send_request(request).await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("{} answered {}", path, response.status()));
    }
    Ok(response)
}

/// Reads one JSON document from OpenCode's server.
async fn get_json(port: u16, path: &str) -> Result<Value, String> {
    let read = async {
        let body = get(port, path).await?.into_body().collect().await.map_err(|e| e.to_string())?;
        serde_json::from_slice(&body.to_bytes()).map_err(|e| e.to_string())
    };
    tokio::time::timeout(READ_TIMEOUT, read)
        .await
        .map_err(|_| format!("reading {} timed out", path))?
}

/// Watches the OpenCode server on loopback `port` until `running` says the launch has
/// stopped, and hands `on_turn` each turn of the terminal's main session. It keeps trying
/// to reach the server while OpenCode starts, and again if the stream drops; after
/// `CONNECT_BUDGET` without one it gives up. `running` is checked between attempts and at
/// each chunk of the stream, which OpenCode's heartbeat events keep coming, so a watch
/// ends soon after its launch stops even while the server lives on.
pub async fn watch(
    port: u16,
    running: impl Fn() -> bool,
    mut on_turn: impl FnMut(TurnEvent),
) -> WatchEnd {
    let mut tracker = TurnTracker::default();
    let mut trying_since = tokio::time::Instant::now();

    loop {
        if !running() {
            return WatchEnd::Stopped;
        }
        if trying_since.elapsed() >= CONNECT_BUDGET {
            return WatchEnd::GaveUp;
        }
        let Ok(stream) = get(port, "/event").await else {
            tokio::time::sleep(RETRY).await;
            continue;
        };

        // A turn that ended while the stream was down never sends its idle again
        let statuses = match tracker.busy.is_empty() {
            true => None,
            false => get_json(port, "/session/status").await.ok(),
        };
        for id in statuses.map(|s| tracker.settle(&s)).unwrap_or_default() {
            let messages = get_json(port, &format!("/session/{}/message", id)).await;
            on_turn(TurnEvent::Ended { answer: answer_from(messages) });
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
                    // A session the stream never announced, such as one OpenCode made
                    // before Quay connected: its own record says whether it is a child
                    let Ok(session) = get_json(port, &format!("/session/{}", id)).await else {
                        continue;
                    };
                    tracker.learn(id, session.get("parentID").is_some_and(|p| !p.is_null()));
                    step = tracker.step(&event);
                }
                match step {
                    Step::Started => on_turn(TurnEvent::Started),
                    Step::Ended(id) if is_plain_id(&id) => {
                        let messages = get_json(port, &format!("/session/{}/message", id)).await;
                        on_turn(TurnEvent::Ended { answer: answer_from(messages) });
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
    use serde_json::json;

    fn status(session: &str, kind: &str) -> Value {
        json!({"type": "session.status", "properties": {"sessionID": session, "status": {"type": kind}}})
    }

    fn created(session: &str, parent: Option<&str>) -> Value {
        let mut info = json!({"id": session, "slug": "kind-rocket"});
        if let Some(parent) = parent {
            info["parentID"] = json!(parent);
        }
        json!({"type": "session.created", "properties": {"sessionID": session, "info": info}})
    }

    fn steps(tracker: &mut TurnTracker, events: &[Value]) -> Vec<Step> {
        events.iter().map(|e| tracker.step(e)).filter(|s| *s != Step::Nothing).collect()
    }

    #[test]
    fn the_decoder_yields_each_events_data_however_the_stream_is_cut() {
        let stream = "data: {\"type\":\"server.connected\"}\n\n: comment\nid: 7\ndata: {\"a\":\r\ndata: 1}\r\n\r\n";
        let whole = SseDecoder::default().push(stream.as_bytes());
        assert_eq!(whole, ["{\"type\":\"server.connected\"}", "{\"a\":\n1}"]);

        let mut decoder = SseDecoder::default();
        let byte_at_a_time: Vec<String> =
            stream.bytes().flat_map(|b| decoder.push(&[b])).collect();
        assert_eq!(byte_at_a_time, whole);
    }

    #[test]
    fn the_decoder_keeps_text_split_inside_a_character() {
        let stream = "data: na\u{ef}ve\n\n".as_bytes();
        let mut decoder = SseDecoder::default();
        let (first, rest) = stream.split_at(9);
        assert!(decoder.push(first).is_empty());
        assert_eq!(decoder.push(rest), ["na\u{ef}ve"]);
    }

    #[test]
    fn a_main_session_turn_starts_once_and_ends_at_its_idle() {
        let mut tracker = TurnTracker::default();
        let events = [
            created("ses_main", None),
            status("ses_main", "busy"),
            status("ses_main", "busy"),
            status("ses_main", "retry"),
            status("ses_main", "idle"),
            json!({"type": "session.idle", "properties": {"sessionID": "ses_main"}}),
        ];
        assert_eq!(steps(&mut tracker, &events), [Step::Started, Step::Ended("ses_main".into())]);
    }

    #[test]
    fn an_idle_with_no_turn_running_ends_nothing() {
        let mut tracker = TurnTracker::default();
        let events = [created("ses_main", None), status("ses_main", "idle")];
        assert!(steps(&mut tracker, &events).is_empty());
    }

    #[test]
    fn a_child_sessions_turns_are_ignored() {
        let mut tracker = TurnTracker::default();
        let events = [
            created("ses_main", None),
            status("ses_main", "busy"),
            created("ses_child", Some("ses_main")),
            status("ses_child", "busy"),
            status("ses_child", "idle"),
            status("ses_main", "idle"),
        ];
        assert_eq!(steps(&mut tracker, &events), [Step::Started, Step::Ended("ses_main".into())]);
    }

    #[test]
    fn each_busy_idle_pair_is_a_turn_of_its_own() {
        // A follow-up turn OpenCode starts by itself is a turn too; Quay pairs it with no message
        let mut tracker = TurnTracker::default();
        let events = [
            created("ses_main", None),
            status("ses_main", "busy"),
            status("ses_main", "idle"),
            status("ses_main", "busy"),
            status("ses_main", "idle"),
        ];
        assert_eq!(
            steps(&mut tracker, &events),
            [Step::Started, Step::Ended("ses_main".into()), Step::Started, Step::Ended("ses_main".into())]
        );
    }

    #[test]
    fn a_turn_whose_idle_came_while_disconnected_ends_when_the_server_says_it_is_idle() {
        let mut tracker = TurnTracker::default();
        steps(&mut tracker, &[created("ses_a", None), created("ses_b", None)]);
        steps(&mut tracker, &[status("ses_a", "busy"), status("ses_b", "busy")]);

        // `GET /session/status` lists only sessions that aren't idle
        let mut ended = tracker.settle(&json!({"ses_b": {"type": "busy"}}));
        assert_eq!(ended, ["ses_a"]);
        assert!(tracker.settle(&json!({"ses_b": {"type": "busy"}})).is_empty());
        ended = tracker.settle(&json!({"ses_b": {"type": "idle"}}));
        assert_eq!(ended, ["ses_b"]);
        // Its idle, arriving later after all, ends nothing more
        assert!(steps(&mut tracker, &[status("ses_b", "idle")]).is_empty());
    }

    #[test]
    fn a_status_for_a_session_never_announced_asks_what_it_is() {
        let mut tracker = TurnTracker::default();
        let busy = status("ses_early", "busy");
        assert_eq!(tracker.step(&busy), Step::Unknown("ses_early".into()));
        tracker.learn("ses_early", false);
        assert_eq!(tracker.step(&busy), Step::Started);

        tracker.learn("ses_sub", true);
        assert_eq!(tracker.step(&status("ses_sub", "busy")), Step::Nothing);
    }

    fn message(id: &str, role: &str, parent: Option<&str>, parts: Value) -> Value {
        let mut info = json!({"id": id, "role": role});
        if let Some(parent) = parent {
            info["parentID"] = json!(parent);
        }
        json!({"info": info, "parts": parts})
    }

    #[test]
    fn the_reply_is_the_text_answering_the_prompt_not_a_compaction_or_its_nudge() {
        // The shape of a live OpenCode 1.19.3 session that compacted after answering
        let messages = json!([
            message("msg_1", "user", None, json!([{"type": "text", "text": "Reply with the single word pong"}])),
            message("msg_2", "assistant", Some("msg_1"), json!([
                {"type": "step-start"},
                {"type": "reasoning", "text": "The user just wants a single word response."},
                {"type": "text", "text": "pong"},
                {"type": "step-finish", "reason": "stop"}
            ])),
            message("msg_3", "user", None, json!([{"type": "compaction", "auto": true, "overflow": false}])),
            message("msg_4", "assistant", Some("msg_3"), json!([{"type": "text", "text": "## Objective\n- ..."}])),
            message("msg_5", "user", None, json!([{"type": "text", "text": "Continue if you have next steps", "synthetic": true}])),
            message("msg_6", "assistant", Some("msg_5"), json!([{"type": "text", "text": "Nothing more to do."}])),
        ]);
        assert_eq!(reply_text(&messages).as_deref(), Some("pong"));
    }

    #[test]
    fn the_reply_comes_from_the_last_assistant_message_with_text_for_the_latest_prompt() {
        let messages = json!([
            message("msg_1", "user", None, json!([{"type": "text", "text": "old question"}])),
            message("msg_2", "assistant", Some("msg_1"), json!([{"type": "text", "text": "old answer"}])),
            message("msg_3", "user", None, json!([{"type": "text", "text": "[Peer agent (alpha)]: review it"}])),
            message("msg_4", "assistant", Some("msg_3"), json!([
                {"type": "text", "text": "Let me look."},
                {"type": "tool", "tool": "read"}
            ])),
            message("msg_5", "assistant", Some("msg_3"), json!([
                {"type": "text", "text": "Two findings:"},
                {"type": "text", "text": "1. a bug"}
            ])),
            message("msg_6", "assistant", Some("msg_3"), json!([{"type": "step-finish"}])),
        ]);
        assert_eq!(reply_text(&messages).as_deref(), Some("Two findings:\n1. a bug"));
    }

    #[test]
    fn a_prompt_with_no_text_back_has_no_reply() {
        let messages = json!([
            message("msg_1", "user", None, json!([{"type": "text", "text": "do it"}])),
            message("msg_2", "assistant", Some("msg_1"), json!([{"type": "tool", "tool": "bash"}])),
        ]);
        assert_eq!(reply_text(&messages), None);
        assert_eq!(answer_from(Ok(messages)), "(OpenCode's turn ended without a text reply.)");
        assert!(answer_from(Err("timed out".into())).contains("couldn't read its reply: timed out"));
    }

    /// Serves `events` as OpenCode's event stream to the first subscriber only, and
    /// `messages` for session `ses_main`, which is a main session.
    async fn fake_opencode(events: Vec<Value>, messages: Value) -> u16 {
        use axum::{extract::Path, http::StatusCode, routing::get, Json, Router};
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::Arc;

        let served = Arc::new(AtomicBool::new(false));
        let stream: String = events.iter().map(|e| format!("data: {}\n\n", e)).collect();
        let app = Router::new()
            .route(
                "/event",
                get(move || async move {
                    if served.swap(true, Ordering::SeqCst) {
                        Err(StatusCode::SERVICE_UNAVAILABLE)
                    } else {
                        Ok(([("content-type", "text/event-stream")], stream))
                    }
                }),
            )
            .route(
                "/session/{id}",
                get(|Path(id): Path<String>| async move { Json(json!({"id": id})) }),
            )
            .route(
                "/session/{id}/message",
                get(move |Path(id): Path<String>| async move {
                    if id == "ses_main" { Ok(Json(messages)) } else { Err(StatusCode::NOT_FOUND) }
                }),
            );
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move { axum::serve(listener, app).await });
        port
    }

    #[tokio::test]
    async fn the_watcher_reports_a_main_session_turn_with_its_reply_and_skips_a_child() {
        let messages = json!([
            message("msg_1", "user", None, json!([{"type": "text", "text": "[Peer agent (alpha)]: ping"}])),
            message("msg_2", "assistant", Some("msg_1"), json!([{"type": "text", "text": "pong"}])),
        ]);
        // ses_main is never announced, as when OpenCode made it before Quay subscribed
        let port = fake_opencode(
            vec![
                json!({"type": "server.connected", "properties": {}}),
                status("ses_main", "busy"),
                created("ses_child", Some("ses_main")),
                status("ses_child", "busy"),
                status("ses_child", "idle"),
                status("ses_main", "idle"),
            ],
            messages,
        )
        .await;

        let turns = std::sync::Arc::new(parking_lot::Mutex::new(Vec::new()));
        let seen = turns.clone();
        let done = turns.clone();
        let end = tokio::time::timeout(
            Duration::from_secs(10),
            watch(
                port,
                move || !done.lock().contains(&TurnEvent::Ended { answer: "pong".into() }),
                move |turn| seen.lock().push(turn),
            ),
        )
        .await
        .expect("the watcher never saw the turn end");

        assert_eq!(end, WatchEnd::Stopped);
        assert_eq!(
            *turns.lock(),
            [TurnEvent::Started, TurnEvent::Ended { answer: "pong".into() }]
        );
    }

    #[tokio::test]
    async fn the_watcher_stops_once_its_launch_stops_running() {
        let free = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = free.local_addr().unwrap().port();
        drop(free);
        let end = tokio::time::timeout(
            Duration::from_secs(5),
            watch(port, || false, |_| panic!("no turn was expected")),
        )
        .await
        .unwrap();
        assert_eq!(end, WatchEnd::Stopped);
    }

    /// Launches the real OpenCode TUI the way Quay does, types a prompt into it, and
    /// watches its server for the turn. The user's own OpenCode config is left out, through
    /// an empty `XDG_CONFIG_HOME`, so its MCP servers and plugins can't change the turn. Set
    /// `QUAY_OPENCODE_MODEL` to pick the model, as `provider/model`. Run with
    /// `cargo test live_opencode_turn -- --ignored --nocapture`.
    #[tokio::test]
    #[ignore]
    async fn live_opencode_turn() {
        use crate::slices::pty::models::{PermissionMode, RunKind, SpawnTerminalRequest};
        use portable_pty::{native_pty_system, PtySize};
        use std::io::{Read, Write};
        use std::sync::Arc;

        let root = std::env::temp_dir().join(format!("quay-live-opencode-{}", std::process::id()));
        let project = root.join("project");
        let config_home = root.join("config");
        std::fs::create_dir_all(&project).unwrap();
        std::fs::create_dir_all(&config_home).unwrap();
        let request = SpawnTerminalRequest {
            id: None,
            name: None,
            project_path: project.to_string_lossy().to_string(),
            run_kind: RunKind::OpenCode,
            permission_mode: Some(PermissionMode::Skip),
            command_text: None,
            rows: None,
            cols: None,
            env_vars: Some(
                [("XDG_CONFIG_HOME".to_string(), config_home.to_string_lossy().to_string())]
                    .into_iter()
                    .collect(),
            ),
            custom_flags: std::env::var("QUAY_OPENCODE_MODEL").ok().map(|m| format!("--model {}", m)),
            initial_prompt: None,
        };
        let port = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        let cmd = crate::slices::pty::session::build_command(&request, "term-live-oc", 47999, "tok-live", Some(port));
        println!("argv: {:?}", cmd.get_argv());

        let pair = native_pty_system()
            .openpty(PtySize { rows: 40, cols: 140, pixel_width: 0, pixel_height: 0 })
            .unwrap();
        let mut child = pair.slave.spawn_command(cmd).expect("spawn opencode");
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().unwrap();
        let writer = Arc::new(parking_lot::Mutex::new(pair.master.take_writer().unwrap()));
        let answers = writer.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            while let Ok(n) = reader.read(&mut buf) {
                if n == 0 {
                    break;
                }
                // Answer ConPTY's cursor-position query so the TUI starts
                if String::from_utf8_lossy(&buf[..n]).contains("\x1b[6n") {
                    let _ = answers.lock().write_all(b"\x1b[1;1R");
                }
            }
        });

        let turns = Arc::new(parking_lot::Mutex::new(Vec::new()));
        let seen = turns.clone();
        let done = turns.clone();
        let watcher = tokio::spawn(watch(
            port,
            move || !done.lock().iter().any(|t| matches!(t, TurnEvent::Ended { .. })),
            move |turn| {
                println!("turn: {:?}", turn);
                seen.lock().push(turn);
            },
        ));

        // Wait for the server, then check the Quay MCP server from the config variable is listed
        let mcp = loop {
            if let Ok(mcp) = get_json(port, "/mcp").await {
                break mcp;
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        };
        println!("/mcp: {}", mcp);
        assert!(mcp.get("quay").is_some(), "OpenCode didn't load the quay server: {}", mcp);

        tokio::time::sleep(Duration::from_secs(8)).await;
        writer.lock().write_all(b"Reply with the single word pong and nothing else").unwrap();
        tokio::time::sleep(Duration::from_secs(2)).await;
        writer.lock().write_all(b"\r").unwrap();

        let limit = Duration::from_secs(180);
        let end = tokio::time::timeout(limit, watcher).await;
        if end.is_err() {
            println!("/session/status: {:?}", get_json(port, "/session/status").await);
            if let Ok(sessions) = get_json(port, "/session").await {
                for session in sessions.as_array().into_iter().flatten().take(1) {
                    let id = session["id"].as_str().unwrap_or_default();
                    let messages = get_json(port, &format!("/session/{}/message", id)).await;
                    for m in messages.iter().flat_map(|m| m.as_array().cloned().unwrap_or_default()) {
                        let parts: Vec<_> = m["parts"].as_array().into_iter().flatten().map(|p| p["type"].clone()).collect();
                        println!("{} {} {:?} {:?}", m["info"]["role"], m["info"]["finish"], parts, own_text(&m).chars().take(60).collect::<String>());
                    }
                }
            }
        }
        let _ = child.kill();
        let _ = std::fs::remove_dir_all(&root);
        let end = end.unwrap_or_else(|_| panic!("no turn end within {}s", limit.as_secs()));
        assert_eq!(end.unwrap(), WatchEnd::Stopped);
        let turns = turns.lock();
        assert_eq!(turns[0], TurnEvent::Started);
        assert_eq!(turns.last(), Some(&TurnEvent::Ended { answer: "pong".into() }));
    }

    #[test]
    fn only_plain_ids_go_in_a_url() {
        assert!(is_plain_id("ses_e9febf605ffebOKVi0vlBLN3tT"));
        for id in ["", "../config", "ses/1", "ses?x=1", "ses 1"] {
            assert!(!is_plain_id(id), "{:?}", id);
        }
    }
}
