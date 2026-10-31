//! Checkout and branch creation from Topos's badges and rows (#367, #393).

use std::path::Path;
use std::sync::atomic::AtomicBool;

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use uuid::Uuid;

use super::error::GitError;
use super::commit::{head_oid, read_git};
use super::graph::{read_refs, GitRefs};
use super::op_runner::{headless_git, run_process, GitOps, OpEvent, OpOptions};
use super::operation::in_background;
use super::staging::{StagingLocks, STATUS_CAP};

/// What a checkout switches to: `{ "kind": "branch", "name": "main" }`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum CheckoutTarget {
    Branch { name: String },
    Remote { name: String },
    Detached { at: String },
}

/// HEAD and the refs after a checkout or a create.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefsOutcome {
    pub head: Option<String>,
    pub refs: GitRefs,
}

/// Runs `git <args>` in `worktree` through the op runner as part of the op whose cancel flag is
/// `cancel`, with `LC_ALL=C` so its refusals can be matched. Returns git's combined output when it
/// exits 0, and the error [`refusal`] reads from it otherwise.
pub(super) fn run_git(worktree: &Path, args: &[&str], cancel: &AtomicBool, channel: &Channel<OpEvent>) -> Result<String, GitError> {
    run_git_fed(worktree, args, None, cancel, channel)
}

/// [`run_git`] with `input` on git's stdin, such as a tag message for `-F -`.
pub(super) fn run_git_fed(
    worktree: &Path,
    args: &[&str],
    input: Option<Vec<u8>>,
    cancel: &AtomicBool,
    channel: &Channel<OpEvent>,
) -> Result<String, GitError> {
    let mut cmd = headless_git();
    cmd.current_dir(worktree).args(args);
    let opts = OpOptions { c_locale: true, cap_stream: true, progress_lines: false, ..OpOptions::default() };
    let finished = run_process(cmd, input, &opts, cancel, channel)?;
    if finished.status.success() {
        return Ok(finished.output.combined);
    }
    Err(refusal(&finished.output.combined).unwrap_or_else(|| {
        let output = finished.output.combined.trim().to_string();
        GitError::Other { stderr: if output.is_empty() { format!("git exited with {}", finished.status) } else { output } }
    }))
}

/// The typed refusal in a failed ref command's `LC_ALL=C` output, or None for one Topos doesn't
/// name: [`GitError::CheckoutWouldOverwrite`] with the files a checkout would overwrite, tracked or
/// untracked, which git lists one per tab-indented line under its `would be overwritten by
/// checkout:` header, or else [`GitError::BranchInOtherWorktree`] with the worktree git names in
/// its `is already used by worktree at '...'` line, or else [`GitError::RefExists`] for a branch or
/// tag that already exists, or else [`GitError::RefLocked`] when another process holds a ref lock.
pub(super) fn refusal(output: &str) -> Option<GitError> {
    let mut paths = Vec::new();
    let mut listing = false;
    for line in output.lines() {
        if line.contains("would be overwritten by checkout:") {
            listing = true;
        } else if listing {
            match line.strip_prefix('\t') {
                Some(path) if paths.len() < STATUS_CAP => paths.push(unquote(path)),
                Some(_) => {}
                None => listing = false,
            }
        }
    }
    if !paths.is_empty() {
        return Some(GitError::CheckoutWouldOverwrite { paths });
    }
    // git checks a branch out in one worktree at a time, and Topos never passes
    // `--ignore-other-worktrees`, so git's own refusal is what enforces it.
    if let Some(worktree) = output.lines().find_map(|line| line.split_once("is already used by worktree at '")?.1.strip_suffix('\'')) {
        return Some(GitError::BranchInOtherWorktree { worktree: worktree.to_string() });
    }
    if let Some(name) = output.lines().find_map(existing_ref) {
        return Some(GitError::RefExists { name: name.to_string() });
    }
    output.lines().any(is_ref_lock_failure).then_some(GitError::RefLocked)
}

/// The name in git's `a branch named '<name>' already exists` or `tag '<name>' already exists`.
fn existing_ref(line: &str) -> Option<&str> {
    let rest = line.strip_suffix("' already exists")?;
    rest.split_once("a branch named '").or_else(|| rest.split_once("tag '")).map(|(_, name)| name)
}

/// Whether `line` is git failing to take a ref's lock: `cannot lock ref '...'`, or `Unable to
/// create '<path>.lock': File exists` for a lock other than the index's, which is
/// [`GitError::IndexLocked`]'s.
fn is_ref_lock_failure(line: &str) -> bool {
    if line.contains("cannot lock ref '") {
        return true;
    }
    line.split_once("Unable to create '")
        .and_then(|(_, rest)| rest.split_once(".lock': File exists"))
        .is_some_and(|(path, _)| !path.ends_with("index"))
}

/// A path as git prints it, without the C-style quoting `core.quotePath` adds to one holding a
/// quote, a backslash, a control character or a non-ASCII byte.
fn unquote(path: &str) -> String {
    let Some(inner) = path.strip_prefix('"').and_then(|p| p.strip_suffix('"')) else {
        return path.to_string();
    };
    let mut bytes = Vec::with_capacity(inner.len());
    let mut chars = inner.bytes().peekable();
    while let Some(b) = chars.next() {
        if b != b'\\' {
            bytes.push(b);
            continue;
        }
        match chars.next() {
            Some(b'n') => bytes.push(b'\n'),
            Some(b't') => bytes.push(b'\t'),
            Some(d @ b'0'..=b'7') => {
                let mut value = u32::from(d - b'0');
                for _ in 0..2 {
                    match chars.peek() {
                        Some(&o @ b'0'..=b'7') => {
                            value = value * 8 + u32::from(o - b'0');
                            chars.next();
                        }
                        _ => break,
                    }
                }
                bytes.push(value as u8);
            }
            Some(other) => bytes.push(other),
            None => bytes.push(b'\\'),
        }
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

/// [`GitError::InvalidRefName`] for `name`.
pub(super) fn invalid_ref(name: &str) -> GitError {
    GitError::InvalidRefName { name: name.to_string() }
}

/// Refuses `name`, a ref or commit argument, when it is empty or starts with `-`, before any git
/// command sees it.
pub(super) fn refuse_option_like(name: &str) -> Result<(), GitError> {
    if name.is_empty() || name.starts_with('-') {
        return Err(invalid_ref(name));
    }
    Ok(())
}

/// The full oid of the commit `at` names, from `rev-parse --verify`, which reads `at` after
/// `--end-of-options` so it can never be taken for an option. Refuses anything that isn't a commit.
pub(super) fn resolve_commit(worktree: &Path, at: &str) -> Result<String, GitError> {
    refuse_option_like(at)?;
    let spec = format!("{at}^{{commit}}");
    read_git(worktree, &["rev-parse", "--verify", "--quiet", "--end-of-options", &spec])?
        .map(|out| String::from_utf8_lossy(&out).trim().to_string())
        .filter(|oid| !oid.is_empty())
        .ok_or_else(|| invalid_ref(at))
}

/// Refuses `name` unless `git check-ref-format --branch` accepts it as it is. That rejects a name
/// starting with `-`, so it can never read as an option, and one it would expand, such as `@{-1}`.
pub fn check_branch_name(worktree: &Path, name: &str) -> Result<(), GitError> {
    refuse_option_like(name)?;
    let printed = read_git(worktree, &["check-ref-format", "--branch", name])?.ok_or_else(|| invalid_ref(name))?;
    if String::from_utf8_lossy(&printed).trim_end_matches(['\r', '\n']) != name {
        return Err(invalid_ref(name));
    }
    Ok(())
}

/// The full name of the remote-tracking branch `name`, such as `refs/remotes/origin/topic`, once
/// `check-ref-format` accepts it and it exists.
fn remote_ref(worktree: &Path, name: &str) -> Result<String, GitError> {
    refuse_option_like(name)?;
    let full = format!("refs/remotes/{name}");
    if read_git(worktree, &["check-ref-format", &full])?.is_none() {
        return Err(invalid_ref(name));
    }
    read_git(worktree, &["rev-parse", "--verify", "--quiet", "--end-of-options", &full])?.ok_or_else(|| invalid_ref(name))?;
    Ok(full)
}

/// The local branch whose upstream is `remote_ref`, a full `refs/remotes/...` name. With several,
/// the one named like the remote branch wins, then the first by name.
fn tracking_branch(worktree: &Path, remote_ref: &str) -> Result<Option<String>, GitError> {
    let out = read_git(worktree, &["for-each-ref", "--format=%(refname:strip=2)%00%(upstream)", "refs/heads"])?.unwrap_or_default();
    let text = String::from_utf8_lossy(&out);
    let short = remote_ref.rsplit_once('/').map_or(remote_ref, |(_, b)| b);
    let mut found: Vec<&str> = text
        .lines()
        .filter_map(|line| line.split_once('\0'))
        .filter(|(_, upstream)| *upstream == remote_ref)
        .map(|(name, _)| name)
        .collect();
    found.sort_by_key(|name| (*name != short, *name));
    Ok(found.first().map(|name| name.to_string()))
}

/// The local branch name a tracking branch for the remote branch `name`, such as `origin/topic`,
/// gets: `name` without its remote. Remote names can hold `/`, so the longest that prefixes `name`
/// is taken.
fn local_name_for(worktree: &Path, name: &str) -> Result<String, GitError> {
    let out = read_git(worktree, &["remote"])?.unwrap_or_default();
    let remotes = String::from_utf8_lossy(&out);
    remotes
        .lines()
        .filter_map(|remote| name.strip_prefix(remote).and_then(|rest| rest.strip_prefix('/')))
        .filter(|rest| !rest.is_empty())
        .min_by_key(|rest| rest.len())
        .map(str::to_string)
        .ok_or_else(|| GitError::Other { stderr: format!("{name} names no remote") })
}

/// HEAD and the refs of `worktree`, read after a write.
pub(super) fn outcome(worktree: &Path) -> Result<RefsOutcome, GitError> {
    Ok(RefsOutcome { head: head_oid(worktree).ok(), refs: read_refs(worktree)? })
}

/// Checks out `target` in `worktree` with `git switch`, as the cancellable op `op_id` in the
/// worktree's staging slot.
pub fn checkout(
    ops: &GitOps,
    locks: &StagingLocks,
    worktree: &Path,
    op_id: Uuid,
    target: &CheckoutTarget,
    channel: &Channel<OpEvent>,
) -> Result<RefsOutcome, GitError> {
    ops.run_with(op_id, channel, |cancel| {
        let _slot = locks.begin(worktree)?;
        match target {
            CheckoutTarget::Branch { name } => {
                check_branch_name(worktree, name)?;
                // `--no-guess`: a branch target is a local branch, never one made from a remote's.
                run_git(worktree, &["switch", "--no-guess", "--", name], cancel, channel)?;
            }
            CheckoutTarget::Remote { name } => {
                let full = remote_ref(worktree, name)?;
                match tracking_branch(worktree, &full)? {
                    Some(local) => {
                        run_git(worktree, &["switch", "--no-guess", "--", &local], cancel, channel)?;
                    }
                    None => {
                        let local = local_name_for(worktree, name)?;
                        check_branch_name(worktree, &local)?;
                        run_git(worktree, &["switch", "--track", "-c", &local, "--", &full], cancel, channel)?;
                    }
                }
            }
            CheckoutTarget::Detached { at } => {
                let oid = resolve_commit(worktree, at)?;
                run_git(worktree, &["switch", "--detach", "--", &oid], cancel, channel)?;
            }
        }
        outcome(worktree)
    })
}

/// A branch to create: `name`, at the commit `at`, switched to when `checkout` is set.
#[derive(Debug, Clone, Copy)]
pub struct NewBranch<'a> {
    pub name: &'a str,
    pub at: &'a str,
    pub checkout: bool,
}

/// Creates the branch `branch.name` at the commit `branch.at` in `worktree`'s repo, and with
/// `branch.checkout` switches `worktree` to it, as the cancellable op `op_id` in the worktree's
/// staging slot.
pub fn branch_create(
    ops: &GitOps,
    locks: &StagingLocks,
    worktree: &Path,
    op_id: Uuid,
    branch: NewBranch<'_>,
    channel: &Channel<OpEvent>,
) -> Result<RefsOutcome, GitError> {
    let NewBranch { name, at, checkout } = branch;
    ops.run_with(op_id, channel, |cancel| {
        let _slot = locks.begin(worktree)?;
        check_branch_name(worktree, name)?;
        let oid = resolve_commit(worktree, at)?;
        if checkout {
            run_git(worktree, &["switch", "-c", name, "--", &oid], cancel, channel)?;
        } else {
            run_git(worktree, &["branch", "--", name, &oid], cancel, channel)?;
        }
        outcome(worktree)
    })
}

/// Checks out `target` in `worktree_path` as op `op_id`, which `git_op_cancel` stops while a
/// `post-checkout` hook runs. See [`checkout`]. An `opId` that isn't a UUID, or a target that
/// isn't one of the three, is rejected before this runs.
#[tauri::command]
pub async fn git_checkout(
    worktree_path: String,
    target: CheckoutTarget,
    op_id: Uuid,
    on_event: Channel<OpEvent>,
    app: tauri::AppHandle,
) -> Result<RefsOutcome, GitError> {
    in_background(app, "check out", move |ops, locks| checkout(ops, locks, Path::new(&worktree_path), op_id, &target, &on_event)).await
}

/// Creates the branch `name` at `at` in `worktree_path`'s repo, checking it out there with
/// `checkout`, as op `op_id`. See [`branch_create`].
#[tauri::command]
pub async fn git_branch_create(
    worktree_path: String,
    name: String,
    at: String,
    checkout: bool,
    op_id: Uuid,
    on_event: Channel<OpEvent>,
    app: tauri::AppHandle,
) -> Result<RefsOutcome, GitError> {
    in_background(app, "create the branch", move |ops, locks| {
        branch_create(ops, locks, Path::new(&worktree_path), op_id, NewBranch { name: &name, at: &at, checkout }, &on_event)
    })
    .await
}
