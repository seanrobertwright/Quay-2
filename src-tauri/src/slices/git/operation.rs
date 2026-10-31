//! The operation banner's backend (#352, #389). [`read_operation_state`] reads which merge, rebase,
//! cherry-pick or revert is under way in a worktree from its state files, names both sides by
//! their role and real ref, and lists the conflicts left.

use std::io::Read;
use std::path::{Path, PathBuf};

use serde::Serialize;

use super::commit::{MAX_MESSAGE_BYTES, Operation, read_git};
use super::error::GitError;
use super::staging::STATUS_CAP;

/// One side of a conflict: its role in the operation, such as `HEAD` or `Onto`, and the real
/// branch, commit or subject. The banner shows `role · name`; git's "ours" and "theirs" are
/// left to its tooltips. Both are untrusted text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SideLabel {
    pub role: String,
    pub name: String,
}

/// How a path's unmerged stages came about, from which of stages 1 (base), 2 (left) and 3 (right)
/// it has, as `git status` names them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ConflictKind {
    /// `UU`: changed on both sides.
    BothModified,
    /// `AA`: added on both sides.
    BothAdded,
    /// `UD`: changed on the left, deleted on the right.
    DeletedByThem,
    /// `DU`: deleted on the left, changed on the right.
    DeletedByUs,
    /// `AU`: added on the left only.
    AddedByUs,
    /// `UA`: added on the right only.
    AddedByThem,
    /// `DD`: deleted on both sides of a rename.
    BothDeleted,
}

/// A path with unmerged stages.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Conflict {
    /// Relative to the worktree root, with `/` separators.
    pub path: String,
    /// git's two status letters for it, such as `UU`.
    pub xy: String,
    pub kind: ConflictKind,
}

/// The operation under way in a worktree, as the banner shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpState {
    pub kind: Operation,
    /// For a rebase, the step it stopped at, counting from 1, and how many there are.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<u32>,
    /// Stage 2, git's "ours". None with no operation.
    pub left_label: Option<SideLabel>,
    /// Stage 3, git's "theirs". None with no operation.
    pub right_label: Option<SideLabel>,
    /// The message Continue commits, from the file git takes it from, without comment lines.
    /// None when there is no such file.
    pub message: Option<String>,
    /// At most [`STATUS_CAP`] conflicts, in git's order. They can exist with no operation, after a
    /// conflicted `git stash pop` for one.
    pub conflicts: Vec<Conflict>,
    /// Every conflict, including those past the cap.
    pub conflicts_total: u32,
}

/// The worktree's own git dir, which holds its operation's state files.
pub(super) fn git_dir(worktree: &Path) -> Result<PathBuf, GitError> {
    read_git(worktree, &["rev-parse", "--absolute-git-dir"])?
        .map(|out| PathBuf::from(String::from_utf8_lossy(&out).trim()))
        .ok_or_else(|| GitError::Other {
            stderr: format!("{} is not a git worktree", worktree.display()),
        })
}

/// The operation `git_dir`'s state files say is under way.
pub(super) fn detect_operation(git_dir: &Path) -> Operation {
    if rebase_dir(git_dir).is_some() {
        Operation::Rebase
    } else if git_dir.join("CHERRY_PICK_HEAD").is_file() {
        Operation::CherryPick
    } else if git_dir.join("REVERT_HEAD").is_file() {
        Operation::Revert
    } else if git_dir.join("MERGE_HEAD").is_file() {
        Operation::Merge
    } else {
        sequencer_next(git_dir).map_or(Operation::None, |(operation, _)| operation)
    }
}

/// The command and commit on the first line of `sequencer/todo`, which a cherry-pick or revert of
/// several commits keeps while it waits for `--continue`, even once its `*_HEAD` file is gone.
fn sequencer_next(git_dir: &Path) -> Option<(Operation, String)> {
    let todo = std::fs::read_to_string(git_dir.join("sequencer").join("todo")).ok()?;
    let mut words = todo.lines().find(|l| !l.trim().is_empty() && !l.starts_with('#'))?.split_whitespace();
    let operation = match words.next()? {
        "pick" | "p" => Operation::CherryPick,
        "revert" => Operation::Revert,
        _ => return None,
    };
    Some((operation, words.next()?.to_string()))
}

/// The state folder of the rebase under way: `rebase-merge` for the default backend and `-i`,
/// `rebase-apply` for `--apply`. A `git am`, which also uses `rebase-apply`, isn't a rebase.
fn rebase_dir(git_dir: &Path) -> Option<PathBuf> {
    let merge = git_dir.join("rebase-merge");
    if merge.is_dir() {
        return Some(merge);
    }
    let apply = git_dir.join("rebase-apply");
    (apply.is_dir() && !apply.join("applying").exists()).then_some(apply)
}

/// The number in the state file `name` under `dir`, or None when it is missing or not a number.
fn state_number(dir: &Path, name: &str) -> Option<u32> {
    std::fs::read_to_string(dir.join(name))
        .ok()?
        .trim()
        .parse()
        .ok()
}

/// The subject of commit `oid`, or its short oid when it can't be read.
fn subject(worktree: &Path, oid: &str) -> Result<String, GitError> {
    Ok(
        read_line(worktree, &["log", "-1", "--format=%s", oid, "--"])?
            .unwrap_or_else(|| short(oid).to_string()),
    )
}

/// What `git <args>` printed, trimmed, or None when it failed or printed nothing.
fn read_line(worktree: &Path, args: &[&str]) -> Result<Option<String>, GitError> {
    Ok(read_git(worktree, args)?
        .map(|out| String::from_utf8_lossy(&out).trim().to_string())
        .filter(|s| !s.is_empty()))
}

/// The first oid in the state file `name` under `git_dir`, or None when it is missing.
fn state_oid(git_dir: &Path, name: &str) -> Option<String> {
    let text = std::fs::read_to_string(git_dir.join(name)).ok()?;
    text.split_whitespace().next().map(str::to_string)
}

/// The first 7 characters of `oid`.
fn short(oid: &str) -> &str {
    &oid[..oid.len().min(7)]
}

/// A branch, remote-tracking branch or tag at `oid`, preferring a local branch.
fn ref_at(worktree: &Path, oid: &str) -> Result<Option<String>, GitError> {
    for namespace in ["refs/heads", "refs/remotes", "refs/tags"] {
        let found = read_line(
            worktree,
            &[
                "for-each-ref",
                "--count=1",
                "--format=%(refname:short)",
                "--points-at",
                oid,
                namespace,
            ],
        )?;
        if found.is_some() {
            return Ok(found);
        }
    }
    Ok(None)
}

/// The branch HEAD is on, or HEAD's short oid when it is detached.
fn head_name(worktree: &Path) -> Result<String, GitError> {
    if let Some(branch) = read_line(worktree, &["symbolic-ref", "--quiet", "--short", "HEAD"])? {
        return Ok(branch);
    }
    Ok(read_line(worktree, &["rev-parse", "--short", "HEAD"])?.unwrap_or_else(|| "HEAD".into()))
}

/// The comment character git strips from messages: `core.commentChar` when it is one character.
fn comment_char(worktree: &Path) -> Result<char, GitError> {
    Ok(
        read_line(worktree, &["config", "--get", "core.commentChar"])?
            .and_then(|value| {
                let mut chars = value.chars();
                chars.next().filter(|_| chars.next().is_none())
            })
            .unwrap_or('#'),
    )
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

/// The message file at `path`, at most [`MAX_MESSAGE_BYTES`] of it, without comment lines, or
/// None when it is missing.
pub(super) fn read_message_file(worktree: &Path, path: &Path) -> Result<Option<String>, GitError> {
    let Ok(file) = std::fs::File::open(path) else {
        return Ok(None);
    };
    let mut bytes = Vec::new();
    let _ = file.take(MAX_MESSAGE_BYTES as u64).read_to_end(&mut bytes);
    Ok(Some(strip_comments(
        &String::from_utf8_lossy(&bytes),
        comment_char(worktree)?,
    )))
}

/// The conflict an unmerged path with these stages is, and its status letters.
fn conflict_kind(base: bool, left: bool, right: bool) -> (ConflictKind, &'static str) {
    match (base, left, right) {
        (true, true, true) => (ConflictKind::BothModified, "UU"),
        (false, true, true) => (ConflictKind::BothAdded, "AA"),
        (true, true, false) => (ConflictKind::DeletedByThem, "UD"),
        (true, false, true) => (ConflictKind::DeletedByUs, "DU"),
        (false, true, false) => (ConflictKind::AddedByUs, "AU"),
        (false, false, true) => (ConflictKind::AddedByThem, "UA"),
        _ => (ConflictKind::BothDeleted, "DD"),
    }
}

/// The unmerged paths of `worktree`'s index, from `git ls-files -u -z`: the first
/// [`STATUS_CAP`], and how many there are.
fn read_conflicts(worktree: &Path) -> Result<(Vec<Conflict>, u32), GitError> {
    let out =
        read_git(worktree, &["--no-optional-locks", "ls-files", "-u", "-z"])?.ok_or_else(|| {
            GitError::Other {
                stderr: "could not list the unmerged paths".into(),
            }
        })?;
    let mut conflicts = Vec::new();
    let mut total = 0u32;
    let mut push = |path: String, [base, left, right]: [bool; 3], conflicts: &mut Vec<Conflict>| {
        total += 1;
        if conflicts.len() < STATUS_CAP {
            let (kind, xy) = conflict_kind(base, left, right);
            conflicts.push(Conflict {
                path,
                xy: xy.into(),
                kind,
            });
        }
    };
    // One record per stage, `mode oid stage\tpath`, with a path's stages in a row.
    let mut current: Option<(String, [bool; 3])> = None;
    for record in out.split(|b| *b == 0).filter(|r| !r.is_empty()) {
        let text = String::from_utf8_lossy(record);
        let Some((meta, path)) = text.split_once('\t') else {
            continue;
        };
        let Some(stage) = meta
            .rsplit(' ')
            .next()
            .and_then(|s| s.parse::<usize>().ok())
            .filter(|s| (1..=3).contains(s))
        else {
            continue;
        };
        if current.as_ref().is_none_or(|(p, _)| p != path) {
            if let Some((p, stages)) = current.take() {
                push(p, stages, &mut conflicts);
            }
            current = Some((path.to_string(), [false; 3]));
        }
        if let Some((_, stages)) = current.as_mut() {
            stages[stage - 1] = true;
        }
    }
    if let Some((p, stages)) = current {
        push(p, stages, &mut conflicts);
    }
    Ok((conflicts, total))
}

/// Reads the operation under way in `worktree` (#352): which one its state files name, both sides'
/// labels, the step a rebase is at, the message Continue would commit, and the conflicts left.
pub fn read_operation_state(worktree: &Path) -> Result<OpState, GitError> {
    let git_dir = git_dir(worktree)?;
    let kind = detect_operation(&git_dir);
    let (conflicts, conflicts_total) = read_conflicts(worktree)?;
    let mut state = OpState {
        kind,
        step: None,
        total: None,
        left_label: None,
        right_label: None,
        message: None,
        conflicts,
        conflicts_total,
    };
    let label = |role: &str, name: String| {
        Some(SideLabel {
            role: role.into(),
            name,
        })
    };
    match kind {
        Operation::None => {}
        Operation::Merge => {
            let incoming = match state_oid(&git_dir, "MERGE_HEAD") {
                Some(oid) => ref_at(worktree, &oid)?.unwrap_or_else(|| short(&oid).to_string()),
                None => String::new(),
            };
            state.left_label = label("HEAD", head_name(worktree)?);
            state.right_label = label("Incoming", incoming);
            state.message = read_message_file(worktree, &git_dir.join("MERGE_MSG"))?;
        }
        Operation::Rebase => {
            let Some(dir) = rebase_dir(&git_dir) else {
                return Ok(state);
            };
            let merge_backend = dir.ends_with("rebase-merge");
            let (step, total) = if merge_backend {
                ("msgnum", "end")
            } else {
                ("next", "last")
            };
            state.step = state_number(&dir, step);
            state.total = state_number(&dir, total);
            let onto = match state_oid(&dir, "onto") {
                Some(oid) => match ref_at(worktree, &oid)? {
                    Some(name) => format!("{name} @{}", short(&oid)),
                    None => short(&oid).to_string(),
                },
                None => String::new(),
            };
            // REBASE_HEAD names the commit a stopped step replays; an older stop leaves `stopped-sha`.
            let replaying = match state_oid(&git_dir, "REBASE_HEAD")
                .or_else(|| state_oid(&dir, "stopped-sha"))
            {
                Some(oid) => subject(worktree, &oid)?,
                None => String::new(),
            };
            state.left_label = label("Onto", onto);
            state.right_label = label("Replaying", replaying);
            if merge_backend {
                state.message = read_message_file(worktree, &dir.join("message"))?;
            }
        }
        Operation::CherryPick | Operation::Revert => {
            let (head_file, role) =
                if kind == Operation::CherryPick { ("CHERRY_PICK_HEAD", "Picking") } else { ("REVERT_HEAD", "Reverting") };
            let commit = match state_oid(&git_dir, head_file).or_else(|| sequencer_next(&git_dir).map(|(_, oid)| oid)) {
                Some(oid) => subject(worktree, &oid)?,
                None => String::new(),
            };
            state.left_label = label("HEAD", head_name(worktree)?);
            state.right_label = label(role, commit);
            state.message = read_message_file(worktree, &git_dir.join("MERGE_MSG"))?;
        }
    }
    Ok(state)
}
