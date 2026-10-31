//! The three-pane resolver's backend (#352, #390). [`open_conflict`] reads a conflicted file's
//! stage 2 (left) and stage 3 (right) blobs and its worktree bytes, whose conflict markers seed the
//! editable Result. Rust never parses those markers: the frontend's `parseConflicts` does.
//!
//! Every write re-checks the [`ConflictFile::token`], which pins the stage 1, 2 and 3 oids and the
//! worktree bytes' blob id, and refuses with [`GitError::ConflictStale`] when git or an agent changed
//! any of them since the file was opened. Writes run in the worktree's staging slot, and Topos never
//! writes the index directly: take-whole-side and Mark resolved stage through `git add`.

use std::path::Path;

use serde::{Deserialize, Serialize};

use super::diff::{other, run_read, TOO_LARGE_BYTES};
use super::discard::{back_up, backups, blob_bytes, hash_files, inside_worktree, write_file, Blobs, DiscardBackup};
use super::error::GitError;
use super::staging::{parse_rel_path, read_status, run_write, write_stage, PathTarget, StagingLocks, WorktreeStatus};

/// The marker length git uses when `conflict-marker-size` isn't set.
const DEFAULT_MARKER_SIZE: u32 = 7;

/// How the worktree file ends its lines. The resolver's text always uses `\n`; a save puts the
/// file's own ending back.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Eol {
    Lf,
    Crlf,
}

/// Why a conflicted file can't be edited as text, so the resolver offers its sides whole instead.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum NotEditable {
    /// One side deleted the file, or added it alone, so there is no pair of texts to merge.
    OneSideMissing,
    /// The conflict left no file in the worktree.
    NoWorktreeFile,
    Submodule,
    Symlink,
    /// A side or the worktree file holds a NUL byte.
    Binary,
    /// A side or the worktree file is larger than [`TOO_LARGE_BYTES`].
    TooLarge,
    /// A side or the worktree file isn't UTF-8.
    NotUtf8,
    /// The worktree file ends some lines with CRLF and others with LF, so no one ending restores it.
    MixedLineEndings,
}

/// A conflicted file as the resolver opens it. When it is `editable`, `left`, `right` and `result`
/// hold the texts, without a BOM and with `\n` line endings; otherwise `reason` says why not and
/// the texts are null.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictFile {
    /// The path relative to the worktree root, with `/` separators.
    pub path: String,
    /// Pins the stage oids and the worktree bytes; every write hands it back.
    pub token: String,
    pub editable: bool,
    pub reason: Option<NotEditable>,
    /// Stage 2, git's "ours".
    pub left: Option<String>,
    /// Stage 3, git's "theirs".
    pub right: Option<String>,
    /// The worktree file, with git's conflict markers.
    pub result: Option<String>,
    pub eol: Eol,
    /// Whether the worktree file starts with a UTF-8 byte order mark.
    pub bom: bool,
    /// The length of the file's conflict markers, from its `conflict-marker-size` attribute.
    pub marker_size: u32,
}

/// One unmerged stage of a path: its mode and blob.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Stage {
    mode: String,
    oid: String,
}

type Stages = [Option<Stage>; 3];

/// Stages 1, 2 and 3 of `path` in the index, from `git ls-files -u -z`, or None when it has none.
fn read_stages(worktree: &Path, path: &str) -> Result<Option<Stages>, GitError> {
    let out = run_read(worktree, ["--no-optional-locks", "ls-files", "-u", "-z", "--", path])?;
    let mut stages: Stages = [None, None, None];
    for record in out.split(|b| *b == 0).filter(|r| !r.is_empty()) {
        let text = String::from_utf8_lossy(record);
        let Some((meta, name)) = text.split_once('\t') else { continue };
        if name != path {
            continue;
        }
        let fields: Vec<&str> = meta.split(' ').collect();
        if let [mode, oid, stage] = fields.as_slice()
            && let Ok(n @ 1..=3) = stage.parse::<usize>()
        {
            stages[n - 1] = Some(Stage { mode: mode.to_string(), oid: oid.to_string() });
        }
    }
    Ok(stages.iter().any(Option::is_some).then_some(stages))
}

/// The token for these stages and the worktree file's part.
fn token(stages: &Stages, worktree_part: &str) -> String {
    let oid = |s: &Option<Stage>| s.as_ref().map_or("-", |s| s.oid.as_str()).to_string();
    format!("{}:{}:{}:{worktree_part}", oid(&stages[0]), oid(&stages[1]), oid(&stages[2]))
}

/// The worktree file's part of the token: its blob id, `link` for a symlink, or `-` with no file.
/// The path must stay inside the worktree.
fn worktree_part(worktree: &Path, path: &str) -> Result<String, GitError> {
    if let Err(e) = inside_worktree(worktree, path) {
        // A symlink is refused as a write target, but its conflict can still be read.
        let link = std::fs::symlink_metadata(worktree.join(path)).is_ok_and(|m| m.file_type().is_symlink());
        return if link { Ok("link".into()) } else { Err(e) };
    }
    Ok(hash_files(worktree, &[path], Blobs::IdsOnly)?.remove(0).unwrap_or_else(|| "-".into()))
}

/// `bytes` as text without a BOM and with `\n` endings, with its ending and whether it had a BOM,
/// or why it can't be edited.
fn decode(bytes: &[u8]) -> Result<(String, Eol, bool), NotEditable> {
    if bytes.len() as u64 > TOO_LARGE_BYTES {
        return Err(NotEditable::TooLarge);
    }
    if bytes.contains(&0) {
        return Err(NotEditable::Binary);
    }
    let (body, bom) = match bytes.strip_prefix(b"\xEF\xBB\xBF") {
        Some(rest) => (rest, true),
        None => (bytes, false),
    };
    let text = std::str::from_utf8(body).map_err(|_| NotEditable::NotUtf8)?;
    let crlf = text.matches("\r\n").count();
    let lf = text.matches('\n').count() - crlf;
    match (crlf, lf) {
        (0, _) => Ok((text.to_string(), Eol::Lf, bom)),
        (_, 0) => Ok((text.replace("\r\n", "\n"), Eol::Crlf, bom)),
        _ => Err(NotEditable::MixedLineEndings),
    }
}

/// The `conflict-marker-size` attribute of `path`, or git's default of 7.
fn marker_size(worktree: &Path, path: &str) -> Result<u32, GitError> {
    let out = run_read(worktree, ["check-attr", "-z", "conflict-marker-size", "--", path])?;
    // `path NUL attribute NUL value NUL`
    let value = out.split(|b| *b == 0).nth(2).map(|v| String::from_utf8_lossy(v).into_owned());
    Ok(value.and_then(|v| v.parse::<u32>().ok()).filter(|n| (1..=1024).contains(n)).unwrap_or(DEFAULT_MARKER_SIZE))
}

type Texts = (String, String, (String, Eol, bool));

/// Both sides' texts and the worktree file's, or why the file can't be edited as text.
fn read_texts(worktree: &Path, path: &str, stages: &Stages, part: &str) -> Result<Result<Texts, NotEditable>, GitError> {
    let (Some(left), Some(right)) = (&stages[1], &stages[2]) else { return Ok(Err(NotEditable::OneSideMissing)) };
    let all = || stages.iter().flatten();
    if all().any(|s| s.mode == "160000") {
        return Ok(Err(NotEditable::Submodule));
    }
    if part == "link" || all().any(|s| s.mode == "120000") {
        return Ok(Err(NotEditable::Symlink));
    }
    if part == "-" {
        return Ok(Err(NotEditable::NoWorktreeFile));
    }
    let bytes = std::fs::read(worktree.join(path)).map_err(|e| other(format!("could not read {path}: {e}")))?;
    let result = match decode(&bytes) {
        Ok(r) => r,
        Err(reason) => return Ok(Err(reason)),
    };
    let mut sides = Vec::with_capacity(2);
    for stage in [left, right] {
        match decode(&blob_bytes(worktree, &stage.oid)?) {
            Ok((text, _, _)) => sides.push(text),
            Err(reason) => return Ok(Err(reason)),
        }
    }
    let right = sides.pop().unwrap_or_default();
    let left = sides.pop().unwrap_or_default();
    Ok(Ok((left, right, result)))
}

/// Opens the conflicted `path` in `worktree` for the resolver (#390): both sides' blobs, the
/// worktree file with its markers, its line ending, BOM and marker size, and the token every write
/// re-checks. `path` must be relative, stay inside the worktree, and have unmerged stages.
pub fn open_conflict(worktree: &Path, path: &str) -> Result<ConflictFile, GitError> {
    read_conflict(worktree, path)?.ok_or_else(|| other(format!("{path} has no conflict to resolve")))
}

/// What [`open_conflict`] reads, or None when `path` has no unmerged stages.
fn read_conflict(worktree: &Path, path: &str) -> Result<Option<ConflictFile>, GitError> {
    let path = parse_rel_path(path)?;
    let part = worktree_part(worktree, path)?;
    let Some(stages) = read_stages(worktree, path)? else { return Ok(None) };
    let mut file = ConflictFile {
        path: path.to_string(),
        token: token(&stages, &part),
        editable: false,
        reason: None,
        left: None,
        right: None,
        result: None,
        eol: Eol::Lf,
        bom: false,
        marker_size: marker_size(worktree, path)?,
    };
    match read_texts(worktree, path, &stages, &part)? {
        Ok((left, right, (result, eol, bom))) => {
            file.editable = true;
            file.left = Some(left);
            file.right = Some(right);
            file.result = Some(result);
            file.eol = eol;
            file.bom = bom;
        }
        Err(reason) => file.reason = Some(reason),
    }
    Ok(Some(file))
}

/// The conflicted `path` as it stands, for a write handed `token`: refused with
/// [`GitError::ConflictStale`] when it is no longer conflicted or its token no longer matches.
fn recheck(worktree: &Path, path: &str, token: &str) -> Result<ConflictFile, GitError> {
    match read_conflict(worktree, path)? {
        Some(file) if file.token == token => Ok(file),
        _ => Err(GitError::ConflictStale),
    }
}

/// Saves `text` as the Result of the conflicted `path` (#390), in the worktree's staging slot, and
/// returns the file opened afresh. It refuses with [`GitError::ConflictStale`], writing nothing,
/// when `token` no longer matches the file, so it never overwrites what git or an agent changed. The text gets the file's line ending and BOM back, and is
/// written atomically, so a crash leaves the old file or the new one, never half of it.
pub fn save_conflict(locks: &StagingLocks, worktree: &Path, path: &str, token: &str, text: &str) -> Result<ConflictFile, GitError> {
    let _slot = locks.begin(worktree)?;
    let target = inside_worktree(worktree, path)?;
    let opened = recheck(worktree, path, token)?;
    if !opened.editable {
        return Err(other(format!("{path} can't be saved as text")));
    }
    write_file(&target, &encode(text, opened.eol, opened.bom))?;
    open_conflict(worktree, path)
}

/// `text`, which uses `\n`, with the file's own line ending and BOM put back.
fn encode(text: &str, eol: Eol, bom: bool) -> Vec<u8> {
    let mut out = Vec::with_capacity(text.len() + 3);
    if bom {
        out.extend_from_slice(b"\xEF\xBB\xBF");
    }
    match eol {
        Eol::Lf => out.extend_from_slice(text.as_bytes()),
        Eol::Crlf => out.extend_from_slice(text.replace('\n', "\r\n").as_bytes()),
    }
    out
}


/// What Reset file did: the file opened afresh, and the backup of the bytes it replaced.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictReset {
    pub file: ConflictFile,
    pub backup: DiscardBackup,
}

/// Reset file (#390): puts the conflicted `path` back to git's merge of its stages, markers and
/// all (`git checkout -m`), dropping any resolution saved to it, in the worktree's staging slot. The
/// file's bytes are stored as a blob first, the way a discard stores them (#387), and nothing
/// changes if that fails. It refuses with [`GitError::ConflictStale`] when `token` no longer
/// matches. Returns the file opened afresh and the backup.
pub fn reset_conflict(locks: &StagingLocks, worktree: &Path, path: &str, token: &str) -> Result<ConflictReset, GitError> {
    let _slot = locks.begin(worktree)?;
    inside_worktree(worktree, path)?;
    recheck(worktree, path, token)?;
    let blobs = back_up(worktree, &[path])?;
    run_write(worktree, &["checkout", "-m"], Some(&[path]))?;
    let backup = backups(worktree, &[path], blobs)?.remove(0);
    Ok(ConflictReset { file: open_conflict(worktree, path)?, backup })
}

/// Which side take-whole-side keeps: stage 2 (git's "ours") or stage 3 ("theirs").
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConflictSide {
    Left,
    Right,
}

/// What take-whole-side did: the backup of the bytes it replaced, and the post-write status.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TakeSideResult {
    pub backup: DiscardBackup,
    pub status: WorktreeStatus,
}

/// Take-whole-side (#390): keeps `side` of the conflicted `path` as it stands in its stage
/// (`git checkout --ours|--theirs`), then marks it resolved through the inspector's own `git add`
/// path, in the worktree's staging slot. The file's bytes are stored as a blob first, as Reset file
/// stores them. It refuses with [`GitError::ConflictStale`] when `token` no longer matches. Returns
/// the backup and the status answering `request_id`.
pub fn take_side(
    locks: &StagingLocks,
    worktree: &Path,
    request_id: u32,
    path: &str,
    token: &str,
    side: ConflictSide,
) -> Result<TakeSideResult, GitError> {
    let _slot = locks.begin(worktree)?;
    inside_worktree(worktree, path)?;
    recheck(worktree, path, token)?;
    let blobs = back_up(worktree, &[path])?;
    let flag = match side {
        ConflictSide::Left => "--ours",
        ConflictSide::Right => "--theirs",
    };
    run_write(worktree, &["checkout", flag], Some(&[path]))?;
    write_stage(worktree, &PathTarget::Paths { paths: vec![path.to_string()] })?;
    let backup = backups(worktree, &[path], blobs)?.remove(0);
    Ok(TakeSideResult { backup, status: read_status(worktree, request_id, None)? })
}

/// Opens the conflicted `path` in `worktree_path` for the resolver. See [`open_conflict`].
#[tauri::command]
pub async fn git_conflict_open(worktree_path: String, path: String) -> Result<ConflictFile, GitError> {
    tokio::task::spawn_blocking(move || open_conflict(Path::new(&worktree_path), &path))
        .await
        .map_err(|e| other(format!("could not open the conflict: {e}")))?
}

/// Saves `text` as the Result of `path`, unless `token` is stale. See [`save_conflict`].
#[tauri::command]
pub async fn git_conflict_save(
    worktree_path: String,
    path: String,
    token: String,
    text: String,
    locks: tauri::State<'_, StagingLocks>,
) -> Result<ConflictFile, GitError> {
    let locks = locks.inner();
    // A held index.lock keeps git waiting between tries, so keep it off the async runtime's threads.
    tokio::task::block_in_place(|| save_conflict(locks, Path::new(&worktree_path), &path, &token, &text))
}

/// Puts `path` back to git's conflict markers, after backing it up. See [`reset_conflict`]; the
/// resolver confirms first.
#[tauri::command]
pub async fn git_conflict_reset(
    worktree_path: String,
    path: String,
    token: String,
    locks: tauri::State<'_, StagingLocks>,
) -> Result<ConflictReset, GitError> {
    let locks = locks.inner();
    tokio::task::block_in_place(|| reset_conflict(locks, Path::new(&worktree_path), &path, &token))
}

/// Keeps one whole side of `path` and stages it. See [`take_side`]; the resolver confirms first.
#[tauri::command]
pub async fn git_conflict_take_side(
    worktree_path: String,
    request_id: u32,
    path: String,
    token: String,
    side: ConflictSide,
    locks: tauri::State<'_, StagingLocks>,
) -> Result<TakeSideResult, GitError> {
    let locks = locks.inner();
    tokio::task::block_in_place(|| take_side(locks, Path::new(&worktree_path), request_id, &path, &token, side))
}
