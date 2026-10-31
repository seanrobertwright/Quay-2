//! Topos's commit graph: one streaming `git log` session at a time (#374), laid out in lanes (#375).

#[cfg(test)]
mod bench_dump;
mod badges;
mod cat_file;
#[cfg(test)]
mod filter_tests;
mod lanes;
mod log;
mod page;
pub(super) mod provenance;
mod session;
#[cfg(test)]
mod lane_tests;
mod refs;
#[cfg(test)]
mod refresh_tests;
#[cfg(test)]
mod refs_tests;
#[cfg(test)]
mod tests;
mod watch;
#[cfg(test)]
mod watch_tests;

use std::path::PathBuf;

use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::State;

use super::error::GitError;

#[cfg(test)]
pub use lanes::{Track, TrackKind};
pub use log::GraphOrder;
pub use page::{Author, GraphEvent};
pub use badges::{read_refs, GitRefs, RefBadge, RefKind, WorktreeHead};
pub use session::{GraphOptions, GraphRefs, GraphSessions, Refreshed};
pub use watch::{Dirty, RepoChanged, WatchState};

/// Starts a graph session on `repo_path`, closing any live one, and streams its rows to `on_event`.
/// Returns the session id every event carries.
#[tauri::command]
pub async fn git_graph_open(
    repo_path: String,
    options: GraphOptions,
    on_event: Channel<InvokeResponseBody>,
    sessions: State<'_, GraphSessions>,
) -> Result<u32, GitError> {
    let sessions = sessions.inner();
    // Opening may wait for the old session's git to exit, so keep it off the async runtime's threads.
    tokio::task::block_in_place(|| sessions.open(&PathBuf::from(repo_path), options, on_event))
}

/// Lets session `session_id` load `rows` more rows, resuming it if it paused.
#[tauri::command]
pub async fn git_graph_more(session_id: u32, rows: u32, sessions: State<'_, GraphSessions>) -> Result<(), GitError> {
    let sessions = sessions.inner();
    // The lock it takes can be held while an open waits for the old session's git to exit.
    tokio::task::block_in_place(|| sessions.more(session_id, rows))
}

/// Refreshes session `session_id` after its repo changed (#379): re-runs its `git log` and sends
/// `Splice` or `Reset` with the rows that announces. Returns which, once they are sent.
#[tauri::command]
pub async fn git_graph_refresh(session_id: u32, sessions: State<'_, GraphSessions>) -> Result<Refreshed, GitError> {
    let sessions = sessions.inner();
    // The walk runs a second `git log` and lays out up to 20k rows before it answers.
    tokio::task::block_in_place(|| sessions.refresh(session_id))
}

/// Points session `session_id`'s repository watch at `worktree_path`, the selected worktree, and
/// watches its files only while `visible` (#379). Restarts a watch that is off, so this is also
/// Retry. Returns whether live updates are on.
#[tauri::command]
pub async fn git_graph_watch(
    session_id: u32,
    worktree_path: String,
    visible: bool,
    sessions: State<'_, GraphSessions>,
) -> Result<WatchState, GitError> {
    let sessions = sessions.inner();
    tokio::task::block_in_place(|| sessions.watch(session_id, &PathBuf::from(worktree_path), visible))
}

/// A fingerprint of `worktree_path`'s refs, HEAD and index, which Topos compares on focus and on
/// show while live updates are off (#354).
#[tauri::command]
pub async fn git_repo_fingerprint(worktree_path: String) -> Result<String, GitError> {
    let worktree = PathBuf::from(worktree_path);
    tokio::task::spawn_blocking(move || watch::fingerprint(&worktree))
        .await
        .map_err(|e| GitError::Other { stderr: format!("could not read the fingerprint: {e}") })?
}

/// Ends session `session_id` and its git processes.
#[tauri::command]
pub async fn git_graph_close(session_id: u32, sessions: State<'_, GraphSessions>) -> Result<(), GitError> {
    let sessions = sessions.inner();
    tokio::task::block_in_place(|| sessions.close(session_id));
    Ok(())
}

/// The refs of `repo_path` and its worktrees' HEADs (#378), read apart from the graph's `git log`
/// so badges refresh without re-running the walk.
#[tauri::command]
pub async fn git_refs(repo_path: String) -> Result<GitRefs, GitError> {
    let repo = PathBuf::from(repo_path);
    tokio::task::spawn_blocking(move || badges::read_refs(&repo))
        .await
        .map_err(|e| GitError::Other { stderr: format!("could not read refs: {e}") })?
}
