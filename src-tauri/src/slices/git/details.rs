//! A selected commit's details, files and signature check for Topos's details mode (#368, #397).

use std::path::Path;

use serde::Serialize;

use super::checkout::rev_oid;
use super::diff::{other, run_read};
use super::error::GitError;
use super::graph::provenance::{classify, Agent};

/// A commit's author or committer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Person {
    pub name: String,
    pub email: String,
    /// Milliseconds since the epoch.
    pub time_ms: i64,
}

/// One trailer from the message's trailer block, unfolded.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Trailer {
    pub key: String,
    pub value: String,
}

/// What details mode shows of one commit. Every string is untrusted text for the frontend to
/// render as text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitDetails {
    pub oid: String,
    pub parents: Vec<String>,
    pub subject: String,
    pub body: String,
    pub author: Person,
    pub committer: Person,
    pub trailers: Vec<Trailer>,
    pub has_signature: bool,
    pub provenance: Option<Agent>,
}

/// The fields details mode reads, NUL-separated: hash, parents, author name, email and time,
/// committer name, email and time, subject, body, then the unfolded trailers, each key and value
/// split by US (0x1F) and the trailers by RS (0x1E).
const DETAILS_FORMAT: &str = "--format=%H%x00%P%x00%aN%x00%aE%x00%at%x00%cN%x00%cE%x00%ct%x00%s%x00%b%x00\
%(trailers:only,unfold,separator=%x1E,key_value_separator=%x1F)";

/// The full oid of the commit `oid` abbreviates. `oid` must be 4 to 64 hex digits, so it is never
/// a ref or an option, and `rev-parse --verify` must resolve it to a commit whose oid it prefixes,
/// which refuses a tag's or a tree's oid as well as an ambiguous or unknown one.
pub(super) fn resolve_commit_oid(repo: &Path, oid: &str) -> Result<String, GitError> {
    let refuse = || other(format!("not a commit id: {oid:?}"));
    if !(4..=64).contains(&oid.len()) || !oid.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(refuse());
    }
    let full = rev_oid(repo, &format!("{oid}^{{commit}}"))?.ok_or_else(refuse)?;
    if !full.starts_with(&oid.to_ascii_lowercase()) {
        return Err(refuse());
    }
    Ok(full)
}

/// Whether the raw commit object carries a `gpgsig` or `gpgsig-sha256` header. This reads the
/// object only; it never runs gpg or ssh-keygen.
fn has_signature_header(repo: &Path, oid: &str) -> Result<bool, GitError> {
    let raw = run_read(repo, ["cat-file", "commit", oid])?;
    let mut headers = raw.split(|&b| b == b'\n').take_while(|line| !line.is_empty());
    Ok(headers.any(|line| line.starts_with(b"gpgsig ") || line.starts_with(b"gpgsig-sha256 ")))
}

/// A `%at` or `%ct` field in epoch ms. A field that isn't a number is an error, never the epoch.
fn seconds_to_ms(field: &str) -> Result<i64, GitError> {
    let seconds = field.trim().parse::<i64>().map_err(|_| other(format!("git printed a commit time that is not a number: {field:?}")))?;
    Ok(seconds.saturating_mul(1000))
}

/// `oid`'s details in `repo` (#397): its message split into subject and body, author and
/// committer with their times in epoch ms, trailers, whether it is signed, and its provenance by
/// #381's rules. `oid` is checked by [`resolve_commit_oid`] first.
pub fn commit_details(repo: &Path, oid: &str) -> Result<CommitDetails, GitError> {
    let full = resolve_commit_oid(repo, oid)?;
    let out = run_read(repo, ["log", "-1", "--no-show-signature", "--no-color", DETAILS_FORMAT, full.as_str(), "--"])?;
    let text = String::from_utf8_lossy(&out);
    let text = text.strip_suffix('\n').unwrap_or(&text);
    let f: Vec<&str> = text.splitn(11, '\0').collect();
    if f.len() != 11 {
        return Err(other("git printed no commit details"));
    }
    let trailers: Vec<Trailer> = f[10]
        .split('\x1E')
        .filter_map(|t| {
            let (key, value) = t.trim_matches('\n').split_once('\x1F')?;
            Some(Trailer { key: key.trim().to_string(), value: value.trim().to_string() })
        })
        .collect();
    let values = |key: &'static str| trailers.iter().filter(move |t| t.key.eq_ignore_ascii_case(key)).map(|t| t.value.as_str());
    let provenance = classify(values("Quay-Agent"), values("Co-authored-by"));
    Ok(CommitDetails {
        oid: f[0].to_string(),
        parents: f[1].split_whitespace().map(str::to_string).collect(),
        author: Person { name: f[2].to_string(), email: f[3].to_string(), time_ms: seconds_to_ms(f[4])? },
        committer: Person { name: f[5].to_string(), email: f[6].to_string(), time_ms: seconds_to_ms(f[7])? },
        subject: f[8].to_string(),
        body: f[9].trim_end().to_string(),
        has_signature: has_signature_header(repo, &full)?,
        trailers,
        provenance,
    })
}

/// What `git verify-commit` makes of a commit's signature.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SignatureStatus {
    Good,
    Bad,
    UnknownKey,
    None,
}

/// A signature check's answer, with the signer git names for it when there is one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Verification {
    pub status: SignatureStatus,
    pub signer: Option<String>,
}

/// The status git's `%G?` letter means: `G` is good; `B`, `X` (expired signature), `Y` (expired
/// key) and `R` (revoked key) are bad; `U` (a good signature from a key of unknown validity) and
/// `E` (the key is missing, so it can't be checked) are an unknown key; anything else is none.
fn status_of(letter: &str) -> SignatureStatus {
    match letter {
        "G" => SignatureStatus::Good,
        "B" | "X" | "Y" | "R" => SignatureStatus::Bad,
        "U" | "E" => SignatureStatus::UnknownKey,
        _ => SignatureStatus::None,
    }
}

/// Checks `oid`'s signature in `repo` (#397), only when the operator asks. An unsigned commit is
/// `None` without running anything. A signed one goes through git's own check (`%G?` and `%GS`,
/// which cover GPG, SSH and X.509 signatures), with no terminal and stdin closed, so it never
/// prompts; verifying needs only public keys.
pub fn verify_commit(repo: &Path, oid: &str) -> Result<Verification, GitError> {
    let full = resolve_commit_oid(repo, oid)?;
    if !has_signature_header(repo, &full)? {
        return Ok(Verification { status: SignatureStatus::None, signer: None });
    }
    let out = run_read(repo, ["log", "-1", "--no-show-signature", "--format=%G?%x00%GS", full.as_str(), "--"])?;
    let text = String::from_utf8_lossy(&out);
    let (letter, signer) = text.trim_end_matches('\n').split_once('\0').unwrap_or((text.trim(), ""));
    let signer = signer.trim();
    Ok(Verification { status: status_of(letter.trim()), signer: (!signer.is_empty()).then(|| signer.to_string()) })
}

/// git's status letter for a file a commit changed, sent as the letter itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub enum FileStatus {
    /// Added.
    A,
    /// Modified.
    M,
    /// Deleted.
    D,
    /// Renamed.
    R,
    /// Copied.
    C,
    /// Type changed, such as a file turned into a symlink.
    T,
}

impl FileStatus {
    fn from_letter(letter: char) -> Result<Self, GitError> {
        Ok(match letter {
            'A' => Self::A,
            'M' => Self::M,
            'D' => Self::D,
            'R' => Self::R,
            'C' => Self::C,
            'T' => Self::T,
            _ => return Err(other(format!("git printed a file status details mode doesn't know: {letter:?}"))),
        })
    }
}

/// One file a commit changed against the chosen parent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitFile {
    pub status: FileStatus,
    pub path: String,
    /// A rename's or copy's source path.
    pub old_path: Option<String>,
    /// Lines added and deleted, from `--numstat`; absent for a binary file.
    pub additions: Option<u32>,
    pub deletions: Option<u32>,
}

/// A commit's files, capped at [`MAX_COMMIT_FILES`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitFiles {
    pub files: Vec<CommitFile>,
    /// Every file the commit changed, including those past the cap.
    pub total: u32,
    pub truncated: bool,
}

/// The most files [`commit_files`] returns.
pub const MAX_COMMIT_FILES: usize = 5_000;

/// The parent a commit's files are diffed against: `parent_index` counted from 1, as in `oid^1`,
/// or parent 1 when absent. A root commit takes no index, and diffs against the empty tree.
fn chosen_parent(repo: &Path, oid: &str, parent_index: Option<u32>) -> Result<Option<String>, GitError> {
    let out = run_read(repo, ["log", "-1", "--format=%P", oid, "--"])?;
    let parents: Vec<String> = String::from_utf8_lossy(&out).split_whitespace().map(str::to_string).collect();
    match parent_index {
        None => Ok(parents.into_iter().next()),
        Some(n) if n >= 1 && (n as usize) <= parents.len() => Ok(Some(parents[n as usize - 1].clone())),
        Some(n) => Err(other(format!("commit {oid} has {} parents, so it has no parent {n}", parents.len()))),
    }
}

/// `--numstat`'s count, or None for a binary file's `-`.
fn count(field: &str) -> Option<u32> {
    field.parse().ok()
}

/// Parses `diff-tree -z --raw --numstat`, which prints every raw record and then every numstat
/// record in the same order. Paths are NUL-terminated as git wrote them, so a space, tab or
/// newline in a name survives. Keeps the first `cap` files and counts them all. A record with no
/// status letter, or one this module doesn't know, is an error.
pub(super) fn parse_files(out: &[u8], cap: usize) -> Result<CommitFiles, GitError> {
    let mut tokens = out.split(|&b| b == 0).map(|t| String::from_utf8_lossy(t).into_owned());
    let mut files: Vec<CommitFile> = Vec::new();
    let mut total = 0usize;
    let mut numstat = 0usize;
    while let Some(token) = tokens.next() {
        if token.is_empty() {
            continue;
        }
        if let Some(raw) = token.strip_prefix(':') {
            let letter = raw.rsplit(' ').next().and_then(|s| s.chars().next());
            let status = FileStatus::from_letter(letter.ok_or_else(|| other("git printed a file record with no status"))?)?;
            let first = tokens.next().unwrap_or_default();
            let (path, old_path) = if matches!(status, FileStatus::R | FileStatus::C) { (tokens.next().unwrap_or_default(), Some(first)) } else { (first, None) };
            total += 1;
            if files.len() < cap {
                files.push(CommitFile { status, path, old_path, additions: None, deletions: None });
            }
        } else {
            let mut fields = token.splitn(3, '\t');
            let (added, deleted, rest) = (fields.next().unwrap_or(""), fields.next().unwrap_or(""), fields.next().unwrap_or(""));
            // A rename's numstat leaves the path field empty and names both paths next.
            if rest.is_empty() {
                tokens.next();
                tokens.next();
            }
            if let Some(file) = files.get_mut(numstat) {
                file.additions = count(added);
                file.deletions = count(deleted);
            }
            numstat += 1;
        }
    }
    Ok(CommitFiles { files, total: total as u32, truncated: total > cap })
}

/// The files `oid` changed in `repo` against its parent `parent_index` (#397): status letter,
/// path, `+n -m` from `--numstat`, and renames found with `-M`. A merge is never shown as a
/// combined diff. `oid` is checked by [`resolve_commit_oid`] and `parent_index` against the
/// commit's parent count, and each goes to git as its own argument.
pub fn commit_files(repo: &Path, oid: &str, parent_index: Option<u32>) -> Result<CommitFiles, GitError> {
    let full = resolve_commit_oid(repo, oid)?;
    let parent = chosen_parent(repo, &full, parent_index)?;
    let mut args = vec!["diff-tree", "-r", "-z", "-M", "--raw", "--numstat", "--no-commit-id", "--no-ext-diff"];
    match &parent {
        Some(parent) => args.extend([parent.as_str(), full.as_str()]),
        None => args.extend(["--root", full.as_str()]),
    }
    let out = run_read(repo, args)?;
    parse_files(&out, MAX_COMMIT_FILES)
}

/// `oid`'s details in the repo at `repo_path`. See [`commit_details`].
#[tauri::command]
pub async fn git_commit_details(repo_path: String, oid: String) -> Result<CommitDetails, GitError> {
    tokio::task::spawn_blocking(move || commit_details(Path::new(&repo_path), &oid))
        .await
        .map_err(|e| other(format!("could not read the commit: {e}")))?
}

/// `oid`'s files against its parent `parent_index` (1 when absent). See [`commit_files`].
#[tauri::command]
pub async fn git_commit_files(repo_path: String, oid: String, parent_index: Option<u32>) -> Result<CommitFiles, GitError> {
    tokio::task::spawn_blocking(move || commit_files(Path::new(&repo_path), &oid, parent_index))
        .await
        .map_err(|e| other(format!("could not read the commit's files: {e}")))?
}

/// Checks `oid`'s signature on demand. See [`verify_commit`].
#[tauri::command]
pub async fn git_verify_commit(repo_path: String, oid: String) -> Result<Verification, GitError> {
    tokio::task::spawn_blocking(move || verify_commit(Path::new(&repo_path), &oid))
        .await
        .map_err(|e| other(format!("could not verify the commit: {e}")))?
}
