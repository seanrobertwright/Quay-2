//! Topos's git version gate (#369): one floor, checked once per app run on Topos's first open.

use std::io::Read;
use std::process::Stdio;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;

use super::error::GitError;

/// A git version, ordered by `major`, then `minor`, then `patch`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct GitVersion {
    pub major: u32,
    pub minor: u32,
    pub patch: u32,
}

const fn v(major: u32, minor: u32, patch: u32) -> GitVersion {
    GitVersion { major, minor, patch }
}

/// The oldest git Topos runs on: the newest entry of [`RELIED_ON_FLAGS`].
pub const MIN_GIT_VERSION: GitVersion = v(2, 36, 0);

/// Each git feature Topos relies on and the release that introduced it, checked against git's
/// release notes and merge history. `push.autoSetupRemote` (2.37) is absent: git reads it, not Topos.
pub const RELIED_ON_FLAGS: &[(&str, GitVersion)] = &[
    ("--no-optional-locks", v(2, 15, 0)),
    ("%(trailers:key=…,valueonly)", v(2, 22, 0)),
    ("git switch and git restore", v(2, 23, 0)),
    ("add, reset and rm --pathspec-from-file", v(2, 26, 0)),
    ("commit-graph write --split", v(2, 23, 0)),
    ("push --force-if-includes", v(2, 30, 0)),
    ("status --porcelain=v2 --show-stash stash count", v(2, 35, 0)),
    ("built-in core.fsmonitor=true on Windows and macOS", v(2, 36, 0)),
];

/// What `git --version` said about running Topos, as the frontend receives it:
/// `{ "status": "tooOld", "found": "2.30.1.windows.1" }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum GitVersionStatus {
    Ok,
    /// No `git` on PATH.
    Missing,
    /// Older than [`MIN_GIT_VERSION`]; `found` is the version as git printed it.
    TooOld { found: String },
    /// Output that doesn't parse. Topos proceeds with a warning.
    Unknown { raw: String },
}

/// The leading decimal digits of `part`, so `0-rc1` reads as 0. `None` when it has none.
fn leading_number(part: &str) -> Option<u32> {
    let end = part.find(|c: char| !c.is_ascii_digit()).unwrap_or(part.len());
    part[..end].parse().ok()
}

/// The version token of `git --version` output and its parsed number, as in
/// `git version 2.45.1.windows.1` or `git version 2.39.3 (Apple Git-146)`.
fn parse_version_output(output: &str) -> Option<(&str, GitVersion)> {
    let token = output.trim().strip_prefix("git version ")?.split_whitespace().next()?;
    let mut parts = token.split('.');
    let major = leading_number(parts.next()?)?;
    let minor = leading_number(parts.next()?)?;
    let patch = match parts.next() {
        Some(p) => leading_number(p)?,
        None => 0,
    };
    Some((token, v(major, minor, patch)))
}

/// Classifies the stdout of a `git --version` that ran.
pub fn classify_version_output(output: &str) -> GitVersionStatus {
    match parse_version_output(output) {
        Some((_, version)) if version >= MIN_GIT_VERSION => GitVersionStatus::Ok,
        Some((token, _)) => GitVersionStatus::TooOld { found: token.to_string() },
        None => GitVersionStatus::Unknown { raw: output.trim().to_string() },
    }
}

/// How long `git --version` may take before Topos gives up on it.
const VERSION_TIMEOUT: Duration = Duration::from_secs(10);

/// Runs `git --version` once, bounded by [`VERSION_TIMEOUT`].
fn run_version_check() -> Result<GitVersionStatus, GitError> {
    let mut child = match super::op_runner::headless_git()
        .arg("--version")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(GitVersionStatus::Missing),
        Err(e) => return Err(GitError::Other { stderr: format!("could not run git --version: {e}") }),
    };
    // The output is one short line, so it can't fill a pipe before git exits.
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() < VERSION_TIMEOUT => std::thread::sleep(Duration::from_millis(20)),
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(GitError::Other {
                    stderr: format!("git --version did not finish within {} s", VERSION_TIMEOUT.as_secs()),
                });
            }
            Err(e) => return Err(GitError::Other { stderr: format!("could not wait for git --version: {e}") }),
        }
    };
    let mut stdout = String::new();
    let mut stderr = String::new();
    if let Some(mut out) = child.stdout.take() {
        let _ = out.read_to_string(&mut stdout);
    }
    if let Some(mut err) = child.stderr.take() {
        let _ = err.read_to_string(&mut stderr);
    }
    if !status.success() {
        let stderr = stderr.trim();
        return Err(GitError::Other {
            stderr: if stderr.is_empty() { format!("git --version exited with {status}") } else { stderr.to_string() },
        });
    }
    Ok(classify_version_output(&stdout))
}

/// The answer of this app run's first check, kept so later opens don't rerun git.
static CHECKED: Mutex<Option<GitVersionStatus>> = Mutex::new(None);

/// Returns this app run's git version status, running `git --version` on the first call only.
/// `retry` runs it again, for the Retry button after the user installs or upgrades git.
/// A failure to run git is returned and not kept, so the next call tries again.
#[tauri::command]
pub async fn git_version_check(retry: bool) -> Result<GitVersionStatus, GitError> {
    tokio::task::spawn_blocking(move || {
        let mut checked = CHECKED.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if !retry {
            if let Some(status) = checked.as_ref() {
                return Ok(status.clone());
            }
        }
        let status = run_version_check()?;
        *checked = Some(status.clone());
        Ok(status)
    })
    .await
    .map_err(|e| GitError::Other { stderr: format!("task join error: {e}") })?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_plain_and_suffixed_versions() {
        assert_eq!(parse_version_output("git version 2.36.0\n"), Some(("2.36.0", v(2, 36, 0))));
        assert_eq!(
            parse_version_output("git version 2.45.1.windows.5\n"),
            Some(("2.45.1.windows.5", v(2, 45, 1)))
        );
        assert_eq!(
            parse_version_output("git version 2.39.3 (Apple Git-146)"),
            Some(("2.39.3", v(2, 39, 3)))
        );
        assert_eq!(parse_version_output("git version 2.47.0-rc1"), Some(("2.47.0-rc1", v(2, 47, 0))));
        assert_eq!(parse_version_output("git version 2.40"), Some(("2.40", v(2, 40, 0))));
    }

    #[test]
    fn rejects_output_that_is_not_a_version() {
        assert_eq!(parse_version_output(""), None);
        assert_eq!(parse_version_output("hub version 2.14.2"), None);
        assert_eq!(parse_version_output("git version"), None);
        assert_eq!(parse_version_output("git version two.forty"), None);
        assert_eq!(parse_version_output("git version 2"), None);
    }

    #[test]
    fn gates_on_the_floor() {
        assert_eq!(classify_version_output("git version 2.36.0"), GitVersionStatus::Ok);
        assert_eq!(classify_version_output("git version 2.51.0.windows.1"), GitVersionStatus::Ok);
        assert_eq!(classify_version_output("git version 3.0.0"), GitVersionStatus::Ok);
        assert_eq!(
            classify_version_output("git version 2.35.9.windows.1\n"),
            GitVersionStatus::TooOld { found: "2.35.9.windows.1".into() }
        );
        assert_eq!(
            classify_version_output("git version 1.99.0"),
            GitVersionStatus::TooOld { found: "1.99.0".into() }
        );
        assert_eq!(
            classify_version_output("  something else\n"),
            GitVersionStatus::Unknown { raw: "something else".into() }
        );
    }

    #[test]
    fn floor_is_the_newest_relied_on_flag() {
        let newest = RELIED_ON_FLAGS.iter().map(|(_, version)| *version).max();
        assert_eq!(newest, Some(MIN_GIT_VERSION));
    }

    #[test]
    fn installed_git_classifies_without_error() {
        // CI and dev machines have git, so a real run must come back with a status.
        let status = run_version_check().expect("git --version should run");
        assert_ne!(status, GitVersionStatus::Missing);
    }
}
