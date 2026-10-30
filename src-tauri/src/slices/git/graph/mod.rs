//! Topos's commit graph: one streaming `git log` session at a time (#374), laid out in lanes (#375).

#[cfg(test)]
mod bench_dump;
mod badges;
mod cat_file;
mod lanes;
mod log;
mod page;
mod session;
#[cfg(test)]
mod lane_tests;
mod refs;
#[cfg(test)]
mod refs_tests;
#[cfg(test)]
mod tests;

use std::path::PathBuf;

use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::State;

use super::error::GitError;

#[cfg(test)]
pub use lanes::{Track, TrackKind};
pub use log::GraphOrder;
pub use page::{Author, GraphEvent};
pub use badges::{GitRefs, RefBadge, RefKind, WorktreeHead};
pub use session::{GraphOptions, GraphRefs, GraphSessions};

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
