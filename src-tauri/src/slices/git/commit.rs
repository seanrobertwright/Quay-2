//! Committing from the Topos composer (#366, #388). `git commit -F - --cleanup=whitespace` runs
//! through the op runner with the message on stdin, never on a command line or through a shell,
//! so its hooks stream into the composer's panel and Cancel kills their process tree. It runs in
//! the worktree's staging slot, so a commit never overlaps a stage or a discard. Quay passes
//! nothing for signing, so `commit.gpgSign` and `gpg.format` in git config apply, and it never
//! skips hooks.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::ipc::Channel;
use uuid::Uuid;

use super::error::GitError;
use super::op_runner::{headless_git, run_process, GitOps, OpEvent, OpOptions};
use super::staging::{worktree_git, StagingLocks};

/// The longest message Topos commits.
pub const MAX_MESSAGE_BYTES: usize = 1024 * 1024;

/// What the composer commits.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitRequest {
    /// The whole message: the summary line, then the description after a blank line.
    pub message: String,
    /// Replace HEAD (`--amend`) instead of adding a commit on it.
    pub amend: bool,
    /// Add a `Signed-off-by` trailer (`--signoff`).
    pub signoff: bool,
}

/// The message, refused when its summary is blank, it holds a NUL, or it is longer than
/// [`MAX_MESSAGE_BYTES`].
fn parse_message(message: &str) -> Result<&str, GitError> {
    if message.trim().is_empty() {
        return Err(GitError::Other { stderr: "the commit message is empty".into() });
    }
    if message.contains('\0') {
        return Err(GitError::Other { stderr: "the commit message holds a NUL character".into() });
    }
    if message.len() > MAX_MESSAGE_BYTES {
        return Err(GitError::Other { stderr: format!("the commit message is longer than {} MiB", MAX_MESSAGE_BYTES / (1024 * 1024)) });
    }
    Ok(message)
}

/// What `git <args>` in `worktree` printed on stdout, or None when it exited non-zero.
fn read_git(worktree: &Path, args: &[&str]) -> Result<Option<Vec<u8>>, GitError> {
    let out = worktree_git(worktree)
        .args(args)
        .stderr(Stdio::null())
        .output()
        .map_err(|e| GitError::Other { stderr: format!("could not run git: {e}") })?;
    Ok(out.status.success().then_some(out.stdout))
}

/// The oid HEAD names in `worktree`.
fn head_oid(worktree: &Path) -> Result<String, GitError> {
    match read_git(worktree, &["rev-parse", "--verify", "HEAD"])? {
        Some(out) => Ok(String::from_utf8_lossy(&out).trim().to_string()),
        None => Err(GitError::Other { stderr: "the commit left no HEAD to read".into() }),
    }
}

/// The operation under way in a worktree, which decides what the composer offers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Operation {
    None,
    /// `MERGE_HEAD` exists: the composer commits the merge.
    Merge,
    /// The composer gives way to the operation banner's Continue during these three.
    Rebase,
    CherryPick,
    Revert,
}

/// HEAD's commit, for Amend.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HeadCommit {
    pub oid: String,
    /// The full message, which Amend loads into the composer.
    pub message: String,
    /// Whether HEAD is already reachable from its branch's upstream, so amending rewrites a
    /// commit that was pushed. False with no upstream.
    pub on_upstream: bool,
}

/// What the composer needs to know about a worktree before it commits.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitContext {
    pub operation: Operation,
    /// In a merge, `MERGE_MSG` without its comment lines, to prefill the composer.
    pub merge_message: Option<String>,
    /// The branch HEAD is on, or None when HEAD is detached.
    pub branch: Option<String>,
    /// HEAD's commit, or None on an unborn branch.
    pub head: Option<HeadCommit>,
}

/// `text` without the lines git treats as comments, those starting with `comment`, and without
/// trailing blank lines; empty when nothing is left.
fn strip_comments(text: &str, comment: char) -> String {
    let kept: Vec<&str> = text.lines().filter(|l| !l.starts_with(comment)).collect();
    let body = kept.join("\n");
    let body = body.trim_end();
    if body.is_empty() {
        String::new()
    } else {
        format!("{body}\n")
    }
}

/// Reads what the composer needs from `worktree`: the operation under way, `MERGE_MSG` in a merge,
/// the branch, and HEAD's message for Amend.
pub fn read_commit_context(worktree: &Path) -> Result<CommitContext, GitError> {
    let git_dir = read_git(worktree, &["rev-parse", "--absolute-git-dir"])?
        .map(|out| PathBuf::from(String::from_utf8_lossy(&out).trim()))
        .ok_or_else(|| GitError::Other { stderr: format!("{} is not a git worktree", worktree.display()) })?;
    let operation = if git_dir.join("rebase-merge").is_dir() || git_dir.join("rebase-apply").is_dir() {
        Operation::Rebase
    } else if git_dir.join("CHERRY_PICK_HEAD").is_file() {
        Operation::CherryPick
    } else if git_dir.join("REVERT_HEAD").is_file() {
        Operation::Revert
    } else if git_dir.join("MERGE_HEAD").is_file() {
        Operation::Merge
    } else {
        Operation::None
    };
    let merge_message = match operation {
        Operation::Merge => {
            let comment = read_git(worktree, &["config", "--get", "core.commentChar"])?
                .and_then(|out| {
                    let value = String::from_utf8_lossy(&out).trim().to_string();
                    let mut chars = value.chars();
                    chars.next().filter(|_| chars.next().is_none())
                })
                .unwrap_or('#');
            let mut bytes = Vec::new();
            if let Ok(file) = std::fs::File::open(git_dir.join("MERGE_MSG")) {
                let _ = file.take(MAX_MESSAGE_BYTES as u64).read_to_end(&mut bytes);
            }
            Some(strip_comments(&String::from_utf8_lossy(&bytes), comment))
        }
        _ => None,
    };
    let branch = read_git(worktree, &["symbolic-ref", "--quiet", "--short", "HEAD"])?
        .map(|out| String::from_utf8_lossy(&out).trim().to_string());
    let head = match read_git(worktree, &["log", "-1", "--format=%H%x00%B", "HEAD"])? {
        Some(out) => {
            let text = String::from_utf8_lossy(&out);
            let (oid, message) = text.split_once('\0').unwrap_or((&text, ""));
            let on_upstream = read_git(worktree, &["merge-base", "--is-ancestor", "HEAD", "@{upstream}"])?.is_some();
            Some(HeadCommit { oid: oid.to_string(), message: message.trim_end().to_string() + "\n", on_upstream })
        }
        None => None,
    };
    Ok(CommitContext { operation, merge_message, branch, head })
}

/// A uniquely named file under the temp dir that git's trace2 events go to, removed on drop.
/// From it Quay learns which hook ran and how it exited, which git's exit status alone can't tell.
struct TraceFile(PathBuf);

impl TraceFile {
    fn create() -> Result<TraceFile, GitError> {
        let path = std::env::temp_dir().join(format!("quay-commit-trace-{}.json", Uuid::new_v4().simple()));
        std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|e| GitError::Other { stderr: format!("could not create {}: {e}", path.display()) })?;
        Ok(TraceFile(path))
    }

    /// The first hook the commit's own git ran that exited non-zero, or None. Events from git
    /// processes a hook started carry a nested session id (`parent/child`) and are skipped.
    fn failed_hook(&self) -> Option<String> {
        let file = std::fs::File::open(&self.0).ok()?;
        let mut hooks: HashMap<u64, String> = HashMap::new();
        for line in BufReader::new(file).lines() {
            let Ok(line) = line else { break };
            if !line.contains("\"child_") {
                continue;
            }
            let Ok(event) = serde_json::from_str::<Value>(&line) else { continue };
            if event["sid"].as_str().is_none_or(|sid| sid.contains('/')) {
                continue;
            }
            let Some(child) = event["child_id"].as_u64() else { continue };
            match event["event"].as_str() {
                Some("child_start") if event["child_class"] == "hook" => {
                    if let Some(name) = event["hook_name"].as_str() {
                        hooks.insert(child, name.to_string());
                    }
                }
                Some("child_exit") if event["code"].as_i64() != Some(0) => {
                    if let Some(name) = hooks.remove(&child) {
                        return Some(name);
                    }
                }
                _ => {}
            }
        }
        None
    }
}

impl Drop for TraceFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

/// Commits what is staged in `worktree` with `request`, as the cancellable op `op_id` whose
/// output streams to `channel`, and returns the new HEAD's oid. A hook that exits non-zero is
/// [`GitError::HookFailed`]; there is no timeout, only Cancel.
pub fn commit(
    ops: &GitOps,
    locks: &StagingLocks,
    worktree: &Path,
    op_id: Uuid,
    request: &CommitRequest,
    channel: &Channel<OpEvent>,
) -> Result<String, GitError> {
    ops.run_with(op_id, channel, |cancel| {
        let message = parse_message(&request.message)?;
        let _slot = locks.begin(worktree)?;
        let trace = TraceFile::create()?;
        let mut cmd = headless_git();
        cmd.current_dir(worktree).env("GIT_TRACE2_EVENT", &trace.0).args(["commit", "-F", "-", "--cleanup=whitespace"]);
        if request.amend {
            cmd.arg("--amend");
        }
        if request.signoff {
            cmd.arg("--signoff");
        }
        let opts = OpOptions { cap_stream: true, progress_lines: false, ..OpOptions::default() };
        let finished = run_process(cmd, Some(message.as_bytes().to_vec()), &opts, cancel, channel)?;
        if !finished.status.success() {
            if let Some(hook) = trace.failed_hook() {
                return Err(GitError::HookFailed { hook, output: finished.output.combined });
            }
            let output = finished.output.combined.trim().to_string();
            return Err(GitError::Other {
                stderr: if output.is_empty() { format!("git exited with {}", finished.status) } else { output },
            });
        }
        head_oid(worktree)
    })
}

/// What the composer needs to know about `worktree_path`. See [`read_commit_context`].
#[tauri::command]
pub async fn git_commit_context(worktree_path: String) -> Result<CommitContext, GitError> {
    tokio::task::spawn_blocking(move || read_commit_context(Path::new(&worktree_path)))
        .await
        .map_err(|e| GitError::Other { stderr: format!("could not read the commit context: {e}") })?
}

/// Commits what is staged in `worktree_path` as op `op_id`, which `git_op_cancel` stops while a
/// hook runs, and returns the new HEAD's oid. See [`commit`]. An `opId` that isn't a UUID is
/// rejected before this runs.
#[tauri::command]
pub async fn git_commit(
    worktree_path: String,
    request: CommitRequest,
    op_id: Uuid,
    on_event: Channel<OpEvent>,
    app: tauri::AppHandle,
) -> Result<String, GitError> {
    use tauri::Manager;
    tokio::task::spawn_blocking(move || {
        commit(&app.state::<GitOps>(), &app.state::<StagingLocks>(), Path::new(&worktree_path), op_id, &request, &on_event)
    })
    .await
    .map_err(|e| GitError::Other { stderr: format!("could not commit: {e}") })?
}
