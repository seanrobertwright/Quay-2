//! The startup check for an inherited RedirectionGuard on Windows (#629).
//!
//! A launcher can start Quay with the `ProcessRedirectionTrustPolicy` mitigation in enforce
//! mode. Quay and every process it starts (terminals, agents, `git` hooks, `node`) then
//! inherit it and cannot follow symlinks or junctions, so pnpm's linked `node_modules` and the
//! commit hooks fail with no hint why. Quay reads its own policy once at startup, logs one line
//! about it, and the front end shows a shell-wide warning when enforcement is on.

use std::sync::atomic::{AtomicBool, Ordering};

use tracing::Level;

/// `EnforceRedirectionTrust`, bit 0 of `PROCESS_MITIGATION_REDIRECTION_TRUST_POLICY`.
pub const ENFORCE_BIT: u32 = 1;

/// What reading the policy gave: its raw flags, or why it could not be read.
pub type PolicyRead = Result<u32, String>;

/// Whether Quay should warn the operator. Only a successful read with the enforce bit set
/// warns: audit mode alone changes nothing for child processes, and a failed check stays quiet.
pub fn redirection_guard_warning(read: &PolicyRead) -> bool {
    matches!(read, Ok(flags) if flags & ENFORCE_BIT != 0)
}

/// The one log line a Windows startup writes about the check, with its level.
pub fn check_log_line(read: &PolicyRead) -> (Level, String) {
    match read {
        Ok(flags) if redirection_guard_warning(read) => (
            Level::WARN,
            format!(
                "RedirectionGuard is enforced (ProcessRedirectionTrustPolicy flags 0x{flags:x}): terminals and agents started by Quay cannot follow symlinks or junctions"
            ),
        ),
        Ok(flags) => (
            Level::INFO,
            format!("RedirectionGuard is not enforced (ProcessRedirectionTrustPolicy flags 0x{flags:x})"),
        ),
        Err(error) => (Level::WARN, format!("RedirectionGuard check failed: {error}")),
    }
}

/// Reads this process's `ProcessRedirectionTrustPolicy` flags.
#[cfg(windows)]
pub fn read_policy() -> PolicyRead {
    use windows_sys::Win32::System::Threading::{
        GetCurrentProcess, GetProcessMitigationPolicy, ProcessRedirectionTrustPolicy,
    };
    let mut flags: u32 = 0;
    // SAFETY: the buffer is a live `u32`, and its size is passed, as the policy's struct is one DWORD.
    let ok = unsafe {
        GetProcessMitigationPolicy(
            GetCurrentProcess(),
            ProcessRedirectionTrustPolicy,
            (&mut flags as *mut u32).cast(),
            std::mem::size_of::<u32>(),
        )
    };
    if ok == 0 {
        Err(std::io::Error::last_os_error().to_string())
    } else {
        Ok(flags)
    }
}

/// Whether the warning is still to be shown: the startup decision, until the operator dismisses
/// it. Kept here and not in the window, so a dismissal outlives a reload of the window.
pub struct RedirectionGuardState {
    showing: AtomicBool,
}

impl RedirectionGuardState {
    fn new(warn: bool) -> Self {
        Self { showing: AtomicBool::new(warn) }
    }

    /// Runs the check once and logs its line. On platforms other than Windows nothing runs.
    pub fn check_at_startup() -> Self {
        #[cfg(windows)]
        {
            let read = read_policy();
            let (level, line) = check_log_line(&read);
            if level == Level::WARN {
                tracing::warn!("{line}");
            } else {
                tracing::info!("{line}");
            }
            Self::new(redirection_guard_warning(&read))
        }
        #[cfg(not(windows))]
        {
            Self::new(false)
        }
    }

    fn showing(&self) -> bool {
        self.showing.load(Ordering::Relaxed)
    }

    fn dismiss(&self) {
        self.showing.store(false, Ordering::Relaxed);
    }
}

/// Whether the front end should show the RedirectionGuard warning.
#[tauri::command]
pub fn get_redirection_guard_warning(state: tauri::State<'_, RedirectionGuardState>) -> bool {
    state.showing()
}

/// The operator dismissed the RedirectionGuard warning: it stays away until Quay restarts.
#[tauri::command]
pub fn dismiss_redirection_guard_warning(state: tauri::State<'_, RedirectionGuardState>) {
    state.dismiss();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enforce_warns() {
        assert!(redirection_guard_warning(&Ok(0x1)));
    }

    #[test]
    fn enforce_with_audit_counts_as_enforce() {
        assert!(redirection_guard_warning(&Ok(0x3)));
    }

    #[test]
    fn audit_only_does_not_warn() {
        assert!(!redirection_guard_warning(&Ok(0x2)));
    }

    #[test]
    fn off_does_not_warn() {
        assert!(!redirection_guard_warning(&Ok(0)));
    }

    #[test]
    fn failed_check_does_not_warn() {
        assert!(!redirection_guard_warning(&Err("The parameter is incorrect.".into())));
    }

    #[test]
    fn log_levels_follow_the_result() {
        let (level, line) = check_log_line(&Ok(0x1));
        assert_eq!(level, Level::WARN);
        assert!(line.contains("0x1"), "{line}");

        let (level, line) = check_log_line(&Ok(0x2));
        assert_eq!(level, Level::INFO);
        assert!(line.contains("0x2"), "{line}");

        let (level, line) = check_log_line(&Err("Access is denied.".into()));
        assert_eq!(level, Level::WARN);
        assert!(line.contains("Access is denied."), "{line}");
    }

    #[test]
    fn the_warning_shows_until_dismissed() {
        let state = RedirectionGuardState::new(true);
        assert!(state.showing());
        state.dismiss();
        assert!(!state.showing());
    }

    #[test]
    fn no_warning_shows_when_the_check_did_not_warn() {
        assert!(!RedirectionGuardState::new(false).showing());
    }

    #[cfg(windows)]
    #[test]
    fn reading_this_process_policy_succeeds_where_windows_knows_the_policy() {
        // An older Windows refuses a policy it does not know: ERROR_INVALID_PARAMETER (87)
        if let Err(error) = read_policy() {
            assert!(error.contains("os error 87"), "{error}");
        }
    }
}
