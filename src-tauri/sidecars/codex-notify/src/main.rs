//! Quay's Codex turn-end helper, bundled with Quay as a sidecar. Quay launches Codex with
//! `-c notify=["<this program>"]`, so Codex runs it after each turn with the turn's JSON
//! payload as the last argument. A main-loop turn becomes one `turn.completed` event on
//! Quay's bridge, tagged with the terminal's id and carrying the turn's last assistant
//! message as its answer. A subagent's turn is dropped.
//!
//! Codex passes its environment on, so the bridge URL, terminal id and bearer token come
//! from the `QUAY_*` variables Quay sets on the Codex terminal, and the token never
//! touches disk or a command line.
//!
//! Each payload adds one line to `codex-notify.log` in Quay's data folder, naming its
//! `thread-id` and `client` and never its messages.

use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::ExitCode;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::{Value, json};

const EVENTS_URL_VAR: &str = "QUAY_EVENTS_URL";
const TERMINAL_ID_VAR: &str = "QUAY_TERMINAL_ID";
const TOKEN_VAR: &str = "QUAY_A2A_TOKEN";

const CONNECT_TIMEOUT: Duration = Duration::from_secs(2);
const IO_TIMEOUT: Duration = Duration::from_secs(5);

/// The log starts over once it reaches this size.
const LOG_CAP: u64 = 256 * 1024;

fn main() -> ExitCode {
    let payload = std::env::args().skip(1).last();
    let var = |name: &str| std::env::var(name).ok();
    let (line, ok) = handle(payload.as_deref(), &var, unix_ms());
    if let Some(path) = log_path(&var) {
        append_log(&path, &format!("{} {}", unix_ms(), line));
    }
    if ok { ExitCode::SUCCESS } else { ExitCode::FAILURE }
}

/// Handles one `notify` payload and returns its log line and whether it went as it should:
/// a main turn posted to the bridge, or a subagent's turn dropped.
fn handle(payload: Option<&str>, var: &dyn Fn(&str) -> Option<String>, now_ms: u64) -> (String, bool) {
    let Some(raw) = payload else {
        return ("failed: Codex passed no payload".to_string(), false);
    };
    let payload: Value = match serde_json::from_str(raw) {
        Ok(value) => value,
        Err(e) => return (format!("failed: the payload is not JSON: {}", e), false),
    };
    let who = describe(&payload);
    if !is_main_turn(&payload) {
        return (format!("dropped {}: empty input-messages", who), true);
    }
    if is_title_turn(&payload) {
        return (format!("dropped {}: Codex's task-title turn", who), true);
    }
    let sent = bridge_from_env(var).and_then(|bridge| {
        let batch = turn_completed_batch(&payload, &bridge.tag, now_ms);
        post_events(&bridge.events_url, &bridge.token, &batch.to_string())
    });
    match sent {
        Ok(status) => (format!("posted {}: bridge answered {}", who, status), true),
        Err(e) => (format!("failed {}: {}", who, e), false),
    }
}

/// Whether `payload` is a main-loop turn. Codex also runs `notify` for a subagent's turn,
/// whose `input-messages` is empty; a main turn always carries the prompt that started it.
fn is_main_turn(payload: &Value) -> bool {
    payload
        .get("input-messages")
        .and_then(Value::as_array)
        .is_some_and(|messages| !messages.is_empty())
}

/// How the prompt starts that Codex's TUI sends, on a hidden thread of its own, to name a new
/// task. That turn's payload looks like a main turn's (Codex 0.163.0 sends it with `client`
/// `codex-tui` and the user's prompt quoted inside its own) and it can end before the main
/// turn does, so its JSON title would otherwise answer a waiting sender.
const TITLE_PROMPT_START: &str = "Generate a concise, single-line task title";

/// Whether `payload` is the turn in which Codex's TUI names a new task.
fn is_title_turn(payload: &Value) -> bool {
    payload
        .get("input-messages")
        .and_then(|messages| messages.get(0))
        .and_then(Value::as_str)
        .is_some_and(|prompt| prompt.starts_with(TITLE_PROMPT_START))
}

/// The payload's `thread-id` and `client` for the log, each as a JSON string, or `none`.
fn describe(payload: &Value) -> String {
    let field = |key: &str| {
        payload
            .get(key)
            .and_then(Value::as_str)
            .map_or_else(|| "none".to_string(), |s| Value::from(s).to_string())
    };
    format!("thread-id={} client={}", field("thread-id"), field("client"))
}

/// The `/v1/events` request body for a main turn of the Codex terminal `tag`: one complete
/// `turn.completed` envelope, whose answer is the turn's last assistant message. Its
/// `inputMessages` are the prompts the turn started with, by which Quay pairs the turn with
/// the message it typed in.
fn turn_completed_batch(payload: &Value, tag: &str, now_ms: u64) -> Value {
    let text = |key: &str| payload.get(key).and_then(Value::as_str);
    let inputs: Vec<&str> = payload
        .get("input-messages")
        .and_then(Value::as_array)
        .map(|messages| messages.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    let mut data = json!({ "source": "codex-notify", "inputMessages": inputs });
    for (field, key) in [
        ("answer", "last-assistant-message"),
        ("threadId", "thread-id"),
        ("turnId", "turn-id"),
        ("client", "client"),
    ] {
        if let Some(value) = text(key) {
            data[field] = Value::from(value);
        }
    }
    json!({
        "events": [{
            "v": 1,
            // Each run of the helper sends one event, so each is a boot of its own
            "boot": format!("codex-notify-{}", std::process::id()),
            "seq": 1,
            "ts": now_ms,
            "sessionId": text("thread-id").unwrap_or(""),
            "tag": tag,
            "type": "turn.completed",
            "data": data,
        }]
    })
}

/// Where and as whom the helper posts, from the Codex terminal's environment.
#[derive(Debug, PartialEq)]
struct Bridge {
    events_url: EventsUrl,
    tag: String,
    token: String,
}

fn bridge_from_env(var: &dyn Fn(&str) -> Option<String>) -> Result<Bridge, String> {
    let required = |name: &str| {
        let value = var(name).filter(|v| !v.is_empty()).ok_or(format!("{} is not set", name))?;
        if value.chars().any(char::is_control) {
            return Err(format!("{} holds a control character", name));
        }
        Ok(value)
    };
    Ok(Bridge {
        events_url: parse_events_url(&required(EVENTS_URL_VAR)?)?,
        tag: required(TERMINAL_ID_VAR)?,
        token: required(TOKEN_VAR)?,
    })
}

/// The bridge's event endpoint. Quay's bridge listens on loopback only, so the helper
/// sends the terminal's token nowhere else.
#[derive(Debug, PartialEq)]
struct EventsUrl {
    port: u16,
    host: String,
    path: String,
}

/// Parses `http://127.0.0.1:<port>/<path>` (or `localhost`), as Quay sets `QUAY_EVENTS_URL`.
fn parse_events_url(url: &str) -> Result<EventsUrl, String> {
    let bad = |why: &str| format!("{} {:?} {}", EVENTS_URL_VAR, url, why);
    let rest = url.strip_prefix("http://").ok_or_else(|| bad("is not an http:// URL"))?;
    let (authority, path) = rest
        .find('/')
        .map(|at| rest.split_at(at))
        .ok_or_else(|| bad("has no path"))?;
    let (host, port) = authority.rsplit_once(':').ok_or_else(|| bad("has no port"))?;
    if host != "127.0.0.1" && host != "localhost" {
        return Err(bad("is not on loopback"));
    }
    let port = match port.parse::<u16>() {
        Ok(number) if number != 0 && port.bytes().all(|b| b.is_ascii_digit()) => number,
        _ => return Err(bad("has no port from 1 to 65535")),
    };
    if path.contains(['?', '#']) {
        return Err(bad("has a query or fragment"));
    }
    Ok(EventsUrl { port, host: host.to_string(), path: path.to_string() })
}

/// Posts `body` to the bridge with the terminal's bearer token and returns the bridge's
/// status code. Every step has a timeout, and the helper follows no redirect.
fn post_events(url: &EventsUrl, token: &str, body: &str) -> Result<u16, String> {
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, url.port));
    let mut stream = TcpStream::connect_timeout(&addr, CONNECT_TIMEOUT)
        .map_err(|e| format!("can't reach the bridge on port {}: {}", url.port, e))?;
    stream.set_read_timeout(Some(IO_TIMEOUT)).map_err(|e| e.to_string())?;
    stream.set_write_timeout(Some(IO_TIMEOUT)).map_err(|e| e.to_string())?;

    let request = format!(
        "POST {} HTTP/1.1\r\nHost: {}:{}\r\nAuthorization: Bearer {}\r\n\
         Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        url.path,
        url.host,
        url.port,
        token,
        body.len(),
        body
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|e| format!("can't send to the bridge: {}", e))?;

    let mut response = Vec::new();
    stream
        .read_to_end(&mut response)
        .map_err(|e| format!("no answer from the bridge: {}", e))?;
    let status = status_code(&response).ok_or("the bridge's answer is not HTTP")?;
    if (200..300).contains(&status) {
        Ok(status)
    } else {
        Err(format!("the bridge answered {}", status))
    }
}

/// The status code on an HTTP/1.x response's status line.
fn status_code(response: &[u8]) -> Option<u16> {
    let line = response.split(|&b| b == b'\n').next()?;
    let line = std::str::from_utf8(line).ok()?;
    let mut parts = line.split_whitespace();
    parts.next().filter(|version| version.starts_with("HTTP/1."))?;
    parts.next()?.parse().ok()
}

/// `codex-notify.log` in Quay's data folder: `%LOCALAPPDATA%\Quay2`, or `.quay2` in the
/// user's home. `None` when neither is known, since the helper runs in Codex's project folder
/// and a relative log would land in the user's repository.
fn log_path(var: &dyn Fn(&str) -> Option<String>) -> Option<PathBuf> {
    let set = |name: &str| var(name).filter(|value| !value.is_empty());
    let dir = match set("LOCALAPPDATA") {
        Some(local) => PathBuf::from(local).join("Quay2"),
        None => PathBuf::from(set("USERPROFILE").or_else(|| set("HOME"))?).join(".quay2"),
    };
    Some(dir.join("codex-notify.log"))
}

/// Appends `line` to the log at `path`, starting the log over once it reaches `LOG_CAP`.
/// A log that can't be written is skipped: the turn end matters more than its record.
fn append_log(path: &std::path::Path, line: &str) {
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let full = std::fs::metadata(path).is_ok_and(|meta| meta.len() >= LOG_CAP);
    let file = std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .append(!full)
        .truncate(full)
        .open(path);
    if let Ok(mut file) = file {
        let _ = writeln!(file, "{}", line);
    }
}

fn unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::net::TcpListener;

    fn main_turn() -> Value {
        json!({
            "type": "agent-turn-complete",
            "thread-id": "thread-main",
            "turn-id": "turn-1",
            "cwd": "E:\\proj",
            "client": "codex-tui",
            "input-messages": ["[Peer agent (claude-dev)]: review this"],
            "last-assistant-message": "Looks good."
        })
    }

    fn subagent_turn() -> Value {
        json!({
            "type": "agent-turn-complete",
            "thread-id": "thread-sub",
            "turn-id": "turn-2",
            "input-messages": [],
            "last-assistant-message": "Paris"
        })
    }

    fn env_of(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> + use<> {
        let map: HashMap<String, String> =
            pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
        move |name: &str| map.get(name).cloned()
    }

    /// A one-shot bridge on a free loopback port: it answers `status` and hands back the
    /// raw request it got.
    fn fake_bridge(status: &str) -> (u16, std::thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let status = status.to_string();
        let handle = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
            let mut request = Vec::new();
            let mut buf = [0u8; 4096];
            loop {
                let n = stream.read(&mut buf).unwrap();
                request.extend_from_slice(&buf[..n]);
                let text = String::from_utf8_lossy(&request).to_string();
                if let Some(head_end) = text.find("\r\n\r\n") {
                    let length: usize = text
                        .lines()
                        .find_map(|l| l.strip_prefix("Content-Length: "))
                        .unwrap()
                        .parse()
                        .unwrap();
                    if request.len() >= head_end + 4 + length {
                        break;
                    }
                }
            }
            write!(stream, "HTTP/1.1 {}\r\nContent-Length: 0\r\n\r\n", status).unwrap();
            String::from_utf8(request).unwrap()
        });
        (port, handle)
    }

    #[test]
    fn a_turn_with_input_messages_is_a_main_turn() {
        assert!(is_main_turn(&main_turn()));
    }

    #[test]
    fn a_turn_with_empty_or_missing_input_messages_is_dropped() {
        assert!(!is_main_turn(&subagent_turn()));
        let mut missing = main_turn();
        missing.as_object_mut().unwrap().remove("input-messages");
        assert!(!is_main_turn(&missing));
        let mut not_a_list = main_turn();
        not_a_list["input-messages"] = json!("prompt");
        assert!(!is_main_turn(&not_a_list));
    }

    /// The payload Codex 0.163.0's TUI sent for the turn that named a new task.
    fn title_turn() -> Value {
        json!({
            "type": "agent-turn-complete",
            "thread-id": "thread-title",
            "turn-id": "turn-3",
            "client": "codex-tui",
            "input-messages": ["Generate a concise, single-line task title of at most 36 characters and under five words where possible. Start with an imperative verb. Do not answer the request.\n\nUser prompt:\nReply with the single word pong and nothing else."],
            "last-assistant-message": "{\"title\":\"Reply with pong\"}"
        })
    }

    #[test]
    fn the_task_title_turn_is_told_apart_from_a_main_turn() {
        assert!(is_title_turn(&title_turn()));
        assert!(!is_title_turn(&main_turn()));
        // An answer shaped like a title is still a main turn's answer
        let mut json_reply = main_turn();
        json_reply["last-assistant-message"] = json!("{\"title\":\"Fix the build\"}");
        assert!(!is_title_turn(&json_reply));
    }

    #[test]
    fn the_task_title_turn_is_dropped_without_reading_the_bridge_variables() {
        let (line, ok) = handle(Some(&title_turn().to_string()), &env_of(&[]), 0);
        assert!(ok);
        assert_eq!(line, r#"dropped thread-id="thread-title" client="codex-tui": Codex's task-title turn"#);
    }

    #[test]
    fn the_client_value_does_not_decide_the_turn() {
        let mut no_client = main_turn();
        no_client.as_object_mut().unwrap().remove("client");
        assert!(is_main_turn(&no_client));
    }

    #[test]
    fn the_batch_is_one_complete_turn_completed_envelope_for_the_terminal() {
        let batch = turn_completed_batch(&main_turn(), "term-codex", 1234);

        let events = batch["events"].as_array().unwrap();
        assert_eq!(events.len(), 1);
        let event = &events[0];
        assert_eq!(event["v"], 1);
        assert!(event["boot"].as_str().unwrap().starts_with("codex-notify-"));
        assert_eq!(event["seq"], 1);
        assert_eq!(event["ts"], 1234);
        assert_eq!(event["sessionId"], "thread-main");
        assert_eq!(event["tag"], "term-codex");
        assert_eq!(event["type"], "turn.completed");
        assert_eq!(
            event["data"],
            json!({
                "source": "codex-notify",
                "inputMessages": ["[Peer agent (claude-dev)]: review this"],
                "answer": "Looks good.",
                "threadId": "thread-main",
                "turnId": "turn-1",
                "client": "codex-tui"
            })
        );
        assert!(event["data"].get("agentId").is_none());
    }

    #[test]
    fn a_turn_with_no_last_message_sends_no_answer() {
        let mut silent = main_turn();
        silent["last-assistant-message"] = Value::Null;
        let batch = turn_completed_batch(&silent, "term-codex", 0);
        assert!(batch["events"][0]["data"].get("answer").is_none());
    }

    #[test]
    fn the_log_names_thread_and_client_but_no_message() {
        assert_eq!(describe(&main_turn()), r#"thread-id="thread-main" client="codex-tui""#);
        assert_eq!(describe(&subagent_turn()), r#"thread-id="thread-sub" client=none"#);
        let mut sneaky = main_turn();
        sneaky["client"] = json!("a\nb");
        assert_eq!(describe(&sneaky), r#"thread-id="thread-main" client="a\nb""#);
    }

    #[test]
    fn the_events_url_must_be_loopback_http_with_a_port_and_path() {
        assert_eq!(
            parse_events_url("http://127.0.0.1:50362/v1/events"),
            Ok(EventsUrl { port: 50362, host: "127.0.0.1".into(), path: "/v1/events".into() })
        );
        assert!(parse_events_url("http://localhost:1/v1/events").is_ok());
        for bad in [
            "https://127.0.0.1:50362/v1/events",
            "http://example.com:50362/v1/events",
            "http://user@127.0.0.1:50362/v1/events",
            "http://127.0.0.1/v1/events",
            "http://127.0.0.1:50362",
            "http://127.0.0.1:0/v1/events",
            "http://127.0.0.1:65536/v1/events",
            "http://127.0.0.1:+80/v1/events",
            "http://127.0.0.1:abc/v1/events",
            "http://127.0.0.1:50362/v1/events?x=1",
            "",
        ] {
            let err = parse_events_url(bad).unwrap_err();
            assert!(err.contains("QUAY_EVENTS_URL"), "{bad}: {err}");
        }
    }

    #[test]
    fn each_bridge_variable_is_required_and_named_when_missing() {
        let full = [
            ("QUAY_EVENTS_URL", "http://127.0.0.1:4000/v1/events"),
            ("QUAY_TERMINAL_ID", "term-codex"),
            ("QUAY_A2A_TOKEN", "tok"),
        ];
        let bridge = bridge_from_env(&env_of(&full)).unwrap();
        assert_eq!(bridge.tag, "term-codex");
        assert_eq!(bridge.token, "tok");

        for name in ["QUAY_EVENTS_URL", "QUAY_TERMINAL_ID", "QUAY_A2A_TOKEN"] {
            let without: Vec<_> = full.iter().copied().filter(|(k, _)| *k != name).collect();
            let err = bridge_from_env(&env_of(&without)).unwrap_err();
            assert_eq!(err, format!("{} is not set", name));

            let empty: Vec<_> = full
                .iter()
                .map(|&(k, v)| if k == name { (k, "") } else { (k, v) })
                .collect();
            assert_eq!(bridge_from_env(&env_of(&empty)).unwrap_err(), format!("{} is not set", name));
        }
    }

    #[test]
    fn a_token_that_could_split_the_request_is_refused() {
        let env = env_of(&[
            ("QUAY_EVENTS_URL", "http://127.0.0.1:4000/v1/events"),
            ("QUAY_TERMINAL_ID", "term-codex"),
            ("QUAY_A2A_TOKEN", "tok\r\nX-Evil: 1"),
        ]);
        assert_eq!(
            bridge_from_env(&env).unwrap_err(),
            "QUAY_A2A_TOKEN holds a control character"
        );
    }

    #[test]
    fn a_main_turn_is_posted_with_the_terminals_token() {
        let (port, bridge) = fake_bridge("200 OK");
        let url = format!("http://127.0.0.1:{}/v1/events", port);
        let env = env_of(&[
            ("QUAY_EVENTS_URL", url.as_str()),
            ("QUAY_TERMINAL_ID", "term-codex"),
            ("QUAY_A2A_TOKEN", "tok-codex"),
        ]);

        let (line, ok) = handle(Some(&main_turn().to_string()), &env, 99);

        assert!(ok, "{line}");
        assert_eq!(line, r#"posted thread-id="thread-main" client="codex-tui": bridge answered 200"#);
        let request = bridge.join().unwrap();
        let (head, body) = request.split_once("\r\n\r\n").unwrap();
        assert!(head.starts_with("POST /v1/events HTTP/1.1\r\n"), "{head}");
        assert!(head.contains("\r\nAuthorization: Bearer tok-codex\r\n"), "{head}");
        assert!(head.contains(&format!("\r\nHost: 127.0.0.1:{}\r\n", port)), "{head}");
        assert!(head.contains("\r\nContent-Type: application/json\r\n"), "{head}");
        let sent: Value = serde_json::from_str(body).unwrap();
        assert_eq!(sent["events"][0]["tag"], "term-codex");
        assert_eq!(sent["events"][0]["data"]["answer"], "Looks good.");
    }

    #[test]
    fn a_subagent_turn_is_dropped_without_reading_the_bridge_variables() {
        let (line, ok) = handle(Some(&subagent_turn().to_string()), &env_of(&[]), 0);
        assert!(ok);
        assert_eq!(line, r#"dropped thread-id="thread-sub" client=none: empty input-messages"#);
    }

    #[test]
    fn a_refusal_from_the_bridge_is_a_failure() {
        let (port, bridge) = fake_bridge("401 Unauthorized");
        let url = format!("http://127.0.0.1:{}/v1/events", port);
        let env = env_of(&[
            ("QUAY_EVENTS_URL", url.as_str()),
            ("QUAY_TERMINAL_ID", "term-codex"),
            ("QUAY_A2A_TOKEN", "stale"),
        ]);

        let (line, ok) = handle(Some(&main_turn().to_string()), &env, 0);

        bridge.join().unwrap();
        assert!(!ok);
        assert_eq!(line, r#"failed thread-id="thread-main" client="codex-tui": the bridge answered 401"#);
    }

    #[test]
    fn a_missing_or_broken_payload_is_a_failure() {
        assert_eq!(handle(None, &env_of(&[]), 0), ("failed: Codex passed no payload".to_string(), false));
        let (line, ok) = handle(Some("{not json"), &env_of(&[]), 0);
        assert!(!ok);
        assert!(line.starts_with("failed: the payload is not JSON"), "{line}");
    }

    #[test]
    fn the_log_sits_in_quays_data_folder_and_never_in_the_project() {
        assert_eq!(
            log_path(&env_of(&[("LOCALAPPDATA", "C:\\Local")])),
            Some(PathBuf::from("C:\\Local").join("Quay2").join("codex-notify.log"))
        );
        let home = Some(PathBuf::from("C:\\Home").join(".quay2").join("codex-notify.log"));
        assert_eq!(log_path(&env_of(&[("LOCALAPPDATA", ""), ("USERPROFILE", "C:\\Home")])), home);
        assert_eq!(log_path(&env_of(&[("HOME", "C:\\Home")])), home);
        assert_eq!(log_path(&env_of(&[("LOCALAPPDATA", ""), ("USERPROFILE", "")])), None);
    }

    #[test]
    fn the_log_starts_over_once_it_is_full() {
        let dir = std::env::temp_dir().join(format!("quay-codex-notify-{}", std::process::id()));
        let path = dir.join("codex-notify.log");
        let _ = std::fs::remove_file(&path);

        append_log(&path, "first");
        append_log(&path, "second");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "first\nsecond\n");

        std::fs::write(&path, vec![b'x'; LOG_CAP as usize]).unwrap();
        append_log(&path, "fresh");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "fresh\n");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
