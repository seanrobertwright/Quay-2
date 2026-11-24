//! What the window is told of a terminal's handshake with Quay's MCP server, for the mark on a terminal
//! that can't show surfaces. The handshake itself is kept with its launch (see `PluginWatch`).

use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::json;
use tauri::State;

use super::manager::{LaunchEvent, PtyManager};
use crate::slices::surface::names::OFFERED;
use crate::webview::WebviewEvents;

/// How long after its launch a CLI has to shake hands before Quay says that it has not.
pub const HANDSHAKE_GRACE: Duration = Duration::from_secs(60);

/// How a terminal's launch stands with Quay's MCP server.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Handshake {
    /// Whether the launch's CLI has shaken hands.
    pub seen: bool,
    /// How much of the launch's grace is left, in milliseconds.
    pub grace_left_ms: u64,
}

impl Handshake {
    /// The handshake, at `now`, of a launch that began at `began`.
    pub fn at(now: Instant, began: Instant, seen: bool) -> Self {
        let left = HANDSHAKE_GRACE.saturating_sub(now.saturating_duration_since(began));
        Self { seen, grace_left_ms: left.as_millis() as u64 }
    }
}

/// The handshake of a terminal's current launch. Nothing when it has no launch or its process has
/// exited, and in a build that does not offer the surface tools.
#[tauri::command]
pub async fn terminal_handshake(
    terminal_id: String,
    pty_manager: State<'_, PtyManager>,
) -> Result<Option<Handshake>, String> {
    Ok(if OFFERED { pty_manager.handshake(&terminal_id, Instant::now()) } else { None })
}

/// Sends the window `terminal-handshake` with a terminal's id when a launch of it is listed, its CLI
/// shakes hands or it is over, and when the terminal closes.
pub fn report_handshakes(pty_manager: &PtyManager, webview: WebviewEvents) {
    pty_manager.add_launch_watcher(move |event| {
        let terminal_id = match event {
            LaunchEvent::Listed(launch) | LaunchEvent::ShookHands(launch) | LaunchEvent::Over(launch) => launch.terminal_id,
            LaunchEvent::Closed(terminal_id) => terminal_id,
        };
        webview.emit("terminal-handshake", json!({ "terminal_id": terminal_id }));
    });
}
