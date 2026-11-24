//! Whether one file has uncommitted changes, for a link that opens its diff (#721).

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::commands::{comparable_path, parse_worktree_porcelain};
use super::staging::{parse_rel_path, worktree_git};

/// Which of Topos's lists a file's change is in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ChangeSide {
    Unstaged,
    Staged,
    Conflicted,
}

/// A file's uncommitted change, as the diff view opens it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileChange {
    /// The root of the worktree the file is in.
    pub worktree: String,
    /// Relative to that root, with `/` separators.
    pub path: String,
    pub side: ChangeSide,
}

/// `file`'s uncommitted change, the unstaged one before the staged one. `None` when it has none, when
/// it is ignored or no file, when git cannot be run, and when it is in no worktree of a repository
/// that one of `folders` is in.
///
/// git runs programs a repository's own settings name, so it is run only in those repositories.
pub fn file_change(folders: &[PathBuf], file: &Path) -> Option<FileChange> {
    // As the file system spells it, since git tells names of another case apart
    let file = file.canonicalize().ok()?;
    if !file.is_file() {
        return None;
    }
    let root = root_above(&file)?;
    let worktree = worktree_at(root, folders)?;
    if !is_worktree_root(&worktree) {
        return None;
    }
    let names: Option<Vec<&str>> = file.strip_prefix(root).ok()?.iter().map(|name| name.to_str()).collect();
    let path = names?.join("/");
    parse_rel_path(&path).ok()?;
    let status = worktree_git(&worktree)
        .args(["--no-optional-locks", "status", "--porcelain=v2", "-z", "--no-renames", "-uall", "--", &path])
        .output()
        .ok()
        .filter(|output| output.status.success())?;
    let side = side_of(&String::from_utf8_lossy(&status.stdout))?;
    Some(FileChange { worktree: worktree.to_str()?.to_string(), path, side })
}

/// The nearest folder at or above `path` that is a worktree's root, told without running git.
fn root_above(path: &Path) -> Option<&Path> {
    path.ancestors().find(|folder| folder.join(".git").symlink_metadata().is_ok())
}

/// The worktree whose root is `root`, as Quay or git spells it, when a repository that one of
/// `folders` is in has it.
fn worktree_at(root: &Path, folders: &[PathBuf]) -> Option<PathBuf> {
    let wanted = comparable_path(root.to_str()?);
    let is_root = |path: &str| comparable_path(path) == wanted;
    let mut own: Vec<&Path> = folders.iter().filter_map(|folder| root_above(folder)).collect();
    own.dedup();
    if let Some(worktree) = own.iter().find(|own| own.to_str().is_some_and(is_root)) {
        return Some(worktree.to_path_buf());
    }
    // Of two worktrees of one repository, one at least is a linked one
    own.into_iter()
        .filter(|own| is_linked(root) || is_linked(own))
        .flat_map(worktrees_of)
        .find(|worktree| is_root(worktree))
        .map(PathBuf::from)
}

/// Whether `root` is a linked worktree's or a submodule's, whose `.git` is a file.
fn is_linked(root: &Path) -> bool {
    root.join(".git").symlink_metadata().is_ok_and(|git| git.is_file())
}

/// The roots of every worktree of the repository whose worktree `root` is.
fn worktrees_of(root: &Path) -> Vec<String> {
    let listed = worktree_git(root).args(["worktree", "list", "--porcelain"]).output();
    let printed = listed.ok().filter(|output| output.status.success()).map(|output| output.stdout).unwrap_or_default();
    parse_worktree_porcelain(&String::from_utf8_lossy(&printed)).into_iter().map(|worktree| worktree.path).collect()
}

fn is_worktree_root(folder: &Path) -> bool {
    let root = worktree_git(folder).args(["rev-parse", "--is-inside-work-tree", "--show-prefix"]).output();
    root.is_ok_and(|output| output.status.success() && String::from_utf8_lossy(&output.stdout).split_whitespace().eq(["true"]))
}

/// The list one `--porcelain=v2` record is in. `1 XY …` is tracked, with `.` for unchanged.
fn side_of(record: &str) -> Option<ChangeSide> {
    if record.starts_with("? ") {
        return Some(ChangeSide::Unstaged);
    }
    if record.starts_with("u ") {
        return Some(ChangeSide::Conflicted);
    }
    let mut letters = record.strip_prefix("1 ")?.chars();
    match (letters.next()?, letters.next()?) {
        (_, unstaged) if unstaged != '.' => Some(ChangeSide::Unstaged),
        (staged, _) if staged != '.' => Some(ChangeSide::Staged),
        _ => None,
    }
}
