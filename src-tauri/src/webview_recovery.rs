//! Brings Quay's window back when a WebView2 process behind it dies (#799).
//!
//! WebView2 runs Quay's page in processes of its own. When its browser process exits, as it does
//! when an allocation fails, the window stays black and takes no input, while the terminals behind
//! it run on in Quay's own process. Neither wry nor Tauri recovers from that, so Quay watches the
//! main webview's `ProcessFailed` event: it builds a new main window in place of one whose browser
//! process exited, and reloads the page of one whose renderer did. The page restores its terminals
//! from Quay, as it does on any reload. Every failure is logged with the machine's commit, since a
//! commit limit running short is the likely cause of a failed allocation.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use parking_lot::Mutex;

/// The label of Quay's main window, as `tauri.conf.json` names it.
pub const MAIN_WINDOW: &str = "main";

/// A WebView2 process that failed, by the `COREWEBVIEW2_PROCESS_FAILED_KIND` WebView2 reports.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FailedProcess {
    Browser,
    Renderer,
    RendererUnresponsive,
    /// The renderer of a frame inside the page, while the page's own renderer runs on.
    FrameRenderer,
    Gpu,
    Other(i32),
}

/// What Quay does about a failed process.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Recovery {
    /// Builds a new main window in place of the dead one.
    Rebuild,
    /// Reloads the page.
    Reload,
    /// Nothing: WebView2 recovers by itself, or the page goes on.
    Nothing,
}

impl FailedProcess {
    pub fn from_kind(kind: i32) -> Self {
        match kind {
            0 => Self::Browser,
            1 => Self::Renderer,
            2 => Self::RendererUnresponsive,
            3 => Self::FrameRenderer,
            6 => Self::Gpu,
            other => Self::Other(other),
        }
    }

    /// What Microsoft's guidance has an app do: recreate the webview when its browser process
    /// exits, reload when its renderer does, and leave a GPU process, which WebView2 restarts,
    /// alone. A renderer that stops responding may yet answer, so it is only logged.
    pub fn recovery(self) -> Recovery {
        match self {
            Self::Browser => Recovery::Rebuild,
            Self::Renderer => Recovery::Reload,
            _ => Recovery::Nothing,
        }
    }

    fn name(self) -> String {
        match self {
            Self::Browser => "browser".to_string(),
            Self::Renderer => "renderer".to_string(),
            Self::RendererUnresponsive => "unresponsive renderer".to_string(),
            Self::FrameRenderer => "frame renderer".to_string(),
            Self::Gpu => "GPU".to_string(),
            Self::Other(kind) => format!("kind {kind}"),
        }
    }
}

/// Why WebView2 says a process failed, by its `COREWEBVIEW2_PROCESS_FAILED_REASON`.
fn reason_name(reason: i32) -> String {
    match reason {
        0 => "unexpected".to_string(),
        1 => "unresponsive".to_string(),
        2 => "terminated".to_string(),
        3 => "crashed".to_string(),
        4 => "launch failed".to_string(),
        5 => "out of memory".to_string(),
        6 => "profile deleted".to_string(),
        other => format!("reason {other}"),
    }
}

/// The machine's commit, in bytes, when a process failed: what is in use, of the limit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Commit {
    pub used: u64,
    pub limit: u64,
}

/// A failure as WebView2 reports it, with what Quay could learn of the moment.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Failure {
    pub process: FailedProcess,
    pub reason: Option<i32>,
    pub exit_code: Option<i32>,
    pub description: Option<String>,
    pub commit: Option<Commit>,
}

impl Failure {
    /// One line saying what failed, why, and the machine's commit, then `action`, what Quay does.
    pub fn describe(&self, action: &str) -> String {
        const GB: f64 = 1024.0 * 1024.0 * 1024.0;
        let mut line = format!("WebView2 {} process failed", self.process.name());
        let mut details = Vec::new();
        if let Some(reason) = self.reason {
            details.push(reason_name(reason));
        }
        if let Some(code) = self.exit_code {
            details.push(format!("exit code {code:#x}"));
        }
        if let Some(description) = self.description.as_deref().filter(|d| !d.is_empty()) {
            details.push(description.to_string());
        }
        if !details.is_empty() {
            line.push_str(&format!(" ({})", details.join(", ")));
        }
        if let Some(commit) = self.commit {
            line.push_str(&format!(
                "; commit {:.1} of {:.1} GB",
                commit.used as f64 / GB,
                commit.limit as f64 / GB
            ));
        }
        format!("{line}; {action}")
    }
}

/// How many rebuilds, and how many reloads, Quay makes in a stretch, so a window that dies again
/// at once isn't recovered for ever.
const RECOVERIES: usize = 3;
const RECOVERY_STRETCH: Duration = Duration::from_secs(10 * 60);

/// The times of the recent recoveries of one kind.
#[derive(Default)]
struct Budget(Mutex<VecDeque<Instant>>);

impl Budget {
    /// Spends one recovery at `now`, unless `RECOVERIES` were made in the last `RECOVERY_STRETCH`.
    fn spend(&self, now: Instant) -> bool {
        let mut times = self.0.lock();
        while times.front().is_some_and(|at| now.duration_since(*at) >= RECOVERY_STRETCH) {
            times.pop_front();
        }
        if times.len() >= RECOVERIES {
            return false;
        }
        times.push_back(now);
        true
    }

    /// How long from `now` until a recovery can be spent: none while fewer than `RECOVERIES`
    /// were made in the last `RECOVERY_STRETCH`, or until the oldest of them is that old.
    fn wait(&self, now: Instant) -> Duration {
        let times = self.0.lock();
        let recent: Vec<&Instant> =
            times.iter().filter(|at| now.duration_since(**at) < RECOVERY_STRETCH).collect();
        match recent.first() {
            Some(oldest) if recent.len() >= RECOVERIES => (**oldest + RECOVERY_STRETCH).saturating_duration_since(now),
            _ => Duration::ZERO,
        }
    }
}

/// The main window's recovery: whether its page is lost, whether a rebuild is under way, and the
/// recent recoveries.
#[derive(Default)]
pub struct WebviewRecovery {
    page_lost: AtomicBool,
    rebuilding: AtomicBool,
    rebuilds: Budget,
    reloads: Budget,
}

impl WebviewRecovery {
    /// Starts a rebuild at `now`, unless one is under way or `RECOVERIES` were made in the last
    /// `RECOVERY_STRETCH`. Returns whether it started.
    pub fn begin_rebuild(&self, now: Instant) -> bool {
        if self.rebuilding.swap(true, Ordering::SeqCst) {
            return false;
        }
        let started = self.rebuilds.spend(now);
        if !started {
            self.end_rebuild();
        }
        started
    }

    /// Whether a rebuild is under way, so Quay must not exit as its old window closes.
    pub fn rebuilding(&self) -> bool {
        self.rebuilding.load(Ordering::SeqCst)
    }

    /// Ends the rebuild under way.
    pub fn end_rebuild(&self) {
        self.rebuilding.store(false, Ordering::SeqCst);
    }

    /// Whether the page may be reloaded at `now`: fewer than `RECOVERIES` reloads in the last
    /// `RECOVERY_STRETCH`. Spends one if so.
    pub fn may_reload(&self, now: Instant) -> bool {
        self.reloads.spend(now)
    }

    /// How long from `now` until a rebuild can start (`begin_rebuild`).
    pub fn rebuild_wait(&self, now: Instant) -> Duration {
        self.rebuilds.wait(now)
    }

    /// How long from `now` until the page can be reloaded (`may_reload`).
    pub fn reload_wait(&self, now: Instant) -> Duration {
        self.reloads.wait(now)
    }

    /// Records that the main window's page died, so no page answers the window's close request.
    pub fn lose_page(&self) {
        self.page_lost.store(true, Ordering::SeqCst);
    }

    /// Records that the main window has a page again.
    pub fn find_page(&self) {
        self.page_lost.store(false, Ordering::SeqCst);
    }

    /// Whether the main window's page is dead. Closing the window waits for the page to allow it,
    /// as the Praxis builder asks about unsaved drafts first, so until a page is back, closing the
    /// window exits Quay at once.
    pub fn page_lost(&self) -> bool {
        self.page_lost.load(Ordering::SeqCst)
    }
}

/// The waits between tries at building a new window: doubling from 2 s up to 30 s, for as long
/// as `RECOVERY_STRETCH` in all.
fn build_retries() -> impl Iterator<Item = Duration> {
    let mut next = Duration::from_secs(2);
    let mut total = Duration::ZERO;
    std::iter::from_fn(move || {
        let wait = next.min(RECOVERY_STRETCH.saturating_sub(total));
        if wait.is_zero() {
            return None;
        }
        total += wait;
        next = (next * 2).min(Duration::from_secs(30));
        Some(wait)
    })
}

#[cfg(windows)]
pub use platform::watch;

/// Watches `window`'s webview for failed processes. WebView2 is Windows' alone, so elsewhere
/// there is nothing to watch.
#[cfg(not(windows))]
pub fn watch(_window: &tauri::WebviewWindow) {}

#[cfg(windows)]
mod platform {
    use std::time::{Duration, Instant};

    use tauri::{
        AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewWindow, WebviewWindowBuilder, WindowEvent,
    };
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2ProcessFailedEventArgs, ICoreWebView2ProcessFailedEventArgs2, COREWEBVIEW2_PROCESS_FAILED_KIND,
        COREWEBVIEW2_PROCESS_FAILED_REASON,
    };
    use webview2_com::ProcessFailedEventHandler;
    use windows_core::{Interface, PWSTR};

    use super::{build_retries, Commit, FailedProcess, Failure, Recovery, WebviewRecovery, MAIN_WINDOW};

    /// Watches `window`'s webview for failed processes, and recovers the main window from them.
    pub fn watch(window: &WebviewWindow) {
        let app = window.app_handle().clone();
        let watched = window.with_webview(move |webview| {
            // SAFETY: the controller and its webview are live COM objects on this, the UI, thread.
            let core = match unsafe { webview.controller().CoreWebView2() } {
                Ok(core) => core,
                Err(e) => {
                    tracing::warn!("Couldn't watch the window's WebView2 processes: {e}");
                    return;
                }
            };
            let handler = ProcessFailedEventHandler::create(Box::new(move |_, args| {
                if let Some(args) = args {
                    on_failure(&app, read_failure(&args));
                }
                Ok(())
            }));
            let mut token = 0i64;
            // SAFETY: as above. WebView2 holds the handler for the webview's life.
            if let Err(e) = unsafe { core.add_ProcessFailed(&handler, &mut token) } {
                tracing::warn!("Couldn't watch the window's WebView2 processes: {e}");
            }
        });
        if let Err(e) = watched {
            tracing::warn!("Couldn't watch the window's WebView2 processes: {e}");
        }
    }

    /// What WebView2 says of a failure, and the machine's commit now.
    fn read_failure(args: &ICoreWebView2ProcessFailedEventArgs) -> Failure {
        let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND::default();
        // SAFETY: `args` is the live event argument WebView2 passed the handler.
        let read_kind = unsafe { args.ProcessFailedKind(&mut kind) }.is_ok();
        let mut failure = Failure {
            process: if read_kind { FailedProcess::from_kind(kind.0) } else { FailedProcess::Other(-1) },
            reason: None,
            exit_code: None,
            description: None,
            commit: commit(),
        };
        if let Ok(args) = args.cast::<ICoreWebView2ProcessFailedEventArgs2>() {
            let mut reason = COREWEBVIEW2_PROCESS_FAILED_REASON::default();
            let mut exit_code = 0i32;
            let mut description = PWSTR::null();
            // SAFETY: as above. The description is CoTaskMem, which `take_pwstr` frees.
            unsafe {
                failure.reason = args.Reason(&mut reason).is_ok().then_some(reason.0);
                failure.exit_code = args.ExitCode(&mut exit_code).is_ok().then_some(exit_code);
                if args.ProcessDescription(&mut description).is_ok() && !description.is_null() {
                    failure.description = Some(webview2_com::take_pwstr(description));
                }
            }
        }
        failure
    }

    /// The machine's commit in use and its limit, now: the whole system's, whatever limit a job
    /// may set on Quay's own process.
    fn commit() -> Option<Commit> {
        use windows_sys::Win32::System::ProcessStatus::{K32GetPerformanceInfo, PERFORMANCE_INFORMATION};
        // SAFETY: K32GetPerformanceInfo fills a PERFORMANCE_INFORMATION of the size it is given.
        let mut info: PERFORMANCE_INFORMATION = unsafe { std::mem::zeroed() };
        let size = std::mem::size_of::<PERFORMANCE_INFORMATION>() as u32;
        info.cb = size;
        let read = unsafe { K32GetPerformanceInfo(&mut info, size) } != 0;
        let page = info.PageSize as u64;
        read.then(|| Commit { used: info.CommitTotal as u64 * page, limit: info.CommitLimit as u64 * page })
    }

    /// Logs `failure` and recovers from it. Runs on the UI thread, inside WebView2's event, so
    /// the recovery runs on a thread of its own. A recovery over the limit waits until it is
    /// allowed, rather than leaving the window dead.
    fn on_failure(app: &AppHandle, failure: Failure) {
        let recovery = app.state::<WebviewRecovery>();
        let now = Instant::now();
        let (wait, doing, act): (Duration, &str, fn(&AppHandle)) = match failure.process.recovery() {
            Recovery::Rebuild => (recovery.rebuild_wait(now), "building a new window", rebuild),
            Recovery::Reload => (recovery.reload_wait(now), "reloading the page", reload),
            Recovery::Nothing if failure.process == FailedProcess::Gpu => {
                tracing::warn!("{}", failure.describe("WebView2 starts another"));
                return;
            }
            Recovery::Nothing => {
                tracing::warn!("{}", failure.describe("the page goes on"));
                return;
            }
        };
        recovery.lose_page();
        if wait.is_zero() {
            tracing::error!("{}", failure.describe(doing));
        } else {
            let minutes = wait.as_secs().div_ceil(60);
            tracing::error!("{}", failure.describe(&format!("{doing} in {minutes} min, after three in ten minutes")));
        }
        let app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(wait);
            act(&app);
        });
    }

    /// Replaces the main window, unless its page came back meanwhile or a rebuild is under way.
    fn rebuild(app: &AppHandle) {
        let recovery = app.state::<WebviewRecovery>();
        if !recovery.page_lost() {
            return;
        }
        if recovery.begin_rebuild(Instant::now()) {
            close_for_rebuild(app);
        } else {
            tracing::info!("A new window is already being built");
        }
    }

    /// Reloads the main window's page, unless it came back meanwhile, as a new window brings it.
    fn reload(app: &AppHandle) {
        let recovery = app.state::<WebviewRecovery>();
        if !recovery.page_lost() {
            return;
        }
        if !recovery.may_reload(Instant::now()) {
            tracing::warn!("The page wasn't reloaded: three reloads in the last ten minutes");
            return;
        }
        let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
            return;
        };
        match window.reload() {
            Ok(()) => recovery.find_page(),
            Err(e) => tracing::error!("Couldn't reload the page: {e}"),
        }
    }

    /// How the main window was placed, for the window built in its place. A minimized or maximized
    /// window reports its position and size in that state, so only the state is kept for it.
    enum Geometry {
        Placed { position: Option<PhysicalPosition<i32>>, size: Option<PhysicalSize<u32>> },
        Maximized,
        Minimized,
    }

    impl Geometry {
        fn of(window: &WebviewWindow) -> Self {
            if window.is_minimized().unwrap_or(false) {
                Self::Minimized
            } else if window.is_maximized().unwrap_or(false) {
                Self::Maximized
            } else {
                Self::Placed { position: window.outer_position().ok(), size: window.inner_size().ok() }
            }
        }

        /// Places `window`, before it is shown.
        fn place(&self, window: &WebviewWindow) {
            if let Self::Placed { position, size } = self {
                if let Some(position) = position {
                    warn_unless_done("place", window.set_position(*position));
                }
                if let Some(size) = size {
                    warn_unless_done("size", window.set_size(*size));
                }
            }
        }

        /// Puts `window` back in the state the old one was in, once it is shown.
        fn restore_state(&self, window: &WebviewWindow) {
            match self {
                Self::Maximized => warn_unless_done("maximize", window.maximize()),
                Self::Minimized => warn_unless_done("minimize", window.minimize()),
                Self::Placed { .. } => warn_unless_done("focus", window.set_focus()),
            }
        }
    }

    fn warn_unless_done(what: &str, result: tauri::Result<()>) {
        if let Err(e) = result {
            tracing::warn!("Couldn't {what} the new window: {e}");
        }
    }

    /// Closes the dead main window, and builds its replacement once it is gone, since the new one
    /// takes its label.
    fn close_for_rebuild(app: &AppHandle) {
        let Some(old) = app.get_webview_window(MAIN_WINDOW) else {
            build_main(app, None);
            return;
        };
        let geometry = parking_lot::Mutex::new(Some(Geometry::of(&old)));
        let rebuilt = app.clone();
        old.on_window_event(move |event| {
            if matches!(event, WindowEvent::Destroyed) {
                let app = rebuilt.clone();
                let geometry = geometry.lock().take();
                std::thread::spawn(move || build_main(&app, geometry));
            }
        });
        if let Err(e) = old.destroy() {
            tracing::error!("Couldn't close the window whose WebView2 browser process died: {e}");
            app.state::<WebviewRecovery>().end_rebuild();
        }
    }

    /// Builds a new main window from its config, where the old one was, and watches it in turn.
    /// WebView2 may not start while memory is short, so a failed build is tried again over
    /// `build_retries`, while the terminals run on. Quay has no window without it, so if none can
    /// be built in that time Quay exits, to be started again.
    fn build_main(app: &AppHandle, geometry: Option<Geometry>) {
        let recovery = app.state::<WebviewRecovery>();
        let config = app.config().app.windows.iter().find(|window| window.label == MAIN_WINDOW).cloned();
        let mut retries = build_retries();
        loop {
            let built = config
                .as_ref()
                .ok_or_else(|| "the config has no main window".to_string())
                .and_then(|config| {
                    WebviewWindowBuilder::from_config(app, config)
                        .and_then(|builder| builder.visible(false).build())
                        .map_err(|e| e.to_string())
                });
            let error = match built {
                Ok(window) => {
                    if let Some(geometry) = &geometry {
                        geometry.place(&window);
                    }
                    if let Err(e) = window.show() {
                        tracing::error!("Couldn't show the new window: {e}");
                    }
                    if let Some(geometry) = &geometry {
                        geometry.restore_state(&window);
                    }
                    watch(&window);
                    recovery.find_page();
                    recovery.end_rebuild();
                    tracing::info!("Built a new window in place of the one whose WebView2 browser process died");
                    return;
                }
                Err(e) => e,
            };
            let Some(delay) = retries.next() else {
                recovery.end_rebuild();
                tracing::error!("Couldn't build a new window ({error}); Quay exits, having none, so it can be started again");
                app.exit(1);
                return;
            };
            tracing::error!("Couldn't build a new window ({error}); trying again in {}s", delay.as_secs());
            std::thread::sleep(delay);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_dead_browser_process_rebuilds_the_window_and_a_dead_renderer_reloads_the_page() {
        assert_eq!(FailedProcess::from_kind(0).recovery(), Recovery::Rebuild);
        assert_eq!(FailedProcess::from_kind(1).recovery(), Recovery::Reload);
        for kind in [2, 3, 4, 5, 6, 7, 8, 9, 42] {
            assert_eq!(FailedProcess::from_kind(kind).recovery(), Recovery::Nothing, "kind {kind}");
        }
    }

    #[test]
    fn a_failure_is_one_line_naming_what_failed_why_and_the_machines_commit() {
        let failure = Failure {
            process: FailedProcess::Browser,
            reason: Some(5),
            exit_code: Some(-2147483645),
            description: Some(String::new()),
            commit: Some(Commit { used: 165 << 30, limit: 181 << 30 }),
        };
        assert_eq!(
            failure.describe("building a new window"),
            "WebView2 browser process failed (out of memory, exit code 0x80000003); commit 165.0 of 181.0 GB; building a new window"
        );
        let bare = Failure { process: FailedProcess::Other(11), reason: None, exit_code: None, description: None, commit: None };
        assert_eq!(bare.describe("the page goes on"), "WebView2 kind 11 process failed; the page goes on");
    }

    #[test]
    fn a_rebuild_keeps_quay_running_until_it_ends() {
        let recovery = WebviewRecovery::default();
        assert!(!recovery.rebuilding());
        assert!(recovery.begin_rebuild(Instant::now()));
        assert!(recovery.rebuilding());
        assert!(!recovery.begin_rebuild(Instant::now()), "one at a time");
        recovery.end_rebuild();
        assert!(!recovery.rebuilding());
    }

    #[test]
    fn a_window_that_keeps_dying_is_rebuilt_three_times_in_ten_minutes() {
        let recovery = WebviewRecovery::default();
        let start = Instant::now();
        for minute in 0..3 {
            assert!(recovery.begin_rebuild(start + Duration::from_secs(minute * 60)), "rebuild {minute}");
            recovery.end_rebuild();
        }
        assert!(!recovery.begin_rebuild(start + Duration::from_secs(5 * 60)));
        assert!(!recovery.rebuilding(), "a refused rebuild leaves Quay free to exit");
        assert!(recovery.begin_rebuild(start + RECOVERY_STRETCH), "the first has aged out");
    }

    #[test]
    fn a_page_whose_renderer_keeps_dying_is_reloaded_three_times_in_ten_minutes() {
        let recovery = WebviewRecovery::default();
        let start = Instant::now();
        for minute in 0..3 {
            assert!(recovery.may_reload(start + Duration::from_secs(minute * 60)), "reload {minute}");
        }
        assert!(!recovery.may_reload(start + Duration::from_secs(5 * 60)));
        assert!(recovery.may_reload(start + RECOVERY_STRETCH));
        assert!(recovery.begin_rebuild(start), "reloads leave the rebuilds alone");
    }

    #[test]
    fn a_recovery_over_the_limit_waits_until_the_oldest_of_the_three_is_ten_minutes_old() {
        let recovery = WebviewRecovery::default();
        let start = Instant::now();
        assert_eq!(recovery.rebuild_wait(start), Duration::ZERO);
        for minute in 0..3 {
            assert!(recovery.begin_rebuild(start + Duration::from_secs(minute * 60)));
            recovery.end_rebuild();
            assert!(recovery.may_reload(start + Duration::from_secs(minute * 120)));
        }
        let now = start + Duration::from_secs(5 * 60);
        assert_eq!(recovery.rebuild_wait(now), Duration::from_secs(5 * 60));
        assert_eq!(recovery.reload_wait(now), Duration::from_secs(5 * 60));
        let later = now + recovery.rebuild_wait(now);
        assert_eq!(recovery.rebuild_wait(later), Duration::ZERO);
        assert!(recovery.begin_rebuild(later));
    }

    #[test]
    fn a_window_that_cant_be_built_is_tried_again_for_ten_minutes_more_and_more_slowly() {
        let waits: Vec<u64> = build_retries().map(|wait| wait.as_secs()).collect();
        assert_eq!(&waits[..6], [2, 4, 8, 16, 30, 30]);
        assert_eq!(waits.iter().sum::<u64>(), RECOVERY_STRETCH.as_secs());
        assert!(waits.iter().all(|&wait| wait <= 30));
    }

    #[test]
    fn a_lost_page_is_found_again_by_a_new_window_or_a_reload() {
        let recovery = WebviewRecovery::default();
        assert!(!recovery.page_lost());
        recovery.lose_page();
        assert!(recovery.page_lost(), "closing the window then exits Quay, since no page answers");
        recovery.find_page();
        assert!(!recovery.page_lost());
    }
}
