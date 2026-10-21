//! Quay's PiG extension, bundled with Quay as a sidecar. Quay launches each PiG terminal
//! with `-e <this program>`, so PiG runs it as a subprocess extension for that session.
//! It puts the terminal on Quay's A2A bus as a full peer:
//!
//! - it registers Quay's MCP server, so PiG gets the `quay_*` tools;
//! - it reports the terminal's turns to Quay's bridge, in the event-bridge plugin's
//!   envelope: `session.started` when PiG's session starts, `turn.started` when a run
//!   starts, and `turn.completed`, with the run's answer, once the run has settled.
//!
//! PiG passes its environment on, so the bridge URL, terminal id and bearer token come from
//! the `QUAY_*` variables Quay sets on the PiG terminal. The token never touches disk: the
//! MCP server's header names `${QUAY_A2A_TOKEN}`, which PiG expands itself.
//!
//! Each post adds one line to `pig-bridge.log` in Quay's data folder, naming the event and
//! how the bridge answered, and never an answer's text.

use std::process::ExitCode;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};

use pig_sdk::{EVENT_AGENT_END, EVENT_AGENT_SETTLED, EVENT_AGENT_START, EVENT_SESSION_START, Extension};
use quay_bridge_post::{Bridge, TOKEN_VAR, append_log, log_path, parse_loopback_url, unix_ms};
use serde_json::{Value, json};

/// The extension's name. PiG requires it to match the program's file name.
const NAME: &str = "quay-pig-bridge";

/// The extension's log, in Quay's data folder.
const LOG_NAME: &str = "pig-bridge.log";

const MCP_URL_VAR: &str = "QUAY_MCP_URL";

/// Seconds PiG waits on one request to Quay's MCP server: above the 60 seconds a
/// `wait_for_reply` can take.
const MCP_TIMEOUT_SECS: u64 = 120;

/// The answer for a turn that was stopped before it finished.
const INTERRUPTED: &str = "PiG's turn was interrupted before it finished.";

/// The answer for a turn that ended with no text.
const NO_TEXT: &str = "PiG finished the turn without a text reply.";

fn main() -> ExitCode {
    let var = |name: &str| std::env::var(name).ok();
    let log = log_path(&var, LOG_NAME);
    let write_log = move |line: &str| {
        if let Some(path) = &log {
            append_log(path, &format!("{} {}", unix_ms(), line));
        }
    };

    let mut ext = Extension::new(NAME);
    match mcp_server_config(&var) {
        Ok(config) => ext.register_mcp_server("quay", config),
        Err(e) => write_log(&format!("no MCP server: {}", e)),
    }

    // Posts go out in order on a thread of their own, so a slow bridge never holds PiG up
    let (sender, batches) = mpsc::channel::<(String, Value)>();
    let bridge = Bridge::from_env(&var);
    let tag = bridge.as_ref().map(|bridge| bridge.tag.clone()).unwrap_or_default();
    let poster = {
        let write_log = write_log.clone();
        std::thread::spawn(move || {
            for (event_type, batch) in batches {
                let line = match &bridge {
                    Ok(bridge) => match bridge.post(&batch.to_string()) {
                        Ok(status) => format!("posted {}: bridge answered {}", event_type, status),
                        Err(e) => format!("failed {}: {}", event_type, e),
                    },
                    Err(e) => format!("failed {}: {}", event_type, e),
                };
                write_log(&line);
            }
        })
    };

    // Without the bridge nothing is posted, so the tag doesn't matter then
    let reporter = Arc::new(Mutex::new(Reporter::new(tag)));
    for event in [EVENT_SESSION_START, EVENT_AGENT_START, EVENT_AGENT_END, EVENT_AGENT_SETTLED] {
        let reporter = reporter.clone();
        let sender = sender.clone();
        ext.on_event(event, move |_ctx, data| {
            let mut reporter = reporter.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            if let Some(envelope) = reporter.hear(event, data, unix_ms()) {
                let event_type = envelope["type"].as_str().unwrap_or_default().to_string();
                let _ = sender.send((event_type, json!({ "events": [envelope] })));
            }
            None
        });
    }
    drop(sender);

    let ran = ext.run();
    // The handlers went with the extension, so the poster ends once it has sent the rest
    let _ = poster.join();
    match ran {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            write_log(&format!("stopped: {}", e));
            ExitCode::FAILURE
        }
    }
}

/// The config `registerMcpServer` gets for Quay's MCP server: its URL from `QUAY_MCP_URL`,
/// which must be on loopback, and an `Authorization` header naming `${QUAY_A2A_TOKEN}`,
/// which PiG expands from its environment. The tools are declared to the model directly.
fn mcp_server_config(var: &dyn Fn(&str) -> Option<String>) -> Result<Value, String> {
    let url = var(MCP_URL_VAR).filter(|url| !url.is_empty()).ok_or(format!("{} is not set", MCP_URL_VAR))?;
    parse_loopback_url(MCP_URL_VAR, &url)?;
    if var(TOKEN_VAR).filter(|token| !token.is_empty()).is_none() {
        return Err(format!("{} is not set", TOKEN_VAR));
    }
    Ok(json!({
        "url": url,
        "headers": { "Authorization": format!("Bearer ${{{}}}", TOKEN_VAR) },
        "exposure": "direct",
        "timeout": MCP_TIMEOUT_SECS,
    }))
}

/// Turns PiG's events into the envelopes Quay's bridge reads, for the terminal `tag`.
struct Reporter {
    tag: String,
    /// Names this run of the extension, as an envelope's `boot` and `sessionId`.
    boot: String,
    seq: u64,
    /// Whether a prompt is running: from its first run's `agent_start` until it settles.
    /// A retry or a continuation starts another run of the same prompt, which is no new turn.
    in_turn: bool,
    /// The answer of the run that ended last, kept from its `agent_end` until it settles.
    answer: Option<String>,
}

impl Reporter {
    fn new(tag: String) -> Self {
        Reporter { tag, boot: format!("{}-{}", NAME, std::process::id()), seq: 0, in_turn: false, answer: None }
    }

    /// The envelope PiG's `event`, with payload `data`, sends Quay at `now_ms`, if any.
    /// `turn.completed` waits for `agent_settled`, which PiG sends once nothing more will run
    /// for the prompt, rather than `turn_end`, which follows each model call.
    fn hear(&mut self, event: &str, data: &Value, now_ms: u64) -> Option<Value> {
        let (event_type, payload) = match event {
            EVENT_SESSION_START => ("session.started", json!({})),
            EVENT_AGENT_START => {
                self.answer = None;
                if std::mem::replace(&mut self.in_turn, true) {
                    return None;
                }
                ("turn.started", json!({}))
            }
            EVENT_AGENT_END => {
                self.answer = Some(answer_from(&data["messages"]));
                return None;
            }
            EVENT_AGENT_SETTLED => {
                self.in_turn = false;
                let answer = match self.answer.take() {
                    _ if data["aborted"] == true => INTERRUPTED.to_string(),
                    Some(answer) => answer,
                    None => NO_TEXT.to_string(),
                };
                ("turn.completed", json!({ "answer": answer }))
            }
            _ => return None,
        };
        self.seq += 1;
        let mut data = json!({ "source": NAME });
        if let (Some(data), Some(payload)) = (data.as_object_mut(), payload.as_object()) {
            data.extend(payload.clone());
        }
        Some(json!({
            "v": 1,
            "boot": self.boot,
            "seq": self.seq,
            "ts": now_ms,
            "sessionId": self.boot,
            "tag": self.tag,
            "type": event_type,
            "data": data,
        }))
    }
}

/// What a waiting sender is told a run ended with, from the run's `messages` in its
/// `agent_end`: the text of the last assistant message, or why there is none. It is never
/// empty.
fn answer_from(messages: &Value) -> String {
    let Some(last) = messages
        .as_array()
        .and_then(|messages| messages.iter().rev().find(|m| m["role"] == "assistant"))
    else {
        return NO_TEXT.to_string();
    };
    match last["stopReason"].as_str() {
        Some("aborted") => return INTERRUPTED.to_string(),
        Some("error") => {
            let why = last["errorMessage"].as_str().map(str::trim).unwrap_or_default();
            return match why.trim_end_matches('.') {
                "" => "PiG's turn failed.".to_string(),
                why => format!("PiG's turn failed: {}.", why),
            };
        }
        _ => {}
    }
    let text: Vec<&str> = last["content"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|block| block["type"] == "text")
        .filter_map(|block| block["text"].as_str())
        .collect();
    match text.join("\n").trim() {
        "" => NO_TEXT.to_string(),
        text => text.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use quay_bridge_post::testing::env_of;

    fn assistant(content: Value, stop_reason: &str) -> Value {
        json!({ "role": "assistant", "content": content, "stopReason": stop_reason })
    }

    fn text(text: &str) -> Value {
        json!({ "type": "text", "text": text })
    }

    fn run_end(messages: Vec<Value>) -> Value {
        json!({ "type": "agent_end", "messages": messages })
    }

    #[test]
    fn the_answer_is_the_text_of_the_last_assistant_message() {
        let messages = json!([
            { "role": "system", "content": "" },
            { "role": "user", "content": [text("What is 6 x 7?")] },
            assistant(json!([text("Let me check."), { "type": "toolCall", "id": "t", "name": "bash" }]), "toolUse"),
            { "role": "toolResult", "content": [text("42")] },
            assistant(json!([{ "type": "thinking", "thinking": "easy" }, text("It is"), text("42.")]), "stop"),
        ]);
        assert_eq!(answer_from(&messages), "It is\n42.");
    }

    #[test]
    fn an_answer_is_never_empty() {
        assert_eq!(answer_from(&json!([])), NO_TEXT);
        assert_eq!(answer_from(&Value::Null), NO_TEXT);
        assert_eq!(answer_from(&json!([{ "role": "user", "content": [text("hi")] }])), NO_TEXT);
        assert_eq!(answer_from(&json!([assistant(json!([text("  \n")]), "stop")])), NO_TEXT);
        assert_eq!(answer_from(&json!([assistant(json!([{ "type": "toolCall" }]), "length")])), NO_TEXT);
    }

    #[test]
    fn an_aborted_or_failed_run_says_so() {
        assert_eq!(answer_from(&json!([assistant(json!([text("half")]), "aborted")])), INTERRUPTED);
        let mut failed = assistant(json!([]), "error");
        failed["errorMessage"] = json!("429 rate limited.");
        assert_eq!(answer_from(&json!([failed])), "PiG's turn failed: 429 rate limited.");
        assert_eq!(answer_from(&json!([assistant(json!([]), "error")])), "PiG's turn failed.");
    }

    #[test]
    fn events_become_the_bridge_envelopes_in_order() {
        let mut reporter = Reporter::new("term-pig".to_string());
        let started = reporter.hear(EVENT_SESSION_START, &json!({ "reason": "startup" }), 10).unwrap();
        let turn = reporter.hear(EVENT_AGENT_START, &json!({}), 11).unwrap();
        // PiG's turn_end follows each model call, so it says nothing
        assert!(reporter.hear("turn_end", &json!({}), 12).is_none());
        let answer = run_end(vec![assistant(json!([text("4")]), "stop")]);
        assert!(reporter.hear(EVENT_AGENT_END, &answer, 13).is_none());
        let done = reporter.hear(EVENT_AGENT_SETTLED, &json!({ "aborted": false }), 14).unwrap();

        let types: Vec<&str> = [&started, &turn, &done].iter().map(|e| e["type"].as_str().unwrap()).collect();
        assert_eq!(types, ["session.started", "turn.started", "turn.completed"]);
        let seqs: Vec<u64> = [&started, &turn, &done].iter().map(|e| e["seq"].as_u64().unwrap()).collect();
        assert_eq!(seqs, [1, 2, 3]);
        for envelope in [&started, &turn, &done] {
            assert_eq!(envelope["v"], 1);
            assert_eq!(envelope["tag"], "term-pig");
            assert_eq!(envelope["boot"], format!("quay-pig-bridge-{}", std::process::id()));
            assert_eq!(envelope["sessionId"], envelope["boot"]);
            assert_eq!(envelope["data"]["source"], "quay-pig-bridge");
            assert!(envelope["data"].get("agentId").is_none());
        }
        assert_eq!(done["ts"], 14);
        assert_eq!(done["data"]["answer"], "4");
        assert!(started["data"].get("answer").is_none());
    }

    #[test]
    fn an_aborted_settle_is_interrupted_whatever_the_run_said() {
        let mut reporter = Reporter::new("term-pig".to_string());
        reporter.hear(EVENT_AGENT_START, &json!({}), 0);
        reporter.hear(EVENT_AGENT_END, &run_end(vec![assistant(json!([text("partial")]), "stop")]), 0);
        let done = reporter.hear(EVENT_AGENT_SETTLED, &json!({ "aborted": true }), 0).unwrap();
        assert_eq!(done["data"]["answer"], INTERRUPTED);
    }

    #[test]
    fn a_settle_with_no_run_end_has_no_text() {
        let mut reporter = Reporter::new("term-pig".to_string());
        reporter.hear(EVENT_AGENT_START, &json!({}), 0);
        let done = reporter.hear(EVENT_AGENT_SETTLED, &json!({ "aborted": false }), 0).unwrap();
        assert_eq!(done["data"]["answer"], NO_TEXT);
    }

    #[test]
    fn another_run_of_the_same_prompt_is_no_new_turn() {
        let mut reporter = Reporter::new("term-pig".to_string());
        assert!(reporter.hear(EVENT_AGENT_START, &json!({}), 0).is_some());
        reporter.hear(EVENT_AGENT_END, &run_end(vec![assistant(json!([]), "error")]), 0);
        // PiG retries the run before it settles
        assert!(reporter.hear(EVENT_AGENT_START, &json!({}), 0).is_none());
        reporter.hear(EVENT_AGENT_END, &run_end(vec![assistant(json!([text("done")]), "stop")]), 0);
        let done = reporter.hear(EVENT_AGENT_SETTLED, &json!({ "aborted": false }), 0).unwrap();
        assert_eq!(done["data"]["answer"], "done");
        // The next prompt is a turn of its own
        assert!(reporter.hear(EVENT_AGENT_START, &json!({}), 0).is_some());
    }

    #[test]
    fn a_new_run_drops_the_last_runs_answer() {
        let mut reporter = Reporter::new("term-pig".to_string());
        reporter.hear(EVENT_AGENT_END, &run_end(vec![assistant(json!([text("old")]), "stop")]), 0);
        reporter.hear(EVENT_AGENT_START, &json!({}), 0);
        let done = reporter.hear(EVENT_AGENT_SETTLED, &json!({}), 0).unwrap();
        assert_eq!(done["data"]["answer"], NO_TEXT);
    }

    #[test]
    fn the_mcp_server_names_the_token_for_pig_to_expand() {
        let env = env_of(&[("QUAY_MCP_URL", "http://127.0.0.1:4321/mcp"), ("QUAY_A2A_TOKEN", "tok-secret")]);
        let config = mcp_server_config(&env).unwrap();
        assert_eq!(
            config,
            json!({
                "url": "http://127.0.0.1:4321/mcp",
                "headers": { "Authorization": "Bearer ${QUAY_A2A_TOKEN}" },
                "exposure": "direct",
                "timeout": 120,
            })
        );
        assert!(!config.to_string().contains("tok-secret"));
    }

    #[test]
    fn no_mcp_server_without_its_url_and_token() {
        assert_eq!(
            mcp_server_config(&env_of(&[("QUAY_A2A_TOKEN", "tok")])),
            Err("QUAY_MCP_URL is not set".to_string())
        );
        assert_eq!(
            mcp_server_config(&env_of(&[("QUAY_MCP_URL", "http://127.0.0.1:1/mcp"), ("QUAY_A2A_TOKEN", "")])),
            Err("QUAY_A2A_TOKEN is not set".to_string())
        );
        let off_host = mcp_server_config(&env_of(&[("QUAY_MCP_URL", "http://example.com:80/mcp"), ("QUAY_A2A_TOKEN", "tok")]));
        assert_eq!(off_host, Err(r#"QUAY_MCP_URL "http://example.com:80/mcp" is not on loopback"#.to_string()));
    }
}
