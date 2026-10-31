//! Fetch, pull and push from Topos's toolbar and palette (#367, #395).
//!
//! Each runs headless through the op runner with `--progress`, so git's progress lines arrive as
//! [`OpEvent::Progress`], and with `LC_ALL=C`, so its refusals can be matched. One network
//! operation runs per repo at a time, holding its [`RepoLock`](super::repo_lock::RepoLock); the local
//! ref operations wait behind it.
//! Remote and branch names are checked before git sees them and never read as options. Topos
//! never force-pushes here, and never writes config except a pull's "Remember for this repo".

use std::path::Path;
use std::sync::atomic::AtomicBool;

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use uuid::Uuid;

use super::checkout::{check_branch_name, invalid_ref, outcome, rev_oid, run_git};
use super::commit::{read_git, read_git_line, Operation};
use super::operation::{detect_operation, git_dir, in_background};
use super::error::GitError;
use super::graph::GitRefs;
use super::op_runner::{headless_git, run_process, GitOps, OpEvent, OpOptions, OpOutput};
use super::staging::StagingLocks;

/// Where a fetch fetches from: `{ "kind": "remote", "name": "origin" }` or `{ "kind": "all" }`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum FetchFrom {
    All,
    Remote { name: String },
}

/// HEAD and the refs after a network operation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteOutcome {
    pub head: Option<String>,
    pub refs: GitRefs,
    /// A pull stopped on conflicts, which the operation banner now shows.
    pub conflicts: bool,
    pub sync: SyncStatus,
}

/// What the toolbar shows beside Pull and Push: the checked-out branch, its upstream, how far
/// apart they are, and when the worktree last fetched.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    /// None for a detached HEAD.
    pub branch: Option<String>,
    /// Such as `origin/main`; None when the branch tracks nothing.
    pub upstream: Option<String>,
    /// Commits on the branch and not its upstream, as of the last fetch.
    pub ahead: u32,
    /// Commits on the upstream and not the branch, as of the last fetch.
    pub behind: u32,
    /// When `FETCH_HEAD` was last written, in ms since the epoch; None before any fetch.
    pub fetched_at_ms: Option<i64>,
}

/// The [`SyncStatus`] of `worktree`, read from its refs alone: it never reaches the remote.
pub fn sync_status(worktree: &Path) -> Result<SyncStatus, GitError> {
    let branch = current_branch(worktree)?;
    let upstream = match &branch {
        Some(_) => read_git_line(worktree, &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"])?.filter(|u| !u.is_empty()),
        None => None,
    };
    let (ahead, behind) = match &upstream {
        Some(_) => {
            let out = read_git(worktree, &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"])?.unwrap_or_default();
            let text = String::from_utf8_lossy(&out);
            let mut counts = text.split_whitespace().map(|n| n.parse::<u32>().unwrap_or(0));
            (counts.next().unwrap_or(0), counts.next().unwrap_or(0))
        }
        None => (0, 0),
    };
    let fetch_head = read_git_line(worktree, &["rev-parse", "--path-format=absolute", "--git-path", "FETCH_HEAD"])?.map(std::path::PathBuf::from);
    let fetched_at_ms = fetch_head
        .and_then(|path| std::fs::metadata(path).ok())
        .and_then(|meta| meta.modified().ok())
        .map(crate::dates::system_time_ms);
    Ok(SyncStatus { branch, upstream, ahead, behind, fetched_at_ms })
}

/// The remotes `worktree`'s repo has, by name.
fn remotes(worktree: &Path) -> Result<Vec<String>, GitError> {
    let out = read_git(worktree, &["remote"])?.unwrap_or_default();
    Ok(String::from_utf8_lossy(&out).lines().map(str::to_string).filter(|r| !r.is_empty()).collect())
}

/// Refuses `name` unless it is one of the repo's remotes, so a name never reaches git as an
/// option or a URL.
fn check_remote(worktree: &Path, name: &str) -> Result<(), GitError> {
    if name.starts_with('-') || !remotes(worktree)?.iter().any(|r| r == name) {
        return Err(GitError::Other { stderr: format!("{name} is not a remote of this repo") });
    }
    Ok(())
}

/// Runs a network `git <args>` in `worktree` as part of the op whose cancel flag is `cancel`.
/// The inner result is `Ok` when git exits 0, and otherwise `Err` with what it printed, for the
/// caller to read its refusal from; the outer one is an error running git at all.
fn run_network(worktree: &Path, args: &[&str], cancel: &AtomicBool, channel: &Channel<OpEvent>) -> Result<Result<(), OpOutput>, GitError> {
    let mut cmd = headless_git();
    cmd.current_dir(worktree).args(args);
    #[cfg(test)]
    TEST_ENV.with(|env| {
        for (k, v) in env.borrow().iter() {
            cmd.env(k, v);
        }
    });
    let opts = OpOptions { c_locale: true, progress_at_once: true, redact_credentials: true, ..OpOptions::default() };
    let finished = run_process(cmd, None, &opts, cancel, channel)?;
    Ok(if finished.status.success() { Ok(()) } else { Err(finished.output) })
}

/// The error a failed fetch, pull or push printed: a typed one Topos names, else `Other`.
fn failure(output: &OpOutput) -> GitError {
    network_refusal(&output.stderr).unwrap_or_else(|| {
        let stderr = output.stderr.trim();
        GitError::Other { stderr: if stderr.is_empty() { "git failed and printed nothing".into() } else { stderr.to_string() } }
    })
}

/// The typed refusal in a network git's `LC_ALL=C` stderr, or None for one Topos doesn't name.
pub(super) fn network_refusal(stderr: &str) -> Option<GitError> {
    let has = |needle: &str| stderr.contains(needle);
    if has("Host key verification failed") || has("REMOTE HOST IDENTIFICATION HAS CHANGED") {
        return Some(GitError::HostKeyUnknown);
    }
    if has("Authentication failed")
        || has("could not read Username")
        || has("could not read Password")
        || has("terminal prompts disabled")
        || has("Permission denied (publickey")
        || has("Invalid username or password")
    {
        return Some(GitError::AuthFailed);
    }
    if has("Could not resolve host")
        || has("Could not resolve hostname")
        || has("Connection refused")
        || has("Connection timed out")
        || has("Network is unreachable")
        || has("Failed to connect to")
        || has("Connection reset by peer")
        || has("The remote end hung up unexpectedly")
    {
        return Some(GitError::Network);
    }
    None
}

/// Fetches `from`, one remote or all, with `prune` dropping remote-tracking branches the remote
/// deleted, as the cancellable op `op_id`. It holds the repo's lock, and touches no
/// worktree, so it takes no staging slot.
pub fn fetch(
    ops: &GitOps,
    locks: &StagingLocks,
    worktree: &Path,
    op_id: Uuid,
    from: &FetchFrom,
    prune: bool,
    channel: &Channel<OpEvent>,
) -> Result<RemoteOutcome, GitError> {
    ops.run_with(op_id, channel, |cancel| {
        let _net = locks.repo.hold(worktree, cancel, channel)?;
        let mut args = vec!["fetch", "--progress"];
        if prune {
            args.push("--prune");
        }
        match from {
            FetchFrom::All => args.push("--all"),
            FetchFrom::Remote { name } => {
                check_remote(worktree, name)?;
                args.extend(["--", name.as_str()]);
            }
        }
        if let Err(output) = run_network(worktree, &args, cancel, channel)? {
            return Err(failure(&output));
        }
        remote_outcome(worktree)
    })
}

/// HEAD and the refs of `worktree`, read after a network operation.
fn remote_outcome(worktree: &Path) -> Result<RemoteOutcome, GitError> {
    let refs = outcome(worktree)?;
    Ok(RemoteOutcome { head: refs.head, refs: refs.refs, conflicts: false, sync: sync_status(worktree)? })
}

/// How a pull reconciles divergent branches, for this pull: `"merge"`, `"rebase"` or
/// `"fastForward"` (fast-forward only).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PullStrategy {
    Merge,
    Rebase,
    FastForward,
}

impl PullStrategy {
    /// The `git pull` flags that pick this strategy over whatever git config says. Merge passes
    /// `--ff` too, so a `pull.ff=only` in config can't refuse the merge asked for.
    fn flags(self) -> &'static [&'static str] {
        match self {
            PullStrategy::Merge => &["--no-rebase", "--ff"],
            PullStrategy::Rebase => &["--rebase"],
            PullStrategy::FastForward => &["--ff-only"],
        }
    }

    /// The local config "Remember for this repo" writes for this strategy.
    fn config(self) -> (&'static str, &'static str) {
        match self {
            PullStrategy::Merge => ("pull.rebase", "false"),
            PullStrategy::Rebase => ("pull.rebase", "true"),
            PullStrategy::FastForward => ("pull.ff", "only"),
        }
    }
}

/// Pulls the branch checked out in `worktree` from its upstream, as the cancellable op `op_id`.
/// With no `strategy` it is plain `git pull`, so `pull.rebase`, `pull.ff` and
/// `branch.<name>.rebase` decide, and git refusing divergent branches returns
/// [`GitError::DivergentPullNeedsStrategy`]. With one, it applies to this pull only, unless
/// `remember` writes it to the repo's local config first; that is the only config Topos writes.
/// A pull that stops on conflicts returns its outcome with `conflicts` set, for the operation
/// banner. It holds the repo's lock and then `worktree`'s staging slot.
pub fn pull(
    ops: &GitOps,
    locks: &StagingLocks,
    worktree: &Path,
    op_id: Uuid,
    strategy: Option<PullStrategy>,
    remember: bool,
    channel: &Channel<OpEvent>,
) -> Result<RemoteOutcome, GitError> {
    ops.run_with(op_id, channel, |cancel| {
        let _net = locks.repo.hold(worktree, cancel, channel)?;
        let _slot = locks.begin(worktree)?;
        let mut args = vec!["pull", "--progress"];
        if let Some(strategy) = strategy {
            if remember {
                let (key, value) = strategy.config();
                run_git(worktree, &["config", "--local", key, value], cancel, channel)?;
            }
            args.extend(strategy.flags());
        }
        let Err(output) = run_network(worktree, &args, cancel, channel)? else {
            return remote_outcome(worktree);
        };
        if detect_operation(&git_dir(worktree)?) != Operation::None {
            return Ok(RemoteOutcome { conflicts: true, ..remote_outcome(worktree)? });
        }
        Err(pull_refusal(worktree, &output.stderr)?.unwrap_or_else(|| failure(&output)))
    })
}

/// The refusal a failed pull's stderr names beyond [`network_refusal`]'s: divergent branches with
/// no strategy, or a fast-forward-only pull that can't fast-forward, and a branch with no upstream.
fn pull_refusal(worktree: &Path, stderr: &str) -> Result<Option<GitError>, GitError> {
    if stderr.contains("divergent branches") || stderr.contains("Not possible to fast-forward") {
        return Ok(Some(GitError::DivergentPullNeedsStrategy));
    }
    if stderr.contains("There is no tracking information for the current branch") {
        return Ok(Some(GitError::NoUpstream { branch: current_branch(worktree)?.unwrap_or_default(), remotes: remotes(worktree)? }));
    }
    Ok(None)
}

/// The branch checked out in `worktree`, or None for a detached HEAD.
fn current_branch(worktree: &Path) -> Result<Option<String>, GitError> {
    Ok(read_git_line(worktree, &["symbolic-ref", "--quiet", "--short", "HEAD"])?.filter(|b| !b.is_empty()))
}

/// Fetches `from` in `worktree_path`'s repo, with `prune`, as op `op_id`. See [`fetch`].
#[tauri::command]
pub async fn git_fetch(
    worktree_path: String,
    from: FetchFrom,
    prune: bool,
    op_id: Uuid,
    on_event: Channel<OpEvent>,
    app: tauri::AppHandle,
) -> Result<RemoteOutcome, GitError> {
    in_background(app, "fetch", move |ops, locks| fetch(ops, locks, Path::new(&worktree_path), op_id, &from, prune, &on_event)).await
}

/// Pulls the branch checked out in `worktree_path`, with `strategy` for this pull only unless
/// `remember`, as op `op_id`. See [`pull`].
#[tauri::command]
pub async fn git_pull(
    worktree_path: String,
    strategy: Option<PullStrategy>,
    remember: bool,
    op_id: Uuid,
    on_event: Channel<OpEvent>,
    app: tauri::AppHandle,
) -> Result<RemoteOutcome, GitError> {
    in_background(app, "pull", move |ops, locks| pull(ops, locks, Path::new(&worktree_path), op_id, strategy, remember, &on_event)).await
}

/// Pushes the local branch `ref` to `remote` or its upstream, with `set_upstream` tracking it, as
/// op `op_id`. See [`push`].
#[tauri::command]
pub async fn git_push(
    worktree_path: String,
    r#ref: String,
    remote: Option<String>,
    set_upstream: bool,
    op_id: Uuid,
    on_event: Channel<OpEvent>,
    app: tauri::AppHandle,
) -> Result<RemoteOutcome, GitError> {
    in_background(app, "push", move |ops, locks| {
        let target = PushTarget { branch: &r#ref, remote: remote.as_deref(), set_upstream };
        push(ops, locks, Path::new(&worktree_path), op_id, target, &on_event)
    })
    .await
}

/// The toolbar's ahead and behind counts for `worktree_path`. See [`sync_status`].
#[tauri::command]
pub async fn git_sync_status(worktree_path: String) -> Result<SyncStatus, GitError> {
    tokio::task::spawn_blocking(move || sync_status(Path::new(&worktree_path)))
        .await
        .map_err(|e| GitError::Other { stderr: format!("could not read the sync status: {e}") })?
}

#[cfg(test)]
thread_local! {
    /// Env a test sets for the network gits its own thread runs; see [`with_repo_config_only`].
    static TEST_ENV: std::cell::RefCell<Vec<(&'static str, String)>> = const { std::cell::RefCell::new(Vec::new()) };
}

/// Runs `run` with the network gits on this thread reading only the repo's own config, so the
/// machine's system and global config can't change what a test sees.
#[cfg(test)]
pub(super) fn with_repo_config_only<T>(run: impl FnOnce() -> T) -> T {
    let empty = std::env::temp_dir().join(format!("quay-no-global-{}", Uuid::new_v4().simple()));
    TEST_ENV.with(|env| *env.borrow_mut() = vec![("GIT_CONFIG_NOSYSTEM", "1".into()), ("GIT_CONFIG_GLOBAL", empty.to_string_lossy().into_owned())]);
    let result = run();
    TEST_ENV.with(|env| env.borrow_mut().clear());
    result
}

/// What a push pushes: the local `branch`, to `remote` or its upstream's remote, setting the
/// upstream with `set_upstream`.
#[derive(Debug, Clone, Copy)]
pub struct PushTarget<'a> {
    pub branch: &'a str,
    pub remote: Option<&'a str>,
    pub set_upstream: bool,
}

/// Pushes the local branch `target.branch` with `git push --porcelain`, as the cancellable op
/// `op_id`, holding the repo's lock. With an upstream on a remote it pushes there, to the
/// upstream branch. With none, it refuses with [`GitError::NoUpstream`] unless
/// `target.set_upstream` or `push.autoSetupRemote` says to push to the branch of the same name and
/// track it (`-u`). It never forces: a remote branch with commits this one lacks returns
/// [`GitError::NonFastForward`], and a remote that refuses the ref, as a hook does,
/// [`GitError::RemoteRejected`].
pub fn push(
    ops: &GitOps,
    locks: &StagingLocks,
    worktree: &Path,
    op_id: Uuid,
    target: PushTarget<'_>,
    channel: &Channel<OpEvent>,
) -> Result<RemoteOutcome, GitError> {
    let PushTarget { branch, remote, set_upstream } = target;
    ops.run_with(op_id, channel, |cancel| {
        let _net = locks.repo.hold(worktree, cancel, channel)?;
        check_branch_name(worktree, branch)?;
        rev_oid(worktree, &format!("refs/heads/{branch}"))?.ok_or_else(|| invalid_ref(branch))?;
        if let Some(remote) = remote {
            check_remote(worktree, remote)?;
        }
        let all = remotes(worktree)?;
        let no_upstream = || GitError::NoUpstream { branch: branch.to_string(), remotes: all.clone() };
        let upstream = upstream_of(worktree, branch)?.filter(|(r, _)| all.contains(r) && remote.is_none_or(|asked| asked == r));
        let (to_remote, dest, track) = match upstream {
            Some((r, merge)) if !set_upstream => (r, merge, false),
            _ if set_upstream || config_true(worktree, "push.autoSetupRemote")? => {
                let only = (all.len() == 1).then(|| all[0].clone());
                let r = remote.map(str::to_string).or(only).ok_or_else(no_upstream)?;
                (r, format!("refs/heads/{branch}"), true)
            }
            _ => return Err(no_upstream()),
        };
        let refspec = format!("refs/heads/{branch}:{dest}");
        let mut args = vec!["push", "--porcelain", "--progress"];
        if track {
            args.push("--set-upstream");
        }
        args.extend(["--", to_remote.as_str(), refspec.as_str()]);
        if let Err(output) = run_network(worktree, &args, cancel, channel)? {
            return Err(push_refusal(&output).unwrap_or_else(|| failure(&output)));
        }
        remote_outcome(worktree)
    })
}

/// The remote and the full ref name of `branch`'s upstream, from `branch.<name>.remote` and
/// `.merge`, or None when it has none.
fn upstream_of(worktree: &Path, branch: &str) -> Result<Option<(String, String)>, GitError> {
    let get = |key: String| -> Result<Option<String>, GitError> {
        read_git_line(worktree, &["config", "--get", &key])
    };
    Ok(match (get(format!("branch.{branch}.remote"))?, get(format!("branch.{branch}.merge"))?) {
        (Some(remote), Some(merge)) if !remote.is_empty() && merge.starts_with("refs/") => Some((remote, merge)),
        _ => None,
    })
}

/// Whether the boolean config `key` is set true.
fn config_true(worktree: &Path, key: &str) -> Result<bool, GitError> {
    Ok(read_git_line(worktree, &["config", "--type=bool", "--get", key])?.is_some_and(|v| v == "true"))
}

/// The refusal in a failed `push --porcelain`: its first rejected ref's status line,
/// `!`, tab, `<from>:<to>`, tab, then `[rejected] (non-fast-forward)` or
/// `[remote rejected] (<reason>)`, or else what [`network_refusal`] reads from stderr.
pub(super) fn push_refusal(output: &OpOutput) -> Option<GitError> {
    for line in output.stdout.lines() {
        let mut fields = line.split('\t');
        let (Some("!"), Some(refs), Some(summary)) = (fields.next(), fields.next(), fields.next()) else {
            continue;
        };
        let to = refs.split_once(':').map_or(refs, |(_, to)| to).to_string();
        let reason = summary.split_once(" (").map(|(_, r)| r.trim_end_matches(')').to_string()).unwrap_or_default();
        if summary.starts_with("[remote rejected]") {
            let remote_lines = output
                .stderr
                .lines()
                .filter_map(|l| l.strip_prefix("remote: "))
                .map(|l| l.trim_end().to_string())
                .filter(|l| !l.is_empty())
                .collect();
            return Some(GitError::RemoteRejected { r#ref: to, reason, remote_lines });
        }
        if summary.starts_with("[rejected]") && (reason == "non-fast-forward" || reason == "fetch first") {
            return Some(GitError::NonFastForward { r#ref: to });
        }
        return Some(GitError::Other { stderr: format!("{to}: {summary}") });
    }
    network_refusal(&output.stderr)
}
