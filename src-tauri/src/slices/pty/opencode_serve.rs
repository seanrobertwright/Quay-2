//! How an OpenCode terminal is launched, by OpenCode's version. OpenCode 1.x runs its TUI with
//! `--port`, and the TUI serves its events there (see `opencode_watch`). OpenCode 2.x refuses
//! `--port`, so Quay starts `opencode serve` on the port as a sidecar of the terminal, behind a
//! password only that launch has, and runs the TUI in the PTY with `--server` pointed at it.
//! `opencode2_watch` reads its events.

use std::sync::Arc;
use std::time::{Duration, Instant};

use parking_lot::Mutex;

use crate::spawn::ProcessTree;

/// How Quay launches an OpenCode terminal, with where its events are served.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OpenCodeLaunch {
    /// OpenCode 1.x: the TUI, with `--port`, serves its events on the loopback port.
    Tui(u16),
    /// OpenCode 2.x: `opencode serve` as the terminal's sidecar, and the TUI connected to it
    /// with `--server`.
    Server(OpenCodeServer),
}

impl OpenCodeLaunch {
    /// The loopback port the terminal's events are served on.
    pub fn port(&self) -> u16 {
        match self {
            OpenCodeLaunch::Tui(port) => *port,
            OpenCodeLaunch::Server(server) => server.port(),
        }
    }
}

/// The user OpenCode 2.x's server takes a password from, which it doesn't let anyone change.
const SERVER_USER: &str = "opencode";

/// An OpenCode 2.x terminal's own server: the loopback port it listens on and the password it
/// asks for, which is random and this launch's alone. The password goes to `opencode serve` and
/// to the TUI through their environment, never on a command line, and Quay sends it as Basic
/// auth; it is never logged, shown or stored. The `Debug` form leaves it out.
#[derive(Clone, PartialEq, Eq)]
pub struct OpenCodeServer {
    port: u16,
    password: String,
}

impl OpenCodeServer {
    /// A server for a new launch on loopback `port`, with a fresh random password.
    fn new(port: u16) -> OpenCodeServer {
        // Two v4 UUIDs: 244 random bits, as letters and digits
        let password = format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple());
        OpenCodeServer { port, password }
    }

    /// The loopback port the server listens on.
    pub fn port(&self) -> u16 {
        self.port
    }

    /// The server's URL, as the TUI's `--server` takes it.
    pub fn url(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    /// The launch's password, for the environment of `opencode serve` and its TUI.
    pub(super) fn password(&self) -> &str {
        &self.password
    }

    /// The `Authorization` header value the server takes: Basic auth as `opencode`.
    pub(super) fn authorization(&self) -> String {
        use base64::Engine;
        let credential = format!("{}:{}", SERVER_USER, self.password);
        format!("Basic {}", base64::engine::general_purpose::STANDARD.encode(credential))
    }
}

#[cfg(test)]
impl OpenCodeServer {
    /// The server a 2.x launch on loopback `port` gets, with a fresh random password.
    pub(crate) fn for_tests(port: u16) -> OpenCodeServer {
        OpenCodeServer::new(port)
    }
}

impl std::fmt::Debug for OpenCodeServer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("OpenCodeServer").field("port", &self.port).finish_non_exhaustive()
    }
}

/// The major version in what `opencode --version` printed: the first word that reads as
/// `major.minor`, with or without a leading `v`.
fn major_version(printed: &str) -> Option<u64> {
    printed.split_whitespace().find_map(|word| {
        let word = word.strip_prefix('v').unwrap_or(word);
        let (major, rest) = word.split_once('.')?;
        let minor_starts = rest.chars().next().is_some_and(|c| c.is_ascii_digit());
        let major_is_number = !major.is_empty() && major.bytes().all(|b| b.is_ascii_digit());
        (major_is_number && minor_starts).then(|| major.parse().ok()).flatten()
    })
}

/// The launch, on `port`, of the OpenCode whose `--version` printed `printed`, or that printed
/// nothing Quay could read (`None`). Only a version below 2 is launched as 1.x; anything else, a
/// probe that failed included, as 2.x, the form new installs get, with a password of its own.
pub fn launch_of(printed: Option<&str>, port: u16) -> OpenCodeLaunch {
    match printed.and_then(major_version) {
        Some(major) if major < 2 => OpenCodeLaunch::Tui(port),
        _ => OpenCodeLaunch::Server(OpenCodeServer::new(port)),
    }
}

/// The most of a probe's output that is read.
const PROBE_OUTPUT_CAP: u64 = 64 * 1024;

/// Runs `cmd`, from `hidden_command`, as `opencode --version`, and returns what it printed to
/// stdout. It blocks for at most `patience`. Whatever happens, the process and everything it
/// started are killed before it returns. It returns `None` when the process can't start, isn't
/// done within `patience`, or can't be waited for.
pub fn probe_version(mut cmd: std::process::Command, patience: Duration) -> Option<String> {
    use std::io::Read;
    use std::process::Stdio;
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
    let mut tree = crate::spawn::spawn_tree_tied(&mut cmd).ok()?;
    let deadline = Instant::now() + patience;
    let (tx, rx) = std::sync::mpsc::channel();
    if let Some(stdout) = tree.child().stdout.take() {
        std::thread::spawn(move || {
            let mut printed = Vec::new();
            let _ = stdout.take(PROBE_OUTPUT_CAP).read_to_end(&mut printed);
            let _ = tx.send(printed);
        });
    }
    let exited = loop {
        match tree.child().try_wait() {
            Ok(Some(_)) => break true,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(20)),
            _ => break false,
        }
    };
    // A grandchild can still hold the pipe once the root has exited, so the read is bounded too
    let printed = exited
        .then(|| rx.recv_timeout(deadline.saturating_duration_since(Instant::now())).ok())
        .flatten();
    tree.kill();
    printed.map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
}

/// The most of a sidecar's output that is kept, from its end, to show when it fails.
const TAIL_CAP: usize = 4 * 1024;

/// Pause between checks of whether a sidecar is ready.
const READY_POLL: Duration = Duration::from_millis(100);

/// How long a sidecar's default model must stay the same to count as settled. OpenCode 2.4.1
/// answers its config before it has loaded the providers it names, and until then its default
/// model is none, then one of its own free ones: a TUI started then would send its launch
/// prompt there. The configured one has followed within a second of the free one.
const MODEL_SETTLE: Duration = Duration::from_secs(1);

/// The model a server's `GET /api/model/default` answer names, as `provider/model`, or `None`
/// while it names none.
fn default_model_of(answer: &serde_json::Value) -> Option<String> {
    let data = &answer["data"];
    Some(format!("{}/{}", data["providerID"].as_str()?, data["id"].as_str()?))
}

/// Follows a server's default model until it has named the same one for `MODEL_SETTLE`.
#[derive(Default)]
struct ModelSettle {
    seen: Option<(String, Instant)>,
}

impl ModelSettle {
    /// Takes the model the server names now, at `now`, and says whether it has settled.
    fn settled(&mut self, model: Option<String>, now: Instant) -> bool {
        match (&self.seen, model) {
            (Some((seen, since)), Some(model)) if *seen == model => now.duration_since(*since) >= MODEL_SETTLE,
            (_, model) => {
                self.seen = model.map(|model| (model, now));
                false
            }
        }
    }
}

/// The last `TAIL_CAP` bytes or so a sidecar printed, to stdout and stderr together.
#[derive(Default)]
struct Tail(Mutex<String>);

impl Tail {
    fn push(&self, text: &str) {
        let mut tail = self.0.lock();
        tail.push_str(text);
        if tail.len() > TAIL_CAP {
            let mut cut = tail.len() - TAIL_CAP;
            while !tail.is_char_boundary(cut) {
                cut += 1;
            }
            tail.drain(..cut);
        }
    }

    /// What was printed, as plain text with `password` masked, for a failure message.
    fn shown(&self, password: &str) -> String {
        match plain(&self.0.lock()).replace(password, "(password)").trim() {
            "" => "It printed nothing.".to_string(),
            printed => format!("It printed:\n{}", printed),
        }
    }
}

/// `text` without its terminal escape sequences and control characters, other than line breaks
/// and tabs, so a CLI's output can be shown as plain text.
fn plain(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '\u{1b}' => match chars.next() {
                // CSI: up to its final byte
                Some('[') => {
                    for c in chars.by_ref() {
                        if ('\u{40}'..='\u{7e}').contains(&c) {
                            break;
                        }
                    }
                }
                // OSC: up to BEL or ST
                Some(']') => {
                    while let Some(c) = chars.next() {
                        if c == '\u{7}' || (c == '\u{1b}' && chars.next_if_eq(&'\\').is_some()) {
                            break;
                        }
                    }
                }
                _ => {}
            },
            '\n' | '\t' => out.push(ch),
            c if c.is_control() => {}
            c => out.push(c),
        }
    }
    out
}

/// Reads `pipe` to its end into `tail`, on a thread of its own, so the process never blocks on a
/// full pipe.
fn drain(pipe: Option<impl std::io::Read + Send + 'static>, tail: &Arc<Tail>) {
    let Some(mut pipe) = pipe else {
        return;
    };
    let tail = tail.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        while let Ok(n) = pipe.read(&mut buf) {
            if n == 0 {
                break;
            }
            tail.push(&String::from_utf8_lossy(&buf[..n]));
        }
    });
}

/// Whether `config`, what an OpenCode 2.x server answered to `GET /api/config`, is this launch's:
/// one of the layers it lists has Quay's MCP server at `mcp_url`, which names the launch.
/// OpenCode 2.4.1 lists each layer as an entry, a `document` one with its config as `info`, and
/// moves the `mcp.quay` that `OPENCODE_CONFIG_CONTENT` gives it to `mcp.servers.quay`.
fn is_launchs_config(config: &serde_json::Value, mcp_url: &str) -> bool {
    let same = |url: &str| url.trim_end_matches('/') == mcp_url.trim_end_matches('/');
    config
        .as_array()
        .into_iter()
        .flatten()
        .any(|entry| entry["info"]["mcp"]["servers"]["quay"]["url"].as_str().is_some_and(same))
}

/// An OpenCode 2.x terminal's `opencode serve`, and everything it started. It is ended when it is
/// dropped, or by its `SidecarEnder`, whichever comes first.
pub struct Sidecar {
    tree: Arc<Mutex<Option<ProcessTree>>>,
}

/// What ends a `Sidecar` from elsewhere, such as the thread watching its terminal's process.
#[derive(Clone)]
pub struct SidecarEnder(Arc<Mutex<Option<ProcessTree>>>);

impl SidecarEnder {
    /// Kills the sidecar and everything it started, and reaps it. It blocks until they have
    /// exited (see `ProcessTree::kill`). Once ended, it does nothing.
    pub fn end(&self) {
        let tree = self.0.lock().take();
        if let Some(mut tree) = tree {
            tree.kill();
        }
    }
}

impl Sidecar {
    /// Starts `cmd`, `opencode serve` from `hidden_command` with `server`'s port and password, as
    /// a tree tied to Quay (see `spawn_tree_tied`), its output drained, and blocks until the
    /// server takes the password and serves this launch's config, the one whose Quay MCP server
    /// is `mcp_url`, and then until its default model has settled (see `MODEL_SETTLE`). It fails,
    /// with the sidecar ended, when the process exits first, when another server answers on the
    /// port, or when `patience` passes before the config is served; a model still unsettled then
    /// doesn't stop the launch. A failure says why in plain text, with the end of what the
    /// process printed and the password masked, for the terminal's pane. Call it on a thread
    /// that may block, outside any async runtime.
    pub fn start(
        mut cmd: std::process::Command,
        server: &OpenCodeServer,
        mcp_url: &str,
        patience: Duration,
    ) -> Result<Sidecar, String> {
        let port = server.port();
        use std::process::Stdio;
        cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
        let mut tree = crate::spawn::spawn_tree_tied(&mut cmd)
            .map_err(|e| format!("Quay couldn't start OpenCode's server (`opencode serve`): {}", e))?;
        let tail = Arc::new(Tail::default());
        drain(tree.child().stdout.take(), &tail);
        drain(tree.child().stderr.take(), &tail);
        let sidecar = Sidecar { tree: Arc::new(Mutex::new(Some(tree))) };
        let failed = |why: String| {
            sidecar.ender().end();
            Err(why)
        };
        let runtime = match tokio::runtime::Builder::new_current_thread().enable_all().build() {
            Ok(runtime) => runtime,
            Err(e) => return failed(format!("Quay couldn't wait for OpenCode's server: {}", e)),
        };

        let deadline = Instant::now() + patience;
        let mut configured = false;
        let mut model = ModelSettle::default();
        loop {
            let exited = sidecar.tree.lock().as_mut().map(|tree| tree.child().try_wait());
            match exited {
                Some(Ok(None)) => {}
                Some(Ok(Some(status))) => {
                    return failed(format!(
                        "OpenCode's server exited before it was ready ({}). {}",
                        status,
                        tail.shown(server.password())
                    ))
                }
                Some(Err(e)) => return failed(format!("Quay couldn't watch OpenCode's server: {}", e)),
                None => return failed("OpenCode's server was ended before it was ready.".to_string()),
            }
            if configured {
                let answer = runtime.block_on(super::opencode2_watch::get_json(server, "/api/model/default"));
                if model.settled(answer.ok().as_ref().and_then(default_model_of), Instant::now())
                    || Instant::now() >= deadline
                {
                    return Ok(sidecar);
                }
                std::thread::sleep(READY_POLL);
                continue;
            }
            // A server that answers at all, other than with a server error, settles it: only
            // this launch's takes its password and names its MCP server
            let answer = runtime.block_on(super::opencode2_watch::get_json(server, "/api/config"));
            let settled = match &answer {
                Ok(_) => true,
                Err(e) => e.status.is_some_and(|status| status < 500),
            };
            if settled {
                if answer.is_ok_and(|config| is_launchs_config(&config, mcp_url)) {
                    configured = true;
                    continue;
                }
                return failed(format!(
                    "Port {} is served by another process, so this OpenCode terminal didn't connect to it. \
                     Relaunch the terminal to try another port.",
                    port
                ));
            }
            if Instant::now() >= deadline {
                return failed(format!(
                    "OpenCode's server wasn't ready on port {} within {} s. {}",
                    port,
                    patience.as_secs_f32(),
                    tail.shown(server.password())
                ));
            }
            std::thread::sleep(READY_POLL);
        }
    }

    /// What ends this sidecar from elsewhere.
    pub fn ender(&self) -> SidecarEnder {
        SidecarEnder(self.tree.clone())
    }
}

impl Drop for Sidecar {
    /// Ends the sidecar on a thread of its own, so a drop never waits on the kill, under a lock or
    /// anywhere else.
    fn drop(&mut self) {
        let ender = self.ender();
        if ender.0.lock().is_some() {
            std::thread::spawn(move || ender.end());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// What a loaded machine may take, beyond any patience under test, to spawn a stand-in
    /// process tree and kill it: seconds each, and the kill waits at most `KILL_PATIENCE` for the
    /// tree to exit. Every time limit here that also counts a spawn or a kill adds this.
    const LOADED_SLACK: Duration = Duration::from_secs(20);

    /// The port of `launch` when it is OpenCode 2.x's.
    fn server_port(launch: OpenCodeLaunch) -> Option<u16> {
        match launch {
            OpenCodeLaunch::Server(server) => Some(server.port()),
            OpenCodeLaunch::Tui(_) => None,
        }
    }

    #[test]
    fn a_version_below_2_is_launched_as_1x_and_anything_else_as_2x() {
        assert_eq!(launch_of(Some("1.19.4\n"), 4567), OpenCodeLaunch::Tui(4567));
        assert_eq!(launch_of(Some("opencode v0.9.1"), 4567), OpenCodeLaunch::Tui(4567));
        assert_eq!(server_port(launch_of(Some("2.4.1\n"), 4567)), Some(4567));
        // What OpenCode 2.4.1 prints
        assert_eq!(server_port(launch_of(Some("opencode v2.4.1\n"), 4567)), Some(4567));
        assert_eq!(server_port(launch_of(Some("opencode 10.0.0"), 4567)), Some(4567));
        // Nothing readable, or no answer at all: the form new installs get
        assert_eq!(server_port(launch_of(Some(""), 4567)), Some(4567));
        assert_eq!(server_port(launch_of(Some("command not found"), 4567)), Some(4567));
        assert_eq!(server_port(launch_of(Some("v.1"), 4567)), Some(4567));
        assert_eq!(server_port(launch_of(None, 4567)), Some(4567));
    }

    #[test]
    fn each_2x_launch_has_a_long_random_password_of_its_own_that_its_debug_form_never_shows() {
        let (first, second) = (OpenCodeServer::for_tests(4567), OpenCodeServer::for_tests(4567));
        assert_ne!(first.password(), second.password());
        assert!(first.password().len() >= 32, "{} characters", first.password().len());
        assert!(first.password().bytes().all(|b| b.is_ascii_alphanumeric()));
        let shown = format!("{:?} {:?}", first, OpenCodeLaunch::Server(first.clone()));
        assert!(!shown.contains(first.password()), "{shown}");
        assert!(shown.contains("4567"), "{shown}");
    }

    #[test]
    fn a_2x_server_is_reached_on_loopback_with_basic_auth_as_opencode() {
        let server = OpenCodeServer::for_tests(4567);
        assert_eq!(server.url(), "http://127.0.0.1:4567");
        // The credential OpenCode 2.4.1's server checks: user `opencode`, the launch's password
        let expected = format!("opencode:{}", server.password());
        let sent = server.authorization();
        let encoded = sent.strip_prefix("Basic ").expect("Basic auth");
        use base64::Engine;
        let decoded = base64::engine::general_purpose::STANDARD.decode(encoded).unwrap();
        assert_eq!(String::from_utf8(decoded).unwrap(), expected);
    }

    /// A command that runs `windows` through cmd.exe on Windows, and `unix` through sh elsewhere.
    fn shell(windows: &str, unix: &str) -> std::process::Command {
        let (program, flag, script) = if cfg!(windows) { ("cmd.exe", "/c", windows) } else { ("sh", "-c", unix) };
        let mut cmd = crate::spawn::hidden_command(program);
        cmd.args([flag, script]);
        cmd
    }

    /// A command that prints `text` and exits.
    fn printing(text: &str) -> std::process::Command {
        let script = format!("echo {text}");
        shell(&script, &script)
    }

    /// A command that runs for two minutes, through a shell, as an npm shim runs its CLI.
    fn lingering() -> std::process::Command {
        shell("ping -n 120 127.0.0.1", "sleep 120; :")
    }

    #[test]
    fn the_version_probe_returns_what_the_cli_printed() {
        let printed = probe_version(printing("2.4.1"), Duration::from_secs(10));
        assert_eq!(printed.as_deref().map(str::trim), Some("2.4.1"));
    }

    #[test]
    fn a_version_probe_that_outlasts_its_patience_is_killed_and_reads_as_none() {
        // A probe that waited for the command to exit would take its two minutes.
        let patience = Duration::from_millis(500);
        let started = std::time::Instant::now();
        assert_eq!(probe_version(lingering(), patience), None);
        assert!(started.elapsed() < patience + LOADED_SLACK, "the probe waited {:?}", started.elapsed());
    }

    const MCP_URL: &str = "http://127.0.0.1:4321/mcp/7";

    /// What OpenCode 2.4.1 answers to `GET /api/model/default`: `model`, as `provider/model`, or
    /// no model while it is still loading its providers.
    fn default_model(model: Option<&str>) -> serde_json::Value {
        let data = model.and_then(|m| m.split_once('/')).map_or(serde_json::Value::Null, |(provider, id)| {
            serde_json::json!({ "id": id, "modelID": id, "providerID": provider, "name": id })
        });
        serde_json::json!({ "location": { "directory": "C:\\x" }, "data": data })
    }

    /// `serving_models`, with the configured model already loaded.
    fn serving(config: serde_json::Value) -> OpenCodeServer {
        serving_models(config, vec![default_model(Some("fake/fixed"))]).0
    }

    /// A stand-in for OpenCode 2.4.1's `opencode serve` on a free loopback port: it answers a
    /// request with the returned server's password with `config` as JSON, as `GET /api/config`
    /// does, and any other with 401 and the error OpenCode sends. Its `GET /api/model/default`
    /// answers each of `defaults` in turn, then the last one from then on. Also returns how many
    /// times it has answered the last one.
    fn serving_models(
        config: serde_json::Value,
        defaults: Vec<serde_json::Value>,
    ) -> (OpenCodeServer, Arc<std::sync::atomic::AtomicUsize>) {
        use std::io::{Read, Write};
        use std::sync::atomic::{AtomicUsize, Ordering};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let server = OpenCodeServer::for_tests(listener.local_addr().unwrap().port());
        let authorization = format!("authorization: {}", server.authorization()).to_ascii_lowercase();
        let body = config.to_string();
        let settled = Arc::new(AtomicUsize::new(0));
        let last_served = settled.clone();
        let mut defaults = defaults.into_iter().map(|d| d.to_string()).collect::<std::collections::VecDeque<_>>();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                let mut request = Vec::new();
                let mut buf = [0u8; 1024];
                while !request.windows(4).any(|w| w == b"\r\n\r\n") {
                    match stream.read(&mut buf) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => request.extend_from_slice(&buf[..n]),
                    }
                }
                let request = String::from_utf8_lossy(&request).to_ascii_lowercase();
                let asks_default = request.starts_with("get /api/model/default ");
                let (status, body) = match request.lines().any(|line| line.trim() == authorization) {
                    true if asks_default => {
                        if defaults.len() > 1 {
                            ("200 OK", defaults.pop_front().unwrap_or_default())
                        } else {
                            last_served.fetch_add(1, Ordering::SeqCst);
                            ("200 OK", defaults.front().cloned().unwrap_or_default())
                        }
                    }
                    true => ("200 OK", body.clone()),
                    false => (
                        "401 Unauthorized",
                        r#"{"_tag":"UnauthorizedError","message":"Authentication required"}"#.to_string(),
                    ),
                };
                let _ = write!(
                    stream,
                    "HTTP/1.1 {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    status,
                    body.len(),
                    body
                );
            }
        });
        (server, settled)
    }

    /// A port nothing listens on.
    fn unserved() -> u16 {
        std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port()
    }

    /// What OpenCode 2.4.1 answers to `GET /api/config` for a launch whose Quay MCP server is
    /// `url`: the layers of its config, `OPENCODE_CONFIG_CONTENT`'s as a document.
    fn quays_config(url: &str) -> serde_json::Value {
        serde_json::json!([
            { "type": "directory", "path": "C:\\Users\\x\\.config\\opencode" },
            { "type": "document", "info": {
                "model": { "providerID": "fake", "model": "fixed" },
                "mcp": { "servers": { "quay": {
                    "type": "remote", "url": url, "oauth": false, "codemode": false,
                    "timeout": { "startup": 60000, "catalog": 60000, "execution": 60000 }
                } } }
            } }
        ])
    }

    /// A command that keeps adding to `file`, through a shell, until it is killed.
    fn writing_to(file: &std::path::Path) -> std::process::Command {
        let file = file.to_string_lossy().to_string();
        #[cfg(windows)]
        let cmd = {
            use std::os::windows::process::CommandExt;
            // Raw, since cmd.exe doesn't read the escaped quotes Rust would give the path
            let mut cmd = crate::spawn::hidden_command("cmd.exe");
            cmd.raw_arg(format!("/c ping -n 60 127.0.0.1 > \"{file}\""));
            cmd
        };
        #[cfg(not(windows))]
        let cmd = {
            let mut cmd = crate::spawn::hidden_command("sh");
            cmd.args(["-c", &format!("while :; do echo x; sleep 0.2; done > '{file}'")]);
            cmd
        };
        cmd
    }

    fn size(file: &std::path::Path) -> u64 {
        std::fs::metadata(file).map(|m| m.len()).unwrap_or(0)
    }

    /// Whether whatever writes to `file` has stopped: it doesn't grow over a few seconds, within
    /// `LOADED_SLACK`. That leaves a dropped sidecar, which is killed on a thread of its own, time
    /// to exit, and is still well inside the minute or so `writing_to` writes for, so a sidecar
    /// never ended still reads as growing.
    fn stops_growing(file: &std::path::Path) -> bool {
        let since = Instant::now();
        while since.elapsed() < LOADED_SLACK {
            let before = size(file);
            std::thread::sleep(Duration::from_millis(2500));
            if size(file) == before {
                return true;
            }
        }
        false
    }

    /// Whether something writes to `file`: it grows within fifteen seconds, time for a shell to
    /// start on a busy machine.
    fn grows(file: &std::path::Path) -> bool {
        let before = size(file);
        let since = Instant::now();
        while since.elapsed() < Duration::from_secs(15) {
            std::thread::sleep(Duration::from_millis(250));
            if size(file) > before {
                return true;
            }
        }
        false
    }

    #[test]
    fn a_sidecar_is_ready_once_its_server_takes_the_password_and_serves_this_launchs_config_and_ends_when_dropped() {
        let dir = crate::test_support::TempDir::new("sidecar-drop");
        let file = dir.join("out.txt");
        let server = serving(quays_config(MCP_URL));

        let sidecar = Sidecar::start(writing_to(&file), &server, MCP_URL, Duration::from_secs(10)).expect("ready");
        assert!(grows(&file), "the sidecar runs once it is ready");
        drop(sidecar);
        assert!(stops_growing(&file), "dropping the sidecar ends it");
    }

    #[test]
    fn a_sidecar_is_ready_only_once_its_default_model_has_settled_on_the_configured_one() {
        let dir = crate::test_support::TempDir::new("sidecar-model");
        let file = dir.join("out.txt");
        // As OpenCode 2.4.1 starts: no model, then its own free one, then the configured one
        let (server, configured_served) = serving_models(
            quays_config(MCP_URL),
            vec![
                default_model(None),
                default_model(None),
                default_model(Some("opencode/big-pickle")),
                default_model(Some("opencode/big-pickle")),
                default_model(Some("fake/fixed")),
            ],
        );

        let sidecar = Sidecar::start(writing_to(&file), &server, MCP_URL, Duration::from_secs(10)).expect("ready");
        // Seen at least twice, a settle apart, before the TUI would pick its model
        assert!(configured_served.load(std::sync::atomic::Ordering::SeqCst) >= 2);
        drop(sidecar);
        assert!(stops_growing(&file), "dropping the sidecar ends it");
    }

    #[test]
    fn a_default_model_that_never_settles_doesnt_stop_the_launch() {
        let dir = crate::test_support::TempDir::new("sidecar-no-model");
        let file = dir.join("out.txt");
        let (server, _) = serving_models(quays_config(MCP_URL), vec![default_model(None)]);
        let patience = Duration::from_secs(2);
        // Only catches a start that keeps waiting past its patience, which would never return
        // here. Past the patience it may still finish the read in flight at the deadline, which
        // READ_TIMEOUT bounds; before it, it spawns the sidecar, which the patience doesn't count.
        let bound = patience + crate::slices::pty::opencode_watch::READ_TIMEOUT + LOADED_SLACK;

        let cmd = writing_to(&file);
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let _ = tx.send(Sidecar::start(cmd, &server, MCP_URL, patience));
        });
        let sidecar = rx
            .recv_timeout(bound)
            .unwrap_or_else(|_| panic!("it waited past {:?} on a model that never settles", bound))
            .expect("ready");
        drop(sidecar);
        assert!(stops_growing(&file), "dropping the sidecar ends it");
    }

    #[test]
    fn ending_a_sidecar_ends_it() {
        let dir = crate::test_support::TempDir::new("sidecar-end");
        let file = dir.join("out.txt");
        let server = serving(quays_config(MCP_URL));

        let sidecar = Sidecar::start(writing_to(&file), &server, MCP_URL, Duration::from_secs(10)).expect("ready");
        sidecar.ender().end();
        assert!(stops_growing(&file), "ending the sidecar ends it");
        drop(sidecar);
    }

    #[test]
    fn a_port_whose_server_serves_another_launchs_config_is_an_error_and_the_sidecar_is_ended() {
        let dir = crate::test_support::TempDir::new("sidecar-stranger");
        let file = dir.join("out.txt");
        let server = serving(quays_config("http://127.0.0.1:4321/mcp/6"));

        let failed = Sidecar::start(writing_to(&file), &server, MCP_URL, Duration::from_secs(10)).err().expect("an error");
        assert!(failed.contains("another process"), "{failed}");
        assert!(failed.contains(&server.port().to_string()), "{failed}");
        assert!(stops_growing(&file), "the sidecar is ended");
    }

    #[test]
    fn a_port_whose_server_turns_down_this_launchs_password_is_an_error_at_once() {
        let dir = crate::test_support::TempDir::new("sidecar-password");
        let file = dir.join("out.txt");
        // Another launch's server, with this launch's MCP server even, on the port
        let theirs = serving(quays_config(MCP_URL));
        let ours = OpenCodeServer::for_tests(theirs.port());
        // A start that waited out its patience on the refused password would take all of it, which
        // is three times what spawning the sidecar and ending it may take.
        let patience = 3 * LOADED_SLACK;

        let started = Instant::now();
        let failed = Sidecar::start(writing_to(&file), &ours, MCP_URL, patience).err().expect("an error");
        assert!(started.elapsed() < LOADED_SLACK, "it waited {:?}", started.elapsed());
        assert!(failed.contains("another process"), "{failed}");
        assert!(stops_growing(&file), "the sidecar is ended");
    }

    #[test]
    fn a_sidecar_that_exits_before_it_is_ready_fails_with_what_it_printed_without_its_password() {
        let server = OpenCodeServer::for_tests(unserved());
        let printed = format!("server password {}", server.password());
        let cmd = shell(
            &format!("echo {printed} & echo Unrecognized flag: --hostname 1>&2 & exit 3"),
            &format!("echo '{printed}'; echo 'Unrecognized flag: --hostname' >&2; exit 3"),
        );

        let failed = Sidecar::start(cmd, &server, MCP_URL, Duration::from_secs(10)).err().expect("an error");
        assert!(failed.contains("exited before it was ready"), "{failed}");
        assert!(failed.contains("Unrecognized flag: --hostname"), "{failed}");
        assert!(failed.contains("server password (password)"), "{failed}");
        assert!(!failed.contains(server.password()), "the pane would show the password");
    }

    #[test]
    fn a_sidecar_not_ready_within_its_patience_fails_and_is_ended() {
        let dir = crate::test_support::TempDir::new("sidecar-slow");
        let file = dir.join("out.txt");

        let failed =
            Sidecar::start(writing_to(&file), &OpenCodeServer::for_tests(unserved()), MCP_URL, Duration::from_secs(1)).err().expect("an error");
        assert!(failed.contains("wasn't ready"), "{failed}");
        assert!(stops_growing(&file), "the sidecar is ended");
    }

    #[test]
    fn what_a_sidecar_printed_is_shown_as_plain_text() {
        assert_eq!(plain("\u{1b}[31mError:\u{1b}[0m port\r\n in use\u{7}\u{1b}]0;title\u{7}!"), "Error: port\n in use!");
    }
}
