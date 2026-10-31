//! Handing conflicted files to an agent (#352, #392). The operator picks an agent terminal in the
//! worktree; the frontend sends it the resolve-and-stage-only prompt through the orchestrator
//! router, and records here which agent holds which files. A handed-off file is read-only to Topos:
//! every conflict write and staging write naming it refuses with [`GitError::HandedOff`] until the
//! agent stages it, which takes it out of the unmerged set, or the operator takes it back.
//!
//! The record is per worktree, keyed by the worktree's one spelling, so a hand-off in one worktree
//! never reaches another. It lives in memory only: a restart of Quay drops it, which leaves the
//! files writable again rather than locked by an agent that may no longer exist.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::Path;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use super::diff::run_read;
use super::error::GitError;
use super::staging::{parse_rel_path, worktree_key, StagingLocks, STATUS_CAP};

/// The agent terminal a conflict is handed to. Its name is untrusted display text.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Agent {
    pub terminal_id: String,
    pub name: String,
}

/// A conflicted file an agent holds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HandOff {
    /// Relative to the worktree root, with `/` separators.
    pub path: String,
    pub terminal_id: String,
    pub agent_name: String,
}

/// Which agent holds which conflicted files, per worktree.
#[derive(Default)]
pub struct HandOffs {
    held: Mutex<HashMap<String, BTreeMap<String, Agent>>>,
}

/// The unmerged paths of `worktree`'s index, from `git ls-files -u -z`.
fn unmerged(worktree: &Path) -> Result<HashSet<String>, GitError> {
    let out = run_read(worktree, ["--no-optional-locks", "ls-files", "-u", "-z"])?;
    Ok(out
        .split(|b| *b == 0)
        .filter_map(|record| {
            let text = String::from_utf8_lossy(record);
            text.split_once('\t').map(|(_, path)| path.to_string())
        })
        .collect())
}

impl HandOffs {
    /// The worktree's hand-offs, after dropping each whose file is no longer unmerged: the agent
    /// staged it, or git or the operator resolved it some other way.
    fn current(&self, worktree: &Path) -> Result<Vec<HandOff>, GitError> {
        let key = worktree_key(worktree);
        if !self.lock().get(&key).is_some_and(|files| !files.is_empty()) {
            return Ok(Vec::new());
        }
        let unmerged = unmerged(worktree)?;
        let mut held = self.lock();
        let Some(files) = held.get_mut(&key) else { return Ok(Vec::new()) };
        files.retain(|path, _| unmerged.contains(path));
        let listed = files
            .iter()
            .map(|(path, agent)| HandOff { path: path.clone(), terminal_id: agent.terminal_id.clone(), agent_name: agent.name.clone() })
            .collect();
        if files.is_empty() {
            held.remove(&key);
        }
        Ok(listed)
    }

    /// Records each of `paths` in `worktree` as held by `agent`, replacing any agent before it.
    fn record(&self, worktree: &Path, paths: &[&str], agent: &Agent) {
        let mut held = self.lock();
        let files = held.entry(worktree_key(worktree)).or_default();
        for path in paths {
            files.insert((*path).to_string(), agent.clone());
        }
    }

    /// Forgets whichever agent holds each of `paths` in `worktree`. A path no agent holds is
    /// ignored.
    fn release(&self, worktree: &Path, paths: &[String]) {
        let mut held = self.lock();
        if let Some(files) = held.get_mut(&worktree_key(worktree)) {
            for path in paths {
                files.remove(path.as_str());
            }
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, BTreeMap<String, Agent>>> {
        self.held.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Refuses with [`GitError::HandedOff`] when an agent holds any of `paths` in `worktree`, or,
    /// with `None`, any file at all, since a write of every change would reach its files too.
    pub(super) fn refuse(&self, worktree: &Path, paths: Option<&[&str]>) -> Result<(), GitError> {
        let current = self.current(worktree)?;
        let reaches = |held: &str, p: &str| {
            let p = p.strip_suffix('/').unwrap_or(p);
            held == p || held.strip_prefix(p).is_some_and(|rest| rest.starts_with('/'))
        };
        let held = current.into_iter().find(|h| paths.is_none_or(|ps| ps.iter().any(|p| reaches(&h.path, p))));
        match held {
            Some(h) => Err(GitError::HandedOff { path: h.path, agent: h.agent_name }),
            None => Ok(()),
        }
    }
}

/// Records `paths`, each a conflicted file in `worktree`, as handed to `agent`, replacing any agent
/// that held one before, and returns every hand-off in the worktree. It refuses, recording nothing,
/// a path that isn't unmerged, an empty list, and more than [`STATUS_CAP`] paths at once.
pub fn hand_off(locks: &StagingLocks, worktree: &Path, paths: &[String], agent: &Agent) -> Result<Vec<HandOff>, GitError> {
    if paths.is_empty() || paths.len() > STATUS_CAP {
        return Err(GitError::Other { stderr: format!("hand between 1 and {STATUS_CAP} conflicted files to an agent at a time") });
    }
    if agent.terminal_id.trim().is_empty() {
        return Err(GitError::Other { stderr: "no agent terminal to hand the files to".into() });
    }
    let checked = paths.iter().map(|p| parse_rel_path(p)).collect::<Result<Vec<_>, _>>()?;
    let unmerged = unmerged(worktree)?;
    if let Some(clean) = checked.iter().find(|p| !unmerged.contains(**p)) {
        return Err(GitError::Other { stderr: format!("{clean} has no conflict to hand to an agent") });
    }
    locks.hand_offs.record(worktree, &checked, agent);
    locks.hand_offs.current(worktree)
}

/// Takes `paths` back from whichever agent holds them in `worktree`, so Topos may write them
/// again, and returns the hand-offs left. A path no agent holds is ignored.
pub fn take_back(locks: &StagingLocks, worktree: &Path, paths: &[String]) -> Result<Vec<HandOff>, GitError> {
    locks.hand_offs.release(worktree, paths);
    locks.hand_offs.current(worktree)
}

/// Every hand-off in `worktree`, in path order, after dropping those whose file left the unmerged
/// set.
pub fn hand_offs(locks: &StagingLocks, worktree: &Path) -> Result<Vec<HandOff>, GitError> {
    locks.hand_offs.current(worktree)
}

/// Hands `paths` in `worktree_path` to `agent`. See [`hand_off`].
#[tauri::command]
pub async fn git_conflict_hand_off(
    worktree_path: String,
    paths: Vec<String>,
    agent: Agent,
    locks: tauri::State<'_, StagingLocks>,
) -> Result<Vec<HandOff>, GitError> {
    let locks = locks.inner();
    tokio::task::block_in_place(|| hand_off(locks, Path::new(&worktree_path), &paths, &agent))
}

/// Takes `paths` in `worktree_path` back from their agent. See [`take_back`].
#[tauri::command]
pub async fn git_conflict_take_back(
    worktree_path: String,
    paths: Vec<String>,
    locks: tauri::State<'_, StagingLocks>,
) -> Result<Vec<HandOff>, GitError> {
    let locks = locks.inner();
    tokio::task::block_in_place(|| take_back(locks, Path::new(&worktree_path), &paths))
}

/// The hand-offs in `worktree_path`. See [`hand_offs`].
#[tauri::command]
pub async fn git_conflict_hand_offs(worktree_path: String, locks: tauri::State<'_, StagingLocks>) -> Result<Vec<HandOff>, GitError> {
    let locks = locks.inner();
    tokio::task::block_in_place(|| hand_offs(locks, Path::new(&worktree_path)))
}
