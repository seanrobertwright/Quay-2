//! Quay's error log (#496). A packaged Windows app has no console, so everything the app
//! says through `tracing` goes to a daily rolling file under `<Quay data folder>\logs`, and a
//! panic is written to a separate `crash.log` before the process aborts.
//!
//! The panic hook writes `crash.log` itself, on the panicking thread, and does not go through
//! the non-blocking `tracing` queue: the release profile sets `panic = "abort"`, and an abort
//! gives the queue's worker thread no chance to drain.

pub mod commands;
pub mod crash;

use std::path::{Path, PathBuf};

use tracing_appender::non_blocking::{NonBlocking, WorkerGuard};
use tracing_appender::rolling::{Builder, Rotation};
use tracing_subscriber::filter::LevelFilter;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::registry::LookupSpan;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::{Layer};

use crate::slices::workspace::manager::storage_dir;

pub use commands::open_logs_folder;

/// How many daily log files stay on disk; older ones are removed.
pub const LOG_FILES_KEPT: usize = 7;

/// Where Quay writes its logs: `logs` inside the Quay data folder.
pub fn logs_dir() -> PathBuf {
    storage_dir().join("logs")
}

/// The daily rolling writer for `dir`, wrapped in a background thread so logging never waits
/// on the disk. The appender removes the oldest `quay.*.log` files beyond `LOG_FILES_KEPT`
/// and leaves other files alone.
fn file_writer(dir: &Path) -> Result<(WorkerGuard, NonBlocking), String> {
    let appender = Builder::new()
        .rotation(Rotation::DAILY)
        .filename_prefix("quay")
        .filename_suffix("log")
        .max_log_files(LOG_FILES_KEPT)
        .build(dir)
        .map_err(|e| e.to_string())?;
    let (writer, guard) = tracing_appender::non_blocking(appender);
    Ok((guard, writer))
}

fn file_layer<S>(writer: NonBlocking) -> impl Layer<S>
where
    S: tracing::Subscriber + for<'a> LookupSpan<'a>,
{
    tracing_subscriber::fmt::layer().with_writer(writer).with_ansi(false).with_filter(LevelFilter::INFO)
}

/// Starts logging and installs the panic hook. Returns the guard that keeps the background
/// writer alive; hold it for the life of the app. If the folder cannot be created or opened,
/// logging falls back to the console alone and the app still starts.
pub fn init(dir: &Path) -> Option<WorkerGuard> {
    let console = tracing_subscriber::fmt::layer().with_writer(std::io::stdout).with_filter(LevelFilter::INFO);
    let (guard, file) = match std::fs::create_dir_all(dir)
        .map_err(|e| e.to_string())
        .and_then(|()| file_writer(dir))
    {
        Ok((guard, writer)) => (Some(guard), Some(file_layer(writer))),
        Err(error) => {
            eprintln!("Quay could not open its log folder {}: {error}", dir.display());
            (None, None)
        }
    };
    // `try_init`, not `init`: a second call must not panic on the global subscriber.
    if let Err(error) = tracing_subscriber::registry().with(file).with(console).try_init() {
        eprintln!("Quay could not start logging: {error}");
        crash::install_panic_hook(dir.to_path_buf());
        return None;
    }
    crash::install_panic_hook(dir.to_path_buf());
    tracing::info!("Quay {} logging to {}", env!("CARGO_PKG_VERSION"), dir.display());
    guard
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TempDir;
    use std::fs;
    use tracing::Dispatch;

    /// A subscriber that writes only to the rolling file in `dir`, with the guard that keeps
    /// its writer alive; `None` if the folder cannot be created or opened.
    fn file_dispatch(dir: &Path) -> Option<(WorkerGuard, Dispatch)> {
        std::fs::create_dir_all(dir).ok()?;
        let (guard, writer) = file_writer(dir).ok()?;
        Some((guard, Dispatch::new(tracing_subscriber::registry().with(file_layer(writer)))))
    }

    fn temp_dir(name: &str) -> TempDir {
        TempDir::new(&format!("logging-{name}"))
    }

    fn log_files(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|n| n.starts_with("quay.") && n.ends_with(".log"))
            .collect();
        names.sort();
        names
    }

    #[test]
    fn logs_dir_is_the_logs_folder_of_the_quay_data_folder() {
        assert_eq!(logs_dir(), storage_dir().join("logs"));
    }

    #[test]
    fn init_keeps_only_the_newest_daily_logs_and_leaves_other_files() {
        let dir = temp_dir("retention");
        for day in 1..=10 {
            fs::write(dir.join(format!("quay.2020-01-{:02}.log", day)), "old").unwrap();
        }
        fs::write(dir.join("crash.log"), "keep me").unwrap();
        fs::write(dir.join("notes.txt"), "keep me too").unwrap();

        let guard = file_dispatch(&dir).map(|(guard, _)| guard);

        drop(guard);
        let files = log_files(&dir);
        assert!(files.len() <= LOG_FILES_KEPT, "kept {:?}", files);
        assert!(files.contains(&"quay.2020-01-10.log".to_string()), "newest old file was removed: {:?}", files);
        assert!(!files.contains(&"quay.2020-01-01.log".to_string()), "oldest file was kept: {:?}", files);
        assert!(dir.join("crash.log").exists());
        assert!(dir.join("notes.txt").exists());
    }

    #[test]
    fn a_logged_line_reaches_the_daily_file_once_the_guard_drops() {
        let dir = temp_dir("line");
        let (guard, dispatch) = file_dispatch(&dir).expect("file logging starts");
        tracing::dispatcher::with_default(&dispatch, || tracing::info!("hello from the test"));
        drop(guard);

        let files = log_files(&dir);
        assert_eq!(files.len(), 1, "{:?}", files);
        let text = fs::read_to_string(dir.join(&files[0])).unwrap();
        assert!(text.contains("hello from the test"), "{}", text);
        assert!(!text.contains('\u{1b}'), "the file has no color codes: {:?}", text);
    }

    #[test]
    fn init_on_a_folder_that_cannot_be_created_does_not_panic() {
        let dir = temp_dir("blocked");
        let blocker = dir.join("file");
        fs::write(&blocker, "not a folder").unwrap();

        let guard = file_dispatch(&blocker.join("logs")).map(|(guard, _)| guard);

        assert!(guard.is_none());
    }
}
