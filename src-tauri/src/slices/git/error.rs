use serde::Serialize;

/// Why a Topos git command failed, as the frontend receives it: `{ "kind": "other", "stderr": "…" }`.
/// `Other` is the fallback for failures no named variant covers yet.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum GitError {
    /// The operator cancelled the operation, and its process tree was killed.
    Cancelled,
    /// Another git process holds the index's `index.lock`, and it was still held after the bounded
    /// retry. Topos never deletes the lock; the operator retries once the other process is done.
    IndexLocked,
    /// A staging operation is already running on this worktree, and only one runs at a time.
    StagingBusy,
    /// The file changed since its diff was read, so the selection made on that diff is dropped
    /// rather than applied to what the file holds now.
    StaleDiff,
    /// git's stderr, or the reason it could not be run.
    Other { stderr: String },
}

impl std::fmt::Display for GitError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GitError::Cancelled => f.write_str("cancelled"),
            GitError::IndexLocked => f.write_str("another git process holds index.lock"),
            GitError::StagingBusy => f.write_str("a staging operation is already running on this worktree"),
            GitError::StaleDiff => f.write_str("the file changed since its diff was read"),
            GitError::Other { stderr } => f.write_str(stderr),
        }
    }
}

impl std::error::Error for GitError {}
