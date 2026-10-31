//! Discarding unstaged changes, and restoring them (#366, #387). A discard acts on the worktree
//! against the index, so staged changes stay. Before any byte of the worktree changes, the current
//! bytes are stored as blobs with `git hash-object -w --no-filters`; if that fails, nothing is
//! discarded. Hunks and lines are reverse-applied with the reduced patch staging builds
//! (`git apply -R --check`, then `git apply -R`), a whole tracked file goes back to the index with
//! `git restore --worktree`, and an untracked file goes to the Recycle Bin, never deleted outright.
//! Every discard and restore runs in the worktree's staging slot.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde::{Deserialize, Serialize};

use super::diff::{
    changed_lines, diff_token, header_lines, other, parse_blob_oid, read_file_diff, read_parsed, reduced_patch, run_read, token_context, DiffSide,
    FileDiff, Selection,
};
use super::error::GitError;
use super::staging::{parse_rel_path, read_status, run_write, run_write_input, worktree_git, StagingLocks, WorktreeStatus};

/// Where an untracked file goes when it is discarded. The app's is the system's Recycle Bin.
pub trait RecycleBin: Sync {
    /// Moves every one of `paths` to the bin, or fails.
    fn delete_all(&self, paths: &[PathBuf]) -> Result<(), String>;
}

/// The system's Recycle Bin (the trash on macOS and Linux), through the `trash` crate.
pub struct SystemRecycleBin;

impl RecycleBin for SystemRecycleBin {
    fn delete_all(&self, paths: &[PathBuf]) -> Result<(), String> {
        trash::delete_all(paths).map_err(|e| e.to_string())
    }
}

/// What one discard did to one file, so it can be put back.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscardBackup {
    /// The path relative to the worktree root, with `/` separators.
    pub path: String,
    /// The blob holding the file's bytes before the discard, as they were on disk, or null when
    /// the file was absent (a deletion in the worktree, which the discard undid).
    pub blob: Option<String>,
    /// The blob id of the file's bytes just after the discard, or null when it left no file (an
    /// untracked file sent to the Recycle Bin). A restore goes ahead only while the file still
    /// matches it.
    pub after: Option<String>,
}

/// A discard from the diff view: part or all of one file's unstaged diff.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscardRequest {
    pub path: String,
    /// The unstaged diff's token; a discard is refused with [`GitError::StaleDiff`] when it differs.
    pub diff_token: String,
    /// `File`, `Hunks` or `Lines`. A mode change is not discarded on its own.
    pub selection: Selection,
    /// Whether the returned diff keeps the hunks of a `tooLarge` diff, after Load anyway.
    #[serde(default)]
    pub load_large: bool,
}

/// The backup a discard from the diff view recorded, the file's new unstaged diff, and the status.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscardSelectionResult {
    pub backup: DiscardBackup,
    pub diff: FileDiff,
    pub status: WorktreeStatus,
}

/// Runs `git <args>` in `worktree` with `input` on stdin and returns what it prints. The input is
/// written from its own thread, so a long list of paths never stalls against git's output.
pub(super) fn run_piped(worktree: &Path, args: &[&str], input: Vec<u8>) -> Result<Vec<u8>, GitError> {
    let mut child = worktree_git(worktree)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| other(format!("could not run git: {e}")))?;
    let mut stdin = child.stdin.take();
    let writer = std::thread::spawn(move || {
        if let Some(stdin) = stdin.as_mut() {
            // A git that fails early closes its stdin; its stderr says why.
            let _ = stdin.write_all(&input);
        }
    });
    let mut stderr = child.stderr.take();
    let reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(err) = stderr.as_mut() {
            let _ = err.read_to_end(&mut buf);
        }
        buf
    });
    let mut stdout = Vec::new();
    if let Some(mut out) = child.stdout.take() {
        out.read_to_end(&mut stdout).map_err(|e| other(format!("could not read git's output: {e}")))?;
    }
    let status = child.wait().map_err(|e| other(format!("could not wait for git: {e}")))?;
    let _ = writer.join();
    let stderr = reader.join().unwrap_or_default();
    if !status.success() {
        return Err(other(String::from_utf8_lossy(&stderr).trim().to_string()));
    }
    Ok(stdout)
}

/// `path` as one `--stdin-paths` line: C-quoted, so a path that starts with a quote or holds a
/// newline reads back as itself.
fn quoted_line(path: &str, out: &mut Vec<u8>) {
    out.push(b'"');
    for b in path.bytes() {
        match b {
            b'"' => out.extend_from_slice(b"\\\""),
            b'\\' => out.extend_from_slice(b"\\\\"),
            b'\n' => out.extend_from_slice(b"\\n"),
            b'\r' => out.extend_from_slice(b"\\r"),
            b'\t' => out.extend_from_slice(b"\\t"),
            _ => out.push(b),
        }
    }
    out.extend_from_slice(b"\"\n");
}

/// Whether [`hash_files`] stores the blobs it hashes or only names them.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Blobs {
    /// Stores them in the object database (`-w`), as a backup.
    Store,
    /// Only computes their ids, to compare with a backup's.
    IdsOnly,
}

/// The blob id of each of `paths` in `worktree` as its bytes stand on disk (`--no-filters`), or
/// None for a path with no file. With [`Blobs::Store`] the blobs are stored in the object database.
/// A symlink is refused, since its bytes on disk are not what git would restore.
pub(super) fn hash_files(worktree: &Path, paths: &[&str], blobs: Blobs) -> Result<Vec<Option<String>>, GitError> {
    let mut present = Vec::new();
    let mut input = Vec::new();
    for (i, path) in paths.iter().enumerate() {
        match std::fs::symlink_metadata(worktree.join(path)) {
            Ok(meta) if meta.file_type().is_symlink() => return Err(other(format!("{path} is a symbolic link, which Quay doesn't discard"))),
            Ok(meta) if meta.is_dir() => return Err(other(format!("{path} is a folder, not a file"))),
            Ok(_) => {
                present.push(i);
                quoted_line(path, &mut input);
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(other(format!("could not read {path}: {e}"))),
        }
    }
    let mut out = vec![None; paths.len()];
    if present.is_empty() {
        return Ok(out);
    }
    let mut args = vec!["hash-object"];
    if blobs == Blobs::Store {
        args.push("-w");
    }
    args.extend(["--no-filters", "--stdin-paths"]);
    let printed = run_piped(worktree, &args, input)?;
    let oids: Vec<&str> = std::str::from_utf8(&printed).map_err(|_| other("git printed a non-text oid"))?.lines().collect();
    if oids.len() != present.len() {
        return Err(other("git hash-object printed the wrong number of ids"));
    }
    for (i, oid) in present.into_iter().zip(oids) {
        out[i] = Some(oid.to_string());
    }
    Ok(out)
}

/// Stores the bytes of `paths` as blobs before a discard, and fails, so that nothing is discarded,
/// when any of them can't be stored.
pub(super) fn back_up(worktree: &Path, paths: &[&str]) -> Result<Vec<Option<String>>, GitError> {
    hash_files(worktree, paths, Blobs::Store).map_err(|e| other(format!("could not back up the files, so nothing was discarded: {e}")))
}

/// The backups of `paths`, from the blobs stored before the discard and the files as they are now.
pub(super) fn backups(worktree: &Path, paths: &[&str], blobs: Vec<Option<String>>) -> Result<Vec<DiscardBackup>, GitError> {
    let after = hash_files(worktree, paths, Blobs::IdsOnly)?;
    Ok(paths
        .iter()
        .zip(blobs)
        .zip(after)
        .map(|((path, blob), after)| DiscardBackup { path: path.to_string(), blob, after })
        .collect())
}

/// Checks `patch` against the worktree with `git apply -R --check`, then reverse-applies it.
fn apply_reverse(worktree: &Path, patch: &[u8], context: u32) -> Result<(), GitError> {
    let mut args = vec!["apply", "-R", "--recount", "--whitespace=nowarn"];
    if context == 0 {
        args.push("--unidiff-zero");
    }
    let mut check = args.clone();
    check.extend(["--check", "-"]);
    run_write_input(worktree, &check, Some(patch))?;
    args.push("-");
    run_write_input(worktree, &args, Some(patch))
}

/// Discards whole files: `tracked` go back to the index's bytes (`git restore --worktree`) and
/// `untracked` go to the Recycle Bin, with any folder they leave empty removed. Every file is
/// backed up first, and nothing is discarded if that fails. Returns the backups, tracked first.
fn discard_files(bin: &dyn RecycleBin, worktree: &Path, tracked: &[&str], untracked: &[&str]) -> Result<Vec<DiscardBackup>, GitError> {
    let all: Vec<&str> = tracked.iter().chain(untracked).copied().collect();
    let to_bin = untracked.iter().map(|p| inside_worktree(worktree, p)).collect::<Result<Vec<_>, _>>()?;
    let blobs = back_up(worktree, &all)?;
    if !tracked.is_empty() {
        run_write(worktree, &["restore", "--worktree"], Some(tracked))?;
    }
    if !to_bin.is_empty() {
        bin.delete_all(&to_bin).map_err(|e| other(format!("could not move the untracked files to the Recycle Bin: {e}")))?;
        remove_emptied_folders(worktree, &to_bin);
    }
    backups(worktree, &all, blobs)
}

/// Removes the folders above `files` that are now empty, up to the worktree root. A folder that
/// still holds anything, an ignored file included, stays.
fn remove_emptied_folders(worktree: &Path, files: &[PathBuf]) {
    let Ok(root) = worktree.canonicalize() else { return };
    for file in files {
        let mut folder = file.parent();
        while let Some(dir) = folder.filter(|d| *d != root && d.starts_with(&root)) {
            // `remove_dir` fails on a folder that isn't empty, which ends the walk.
            if std::fs::remove_dir(dir).is_err() {
                break;
            }
            folder = dir.parent();
        }
    }
}

/// Discards `request.selection` of one file's unstaged diff (#366, #387), in the worktree's staging
/// slot. It re-reads the diff and refuses with [`GitError::StaleDiff`] when the token no longer
/// matches, then stores the file's bytes as a blob, and only then changes the file. Hunks and lines
/// are reverse-applied, so the file stays even when every line goes; a binary file, a submodule and
/// a lone mode change are refused. `File` restores a tracked file from the index and sends an
/// untracked one to the Recycle Bin, and any selection of a file deleted in the worktree brings it
/// back whole. Returns the backup, the file's new unstaged diff answering `diff_request_id`, and
/// the status answering `request_id`.
pub fn discard_selection(
    locks: &StagingLocks,
    bin: &dyn RecycleBin,
    worktree: &Path,
    request_id: u32,
    diff_request_id: u32,
    request: &DiscardRequest,
) -> Result<DiscardSelectionResult, GitError> {
    let _slot = locks.begin(worktree)?;
    let path = parse_rel_path(&request.path)?;
    locks.refuse_handed_off(worktree, Some(&[path]))?;
    let context = token_context(&request.diff_token).ok_or(GitError::StaleDiff)?;
    let parsed = read_parsed(worktree, path, &DiffSide::Unstaged, context, false)?;
    if diff_token(context, &parsed) != request.diff_token {
        return Err(GitError::StaleDiff);
    }
    if parsed.submodule {
        return Err(other(format!("{path} is a submodule; discard its changes inside it")));
    }
    let partial = |picked: &dyn Fn(usize, usize) -> bool| -> Result<Vec<u8>, GitError> {
        if parsed.binary {
            return Err(other(format!("{path} is discarded only as a whole file")));
        }
        let (minus, plus) = header_lines(&parsed)?;
        reduced_patch(&parsed, (&minus, &plus), picked, true)
    };
    let patch = match &request.selection {
        // A file deleted in the worktree has no bytes to lose, and no file for a patch to apply to.
        Selection::File | Selection::Hunks { .. } | Selection::Lines { .. } if parsed.deleted_file => None,
        Selection::File => None,
        Selection::Hunks { hunks } => {
            let selected: Vec<usize> = hunks.iter().map(|&h| h as usize).collect();
            if selected.is_empty() || selected.iter().any(|&h| h >= parsed.hunks.len()) {
                return Err(other(format!("no such hunk in {path}")));
            }
            Some(partial(&|h, _| selected.contains(&h))?)
        }
        Selection::Lines { lines } => {
            let picked = changed_lines(&parsed, lines)
                .filter(|p| !p.is_empty())
                .ok_or_else(|| other(format!("no such changed line in {path}")))?;
            Some(partial(&|h, l| picked.contains(&(h, l)))?)
        }
        Selection::ModeChange => return Err(other("a mode change is not discarded on its own; discard the whole file")),
    };
    let backup = match patch {
        Some(patch) => {
            let blobs = back_up(worktree, &[path])?;
            apply_reverse(worktree, &patch, context)?;
            backups(worktree, &[path], blobs)?.remove(0)
        }
        None if parsed.untracked => discard_files(bin, worktree, &[], &[path])?.remove(0),
        None => discard_files(bin, worktree, &[path], &[])?.remove(0),
    };
    Ok(DiscardSelectionResult {
        backup,
        diff: read_file_diff(worktree, diff_request_id, path, &DiffSide::Unstaged, context, request.load_large)?,
        status: read_status(worktree, request_id, None)?,
    })
}

/// `path` in `worktree`, refused unless it is a relative path that stays inside the worktree once
/// every folder on the way is resolved, and doesn't reach into `.git`. The file itself needn't
/// exist, but when it does it must not be a symbolic link.
pub(super) fn inside_worktree(worktree: &Path, path: &str) -> Result<PathBuf, GitError> {
    checked_target(worktree, path, false)
}

/// As [`inside_worktree`], but `path` itself may be a symbolic link, for a git write that replaces
/// or removes the link rather than writing through it. The folders on the way must still resolve
/// inside the worktree.
pub(super) fn link_inside_worktree(worktree: &Path, path: &str) -> Result<PathBuf, GitError> {
    checked_target(worktree, path, true)
}

fn checked_target(worktree: &Path, path: &str, allow_link: bool) -> Result<PathBuf, GitError> {
    let path = parse_rel_path(path)?;
    let outside = || other(format!("{path} is outside the worktree"));
    if path.split(['/', '\\']).next().is_some_and(|first| first.eq_ignore_ascii_case(".git")) {
        return Err(outside());
    }
    let root = worktree.canonicalize().map_err(|e| other(format!("could not open the worktree: {e}")))?;
    let target = root.join(path);
    let mut existing = target.as_path();
    if std::fs::symlink_metadata(&target).is_ok_and(|m| m.file_type().is_symlink()) {
        if !allow_link {
            return Err(other(format!("{path} is a symbolic link, which Quay doesn't write through")));
        }
        // The link is never followed; the folder holding it must be inside.
        existing = target.parent().ok_or_else(outside)?;
    }
    // The deepest folder on the way that exists must resolve inside the worktree.
    while std::fs::symlink_metadata(existing).is_err() {
        existing = existing.parent().ok_or_else(outside)?;
    }
    let resolved = existing.canonicalize().map_err(|e| other(format!("could not open {path}: {e}")))?;
    if !resolved.starts_with(&root) {
        return Err(outside());
    }
    Ok(target)
}

/// Writes `bytes` to `target` without a crash leaving it half written, creating its folders and
/// keeping the permissions of the file it replaces.
pub(super) fn write_file(target: &Path, bytes: &[u8]) -> Result<(), GitError> {
    let failed = |e: std::io::Error| other(format!("could not write {}: {e}", target.display()));
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(failed)?;
    }
    let permissions = std::fs::metadata(target).ok().map(|m| m.permissions());
    crate::atomic_file::write_atomic(target, bytes).map_err(failed)?;
    if let Some(permissions) = permissions {
        std::fs::set_permissions(target, permissions).map_err(failed)?;
    }
    Ok(())
}

/// The bytes of the blob `oid`.
pub(super) fn blob_bytes(worktree: &Path, oid: &str) -> Result<Vec<u8>, GitError> {
    run_read(worktree, ["cat-file", "blob", parse_blob_oid(oid)?])
}

/// Puts back what the discards in `backups` took (#387), in the worktree's staging slot, and
/// returns the post-write status. Each path must stay inside the worktree. If any file no longer
/// matches what its discard left, nothing is restored and the error lists those files, so a newer
/// change is never overwritten. A file the discard brought back from a deletion goes to the Recycle
/// Bin again; every other file gets its backed-up bytes.
pub fn restore_discarded(
    locks: &StagingLocks,
    bin: &dyn RecycleBin,
    worktree: &Path,
    request_id: u32,
    backups: &[DiscardBackup],
) -> Result<WorktreeStatus, GitError> {
    let _slot = locks.begin(worktree)?;
    let restored: Vec<&str> = backups.iter().map(|b| b.path.as_str()).collect();
    locks.refuse_handed_off(worktree, Some(&restored))?;
    if backups.is_empty() {
        return Err(other("nothing to restore"));
    }
    let mut targets = Vec::with_capacity(backups.len());
    for backup in backups {
        if let Some(blob) = &backup.blob {
            parse_blob_oid(blob)?;
        }
        targets.push(inside_worktree(worktree, &backup.path)?);
    }
    let paths: Vec<&str> = backups.iter().map(|b| b.path.as_str()).collect();
    let now = hash_files(worktree, &paths, Blobs::IdsOnly)?;
    let changed: Vec<String> = backups.iter().zip(&now).filter(|(b, now)| b.after != **now).map(|(b, _)| b.path.clone()).collect();
    if !changed.is_empty() {
        return Err(GitError::ChangedSinceDiscard { paths: changed });
    }
    let mut to_bin = Vec::new();
    for (backup, target) in backups.iter().zip(targets) {
        match &backup.blob {
            Some(blob) => write_file(&target, &blob_bytes(worktree, blob)?)?,
            None if backup.after.is_some() => to_bin.push(target),
            None => {}
        }
    }
    if !to_bin.is_empty() {
        bin.delete_all(&to_bin).map_err(|e| other(format!("could not move files to the Recycle Bin: {e}")))?;
    }
    read_status(worktree, request_id, None)
}

/// What a discard from the lists acts on.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum DiscardTarget {
    /// Every unstaged change, and every untracked file only with `include_untracked`.
    All { include_untracked: bool },
    /// The listed files and folders, untracked ones included.
    Paths { paths: Vec<String> },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscardPathsResult {
    pub backups: Vec<DiscardBackup>,
    pub status: WorktreeStatus,
}

/// Every unstaged change `git status` reports under `pathspecs` (everywhere when None), uncapped,
/// as (tracked, untracked). Tracked paths are files changed or deleted in the worktree; a submodule,
/// an unmerged path and an intent-to-add entry are left out. With `untracked`, each untracked file
/// is listed on its own (`-uall`), never an ignored one.
fn unstaged_changes(worktree: &Path, pathspecs: Option<&[&str]>, untracked: bool) -> Result<(Vec<String>, Vec<String>), GitError> {
    let mut args = vec!["--no-optional-locks", "status", "--porcelain=v2", "-z", "--no-renames"];
    args.push(if untracked { "-uall" } else { "-uno" });
    if let Some(specs) = pathspecs {
        args.push("--");
        args.extend(specs);
    }
    let out = run_read(worktree, args)?;
    let (mut tracked, mut new) = (Vec::new(), Vec::new());
    for record in out.split(|&b| b == 0) {
        let text = String::from_utf8_lossy(record);
        if let Some(path) = text.strip_prefix("? ") {
            new.push(path.to_string());
            continue;
        }
        // `1 XY sub mH mI mW hH hI path`
        let fields: Vec<&str> = text.splitn(9, ' ').collect();
        if let ["1", xy, sub, _, _, _, _, _, path] = fields.as_slice() {
            if sub.starts_with('N') && matches!(xy.as_bytes().get(1), Some(b'M' | b'D' | b'T')) {
                tracked.push(path.to_string());
            }
        }
    }
    Ok((tracked, new))
}

/// Discards `target` from the lists (#366, #387), in the worktree's staging slot, and returns the
/// backups and the post-write status. Tracked files go back to the index's bytes and untracked
/// files go to the Recycle Bin, after every one of them is backed up. `All` acts on every change,
/// including those past the status cap, and on untracked files only with `include_untracked`.
pub fn discard_paths(
    locks: &StagingLocks,
    bin: &dyn RecycleBin,
    worktree: &Path,
    request_id: u32,
    target: &DiscardTarget,
) -> Result<DiscardPathsResult, GitError> {
    let _slot = locks.begin(worktree)?;
    let reached: Option<Vec<&str>> = match target {
        DiscardTarget::All { .. } => None,
        DiscardTarget::Paths { paths } => Some(paths.iter().map(String::as_str).collect()),
    };
    locks.refuse_handed_off(worktree, reached.as_deref())?;
    let (tracked, untracked) = match target {
        DiscardTarget::All { include_untracked } => unstaged_changes(worktree, None, *include_untracked)?,
        DiscardTarget::Paths { paths } => {
            if paths.is_empty() {
                return Err(other("no paths to discard"));
            }
            let specs = paths.iter().map(|p| parse_rel_path(p)).collect::<Result<Vec<_>, _>>()?;
            unstaged_changes(worktree, Some(&specs), true)?
        }
    };
    let tracked: Vec<&str> = tracked.iter().map(String::as_str).collect();
    let untracked: Vec<&str> = untracked.iter().map(String::as_str).collect();
    let backups = if tracked.is_empty() && untracked.is_empty() { Vec::new() } else { discard_files(bin, worktree, &tracked, &untracked)? };
    Ok(DiscardPathsResult { backups, status: read_status(worktree, request_id, None)? })
}

/// The new files a copy wrote, and the post-write status.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyResult {
    pub paths: Vec<String>,
    pub status: WorktreeStatus,
}

/// The first free name beside `target` for a copy of its discarded bytes: `name (discarded).ext`,
/// then `name (discarded 2).ext` and so on, with the file created so no other writer can take it.
fn create_copy(target: &Path, bytes: &[u8]) -> Result<PathBuf, GitError> {
    let stem = target.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let ext = target.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    for n in 1..=1000u32 {
        let suffix = if n == 1 { " (discarded)".to_string() } else { format!(" (discarded {n})") };
        let copy = target.with_file_name(format!("{stem}{suffix}{ext}"));
        match std::fs::OpenOptions::new().write(true).create_new(true).open(&copy) {
            Ok(mut file) => {
                file.write_all(bytes).map_err(|e| other(format!("could not write {}: {e}", copy.display())))?;
                return Ok(copy);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(other(format!("could not create {}: {e}", copy.display()))),
        }
    }
    Err(other(format!("no free name for a copy of {}", target.display())))
}

/// Writes the backed-up bytes of each of `backups` to a new file beside the original (#387), for a
/// discard whose file changed since, so neither version is lost. Each path must stay inside the
/// worktree, and no existing file is overwritten. A backup of a deleted file has no bytes and is
/// skipped. Returns the new files' paths and the post-write status, in the worktree's staging slot.
pub fn copy_discarded(locks: &StagingLocks, worktree: &Path, request_id: u32, backups: &[DiscardBackup]) -> Result<CopyResult, GitError> {
    let _slot = locks.begin(worktree)?;
    let mut checked = Vec::new();
    for backup in backups {
        let target = inside_worktree(worktree, &backup.path)?;
        if let Some(blob) = &backup.blob {
            checked.push((backup.path.as_str(), target, parse_blob_oid(blob)?));
        }
    }
    if checked.is_empty() {
        return Err(other("nothing to copy: the discard left no bytes to keep"));
    }
    let mut paths = Vec::new();
    for (path, target, blob) in checked {
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|e| other(format!("could not create the folder for {path}: {e}")))?;
        }
        let copy = create_copy(&target, &blob_bytes(worktree, blob)?)?;
        let name = copy.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        paths.push(match path.rsplit_once('/') {
            Some((folder, _)) => format!("{folder}/{name}"),
            None => name,
        });
    }
    Ok(CopyResult { paths, status: read_status(worktree, request_id, None)? })
}

/// Discards part or all of one file's unstaged diff and returns the backup, the file's new diff and
/// the post-write status. See [`discard_selection`]; the diff view confirms a whole file first.
#[tauri::command]
pub async fn git_discard_selection(
    worktree_path: String,
    request_id: u32,
    diff_request_id: u32,
    request: DiscardRequest,
    locks: tauri::State<'_, StagingLocks>,
) -> Result<DiscardSelectionResult, GitError> {
    let locks = locks.inner();
    // A held index.lock keeps it waiting between tries, so keep it off the async runtime's threads.
    tokio::task::block_in_place(|| {
        discard_selection(locks, &SystemRecycleBin, Path::new(&worktree_path), request_id, diff_request_id, &request)
    })
}

/// Discards `target` from the lists and returns the backups and the post-write status. See
/// [`discard_paths`]; the inspector confirms first.
#[tauri::command]
pub async fn git_discard_paths(
    worktree_path: String,
    request_id: u32,
    target: DiscardTarget,
    locks: tauri::State<'_, StagingLocks>,
) -> Result<DiscardPathsResult, GitError> {
    let locks = locks.inner();
    tokio::task::block_in_place(|| discard_paths(locks, &SystemRecycleBin, Path::new(&worktree_path), request_id, &target))
}

/// Puts back what a discard took and returns the post-write status. See [`restore_discarded`].
#[tauri::command]
pub async fn git_restore_discarded(
    worktree_path: String,
    request_id: u32,
    backups: Vec<DiscardBackup>,
    locks: tauri::State<'_, StagingLocks>,
) -> Result<WorktreeStatus, GitError> {
    let locks = locks.inner();
    tokio::task::block_in_place(|| restore_discarded(locks, &SystemRecycleBin, Path::new(&worktree_path), request_id, &backups))
}

/// Copies what a discard took to new files beside the originals. See [`copy_discarded`].
#[tauri::command]
pub async fn git_copy_discarded(
    worktree_path: String,
    request_id: u32,
    backups: Vec<DiscardBackup>,
    locks: tauri::State<'_, StagingLocks>,
) -> Result<CopyResult, GitError> {
    let locks = locks.inner();
    tokio::task::block_in_place(|| copy_discarded(locks, Path::new(&worktree_path), request_id, &backups))
}
