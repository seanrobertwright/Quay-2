//! Runs one shell command with a deadline, a cancel flag and bounded output capture.

use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};

use crate::spawn::{hidden_command, spawn_tree};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

/// Output kept in memory per command; older output is dropped from the front.
const MAX_CAPTURE_BYTES: usize = 1 << 20;

pub struct CommandRun {
    pub exit_code: Option<i32>,
    pub timed_out: bool,
    pub cancelled: bool,
    /// Set when the command could not be started.
    pub spawn_error: Option<String>,
    /// stdout and stderr interleaved in arrival order, lossily decoded.
    pub output: String,
    pub duration_ms: u64,
}

impl CommandRun {
    pub fn succeeded(&self) -> bool {
        self.spawn_error.is_none() && !self.timed_out && !self.cancelled && self.exit_code == Some(0)
    }
}

fn shell_command(command: &str) -> Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut cmd = hidden_command("cmd");
        // `/S` makes cmd strip exactly the outer quotes and run the rest verbatim.
        cmd.args(["/D", "/S", "/C"]).raw_arg(format!("\"{}\"", command));
        cmd
    }
    #[cfg(not(windows))]
    {
        let mut cmd = hidden_command("sh");
        cmd.args(["-c", command]);
        cmd
    }
}

fn pump(mut src: impl Read + Send + 'static, sink: Arc<Mutex<Vec<u8>>>) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let mut buf = [0u8; 8192];
        while let Ok(n) = src.read(&mut buf) {
            if n == 0 {
                break;
            }
            let mut out = sink.lock().unwrap_or_else(|e| e.into_inner());
            out.extend_from_slice(&buf[..n]);
            if out.len() > MAX_CAPTURE_BYTES {
                let excess = out.len() - MAX_CAPTURE_BYTES;
                out.drain(..excess);
            }
        }
    })
}

pub fn run_shell(
    cwd: &Path,
    command: &str,
    env: &[(&str, String)],
    timeout: Duration,
    cancel: &AtomicBool,
) -> CommandRun {
    let started = Instant::now();
    let mut cmd = shell_command(command);
    cmd.current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (k, v) in env {
        cmd.env(k, v);
    }

    let mut tree = match spawn_tree(&mut cmd) {
        Ok(c) => c,
        Err(e) => {
            return CommandRun {
                exit_code: None,
                timed_out: false,
                cancelled: false,
                spawn_error: Some(format!("could not start the command: {}", e)),
                output: String::new(),
                duration_ms: started.elapsed().as_millis() as u64,
            }
        }
    };

    let sink = Arc::new(Mutex::new(Vec::new()));
    let readers = [
        tree.child().stdout.take().map(|s| pump(s, sink.clone())),
        tree.child().stderr.take().map(|s| pump(s, sink.clone())),
    ];

    let (mut timed_out, mut cancelled) = (false, false);
    let exit_code = loop {
        match tree.child().try_wait() {
            Ok(Some(status)) => break status.code(),
            Ok(None) => {}
            Err(_) => {
                tree.kill();
                break None;
            }
        }
        if cancel.load(Ordering::SeqCst) {
            cancelled = true;
            tree.kill();
            let _ = tree.child().wait();
            break None;
        }
        if started.elapsed() >= timeout {
            timed_out = true;
            tree.kill();
            let _ = tree.child().wait();
            break None;
        }
        thread::sleep(Duration::from_millis(100));
    };

    // After a kill, a surviving grandchild could hold the pipes open; don't wait on it.
    if !timed_out && !cancelled {
        for r in readers.into_iter().flatten() {
            let _ = r.join();
        }
    }
    let bytes = sink.lock().map(|b| b.clone()).unwrap_or_default();
    CommandRun {
        exit_code,
        timed_out,
        cancelled,
        spawn_error: None,
        output: String::from_utf8_lossy(&bytes).to_string(),
        duration_ms: started.elapsed().as_millis() as u64,
    }
}

/// The last `max_chars` characters of `s`, cut at a line start when possible.
pub fn tail(s: &str, max_chars: usize) -> String {
    let count = s.chars().count();
    if count <= max_chars {
        return s.to_string();
    }
    let skip = count - max_chars;
    let cut: String = s.chars().skip(skip).collect();
    match cut.find('\n') {
        Some(i) if i + 1 < cut.len() => format!("[... earlier output omitted]\n{}", &cut[i + 1..]),
        _ => format!("[... earlier output omitted]\n{}", cut),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> std::path::PathBuf {
        std::env::temp_dir()
    }

    #[test]
    fn captures_output_and_exit_code() {
        let never = AtomicBool::new(false);
        let ok = run_shell(&tmp(), "echo hello", &[], Duration::from_secs(30), &never);
        assert!(ok.succeeded(), "spawn_error={:?}", ok.spawn_error);
        assert!(ok.output.contains("hello"));

        let bad = run_shell(&tmp(), "exit 3", &[], Duration::from_secs(30), &never);
        assert_eq!(bad.exit_code, Some(3));
        assert!(!bad.succeeded());
    }

    #[test]
    fn passes_environment() {
        let never = AtomicBool::new(false);
        let cmd = if cfg!(windows) { "echo %MACHINA_TEST_VAR%" } else { "echo $MACHINA_TEST_VAR" };
        let r = run_shell(
            &tmp(),
            cmd,
            &[("MACHINA_TEST_VAR", "from-env".to_string())],
            Duration::from_secs(30),
            &never,
        );
        assert!(r.output.contains("from-env"));
    }

    #[test]
    fn times_out() {
        let never = AtomicBool::new(false);
        let cmd = if cfg!(windows) { "ping -n 30 127.0.0.1 > nul" } else { "sleep 30" };
        let r = run_shell(&tmp(), cmd, &[], Duration::from_millis(500), &never);
        assert!(r.timed_out);
        assert!(r.duration_ms < 10_000);
    }

    #[test]
    fn tail_keeps_the_end() {
        let s = "line1\nline2\nline3\n";
        assert_eq!(tail(s, 100), s);
        let t = tail(s, 8);
        assert!(t.ends_with("line3\n"));
        assert!(t.starts_with("[... earlier output omitted]"));
    }
}
