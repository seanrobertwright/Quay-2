//! The one runner every Topos git process goes through (#367, #373). It runs git headless:
//! `GIT_TERMINAL_PROMPT=0` and a null stdin, with credential helpers, `GCM_INTERACTIVE` and
//! `GIT_SSH_COMMAND` left as the operator set them. A long-running operation streams
//! [`OpEvent`]s over a Tauri [`Channel`] and stops when [`git_op_cancel`] kills its process tree.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::State;
use uuid::Uuid;

use super::error::GitError;

/// How a git operation runs.
#[derive(Debug, Clone)]
pub struct OpOptions {
    /// How long git may print nothing before the op reports [`OpEvent::Stalled`].
    pub stall_after: Duration,
    /// Run git with `LC_ALL=C`, for operations whose stderr Topos matches (fetch, pull and the
    /// local operations). The commit path leaves it off.
    pub c_locale: bool,
    /// Run git with `GIT_PROGRESS_DELAY=0`, so progress shows from the start instead of after git's
    /// default two seconds.
    pub progress_at_once: bool,
    /// The most bytes of output the op streams as [`OpEvent::Output`]. Past it one notice is sent
    /// and the rest is only captured. `None` streams everything.
    pub stream_cap: Option<usize>,
    /// Read git's stderr for `--progress` lines and send them as [`OpEvent::Progress`]. An op that
    /// prints no progress, such as a commit whose hooks print `lint: 2 problems`, turns it off so
    /// every line stays output.
    pub progress_lines: bool,
}

impl Default for OpOptions {
    fn default() -> Self {
        Self { stall_after: STALL_AFTER, c_locale: false, progress_at_once: false, stream_cap: None, progress_lines: true }
    }
}

/// How long an op runs silent before it reports a stall. It is a notice, not a timeout: the op
/// keeps running until git exits or the operator cancels it.
pub const STALL_AFTER: Duration = Duration::from_secs(30);

/// How often a running op checks for a stall or a cancel.
const POLL: Duration = Duration::from_millis(100);

/// One step of a running operation, as the frontend receives it:
/// `{ "event": "progress", "phase": "Receiving objects", "percent": 45 }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "event", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum OpEvent {
    /// One of git's `--progress` lines, such as `Receiving objects:  45% (450/1000)`. `percent` is
    /// absent for phases that only count, such as `Enumerating objects: 9`.
    Progress {
        phase: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        percent: Option<u8>,
    },
    /// A piece of git's stdout or stderr that isn't a progress line.
    Output { chunk: String },
    /// git has printed nothing for [`OpOptions::stall_after`]. It is still running, and it reports
    /// this again after its next output and a fresh silence.
    Stalled,
    Done,
    Failed { error: GitError },
}

/// The most of each stream [`OpOutput`] keeps; older output is dropped from the front.
pub const MAX_CAPTURE_BYTES: usize = 64 * 1024;

/// Appends `text` to `buf`, then drops whole characters from the front until it fits
/// [`MAX_CAPTURE_BYTES`].
fn push_capped(buf: &mut String, text: &str) {
    buf.push_str(text);
    if buf.len() > MAX_CAPTURE_BYTES {
        let mut cut = buf.len() - MAX_CAPTURE_BYTES;
        while !buf.is_char_boundary(cut) {
            cut += 1;
        }
        buf.drain(..cut);
    }
}

/// What a finished operation printed, the last [`MAX_CAPTURE_BYTES`] of each stream. Progress
/// lines are left out of `stderr` and `combined`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct OpOutput {
    pub stdout: String,
    pub stderr: String,
    /// Both streams in the order they arrived.
    pub combined: String,
}

/// The notice an op sends once, in place of its output past [`OpOptions::stream_cap`].
pub const STREAM_CAP_NOTICE: &str = "\n[Quay: output past 64 KiB is not shown]\n";

/// A process that ran to the end: how it exited and what it printed.
pub(super) struct Finished {
    pub status: std::process::ExitStatus,
    pub output: OpOutput,
}

impl Finished {
    /// `Ok` with the output when git exited 0, and otherwise git's stderr as the error.
    fn into_result(self) -> Result<OpOutput, GitError> {
        if self.status.success() {
            return Ok(self.output);
        }
        let stderr = self.output.stderr;
        Err(GitError::Other {
            stderr: if stderr.trim().is_empty() { format!("git exited with {}", self.status) } else { stderr },
        })
    }
}

/// Where an op's output goes: the channel, up to the stream cap, and the capped capture.
struct Sink<'a> {
    channel: &'a Channel<OpEvent>,
    output: OpOutput,
    /// The bytes still allowed onto the channel, or `None` for no cap.
    allowance: Option<usize>,
    noticed: bool,
    progress_lines: bool,
}

impl Sink<'_> {
    fn output(&mut self, stream: Stream, text: &str) {
        match stream {
            Stream::Stdout => push_capped(&mut self.output.stdout, text),
            Stream::Stderr => push_capped(&mut self.output.stderr, text),
        }
        push_capped(&mut self.output.combined, text);
        let chunk = match &mut self.allowance {
            None => text,
            Some(left) => {
                let mut take = text.len().min(*left);
                while !text.is_char_boundary(take) {
                    take -= 1;
                }
                *left -= take;
                &text[..take]
            }
        };
        if !chunk.is_empty() {
            let _ = self.channel.send(OpEvent::Output { chunk: chunk.to_string() });
        }
        if chunk.len() < text.len() && !self.noticed {
            self.noticed = true;
            let _ = self.channel.send(OpEvent::Output { chunk: STREAM_CAP_NOTICE.to_string() });
        }
    }
}

/// Which pipe a chunk of git's output came from.
#[derive(Clone, Copy)]
enum Stream {
    Stdout,
    Stderr,
}

/// Sends each chunk read from `src` to `tx` until the pipe closes.
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

/// Runs `git <args>` in `cwd`, streaming its events to `channel`. The last event is `Done` when
/// git exits 0 and `Failed` otherwise, carrying the error this returns. It can't be cancelled;
/// [`GitOps::run`] can.
pub fn run_op(
    cwd: &Path,
    args: &[&str],
    opts: &OpOptions,
    channel: &Channel<OpEvent>,
) -> Result<OpOutput, GitError> {
    finish(run_with_cancel(cwd, args, opts, &AtomicBool::new(false), channel), channel)
}

/// Sends the op's last event, `Done` or `Failed`, and passes its result on.
fn finish(result: Result<OpOutput, GitError>, channel: &Channel<OpEvent>) -> Result<OpOutput, GitError> {
    let _ = channel.send(match &result {
        Ok(_) => OpEvent::Done,
        Err(error) => OpEvent::Failed { error: error.clone() },
    });
    result
}

/// Runs `git <args>` in `cwd`, streaming its events to `channel`, until it exits or `cancel` is set.
fn run_with_cancel(
    cwd: &Path,
    args: &[&str],
    opts: &OpOptions,
    cancel: &AtomicBool,
    channel: &Channel<OpEvent>,
) -> Result<OpOutput, GitError> {
    let mut cmd = headless_git();
    cmd.current_dir(cwd).args(args);
    run_process(cmd, None, opts, cancel, channel)?.into_result()
}

/// Runs `cmd`, which should come from [`headless_git`], with `input` on its stdin, streaming its
/// events to `channel` until it exits or `cancel` is set. A cancel kills its whole process tree and
/// returns [`GitError::Cancelled`]; any exit status is returned for the caller to judge.
pub(super) fn run_process(
    mut cmd: Command,
    input: Option<Vec<u8>>,
    opts: &OpOptions,
    cancel: &AtomicBool,
    channel: &Channel<OpEvent>,
) -> Result<Finished, GitError> {
    if opts.c_locale {
        cmd.env("LC_ALL", "C");
    }
    if opts.progress_at_once {
        cmd.env("GIT_PROGRESS_DELAY", "0");
    }
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    if input.is_some() {
        cmd.stdin(Stdio::piped());
    }
    let mut tree = crate::spawn::spawn_tree(&mut cmd)
        .map_err(|e| GitError::Other { stderr: format!("could not run git: {e}") })?;

    if let (Some(input), Some(mut stdin)) = (input, tree.child().stdin.take()) {
        // From its own thread, so a long input never stalls against git's output. A git that fails
        // early closes its stdin; its output says why.
        thread::spawn(move || {
            let _ = stdin.write_all(&input);
        });
    }
    let (tx, rx) = mpsc::channel();
    if let Some(out) = tree.child().stdout.take() {
        pump(out, Stream::Stdout, tx.clone());
    }
    if let Some(err) = tree.child().stderr.take() {
        pump(err, Stream::Stderr, tx);
    }

    let mut sink = Sink { channel, output: OpOutput::default(), allowance: opts.stream_cap, noticed: false, progress_lines: opts.progress_lines };
    let mut stderr_line = Vec::new();
    let mut last_heard = Instant::now();
    let mut stalled = false;
    // Both pumps hang up once git, and anything it started, closes the pipes.
    loop {
        if cancel.load(Ordering::SeqCst) {
            // A process that outlived the kill could hold the pipes open, so don't drain them.
            tree.kill();
            return Err(GitError::Cancelled);
        }
        let (stream, bytes) = match rx.recv_timeout(POLL) {
            Ok(received) => received,
            Err(RecvTimeoutError::Timeout) => {
                if !stalled && last_heard.elapsed() >= opts.stall_after {
                    stalled = true;
                    let _ = channel.send(OpEvent::Stalled);
                }
                continue;
            }
            Err(RecvTimeoutError::Disconnected) => break,
        };
        last_heard = Instant::now();
        stalled = false;
        match stream {
            Stream::Stdout => sink.output(Stream::Stdout, &String::from_utf8_lossy(&bytes)),
            Stream::Stderr => {
                // Progress lines end in `\r` and other lines in `\n`; either ends a line here.
                for &byte in &bytes {
                    stderr_line.push(byte);
                    if byte == b'\r' || byte == b'\n' {
                        stderr_segment(&std::mem::take(&mut stderr_line), &mut sink);
                    }
                }
            }
        }
    }
    if !stderr_line.is_empty() {
        stderr_segment(&stderr_line, &mut sink);
    }
    let status = tree.child().wait().map_err(|e| GitError::Other { stderr: format!("could not wait for git: {e}") })?;
    Ok(Finished { status, output: sink.output })
}

/// Sends one stderr line as a `Progress` event, or as `Output` that is also captured.
fn stderr_segment(line: &[u8], sink: &mut Sink) {
    let text = String::from_utf8_lossy(line);
    if let Some((phase, percent)) = parse_progress(&text).filter(|_| sink.progress_lines) {
        let _ = sink.channel.send(OpEvent::Progress { phase: phase.to_string(), percent });
        return;
    }
    sink.output(Stream::Stderr, &text);
}

/// The phase and percent of a git progress line: `Phase: N% (a/b)...` or `Phase: N, done.`,
/// optionally after `remote: `. Messages such as `error: 3 refs failed` aren't progress.
fn parse_progress(line: &str) -> Option<(&str, Option<u8>)> {
    let line = line.trim_end();
    let line = line.strip_prefix("remote: ").unwrap_or(line);
    let (phase, rest) = line.split_once(": ")?;
    let rest = rest.trim_start();
    let starts_with_digit = rest.chars().next().is_some_and(|c| c.is_ascii_digit());
    let is_message = ["error", "fatal", "warning", "hint"].contains(&phase);
    if !starts_with_digit || is_message || phase.is_empty() || phase.contains(':') {
        return None;
    }
    let digits = rest.find(|c: char| !c.is_ascii_digit()).unwrap_or(rest.len());
    let percent = match rest[digits..].starts_with('%') {
        true => Some(rest[..digits].parse::<u8>().ok().filter(|p| *p <= 100)?),
        false => None,
    };
    Some((phase, percent))
}

/// The ops that can be cancelled while they run, by the op id the frontend gave each one.
#[derive(Default)]
pub struct GitOps {
    running: Mutex<HashMap<Uuid, Arc<AtomicBool>>>,
}

impl GitOps {
    /// Runs `git <args>` like [`run_op`], cancellable through [`GitOps::cancel`] with `op_id`.
    /// `op_id` is the frontend's choice, so it can cancel before this returns.
    pub fn run(
        &self,
        op_id: Uuid,
        cwd: &Path,
        args: &[&str],
        opts: &OpOptions,
        channel: &Channel<OpEvent>,
    ) -> Result<OpOutput, GitError> {
        self.run_with(op_id, channel, |cancel| run_with_cancel(cwd, args, opts, cancel, channel))
    }

    /// Runs `op` as the cancellable op `op_id`: `op` gets the flag [`GitOps::cancel`] sets, which
    /// it hands to [`run_process`]. The op's last event, `Done` or `Failed` with the error this
    /// returns, goes to `channel`.
    pub(super) fn run_with<T>(
        &self,
        op_id: Uuid,
        channel: &Channel<OpEvent>,
        op: impl FnOnce(&AtomicBool) -> Result<T, GitError>,
    ) -> Result<T, GitError> {
        let result = match self.register(op_id) {
            Ok(cancel) => {
                let result = op(&cancel);
                self.running.lock().unwrap_or_else(|e| e.into_inner()).remove(&op_id);
                result
            }
            Err(error) => Err(error),
        };
        let _ = channel.send(match &result {
            Ok(_) => OpEvent::Done,
            Err(error) => OpEvent::Failed { error: error.clone() },
        });
        result
    }

    /// Adds `op_id` to the running ops, refusing an id that is already running.
    fn register(&self, op_id: Uuid) -> Result<Arc<AtomicBool>, GitError> {
        let mut running = self.running.lock().unwrap_or_else(|e| e.into_inner());
        if running.contains_key(&op_id) {
            return Err(GitError::Other { stderr: format!("op {op_id} is already running") });
        }
        let cancel = Arc::new(AtomicBool::new(false));
        running.insert(op_id, cancel.clone());
        Ok(cancel)
    }

    /// Cancels the running op `op_id`: its whole process tree is killed and it ends in
    /// `Failed { error: Cancelled }`. An id with no running op, one that has finished or not yet
    /// started, is ignored.
    pub fn cancel(&self, op_id: Uuid) {
        if let Some(cancel) = self.running.lock().unwrap_or_else(|e| e.into_inner()).get(&op_id) {
            cancel.store(true, Ordering::SeqCst);
        }
    }
}

/// Cancels a running op. See [`GitOps::cancel`]. An `opId` that isn't a UUID is rejected
/// before this runs.
#[tauri::command]
pub fn git_op_cancel(op_id: Uuid, ops: State<'_, GitOps>) {
    ops.cancel(op_id)
}

/// A git command that can never stop to ask on a terminal. Every Topos git process starts here.
/// It never carries an agent terminal's commit stamping, so what Topos commits is unstamped.
pub fn headless_git() -> Command {
    let mut cmd = crate::spawn::hidden_command("git");
    cmd.env("GIT_TERMINAL_PROMPT", "0").stdin(Stdio::null());
    crate::slices::pty::commit_stamp::unstamp(&mut cmd);
    cmd
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    use serde_json::Value;
    use tauri::ipc::InvokeResponseBody;

    /// A channel that keeps every event it is sent, as the JSON the frontend would receive.
    fn test_channel() -> (Channel<OpEvent>, Arc<Mutex<Vec<Value>>>) {
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink = events.clone();
        let channel = Channel::new(move |body| {
            let json = match body {
                InvokeResponseBody::Json(s) => s,
                InvokeResponseBody::Raw(bytes) => String::from_utf8(bytes).unwrap(),
            };
            sink.lock().unwrap().push(serde_json::from_str(&json).unwrap());
            Ok(())
        });
        (channel, events)
    }

    fn scratch_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("quay-op-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Args that run the alias `def` defines as `probe`. An `alias.probe=!…` alias runs in git's
    /// shell, so a test sees what git's children see.
    fn alias_args(def: &str) -> [&str; 3] {
        ["-c", def, "probe"]
    }

    #[test]
    fn git_runs_with_no_terminal_prompt() {
        let dir = scratch_dir();
        let (channel, events) = test_channel();
        let out = run_op(&dir, &alias_args("alias.probe=!env"), &OpOptions::default(), &channel).unwrap();
        assert!(out.stdout.lines().any(|l| l == "GIT_TERMINAL_PROMPT=0"), "env was:\n{}", out.stdout);
        assert_eq!(events.lock().unwrap().last(), Some(&serde_json::json!({ "event": "done" })));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn git_reads_a_null_stdin() {
        let dir = scratch_dir();
        let (channel, _events) = test_channel();
        let def = "alias.probe=!readlink /proc/self/fd/0";
        let out = run_op(&dir, &alias_args(def), &OpOptions::default(), &channel).unwrap();
        assert_eq!(out.stdout.trim(), "/dev/null");
        let _ = std::fs::remove_dir_all(dir);
    }

    /// The value of `name` in the environment git's children see, or `None` when it is unset.
    fn child_env(opts: &OpOptions, name: &str) -> Option<String> {
        let dir = scratch_dir();
        let (channel, _events) = test_channel();
        let out = run_op(&dir, &alias_args("alias.probe=!env"), opts, &channel).unwrap();
        let _ = std::fs::remove_dir_all(dir);
        let prefix = format!("{name}=");
        out.stdout.lines().find_map(|l| l.strip_prefix(&prefix).map(str::to_string))
    }

    #[test]
    fn c_locale_is_applied_only_when_asked_for() {
        assert_eq!(child_env(&OpOptions { c_locale: true, ..OpOptions::default() }, "LC_ALL").as_deref(), Some("C"));
        // Left off, git sees whatever Quay itself was started with.
        assert_eq!(child_env(&OpOptions::default(), "LC_ALL"), std::env::var("LC_ALL").ok());
    }

    #[test]
    fn git_ssh_command_is_left_as_the_operator_set_it() {
        let parent = std::env::var("GIT_SSH_COMMAND").ok();
        assert_eq!(child_env(&OpOptions::default(), "GIT_SSH_COMMAND"), parent);
        assert_eq!(child_env(&OpOptions { c_locale: true, ..OpOptions::default() }, "GIT_SSH_COMMAND"), parent);
    }

    /// The `chunk` of every `output` event, joined.
    fn streamed_output(events: &[Value]) -> String {
        events.iter().filter(|e| e["event"] == "output").map(|e| e["chunk"].as_str().unwrap()).collect()
    }

    #[test]
    fn output_streams_and_a_failing_git_ends_in_failed() {
        let dir = scratch_dir();
        let (channel, events) = test_channel();
        let def = "alias.probe=!echo to-stdout; echo to-stderr >&2; exit 3";
        let err = run_op(&dir, &alias_args(def), &OpOptions::default(), &channel).unwrap_err();
        assert_eq!(err, GitError::Other { stderr: "to-stderr
".into() });

        let events = events.lock().unwrap();
        let streamed = streamed_output(&events);
        assert!(streamed.contains("to-stdout
") && streamed.contains("to-stderr
"), "streamed: {streamed:?}");
        assert_eq!(
            events.last(),
            Some(&serde_json::json!({ "event": "failed", "error": { "kind": "other", "stderr": "to-stderr
" } }))
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    fn git_in(dir: &Path, args: &[&str]) {
        let out = crate::spawn::hidden_command("git").current_dir(dir).args(args).output().unwrap();
        assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
    }

    /// A repository on `main` with a few commits, to fetch from.
    fn remote_repo(root: &Path) -> PathBuf {
        let repo = root.join("remote");
        std::fs::create_dir_all(&repo).unwrap();
        git_in(&repo, &["init", "-q", "-b", "main"]);
        for i in 0..5 {
            std::fs::write(repo.join(format!("f{i}.txt")), format!("file {i}
")).unwrap();
            git_in(&repo, &["add", "-A"]);
            git_in(&repo, &["-c", "user.name=Quay Test", "-c", "user.email=quay@example.invalid", "commit", "-q", "-m", "c"]);
        }
        repo
    }

    #[test]
    fn fetch_progress_streams_as_progress_events() {
        let root = scratch_dir();
        let remote = remote_repo(&root);
        let local = root.join("local");
        std::fs::create_dir_all(&local).unwrap();
        git_in(&local, &["init", "-q", "-b", "main"]);

        let (channel, events) = test_channel();
        let remote_path = remote.to_string_lossy().into_owned();
        run_op(&local, &["fetch", "--progress", &remote_path, "main"], &OpOptions { c_locale: true, ..OpOptions::default() }, &channel).unwrap();

        let events = events.lock().unwrap();
        let counting: Vec<&Value> =
            events.iter().filter(|e| e["event"] == "progress" && e["phase"] == "Counting objects").collect();
        assert!(!counting.is_empty(), "no Counting objects progress in {events:?}");
        assert_eq!(counting.last().unwrap()["percent"], 100);
        assert!(events
            .iter()
            .any(|e| e["event"] == "progress" && e["phase"] == "Enumerating objects" && e["percent"].is_null()));
        assert!(!streamed_output(&events).contains("objects:"), "progress leaked into output: {events:?}");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn captured_output_keeps_the_last_64_kib_of_each_stream() {
        let dir = scratch_dir();
        let (channel, _events) = test_channel();
        // About 170 KB on each stream.
        let def = "alias.probe=!seq 1 30000; seq 1 30000 >&2";
        let out = run_op(&dir, &alias_args(def), &OpOptions::default(), &channel).unwrap();
        for captured in [&out.stdout, &out.stderr] {
            assert!(captured.len() <= 64 * 1024, "kept {} bytes", captured.len());
            assert!(captured.len() > 60 * 1024, "kept only {} bytes", captured.len());
            assert!(captured.ends_with("29999
30000
"));
        }
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_silent_op_reports_stalled_and_keeps_running() {
        assert_eq!(OpOptions::default().stall_after, Duration::from_secs(30));

        let dir = scratch_dir();
        let (channel, events) = test_channel();
        let opts = OpOptions { stall_after: Duration::from_millis(300), ..OpOptions::default() };
        let out = run_op(&dir, &alias_args("alias.probe=!sleep 2; echo after"), &opts, &channel).unwrap();
        assert_eq!(out.stdout, "after
");

        let kinds: Vec<String> =
            events.lock().unwrap().iter().map(|e| e["event"].as_str().unwrap().to_string()).collect();
        assert_eq!(kinds, ["stalled", "output", "done"]);
        let _ = std::fs::remove_dir_all(dir);
    }

    /// Whether a process with this OS process id is running.
    fn process_alive(pid: u32) -> bool {
        if cfg!(windows) {
            let filter = format!("PID eq {pid}");
            let out = crate::spawn::hidden_command("tasklist")
                .args(["/FI", &filter, "/NH", "/FO", "CSV"])
                .output()
                .unwrap();
            String::from_utf8_lossy(&out.stdout).contains(&format!("\"{pid}\""))
        } else {
            crate::spawn::hidden_command("kill").args(["-0", &pid.to_string()]).status().unwrap().success()
        }
    }

    #[test]
    fn cancel_kills_the_ops_whole_process_tree() {
        let dir = scratch_dir();
        let (channel, events) = test_channel();
        let ops = GitOps::default();
        let op_id = uuid::Uuid::new_v4();
        // git starts a shell, which starts `sleep` and prints its OS process id.
        let def = "alias.probe=!sleep 120 & if [ -f /proc/$!/winpid ]; then cat /proc/$!/winpid; else echo $!; fi; wait";

        std::thread::scope(|scope| {
            let running = scope.spawn(|| ops.run(op_id, &dir, &alias_args(def), &OpOptions::default(), &channel));

            let started = Instant::now();
            let sleep_pid = loop {
                let printed = streamed_output(&events.lock().unwrap());
                if let Ok(pid) = printed.trim().parse::<u32>() {
                    break pid;
                }
                assert!(started.elapsed() < Duration::from_secs(20), "sleep never started: {printed:?}");
                std::thread::sleep(Duration::from_millis(50));
            };
            assert!(process_alive(sleep_pid), "sleep {sleep_pid} should be running before Cancel");

            ops.cancel(op_id);
            assert_eq!(running.join().unwrap(), Err(GitError::Cancelled));
            assert!(started.elapsed() < Duration::from_secs(60), "Cancel waited for sleep to finish");
            assert!(!process_alive(sleep_pid), "sleep {sleep_pid}, a child of git's shell, outlived Cancel");
        });
        assert_eq!(
            events.lock().unwrap().last(),
            Some(&serde_json::json!({ "event": "failed", "error": { "kind": "cancelled" } }))
        );
        let _ = std::fs::remove_dir_all(dir);
    }
}
