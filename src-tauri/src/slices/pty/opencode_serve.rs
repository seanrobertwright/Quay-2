//! How an OpenCode terminal is launched, by OpenCode's version. OpenCode 1.x runs its TUI with
//! `--port`, and the TUI serves its events there. OpenCode 2.x refuses `--port`, so Quay starts
//! `opencode serve` on the port as a sidecar of the terminal and runs `opencode attach` in the
//! PTY. `opencode_watch` reads the events from either.

use std::sync::Arc;
use std::time::{Duration, Instant};

use parking_lot::Mutex;

use crate::spawn::ProcessTree;

/// The two ways Quay launches an OpenCode terminal.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OpenCodeForm {
    /// OpenCode 1.x: the TUI, with `--port`.
    Tui,
    /// OpenCode 2.x: `opencode serve` as a sidecar, and `opencode attach` in the PTY.
    ServeAndAttach,
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

/// The form for the OpenCode whose `--version` printed `printed`, or that printed nothing
/// Quay could read (`None`). Only a version below 2 is launched as 1.x; anything else, a probe
/// that failed included, as 2.x, the form new installs get.
pub fn form_of(printed: Option<&str>) -> OpenCodeForm {
    match printed.and_then(major_version) {
        Some(major) if major < 2 => OpenCodeForm::Tui,
        _ => OpenCodeForm::ServeAndAttach,
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

    /// What was printed, as plain text, for a failure message.
    fn shown(&self) -> String {
        match plain(&self.0.lock()).trim() {
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

/// Whether `config`, what a server answered to `GET /config`, is this launch's: its Quay MCP
/// server is at `mcp_url`, which names the launch. A server on the port that isn't the sidecar
/// has another, or none.
fn is_launchs_config(config: &serde_json::Value, mcp_url: &str) -> bool {
    config["mcp"]["quay"]["url"].as_str().is_some_and(|url| url.trim_end_matches('/') == mcp_url.trim_end_matches('/'))
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
    /// Starts `cmd`, `opencode serve` from `hidden_command`, as a tree tied to Quay (see
    /// `spawn_tree_tied`), its output drained, and blocks until loopback `port` serves this
    /// launch's config, the one whose Quay MCP server is `mcp_url`. It fails, with the sidecar
    /// ended, when the process exits first, when another server answers on the port, or when
    /// `patience` passes. A failure says why in plain text, with the end of what the process
    /// printed, for the terminal's pane. Call it on a thread that may block, outside any async
    /// runtime.
    pub fn start(mut cmd: std::process::Command, port: u16, mcp_url: &str, patience: Duration) -> Result<Sidecar, String> {
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
        loop {
            let exited = sidecar.tree.lock().as_mut().map(|tree| tree.child().try_wait());
            match exited {
                Some(Ok(None)) => {}
                Some(Ok(Some(status))) => {
                    return failed(format!("OpenCode's server exited before it was ready ({}). {}", status, tail.shown()))
                }
                Some(Err(e)) => return failed(format!("Quay couldn't watch OpenCode's server: {}", e)),
                None => return failed("OpenCode's server was ended before it was ready.".to_string()),
            }
            if let Ok(config) = runtime.block_on(super::opencode_watch::get_json(port, "/config")) {
                if is_launchs_config(&config, mcp_url) {
                    return Ok(sidecar);
                }
                return failed(format!(
                    "Port {} is served by another process, so this OpenCode terminal didn't attach to it. \
                     Relaunch the terminal to try another port.",
                    port
                ));
            }
            if Instant::now() >= deadline {
                return failed(format!(
                    "OpenCode's server wasn't ready on port {} within {} s. {}",
                    port,
                    patience.as_secs_f32(),
                    tail.shown()
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

    #[test]
    fn a_version_below_2_is_launched_as_1x_and_anything_else_as_2x() {
        assert_eq!(form_of(Some("1.19.4\n")), OpenCodeForm::Tui);
        assert_eq!(form_of(Some("opencode v0.9.1")), OpenCodeForm::Tui);
        assert_eq!(form_of(Some("2.4.1\n")), OpenCodeForm::ServeAndAttach);
        assert_eq!(form_of(Some("opencode 10.0.0")), OpenCodeForm::ServeAndAttach);
        // Nothing readable, or no answer at all: the form new installs get
        assert_eq!(form_of(Some("")), OpenCodeForm::ServeAndAttach);
        assert_eq!(form_of(Some("command not found")), OpenCodeForm::ServeAndAttach);
        assert_eq!(form_of(Some("v.1")), OpenCodeForm::ServeAndAttach);
        assert_eq!(form_of(None), OpenCodeForm::ServeAndAttach);
    }

    /// A command that prints `text` and exits.
    fn printing(text: &str) -> std::process::Command {
        let mut cmd = crate::spawn::hidden_command(if cfg!(windows) { "cmd.exe" } else { "sh" });
        if cfg!(windows) {
            cmd.args(["/c", &format!("echo {text}")]);
        } else {
            cmd.args(["-c", &format!("echo {text}")]);
        }
        cmd
    }

    /// A command that runs for half a minute, through a shell, as an npm shim runs its CLI.
    fn lingering() -> std::process::Command {
        let mut cmd = crate::spawn::hidden_command(if cfg!(windows) { "cmd.exe" } else { "sh" });
        if cfg!(windows) {
            cmd.args(["/c", "ping -n 30 127.0.0.1"]);
        } else {
            cmd.args(["-c", "sleep 30; :"]);
        }
        cmd
    }

    #[test]
    fn the_version_probe_returns_what_the_cli_printed() {
        let printed = probe_version(printing("2.4.1"), Duration::from_secs(10));
        assert_eq!(printed.as_deref().map(str::trim), Some("2.4.1"));
    }

    #[test]
    fn a_version_probe_that_outlasts_its_patience_is_killed_and_reads_as_none() {
        let started = std::time::Instant::now();
        assert_eq!(probe_version(lingering(), Duration::from_millis(500)), None);
        assert!(started.elapsed() < Duration::from_secs(10), "the probe waited {:?}", started.elapsed());
    }

    const MCP_URL: &str = "http://127.0.0.1:4321/mcp/7";

    /// A server on a free loopback port that answers every request with `config` as JSON, as
    /// OpenCode's `GET /config` does. Returns its port.
    fn serving(config: serde_json::Value) -> u16 {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let body = config.to_string();
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
                let _ = write!(
                    stream,
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
            }
        });
        port
    }

    /// A port nothing listens on.
    fn unserved() -> u16 {
        std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port()
    }

    fn quays_config(url: &str) -> serde_json::Value {
        serde_json::json!({ "model": "x", "mcp": { "quay": { "type": "remote", "url": url } } })
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
    /// ten.
    fn stops_growing(file: &std::path::Path) -> bool {
        let since = Instant::now();
        while since.elapsed() < Duration::from_secs(10) {
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
    fn a_sidecar_is_ready_once_its_port_serves_this_launchs_config_and_ends_when_dropped() {
        let dir = crate::test_support::TempDir::new("sidecar-drop");
        let file = dir.join("out.txt");
        let port = serving(quays_config(MCP_URL));

        let sidecar = Sidecar::start(writing_to(&file), port, MCP_URL, Duration::from_secs(10)).expect("ready");
        assert!(grows(&file), "the sidecar runs once it is ready");
        drop(sidecar);
        assert!(stops_growing(&file), "dropping the sidecar ends it");
    }

    #[test]
    fn ending_a_sidecar_ends_it() {
        let dir = crate::test_support::TempDir::new("sidecar-end");
        let file = dir.join("out.txt");
        let port = serving(quays_config(MCP_URL));

        let sidecar = Sidecar::start(writing_to(&file), port, MCP_URL, Duration::from_secs(10)).expect("ready");
        sidecar.ender().end();
        assert!(stops_growing(&file), "ending the sidecar ends it");
        drop(sidecar);
    }

    #[test]
    fn a_port_another_server_holds_is_an_error_and_the_sidecar_is_ended() {
        let dir = crate::test_support::TempDir::new("sidecar-stranger");
        let file = dir.join("out.txt");
        let port = serving(quays_config("http://127.0.0.1:4321/mcp/6"));

        let failed = Sidecar::start(writing_to(&file), port, MCP_URL, Duration::from_secs(10)).err().expect("an error");
        assert!(failed.contains("another process"), "{failed}");
        assert!(failed.contains(&port.to_string()), "{failed}");
        assert!(stops_growing(&file), "the sidecar is ended");
    }

    #[test]
    fn a_sidecar_that_exits_before_it_is_ready_fails_with_what_it_printed() {
        let mut cmd = crate::spawn::hidden_command(if cfg!(windows) { "cmd.exe" } else { "sh" });
        if cfg!(windows) {
            cmd.args(["/c", "echo Unrecognized flag: --hostname 1>&2 & exit 3"]);
        } else {
            cmd.args(["-c", "echo 'Unrecognized flag: --hostname' >&2; exit 3"]);
        }

        let failed = Sidecar::start(cmd, unserved(), MCP_URL, Duration::from_secs(10)).err().expect("an error");
        assert!(failed.contains("exited before it was ready"), "{failed}");
        assert!(failed.contains("Unrecognized flag: --hostname"), "{failed}");
    }

    #[test]
    fn a_sidecar_not_ready_within_its_patience_fails_and_is_ended() {
        let dir = crate::test_support::TempDir::new("sidecar-slow");
        let file = dir.join("out.txt");

        let failed = Sidecar::start(writing_to(&file), unserved(), MCP_URL, Duration::from_secs(1)).err().expect("an error");
        assert!(failed.contains("wasn't ready"), "{failed}");
        assert!(stops_growing(&file), "the sidecar is ended");
    }

    #[test]
    fn what_a_sidecar_printed_is_shown_as_plain_text() {
        assert_eq!(plain("\u{1b}[31mError:\u{1b}[0m port\r\n in use\u{7}\u{1b}]0;title\u{7}!"), "Error: port\n in use!");
    }
}
