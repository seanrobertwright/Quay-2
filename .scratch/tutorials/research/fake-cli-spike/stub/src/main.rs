//! Throwaway fake agent CLI for ticket #48 (Quay-2). Not part of the app.
//!
//! Copied to `claude.exe` (or `codex.exe`) first on PATH, it records what Quay hands it
//! (argv, CLAUDE_EVENTS_* variables, the --mcp-config file) and then takes line commands
//! on stdin so a driver can make it replay bridge traffic against the live bridge:
//!   run <text>            post turn.started / tool.started / tool.finished / turn.completed
//!   list                  MCP initialize + tools/list + tools/call quay_list_agents
//!   send <target> <text>  MCP tools/call quay_send_message (wait_for_reply=true)
//!   exit                  quit
//!   <anything else>       treat as an injected peer message: reply with a completed turn
//! Everything it sees and does is appended as JSON lines to %QUAY_STUB_LOG%\<tag>.jsonl.

use std::io::{BufRead, Read, Write};
use std::net::TcpStream;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

static SEQ: AtomicU64 = AtomicU64::new(1);

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn js(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

fn preview(s: &str) -> String {
    let mut s = s.replace('\n', " ");
    if s.len() > 160 {
        let mut cut = 160;
        while !s.is_char_boundary(cut) {
            cut -= 1;
        }
        s.truncate(cut);
        s.push_str("...");
    }
    s
}

struct Ctx {
    tag: String,
    events_host: String, // "127.0.0.1:PORT"
    token: String,
    log_path: Option<std::path::PathBuf>,
}

impl Ctx {
    fn log(&self, record: &str) {
        if let Some(p) = &self.log_path {
            if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(p) {
                let _ = writeln!(f, "{}", record);
            }
        }
    }

    fn say(&self, line: &str) {
        let short: String = self.tag.chars().take(12).collect();
        println!("\x1b[36m[stub {}]\x1b[0m {}", short, line);
        let _ = std::io::stdout().flush();
    }

    fn http(&self, method: &str, path: &str, with_auth: bool, body: &str) -> Result<(u16, String), String> {
        let mut stream = TcpStream::connect(&self.events_host)
            .map_err(|e| format!("connect {}: {}", self.events_host, e))?;
        stream.set_read_timeout(Some(Duration::from_secs(75))).ok();
        stream.set_write_timeout(Some(Duration::from_secs(10))).ok();
        let mut req = format!(
            "{} {} HTTP/1.1\r\nHost: {}\r\nContent-Type: application/json\r\nAccept: application/json\r\nContent-Length: {}\r\nConnection: close\r\n",
            method,
            path,
            self.events_host,
            body.len()
        );
        if with_auth {
            req.push_str(&format!("Authorization: Bearer {}\r\n", self.token));
        }
        req.push_str("\r\n");
        req.push_str(body);
        stream.write_all(req.as_bytes()).map_err(|e| format!("write: {}", e))?;
        let mut raw = Vec::new();
        stream.read_to_end(&mut raw).map_err(|e| format!("read: {}", e))?;
        let text = String::from_utf8_lossy(&raw).to_string();
        let status: u16 = text.split_whitespace().nth(1).and_then(|s| s.parse().ok()).unwrap_or(0);
        let resp_body = text.split_once("\r\n\r\n").map(|(_, b)| b.to_string()).unwrap_or_default();
        let rec = format!(
            "{{\"t\":{},\"kind\":\"http\",\"method\":{},\"path\":{},\"auth\":{},\"request\":{},\"status\":{},\"response\":{}}}",
            now_ms(),
            js(method),
            js(path),
            with_auth,
            js(body),
            status,
            js(&resp_body)
        );
        self.log(&rec);
        Ok((status, resp_body))
    }

    fn post_event(&self, event_type: &str, data: &str) {
        let seq = SEQ.fetch_add(1, Ordering::SeqCst);
        let env = format!(
            "{{\"v\":1,\"boot\":\"stub\",\"seq\":{},\"ts\":{},\"sessionId\":{},\"tag\":{},\"type\":{},\"data\":{}}}",
            seq,
            now_ms(),
            js(&format!("stub-{}", self.tag)),
            js(&self.tag),
            js(event_type),
            data
        );
        let body = format!("{{\"events\":[{}]}}", env);
        match self.http("POST", "/v1/events", true, &body) {
            Ok((status, _)) => self.say(&format!("event {} -> HTTP {}", event_type, status)),
            Err(e) => self.say(&format!("event {} FAILED: {}", event_type, e)),
        }
    }

    fn mcp(&self, id: u64, method: &str, params: &str) -> Result<(u16, String), String> {
        let body = format!(
            "{{\"jsonrpc\":\"2.0\",\"id\":{},\"method\":{},\"params\":{}}}",
            id,
            js(method),
            params
        );
        let r = self.http("POST", "/mcp", true, &body);
        match &r {
            Ok((status, resp)) => self.say(&format!("mcp {} -> HTTP {} {}", method, status, preview(resp))),
            Err(e) => self.say(&format!("mcp {} FAILED: {}", method, e)),
        }
        r
    }
}

const INIT_PARAMS: &str = "{\"protocolVersion\":\"2024-11-05\",\"capabilities\":{},\"clientInfo\":{\"name\":\"stub\",\"version\":\"0\"}}";

fn main() {
    let argv: Vec<String> = std::env::args().collect();
    let tag = std::env::var("CLAUDE_EVENTS_TAG").unwrap_or_else(|_| format!("untagged-{}", std::process::id()));
    let url = std::env::var("CLAUDE_EVENTS_URL").unwrap_or_default();
    let token = std::env::var("CLAUDE_EVENTS_TOKEN").unwrap_or_default();
    let log_dir = std::env::var("QUAY_STUB_LOG").ok();
    let log_path = log_dir.as_ref().map(|d| {
        let _ = std::fs::create_dir_all(d);
        std::path::Path::new(d).join(format!("{}.jsonl", tag))
    });
    let ctx = Ctx {
        tag: tag.clone(),
        events_host: url.trim_start_matches("http://").trim_end_matches('/').to_string(),
        token: token.clone(),
        log_path,
    };

    // 1. Record what Quay handed us.
    let exe = std::env::current_exe().map(|p| p.display().to_string()).unwrap_or_default();
    let cwd = std::env::current_dir().map(|p| p.display().to_string()).unwrap_or_default();
    let mut env_pairs = Vec::new();
    for (k, v) in std::env::vars() {
        if k.starts_with("CLAUDE_EVENTS_") || k == "QUAY_STUB_LOG" {
            let shown = if k == "CLAUDE_EVENTS_TOKEN" { format!("<{} chars>", v.len()) } else { v.clone() };
            env_pairs.push(format!("{}:{}", js(&k), js(&shown)));
        }
    }
    let mcp_path = argv
        .iter()
        .position(|a| a == "--mcp-config")
        .and_then(|i| argv.get(i + 1))
        .cloned();
    let mcp_file = mcp_path
        .as_ref()
        .map(|p| std::fs::read_to_string(p).unwrap_or_else(|e| format!("<read failed: {}>", e)));
    let mcp_file_masked = mcp_file
        .as_ref()
        .map(|s| if token.is_empty() { s.clone() } else { s.replace(&token, "<token>") });
    let launch = format!(
        "{{\"t\":{},\"kind\":\"launch\",\"exe\":{},\"cwd\":{},\"argv\":[{}],\"env\":{{{}}},\"mcp_config_path\":{},\"mcp_config\":{},\"token_len\":{}}}",
        now_ms(),
        js(&exe),
        js(&cwd),
        argv.iter().map(|a| js(a)).collect::<Vec<_>>().join(","),
        env_pairs.join(","),
        mcp_path.as_deref().map(js).unwrap_or_else(|| "null".into()),
        mcp_file_masked.as_deref().map(js).unwrap_or_else(|| "null".into()),
        token.len()
    );
    ctx.log(&launch);

    println!("\x1b[1;33m  Fake agent CLI (ticket #48 spike)\x1b[0m");
    println!("  exe   : {}", exe);
    println!("  cwd   : {}", cwd);
    println!("  argv  : {:?}", &argv[1..]);
    println!("  URL   : {}", url);
    println!("  TAG   : {}", tag);
    println!("  TOKEN : <{} chars>", token.len());
    for k in ["CLAUDE_EVENTS_TOOLS", "CLAUDE_EVENTS_PERMISSIONS"] {
        println!(
            "  {:<5} : {}",
            k.trim_start_matches("CLAUDE_EVENTS_"),
            std::env::var(k).unwrap_or_else(|_| "<unset>".into())
        );
    }
    match (&mcp_path, &mcp_file_masked) {
        (Some(p), Some(f)) => println!("  mcp   : {}\n{}", p, f),
        _ => println!("  mcp   : <no --mcp-config argument>"),
    }
    let _ = std::io::stdout().flush();

    if ctx.events_host.is_empty() {
        println!("\x1b[31mNo CLAUDE_EVENTS_URL: this terminal kind gets no bridge. Idling; type exit to quit.\x1b[0m");
    } else {
        ctx.post_event("session.started", "{}");
    }

    // 2. Take commands.
    let stdin = std::io::stdin();
    let mut line = String::new();
    loop {
        line.clear();
        match stdin.lock().read_line(&mut line) {
            Ok(0) => break,
            Ok(_) => {}
            Err(e) => {
                ctx.say(&format!("stdin error: {}", e));
                break;
            }
        }
        let cmd = line.trim_end_matches(['\r', '\n']).trim().to_string();
        if cmd.is_empty() {
            continue;
        }
        ctx.log(&format!("{{\"t\":{},\"kind\":\"stdin\",\"line\":{}}}", now_ms(), js(&cmd)));
        if cmd == "exit" {
            break;
        }
        if ctx.events_host.is_empty() {
            ctx.say("no bridge; ignoring");
            continue;
        }
        if let Some(text) = cmd.strip_prefix("run ") {
            ctx.post_event("turn.started", &format!("{{\"prompt\":{}}}", js(text)));
            std::thread::sleep(Duration::from_millis(1500));
            ctx.post_event(
                "tool.started",
                "{\"tool\":\"Read\",\"input\":{\"file_path\":\"src/server.ts\"}}",
            );
            std::thread::sleep(Duration::from_millis(2500));
            ctx.post_event("tool.finished", "{\"tool\":\"Read\"}");
            std::thread::sleep(Duration::from_millis(1000));
            ctx.post_event(
                "turn.completed",
                &format!("{{\"answer\":{}}}", js(&format!("Stub finished: {}", text))),
            );
        } else if cmd == "list" {
            let _ = ctx.mcp(1, "initialize", INIT_PARAMS);
            let _ = ctx.mcp(2, "tools/list", "{}");
            let _ = ctx.mcp(3, "tools/call", "{\"name\":\"quay_list_agents\",\"arguments\":{}}");
        } else if let Some(rest) = cmd.strip_prefix("send ") {
            let (target, text) = rest.split_once(' ').unwrap_or((rest, "hello"));
            ctx.post_event(
                "turn.started",
                &format!("{{\"prompt\":{}}}", js(&format!("send {} {}", target, text))),
            );
            let _ = ctx.mcp(1, "initialize", INIT_PARAMS);
            ctx.post_event(
                "tool.started",
                "{\"tool\":\"mcp__quay__quay_send_message\",\"input\":{\"target_terminal_id\":\"peer\"}}",
            );
            let params = format!(
                "{{\"name\":\"quay_send_message\",\"arguments\":{{\"target_terminal_id\":{},\"message\":{},\"wait_for_reply\":true}}}}",
                js(target),
                js(text)
            );
            let reply = ctx.mcp(4, "tools/call", &params).map(|(_, b)| b).unwrap_or_else(|e| e);
            ctx.post_event("tool.finished", "{\"tool\":\"mcp__quay__quay_send_message\"}");
            ctx.post_event(
                "turn.completed",
                &format!("{{\"answer\":{}}}", js(&format!("Got reply: {}", preview(&reply)))),
            );
        } else {
            // Injected peer message.
            ctx.say(&format!("received: {}", cmd));
            ctx.post_event("turn.started", &format!("{{\"prompt\":{}}}", js(&cmd)));
            std::thread::sleep(Duration::from_millis(1200));
            let short: String = tag.chars().take(8).collect();
            ctx.post_event(
                "turn.completed",
                &format!(
                    "{{\"answer\":{}}}",
                    js(&format!("Stub {} read your message: {}", short, cmd))
                ),
            );
        }
    }
    ctx.log(&format!("{{\"t\":{},\"kind\":\"exit\"}}", now_ms()));
}
