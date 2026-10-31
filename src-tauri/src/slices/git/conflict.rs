//! The three-pane resolver's backend (#352, #390), and the side-picker cards' for the conflicts it
//! can't edit as text (#391). [`open_conflict`] reads a conflicted file's
//! stage 2 (left) and stage 3 (right) blobs and its worktree bytes, whose conflict markers seed the
//! editable Result. Rust never parses those markers: the frontend's `parseConflicts` does.
//!
//! Every write re-checks the [`ConflictFile::token`], which pins the stage 1, 2 and 3 oids and the
//! worktree's file bytes or link target, and refuses with [`GitError::ConflictStale`] when git or an agent changed
//! any of them since the file was opened. Writes run in the worktree's staging slot, and Topos never
//! writes the index directly: take-whole-side and Mark resolved stage through `git add`, and Remove
//! runs `git rm`. Before take-whole-side, Remove or Reset file replaces what the worktree holds, it
//! is stored as a blob, as a discard stores it (#387). A submodule's conflict gets none of these
//! writes: it is resolved inside the submodule.

use std::path::Path;

use serde::{Deserialize, Serialize};

use super::diff::{other, run_read, TOO_LARGE_BYTES};
use super::discard::{back_up, blob_bytes, hash_files, inside_worktree, link_inside_worktree, run_piped, write_file, Blobs, DiscardBackup};
use super::error::GitError;
use super::operation::{conflict_kind, ConflictKind};
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
    /// git's two status letters for the stages it has, such as `UU` or `UD`.
    pub xy: String,
    /// Which conflict the stages make, as `xy` names it; the side-picker cards switch on it.
    pub kind: ConflictKind,
    /// Whether the worktree holds a file or link at the path.
    pub on_disk: bool,
    /// Stage 2's object id, a commit for a submodule, or null when the left side has none.
    pub left_oid: Option<String>,
    /// Stage 3's object id, or null when the right side has none.
    pub right_oid: Option<String>,
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

/// What the worktree holds at a conflicted path.
#[derive(Debug, Clone, PartialEq, Eq)]
enum WorktreeFile {
    /// A file, by the blob id of its bytes.
    Blob(String),
    /// A symbolic link, by the blob id of the target it names.
    Link(String),
    /// A folder, such as a submodule's checkout.
    Folder,
    Missing,
}

impl WorktreeFile {
    /// What `path` holds. The path, and the folders on the way, must stay inside the worktree; a
    /// link at `path` is read but never followed.
    fn read(worktree: &Path, path: &str) -> Result<Self, GitError> {
        let target = link_inside_worktree(worktree, path)?;
        match std::fs::symlink_metadata(&target) {
            Ok(meta) if meta.file_type().is_symlink() => Ok(Self::Link(link_blob(worktree, &target, Blobs::IdsOnly)?)),
            Ok(meta) if meta.is_dir() => Ok(Self::Folder),
            _ => Ok(hash_files(worktree, &[path], Blobs::IdsOnly)?.remove(0).map_or(Self::Missing, Self::Blob)),
        }
    }

    /// Its part of the token.
    fn token_part(&self) -> String {
        match self {
            Self::Blob(oid) => oid.clone(),
            Self::Link(oid) => format!("link {oid}"),
            Self::Folder => "folder".into(),
            Self::Missing => "-".into(),
        }
    }

    /// The blob id a backup and its `after` record: the file's bytes or the link's target.
    fn blob(self) -> Option<String> {
        match self {
            Self::Blob(oid) | Self::Link(oid) => Some(oid),
            Self::Folder | Self::Missing => None,
        }
    }
}

/// The blob id of the target the symbolic link `link` names, as git stores a link, stored in the
/// object database with [`Blobs::Store`].
fn link_blob(worktree: &Path, link: &Path, blobs: Blobs) -> Result<String, GitError> {
    let target = std::fs::read_link(link).map_err(|e| other(format!("could not read the link {}: {e}", link.display())))?;
    // git keeps `/` separators in a link's target on every platform.
    let target = target.to_string_lossy().replace('\\', "/");
    let mut args = vec!["hash-object"];
    if blobs == Blobs::Store {
        args.push("-w");
    }
    args.push("--stdin");
    let printed = run_piped(worktree, &args, target.into_bytes())?;
    Ok(String::from_utf8_lossy(&printed).trim().to_string())
}

/// Stores what `path` holds, a file's bytes or a link's target, as a blob before a card or Reset
/// file replaces it, the way a discard backs up (#387). Fails, so that nothing changes, when it
/// can't be stored. None when the worktree holds nothing there.
fn back_up_conflict(worktree: &Path, path: &str) -> Result<Option<String>, GitError> {
    let target = link_inside_worktree(worktree, path)?;
    if std::fs::symlink_metadata(&target).is_ok_and(|m| m.file_type().is_symlink()) {
        return link_blob(worktree, &target, Blobs::Store)
            .map(Some)
            .map_err(|e| other(format!("could not back up the link, so nothing was changed: {e}")));
    }
    Ok(back_up(worktree, &[path])?.remove(0))
}

/// The backup of `path` from the blob stored before the write and what the worktree holds now.
fn conflict_backup(worktree: &Path, path: &str, blob: Option<String>) -> Result<DiscardBackup, GitError> {
    Ok(DiscardBackup { path: path.to_string(), blob, after: WorktreeFile::read(worktree, path)?.blob() })
}

/// The token for these stages and the worktree file.
fn token(stages: &Stages, file: &WorktreeFile) -> String {
    let oid = |s: &Option<Stage>| s.as_ref().map_or("-", |s| s.oid.as_str()).to_string();
    format!("{}:{}:{}:{}", oid(&stages[0]), oid(&stages[1]), oid(&stages[2]), file.token_part())
}

/// Text as the resolver edits it, and how to put the file's bytes back.
struct Decoded {
    /// Without a BOM and with `\n` endings.
    text: String,
    eol: Eol,
    bom: bool,
}

/// `bytes` as text without a BOM and with `\n` endings, with its ending and whether it had a BOM,
/// or why it can't be edited.
fn decode(bytes: &[u8]) -> Result<Decoded, NotEditable> {
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
        (0, _) => Ok(Decoded { text: text.to_string(), eol: Eol::Lf, bom }),
        (_, 0) => Ok(Decoded { text: text.replace("\r\n", "\n"), eol: Eol::Crlf, bom }),
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

/// Both sides' texts and the worktree file's.
struct Texts {
    left: String,
    right: String,
    result: Decoded,
}

/// Both sides' texts and the worktree file's, or why the file can't be edited as text.
fn read_texts(worktree: &Path, path: &str, stages: &Stages, file: &WorktreeFile) -> Result<Result<Texts, NotEditable>, GitError> {
    let (Some(left), Some(right)) = (&stages[1], &stages[2]) else { return Ok(Err(NotEditable::OneSideMissing)) };
    let all = || stages.iter().flatten();
    if all().any(|s| s.mode == SUBMODULE_MODE) {
        return Ok(Err(NotEditable::Submodule));
    }
    if matches!(file, WorktreeFile::Link(_)) || all().any(|s| s.mode == SYMLINK_MODE) {
        return Ok(Err(NotEditable::Symlink));
    }
    if matches!(file, WorktreeFile::Missing | WorktreeFile::Folder) {
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
            Ok(side) => sides.push(side.text),
            Err(reason) => return Ok(Err(reason)),
        }
    }
    let right = sides.pop().unwrap_or_default();
    let left = sides.pop().unwrap_or_default();
    Ok(Ok(Texts { left, right, result }))
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
    let worktree_file = WorktreeFile::read(worktree, path)?;
    let Some(stages) = read_stages(worktree, path)? else { return Ok(None) };
    let (kind, xy) = conflict_kind(stages[0].is_some(), stages[1].is_some(), stages[2].is_some());
    let mut file = ConflictFile {
        path: path.to_string(),
        xy: xy.to_string(),
        kind,
        on_disk: worktree_file != WorktreeFile::Missing,
        left_oid: stages[1].as_ref().map(|s| s.oid.clone()),
        right_oid: stages[2].as_ref().map(|s| s.oid.clone()),
        token: token(&stages, &worktree_file),
        editable: false,
        reason: None,
        left: None,
        right: None,
        result: None,
        eol: Eol::Lf,
        bom: false,
        marker_size: marker_size(worktree, path)?,
    };
    match read_texts(worktree, path, &stages, &worktree_file)? {
        Ok(texts) => {
            file.editable = true;
            file.left = Some(texts.left);
            file.right = Some(texts.right);
            file.result = Some(texts.result.text);
            file.eol = texts.result.eol;
            file.bom = texts.result.bom;
        }
        Err(reason) => file.reason = Some(reason),
    }
    Ok(Some(file))
}

/// The mode git gives a submodule's entry.
const SUBMODULE_MODE: &str = "160000";
/// The index mode git gives a symbolic link.
const SYMLINK_MODE: &str = "120000";

/// Refuses a card write on a submodule, whose conflict is resolved inside the submodule: Topos
/// never points its entry at a commit itself.
fn refuse_submodule(path: &str, stages: &Stages) -> Result<(), GitError> {
    if stages.iter().flatten().any(|s| s.mode == SUBMODULE_MODE) {
        return Err(other(format!("{path} is a submodule; resolve it inside the submodule, in a terminal or with an agent")));
    }
    Ok(())
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
/// when `token` no longer matches the file, so it never overwrites what git or an agent changed.
/// The text gets the file's line ending and BOM back, and is written atomically, so a crash leaves
/// the old file or the new one, never half of it.
pub fn save_conflict(locks: &StagingLocks, worktree: &Path, path: &str, token: &str, text: &str) -> Result<ConflictFile, GitError> {
    let _slot = locks.begin(worktree)?;
    locks.refuse_handed_off(worktree, Some(&[path]))?;
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
    locks.refuse_handed_off(worktree, Some(&[path]))?;
    link_inside_worktree(worktree, path)?;
    recheck(worktree, path, token)?;
    let blob = back_up_conflict(worktree, path)?;
    run_write(worktree, &["checkout", "-m"], Some(&[path]))?;
    let backup = conflict_backup(worktree, path, blob)?;
    Ok(ConflictReset { file: open_conflict(worktree, path)?, backup })
}

/// Which side take-whole-side keeps: stage 2 (git's "ours") or stage 3 ("theirs").
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConflictSide {
    Left,
    Right,
}

/// What take-whole-side or Remove did: the backup of what it replaced, and the post-write status.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictWriteResult {
    pub backup: DiscardBackup,
    pub status: WorktreeStatus,
}

/// Take-whole-side (#390): keeps `side` of the conflicted `path` as it stands in its stage
/// (`git checkout --ours|--theirs`), then marks it resolved through the inspector's own `git add`
/// path, in the worktree's staging slot. The file's bytes, or a link's target, are stored as a blob
/// first, as Reset file stores them. It refuses with [`GitError::ConflictStale`] when `token` no
/// longer matches, and refuses a side that deleted the file and a submodule, changing nothing.
/// Returns the backup and the status answering `request_id`.
pub fn take_side(
    locks: &StagingLocks,
    worktree: &Path,
    request_id: u32,
    path: &str,
    token: &str,
    side: ConflictSide,
) -> Result<ConflictWriteResult, GitError> {
    let _slot = locks.begin(worktree)?;
    locks.refuse_handed_off(worktree, Some(&[path]))?;
    link_inside_worktree(worktree, path)?;
    recheck(worktree, path, token)?;
    let (index, word, flag) = match side {
        ConflictSide::Left => (1, "left", "--ours"),
        ConflictSide::Right => (2, "right", "--theirs"),
    };
    let stages = read_stages(worktree, path)?.ok_or(GitError::ConflictStale)?;
    refuse_submodule(path, &stages)?;
    if stages[index].is_none() {
        return Err(other(format!("{path} has no {word} side to keep: that side deleted it")));
    }
    let blob = back_up_conflict(worktree, path)?;
    run_write(worktree, &["checkout", flag], Some(&[path]))?;
    write_stage(worktree, &PathTarget::Paths { paths: vec![path.to_string()] })?;
    let backup = conflict_backup(worktree, path, blob)?;
    Ok(ConflictWriteResult { backup, status: read_status(worktree, request_id, None)? })
}

/// Remove, or Accept deletion (#391): takes the conflicted `path` out of the index and the
/// worktree (`git rm`), in the worktree's staging slot. A file or link on disk is stored as a blob
/// first, as take-whole-side stores it, and nothing changes if that fails. It refuses with
/// [`GitError::ConflictStale`] when `token` no longer matches, and refuses a submodule. Returns the
/// backup and the status answering `request_id`.
pub fn remove_conflict(locks: &StagingLocks, worktree: &Path, request_id: u32, path: &str, token: &str) -> Result<ConflictWriteResult, GitError> {
    let _slot = locks.begin(worktree)?;
    locks.refuse_handed_off(worktree, Some(&[path]))?;
    link_inside_worktree(worktree, path)?;
    recheck(worktree, path, token)?;
    refuse_submodule(path, &read_stages(worktree, path)?.ok_or(GitError::ConflictStale)?)?;
    let blob = back_up_conflict(worktree, path)?;
    // `-f`: the bytes are backed up, and an unmerged file never matches the index.
    run_write(worktree, &["rm", "-q", "-f"], Some(&[path]))?;
    let backup = conflict_backup(worktree, path, blob)?;
    Ok(ConflictWriteResult { backup, status: read_status(worktree, request_id, None)? })
}

/// Mark resolved (#390): stages the conflicted `path` as it stands on disk through the inspector's
/// own `git add` path, in the worktree's staging slot. It refuses with [`GitError::ConflictStale`],
/// staging nothing, when `token` no longer matches, so bytes git or an agent wrote after the
/// resolver last read the file are never staged unseen. Returns the status answering `request_id`.
pub fn mark_resolved(locks: &StagingLocks, worktree: &Path, request_id: u32, path: &str, token: &str) -> Result<WorktreeStatus, GitError> {
    let _slot = locks.begin(worktree)?;
    locks.refuse_handed_off(worktree, Some(&[path]))?;
    link_inside_worktree(worktree, path)?;
    recheck(worktree, path, token)?;
    write_stage(worktree, &PathTarget::Paths { paths: vec![path.to_string()] })?;
    read_status(worktree, request_id, None)
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
) -> Result<ConflictWriteResult, GitError> {
    let locks = locks.inner();
    tokio::task::block_in_place(|| take_side(locks, Path::new(&worktree_path), request_id, &path, &token, side))
}

/// Takes `path` out of the index and the worktree, after backing it up. See [`remove_conflict`];
/// the card confirms first.
#[tauri::command]
pub async fn git_conflict_remove(
    worktree_path: String,
    request_id: u32,
    path: String,
    token: String,
    locks: tauri::State<'_, StagingLocks>,
) -> Result<ConflictWriteResult, GitError> {
    let locks = locks.inner();
    tokio::task::block_in_place(|| remove_conflict(locks, Path::new(&worktree_path), request_id, &path, &token))
}

/// Stages `path` as resolved, unless `token` is stale. See [`mark_resolved`].
#[tauri::command]
pub async fn git_conflict_mark_resolved(
    worktree_path: String,
    request_id: u32,
    path: String,
    token: String,
    locks: tauri::State<'_, StagingLocks>,
) -> Result<WorktreeStatus, GitError> {
    let locks = locks.inner();
    tokio::task::block_in_place(|| mark_resolved(locks, Path::new(&worktree_path), request_id, &path, &token))
}
