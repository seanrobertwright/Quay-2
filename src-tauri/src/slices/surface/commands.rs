//! What the webview asks of the surfaces.

use serde_json::Value;
use tauri::{AppHandle, Emitter, State};

use super::check::{CheckRequest, Verdict};
use super::store::{AnswerRefused, SurfaceKey, SurfaceRecord};
use super::tools::{SurfaceTools, Webview};

/// Quay's window, reached through Tauri's events.
pub struct AppWebview(pub AppHandle);

impl Webview for AppWebview {
    fn check(&self, request: &CheckRequest) {
        if let Err(e) = self.0.emit("surface-check", request) {
            tracing::error!("A surface check could not be sent: {e}");
        }
    }

    fn show(&self, record: &SurfaceRecord) {
        if let Err(e) = self.0.emit("surface-changed", record) {
            tracing::error!("A surface could not be sent to be drawn: {e}");
        }
    }

    fn remove(&self, key: &SurfaceKey) {
        if let Err(e) = self.0.emit("surface-removed", key) {
            tracing::error!("A surface's removal could not be sent: {e}");
        }
    }
}

/// The webview's verdict on a check.
#[tauri::command]
pub async fn surface_verdict(call: u64, verdict: Verdict, surfaces: State<'_, SurfaceTools>) -> Result<(), String> {
    surfaces.verdict(call, verdict);
    Ok(())
}

/// Every surface, for a webview that has just loaded.
#[tauri::command]
pub async fn surface_list(surfaces: State<'_, SurfaceTools>) -> Result<Vec<SurfaceRecord>, String> {
    Ok(surfaces.surfaces())
}

/// The checks without a verdict, for a webview that has just loaded.
#[tauri::command]
pub async fn surface_checks(surfaces: State<'_, SurfaceTools>) -> Result<Vec<CheckRequest>, String> {
    Ok(surfaces.unanswered_checks())
}

/// The operator's answer to `revision` of a surface. An error says why it was not taken, in words
/// for the operator.
#[tauri::command]
pub async fn surface_answer(
    terminal_id: String,
    id: String,
    revision: u64,
    answer: Value,
    surfaces: State<'_, SurfaceTools>,
) -> Result<(), String> {
    surfaces.answer(&SurfaceKey::new(terminal_id, id), revision, answer).map_err(|refused| refusal(refused).to_string())
}

fn refusal(refused: AnswerRefused) -> &'static str {
    match refused {
        AnswerRefused::NoSuchSurface => "Not sent: Quay no longer has this surface.",
        AnswerRefused::AlreadyAnswered => "Not sent: this was already answered.",
        AnswerRefused::OlderRevision => "Not sent: the agent has changed this since. Check it and send again.",
        AnswerRefused::CallEnded => "Not sent: the agent's call has ended, so the answer would not reach it.",
    }
}
