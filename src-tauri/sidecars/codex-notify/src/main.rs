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

use std::process::ExitCode;

use quay_bridge_post::{Bridge, append_log, log_path, unix_ms};
use serde_json::{Value, json};

/// The helper's log, in Quay's data folder.
const LOG_NAME: &str = "codex-notify.log";

fn main() -> ExitCode {
    let payload = std::env::args().skip(1).last();
    let var = |name: &str| std::env::var(name).ok();
    let (line, ok) = handle(payload.as_deref(), &var, unix_ms());
    if let Some(path) = log_path(&var, LOG_NAME) {
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
    let sent = Bridge::from_env(var).and_then(|bridge| {
        let batch = turn_completed_batch(&payload, &bridge.tag, now_ms);
        bridge.post(&batch.to_string())
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

#[cfg(test)]
mod tests {
    use super::*;
    use quay_bridge_post::testing::{env_of, fake_bridge};

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
    fn a_main_turn_is_posted_with_the_terminals_token() {
        let (port, bridge) = fake_bridge("200 OK", 1);
        let url = format!("http://127.0.0.1:{}/v1/events", port);
        let env = env_of(&[
            ("QUAY_EVENTS_URL", url.as_str()),
            ("QUAY_TERMINAL_ID", "term-codex"),
            ("QUAY_A2A_TOKEN", "tok-codex"),
        ]);

        let (line, ok) = handle(Some(&main_turn().to_string()), &env, 99);

        assert!(ok, "{line}");
        assert_eq!(line, r#"posted thread-id="thread-main" client="codex-tui": bridge answered 200"#);
        let request = bridge.join().unwrap().remove(0);
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
        let (port, bridge) = fake_bridge("401 Unauthorized", 1);
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
}
