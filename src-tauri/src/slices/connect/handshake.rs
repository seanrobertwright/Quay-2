//! What the window is told of a terminal's handshake with Quay's MCP server, for the mark on a terminal
//! that can't show surfaces. The handshake and its grace are its launch's, in the `pty` slice.

use std::time::Instant;

use serde_json::json;
use tauri::State;

use crate::slices::pty::handshake::Handshake;
use crate::slices::pty::manager::{LaunchEvent, PtyManager};
use crate::slices::surface::names::OFFERED;
use crate::webview::WebviewEvents;

/// The handshake of a terminal's current launch. Nothing when it has no launch or its process has
/// exited, and in a build that does not offer the surface tools.
#[tauri::command]
pub async fn terminal_handshake(
    terminal_id: String,
    pty_manager: State<'_, PtyManager>,
) -> Result<Option<Handshake>, String> {
    Ok(if OFFERED { pty_manager.handshake(&terminal_id, Instant::now()) } else { None })
}

/// Sends the window `terminal-handshake` with a terminal's id when a launch of it is listed, its CLI is
/// first prompted if it connects then, its CLI shakes hands for the first time or it is over, and when the
/// terminal closes.
pub fn report_handshakes(pty_manager: &PtyManager, webview: WebviewEvents) {
    pty_manager.add_launch_watcher(move |event| {
        let terminal_id = match event {
            LaunchEvent::Listed(launch)
            | LaunchEvent::Prompted(launch)
            | LaunchEvent::ShookHands(launch)
            | LaunchEvent::Over(launch) => launch.terminal_id,
            LaunchEvent::Closed(terminal_id) => terminal_id,
        };
        webview.emit("terminal-handshake", json!({ "terminal_id": terminal_id }));
    });
}
