//! One file's diff for the staging inspector's diff view (#383), and staging it by hunk or mode
//! change (#350, #366).
//!
//! Diffs come from the plumbing `git add -p` reads: `diff-files` for the unstaged side,
//! `diff-index --cached` for the staged side and `diff-tree -p` for a commit, each with
//! `--full-index --no-ext-diff --no-color`, literal pathspecs and `LC_ALL=C`. The bytes are kept as
//! git wrote them, CR included, so a reduced patch built from them applies byte for byte.

use std::collections::hash_map::DefaultHasher;
use std::hash::Hasher;
use std::io::{BufRead, BufReader, Read};
use std::path::Path;
use std::process::{Command, Stdio};

use serde::{Deserialize, Serialize};

use super::error::GitError;
use super::staging::{
    has_head, parse_rel_path, read_status, run_write_input, worktree_git, write_stage, write_unstage, PathTarget, StagingLocks,
    WorktreeStatus,
};

/// Past either size the diff is `tooLarge`: its hunks are left out until the operator asks for
/// them with Load anyway, and it can still be staged whole.
pub const TOO_LARGE_BYTES: u64 = 1024 * 1024;
pub const TOO_LARGE_LINES: u32 = 20_000;

/// The most context lines a diff is read with.
pub const MAX_CONTEXT: u32 = 1_000;

/// Which diff of a file: the worktree against the index, the index against HEAD, or a commit
/// against a parent. A commit's diff is read-only.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum DiffSide {
    Unstaged,
    Staged,
    /// `oid` against `parent`, or against its own parent (an empty tree for a root commit) when
    /// `parent` is absent.
    Commit { oid: String, parent: Option<String> },
}

/// What the diff does to the file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FileChange {
    Modified,
    Added,
    Deleted,
    /// An untracked file, read against an empty file without touching the index.
    Untracked,
    /// This side has no change to the file.
    Unchanged,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LineKind {
    Context,
    Add,
    Del,
    /// git's `\ No newline at end of file` after the line above it.
    NoNewline,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    pub kind: LineKind,
    /// The line without its leading marker and its `\n`. A CR before the `\n` stays.
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hunk {
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    /// What git prints after the second `@@`, often the enclosing function.
    pub heading: String,
    pub lines: Vec<DiffLine>,
}

/// A mode change, such as `100644` to `100755`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModeChange {
    pub old_mode: String,
    pub new_mode: String,
}

/// One file's diff on one side, as the diff view receives it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    /// The frontend's id for the request this answers, so it can drop an overtaken answer.
    pub request_id: u32,
    pub path: String,
    /// Pins the context, the old blob oid and the diff's bytes. Staging re-reads the diff and
    /// refuses with [`GitError::StaleDiff`] when the token differs.
    pub diff_token: String,
    pub change: FileChange,
    /// git found binary content, so only whole-file actions apply.
    pub binary: bool,
    /// A submodule's commit changed, so only whole-file actions apply.
    pub submodule: bool,
    /// The diff is past [`TOO_LARGE_BYTES`] or [`TOO_LARGE_LINES`] and its hunks were left out.
    pub too_large: bool,
    /// The diff's size in bytes and in hunk lines, whether or not its hunks are here.
    pub bytes: u64,
    pub line_count: u32,
    pub mode_change: Option<ModeChange>,
    /// The blob before and after, or null where the file is absent or the side is the worktree.
    pub old_oid: Option<String>,
    pub new_oid: Option<String>,
    pub hunks: Vec<Hunk>,
}

/// A hunk as git wrote it, for rebuilding a patch.
pub(super) struct RawHunk {
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    /// The bytes after the header's second `@@`, without the `\n`.
    pub heading: Vec<u8>,
    /// Each body line with its `\n`, or without one only at the very end of git's output.
    pub body: Vec<Vec<u8>>,
}

/// A parsed diff and the raw header lines a reduced patch is built from.
pub(super) struct ParsedDiff {
    pub diff_git: Option<Vec<u8>>,
    pub old_mode_line: Option<Vec<u8>>,
    pub new_mode_line: Option<Vec<u8>>,
    pub minus: Option<Vec<u8>>,
    pub plus: Option<Vec<u8>>,
    pub mode_change: Option<ModeChange>,
    pub new_file: bool,
    pub deleted_file: bool,
    pub submodule: bool,
    pub binary: bool,
    pub old_oid: Option<String>,
    pub new_oid: Option<String>,
    pub hunks: Vec<RawHunk>,
    pub bytes: u64,
    pub line_count: u32,
    /// Whether the hunk bodies were dropped for size.
    pub too_large: bool,
    /// An untracked file, read against an empty file.
    pub untracked: bool,
    hash: u64,
}

fn other(stderr: impl Into<String>) -> GitError {
    GitError::Other { stderr: stderr.into() }
}

/// What `git <args>` prints in `worktree`, or its stderr as the error when it fails.
fn run_read<const N: usize>(worktree: &Path, args: [&str; N]) -> Result<Vec<u8>, GitError> {
    let out = worktree_git(worktree)
        .args(args)
        .stdin(Stdio::null())
        .output()
        .map_err(|e| other(format!("could not run git: {e}")))?;
    if !out.status.success() {
        return Err(other(String::from_utf8_lossy(&out.stderr).trim().to_string()));
    }
    Ok(out.stdout)
}

fn strip_eol(line: &[u8]) -> &[u8] {
    line.strip_suffix(b"\n").unwrap_or(line)
}

/// `start[,count]` from a hunk header; a missing count is 1.
fn range(text: &str) -> Option<(u32, u32)> {
    match text.split_once(',') {
        Some((start, count)) => Some((start.parse().ok()?, count.parse().ok()?)),
        None => Some((text.parse().ok()?, 1)),
    }
}

/// `@@ -a,b +c,d @@ heading`, as (a, b, c, d, heading).
fn hunk_header(line: &[u8]) -> Option<(u32, u32, u32, u32, Vec<u8>)> {
    let rest = line.strip_prefix(b"@@ -")?;
    let end = rest.windows(3).position(|w| w == b" @@")?;
    let ranges = std::str::from_utf8(&rest[..end]).ok()?;
    let (old, new) = ranges.split_once(" +")?;
    let (os, ol) = range(old)?;
    let (ns, nl) = range(new)?;
    Some((os, ol, ns, nl, strip_eol(&rest[end + 3..]).to_vec()))
}

/// A full-length oid, or None for git's all-zero "absent" oid.
fn present_oid(oid: &str) -> Option<String> {
    (!oid.is_empty() && oid.bytes().any(|b| b != b'0')).then(|| oid.to_string())
}

fn text_after<'a>(line: &'a [u8], prefix: &str) -> Option<&'a str> {
    std::str::from_utf8(strip_eol(line).strip_prefix(prefix.as_bytes())?).ok()
}

/// Reads one file's diff from `out` as it streams. With `cap`, hunk bodies stop being kept once
/// the diff passes the size limits, though every byte still counts toward its size and token.
fn parse_diff(out: impl Read, cap: bool) -> std::io::Result<ParsedDiff> {
    let mut reader = BufReader::new(out);
    let mut d = ParsedDiff {
        diff_git: None,
        old_mode_line: None,
        new_mode_line: None,
        minus: None,
        plus: None,
        mode_change: None,
        new_file: false,
        deleted_file: false,
        submodule: false,
        binary: false,
        old_oid: None,
        new_oid: None,
        hunks: Vec::new(),
        bytes: 0,
        line_count: 0,
        too_large: false,
        untracked: false,
        hash: 0,
    };
    let mut hasher = DefaultHasher::new();
    let mut old_mode = None;
    let mut new_mode = None;
    let mut in_hunks = false;
    let mut line = Vec::new();
    loop {
        line.clear();
        if reader.read_until(b'\n', &mut line)? == 0 {
            break;
        }
        d.bytes += line.len() as u64;
        hasher.write(&line);
        if let Some((os, ol, ns, nl, heading)) = hunk_header(&line) {
            in_hunks = true;
            if !d.too_large {
                d.hunks.push(RawHunk { old_start: os, old_lines: ol, new_start: ns, new_lines: nl, heading, body: Vec::new() });
            }
            continue;
        }
        if in_hunks {
            d.line_count += 1;
            if cap && !d.too_large && (d.bytes > TOO_LARGE_BYTES || d.line_count > TOO_LARGE_LINES) {
                d.too_large = true;
                d.hunks = Vec::new();
            }
            if let Some(hunk) = d.hunks.last_mut().filter(|_| !d.too_large) {
                hunk.body.push(line.clone());
            }
            continue;
        }
        if line.starts_with(b"diff --git ") {
            d.diff_git = Some(line.clone());
        } else if let Some(mode) = text_after(&line, "old mode ") {
            old_mode = Some(mode.to_string());
            d.old_mode_line = Some(line.clone());
        } else if let Some(mode) = text_after(&line, "new mode ") {
            new_mode = Some(mode.to_string());
            d.new_mode_line = Some(line.clone());
        } else if let Some(mode) = text_after(&line, "new file mode ") {
            d.new_file = true;
            d.submodule |= mode == "160000";
        } else if let Some(mode) = text_after(&line, "deleted file mode ") {
            d.deleted_file = true;
            d.submodule |= mode == "160000";
        } else if let Some(index) = text_after(&line, "index ") {
            let (oids, mode) = index.split_once(' ').unwrap_or((index, ""));
            d.submodule |= mode == "160000";
            if let Some((old, new)) = oids.split_once("..") {
                d.old_oid = present_oid(old);
                d.new_oid = present_oid(new);
            }
        } else if line.starts_with(b"--- ") {
            d.minus = Some(line.clone());
        } else if line.starts_with(b"+++ ") {
            d.plus = Some(line.clone());
        } else if line.starts_with(b"Binary files ") || line.starts_with(b"GIT binary patch") {
            d.binary = true;
        }
    }
    d.submodule |= old_mode.as_deref() == Some("160000") || new_mode.as_deref() == Some("160000");
    if let (Some(old_mode), Some(new_mode)) = (old_mode, new_mode) {
        d.mode_change = Some(ModeChange { old_mode, new_mode });
    }
    d.hash = hasher.finish();
    Ok(d)
}

/// Runs a diff command and parses what it prints. `ok_codes` are the exit codes that mean success.
fn run_diff(mut git: Command, cap: bool, ok_codes: &[i32]) -> Result<ParsedDiff, GitError> {
    git.stdout(Stdio::piped()).stderr(Stdio::piped()).stdin(Stdio::null());
    let mut child = git.spawn().map_err(|e| other(format!("could not run git: {e}")))?;
    let stderr = child.stderr.take().map(|mut err| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            let _ = err.read_to_end(&mut buf);
            buf
        })
    });
    let parsed = child.stdout.take().map(|out| parse_diff(out, cap));
    let status = child.wait().map_err(|e| other(format!("could not wait for git: {e}")))?;
    let stderr = stderr.and_then(|h| h.join().ok()).unwrap_or_default();
    if !status.code().is_some_and(|c| ok_codes.contains(&c)) {
        return Err(other(String::from_utf8_lossy(&stderr).trim().to_string()));
    }
    match parsed {
        Some(Ok(parsed)) => Ok(parsed),
        Some(Err(e)) => Err(other(format!("could not read git's diff: {e}"))),
        None => Err(other("git printed no diff")),
    }
}

/// The tree an unborn branch's staged side is compared with.
fn empty_tree(worktree: &Path) -> Result<String, GitError> {
    let out = run_read(worktree, ["hash-object", "-t", "tree", "--stdin"])?;
    Ok(String::from_utf8_lossy(&out).trim().to_string())
}

/// An oid or ref the frontend passed for a commit diff: hex only, so it is never an option.
fn parse_oid(oid: &str) -> Result<&str, GitError> {
    if (4..=64).contains(&oid.len()) && oid.bytes().all(|b| b.is_ascii_hexdigit()) {
        Ok(oid)
    } else {
        Err(other(format!("not a commit id: {oid:?}")))
    }
}

/// The diff git prints for `path` on `side`, with `context` lines of context.
pub(super) fn read_parsed(worktree: &Path, path: &str, side: &DiffSide, context: u32, cap: bool) -> Result<ParsedDiff, GitError> {
    let mut git = worktree_git(worktree);
    git.arg("--no-optional-locks");
    let unified = format!("-U{context}");
    let common = ["-p", "--full-index", "--no-ext-diff", "--no-color", "--no-renames", unified.as_str()];
    match side {
        DiffSide::Unstaged => {
            git.arg("diff-files").args(common);
        }
        DiffSide::Staged => {
            let base = if has_head(worktree) { "HEAD".to_string() } else { empty_tree(worktree)? };
            git.args(["diff-index", "--cached"]).args(common).arg(base);
        }
        DiffSide::Commit { oid, parent } => {
            let oid = parse_oid(oid)?;
            git.arg("diff-tree").args(common);
            match parent {
                Some(parent) => git.args([parse_oid(parent)?, oid]),
                None => git.args(["--root", oid]),
            };
        }
    }
    git.args(["--", path]);
    let parsed = run_diff(git, cap, &[0])?;
    if *side == DiffSide::Unstaged && parsed.diff_git.is_none() && is_untracked_file(worktree, path)? {
        return read_untracked(worktree, path, &unified, cap);
    }
    Ok(parsed)
}

/// Whether `path` is a file in the worktree that the index doesn't hold.
fn is_untracked_file(worktree: &Path, path: &str) -> Result<bool, GitError> {
    if !worktree.join(path).is_file() {
        return Ok(false);
    }
    Ok(run_read(worktree, ["--no-optional-locks", "ls-files", "-z", "--", path])?.is_empty())
}

/// An untracked file's diff against an empty file (#366), read without touching the index.
fn read_untracked(worktree: &Path, path: &str, unified: &str, cap: bool) -> Result<ParsedDiff, GitError> {
    let mut git = worktree_git(worktree);
    git.args(["--no-optional-locks", "diff", "--no-index", "-p", "--full-index", "--no-ext-diff", "--no-color", unified]);
    git.args(["--", "/dev/null", path]);
    // `--no-index` exits 1 when the files differ.
    let mut parsed = run_diff(git, cap, &[0, 1])?;
    parsed.untracked = true;
    Ok(parsed)
}

/// The token pinning what `parsed` was read with and from.
fn diff_token(context: u32, parsed: &ParsedDiff) -> String {
    format!("{context}.{}.{:016x}", parsed.old_oid.as_deref().unwrap_or("0"), parsed.hash)
}

/// The context a token was read with, or None for a token this backend never made.
pub(super) fn token_context(token: &str) -> Option<u32> {
    token.split('.').next()?.parse().ok().filter(|c| *c <= MAX_CONTEXT)
}

fn view_line(raw: &[u8]) -> DiffLine {
    let raw = strip_eol(raw);
    let (kind, text) = match raw.first() {
        Some(b'+') => (LineKind::Add, &raw[1..]),
        Some(b'-') => (LineKind::Del, &raw[1..]),
        Some(b'\\') => (LineKind::NoNewline, &raw[1..]),
        Some(b' ') => (LineKind::Context, &raw[1..]),
        // `diff.suppressBlankEmpty` prints an empty context line as a bare newline.
        _ => (LineKind::Context, raw),
    };
    DiffLine { kind, text: String::from_utf8_lossy(text).into_owned() }
}

/// The diff view's shape of `parsed`.
fn file_diff(request_id: u32, path: &str, context: u32, parsed: &ParsedDiff) -> FileDiff {
    let change = if parsed.untracked {
        FileChange::Untracked
    } else if parsed.new_file {
        FileChange::Added
    } else if parsed.deleted_file {
        FileChange::Deleted
    } else if parsed.diff_git.is_none() {
        FileChange::Unchanged
    } else {
        FileChange::Modified
    };
    FileDiff {
        request_id,
        path: path.to_string(),
        diff_token: diff_token(context, parsed),
        change,
        binary: parsed.binary,
        submodule: parsed.submodule,
        too_large: parsed.too_large,
        bytes: parsed.bytes,
        line_count: parsed.line_count,
        mode_change: parsed.mode_change.clone(),
        old_oid: parsed.old_oid.clone(),
        new_oid: parsed.new_oid.clone(),
        hunks: parsed
            .hunks
            .iter()
            .map(|h| Hunk {
                old_start: h.old_start,
                old_lines: h.old_lines,
                new_start: h.new_start,
                new_lines: h.new_lines,
                heading: String::from_utf8_lossy(&h.heading).trim_start().to_string(),
                lines: h.body.iter().map(|l| view_line(l)).collect(),
            })
            .collect(),
    }
}

/// `path`'s diff on `side` in `worktree` (#350, #383), with `context` lines of context. Past the
/// size limits its hunks are left out unless `load_large`.
pub fn read_file_diff(
    worktree: &Path,
    request_id: u32,
    path: &str,
    side: &DiffSide,
    context: u32,
    load_large: bool,
) -> Result<FileDiff, GitError> {
    let path = parse_rel_path(path)?;
    if context > MAX_CONTEXT {
        return Err(other(format!("at most {MAX_CONTEXT} lines of context")));
    }
    let parsed = read_parsed(worktree, path, side, context, !load_large)?;
    Ok(file_diff(request_id, path, context, &parsed))
}

/// What a stage or unstage from the diff view acts on.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Selection {
    /// The whole file: its content, its mode and whether it exists.
    File,
    /// These hunks, by their index in the diff the token was read with.
    Hunks { hunks: Vec<u32> },
    /// Only the mode change.
    ModeChange,
    /// These changed lines, across any of the file's hunks.
    Lines { lines: Vec<LineRef> },
}

/// One line of a diff: its hunk's index and its index among that hunk's lines.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LineRef {
    pub hunk: u32,
    pub line: u32,
}

/// A stage from the unstaged side or an unstage from the staged side.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StageRequest {
    pub path: String,
    pub side: DiffSide,
    pub diff_token: String,
    pub selection: Selection,
    /// Whether the returned diff keeps the hunks of a `tooLarge` diff, after Load anyway.
    #[serde(default)]
    pub load_large: bool,
}

/// The file's diff on the same side after a stage or unstage, and the worktree's status.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StageResult {
    pub diff: FileDiff,
    pub status: WorktreeStatus,
}

/// Appends `line`, ending it with `\n` if git's output ended without one.
fn push_line(patch: &mut Vec<u8>, line: &[u8]) {
    patch.extend_from_slice(line);
    if !line.ends_with(b"\n") {
        patch.push(b'\n');
    }
}

/// Which sides of a hunk a body line counts on, as (old, new).
fn sides(marker: u8) -> (bool, bool) {
    match marker {
        b'+' => (false, true),
        b'-' => (true, false),
        _ => (true, true),
    }
}

/// Refuses a selection that keeps a line after a side's last line has ended without a newline.
fn after_last_line() -> GitError {
    other("that selection keeps a line after a last line with no newline; select the lines that give it one too")
}

/// The patch of only the picked lines of `parsed`, by the `git add -p` rules. `picked(hunk, line)`
/// says whether a changed line is in the selection; a hunk with none picked is left out. The file
/// header comes first without its mode lines, with `minus` and `plus` as its `---` and `+++` lines.
/// Within a hunk an unpicked line that the patch's preimage holds becomes context and any other
/// unpicked line is dropped, as is a `\ No newline at end of file` after a dropped line. Each
/// hunk's preimage start is kept and its other start is renumbered for what was left out above it.
/// `reverse` builds it for `git apply -R`, whose preimage is the hunk's new side: there an unpicked
/// addition becomes context and an unpicked deletion is dropped. Every kept byte is copied as git
/// wrote it. A selection that would keep a line after a side's no-newline marker is refused, since
/// `git apply` would join that line onto the last one.
fn reduced_patch(
    parsed: &ParsedDiff,
    (minus, plus): (&[u8], &[u8]),
    picked: impl Fn(usize, usize) -> bool,
    reverse: bool,
) -> Result<Vec<u8>, GitError> {
    let mut patch = Vec::new();
    push_line(&mut patch, parsed.diff_git.as_deref().ok_or_else(|| other("the diff has no file header"))?);
    push_line(&mut patch, minus);
    push_line(&mut patch, plus);
    // How far the lines left out above this hunk shift its other side.
    let mut skipped: i64 = 0;
    for (i, h) in parsed.hunks.iter().enumerate() {
        let mut body = Vec::new();
        let (mut old_lines, mut new_lines) = (0i64, 0i64);
        let mut any = false;
        // The marker of the line last kept, or None when the line before was dropped.
        let mut prev: Option<u8> = None;
        // Which sides have ended at a no-newline marker.
        let (mut old_ended, mut new_ended) = (false, false);
        for (j, line) in h.body.iter().enumerate() {
            let kept = match line.first().copied() {
                Some(b'\\') => {
                    if let Some(m) = prev {
                        push_line(&mut body, line);
                        let (old, new) = sides(m);
                        old_ended |= old;
                        new_ended |= new;
                    }
                    continue;
                }
                Some(m @ (b'+' | b'-')) if picked(i, j) => {
                    any = true;
                    push_line(&mut body, line);
                    Some(m)
                }
                // The preimage holds this unpicked line, so it stays as context.
                Some(m @ (b'+' | b'-')) if (m == b'+') == reverse => {
                    body.push(b' ');
                    push_line(&mut body, &line[1..]);
                    Some(b' ')
                }
                Some(b'+' | b'-') => None,
                _ => {
                    push_line(&mut body, line);
                    Some(b' ')
                }
            };
            if let Some(m) = kept {
                let (old, new) = sides(m);
                if (old && old_ended) || (new && new_ended) {
                    return Err(after_last_line());
                }
                old_lines += i64::from(old);
                new_lines += i64::from(new);
            }
            prev = kept;
        }
        let delta = i64::from(h.new_lines) - i64::from(h.old_lines);
        if !any {
            skipped += delta;
            continue;
        }
        let (old_start, new_start) = if reverse {
            (i64::from(h.old_start) + skipped, i64::from(h.new_start))
        } else {
            (i64::from(h.old_start), i64::from(h.new_start) - skipped)
        };
        skipped += delta - (new_lines - old_lines);
        patch.extend_from_slice(format!("@@ -{old_start},{old_lines} +{new_start},{new_lines} @@").as_bytes());
        patch.extend_from_slice(&h.heading);
        patch.push(b'\n');
        patch.extend_from_slice(&body);
    }
    Ok(patch)
}

/// The `---` and `+++` lines of `parsed`'s file header.
fn header_lines(parsed: &ParsedDiff) -> Result<(&[u8], &[u8]), GitError> {
    match (parsed.minus.as_deref(), parsed.plus.as_deref()) {
        (Some(minus), Some(plus)) => Ok((minus, plus)),
        _ => Err(other("the diff has no hunks")),
    }
}

/// The changed lines `refs` names in `parsed`, as (hunk, line) indexes, or None when one is out
/// of range or a context line.
fn changed_lines(parsed: &ParsedDiff, refs: &[LineRef]) -> Option<Vec<(usize, usize)>> {
    refs.iter()
        .map(|r| {
            let (h, l) = (r.hunk as usize, r.line as usize);
            matches!(parsed.hunks.get(h)?.body.get(l)?.first(), Some(b'+' | b'-')).then_some((h, l))
        })
        .collect()
}

/// The patch of only `parsed`'s mode change.
fn mode_patch(parsed: &ParsedDiff) -> Option<Vec<u8>> {
    let mut patch = Vec::new();
    push_line(&mut patch, parsed.diff_git.as_deref()?);
    push_line(&mut patch, parsed.old_mode_line.as_deref()?);
    push_line(&mut patch, parsed.new_mode_line.as_deref()?);
    Some(patch)
}

/// Checks `patch` against the index with `git apply --cached --check`, then applies it.
fn apply_cached(worktree: &Path, patch: &[u8], reverse: bool, context: u32) -> Result<(), GitError> {
    let mut args = vec!["apply", "--cached"];
    if reverse {
        args.push("-R");
    }
    args.extend(["--recount", "--whitespace=nowarn"]);
    if context == 0 {
        args.push("--unidiff-zero");
    }
    let mut check = args.clone();
    check.extend(["--check", "-"]);
    run_write_input(worktree, &check, Some(patch))?;
    args.push("-");
    run_write_input(worktree, &args, Some(patch))
}

/// Stages (from the unstaged side) or unstages (from the staged side) `request.selection` of one
/// file (#350, #383), in the worktree's staging slot. It re-reads the diff first and refuses with
/// [`GitError::StaleDiff`] when the token no longer matches, so a patch is never applied to an
/// index that moved. Hunks and mode changes go through a reduced patch and `git apply --cached`;
/// a whole file, and any change to a binary file or a submodule, goes through `git add` or
/// `git reset`. A hunk of a file being created or deleted is the whole file. Returns the file's
/// new diff, answering `diff_request_id`, and the post-write status, answering `request_id`.
pub fn stage_selection(
    locks: &StagingLocks,
    worktree: &Path,
    request_id: u32,
    diff_request_id: u32,
    request: &StageRequest,
) -> Result<StageResult, GitError> {
    let _slot = locks.begin(worktree)?;
    let path = parse_rel_path(&request.path)?;
    let reverse = match request.side {
        DiffSide::Unstaged => false,
        DiffSide::Staged => true,
        DiffSide::Commit { .. } => return Err(other("a commit's diff is read-only")),
    };
    let context = token_context(&request.diff_token).ok_or(GitError::StaleDiff)?;
    let parsed = read_parsed(worktree, path, &request.side, context, false)?;
    if diff_token(context, &parsed) != request.diff_token {
        return Err(GitError::StaleDiff);
    }
    let whole = PathTarget::Paths { paths: vec![path.to_string()] };
    let write_whole = || if reverse { write_unstage(worktree, &whole) } else { write_stage(worktree, &whole) };
    match &request.selection {
        Selection::File => write_whole()?,
        Selection::ModeChange => {
            let patch = mode_patch(&parsed).ok_or_else(|| other(format!("{path} has no mode change")))?;
            apply_cached(worktree, &patch, reverse, context)?;
        }
        Selection::Hunks { hunks } => {
            if parsed.binary || parsed.submodule {
                return Err(other(format!("{path} is staged only as a whole file")));
            }
            let selected: Vec<usize> = hunks.iter().map(|&h| h as usize).collect();
            if selected.is_empty() || selected.iter().any(|&h| h >= parsed.hunks.len()) {
                return Err(other(format!("no such hunk in {path}")));
            }
            if parsed.new_file || parsed.deleted_file {
                write_whole()?;
            } else {
                let patch = reduced_patch(&parsed, header_lines(&parsed)?, |h, _| selected.contains(&h), reverse)?;
                apply_cached(worktree, &patch, reverse, context)?;
            }
        }
        Selection::Lines { lines } => {
            if parsed.binary || parsed.submodule {
                return Err(other(format!("{path} is staged only as a whole file")));
            }
            let picked = changed_lines(&parsed, lines)
                .filter(|p| !p.is_empty())
                .ok_or_else(|| other(format!("no such changed line in {path}")))?;
            let patch = reduced_patch(&parsed, header_lines(&parsed)?, |h, l| picked.contains(&(h, l)), reverse)?;
            apply_cached(worktree, &patch, reverse, context)?;
        }
    }
    Ok(StageResult {
        diff: read_file_diff(worktree, diff_request_id, path, &request.side, context, request.load_large)?,
        status: read_status(worktree, request_id, None)?,
    })
}

/// The largest image the diff view previews (#366).
pub const IMAGE_PREVIEW_CAP: u64 = 5 * 1024 * 1024;

/// Where an image preview's bytes come from: a blob a diff named, or the worktree's file.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ByteSource {
    Blob { oid: String },
    Worktree,
}

/// A full hex oid, never a ref or an option.
fn parse_blob_oid(oid: &str) -> Result<&str, GitError> {
    if matches!(oid.len(), 40 | 64) && oid.bytes().all(|b| b.is_ascii_hexdigit()) {
        Ok(oid)
    } else {
        Err(other(format!("not a blob id: {oid:?}")))
    }
}

fn too_big(size: u64) -> GitError {
    other(format!("{size} bytes is over the {IMAGE_PREVIEW_CAP}-byte preview limit"))
}

/// The bytes of `path`'s image for a before-and-after preview, refused past [`IMAGE_PREVIEW_CAP`].
/// A worktree file must resolve inside the worktree.
pub fn file_bytes(worktree: &Path, path: &str, source: &ByteSource) -> Result<Vec<u8>, GitError> {
    let path = parse_rel_path(path)?;
    match source {
        ByteSource::Worktree => {
            let root = worktree.canonicalize().map_err(|e| other(format!("could not open the worktree: {e}")))?;
            let file = worktree.join(path).canonicalize().map_err(|e| other(format!("could not open {path}: {e}")))?;
            if !file.starts_with(&root) {
                return Err(other(format!("{path} is outside the worktree")));
            }
            let size = std::fs::metadata(&file).map_err(|e| other(format!("could not read {path}: {e}")))?.len();
            if size > IMAGE_PREVIEW_CAP {
                return Err(too_big(size));
            }
            std::fs::read(&file).map_err(|e| other(format!("could not read {path}: {e}")))
        }
        ByteSource::Blob { oid } => {
            let oid = parse_blob_oid(oid)?;
            let size = run_read(worktree, ["cat-file", "-s", oid])?;
            let size: u64 = String::from_utf8_lossy(&size).trim().parse().map_err(|_| other("git printed no blob size"))?;
            if size > IMAGE_PREVIEW_CAP {
                return Err(too_big(size));
            }
            run_read(worktree, ["cat-file", "blob", oid])
        }
    }
}

/// `path`'s diff on `side` in `worktree_path`. See [`read_file_diff`]. `request_id` comes back in
/// the answer.
#[tauri::command]
pub async fn git_file_diff(
    worktree_path: String,
    request_id: u32,
    path: String,
    side: DiffSide,
    context: u32,
    load_large: Option<bool>,
) -> Result<FileDiff, GitError> {
    tokio::task::spawn_blocking(move || {
        read_file_diff(Path::new(&worktree_path), request_id, &path, &side, context, load_large.unwrap_or(false))
    })
    .await
    .map_err(|e| other(format!("could not read the diff: {e}")))?
}

/// Stages or unstages part of one file and returns its new diff and the post-write status. See
/// [`stage_selection`].
#[tauri::command]
pub async fn git_stage_selection(
    worktree_path: String,
    request_id: u32,
    diff_request_id: u32,
    request: StageRequest,
    locks: tauri::State<'_, StagingLocks>,
) -> Result<StageResult, GitError> {
    let locks = locks.inner();
    // A held index.lock keeps it waiting between tries, so keep it off the async runtime's threads.
    tokio::task::block_in_place(|| stage_selection(locks, Path::new(&worktree_path), request_id, diff_request_id, &request))
}

/// The bytes of an image for the diff view's preview, as a raw `ArrayBuffer`. See [`file_bytes`].
#[tauri::command]
pub async fn git_file_bytes(worktree_path: String, path: String, source: ByteSource) -> Result<tauri::ipc::Response, GitError> {
    tokio::task::spawn_blocking(move || file_bytes(Path::new(&worktree_path), &path, &source))
        .await
        .map_err(|e| other(format!("could not read the image: {e}")))?
        .map(tauri::ipc::Response::new)
}
