//! The per-repo lock that serialises everything that moves a repo's refs (#395): a fetch, pull or
//! push, and each local branch or tag write from #393 and #394. At most one holds it per repo, and
//! all the repo's worktrees share it, keyed by the common git dir.

use std::collections::HashSet;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Condvar, Mutex};
use std::time::Duration;

use tauri::ipc::Channel;

use super::commit::read_git_line;
use super::error::GitError;
use super::op_runner::OpEvent;
use super::staging::worktree_key;

/// How often a wait for a repo's lock checks for a cancel.
const LOCK_POLL: Duration = Duration::from_millis(100);

/// The repos with a network operation, or a local ref operation, running: at most one per repo.
/// A second waits for the first to finish rather than being refused, so the operator's click is
/// never lost, and gives up only when it is cancelled.
#[derive(Default)]
pub struct RepoLock {
    held: Mutex<HashSet<String>>,
    freed: Condvar,
}

/// Holds a repo's lock until it drops.
pub struct RepoGuard<'a> {
    lock: &'a RepoLock,
    key: String,
}

impl Drop for RepoGuard<'_> {
    fn drop(&mut self) {
        self.lock.held.lock().unwrap_or_else(|e| e.into_inner()).remove(&self.key);
        self.lock.freed.notify_all();
    }
}

impl RepoLock {
    /// Takes the lock of the repo `worktree` belongs to, shared by all its worktrees, waiting while
    /// another operation holds it. While it waits it sends one `Progress` event saying so, and a
    /// cancel ends the wait with [`GitError::Cancelled`].
    pub fn hold(&self, worktree: &Path, cancel: &AtomicBool, channel: &Channel<OpEvent>) -> Result<RepoGuard<'_>, GitError> {
        let key = repo_key(worktree)?;
        let mut held = self.held.lock().unwrap_or_else(|e| e.into_inner());
        let mut told = false;
        while held.contains(&key) {
            if cancel.load(Ordering::SeqCst) {
                return Err(GitError::Cancelled);
            }
            if !told {
                told = true;
                let _ = channel.send(OpEvent::Progress { phase: WAITING_PHASE.into(), percent: None });
            }
            held = self.freed.wait_timeout(held, LOCK_POLL).unwrap_or_else(|e| e.into_inner()).0;
        }
        held.insert(key.clone());
        Ok(RepoGuard { lock: self, key })
    }
}

/// The progress phase of an operation waiting for the repo's lock.
pub const WAITING_PHASE: &str = "Waiting for the other git operation on this repo";

/// One spelling of the repo `worktree` belongs to, its common git dir, so its worktrees share a lock.
fn repo_key(worktree: &Path) -> Result<String, GitError> {
    let dir = read_git_line(worktree, &["rev-parse", "--path-format=absolute", "--git-common-dir"])?
        .ok_or_else(|| GitError::Other { stderr: format!("{} is not a git worktree", worktree.display()) })?;
    Ok(worktree_key(Path::new(&dir)))
}
