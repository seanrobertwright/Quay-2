//! The console this process runs in, which is the PTY Quay opened for the terminal.

/// The terminal's size in columns and rows, or 80x24 when it can't be read.
#[cfg(windows)]
pub fn size() -> (u16, u16) {
    use windows_sys::Win32::System::Console::{
        CONSOLE_SCREEN_BUFFER_INFO, GetConsoleScreenBufferInfo, GetStdHandle, STD_OUTPUT_HANDLE,
    };
    // SAFETY: GetStdHandle has no preconditions, and GetConsoleScreenBufferInfo writes only
    // into the zeroed struct it is handed.
    unsafe {
        let mut info: CONSOLE_SCREEN_BUFFER_INFO = std::mem::zeroed();
        if GetConsoleScreenBufferInfo(GetStdHandle(STD_OUTPUT_HANDLE), &mut info) == 0 {
            return (80, 24);
        }
        let w = info.srWindow;
        ((w.Right - w.Left + 1).max(1) as u16, (w.Bottom - w.Top + 1).max(1) as u16)
    }
}

#[cfg(not(windows))]
pub fn size() -> (u16, u16) {
    (80, 24)
}

/// Puts the console in raw mode for as long as the guard lives: keystrokes, Ctrl+C included,
/// arrive as bytes with no echo and no line editing, and escape sequences written to the
/// console are interpreted rather than printed. The previous modes come back on drop.
pub struct RawMode {
    #[cfg(windows)]
    restore: Vec<(windows_sys::Win32::Foundation::HANDLE, u32)>,
}

#[cfg(windows)]
impl RawMode {
    pub fn enter() -> RawMode {
        use windows_sys::Win32::System::Console::{
            DISABLE_NEWLINE_AUTO_RETURN, ENABLE_ECHO_INPUT, ENABLE_LINE_INPUT, ENABLE_PROCESSED_INPUT,
            ENABLE_PROCESSED_OUTPUT, ENABLE_VIRTUAL_TERMINAL_INPUT, ENABLE_VIRTUAL_TERMINAL_PROCESSING,
            GetConsoleMode, GetStdHandle, STD_INPUT_HANDLE, STD_OUTPUT_HANDLE, SetConsoleMode,
        };
        let mut restore = Vec::new();
        // SAFETY: the handles come from GetStdHandle, and the mode calls only read and write
        // console flags.
        unsafe {
            let input = GetStdHandle(STD_INPUT_HANDLE);
            let mut mode = 0;
            if GetConsoleMode(input, &mut mode) != 0 {
                restore.push((input, mode));
                let raw = (mode & !(ENABLE_ECHO_INPUT | ENABLE_LINE_INPUT | ENABLE_PROCESSED_INPUT))
                    | ENABLE_VIRTUAL_TERMINAL_INPUT;
                SetConsoleMode(input, raw);
            }
            let output = GetStdHandle(STD_OUTPUT_HANDLE);
            let mut mode = 0;
            if GetConsoleMode(output, &mut mode) != 0 {
                restore.push((output, mode));
                SetConsoleMode(
                    output,
                    mode | ENABLE_PROCESSED_OUTPUT | ENABLE_VIRTUAL_TERMINAL_PROCESSING | DISABLE_NEWLINE_AUTO_RETURN,
                );
            }
        }
        RawMode { restore }
    }
}

#[cfg(windows)]
impl Drop for RawMode {
    fn drop(&mut self) {
        for (handle, mode) in &self.restore {
            // SAFETY: restores a mode read from the same handle in `enter`.
            unsafe {
                windows_sys::Win32::System::Console::SetConsoleMode(*handle, *mode);
            }
        }
    }
}

#[cfg(not(windows))]
impl RawMode {
    pub fn enter() -> RawMode {
        RawMode {}
    }
}
