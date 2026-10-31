//! Fetch, pull and push from Topos's toolbar and palette (#367, #395).
//!
//! Each runs headless through the op runner with `--progress`, so git's progress lines arrive as
//! [`OpEvent::Progress`], and with `LC_ALL=C`, so its refusals can be matched. One network
//! operation runs per repo at a time, holding its [`RepoLock`](super::repo_lock::RepoLock); the local
//! ref operations wait behind it.
//! Remote and branch names are checked before git sees them and never read as options. A force
//! push is only ever with a lease (#396), and Topos never writes config except a pull's
//! "Remember for this repo".

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
use super::ref_ops::check_tag_name;
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
/// apart they are, and when the worktree last fetched; and the repo's remotes.
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
    /// The repo's remotes by name, which the tag and remote branch menus offer (#396).
    pub remotes: Vec<String>,
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
    Ok(SyncStatus { branch, upstream, ahead, behind, fetched_at_ms, remotes: remotes(worktree)? })
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
/// The inner result is `Ok` when git exits 0 and `Err` when it doesn't, each with what it
/// printed, for the caller to read its answer or refusal from; the outer one is an error running
/// git at all.
fn run_network(worktree: &Path, args: &[&str], cancel: &AtomicBool, channel: &Channel<OpEvent>) -> Result<Result<OpOutput, OpOutput>, GitError> {
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
    Ok(if finished.status.success() { Ok(finished.output) } else { Err(finished.output) })
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

/// A force push's lease, `{ "expectedSha": "…" }`: the remote-tracking sha its confirm showed.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Lease {
    pub expected_sha: String,
}

/// Pushes the local branch `ref` to `remote` or its upstream, with `set_upstream` tracking it, or
/// with `lease` force-pushes it with that lease, as op `op_id`. See [`push`].
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn git_push(
    worktree_path: String,
    r#ref: String,
    remote: Option<String>,
    set_upstream: bool,
    lease: Option<Lease>,
    op_id: Uuid,
    on_event: Channel<OpEvent>,
    app: tauri::AppHandle,
) -> Result<RemoteOutcome, GitError> {
    in_background(app, "push", move |ops, locks| {
        let lease = lease.as_ref().map(|l| l.expected_sha.as_str());
        let target = PushTarget { branch: &r#ref, remote: remote.as_deref(), set_upstream, lease };
        push(ops, locks, Path::new(&worktree_path), op_id, target, &on_event)
    })
    .await
}

/// Pushes the one local tag `name` to `remote`, as op `op_id`. See [`push_tag`].
#[tauri::command]
pub async fn git_push_tag(
    worktree_path: String,
    remote: String,
    name: String,
    op_id: Uuid,
    on_event: Channel<OpEvent>,
    app: tauri::AppHandle,
) -> Result<RemoteOutcome, GitError> {
    in_background(app, "push the tag", move |ops, locks| push_tag(ops, locks, Path::new(&worktree_path), op_id, &remote, &name, &on_event)).await
}

/// Deletes the branch or tag `ref` (a full `refs/heads/…` or `refs/tags/…` name) from `remote`,
/// as op `op_id`. See [`push_delete`].
#[tauri::command]
pub async fn git_push_delete(
    worktree_path: String,
    remote: String,
    r#ref: String,
    op_id: Uuid,
    on_event: Channel<OpEvent>,
    app: tauri::AppHandle,
) -> Result<RemoteOutcome, GitError> {
    in_background(app, "delete the remote ref", move |ops, locks| push_delete(ops, locks, Path::new(&worktree_path), op_id, &remote, &r#ref, &on_event)).await
}

/// The remotes that have the tag `name`, as op `op_id`. See [`tag_remotes`].
#[tauri::command]
pub async fn git_tag_remotes(
    worktree_path: String,
    name: String,
    op_id: Uuid,
    on_event: Channel<OpEvent>,
    app: tauri::AppHandle,
) -> Result<Vec<String>, GitError> {
    in_background(app, "read the remotes' tags", move |ops, locks| tag_remotes(ops, locks, Path::new(&worktree_path), op_id, &name, &on_event)).await
}

/// What a force push with lease of the local branch `ref` would overwrite. See [`lease_plan`].
#[tauri::command]
pub async fn git_push_lease_plan(worktree_path: String, r#ref: String, remote: Option<String>) -> Result<LeasePlan, GitError> {
    tokio::task::spawn_blocking(move || lease_plan(Path::new(&worktree_path), &r#ref, remote.as_deref()))
        .await
        .map_err(|e| GitError::Other { stderr: format!("could not read the force push: {e}") })?
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

//// What a push pushes: the local `branch`, to `remote` or its upstream's remote, setting the
/// upstream with `set_upstream`. With `lease`, the remote-tracking sha its confirm showed, it is a
/// force push with that lease (#396).
#[derive(Debug, Clone, Copy)]
pub struct PushTarget<'a> {
    pub branch: &'a str,
    pub remote: Option<&'a str>,
    pub set_upstream: bool,
    pub lease: Option<&'a str>,
}

/// Where a push of a local branch goes: the remote, the remote branch's full name, and whether
/// the push sets it as the upstream (`-u`).
struct Destination {
    remote: String,
    remote_ref: String,
    track: bool,
}

/// Where a push of the local `branch` goes. With an upstream on a remote (on `remote`, when one is
/// asked for) it is that upstream branch. With none, it refuses with [`GitError::NoUpstream`]
/// unless `set_upstream` or `push.autoSetupRemote` says to push to the branch of the same name and
/// track it. Checks `branch` and `remote` first, so neither reaches git as an option.
fn destination(worktree: &Path, branch: &str, remote: Option<&str>, set_upstream: bool) -> Result<Destination, GitError> {
    check_branch_name(worktree, branch)?;
    rev_oid(worktree, &format!("refs/heads/{branch}"))?.ok_or_else(|| invalid_ref(branch))?;
    if let Some(remote) = remote {
        check_remote(worktree, remote)?;
    }
    let all = remotes(worktree)?;
    let no_upstream = || GitError::NoUpstream { branch: branch.to_string(), remotes: all.clone() };
    let upstream = upstream_of(worktree, branch)?.filter(|(r, _)| all.contains(r) && remote.is_none_or(|asked| asked == r));
    match upstream {
        Some((remote, remote_ref)) if !set_upstream => Ok(Destination { remote, remote_ref, track: false }),
        _ if set_upstream || config_true(worktree, "push.autoSetupRemote")? => {
            let only = (all.len() == 1).then(|| all[0].clone());
            let remote = remote.map(str::to_string).or(only).ok_or_else(no_upstream)?;
            Ok(Destination { remote, remote_ref: format!("refs/heads/{branch}"), track: true })
        }
        _ => Err(no_upstream()),
    }
}

/// The remote-tracking ref Topos shows for the remote branch `remote_ref` on `remote`:
/// `refs/remotes/<remote>/<name>` for `refs/heads/<name>`, as the default fetch refspec maps it.
fn tracking_ref(remote: &str, remote_ref: &str) -> Result<String, GitError> {
    let name = remote_ref.strip_prefix("refs/heads/").ok_or_else(|| invalid_ref(remote_ref))?;
    Ok(format!("refs/remotes/{remote}/{name}"))
}

/// Refuses `sha` unless it is a full commit id: 40 or 64 hex digits.
fn check_full_sha(sha: &str) -> Result<(), GitError> {
    if (sha.len() == 40 || sha.len() == 64) && sha.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Ok(());
    }
    Err(GitError::Other { stderr: format!("{sha} is not a full commit id") })
}

/// What a force push with lease of a branch would do, for its confirm (#396): where it goes, the
/// remote-tracking branch Topos shows for that remote branch and its sha, which becomes the lease,
/// and how many commits on it the local branch lacks, which the push overwrites, as of the last
/// fetch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LeasePlan {
    pub remote: String,
    /// The remote branch's full name, such as `refs/heads/main`.
    pub remote_ref: String,
    /// The remote-tracking branch, such as `origin/main`.
    pub tracking: String,
    pub expected_sha: String,
    pub overwrites: u32,
    /// The remote's default branch as `refs/remotes/<remote>/HEAD` records it, or None.
    pub default_branch: Option<String>,
}

/// The [`LeasePlan`] of a force push of the local `branch`, to where a plain push of it goes. It
/// reads refs alone and never reaches the remote, so its count is as of the last fetch. With no
/// remote-tracking branch for the remote branch there is no lease to take, and it refuses with
/// `Other` until a fetch.
pub fn lease_plan(worktree: &Path, branch: &str, remote: Option<&str>) -> Result<LeasePlan, GitError> {
    let Destination { remote, remote_ref, .. } = destination(worktree, branch, remote, false)?;
    let tracking_full = tracking_ref(&remote, &remote_ref)?;
    let tracking = tracking_full.trim_start_matches("refs/remotes/").to_string();
    let unfetched = || GitError::Other { stderr: format!("Topos has no {tracking} to take a lease on; fetch first") };
    let expected_sha = rev_oid(worktree, &tracking_full)?.ok_or_else(unfetched)?;
    let local = rev_oid(worktree, &format!("refs/heads/{branch}"))?.ok_or_else(|| invalid_ref(branch))?;
    let not_local = format!("^{local}");
    let uncounted = || GitError::Other { stderr: format!("could not count the commits on {tracking}") };
    let out = read_git(worktree, &["rev-list", "--count", &expected_sha, &not_local])?.ok_or_else(uncounted)?;
    let overwrites = String::from_utf8_lossy(&out).trim().parse().map_err(|_| uncounted())?;
    let default_branch = default_branch(worktree, &remote)?;
    Ok(LeasePlan { remote, remote_ref, tracking, expected_sha, overwrites, default_branch })
}

/// The default branch of `remote` as `refs/remotes/<remote>/HEAD` records it, or None.
fn default_branch(worktree: &Path, remote: &str) -> Result<Option<String>, GitError> {
    let head = format!("refs/remotes/{remote}/HEAD");
    let prefix = format!("refs/remotes/{remote}/");
    let target = read_git_line(worktree, &["symbolic-ref", "--quiet", &head])?;
    Ok(target.and_then(|t| t.strip_prefix(&prefix).map(str::to_string)).filter(|b| !b.is_empty()))
}

/// Pushes the local branch `target.branch` with `git push --porcelain`, as the cancellable op
/// `op_id`, holding the repo's lock, to where [`destination`] says. Without a lease it never
/// forces: a remote branch with commits this one lacks returns [`GitError::NonFastForward`], and a
/// remote that refuses the ref, as a hook does, [`GitError::RemoteRejected`]. With `target.lease`
/// it runs `--force-with-lease=<remote ref>:<lease>` plus `--force-if-includes`, never a bare
/// `--force`. The remote-tracking branch is re-read under the lock first and must still be at the
/// lease, and git checks the remote branch is too; either refusal returns
/// [`GitError::LeaseRefused`] and nothing moves. A lease push never sets the upstream.
pub fn push(
    ops: &GitOps,
    locks: &StagingLocks,
    worktree: &Path,
    op_id: Uuid,
    target: PushTarget<'_>,
    channel: &Channel<OpEvent>,
) -> Result<RemoteOutcome, GitError> {
    let PushTarget { branch, remote, set_upstream, lease } = target;
    ops.run_with(op_id, channel, |cancel| {
        let _net = locks.repo.hold(worktree, cancel, channel)?;
        let Destination { remote, remote_ref, track } = destination(worktree, branch, remote, set_upstream && lease.is_none())?;
        let refspec = format!("refs/heads/{branch}:{remote_ref}");
        let mut args = vec!["push", "--porcelain", "--progress"];
        let lease_arg;
        if let Some(expected) = lease {
            check_full_sha(expected)?;
            if rev_oid(worktree, &tracking_ref(&remote, &remote_ref)?)?.as_deref() != Some(expected) {
                return Err(GitError::LeaseRefused { r#ref: remote_ref });
            }
            lease_arg = format!("--force-with-lease={remote_ref}:{expected}");
            args.extend([lease_arg.as_str(), "--force-if-includes"]);
        } else if track {
            args.push("--set-upstream");
        }
        args.extend(["--", remote.as_str(), refspec.as_str()]);
        if let Err(output) = run_network(worktree, &args, cancel, channel)? {
            return Err(push_refusal(&output).unwrap_or_else(|| failure(&output)));
        }
        remote_outcome(worktree)
    })
}

/// Pushes the one local tag `name` to `remote` as `refs/tags/<name>`, as the cancellable op
/// `op_id`, holding the repo's lock. `--no-follow-tags` keeps `push.followTags` from sending the
/// annotated tags on the commits it carries too. A remote that already has a different tag of
/// that name refuses it, and Topos never forces a tag.
pub fn push_tag(
    ops: &GitOps,
    locks: &StagingLocks,
    worktree: &Path,
    op_id: Uuid,
    remote: &str,
    name: &str,
    channel: &Channel<OpEvent>,
) -> Result<RemoteOutcome, GitError> {
    ops.run_with(op_id, channel, |cancel| {
        let _net = locks.repo.hold(worktree, cancel, channel)?;
        let full = check_tag_name(worktree, name)?;
        rev_oid(worktree, &full)?.ok_or_else(|| invalid_ref(name))?;
        check_remote(worktree, remote)?;
        let refspec = format!("{full}:{full}");
        let args = ["push", "--porcelain", "--progress", "--no-follow-tags", "--", remote, refspec.as_str()];
        if let Err(output) = run_network(worktree, &args, cancel, channel)? {
            return Err(push_refusal(&output).unwrap_or_else(|| failure(&output)));
        }
        remote_outcome(worktree)
    })
}

/// `full_ref` once it is one branch or tag, `refs/heads/<name>` or `refs/tags/<name>`, that
/// `git check-ref-format` accepts and whose name doesn't start with `-`. Refuses anything else,
/// so a remote delete can only ever name one branch or tag.
fn check_branch_or_tag_ref(worktree: &Path, full_ref: &str) -> Result<(), GitError> {
    let name = full_ref.strip_prefix("refs/heads/").or_else(|| full_ref.strip_prefix("refs/tags/")).ok_or_else(|| invalid_ref(full_ref))?;
    if name.is_empty() || name.starts_with('-') || read_git(worktree, &["check-ref-format", full_ref])?.is_none() {
        return Err(invalid_ref(full_ref));
    }
    Ok(())
}

/// Deletes the one branch or tag `full_ref` (`refs/heads/<name>` or `refs/tags/<name>`) from
/// `remote` with `git push --delete`, as the cancellable op `op_id`, holding the repo's lock. The
/// remote-tracking branch of a deleted branch goes too, and local branches and tags stay. There is
/// no undo.
pub fn push_delete(
    ops: &GitOps,
    locks: &StagingLocks,
    worktree: &Path,
    op_id: Uuid,
    remote: &str,
    full_ref: &str,
    channel: &Channel<OpEvent>,
) -> Result<RemoteOutcome, GitError> {
    ops.run_with(op_id, channel, |cancel| {
        let _net = locks.repo.hold(worktree, cancel, channel)?;
        check_branch_or_tag_ref(worktree, full_ref)?;
        check_remote(worktree, remote)?;
        let args = ["push", "--porcelain", "--progress", "--delete", "--", remote, full_ref];
        if let Err(output) = run_network(worktree, &args, cancel, channel)? {
            return Err(push_refusal(&output).unwrap_or_else(|| failure(&output)));
        }
        remote_outcome(worktree)
    })
}

/// The remotes that have the tag `name`, from `git ls-remote --tags` on each, as the cancellable
/// op `op_id`, holding the repo's lock: what "Also delete from ‹remote›" offers. A remote git
/// can't reach is left out rather than failing the lookup, since the tag's local delete doesn't
/// depend on it.
pub fn tag_remotes(
    ops: &GitOps,
    locks: &StagingLocks,
    worktree: &Path,
    op_id: Uuid,
    name: &str,
    channel: &Channel<OpEvent>,
) -> Result<Vec<String>, GitError> {
    ops.run_with(op_id, channel, |cancel| {
        let _net = locks.repo.hold(worktree, cancel, channel)?;
        let full = check_tag_name(worktree, name)?;
        let mut have = Vec::new();
        for remote in remotes(worktree)? {
            if remote.starts_with('-') {
                continue;
            }
            let Ok(output) = run_network(worktree, &["ls-remote", "--tags", "--", &remote, &full], cancel, channel)? else {
                continue;
            };
            if output.stdout.lines().any(|line| line.split('\t').nth(1) == Some(full.as_str())) {
                have.push(remote);
            }
        }
        Ok(have)
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
        if summary.starts_with("[rejected]") && reason == "stale info" {
            return Some(GitError::LeaseRefused { r#ref: to });
        }
        if summary.starts_with("[rejected]") && (reason == "non-fast-forward" || reason == "fetch first") {
            return Some(GitError::NonFastForward { r#ref: to });
        }
        return Some(GitError::Other { stderr: format!("{to}: {summary}") });
    }
    network_refusal(&output.stderr)
}
