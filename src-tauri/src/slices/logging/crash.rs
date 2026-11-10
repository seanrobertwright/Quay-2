//! `crash.log`: one entry per panic, written synchronously by the panic hook.

use std::io::Write;
use std::path::{Path, PathBuf};

use crate::dates;

/// `crash.log` grows by appending; once it reaches this size the next entry starts it afresh.
pub const CRASH_LOG_CAP_BYTES: u64 = 1_000_000;

/// The file name of the crash log inside the logs folder.
pub const CRASH_LOG_NAME: &str = "crash.log";

/// The base address of the main executable in memory, if available.
/// On Windows, this is the handle returned by `GetModuleHandleW(NULL)`.
#[cfg(windows)]
pub fn current_module_base() -> Option<usize> {
    unsafe {
        let handle = windows_sys::Win32::System::LibraryLoader::GetModuleHandleW(std::ptr::null());
        if handle == 0 {
            None
        } else {
            Some(handle as usize)
        }
    }
}

#[cfg(not(windows))]
pub fn current_module_base() -> Option<usize> {
    None
}

/// One crash-log entry: when, on which thread, where, what the panic said, the module base, and the backtrace.
pub fn format_entry(
    timestamp_ms: i64,
    thread: &str,
    location: &str,
    message: &str,
    module_base: Option<usize>,
    backtrace: &str,
) -> String {
    let module_base_line = match module_base {
        Some(base) => format!("  module_base: 0x{base:x}\n"),
        None => String::new(),
    };
    format!(
        "[{}] Quay {} panicked
  thread:      {}
  location:    {}
  message:     {}
{}  backtrace:
{}

",
        format_utc(timestamp_ms),
        env!("CARGO_PKG_VERSION"),
        thread,
        location,
        message,
        module_base_line,
        backtrace.trim_end(),
    )
}

/// Appends `entry` to `crash.log` in `dir`, starting the file afresh if it has reached the cap.
pub fn append_entry(dir: &Path, entry: &str) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let path = dir.join(CRASH_LOG_NAME);
    let full = std::fs::metadata(&path).map(|m| m.len() >= CRASH_LOG_CAP_BYTES).unwrap_or(false);
    let mut options = std::fs::OpenOptions::new();
    options.create(true);
    if full {
        options.write(true).truncate(true);
    } else {
        options.append(true);
    }
    let mut file = options.open(path)?;
    file.write_all(entry.as_bytes())?;
    file.sync_all()
}

/// `YYYY-MM-DDTHH:MM:SSZ` for a Unix time in milliseconds, in UTC.
fn format_utc(ms: i64) -> String {
    let seconds = ms.div_euclid(1000).rem_euclid(86_400);
    format!(
        "{}T{:02}:{:02}:{:02}Z",
        dates::day_to_string(dates::utc_day(ms)),
        seconds / 3600,
        seconds % 3600 / 60,
        seconds % 60
    )
}

/// Makes every panic write a `crash.log` entry in `dir` and a `tracing` error before the
/// previous panic hook runs.
pub fn install_panic_hook(dir: PathBuf) {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let thread = std::thread::current();
        let location = info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_else(|| "unknown".to_string());
        let payload = info.payload();
        let message = payload
            .downcast_ref::<&str>()
            .map(|s| s.to_string())
            .or_else(|| payload.downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "(non-text panic payload)".to_string());
        let backtrace = std::backtrace::Backtrace::force_capture().to_string();
        let module_base = current_module_base();
        let entry = format_entry(
            dates::now_ms(),
            thread.name().unwrap_or("<unnamed>"),
            &location,
            &message,
            module_base,
            &backtrace,
        );
        // A failure here has nowhere better to go than stderr; the hook must not panic again.
        if let Err(error) = append_entry(&dir, &entry) {
            eprintln!("Quay could not write {}: {error}", dir.join(CRASH_LOG_NAME).display());
        }
        tracing::error!(thread = thread.name().unwrap_or("<unnamed>"), %location, "panic: {message}");
        previous(info);
    }));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TempDir;
    use std::fs;
    use std::sync::Mutex;

    /// The panic hook is process-wide; tests that swap it take this lock.
    static HOOK_LOCK: Mutex<()> = Mutex::new(());

    /// Puts the hook that was installed before the test back, even if an assertion fails.
    type Hook = Box<dyn Fn(&std::panic::PanicHookInfo<'_>) + Sync + Send + 'static>;

    struct RestoreHook(Option<Hook>);

    impl Drop for RestoreHook {
        fn drop(&mut self) {
            if let Some(hook) = self.0.take() {
                std::panic::set_hook(hook);
            }
        }
    }

    fn temp_dir(name: &str) -> TempDir {
        TempDir::new(&format!("crash-{name}"))
    }

    #[test]
    fn an_entry_carries_time_thread_location_message_and_backtrace() {
        let entry_with_base = format_entry(
            1_700_000_000_000,
            "worker-3",
            "src/a.rs:10:5",
            "boom",
            Some(0x7ff7_1234_0000),
            "frame 0\nframe 1",
        );
        assert!(entry_with_base.contains("2023-11-14T22:13:20Z"), "{}", entry_with_base);
        assert!(entry_with_base.contains("worker-3"), "{}", entry_with_base);
        assert!(entry_with_base.contains("src/a.rs:10:5"), "{}", entry_with_base);
        assert!(entry_with_base.contains("boom"), "{}", entry_with_base);
        assert!(entry_with_base.contains("module_base: 0x7ff712340000"), "{}", entry_with_base);
        assert!(entry_with_base.contains("frame 0\nframe 1"), "{}", entry_with_base);
        assert!(entry_with_base.ends_with('\n'));

        let entry_without_base = format_entry(
            1_700_000_000_000,
            "worker-3",
            "src/a.rs:10:5",
            "boom",
            None,
            "frame 0\nframe 1",
        );
        assert!(!entry_without_base.contains("module_base:"), "{}", entry_without_base);
    }

    #[test]
    #[cfg(windows)]
    fn current_module_base_returns_a_non_null_address_on_windows() {
        let base = current_module_base();
        assert!(base.is_some(), "module base should be found on Windows");
        assert!(base.unwrap() > 0, "module base address should be non-zero");
    }

    #[test]
    fn entries_are_appended_in_order() {
        let dir = temp_dir("append");
        append_entry(&dir, "first\n").unwrap();
        append_entry(&dir, "second\n").unwrap();
        assert_eq!(fs::read_to_string(dir.join(CRASH_LOG_NAME)).unwrap(), "first\nsecond\n");
    }

    #[test]
    fn a_crash_log_at_the_cap_starts_afresh_with_the_new_entry() {
        let dir = temp_dir("cap");
        fs::write(dir.join(CRASH_LOG_NAME), vec![b'x'; CRASH_LOG_CAP_BYTES as usize]).unwrap();
        append_entry(&dir, "new\n").unwrap();
        assert_eq!(fs::read_to_string(dir.join(CRASH_LOG_NAME)).unwrap(), "new\n");
    }

    #[test]
    fn a_crash_log_below_the_cap_is_kept() {
        let dir = temp_dir("below");
        fs::write(dir.join(CRASH_LOG_NAME), vec![b'x'; CRASH_LOG_CAP_BYTES as usize - 1]).unwrap();
        append_entry(&dir, "new\n").unwrap();
        assert_eq!(fs::metadata(dir.join(CRASH_LOG_NAME)).unwrap().len(), CRASH_LOG_CAP_BYTES + 3);
    }

    #[test]
    fn a_panic_writes_an_entry_and_still_reaches_the_previous_hook() {
        let _lock = HOOK_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        let dir = temp_dir("hook");
        let _restore = RestoreHook(Some(std::panic::take_hook()));
        let previous_ran = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let flag = previous_ran.clone();
        std::panic::set_hook(Box::new(move |_| flag.store(true, std::sync::atomic::Ordering::SeqCst)));

        install_panic_hook(dir.to_path_buf());
        let result = std::thread::Builder::new()
            .name("crash-test-thread".into())
            .spawn(|| panic!("kaboom {}", 42))
            .unwrap()
            .join();

        assert!(result.is_err());
        assert!(previous_ran.load(std::sync::atomic::Ordering::SeqCst), "the previous hook did not run");
        let text = fs::read_to_string(dir.join(CRASH_LOG_NAME)).unwrap();
        assert!(text.contains("kaboom 42"), "{}", text);
        assert!(text.contains("crash-test-thread"), "{}", text);
        assert!(text.contains("crash.rs"), "the location is missing: {}", text);
        #[cfg(windows)]
        assert!(text.contains("module_base: 0x"), "module base should be recorded: {}", text);
    }

    #[test]
    fn a_panic_with_an_unwritable_folder_does_not_panic_again() {
        let _lock = HOOK_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        let dir = temp_dir("unwritable");
        let blocker = dir.join("file");
        fs::write(&blocker, "x").unwrap();
        let _restore = RestoreHook(Some(std::panic::take_hook()));
        std::panic::set_hook(Box::new(|_| {}));

        install_panic_hook(blocker.join("logs"));
        let result = std::thread::spawn(|| panic!("still just one panic")).join();

        assert!(result.is_err());
    }
}
