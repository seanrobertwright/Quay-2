//! Rename, upstream, delete and local tags from Topos's badges and rows (#367, #394).
//!
//! Every write runs through the op runner in the worktree's staging slot, as checkout and create
//! do. Every branch, tag and upstream name passes `check-ref-format` before git sees it, and goes
//! after `--` (or attached to its option) so a name can never read as an option.

use std::path::Path;

use serde::Serialize;
use tauri::ipc::Channel;
use uuid::Uuid;

use super::graph::{read_refs, GitRefs};
use super::checkout::{check_branch_name, invalid_ref, outcome, refuse_option_like, resolve_commit, rev_oid, run_git, run_git_fed, RefsOutcome};
use super::commit::read_git;
use super::error::GitError;
use super::op_runner::{GitOps, OpEvent};
use super::operation::in_background;
use super::staging::StagingLocks;

/// Renames the local branch `name` to `new_name` with `git branch -m`, as the cancellable op
/// `op_id` in `worktree`'s staging slot. A worktree with `name` checked out stays on it.
pub fn branch_rename(
    ops: &GitOps,
    locks: &StagingLocks,
    worktree: &Path,
    op_id: Uuid,
    name: &str,
    new_name: &str,
    channel: &Channel<OpEvent>,
) -> Result<RefsOutcome, GitError> {
    ops.run_with(op_id, channel, |cancel| {
        let _slot = locks.begin_ref_write(worktree, cancel, channel)?;
        check_branch_name(worktree, name)?;
        check_branch_name(worktree, new_name)?;
        run_git(worktree, &["branch", "-m", "--", name, new_name], cancel, channel)?;
        outcome(worktree)
    })
}

/// Whether git ran but refused with stderr containing `needle`: true for that refusal, false when
/// git succeeded. Any other failure passes through.
fn failed_saying(ran: Result<String, GitError>, needle: &str) -> Result<bool, GitError> {
    match ran {
        Ok(_) => Ok(false),
        Err(GitError::Other { stderr }) if stderr.contains(needle) => Ok(true),
        Err(other) => Err(other),
    }
}

/// The full name of the branch `upstream` names, `refs/remotes/<upstream>` when there is a
/// remote-tracking branch of that name and `refs/heads/<upstream>` when there is a local one, once
/// `check-ref-format` accepts it. Refuses one that is option-like or names no branch.
fn upstream_ref(worktree: &Path, upstream: &str) -> Result<String, GitError> {
    refuse_option_like(upstream)?;
    for prefix in ["refs/remotes/", "refs/heads/"] {
        let full = format!("{prefix}{upstream}");
        if read_git(worktree, &["check-ref-format", &full])?.is_none() {
            return Err(invalid_ref(upstream));
        }
        if rev_oid(worktree, &full)?.is_some() {
            return Ok(full);
        }
    }
    Err(invalid_ref(upstream))
}

/// Sets the upstream of the local branch `name` to `upstream`, a remote-tracking or local branch,
/// or with None unsets it, as the cancellable op `op_id` in `worktree`'s staging slot. Unsetting
/// a branch's upstream when it has none succeeds and changes nothing.
pub fn branch_set_upstream(
    ops: &GitOps,
    locks: &StagingLocks,
    worktree: &Path,
    op_id: Uuid,
    name: &str,
    upstream: Option<&str>,
    channel: &Channel<OpEvent>,
) -> Result<RefsOutcome, GitError> {
    ops.run_with(op_id, channel, |cancel| {
        let _slot = locks.begin_ref_write(worktree, cancel, channel)?;
        check_branch_name(worktree, name)?;
        match upstream {
            Some(upstream) => {
                // Attached to its option, the upstream can't read as an option of its own.
                let set = format!("--set-upstream-to={}", upstream_ref(worktree, upstream)?);
                run_git(worktree, &["branch", &set, "--", name], cancel, channel)?;
            }
            None => {
                failed_saying(run_git(worktree, &["branch", "--unset-upstream", "--", name], cancel, channel), "has no upstream information")?;
            }
        }
        outcome(worktree)
    })
}

/// What a branch delete leaves: the tip it deleted, which Restore makes the branch at again, and
/// HEAD and the refs after it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchDeleted {
    pub tip: String,
    pub head: Option<String>,
    pub refs: GitRefs,
}

/// The oid the local branch `name` points at, or [`GitError::InvalidRefName`] when there is none.
fn branch_tip(worktree: &Path, name: &str) -> Result<String, GitError> {
    rev_oid(worktree, &format!("refs/heads/{name}"))?.ok_or_else(|| invalid_ref(name))
}

/// How many commits `tip` reaches that no branch but `name`, no remote-tracking branch, no tag and
/// not HEAD reach: what deleting `name` leaves only in the reflog.
fn unique_commits(worktree: &Path, name: &str, tip: &str) -> Result<u32, GitError> {
    // `--exclude` takes `name` as a glob, which is safe: check-ref-format refuses `*`, `?` and `[`.
    let exclude = format!("--exclude={name}");
    let uncounted = || GitError::Other { stderr: format!("could not count the commits only {name} reaches") };
    let out = read_git(worktree, &["rev-list", "--count", tip, "--not", &exclude, "--branches", "--remotes", "--tags", "HEAD"])?.ok_or_else(uncounted)?;
    String::from_utf8_lossy(&out).trim().parse().map_err(|_| uncounted())
}

/// Deletes the local branch `name` with `git branch -d`, or with `force` `-D`, as the cancellable
/// op `op_id` in `worktree`'s staging slot, and returns the tip it deleted for Restore. Refuses,
/// before any write, a branch checked out in any worktree, `worktree` included, with
/// [`GitError::BranchInOtherWorktree`]. When `-d` refuses an unmerged branch it returns
/// [`GitError::NotFullyMerged`] and the branch stays.
pub fn branch_delete(
    ops: &GitOps,
    locks: &StagingLocks,
    worktree: &Path,
    op_id: Uuid,
    name: &str,
    force: bool,
    channel: &Channel<OpEvent>,
) -> Result<BranchDeleted, GitError> {
    ops.run_with(op_id, channel, |cancel| {
        let _slot = locks.begin_ref_write(worktree, cancel, channel)?;
        check_branch_name(worktree, name)?;
        let tip = branch_tip(worktree, name)?;
        if let Some(holder) = read_refs(worktree)?.worktrees.into_iter().find(|w| w.branch.as_deref() == Some(name)) {
            return Err(GitError::BranchInOtherWorktree { worktree: holder.path });
        }
        let flag = if force { "-D" } else { "-d" };
        if failed_saying(run_git(worktree, &["branch", flag, "--", name], cancel, channel), "is not fully merged")? {
            return Err(GitError::NotFullyMerged { ahead: unique_commits(worktree, name, &tip)?, tip });
        }
        let RefsOutcome { head, refs } = outcome(worktree)?;
        Ok(BranchDeleted { tip, head, refs })
    })
}

/// A tag to create: `name`, at the commit `at`, annotated with `message` when it has one.
#[derive(Debug, Clone, Copy)]
pub struct NewTag<'a> {
    pub name: &'a str,
    pub at: &'a str,
    pub message: Option<&'a str>,
}

/// `refs/tags/<name>`, once `git check-ref-format` accepts it and `name` doesn't start with `-`, so
/// it can never read as an option. Refuses any other name.
pub(super) fn check_tag_name(worktree: &Path, name: &str) -> Result<String, GitError> {
    refuse_option_like(name)?;
    let full = format!("refs/tags/{name}");
    read_git(worktree, &["check-ref-format", &full])?.ok_or_else(|| invalid_ref(name))?;
    Ok(full)
}

/// Creates the tag `tag.name` at the commit `tag.at` in `worktree`'s repo, as the cancellable op
/// `op_id` in the worktree's staging slot: annotated (`-a -F -`) when `tag.message` holds more than
/// whitespace, lightweight otherwise. Signing follows git config. It never pushes the tag.
pub fn tag_create(
    ops: &GitOps,
    locks: &StagingLocks,
    worktree: &Path,
    op_id: Uuid,
    tag: NewTag<'_>,
    channel: &Channel<OpEvent>,
) -> Result<RefsOutcome, GitError> {
    let NewTag { name, at, message } = tag;
    ops.run_with(op_id, channel, |cancel| {
        let _slot = locks.begin_ref_write(worktree, cancel, channel)?;
        check_tag_name(worktree, name)?;
        let oid = resolve_commit(worktree, at)?;
        match message.filter(|m| !m.trim().is_empty()) {
            Some(message) => {
                run_git_fed(worktree, &["tag", "-a", "-F", "-", "--", name, &oid], Some(message.as_bytes().to_vec()), cancel, channel)?;
            }
            None => {
                run_git(worktree, &["tag", "--", name, &oid], cancel, channel)?;
            }
        }
        outcome(worktree)
    })
}

/// Deletes the local tag `name` with `git tag -d`, as the cancellable op `op_id` in `worktree`'s
/// staging slot. A tag of that name on a remote stays. Refuses a name that is invalid or names no
/// tag with [`GitError::InvalidRefName`].
pub fn tag_delete(
    ops: &GitOps,
    locks: &StagingLocks,
    worktree: &Path,
    op_id: Uuid,
    name: &str,
    channel: &Channel<OpEvent>,
) -> Result<RefsOutcome, GitError> {
    ops.run_with(op_id, channel, |cancel| {
        let _slot = locks.begin_ref_write(worktree, cancel, channel)?;
        let full = check_tag_name(worktree, name)?;
        rev_oid(worktree, &full)?.ok_or_else(|| invalid_ref(name))?;
        run_git(worktree, &["tag", "-d", "--", name], cancel, channel)?;
        outcome(worktree)
    })
}

/// Renames the local branch `name` to `new_name` in `worktree_path`'s repo as op `op_id`. See
/// [`branch_rename`].
#[tauri::command]
pub async fn git_branch_rename(
    worktree_path: String,
    name: String,
    new_name: String,
    op_id: Uuid,
    on_event: Channel<OpEvent>,
    app: tauri::AppHandle,
) -> Result<RefsOutcome, GitError> {
    in_background(app, "rename the branch", move |ops, locks| {
        branch_rename(ops, locks, Path::new(&worktree_path), op_id, &name, &new_name, &on_event)
    })
    .await
}

/// Sets the upstream of the local branch `name` to `upstream`, or with none unsets it, as op
/// `op_id`. See [`branch_set_upstream`].
#[tauri::command]
pub async fn git_branch_set_upstream(
    worktree_path: String,
    name: String,
    upstream: Option<String>,
    op_id: Uuid,
    on_event: Channel<OpEvent>,
    app: tauri::AppHandle,
) -> Result<RefsOutcome, GitError> {
    in_background(app, "set the upstream", move |ops, locks| {
        branch_set_upstream(ops, locks, Path::new(&worktree_path), op_id, &name, upstream.as_deref(), &on_event)
    })
    .await
}

/// Deletes the local branch `name`, with `force` even when it isn't merged, as op `op_id`, and
/// returns the tip it deleted. See [`branch_delete`].
#[tauri::command]
pub async fn git_branch_delete(
    worktree_path: String,
    name: String,
    force: bool,
    op_id: Uuid,
    on_event: Channel<OpEvent>,
    app: tauri::AppHandle,
) -> Result<BranchDeleted, GitError> {
    in_background(app, "delete the branch", move |ops, locks| branch_delete(ops, locks, Path::new(&worktree_path), op_id, &name, force, &on_event)).await
}

/// Creates the tag `name` at `at`, annotated with `message` when it has one, as op `op_id`. See
/// [`tag_create`].
#[tauri::command]
pub async fn git_tag_create(
    worktree_path: String,
    name: String,
    at: String,
    message: Option<String>,
    op_id: Uuid,
    on_event: Channel<OpEvent>,
    app: tauri::AppHandle,
) -> Result<RefsOutcome, GitError> {
    in_background(app, "create the tag", move |ops, locks| {
        tag_create(ops, locks, Path::new(&worktree_path), op_id, NewTag { name: &name, at: &at, message: message.as_deref() }, &on_event)
    })
    .await
}

/// Deletes the local tag `name` as op `op_id`. See [`tag_delete`].
#[tauri::command]
pub async fn git_tag_delete(
    worktree_path: String,
    name: String,
    op_id: Uuid,
    on_event: Channel<OpEvent>,
    app: tauri::AppHandle,
) -> Result<RefsOutcome, GitError> {
    in_background(app, "delete the tag", move |ops, locks| tag_delete(ops, locks, Path::new(&worktree_path), op_id, &name, &on_event)).await
}
