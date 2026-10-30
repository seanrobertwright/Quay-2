//! The branch tips a session's lane pass starts from (#375): which branch is the default, where its
//! local and remote tips are, and the track key each branch tip names.

use std::collections::HashMap;
use std::path::Path;

/// What the lane pass knows about branches before the walk starts.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct BranchTips {
    /// The default branch's track key, such as `main`, when the repo has one.
    pub default_key: Option<String>,
    /// The oids of every local and remote-tracking branch whose key is `default_key`.
    pub default_tips: Vec<String>,
    /// The track key for each branch tip: the preferred branch ref at that commit, without its
    /// `refs/heads/` or `refs/remotes/<remote>/` prefix.
    pub keys: HashMap<String, String>,
}

/// A branch ref as `for-each-ref` printed it.
struct BranchRef {
    oid: String,
    /// The track key: the name without `refs/heads/` or `refs/remotes/<remote>/`.
    key: String,
    remote: Option<String>,
    checked_out: bool,
}

/// The track key of `refname` and its remote, or None for a ref that is never a track key:
/// anything outside `refs/heads/` and `refs/remotes/`, and `<remote>/HEAD`.
fn track_key(refname: &str) -> Option<(String, Option<String>)> {
    if let Some(name) = refname.strip_prefix("refs/heads/") {
        return (!name.is_empty()).then(|| (name.to_string(), None));
    }
    let (remote, name) = refname.strip_prefix("refs/remotes/")?.split_once('/')?;
    (!name.is_empty() && name != "HEAD").then(|| (name.to_string(), Some(remote.to_string())))
}

/// Reads `for-each-ref` output in the format [`read_branch_tips`] asks for.
pub fn parse_branch_tips(output: &str) -> BranchTips {
    let mut refs = Vec::new();
    // Each remote's `<remote>/HEAD` target, which says what that remote calls its default branch.
    let mut remote_heads: Vec<(String, String)> = Vec::new();
    for line in output.lines() {
        let mut fields = line.split('\0');
        let (Some(oid), Some(refname), Some(symref), Some(head)) = (fields.next(), fields.next(), fields.next(), fields.next())
        else {
            continue;
        };
        if let Some(remote) = refname.strip_prefix("refs/remotes/").and_then(|r| r.strip_suffix("/HEAD")) {
            if let Some((key, _)) = track_key(symref) {
                remote_heads.push((remote.to_string(), key));
            }
            continue;
        }
        if let Some((key, remote)) = track_key(refname) {
            refs.push(BranchRef { oid: oid.to_string(), key, remote, checked_out: head == "*" });
        }
    }

    let has_local = |name: &str| refs.iter().any(|r| r.remote.is_none() && r.key == name);
    let default_key = remote_heads
        .iter()
        .find(|(remote, _)| remote == "origin")
        .or(remote_heads.first())
        .map(|(_, key)| key.clone())
        .or_else(|| ["main", "master"].into_iter().find(|n| has_local(n)).map(str::to_string))
        .or_else(|| refs.iter().find(|r| r.checked_out).map(|r| r.key.clone()));

    let default_tips = match &default_key {
        Some(key) => {
            let mut tips: Vec<String> = refs.iter().filter(|r| &r.key == key).map(|r| r.oid.clone()).collect();
            tips.dedup();
            tips
        }
        None => Vec::new(),
    };

    // The checked-out branch first, then local before remote, then the key that sorts first.
    refs.sort_by(|a, b| (!a.checked_out, a.remote.is_some(), &a.key).cmp(&(!b.checked_out, b.remote.is_some(), &b.key)));
    let mut keys = HashMap::new();
    for r in refs {
        keys.entry(r.oid).or_insert(r.key);
    }
    BranchTips { default_key, default_tips, keys }
}

/// Reads the branch tips of `repo`. A repo git can't read yields no tips; the walk reports its error.
pub fn read_branch_tips(repo: &Path) -> BranchTips {
    let out = super::super::op_runner::headless_git()
        .arg("-C")
        .arg(repo)
        .args([
            "--no-optional-locks",
            "for-each-ref",
            "--format=%(objectname)%00%(refname)%00%(symref)%00%(HEAD)",
            "refs/heads",
            "refs/remotes",
        ])
        .stderr(std::process::Stdio::null())
        .output();
    match out {
        Ok(out) if out.status.success() => parse_branch_tips(&String::from_utf8_lossy(&out.stdout)),
        _ => BranchTips::default(),
    }
}
