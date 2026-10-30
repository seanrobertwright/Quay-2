//! The speed-ups Topos offers on a large or slow repo (#369, #385): a commit-graph, the built-in
//! fsmonitor and the untracked cache. Checking reads only; nothing is written until the operator
//! ticks items and presses "Apply selected", and then only those items.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::error::GitError;
use tauri::ipc::Channel;
use uuid::Uuid;

use super::op_runner::{headless_git, GitOps, OpEvent, OpOptions};
use super::settings::{repo_key, ToposSettingsStore};

/// One speed-up. The frontend can name only these three; it never sends a command or a config key.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SpeedupItem {
    /// `git commit-graph write --reachable --split`, offered only while the repo has no
    /// commit-graph file. It changes no config.
    CommitGraph,
    /// `git config core.fsmonitor true`, offered only on a local disk and only where git has a
    /// built-in fsmonitor daemon (Windows and macOS). It starts a background git process.
    Fsmonitor,
    /// `git config core.untrackedCache true`.
    UntrackedCache,
}

/// What `git_speedup_check` returns.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeedupCheck {
    /// The items not already in place, in the order the dialog lists them.
    pub items: Vec<SpeedupItem>,
    /// Whether the operator chose "Don't suggest for this repo", from its `topos.json` entry.
    pub suppressed: bool,
}

/// Runs `git -C repo <args>` and returns its trimmed stdout, or None when git exits non-zero, as
/// `git config --get` does for a key that isn't set.
fn git_read(repo: &Path, args: &[&str]) -> Result<Option<String>, GitError> {
    let out = headless_git()
        .arg("-C")
        .arg(repo)
        .args(args)
        .output()
        .map_err(|e| GitError::Other { stderr: format!("could not run git: {e}") })?;
    Ok(out.status.success().then(|| String::from_utf8_lossy(&out.stdout).trim().to_string()))
}

/// The repo's `objects/info` folder, where git keeps its commit-graph.
fn objects_info(repo: &Path) -> Result<PathBuf, GitError> {
    git_read(repo, &["rev-parse", "--path-format=absolute", "--git-path", "objects/info"])?
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| GitError::Other { stderr: format!("{} is not a git repository", repo.display()) })
}

/// Whether the repo has a commit-graph, whole or split.
fn has_commit_graph(repo: &Path) -> Result<bool, GitError> {
    let info = objects_info(repo)?;
    Ok(info.join("commit-graph").is_file() || info.join("commit-graphs").join("commit-graph-chain").is_file())
}

/// Whether a git config value reads as false. git's own false spellings, and the empty value.
fn is_false(value: &str) -> bool {
    ["false", "no", "off", "0", ""].contains(&value.to_ascii_lowercase().as_str())
}

/// Whether `core.fsmonitor` is already on: `true`, or a hook path from before the built-in daemon.
fn fsmonitor_set(repo: &Path) -> Result<bool, GitError> {
    Ok(git_read(repo, &["config", "--get", "core.fsmonitor"])?.is_some_and(|v| !is_false(&v)))
}

/// Whether the untracked cache is already on: `core.untrackedCache=true`, or `feature.manyFiles`
/// when `core.untrackedCache` isn't set, since that implies it.
fn untracked_cache_set(repo: &Path) -> Result<bool, GitError> {
    if let Some(value) = git_read(repo, &["config", "--get", "core.untrackedCache"])? {
        return Ok(!is_false(&value) && !value.eq_ignore_ascii_case("keep"));
    }
    Ok(git_read(repo, &["config", "--get", "--type=bool", "feature.manyFiles"])?.as_deref() == Some("true"))
}

/// Which speed-ups apply to `repo`, and whether the operator turned them away for it. Reads only.
pub fn speedup_check(repo: &Path, store: &ToposSettingsStore) -> Result<SpeedupCheck, GitError> {
    let mut items = Vec::new();
    if !has_commit_graph(repo)? {
        items.push(SpeedupItem::CommitGraph);
    }
    if fsmonitor_supported(repo) && !fsmonitor_set(repo)? {
        items.push(SpeedupItem::Fsmonitor);
    }
    if !untracked_cache_set(repo)? {
        items.push(SpeedupItem::UntrackedCache);
    }
    Ok(SpeedupCheck { items, suppressed: store.speedup_suppressed(&repo_key(repo)?) })
}

/// Whether git's built-in fsmonitor can watch `path`: on Windows and macOS, and only when `path`
/// is on a local disk. When that can't be told for sure, the answer is no.
pub fn fsmonitor_supported(path: &Path) -> bool {
    cfg!(any(windows, target_os = "macos")) && on_local_disk(path)
}

/// Whether `path` is on a fixed local disk. A network share, a mapped network drive, a removable
/// drive, a path that doesn't exist or any failure to tell reads as not local.
#[cfg(windows)]
pub fn on_local_disk(path: &Path) -> bool {
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetVolumePathNameW(file_name: *const u16, volume_path_name: *mut u16, buffer_length: u32) -> i32;
        fn GetDriveTypeW(root_path_name: *const u16) -> u32;
    }
    const DRIVE_FIXED: u32 = 3;

    let Ok(canonical) = path.canonicalize() else {
        return false;
    };
    let text = canonical.to_string_lossy();
    // canonicalize gives `\\?\C:\…` for a drive and `\\?\UNC\server\…` for a share.
    let Some(rest) = text.strip_prefix(r"\\?\") else {
        return false;
    };
    let bytes = rest.as_bytes();
    if bytes.len() < 3 || !bytes[0].is_ascii_alphabetic() || bytes[1] != b':' || bytes[2] != b'\\' {
        return false;
    }
    let wide: Vec<u16> = std::ffi::OsStr::new(rest).encode_wide().chain(std::iter::once(0)).collect();
    let mut volume = [0u16; 1024];
    // SAFETY: `wide` is NUL-terminated, and `volume` is a writable buffer of the length passed.
    if unsafe { GetVolumePathNameW(wide.as_ptr(), volume.as_mut_ptr(), volume.len() as u32) } == 0 {
        return false;
    }
    // SAFETY: GetVolumePathNameW succeeded, so `volume` holds a NUL-terminated root path.
    unsafe { GetDriveTypeW(volume.as_ptr()) == DRIVE_FIXED }
}

/// Whether `path` is on a local disk. macOS mounts network shares, external drives and disk
/// images under these folders, so a path under any of them reads as not local.
#[cfg(target_os = "macos")]
pub fn on_local_disk(path: &Path) -> bool {
    let Ok(canonical) = path.canonicalize() else {
        return false;
    };
    !["/Volumes", "/net", "/Network", "/private/var/automount"].iter().any(|mount| canonical.starts_with(mount))
}

/// git has no built-in fsmonitor daemon here, so whether the disk is local never matters.
#[cfg(not(any(windows, target_os = "macos")))]
pub fn on_local_disk(_path: &Path) -> bool {
    false
}

/// The repo-local config a config item writes, as `git config <key> true`.
fn config_key(item: SpeedupItem) -> Option<&'static str> {
    match item {
        SpeedupItem::CommitGraph => None,
        SpeedupItem::Fsmonitor => Some("core.fsmonitor"),
        SpeedupItem::UntrackedCache => Some("core.untrackedCache"),
    }
}

/// The commit-graph write. `--progress` makes git print its progress without a terminal; it changes
/// nothing that is written.
const COMMIT_GRAPH_WRITE: [&str; 5] = ["commit-graph", "write", "--reachable", "--split", "--progress"];

/// Writes the ticked `items` to `repo` and nothing else, streaming to `channel` and ending in `Done`
/// or `Failed`. The config items go first; the commit-graph write runs last as op `op_id`, which
/// [`GitOps::cancel`] stops. fsmonitor is refused, before anything is written, where
/// [`fsmonitor_supported`] says no.
pub fn speedup_apply(
    repo: &Path,
    items: &[SpeedupItem],
    op_id: Uuid,
    ops: &GitOps,
    channel: &Channel<OpEvent>,
) -> Result<(), GitError> {
    let fail = |error: GitError| {
        let _ = channel.send(OpEvent::Failed { error: error.clone() });
        Err(error)
    };
    if items.contains(&SpeedupItem::Fsmonitor) && !fsmonitor_supported(repo) {
        return fail(GitError::Other {
            stderr: format!("git's fsmonitor can't watch {}: it isn't on a local disk.", repo.display()),
        });
    }
    for item in [SpeedupItem::Fsmonitor, SpeedupItem::UntrackedCache] {
        let Some(key) = config_key(item).filter(|_| items.contains(&item)) else {
            continue;
        };
        let _ = channel.send(OpEvent::Progress { phase: format!("Setting {key}"), percent: None });
        let out = match headless_git().arg("-C").arg(repo).args(["config", key, "true"]).output() {
            Ok(out) => out,
            Err(e) => return fail(GitError::Other { stderr: format!("could not run git config: {e}") }),
        };
        if !out.status.success() {
            return fail(GitError::Other { stderr: String::from_utf8_lossy(&out.stderr).trim().to_string() });
        }
    }
    if !items.contains(&SpeedupItem::CommitGraph) {
        let _ = channel.send(OpEvent::Done);
        return Ok(());
    }
    let opts = OpOptions { c_locale: true, progress_at_once: true, ..OpOptions::default() };
    ops.run(op_id, repo, &COMMIT_GRAPH_WRITE, &opts, channel).map(|_| ())
}

/// Which speed-ups apply to `repo_path`, a repo or worktree, and whether they're turned away for
/// it. See [`speedup_check`].
#[tauri::command]
pub async fn git_speedup_check(
    repo_path: String,
    store: tauri::State<'_, ToposSettingsStore>,
) -> Result<SpeedupCheck, GitError> {
    let store = store.inner().clone();
    tokio::task::spawn_blocking(move || speedup_check(Path::new(&repo_path), &store))
        .await
        .map_err(|e| GitError::Other { stderr: format!("could not check the speed-ups: {e}") })?
}

/// Writes the ticked `items` to `repo_path` as op `op_id`, which `git_op_cancel` stops while the
/// commit-graph write runs. See [`speedup_apply`]. An item outside [`SpeedupItem`] or an `opId`
/// that isn't a UUID is rejected before this runs.
#[tauri::command]
pub async fn git_speedup_apply(
    repo_path: String,
    items: Vec<SpeedupItem>,
    op_id: Uuid,
    on_event: Channel<OpEvent>,
    app: tauri::AppHandle,
) -> Result<(), GitError> {
    use tauri::Manager;
    tokio::task::spawn_blocking(move || {
        speedup_apply(Path::new(&repo_path), &items, op_id, &app.state::<GitOps>(), &on_event)
    })
    .await
    .map_err(|e| GitError::Other { stderr: format!("could not apply the speed-ups: {e}") })?
}
