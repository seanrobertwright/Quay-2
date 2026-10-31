//! The ref set a graph session walks and a deep search searches (#370, #400, #401). A filter
//! narrows it; the walk and the search take the same set, so a search never reaches past the graph.
//!
//! Ref names come from the frontend and are untrusted. Each goes to git as its own argument, only
//! once it names a branch that exists: [`check`] refuses an option-like name or one outside
//! `refs/heads/` and `refs/remotes/`, and [`resolve`] keeps only the names `for-each-ref` lists, so
//! git never reads a name it would not have printed itself.

use std::collections::HashSet;
use std::path::Path;

use serde::Deserialize;

use super::checkout::{invalid_ref, refuse_option_like, rev_oid};
use super::commit::read_git;
use super::error::GitError;

/// The most refs a reduced ref set names.
pub const MAX_REFS: usize = 1_000;

/// Which refs a walk starts from.
#[derive(Debug, Clone, PartialEq, Eq, Default, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase", deny_unknown_fields)]
pub enum RefSet {
    /// Every local branch, every remote-tracking branch and HEAD; never tags (#370).
    #[default]
    Branches,
    /// Only these refs: each a full name such as `refs/heads/main`, or `HEAD`.
    Only { refs: Vec<String> },
    /// The graph's filters (#368, #401).
    Filtered {
        /// Full branch names such as `refs/heads/main` or `refs/remotes/origin/main`; empty walks
        /// every local branch. A name whose branch no longer exists is left out.
        branches: Vec<String>,
        /// Whether remote-tracking branches are walked: all of them with no branch filter, and the
        /// filter's own otherwise.
        remotes: bool,
        /// Whether every tag is walked too (`--tags`).
        tags: bool,
        /// The selected worktree, whose HEAD is always walked; None walks the repo's own HEAD.
        worktree_path: Option<String>,
    },
}

/// The revisions a walk passes to git, before its `--`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Revs {
    pub args: Vec<String>,
    /// Whether the last argument is a bare `HEAD` that was not checked to be born. A walk that
    /// fails on an unborn HEAD runs again without it.
    pub unchecked_head: bool,
}

impl Revs {
    /// These revisions without an unchecked `HEAD`.
    pub fn without_head(mut self) -> Revs {
        if self.unchecked_head {
            self.args.pop();
            self.unchecked_head = false;
        }
        self
    }
}

const BRANCH_PREFIXES: [&str; 2] = ["refs/heads/", "refs/remotes/"];

/// Whether `name` is a full branch or remote-tracking branch name, by its prefix alone.
pub fn is_branch_ref(name: &str) -> bool {
    BRANCH_PREFIXES.iter().any(|p| name.strip_prefix(p).is_some_and(|rest| !rest.is_empty()))
}

/// Refuses a branch filter of more than [`MAX_REFS`] names, or one naming anything but a full
/// branch name. Needs no repo, so a session or a store refuses a bad filter before it starts.
pub fn check_branches(branches: &[String]) -> Result<(), GitError> {
    if branches.len() > MAX_REFS {
        return Err(GitError::Other { stderr: format!("a filter names at most {MAX_REFS} branches") });
    }
    for name in branches {
        refuse_option_like(name)?;
        if !is_branch_ref(name) {
            return Err(invalid_ref(name));
        }
    }
    Ok(())
}

/// Refuses a ref set that can never resolve, without reading the repo.
pub fn check(refs: &RefSet) -> Result<(), GitError> {
    match refs {
        RefSet::Branches => Ok(()),
        RefSet::Only { refs } => {
            if refs.is_empty() || refs.len() > MAX_REFS {
                return Err(GitError::Other { stderr: format!("a ref set names between 1 and {MAX_REFS} refs") });
            }
            refs.iter().try_for_each(|name| refuse_option_like(name))
        }
        RefSet::Filtered { branches, worktree_path, .. } => {
            check_branches(branches)?;
            if let Some(path) = worktree_path {
                let path = Path::new(path);
                if !path.is_absolute() || !path.is_dir() {
                    return Err(GitError::Other { stderr: format!("{} is not a folder", path.display()) });
                }
            }
            Ok(())
        }
    }
}

/// Every local and remote-tracking branch `repo` has, by full name.
pub fn existing_branches(repo: &Path) -> Result<HashSet<String>, GitError> {
    let out = read_git(repo, &["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes"])?
        .ok_or_else(|| GitError::Other { stderr: format!("git could not list the branches of {}", repo.display()) })?;
    Ok(String::from_utf8_lossy(&out).lines().map(str::to_string).collect())
}

/// The revisions `refs` names in `repo`, each checked as the module doc says.
pub fn resolve(repo: &Path, refs: &RefSet) -> Result<Revs, GitError> {
    check(refs)?;
    match refs {
        RefSet::Branches => Ok(Revs {
            args: ["--branches", "--remotes", "HEAD"].map(String::from).to_vec(),
            unchecked_head: true,
        }),
        RefSet::Only { refs } => {
            for name in refs {
                if name != "HEAD" {
                    let formatted = name.starts_with("refs/") && read_git(repo, &["check-ref-format", name])?.is_some();
                    if !formatted {
                        return Err(invalid_ref(name));
                    }
                }
                rev_oid(repo, &format!("{name}^{{commit}}"))?.ok_or_else(|| invalid_ref(name))?;
            }
            Ok(Revs { args: refs.clone(), unchecked_head: false })
        }
        RefSet::Filtered { branches, remotes, tags, worktree_path } => {
            let mut args = Vec::new();
            if branches.is_empty() {
                args.push("--branches".to_string());
                if *remotes {
                    args.push("--remotes".to_string());
                }
            } else {
                let existing = existing_branches(repo)?;
                let mut seen = HashSet::new();
                for name in branches {
                    let wanted = *remotes || name.starts_with("refs/heads/");
                    if wanted && existing.contains(name) && seen.insert(name) {
                        args.push(name.clone());
                    }
                }
            }
            if *tags {
                args.push("--tags".to_string());
            }
            // The selected worktree's HEAD by its oid, so the walk reads it from that worktree.
            let head_from = worktree_path.as_deref().map(Path::new).unwrap_or(repo);
            if let Some(oid) = rev_oid(head_from, "HEAD^{commit}")? {
                args.push(oid);
            }
            Ok(Revs { args, unchecked_head: false })
        }
    }
}
