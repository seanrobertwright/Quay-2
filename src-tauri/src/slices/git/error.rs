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
    /// A conflicted file, its stages or its worktree bytes, changed since the resolver opened it, so
    /// the write was refused rather than overwrite what git or an agent did. Nothing was written.
    ConflictStale,
    /// A file changed since it was discarded, so restoring its backup would overwrite the newer
    /// bytes. Nothing was restored; the backup can still be copied to a new file.
    ChangedSinceDiscard { paths: Vec<String> },
    /// A commit hook, such as `pre-commit` or `commit-msg`, exited non-zero, so nothing was
    /// committed. `output` is the last 64 KiB of what the commit printed, hook output included.
    HookFailed { hook: String, output: String },
    /// The operation Continue, Skip or Abort was asked for isn't the one under way: it ended, or
    /// another took its place, since the banner read it. Nothing was run.
    NoOperation,
    /// Continue was asked for while `count` paths still have unmerged entries. Nothing was run.
    ConflictsRemain { count: u32 },
    /// The file is handed to an agent (#392), so Topos refused to write it. Nothing was written; the
    /// agent stages it, or the operator takes it back first. `agent` is untrusted display text.
    HandedOff { path: String, agent: String },
    /// A checkout was refused because it would overwrite local changes, or untracked files, at
    /// `paths` (relative to the worktree, at most [`super::staging::STATUS_CAP`]). Nothing changed;
    /// the operator commits, stashes or discards them in the staging inspector first.
    CheckoutWouldOverwrite { paths: Vec<String> },
    /// The branch is checked out in the worktree at `worktree`, and git checks a branch out in only
    /// one worktree at a time, so it can't be checked out elsewhere, and Topos never deletes it.
    /// For a delete, `worktree` can be the one the command ran in. Nothing changed; Topos offers to
    /// show that worktree instead.
    BranchInOtherWorktree { worktree: String },
    /// `git branch -d` refused to delete a branch that isn't merged. `ahead` commits are reachable
    /// from its `tip` and from no other branch, remote-tracking branch, tag or HEAD, so deleting it
    /// anyway (`-D`) leaves them reachable only from the Restore toast and the reflog.
    NotFullyMerged { ahead: u32, tip: String },
    /// A branch or tag named `name` already exists, so nothing was written. `name` is untrusted
    /// display text.
    RefExists { name: String },
    /// Another git process holds the lock on a ref the operation writes (`<ref>.lock`, or
    /// `packed-refs.lock`). Topos never deletes the lock; nothing was written, and the operator
    /// retries once the other process is done.
    RefLocked,
    /// `name` is not a valid branch name, or names no commit, so nothing was written. `name` is
    /// untrusted display text.
    InvalidRefName { name: String },
    /// A push was refused because the remote branch has commits the local one lacks, so it isn't a
    /// fast-forward. Topos offers Pull. `ref` is the remote ref, untrusted display text.
    NonFastForward { r#ref: String },
    /// The branch has no upstream to push to or pull from, and `push.autoSetupRemote` doesn't set
    /// one. `remotes` are the repo's remotes, which "Push and set upstream" picks among.
    NoUpstream { branch: String, remotes: Vec<String> },
    /// The remote refused `ref`, as a server hook or branch protection does, saying `reason`.
    /// `remote_lines` are the `remote:` lines it printed, untrusted text shown verbatim.
    RemoteRejected { r#ref: String, reason: String, remote_lines: Vec<String> },
    /// The remote wanted a credential that git, which never prompts here, couldn't supply.
    AuthFailed,
    /// ssh refused a host key it doesn't know, or one that changed, with no terminal to ask on.
    HostKeyUnknown,
    /// git couldn't reach the remote: the host didn't resolve, or the connection failed.
    Network,
    /// git refused a pull of divergent branches because git config sets no strategy for them.
    /// Topos offers Merge, Rebase or Fast-forward only for this pull.
    DivergentPullNeedsStrategy,
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
            GitError::ConflictStale => f.write_str("the conflicted file changed since it was opened"),
            GitError::ChangedSinceDiscard { paths } => write!(f, "changed since the discard: {}", paths.join(", ")),
            GitError::HookFailed { hook, .. } => write!(f, "the {hook} hook failed"),
            GitError::NoOperation => f.write_str("that operation is no longer under way"),
            GitError::ConflictsRemain { count } => write!(f, "{count} conflicted paths are not resolved and staged yet"),
            GitError::HandedOff { path, agent } => write!(f, "{path} is with {agent}; take it back first"),
            GitError::CheckoutWouldOverwrite { paths } => write!(f, "the checkout would overwrite local changes to {}", paths.join(", ")),
            GitError::BranchInOtherWorktree { worktree } => write!(f, "the branch is checked out in the worktree at {worktree}"),
            GitError::NotFullyMerged { ahead, tip } => write!(f, "the branch is not fully merged: {ahead} commits up to {tip} are on no other ref"),
            GitError::RefExists { name } => write!(f, "{name} already exists"),
            GitError::RefLocked => f.write_str("another git process holds a ref lock"),
            GitError::InvalidRefName { name } => write!(f, "{name} is not a valid branch name or commit"),
            GitError::NonFastForward { r#ref } => write!(f, "{} on the remote has commits this branch lacks", r#ref),
            GitError::NoUpstream { branch, .. } => write!(f, "{branch} has no upstream branch"),
            GitError::RemoteRejected { r#ref, reason, .. } => write!(f, "the remote rejected {}: {reason}", r#ref),
            GitError::AuthFailed => f.write_str("the remote wanted a credential git could not supply"),
            GitError::HostKeyUnknown => f.write_str("ssh could not verify the remote's host key"),
            GitError::Network => f.write_str("git could not reach the remote"),
            GitError::DivergentPullNeedsStrategy => f.write_str("the branches have diverged and git config sets no pull strategy"),
            GitError::Other { stderr } => f.write_str(stderr),
        }
    }
}

impl std::error::Error for GitError {}
