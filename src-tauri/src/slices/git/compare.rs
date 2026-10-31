//! Comparing two commits for Topos's details mode (#368, #398): which of the pair is the older,
//! and the tree diff from one to the other.

use std::path::Path;
use std::process::Stdio;

use serde::Serialize;

use super::details::{parse_files, resolve_commit_oid, CommitFiles, MAX_COMMIT_FILES};
use super::diff::{other, run_read};
use super::error::GitError;
use super::staging::worktree_git;

/// A compared pair in the order the rule puts it: the older commit first.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareOrder {
    pub older: String,
    pub newer: String,
}

/// The files that differ from one commit to another, in [`CommitFiles`]'s shape and under its cap,
/// with the number of commits between them when one is an ancestor of the other.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareFiles {
    #[serde(flatten)]
    pub files: CommitFiles,
    /// The commits reachable from the descendant and not from the ancestor, or None when neither
    /// commit is an ancestor of the other.
    pub ahead: Option<u32>,
}

/// Whether `ancestor` is an ancestor of `descendant` (or the same commit), by
/// `git merge-base --is-ancestor`, which exits 0 for yes and 1 for no. Both are full oids.
fn is_ancestor(repo: &Path, ancestor: &str, descendant: &str) -> Result<bool, GitError> {
    let out = worktree_git(repo)
        .args(["merge-base", "--is-ancestor", ancestor, descendant])
        .stdin(Stdio::null())
        .output()
        .map_err(|e| other(format!("could not run git: {e}")))?;
    match out.status.code() {
        Some(0) => Ok(true),
        Some(1) => Ok(false),
        _ => Err(other(String::from_utf8_lossy(&out.stderr).trim().to_string())),
    }
}

/// `oid`'s committer date in seconds since the epoch.
fn committer_seconds(repo: &Path, oid: &str) -> Result<i64, GitError> {
    let out = run_read(repo, ["log", "-1", "--format=%ct", oid, "--"])?;
    let text = String::from_utf8_lossy(&out);
    text.trim().parse::<i64>().map_err(|_| other(format!("git printed a commit time that is not a number: {:?}", text.trim())))
}

/// Which of `a` and `b` in `repo` is the older (#368): the ancestor when one is an ancestor of the
/// other, otherwise the one with the earlier committer date. A tie in date keeps the lower oid
/// first, so the answer never depends on the argument order. Each oid is checked as
/// [`resolve_commit_oid`] checks it, and the answer carries the full oids.
pub fn compare_order(repo: &Path, a: &str, b: &str) -> Result<CompareOrder, GitError> {
    let a = resolve_commit_oid(repo, a)?;
    let b = resolve_commit_oid(repo, b)?;
    let a_first = if is_ancestor(repo, &a, &b)? {
        true
    } else if is_ancestor(repo, &b, &a)? {
        false
    } else {
        (committer_seconds(repo, &a)?, a.as_str()) <= (committer_seconds(repo, &b)?, b.as_str())
    };
    Ok(if a_first { CompareOrder { older: a, newer: b } } else { CompareOrder { older: b, newer: a } })
}

/// The files that differ from `from` to `to` in `repo` (#398), by `diff-tree -r -z -M` with
/// `--raw --numstat`, in [`super::details::commit_files`]'s shape and under its cap. The diff runs
/// in the order given, so swapping the arguments reverses it. `ahead` counts the commits from the
/// ancestor to the descendant when one is an ancestor of the other, in either order. Each oid is
/// checked as [`resolve_commit_oid`] checks it and goes to git as its own argument.
pub fn compare_files(repo: &Path, from: &str, to: &str) -> Result<CompareFiles, GitError> {
    let from = resolve_commit_oid(repo, from)?;
    let to = resolve_commit_oid(repo, to)?;
    let out = run_read(
        repo,
        ["diff-tree", "-r", "-z", "-M", "--raw", "--numstat", "--no-commit-id", "--no-ext-diff", from.as_str(), to.as_str()],
    )?;
    let files = parse_files(&out, MAX_COMMIT_FILES)?;
    let span = if is_ancestor(repo, &from, &to)? {
        Some((from.as_str(), to.as_str()))
    } else if is_ancestor(repo, &to, &from)? {
        Some((to.as_str(), from.as_str()))
    } else {
        None
    };
    let ahead = match span {
        Some((ancestor, descendant)) => {
            let range = format!("{ancestor}..{descendant}");
            let out = run_read(repo, ["rev-list", "--count", range.as_str(), "--"])?;
            let text = String::from_utf8_lossy(&out);
            Some(text.trim().parse::<u32>().map_err(|_| other(format!("git printed a commit count that is not a number: {:?}", text.trim())))?)
        }
        None => None,
    };
    Ok(CompareFiles { files, ahead })
}

/// Which of `a` and `b` is the older. See [`compare_order`].
#[tauri::command]
pub async fn git_compare_order(repo_path: String, a: String, b: String) -> Result<CompareOrder, GitError> {
    tokio::task::spawn_blocking(move || compare_order(Path::new(&repo_path), &a, &b))
        .await
        .map_err(|e| other(format!("could not order the commits: {e}")))?
}

/// The files that differ from `a` to `b`. See [`compare_files`].
#[tauri::command]
pub async fn git_compare_files(repo_path: String, a: String, b: String) -> Result<CompareFiles, GitError> {
    tokio::task::spawn_blocking(move || compare_files(Path::new(&repo_path), &a, &b))
        .await
        .map_err(|e| other(format!("could not compare the commits: {e}")))?
}
