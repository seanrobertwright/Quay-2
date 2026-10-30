//! The ref badges, worktree HEADs and tag-only count `git_refs` returns (#378), read with
//! `for-each-ref` apart from the graph's `git log`.

use std::path::Path;

use serde::Serialize;

use super::super::error::GitError;
use super::refs::{repo_git, track_key};

/// What kind of ref a badge names.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RefKind {
    Local,
    Remote,
    Tag,
}

/// A ref badge: a branch, remote-tracking branch or tag, at the commit it names.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefBadge {
    pub kind: RefKind,
    /// `main`, `origin/main` or `v1.0`: the ref name without `refs/heads/`, `refs/remotes/` or `refs/tags/`.
    pub name: String,
    /// The commit the badge sits on; an annotated tag's is the commit its tag object points at.
    pub oid: String,
}

/// Where a worktree's HEAD is.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeHead {
    /// The worktree's folder as `git worktree list` prints it.
    pub path: String,
    pub oid: String,
    /// The branch checked out there, or None for a detached HEAD.
    pub branch: Option<String>,
}

/// What `git_refs` returns.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRefs {
    pub refs: Vec<RefBadge>,
    pub worktrees: Vec<WorktreeHead>,
    /// Commits reachable from a tag and from nothing the graph walks, which the graph leaves out.
    pub tag_only_count: u32,
}

/// Runs `git -C repo args` headless and returns its stdout, or git's stderr as the error.
fn git_output(repo: &Path, args: &[&str]) -> Result<String, GitError> {
    let out = repo_git(repo)
        .args(args)
        .output()
        .map_err(|e| GitError::Other { stderr: format!("could not run git: {e}") })?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(GitError::Other { stderr: if stderr.is_empty() { format!("git {} failed", args[0]) } else { stderr } });
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Reads `for-each-ref` output in the format [`read_refs`] asks for: object, peeled object and ref
/// name, NUL-separated, one ref per line.
fn parse_badges(output: &str) -> Vec<RefBadge> {
    let mut badges = Vec::new();
    for line in output.lines() {
        let mut fields = line.split('\0');
        let (Some(oid), Some(peeled), Some(refname)) = (fields.next(), fields.next(), fields.next()) else {
            continue;
        };
        let (kind, name) = if let Some(name) = refname.strip_prefix("refs/heads/") {
            (RefKind::Local, name)
        } else if let Some(name) = refname.strip_prefix("refs/tags/") {
            (RefKind::Tag, name)
        } else if let Some(name) = refname.strip_prefix("refs/remotes/") {
            // `<remote>/HEAD` names what the remote calls its default branch; it is never a branch.
            if track_key(refname).is_none() {
                continue;
            }
            (RefKind::Remote, name)
        } else {
            continue;
        };
        if name.is_empty() {
            continue;
        }
        let oid = if peeled.is_empty() { oid } else { peeled };
        badges.push(RefBadge { kind, name: name.to_string(), oid: oid.to_string() });
    }
    badges
}

/// Reads `git worktree list --porcelain -z`: each worktree's attributes end in NUL, and an empty
/// field ends the worktree. A bare entry, or one whose HEAD is unborn, has no HEAD to mark.
fn parse_worktree_heads(output: &str) -> Vec<WorktreeHead> {
    let mut heads = Vec::new();
    let (mut path, mut oid, mut branch) = (None::<&str>, None::<&str>, None::<&str>);
    for field in output.split('\0') {
        if field.is_empty() {
            if let (Some(path), Some(oid)) = (path.take(), oid.take()) {
                if !oid.bytes().all(|b| b == b'0') {
                    let branch = branch.map(|b| b.strip_prefix("refs/heads/").unwrap_or(b).to_string());
                    heads.push(WorktreeHead { path: path.to_string(), oid: oid.to_string(), branch });
                }
            }
            (path, oid, branch) = (None, None, None);
        } else if let Some(p) = field.strip_prefix("worktree ") {
            path = Some(p);
        } else if let Some(h) = field.strip_prefix("HEAD ") {
            oid = Some(h);
        } else if let Some(b) = field.strip_prefix("branch ") {
            branch = Some(b);
        }
    }
    heads
}

/// Reads the refs, worktree HEADs and tag-only count of `repo`.
pub fn read_refs(repo: &Path) -> Result<GitRefs, GitError> {
    if !repo.is_absolute() || !repo.is_dir() {
        return Err(GitError::Other { stderr: format!("{} is not a folder", repo.display()) });
    }
    let refs = parse_badges(&git_output(
        repo,
        &["for-each-ref", "--format=%(objectname)%00%(*objectname)%00%(refname)", "refs/heads", "refs/remotes", "refs/tags"],
    )?);
    let worktrees = parse_worktree_heads(&git_output(repo, &["worktree", "list", "--porcelain", "-z"])?);
    let tag_only_count = if refs.iter().any(|r| r.kind == RefKind::Tag) { count_tag_only(repo)? } else { 0 };
    Ok(GitRefs { refs, worktrees, tag_only_count })
}

/// Counts the commits a tag reaches that the graph's rev set (#370), `--branches --remotes HEAD`,
/// does not. A repo whose HEAD is unborn walks without `HEAD`, as the graph does.
fn count_tag_only(repo: &Path) -> Result<u32, GitError> {
    let mut args = vec!["rev-list", "--count", "--tags", "--not", "--branches", "--remotes"];
    if super::session::head_is_born(repo) {
        args.push("HEAD");
    }
    args.push("--");
    let out = git_output(repo, &args)?;
    out.trim().parse().map_err(|_| GitError::Other { stderr: format!("git rev-list printed {:?} where a count belongs", out.trim()) })
}
