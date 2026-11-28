//! What Quay knows, in one launch of a terminal, about whether the plugin or extension
//! that reports its turns is loaded (Claude Code's event-bridge plugin, or Quay's PiG
//! extension; see `RunKind::reports_through_plugin`), and the status rules that follow. The
//! time a launch began, its first output, the turns its own output reports, its process's exit and its
//! CLI's handshake with Quay's MCP server are kept here too, since all of them begin anew with each
//! launch.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use super::handshake::Handshake;
use super::models::{ClaudeStatus, RunKind};
use super::osc7501::TurnReport;
use crate::dates::now_ms;

/// How long a Claude or PiG terminal may stay silent after its first output before Quay
/// shows it as Unknown (a Claude terminal with the plugin hint).
pub const PLUGIN_SILENCE: Duration = Duration::from_secs(30);

/// The PiG version Quay's PiG extension was built and tested against: the tag `pig-sdk` is
/// pinned to in `sidecars/pig-bridge/Cargo.toml`, without its `v`, which `build.rs` reads.
pub const PIG_TESTED_VERSION: &str = env!("QUAY_PIG_TESTED_VERSION");

/// The command that installs the event-bridge plugin. The plugin hint in
/// `src/slices/terminal/PluginHint.tsx` shows the same line.
pub const EVENT_BRIDGE_INSTALL_LINE: &str =
    "claude plugin install event-bridge --marketplace seanrobertwright/claude-mod-events";

static NEXT_LAUNCH: AtomicU64 = AtomicU64::new(1);

/// One launch of one terminal, as its first-output hook and silence clock hold it.
/// A relaunch replaces the terminal's watch, so a stale launch finds nothing to change.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LaunchRef {
    pub terminal_id: String,
    pub launch: u64,
}

impl LaunchRef {
    /// This launch's watch in `watches`, while it is still the terminal's current launch.
    pub fn current_in<'a>(
        &self,
        watches: &'a mut HashMap<String, PluginWatch>,
    ) -> Option<&'a mut PluginWatch> {
        watches
            .get_mut(&self.terminal_id)
            .filter(|watch| watch.launch == self.launch)
    }
}

/// The turns a launch's own output has reported so far (see `osc7501`).
#[derive(Debug, Clone, Copy)]
struct ReportedTurns {
    /// Whether the last report showed a turn running.
    running: bool,
    /// When a turn was last shown over, in Unix milliseconds.
    last_stop: Option<i64>,
}

/// One launch of a terminal. Relaunch keeps the terminal id and starts a new watch,
/// so the "heard from the plugin" mark and the clock never carry over.
#[derive(Debug, Clone)]
pub struct PluginWatch {
    launch: u64,
    run_kind: RunKind,
    heard: bool,
    hint_dismissed: bool,
    first_output_at: Option<Instant>,
    /// When the launch began.
    began: Instant,
    /// `began`, in Unix milliseconds.
    began_ms: i64,
    /// The turns its output has reported, or `None` while it has reported none.
    reported: Option<ReportedTurns>,
    /// When it first worked, for a CLI that connects then (`RunKind::connects_at_first_prompt`).
    prompted_at: Option<Instant>,
    /// Whether the launch's CLI has shaken hands with Quay's MCP server.
    handshake: bool,
    /// Whether the launch's process has exited.
    exited: bool,
    /// The exit code its process ended with, once it has exited.
    exit_code: Option<i32>,
}

impl PluginWatch {
    /// The CLI of the launch.
    pub fn run_kind(&self) -> RunKind {
        self.run_kind
    }

    pub fn new(run_kind: RunKind) -> Self {
        Self {
            launch: NEXT_LAUNCH.fetch_add(1, Ordering::SeqCst),
            run_kind,
            heard: false,
            hint_dismissed: false,
            first_output_at: None,
            began: Instant::now(),
            began_ms: now_ms(),
            reported: None,
            prompted_at: None,
            handshake: false,
            exited: false,
            exit_code: None,
        }
    }

    pub fn launch(&self) -> u64 {
        self.launch
    }

    /// Records the launch's first output at `now`. Returns true when that starts the
    /// silence clock, which only a terminal that reports through a plugin runs.
    pub fn first_output(&mut self, now: Instant) -> bool {
        if self.first_output_at.is_some() {
            return false;
        }
        self.first_output_at = Some(now);
        self.run_kind.reports_through_plugin()
    }

    /// Whether this launch has printed anything yet.
    pub fn has_output(&self) -> bool {
        self.first_output_at.is_some()
    }

    /// Whether, at `now`, the silence clock has run out with nothing heard and, for a Claude
    /// terminal, the plugin hint not dismissed. Only a Claude terminal shows the hint.
    pub fn silence_due(&self, now: Instant) -> bool {
        self.run_kind.reports_through_plugin()
            && !self.heard
            && !(self.hint_dismissed && self.run_kind == RunKind::Claude)
            && self
                .first_output_at
                .is_some_and(|at| now.saturating_duration_since(at) >= PLUGIN_SILENCE)
    }

    /// Records that the CLI works, so that it has been prompted. Whether that is the launch's first time, of
    /// a CLI that connects then.
    pub fn works(&mut self) -> bool {
        let first = self.run_kind.connects_at_first_prompt() && self.prompted_at.is_none();
        if first {
            self.prompted_at = Some(Instant::now());
        }
        first
    }

    /// Records what the launch's output reports of its turn, at `at` (Unix milliseconds). A report
    /// with no status is none. Returns whether a turn runs now that didn't before.
    pub fn report_turn(&mut self, report: &TurnReport, at: i64) -> bool {
        let Some(status) = &report.status else {
            return false;
        };
        let running = *status != ClaudeStatus::Idle;
        let before = self.reported;
        let last_stop = before.and_then(|turns| turns.last_stop);
        self.reported = Some(ReportedTurns { running, last_stop: if report.stops_turn { Some(at) } else { last_stop } });
        running && !before.is_some_and(|turns| turns.running)
    }

    /// Whether the launch's own output reports its turns, so that its status is theirs alone.
    pub fn reports_own_turns(&self) -> bool {
        self.reported.is_some()
    }

    /// Whether the turn that began at `began` (Unix milliseconds) still runs, by the launch's own
    /// output. A turn of an unknown time is taken for the last one.
    pub fn turn_running(&self, began: Option<i64>) -> bool {
        self.reported.is_some_and(|turns| {
            turns.running && !began.zip(turns.last_stop).is_some_and(|(began, stop)| began <= stop)
        })
    }

    /// Whether the launch began after `at` (Unix milliseconds).
    pub fn began_after(&self, at: i64) -> bool {
        self.began_ms > at
    }

    /// Records the CLI's handshake with Quay's MCP server, unless the launch's process has exited.
    /// Returns whether it is the launch's first.
    pub fn shake_hands(&mut self) -> bool {
        let first = !self.exited && !self.handshake;
        self.handshake = !self.exited;
        first
    }

    /// Whether the CLI has shaken hands with Quay's MCP server and the launch's process has not
    /// exited.
    pub fn handshake_seen(&self) -> bool {
        self.handshake
    }

    /// How the launch stands with Quay's MCP server at `now`, or `None` when its process has exited.
    pub fn handshake(&self, now: Instant) -> Option<Handshake> {
        let connects_from =
            if self.run_kind.connects_at_first_prompt() { self.prompted_at } else { Some(self.began) };
        (!self.exited).then(|| Handshake::at(now, self.began, connects_from, self.handshake))
    }

    /// Whether the launch's process has exited.
    pub fn exited(&self) -> bool {
        self.exited
    }

    /// Marks the launch's process exited with `exit_code` and clears its CLI's handshake.
    pub fn exit(&mut self, exit_code: Option<i32>) {
        self.exited = true;
        self.exit_code = exit_code;
        self.handshake = false;
    }

    /// The exit code the launch's process exited with, `None` while it runs or when it gave none.
    pub fn exit_code(&self) -> Option<i32> {
        self.exit_code
    }

    /// Keeps the plugin hint away for the rest of this launch.
    pub fn dismiss_hint(&mut self) {
        self.hint_dismissed = true;
    }

    /// Marks the plugin heard and returns the status after an authenticated plugin
    /// event, before the event's own rule (turn.started to Working and so on) applies.
    /// Any event shows the plugin is loaded, so it moves the terminal out of Starting
    /// or Unknown, and only from there.
    pub fn hear(&mut self, status: &ClaudeStatus) -> ClaudeStatus {
        self.heard = true;
        match status {
            ClaudeStatus::Starting | ClaudeStatus::Unknown => ClaudeStatus::Idle,
            other => other.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_tested_pig_version_is_the_pinned_sdk_tag() {
        let manifest = std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("sidecars/pig-bridge/Cargo.toml"),
        )
        .unwrap();
        let sdk = manifest.lines().find(|line| line.starts_with("pig-sdk ")).unwrap();
        assert!(sdk.contains(&format!("tag = \"v{}\"", PIG_TESTED_VERSION)), "{sdk}");
        assert!(PIG_TESTED_VERSION.split('.').all(|part| part.parse::<u32>().is_ok()), "{PIG_TESTED_VERSION}");
    }

    #[test]
    fn a_silent_pig_terminal_goes_unknown_when_its_window_runs_out_and_a_late_event_brings_it_back() {
        let start = Instant::now();
        let mut watch = PluginWatch::new(RunKind::Pig);
        assert!(watch.first_output(start), "PiG runs the silence clock");
        assert!(!watch.silence_due(start + PLUGIN_SILENCE - Duration::from_millis(1)));
        assert!(watch.silence_due(start + PLUGIN_SILENCE));
        assert_eq!(watch.hear(&ClaudeStatus::Unknown), ClaudeStatus::Idle);
        assert!(!watch.silence_due(start + PLUGIN_SILENCE * 2));
    }

    #[test]
    fn dismissing_a_hint_never_stops_a_pig_terminals_clock() {
        let start = Instant::now();
        let mut watch = PluginWatch::new(RunKind::Pig);
        watch.first_output(start);
        watch.dismiss_hint();
        assert!(watch.silence_due(start + PLUGIN_SILENCE));
    }

    #[test]
    fn only_claude_and_pig_run_the_silence_clock() {
        let start = Instant::now();
        for kind in crate::slices::pty::models::ALL_RUN_KINDS {
            let mut watch = PluginWatch::new(kind);
            let runs = watch.first_output(start);
            assert_eq!(runs, kind.reports_through_plugin(), "{:?}", kind);
            assert_eq!(watch.silence_due(start + PLUGIN_SILENCE), runs, "{:?}", kind);
        }
    }

    #[test]
    fn the_install_line_matches_the_plugin_hint() {
        let source_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../src/slices/terminal/PluginHint.tsx");
        let source = std::fs::read_to_string(&source_path).unwrap();
        assert!(
            source.contains(&format!("\"{}\"", EVENT_BRIDGE_INSTALL_LINE)),
            "PluginHint.tsx shows a different install line"
        );
    }
}
