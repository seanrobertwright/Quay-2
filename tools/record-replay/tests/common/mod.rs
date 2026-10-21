//! What the round-trip tests stand in for: a terminal Quay opens (a PTY whose command is
//! resolved through the PATH the fixture workspace saves), and Quay's local bridge.

#![allow(dead_code)]

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use portable_pty::{CommandBuilder, PtySize, native_pty_system};

pub const TOOL: &str = env!("CARGO_BIN_EXE_quay-record-replay");
pub const STUB: &str = env!("CARGO_BIN_EXE_stub-agent");

/// A folder of its own under the temp folder, removed when the test passes.
pub struct Scratch {
    pub root: PathBuf,
}

impl Scratch {
    pub fn new(name: &str) -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let root = std::env::temp_dir().join(format!(
            "quay-record-replay-{name}-{}-{nanos}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::SeqCst)
        ));
        std::fs::create_dir_all(&root).unwrap();
        Scratch { root }
    }

    pub fn dir(&self, rel: &str) -> PathBuf {
        let dir = self.root.join(rel);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Copies `exe` into folder `rel` as `<name>.exe`, the way a capture puts the tool or a
    /// CLI on the fixture's PATH.
    pub fn install(&self, exe: &str, rel: &str, name: &str) -> PathBuf {
        let dir = self.dir(rel);
        let to = dir.join(format!("{name}{}", std::env::consts::EXE_SUFFIX));
        std::fs::copy(exe, &to).unwrap();
        dir
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        if !std::thread::panicking() {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }
}

/// The PATH a fixture workspace saves in `env_vars`: the given folders, then the system folder.
pub fn fixture_path(dirs: &[&Path]) -> String {
    let mut parts: Vec<String> = dirs.iter().map(|d| d.display().to_string()).collect();
    if let Ok(root) = std::env::var("SystemRoot") {
        parts.push(format!("{root}\\system32"));
    }
    parts.join(if cfg!(windows) { ";" } else { ":" })
}

/// One HTTP request the fake bridge received.
#[derive(Debug, Clone)]
pub struct Received {
    pub at: Instant,
    pub method: String,
    pub path: String,
    pub headers: HashMap<String, String>,
    pub body: String,
}

impl Received {
    pub fn json(&self) -> serde_json::Value {
        serde_json::from_str(&self.body).unwrap_or(serde_json::Value::Null)
    }

    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.get(&name.to_ascii_lowercase()).map(String::as_str)
    }

    /// The event type of a `/v1/events` post, or the JSON-RPC method (and tool name) of an
    /// `/mcp` call.
    pub fn what(&self) -> String {
        let body = self.json();
        if self.path == "/v1/events" {
            body["events"].as_array().map(|events| {
                events.iter().map(|e| e["type"].as_str().unwrap_or("?").to_string()).collect::<Vec<_>>().join("+")
            }).unwrap_or_default()
        } else {
            match body["params"]["name"].as_str() {
                Some(tool) => format!("{} {tool}", body["method"].as_str().unwrap_or("?")),
                None => body["method"].as_str().unwrap_or("?").to_string(),
            }
        }
    }
}

/// Quay's local bridge as far as an agent CLI sees it: it answers `/v1/events` with 200 and
/// `/mcp` calls with a JSON-RPC result naming the caller's token, and keeps every request.
pub struct FakeBridge {
    pub port: u16,
    pub started: Instant,
    received: Arc<Mutex<Vec<Received>>>,
}

impl FakeBridge {
    pub fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let received = Arc::new(Mutex::new(Vec::new()));
        let sink = received.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let sink = sink.clone();
                std::thread::spawn(move || serve(stream, sink));
            }
        });
        FakeBridge { port, started: Instant::now(), received }
    }

    pub fn url(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    /// The inline `--mcp-config` value Quay passes Claude Code.
    pub fn mcp_config(&self) -> String {
        serde_json::json!({
            "mcpServers": { "quay": {
                "type": "http",
                "url": format!("http://127.0.0.1:{}/mcp", self.port),
                "headers": { "Authorization": "Bearer ${CLAUDE_EVENTS_TOKEN}" }
            }}
        })
        .to_string()
    }

    pub fn received(&self) -> Vec<Received> {
        self.received.lock().unwrap().clone()
    }

    pub fn wait_for(&self, count: usize, timeout: Duration) -> Vec<Received> {
        let deadline = Instant::now() + timeout;
        loop {
            let got = self.received();
            if got.len() >= count || Instant::now() > deadline {
                return got;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    }
}

fn serve(stream: TcpStream, sink: Arc<Mutex<Vec<Received>>>) {
    let mut writer = stream.try_clone().unwrap();
    let mut reader = BufReader::new(stream);
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).unwrap_or(0) == 0 {
            return;
        }
        let mut parts = line.split_whitespace();
        let method = parts.next().unwrap_or("").to_string();
        let path = parts.next().unwrap_or("").to_string();
        let mut headers = HashMap::new();
        loop {
            let mut h = String::new();
            if reader.read_line(&mut h).unwrap_or(0) == 0 {
                return;
            }
            let h = h.trim_end();
            if h.is_empty() {
                break;
            }
            if let Some((k, v)) = h.split_once(':') {
                headers.insert(k.trim().to_ascii_lowercase(), v.trim().to_string());
            }
        }
        let len: usize = headers.get("content-length").and_then(|v| v.parse().ok()).unwrap_or(0);
        let mut body = vec![0; len];
        if reader.read_exact(&mut body).is_err() {
            return;
        }
        let request = Received {
            at: Instant::now(),
            method,
            path,
            headers,
            body: String::from_utf8_lossy(&body).to_string(),
        };
        let reply = if request.path == "/mcp" {
            let caller = request.header("authorization").unwrap_or("none").to_string();
            serde_json::json!({ "jsonrpc": "2.0", "id": request.json()["id"], "result": { "caller": caller } }).to_string()
        } else {
            String::new()
        };
        let close = request.header("connection").is_some_and(|c| c.eq_ignore_ascii_case("close"));
        sink.lock().unwrap().push(request);
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n{}\r\n{reply}",
            reply.len(),
            if close { "Connection: close\r\n" } else { "" }
        );
        if writer.write_all(response.as_bytes()).is_err() || close {
            return;
        }
    }
}

/// A terminal as Quay opens one: a PTY running `program`, resolved through the `PATH` in `env`.
pub struct Terminal {
    pub started: Instant,
    output: Arc<Mutex<String>>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
    _master: Box<dyn portable_pty::MasterPty + Send>,
}

impl Terminal {
    pub fn open(program: &str, args: &[String], env: &[(&str, String)], cwd: &Path, cols: u16, rows: u16) -> Self {
        let pair = native_pty_system()
            .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .unwrap();
        let mut cmd = CommandBuilder::new(program);
        for arg in args {
            cmd.arg(arg);
        }
        for (k, v) in env {
            cmd.env(k, v);
        }
        cmd.cwd(cwd);
        let started = Instant::now();
        let child = pair.slave.spawn_command(cmd).unwrap();
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().unwrap();
        let output = Arc::new(Mutex::new(String::new()));
        let writer = Arc::new(Mutex::new(pair.master.take_writer().unwrap()));
        let sink = output.clone();
        let answer = writer.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            while let Ok(n) = reader.read(&mut buf) {
                if n == 0 {
                    break;
                }
                let chunk = String::from_utf8_lossy(&buf[..n]).to_string();
                // ConPTY asks where the cursor is when it starts; xterm answers, and so do we.
                for _ in 0..chunk.matches("\x1b[6n").count() {
                    let mut w = answer.lock().unwrap();
                    let _ = w.write_all(b"\x1b[1;1R");
                    let _ = w.flush();
                }
                sink.lock().unwrap().push_str(&chunk);
            }
        });
        Terminal { started, output, writer, child, _master: pair.master }
    }

    /// Everything the terminal showed, without escape sequences.
    pub fn text(&self) -> String {
        strip_ansi(&self.output.lock().unwrap())
    }

    pub fn wait_for_text(&self, needle: &str, timeout: Duration) {
        let deadline = Instant::now() + timeout;
        while !self.text().contains(needle) {
            assert!(Instant::now() < deadline, "terminal never showed {needle:?}; it showed:\n{}", self.text());
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    pub fn type_text(&mut self, text: &str) {
        let mut writer = self.writer.lock().unwrap();
        writer.write_all(text.as_bytes()).unwrap();
        writer.flush().unwrap();
    }

    pub fn wait_exit(&mut self, timeout: Duration) -> u32 {
        let deadline = Instant::now() + timeout;
        loop {
            if let Some(status) = self.child.try_wait().unwrap() {
                return status.exit_code();
            }
            assert!(Instant::now() < deadline, "the terminal's program never exited; it showed:\n{}", self.text());
            std::thread::sleep(Duration::from_millis(20));
        }
    }
}

impl Drop for Terminal {
    fn drop(&mut self) {
        let _ = self.child.kill();
    }
}

pub fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '\x1b' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('[') => {
                while let Some(c) = chars.next() {
                    if ('@'..='~').contains(&c) {
                        break;
                    }
                }
            }
            Some(']') => {
                while let Some(c) = chars.next() {
                    if c == '\x07' {
                        break;
                    }
                    if c == '\x1b' {
                        chars.next();
                        break;
                    }
                }
            }
            _ => {}
        }
    }
    out
}

/// Reads a gzipped file as text.
pub fn gunzip(path: &Path) -> String {
    let file = std::fs::File::open(path).unwrap_or_else(|e| panic!("open {}: {e}", path.display()));
    let mut text = String::new();
    flate2::read::GzDecoder::new(file).read_to_string(&mut text).unwrap();
    text
}

pub fn file_names(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> =
        std::fs::read_dir(dir).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().to_string()).collect();
    names.sort();
    names
}
