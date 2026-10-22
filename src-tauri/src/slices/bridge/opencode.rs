//! Feeds an OpenCode terminal's turns, as `opencode_watch` reads them from the server its
//! TUI runs, through the handling the event-bridge plugin's events get, so an OpenCode
//! turn moves status, answers a waiting sender and lets held messages in like a Claude one.

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Emitter;

use super::models::Envelope;
use super::routes::{apply_event, AppContext};
use crate::slices::pty::opencode_watch::{watch, TurnEvent, WatchEnd, CONNECT_BUDGET};
use crate::slices::pty::plugin_watch::LaunchRef;

/// The `boot` of the envelopes Quay makes for an OpenCode terminal, where a plugin's
/// envelope names its own process.
const BOOT: &str = "quay-opencode-watch";

/// The envelope for `turn`, the `seq`th of the launch, as the event-bridge plugin would
/// send it for terminal `terminal_id`.
pub fn turn_envelope(terminal_id: &str, seq: u64, turn: &TurnEvent) -> Envelope {
    let (event_type, data) = match turn {
        TurnEvent::Started => ("turn.started", serde_json::json!({})),
        TurnEvent::Ended { answer } => ("turn.completed", serde_json::json!({ "answer": answer })),
    };
    Envelope {
        v: 1,
        boot: BOOT.to_string(),
        seq,
        ts: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0),
        session_id: terminal_id.to_string(),
        tag: Some(terminal_id.to_string()),
        event_type: event_type.to_string(),
        data,
    }
}

/// Watches the OpenCode server `launch` runs on loopback `port` for as long as the launch
/// runs. When the server can't be reached, the terminal shows Unknown, so it stops holding
/// messages that no turn end would let in.
pub fn start_watching(ctx: Arc<AppContext>, launch: LaunchRef, port: u16) {
    tauri::async_runtime::spawn(async move {
        let mut seq = 0;
        let end = watch(
            port,
            || ctx.pty_manager.launch_running(&launch),
            |turn| {
                seq += 1;
                apply_event(&ctx, turn_envelope(&launch.terminal_id, seq, &turn));
            },
        )
        .await;

        // No turn of a later launch answers a message typed into this one. After a
        // relaunch the pairing belongs to the new launch, so it is left alone.
        if ctx.pty_manager.launch_current(&launch) {
            ctx.a2a_router.forget_turns(&launch.terminal_id);
        }
        if end == WatchEnd::GaveUp {
            tracing::warn!(
                "OpenCode terminal {} served nothing on port {} for {}s; its status is Unknown",
                launch.terminal_id,
                port,
                CONNECT_BUDGET.as_secs()
            );
            if let Some(status) = ctx.pty_manager.lose_turn_sight(&launch) {
                let _ = ctx.app_handle.emit("terminal-status", status);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_turn_becomes_the_envelope_the_plugin_would_send() {
        let started = turn_envelope("term-oc", 1, &TurnEvent::Started);
        assert_eq!(started.event_type, "turn.started");
        assert_eq!(started.tag.as_deref(), Some("term-oc"));
        assert_eq!(started.seq, 1);

        let ended = turn_envelope("term-oc", 2, &TurnEvent::Ended { answer: "pong".into() });
        assert_eq!(ended.event_type, "turn.completed");
        assert_eq!(ended.data["answer"], "pong");
        assert!(ended.data.get("agentId").is_none(), "an OpenCode turn is never a subagent's");
    }
}
