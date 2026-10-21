//! A stand-in agent CLI for the round-trip tests. It behaves the way Claude Code does as far as
//! Quay can see: it writes to its terminal, posts status events to `CLAUDE_EVENTS_URL` with the
//! terminal's bearer token, calls the Quay MCP server named in `--mcp-config` (expanding
//! `${CLAUDE_EVENTS_TOKEN}` in its headers), waits for one prompt typed into its terminal,
//! answers it with a turn, and exits with code 7.

use std::io::{BufRead, Read, Write};
use std::net::TcpStream;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

// The tool's own console module: the stub reads its terminal's size the way the tool does.
#[allow(dead_code)]
#[path = "../console.rs"]
mod console;

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

struct Bridge {
    host: String,
    token: String,
    tag: String,
    seq: u64,
}

impl Bridge {
    fn post(&self, host: &str, path: &str, authorization: &str, body: &str) -> (u16, String) {
        let mut stream = TcpStream::connect(host).expect("connect to the bridge");
        let request = format!(
            "POST {path} HTTP/1.1\r\nHost: {host}\r\nContent-Type: application/json\r\nAccept: application/json, text/event-stream\r\nAuthorization: {authorization}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        stream.write_all(request.as_bytes()).expect("write to the bridge");
        let mut raw = String::new();
        stream.read_to_string(&mut raw).expect("read from the bridge");
        let status = raw.split_whitespace().nth(1).and_then(|s| s.parse().ok()).unwrap_or(0);
        let body = raw.split_once("\r\n\r\n").map(|(_, b)| b.to_string()).unwrap_or_default();
        (status, body)
    }

    fn event(&mut self, event_type: &str, data: serde_json::Value) {
        self.seq += 1;
        let envelope = serde_json::json!({
            "v": 1, "boot": "stub-boot", "seq": self.seq, "ts": now_ms(),
            "sessionId": "stub-session", "tag": self.tag, "type": event_type, "data": data,
        });
        let body = serde_json::json!({ "events": [envelope] }).to_string();
        let auth = format!("Bearer {}", self.token);
        let (status, _) = self.post(&self.host, "/v1/events", &auth, &body);
        println!("stub-agent: event {event_type} -> {status}");
    }
}

/// The Quay server's URL and Authorization header from the inline `--mcp-config` JSON.
fn mcp_server(args: &[String], token: &str) -> Option<(String, String, String)> {
    let at = args.iter().position(|a| a == "--mcp-config")?;
    let config: serde_json::Value = serde_json::from_str(args.get(at + 1)?).ok()?;
    let quay = &config["mcpServers"]["quay"];
    let url = quay["url"].as_str()?;
    let rest = url.strip_prefix("http://")?;
    let (host, path) = rest.split_once('/')?;
    let auth = quay["headers"]["Authorization"].as_str()?.replace("${CLAUDE_EVENTS_TOKEN}", token);
    Some((host.to_string(), format!("/{path}"), auth))
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (cols, rows) = console::size();
    let name = std::env::current_exe().ok().and_then(|p| Some(p.file_stem()?.to_string_lossy().to_string()));
    println!("\x1b[32mstub-agent: hello from the real CLI ({})\x1b[0m", name.unwrap_or_default());
    println!("stub-agent: size {cols}x{rows}");
    let _ = std::io::stdout().flush();

    let url = std::env::var("CLAUDE_EVENTS_URL").unwrap_or_default();
    let token = std::env::var("CLAUDE_EVENTS_TOKEN").unwrap_or_default();
    let tag = std::env::var("CLAUDE_EVENTS_TAG").unwrap_or_default();
    let mut bridge = (!url.is_empty()).then(|| Bridge {
        host: url.trim_start_matches("http://").trim_end_matches('/').to_string(),
        token: token.clone(),
        tag,
        seq: 0,
    });

    if !token.is_empty() {
        // A CLI that shows its token, in two writes, which a recording must still not keep.
        // This breaks CONTRIBUTING.md's Credential Protection rule (never log authorization
        // tokens to stdout) on purpose: the printed token is what the recording tests check the
        // recorder scrubs. The stub is a test fixture and its token a test value, so leave the
        // print in.
        let (head, tail) = token.split_at(token.len() / 2);
        print!("stub-agent: token {head}");
        let _ = std::io::stdout().flush();
        std::thread::sleep(Duration::from_millis(100));
        println!("{tail}");
    }

    if let Some(bridge) = bridge.as_mut() {
        bridge.event("session.started", serde_json::json!({}));
        if let Some((host, path, auth)) = mcp_server(&args, &token) {
            let init = r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"stub-agent","version":"0"}}}"#;
            let (status, _) = bridge.post(&host, &path, &auth, init);
            println!("stub-agent: mcp initialize -> {status}");
            let call = r#"{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"quay_list_agents","arguments":{}}}"#;
            let (status, reply) = bridge.post(&host, &path, &auth, call);
            println!("stub-agent: mcp quay_list_agents -> {status} {reply}");
        }
    }

    println!("stub-agent: waiting for a prompt");
    let _ = std::io::stdout().flush();
    let mut prompt = String::new();
    let _ = std::io::stdin().lock().read_line(&mut prompt);
    let prompt = prompt.trim().to_string();

    if let Some(bridge) = bridge.as_mut() {
        bridge.event("turn.started", serde_json::json!({ "prompt": prompt }));
        std::thread::sleep(Duration::from_millis(300));
        bridge.event("tool.started", serde_json::json!({ "tool": "Read", "input": { "file_path": "src/server.ts" } }));
        std::thread::sleep(Duration::from_millis(300));
        bridge.event("tool.finished", serde_json::json!({ "tool": "Read" }));
        bridge.event("turn.completed", serde_json::json!({ "answer": format!("Read the route for: {prompt}") }));
    }
    println!("stub-agent: answered {prompt}");
    let _ = std::io::stdout().flush();
    std::thread::sleep(Duration::from_millis(300));
    std::process::exit(7);
}
