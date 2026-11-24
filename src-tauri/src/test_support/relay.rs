//! The relay sidecar this build made, run as a CLI runs it.

use std::ffi::OsStr;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
use std::time::{Duration, Instant};

use serde_json::Value;
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver};

/// How long a reply, or the relay's end, may take before the test fails.
const LIMIT: Duration = Duration::from_secs(10);

/// Where the app's build puts the sidecar `name`.
pub fn built_sidecar(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries").join(format!(
        "{name}-{}{}",
        env!("QUAY_SIDECAR_TARGET"),
        std::env::consts::EXE_SUFFIX
    ))
}

/// The relay as a child process, killed when dropped.
pub struct Relay {
    child: Child,
    replies: UnboundedReceiver<Value>,
}

impl Relay {
    /// Starts `program` with `env`, and without the variables this process has for a relay, if any.
    pub fn start(program: impl AsRef<OsStr>, env: &[(&str, &str)]) -> Relay {
        let program = program.as_ref();
        let mut child = crate::spawn::hidden_command(program)
            .env_remove("QUAY_MCP_URL")
            .env_remove("QUAY_A2A_TOKEN")
            .envs(env.iter().copied())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap_or_else(|e| panic!("the app's build makes {}: {e}", program.display()));
        let (sender, replies) = unbounded_channel();
        let stdout = BufReader::new(child.stdout.take().unwrap());
        std::thread::spawn(move || {
            for line in stdout.lines().map_while(Result::ok) {
                let reply = serde_json::from_str(&line).expect("only protocol on stdout");
                if sender.send(reply).is_err() {
                    break;
                }
            }
        });
        Relay { child, replies }
    }

    pub fn send(&mut self, message: Value) {
        writeln!(self.child.stdin.as_mut().unwrap(), "{message}").unwrap();
    }

    pub async fn next(&mut self) -> Value {
        tokio::time::timeout(LIMIT, self.replies.recv()).await.expect("no reply").unwrap()
    }

    /// Closes its stdin, as a CLI that ends does.
    pub fn close_stdin(&mut self) {
        self.child.stdin = None;
    }

    pub async fn exits(&mut self) -> bool {
        let deadline = Instant::now() + LIMIT;
        while Instant::now() < deadline {
            if self.child.try_wait().unwrap().is_some() {
                return true;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        false
    }
}

impl Drop for Relay {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
