//! Whether one file has uncommitted changes, for a link that opens its diff (#721).

use std::path::Path;

use serde::{Deserialize, Serialize};

use super::staging::{parse_rel_path, worktree_git};

/// Which of the staging lists a file's change is in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ChangeSide {
    Unstaged,
    Staged,
}

/// A file's uncommitted change, as the diff view opens it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileChange {
    /// Relative to the worktree root, with `/` separators.
    pub path: String,
    pub side: ChangeSide,
}

/// `file`'s uncommitted change in the worktree whose root `folder` is, the unstaged one first. `None`
/// when it has none, when it is conflicted, ignored or no file, when `folder` is not a worktree's
/// root, and when git cannot be run.
pub fn file_change(folder: &Path, file: &Path) -> Option<FileChange> {
    if !is_worktree_root(folder) {
        return None;
    }
    // As the file system spells them, since git tells names of another case apart
    let (folder, file) = (folder.canonicalize().ok()?, file.canonicalize().ok()?);
    if !file.is_file() {
        return None;
    }
    let names: Option<Vec<&str>> = file.strip_prefix(&folder).ok()?.iter().map(|name| name.to_str()).collect();
    let path = names?.join("/");
    parse_rel_path(&path).ok()?;
    let status = worktree_git(&folder)
        .args(["--no-optional-locks", "status", "--porcelain=v2", "-z", "--no-renames", "-uall", "--", &path])
        .output()
        .ok()
        .filter(|output| output.status.success())?;
    let side = side_of(&String::from_utf8_lossy(&status.stdout))?;
    Some(FileChange { path, side })
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
    let mut letters = record.strip_prefix("1 ")?.chars();
    match (letters.next()?, letters.next()?) {
        (_, unstaged) if unstaged != '.' => Some(ChangeSide::Unstaged),
        (staged, _) if staged != '.' => Some(ChangeSide::Staged),
        _ => None,
    }
}
