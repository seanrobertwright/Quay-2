//! The Windows build a terminal pane's ConPTY runs on, for xterm's `windowsPty` option (#813).

/// The running Windows build number as the OS reports it, or `None` off Windows or when it can't
/// be read. The pane parses the answer before xterm sees it.
#[tauri::command]
pub fn windows_build_number() -> Option<u32> {
    read_build_number()
}

/// `RtlGetVersion` reports the real build; `GetVersionExW` reports whatever the app's manifest
/// declares support for.
#[cfg(windows)]
fn read_build_number() -> Option<u32> {
    use windows_sys::Wdk::System::SystemServices::RtlGetVersion;
    use windows_sys::Win32::System::SystemInformation::OSVERSIONINFOW;

    // SAFETY: OSVERSIONINFOW is plain data, for which all zeroes is a valid value.
    let mut info: OSVERSIONINFOW = unsafe { std::mem::zeroed() };
    info.dwOSVersionInfoSize = std::mem::size_of::<OSVERSIONINFOW>() as u32;
    // SAFETY: `info` is a live, writable OSVERSIONINFOW whose size field is set, as RtlGetVersion requires.
    let status = unsafe { RtlGetVersion(&mut info) };
    (status == 0 && info.dwBuildNumber > 0).then_some(info.dwBuildNumber)
}

#[cfg(not(windows))]
fn read_build_number() -> Option<u32> {
    None
}

#[cfg(test)]
mod tests {
    use super::windows_build_number;

    /// ConPTY ships from Windows 10 build 17763 on, so any machine that runs Quay reports at least that.
    #[cfg(windows)]
    #[test]
    fn reads_the_running_windows_build() {
        let build = windows_build_number().expect("the OS reports its build number");
        assert!(build >= 17763, "build {build} is older than any Windows with ConPTY");
    }

    #[cfg(not(windows))]
    #[test]
    fn has_no_build_number_off_windows() {
        assert_eq!(windows_build_number(), None);
    }
}
