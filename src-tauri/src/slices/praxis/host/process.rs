//! One bounded `praxis` process (#446), on the process handling Topos's `op_runner` uses: a
//! [`crate::spawn::spawn_tree`] child with a null stdin, its pipes read on their own threads, and
//! the whole tree killed on a timeout or a kill request.

use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::thread;
use std::time::{Duration, Instant};

/// How long a process may run and how much of its output is kept.
#[derive(Debug, Clone, Copy)]
pub struct Bounds {
    pub timeout: Duration,
    /// The most stdout a process may print. Past it, its tree is killed.
    pub stdout_cap: usize,
    /// The most stderr kept, the last of it; older stderr is dropped from the front.
    pub stderr_cap: usize,
}

/// How a process ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Ended {
    /// It exited by itself. `code` is `None` when a signal ended it.
    Exited { code: Option<i32>, stdout: Vec<u8>, stderr: String },
    /// [`Bounds::timeout`] passed; the tree was killed.
    TimedOut,
    /// It printed more than [`Bounds::stdout_cap`]; the tree was killed.
    StdoutOverflow,
    /// The kill flag was set; the tree was killed.
    Killed,
    /// It never started.
    SpawnFailed(String),
    /// It started, but Quay couldn't learn how it ended; the tree was killed.
    WaitFailed(String),
}

const POLL: Duration = Duration::from_millis(25);

/// How long output is still read after the process has exited while something it started holds
/// its pipes open. Then the rest of the tree is killed.
const DRAIN_AFTER_EXIT: Duration = Duration::from_millis(250);

#[derive(Clone, Copy)]
enum Stream {
    Stdout,
    Stderr,
}

fn pump(mut src: impl Read + Send + 'static, stream: Stream, tx: Sender<(Stream, Vec<u8>)>) {
    thread::spawn(move || {
        let mut buf = [0u8; 8192];
        while let Ok(n) = src.read(&mut buf) {
            if n == 0 || tx.send((stream, buf[..n].to_vec())).is_err() {
                break;
            }
        }
    });
}

/// Keeps the last `cap` bytes of `buf`.
fn keep_tail(buf: &mut Vec<u8>, cap: usize) {
    if buf.len() > cap {
        buf.drain(..buf.len() - cap);
    }
}

/// `bytes` as text, decoded only once whole so a character split across two reads survives,
/// and without the partial character a cut from the front can leave.
fn decode_tail(bytes: &[u8]) -> String {
    let start = bytes.iter().take(3).take_while(|b| (**b & 0b1100_0000) == 0b1000_0000).count();
    String::from_utf8_lossy(&bytes[start..]).into_owned()
}

/// Runs `cmd`, which should come from [`crate::spawn::hidden_command`], within `bounds`, until
/// it exits or `kill` is set. Every way it stops early kills its whole process tree, and returns
/// once the tree has exited or [`crate::spawn::ProcessTree::kill`] has stopped waiting for it.
/// Anything the process started that is still running once it exits is killed too.
pub fn run(mut cmd: Command, bounds: &Bounds, kill: &AtomicBool) -> Ended {
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut tree = match crate::spawn::spawn_tree(&mut cmd) {
        Ok(tree) => tree,
        Err(e) => return Ended::SpawnFailed(e.to_string()),
    };
    let deadline = Instant::now() + bounds.timeout;
    let (tx, rx) = mpsc::channel();
    if let Some(out) = tree.child().stdout.take() {
        pump(out, Stream::Stdout, tx.clone());
    }
    if let Some(err) = tree.child().stderr.take() {
        pump(err, Stream::Stderr, tx);
    }
    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    let mut pipes_open = true;
    let mut exited: Option<(std::process::ExitStatus, Instant)> = None;
    let stopped = |tree: &mut crate::spawn::ProcessTree, why: Ended| {
        // A process that outlived the kill could hold the pipes open, so they aren't drained.
        tree.kill();
        why
    };
    loop {
        if kill.load(Ordering::SeqCst) {
            return stopped(&mut tree, Ended::Killed);
        }
        if exited.is_none() && Instant::now() >= deadline {
            return stopped(&mut tree, Ended::TimedOut);
        }
        if pipes_open {
            match rx.recv_timeout(POLL) {
                Ok((Stream::Stdout, bytes)) => {
                    stdout.extend_from_slice(&bytes);
                    if stdout.len() > bounds.stdout_cap {
                        return stopped(&mut tree, Ended::StdoutOverflow);
                    }
                    continue;
                }
                Ok((Stream::Stderr, bytes)) => {
                    stderr.extend_from_slice(&bytes);
                    keep_tail(&mut stderr, bounds.stderr_cap);
                    continue;
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => pipes_open = false,
            }
        } else {
            thread::sleep(POLL);
        }
        if exited.is_none() {
            match tree.child().try_wait() {
                Ok(Some(status)) => exited = Some((status, Instant::now())),
                Ok(None) => {}
                Err(e) => return stopped(&mut tree, Ended::WaitFailed(format!("couldn't wait for praxis: {e}"))),
            }
        }
        if let Some((status, at)) = exited
            && (!pipes_open || at.elapsed() >= DRAIN_AFTER_EXIT)
        {
            if pipes_open {
                tree.kill();
            }
            return Ended::Exited { code: status.code(), stdout, stderr: decode_tail(&stderr) };
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stderr_keeps_its_tail_and_decodes_whole_characters() {
        let mut bytes = "ééé".as_bytes().to_vec();
        keep_tail(&mut bytes, 3);
        // The cut leaves half of the second é, which is dropped, not shown as U+FFFD.
        assert_eq!(decode_tail(&bytes), "é");
        let mut bytes = b"abcdef".to_vec();
        keep_tail(&mut bytes, 4);
        assert_eq!(decode_tail(&bytes), "cdef");
        // A character split across two reads is joined before it is decoded.
        let whole = "Zoë, café".as_bytes();
        let (first, second) = whole.split_at(whole.len() - 1);
        let mut joined = first.to_vec();
        joined.extend_from_slice(second);
        assert_eq!(decode_tail(&joined), "Zoë, café");
    }

    #[test]
    fn a_process_that_exited_returns_while_its_child_holds_the_pipes() {
        // git's shell backgrounds `sleep`, which keeps stdout open, prints and exits.
        let mut cmd = crate::spawn::hidden_command("git");
        cmd.args(["-c", "alias.probe=!sleep 60 & echo done", "probe"]);
        let bounds = Bounds { timeout: Duration::from_secs(30), stdout_cap: 4096, stderr_cap: 4096 };
        let started = Instant::now();
        let ended = run(cmd, &bounds, &AtomicBool::new(false));
        assert!(matches!(&ended, Ended::Exited { code: Some(0), stdout, .. } if stdout == b"done\n"), "{ended:?}");
        assert!(started.elapsed() < Duration::from_secs(20), "waited {:?} for the child's pipes", started.elapsed());
    }
}
