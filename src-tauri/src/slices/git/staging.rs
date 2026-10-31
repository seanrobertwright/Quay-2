//! The staging inspector's backend (#382): the selected worktree's status, and staging and
//! unstaging whole files and folders. Every git process starts from the op runner's
//! [`headless_git`]. Each write returns the post-write status, so the inspector never guesses one.
//!
//! These are capped `invoke` calls (#350), like the graph's reads, not streaming ops: #367 gives an
//! op id and a `Channel<OpEvent>` to the network operations, and #366 gives Cancel to hooks. So
//! they skip [`super::op_runner::GitOps::run`], which also has no way to feed pathspecs on stdin.

use std::collections::HashSet;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use super::error::GitError;
use super::hand_off::HandOffs;
use super::op_runner::headless_git;

/// The most status entries one read returns (#366). The inspector shows "Showing the first 10,000
/// changes" past it, and Stage all and Unstage all still act on every change.
pub const STATUS_CAP: usize = 10_000;

/// How many times a write runs while another git process holds `index.lock`, and the wait between
/// tries, before it reports [`GitError::IndexLocked`].
const INDEX_LOCK_ATTEMPTS: u32 = 5;
const INDEX_LOCK_WAIT: Duration = Duration::from_millis(200);

/// What a status entry is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum EntryKind {
    /// A tracked file changed in the index, the worktree or both.
    Tracked,
    /// An untracked file.
    Untracked,
    /// An untracked folder `-unormal` folded into one row; its path has no trailing `/`.
    UntrackedFolder,
    /// A file with unmerged stages.
    Unmerged,
}

/// One changed path, as `git status --porcelain=v2` reports it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusEntry {
    /// The path relative to the worktree root, with `/` separators.
    pub path: String,
    /// git's two status letters: the index side, then the worktree side, `.` for unchanged and
    /// `??` for untracked.
    pub xy: String,
    pub kind: EntryKind,
}

/// The selected worktree's status, as the frontend receives it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeStatus {
    /// The frontend's id for the request this answers, so it can drop an answer a newer request
    /// has overtaken.
    pub request_id: u32,
    /// At most [`STATUS_CAP`] entries, in git's order.
    pub entries: Vec<StatusEntry>,
    /// Every entry git reported, including those past the cap.
    pub total: u32,
    /// Whether entries past the cap were left out.
    pub truncated: bool,
}

/// What a stage or unstage acts on: every change in the worktree, or the listed paths.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PathTarget {
    All,
    Paths { paths: Vec<String> },
}

/// The worktrees with a staging operation running. At most one runs per worktree: a second is
/// refused with [`GitError::StagingBusy`] until the first's [`StagingGuard`] drops.
#[derive(Default)]
pub struct StagingLocks {
    busy: Mutex<HashSet<String>>,
    /// The conflicted files handed to an agent, which every write here refuses (#392).
    pub(super) hand_offs: HandOffs,
    /// One network operation per repo, which the local ref operations wait behind (#395).
    pub(super) network: super::remote_ops::NetworkLocks,
}

/// Holds a worktree's staging slot until it drops.
pub struct StagingGuard<'a> {
    locks: &'a StagingLocks,
    key: String,
}

impl Drop for StagingGuard<'_> {
    fn drop(&mut self) {
        self.locks.busy.lock().unwrap_or_else(|e| e.into_inner()).remove(&self.key);
    }
}

/// One spelling for each worktree folder, so two spellings of it share a slot.
pub(super) fn worktree_key(worktree: &Path) -> String {
    let path = worktree.canonicalize().unwrap_or_else(|_| worktree.to_path_buf());
    let key = path.to_string_lossy().into_owned();
    if cfg!(windows) {
        key.to_lowercase()
    } else {
        key
    }
}

impl StagingLocks {
    /// Takes `worktree`'s staging slot, or refuses while another operation holds it.
    pub fn begin(&self, worktree: &Path) -> Result<StagingGuard<'_>, GitError> {
        let key = worktree_key(worktree);
        let mut busy = self.busy.lock().unwrap_or_else(|e| e.into_inner());
        if !busy.insert(key.clone()) {
            return Err(GitError::StagingBusy);
        }
        Ok(StagingGuard { locks: self, key })
    }

    /// Takes the repo's network lock, waiting while a fetch, pull or push holds it, and then
    /// `worktree`'s staging slot, for a local ref operation (#393, #394, #395). The network lock
    /// comes first, as it does for a pull, so the two can never wait on each other.
    pub fn begin_ref_write(
        &self,
        worktree: &Path,
        cancel: &std::sync::atomic::AtomicBool,
        channel: &tauri::ipc::Channel<super::op_runner::OpEvent>,
    ) -> Result<(super::remote_ops::NetworkGuard<'_>, StagingGuard<'_>), GitError> {
        let network = self.network.hold(worktree, cancel, channel)?;
        Ok((network, self.begin(worktree)?))
    }

    /// Refuses with [`GitError::HandedOff`] when an agent holds a conflicted file in `worktree`
    /// that a write to `paths`, files or folders, would reach; with `None` the write reaches every
    /// file. See [`super::hand_off`].
    pub fn refuse_handed_off(&self, worktree: &Path, paths: Option<&[&str]>) -> Result<(), GitError> {
        self.hand_offs.refuse(worktree, paths)
    }
}

impl PathTarget {
    /// The listed paths, or None for every change.
    pub(super) fn paths(&self) -> Option<Vec<&str>> {
        match self {
            PathTarget::All => None,
            PathTarget::Paths { paths } => Some(paths.iter().map(String::as_str).collect()),
        }
    }
}

/// A headless git in `worktree` with literal pathspecs and `LC_ALL=C`, so a path is never a glob
/// and stderr can be matched.
pub(super) fn worktree_git(worktree: &Path) -> Command {
    let mut git = headless_git();
    git.current_dir(worktree).env("GIT_LITERAL_PATHSPECS", "1").env("LC_ALL", "C");
    git
}

/// One `--porcelain=v2 -z` record. A rename or copy (`2`) carries its original path in the next
/// NUL-terminated field, which `next_field` reads so the stream stays aligned.
fn parse_record(record: &[u8], next_field: &mut impl FnMut() -> Option<Vec<u8>>) -> Option<StatusEntry> {
    let text = String::from_utf8_lossy(record);
    let (kind, rest) = text.split_at_checked(1)?;
    let rest = rest.strip_prefix(' ')?;
    // The path is the last field, after this many space-separated ones (XY first).
    let tracked = |fields: usize, kind: EntryKind| {
        let mut f = rest.splitn(fields + 1, ' ');
        let xy = f.next()?.to_string();
        let path = f.nth(fields - 1)?.to_string();
        Some(StatusEntry { path, xy, kind })
    };
    match kind {
        // XY sub mH mI mW hH hI path
        "1" => tracked(7, EntryKind::Tracked),
        // XY sub mH mI mW hH hI Xscore path, then the original path
        "2" => {
            next_field()?;
            tracked(8, EntryKind::Tracked)
        }
        // XY sub m1 m2 m3 mW h1 h2 h3 path
        "u" => tracked(9, EntryKind::Unmerged),
        "?" => Some(match rest.strip_suffix('/') {
            Some(folder) => StatusEntry { path: folder.to_string(), xy: "??".into(), kind: EntryKind::UntrackedFolder },
            None => StatusEntry { path: rest.to_string(), xy: "??".into(), kind: EntryKind::Untracked },
        }),
        _ => None,
    }
}

/// The status of `worktree` (#350, #366): `git --no-optional-locks status --porcelain=v2 -z`, with
/// untracked folders folded into one row (`-unormal`). With `folder`, it lists that untracked
/// folder's files one by one (`-uall`) and nothing else. Either way it keeps the first
/// [`STATUS_CAP`] entries and counts the rest, reading git's output as it streams.
pub fn read_status(worktree: &Path, request_id: u32, folder: Option<&str>) -> Result<WorktreeStatus, GitError> {
    let mut git = worktree_git(worktree);
    git.args(["--no-optional-locks", "status", "--porcelain=v2", "-z", "--no-renames"]);
    match folder {
        Some(folder) => {
            let folder = parse_rel_path(folder)?;
            git.args(["-uall", "--", &format!("{folder}/")]);
        }
        None => {
            git.arg("-unormal");
        }
    }
    git.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = git.spawn().map_err(|e| GitError::Other { stderr: format!("could not run git: {e}") })?;
    let stderr = child.stderr.take().map(|mut err| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            let _ = err.read_to_end(&mut buf);
            buf
        })
    });
    let mut entries = Vec::new();
    let mut total: u32 = 0;
    if let Some(out) = child.stdout.take() {
        let mut reader = BufReader::new(out);
        let mut read_field = move || {
            let mut field = Vec::new();
            match reader.read_until(0, &mut field) {
                Ok(0) | Err(_) => None,
                Ok(_) => {
                    if field.last() == Some(&0) {
                        field.pop();
                    }
                    Some(field)
                }
            }
        };
        while let Some(record) = read_field() {
            let Some(entry) = parse_record(&record, &mut read_field) else { continue };
            total += 1;
            if entries.len() < STATUS_CAP {
                entries.push(entry);
            }
        }
    }
    let status = child.wait().map_err(|e| GitError::Other { stderr: format!("could not wait for git: {e}") })?;
    let stderr = stderr.and_then(|h| h.join().ok()).unwrap_or_default();
    if !status.success() {
        return Err(GitError::Other { stderr: String::from_utf8_lossy(&stderr).trim().to_string() });
    }
    let truncated = total as usize > entries.len();
    Ok(WorktreeStatus { request_id, entries, total, truncated })
}

/// A path relative to the worktree root as git prints it, without a trailing `/`. Refused when it
/// is empty, absolute, holds a NUL or a drive colon, or has an empty, `.` or `..` component.
pub(super) fn parse_rel_path(path: &str) -> Result<&str, GitError> {
    let trimmed = path.strip_suffix('/').unwrap_or(path);
    let bad = trimmed.is_empty()
        || trimmed.contains('\0')
        || trimmed.starts_with('/')
        || Path::new(trimmed).is_absolute()
        || trimmed.contains(':')
        || trimmed.split(['/', '\\']).any(|part| part == ".." || part == "." || part.is_empty());
    if bad {
        return Err(GitError::Other { stderr: format!("not a path inside the worktree: {path:?}") });
    }
    Ok(trimmed)
}

/// The listed paths, each checked by [`parse_rel_path`], refusing an empty list.
fn parse_paths(paths: &[String]) -> Result<Vec<&str>, GitError> {
    if paths.is_empty() {
        return Err(GitError::Other { stderr: "no paths to stage or unstage".into() });
    }
    paths.iter().map(|p| parse_rel_path(p)).collect()
}

/// Runs a git write in `worktree`, feeding `pathspecs` NUL-separated on stdin for
/// `--pathspec-from-file=- --pathspec-file-nul`, so no list of paths outgrows a command line.
/// While another process holds `index.lock` it tries again, [`INDEX_LOCK_ATTEMPTS`] times in all,
/// and then reports [`GitError::IndexLocked`]. It never touches the lock itself.
pub(super) fn run_write(worktree: &Path, args: &[&str], pathspecs: Option<&[&str]>) -> Result<(), GitError> {
    match pathspecs {
        None => run_write_input(worktree, args, None),
        Some(specs) => {
            let mut input = Vec::new();
            for spec in specs {
                input.extend_from_slice(spec.as_bytes());
                input.push(0);
            }
            let mut args = args.to_vec();
            args.extend(["--pathspec-from-file=-", "--pathspec-file-nul"]);
            run_write_input(worktree, &args, Some(&input))
        }
    }
}

/// Runs a git write in `worktree` with `input` on its stdin, retrying a held `index.lock` the way
/// [`run_write`] does.
pub(super) fn run_write_input(worktree: &Path, args: &[&str], input: Option<&[u8]>) -> Result<(), GitError> {
    let mut attempt = 1;
    loop {
        let mut git = worktree_git(worktree);
        git.args(args).stdout(Stdio::null()).stderr(Stdio::piped());
        git.stdin(if input.is_some() { Stdio::piped() } else { Stdio::null() });
        let mut child = git.spawn().map_err(|e| GitError::Other { stderr: format!("could not run git: {e}") })?;
        if let (Some(input), Some(mut stdin)) = (input, child.stdin.take()) {
            // A git that fails early closes its stdin; its stderr says why.
            let _ = stdin.write_all(input);
        }
        let out = child.wait_with_output().map_err(|e| GitError::Other { stderr: format!("could not wait for git: {e}") })?;
        if out.status.success() {
            return Ok(());
        }
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        if !stderr.contains("index.lock") {
            return Err(GitError::Other { stderr });
        }
        if attempt == INDEX_LOCK_ATTEMPTS {
            return Err(GitError::IndexLocked);
        }
        attempt += 1;
        std::thread::sleep(INDEX_LOCK_WAIT);
    }
}

/// Stages `target` in `worktree` as whole files and folders (`git add -A`), so additions,
/// modifications and deletions all land, and returns the post-write status. `All` stages every
/// change, including those past the status cap.
pub fn stage_paths(locks: &StagingLocks, worktree: &Path, request_id: u32, target: &PathTarget) -> Result<WorktreeStatus, GitError> {
    let _slot = locks.begin(worktree)?;
    locks.refuse_handed_off(worktree, target.paths().as_deref())?;
    write_stage(worktree, target)?;
    read_status(worktree, request_id, None)
}

/// The write [`stage_paths`] makes, for a caller that already holds the worktree's staging slot.
pub(super) fn write_stage(worktree: &Path, target: &PathTarget) -> Result<(), GitError> {
    match target {
        PathTarget::All => run_write(worktree, &["add", "-A"], None),
        PathTarget::Paths { paths } => run_write(worktree, &["add", "-A"], Some(&parse_paths(paths)?)),
    }
}

/// Whether `worktree`'s HEAD names a commit; on an unborn branch it doesn't.
pub(super) fn has_head(worktree: &Path) -> bool {
    worktree_git(worktree)
        .args(["rev-parse", "--verify", "--quiet", "HEAD"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
}

/// Unstages `target` in `worktree`, putting the index back to HEAD for those paths (`git reset`),
/// and returns the post-write status. A path absent from HEAD leaves the index entirely. On an
/// unborn branch, with no HEAD to go back to, the paths leave the index (`git rm --cached`).
/// `All` unstages every change, including those past the status cap.
pub fn unstage_paths(locks: &StagingLocks, worktree: &Path, request_id: u32, target: &PathTarget) -> Result<WorktreeStatus, GitError> {
    let _slot = locks.begin(worktree)?;
    locks.refuse_handed_off(worktree, target.paths().as_deref())?;
    write_unstage(worktree, target)?;
    read_status(worktree, request_id, None)
}

/// The write [`unstage_paths`] makes, for a caller that already holds the worktree's staging slot.
pub(super) fn write_unstage(worktree: &Path, target: &PathTarget) -> Result<(), GitError> {
    match (target, has_head(worktree)) {
        (PathTarget::All, true) => run_write(worktree, &["reset", "-q"], None),
        (PathTarget::All, false) => run_write(worktree, &["rm", "--cached", "-r", "-q", "--ignore-unmatch", "--", "."], None),
        (PathTarget::Paths { paths }, true) => run_write(worktree, &["reset", "-q"], Some(&parse_paths(paths)?)),
        (PathTarget::Paths { paths }, false) => {
            run_write(worktree, &["rm", "--cached", "-r", "-q", "--ignore-unmatch"], Some(&parse_paths(paths)?))
        }
    }
}

/// `folder` as a `.gitignore` line that matches that folder alone: anchored to the root with a
/// leading `/`, ending in `/`, with the characters gitignore treats as patterns escaped.
fn ignore_line(folder: &str) -> String {
    let mut line = String::from("/");
    for c in folder.chars() {
        if matches!(c, '\\' | '*' | '?' | '[' | '!' | '#') {
            line.push('\\');
        }
        line.push(c);
    }
    // gitignore drops trailing spaces unless they are escaped.
    let kept = line.trim_end_matches(' ').len();
    let trailing = line.len() - kept;
    line.truncate(kept);
    line.push_str(&"\\ ".repeat(trailing));
    line.push('/');
    line
}

/// Adds the untracked `folder` to the worktree root's `.gitignore`, creating it if needed, and
/// returns the post-write status. It runs in the worktree's staging slot, since it changes what the
/// lists show.
pub fn ignore_folder(locks: &StagingLocks, worktree: &Path, request_id: u32, folder: &str) -> Result<WorktreeStatus, GitError> {
    let _slot = locks.begin(worktree)?;
    let folder = parse_rel_path(folder)?;
    let file = worktree.join(".gitignore");
    let existing = match std::fs::read(&file) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
        Err(e) => return Err(GitError::Other { stderr: format!("could not read .gitignore: {e}") }),
    };
    let mut out = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&file)
        .map_err(|e| GitError::Other { stderr: format!("could not open .gitignore: {e}") })?;
    let mut text = String::new();
    if !existing.is_empty() && !existing.ends_with(b"\n") {
        text.push('\n');
    }
    text.push_str(&ignore_line(folder));
    text.push('\n');
    out.write_all(text.as_bytes()).map_err(|e| GitError::Other { stderr: format!("could not write .gitignore: {e}") })?;
    // Windows updates the size git's status reads only once the handle closes.
    drop(out);
    read_status(worktree, request_id, None)
}

/// The status of `worktree_path`, or with `folder` the files of that untracked folder alone. See
/// [`read_status`]. `request_id` comes back in the answer.
#[tauri::command]
pub async fn git_status(worktree_path: String, request_id: u32, folder: Option<String>) -> Result<WorktreeStatus, GitError> {
    tokio::task::spawn_blocking(move || read_status(Path::new(&worktree_path), request_id, folder.as_deref()))
        .await
        .map_err(|e| GitError::Other { stderr: format!("could not read the status: {e}") })?
}

/// Stages `target` in `worktree_path` and returns the post-write status. See [`stage_paths`].
#[tauri::command]
pub async fn git_stage_paths(
    worktree_path: String,
    request_id: u32,
    target: PathTarget,
    locks: tauri::State<'_, StagingLocks>,
) -> Result<WorktreeStatus, GitError> {
    let locks = locks.inner();
    // A held index.lock keeps it waiting between tries, so keep it off the async runtime's threads.
    tokio::task::block_in_place(|| stage_paths(locks, Path::new(&worktree_path), request_id, &target))
}

/// Unstages `target` in `worktree_path` and returns the post-write status. See [`unstage_paths`].
#[tauri::command]
pub async fn git_unstage_paths(
    worktree_path: String,
    request_id: u32,
    target: PathTarget,
    locks: tauri::State<'_, StagingLocks>,
) -> Result<WorktreeStatus, GitError> {
    let locks = locks.inner();
    tokio::task::block_in_place(|| unstage_paths(locks, Path::new(&worktree_path), request_id, &target))
}

/// Adds the untracked `folder` to `worktree_path`'s `.gitignore` and returns the post-write status.
/// See [`ignore_folder`]; the inspector confirms first.
#[tauri::command]
pub async fn git_ignore_folder(
    worktree_path: String,
    request_id: u32,
    folder: String,
    locks: tauri::State<'_, StagingLocks>,
) -> Result<WorktreeStatus, GitError> {
    let locks = locks.inner();
    tokio::task::block_in_place(|| ignore_folder(locks, Path::new(&worktree_path), request_id, &folder))
}
