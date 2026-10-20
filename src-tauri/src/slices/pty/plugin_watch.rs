//! What Quay knows, in one launch of a terminal, about whether Claude Code's
//! event-bridge plugin is loaded, and the status rules that follow from it.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use super::models::{ClaudeStatus, RunKind};

/// How long a Claude terminal may stay silent after its first output before Quay
/// shows it as Unknown, with the plugin hint.
pub const PLUGIN_SILENCE: Duration = Duration::from_secs(30);

static NEXT_LAUNCH: AtomicU64 = AtomicU64::new(1);

/// One launch of a terminal. Relaunch keeps the terminal id and starts a new watch,
/// so the "heard from the plugin" mark and the clock never carry over.
#[derive(Debug, Clone)]
pub struct PluginWatch {
    launch: u64,
    run_kind: RunKind,
    heard: bool,
    hint_dismissed: bool,
    first_output_at: Option<Instant>,
}

impl PluginWatch {
    pub fn new(run_kind: RunKind) -> Self {
        Self {
            launch: NEXT_LAUNCH.fetch_add(1, Ordering::SeqCst),
            run_kind,
            heard: false,
            hint_dismissed: false,
            first_output_at: None,
        }
    }

    pub fn launch(&self) -> u64 {
        self.launch
    }

    /// Records the launch's first output at `now`. Returns true when that starts the
    /// silence clock, which only a Claude terminal runs.
    pub fn first_output(&mut self, now: Instant) -> bool {
        if self.first_output_at.is_some() {
            return false;
        }
        self.first_output_at = Some(now);
        self.run_kind == RunKind::Claude
    }

    /// Whether, at `now`, the silence clock has run out with nothing heard and the
    /// hint not dismissed.
    pub fn silence_due(&self, now: Instant) -> bool {
        self.run_kind == RunKind::Claude
            && !self.heard
            && !self.hint_dismissed
            && self
                .first_output_at
                .is_some_and(|at| now.saturating_duration_since(at) >= PLUGIN_SILENCE)
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
