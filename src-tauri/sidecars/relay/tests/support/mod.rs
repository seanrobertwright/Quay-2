//! The relay as a child process, and the listener it talks to.

// Each test file uses its own part of this
#![allow(dead_code)]

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::process::{Child, ChildStdin, Command, ExitStatus, Stdio};
use std::sync::mpsc::{Receiver, channel};
use std::time::{Duration, Instant};

use serde_json::Value;

pub const TOKEN: &str = "tok-relay-secret";

/// How long a test waits for something that should happen at once.
const SOON: Duration = Duration::from_secs(10);

/// How long a test watches for something that should not happen.
const A_WHILE: Duration = Duration::from_millis(500);

/// A listener on a free loopback port that hands each request to the test to answer.
pub struct Listener {
    pub port: u16,
    requests: Receiver<Request>,
}

impl Listener {
    pub fn start() -> Listener {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let (sender, requests) = channel();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let sender = sender.clone();
                std::thread::spawn(move || {
                    if let Some(request) = Request::read(stream.unwrap()) {
                        let _ = sender.send(request);
                    }
                });
            }
        });
        Listener { port, requests }
    }

    pub fn url(&self) -> String {
        format!("http://127.0.0.1:{}/mcp", self.port)
    }

    /// The next request to arrive.
    pub fn next(&self) -> Request {
        self.requests.recv_timeout(SOON).expect("no request arrived")
    }

    /// Whether no request arrives for a while.
    pub fn stays_unused(&self) -> bool {
        self.requests.recv_timeout(A_WHILE).is_err()
    }
}

/// One HTTP request, with its connection still open.
pub struct Request {
    pub head: String,
    pub body: String,
    stream: TcpStream,
}

impl Request {
    fn read(mut stream: TcpStream) -> Option<Request> {
        let mut bytes = Vec::new();
        let mut buf = vec![0u8; 64 * 1024];
        stream.set_read_timeout(Some(SOON)).unwrap();
        loop {
            let n = stream.read(&mut buf).ok().filter(|&n| n > 0)?;
            bytes.extend_from_slice(&buf[..n]);
            let Some(end) = bytes.windows(4).position(|four| four == b"\r\n\r\n") else { continue };
            let head = String::from_utf8_lossy(&bytes[..end + 2]).to_string();
            let length: usize = header(&head, "content-length")?.parse().ok()?;
            while bytes.len() < end + 4 + length {
                let n = stream.read(&mut buf).ok().filter(|&n| n > 0)?;
                bytes.extend_from_slice(&buf[..n]);
            }
            let body = String::from_utf8_lossy(&bytes[end + 4..]).to_string();
            return Some(Request { head, body, stream });
        }
    }

    pub fn header(&self, name: &str) -> Option<&str> {
        header(&self.head, name)
    }

    /// Answers 200 with `body` as JSON.
    pub fn answer(self, body: &str) {
        self.respond("200 OK", "Content-Type: application/json\r\n", body);
    }

    /// Answers with a status line's `status`, more `headers` and `body`.
    pub fn respond(mut self, status: &str, headers: &str, body: &str) {
        let response = format!("HTTP/1.1 {status}\r\n{headers}Content-Length: {}\r\n\r\n{body}", body.len());
        let _ = self.stream.write_all(response.as_bytes());
    }

    /// Whether the relay closes this request's connection soon.
    pub fn closes_soon(&mut self) -> bool {
        self.closes_within(SOON)
    }

    /// Whether this request's connection stays open for a while.
    pub fn stays_open(&mut self) -> bool {
        !self.closes_within(A_WHILE)
    }

    fn closes_within(&mut self, limit: Duration) -> bool {
        self.stream.set_read_timeout(Some(limit)).unwrap();
        match self.stream.read(&mut [0u8; 16]) {
            Ok(0) => true,
            Ok(_) => panic!("the relay sent more on the same connection"),
            Err(e) => !matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut),
        }
    }
}

fn header<'a>(head: &'a str, name: &str) -> Option<&'a str> {
    head.lines()
        .filter_map(|line| line.split_once(": "))
        .find(|(key, _)| key.eq_ignore_ascii_case(name))
        .map(|(_, value)| value)
}

/// The relay, as a child process on pipes. It is killed when dropped.
pub struct Relay {
    child: Child,
    stdin: Option<ChildStdin>,
    stdout: Receiver<String>,
    stderr: Option<std::thread::JoinHandle<String>>,
}

impl Relay {
    pub fn start(url: &str, token: &str) -> Relay {
        Relay::with_env(&[("QUAY_MCP_URL", url), ("QUAY_A2A_TOKEN", token)])
    }

    /// Starts the relay with only the `QUAY_*` variables in `vars`.
    pub fn with_env(vars: &[(&str, &str)]) -> Relay {
        let mut relay = Relay::unread(vars);
        relay.read_stdout();
        relay
    }

    /// Starts to read what `unread` leaves unread.
    pub fn read_stdout(&mut self) {
        let (sender, stdout) = channel();
        let out = BufReader::new(self.child.stdout.take().unwrap());
        std::thread::spawn(move || {
            for line in out.lines() {
                let Ok(line) = line else { break };
                if sender.send(line).is_err() {
                    break;
                }
            }
        });
        self.stdout = stdout;
    }

    /// As `with_env`, but nothing reads the relay's stdout.
    pub fn unread(vars: &[(&str, &str)]) -> Relay {
        let mut command = Command::new(env!("CARGO_BIN_EXE_quay-relay"));
        for (name, _) in std::env::vars_os() {
            if name.to_string_lossy().to_uppercase().starts_with("QUAY_") {
                command.env_remove(name);
            }
        }
        let mut child = command
            .envs(vars.iter().copied())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let mut err = child.stderr.take().unwrap();
        let stderr = std::thread::spawn(move || {
            let mut text = String::new();
            let _ = err.read_to_string(&mut text);
            text
        });
        let stdin = child.stdin.take();
        Relay { child, stdin, stdout: channel().1, stderr: Some(stderr) }
    }

    /// Writes `line` and a newline to the relay's stdin.
    pub fn send(&mut self, line: &str) {
        let stdin = self.stdin.as_mut().unwrap();
        stdin.write_all(line.as_bytes()).unwrap();
        stdin.write_all(b"\n").unwrap();
        stdin.flush().unwrap();
    }

    /// The next line of the relay's stdout, which must be JSON.
    pub fn next(&self) -> Value {
        self.next_within(SOON)
    }

    pub fn next_within(&self, limit: Duration) -> Value {
        let line = self.stdout.recv_timeout(limit).expect("no line on stdout");
        serde_json::from_str(&line).unwrap_or_else(|e| panic!("not protocol ({e}): {line}"))
    }

    /// Whether nothing comes on stdout for a while.
    pub fn stays_silent(&self) -> bool {
        self.stdout.recv_timeout(A_WHILE).is_err()
    }

    /// Closes the relay's stdin, as a CLI that is done with it does.
    pub fn close_stdin(&mut self) {
        self.stdin = None;
    }

    /// Closes the end of the relay's stdout that `unread` leaves unread.
    pub fn close_stdout(&mut self) {
        self.child.stdout = None;
    }

    /// The relay's stdin, for a thread that writes to it for as long as the relay reads.
    pub fn take_stdin(&mut self) -> ChildStdin {
        self.stdin.take().unwrap()
    }

    /// How the relay exits, if it exits soon.
    pub fn exits_soon(&mut self) -> Option<ExitStatus> {
        self.exits_within(SOON)
    }

    pub fn exits_within(&mut self, limit: Duration) -> Option<ExitStatus> {
        let deadline = Instant::now() + limit;
        while Instant::now() < deadline {
            if let Some(status) = self.child.try_wait().unwrap() {
                return Some(status);
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        None
    }

    /// Closes stdin, waits for the relay to exit and returns what is left of its stdout and
    /// all of its stderr.
    pub fn finish(mut self) -> (Vec<String>, String) {
        self.close_stdin();
        assert!(self.exits_soon().is_some(), "the relay did not exit");
        let stderr = self.stderr.take().unwrap().join().unwrap();
        (self.stdout.iter().collect(), stderr)
    }
}

impl Drop for Relay {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
