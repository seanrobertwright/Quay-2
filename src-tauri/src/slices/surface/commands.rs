//! What the webview asks of the surfaces.

use serde_json::Value;
use tauri::{AppHandle, Emitter, State};

use super::check::{CheckRequest, Verdict};
use super::store::{AnswerRefused, BeingSent, SurfaceKey, SurfaceRecord};
use super::tools::{SurfaceTools, Webview};
use super::typing::NotTyped;

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
    let surfaces = surfaces.inner().clone();
    let key = SurfaceKey::new(terminal_id, id);
    // An answer that no call returns is typed in, which blocks
    tokio::task::spawn_blocking(move || surfaces.answer(&key, revision, answer))
        .await
        .map_err(|e| format!("Not sent: {e}"))?
        .map_err(|refused| refusal(refused).to_string())
}

/// Takes a surface off the screen. An agent that asked is told so. An error says why it stays, in
/// words for the operator.
#[tauri::command]
pub async fn surface_dismiss(terminal_id: String, id: String, surfaces: State<'_, SurfaceTools>) -> Result<(), String> {
    let surfaces = surfaces.inner().clone();
    let key = SurfaceKey::new(terminal_id, id);
    // Telling an agent whose call has ended types it in, which blocks
    tokio::task::spawn_blocking(move || surfaces.dismiss(&key))
        .await
        .map_err(|e| format!("Not dismissed: {e}"))?
        .map_err(|BeingSent| "Not dismissed: its answer is being sent.".to_string())
}

fn refusal(refused: AnswerRefused) -> &'static str {
    match refused {
        AnswerRefused::NoSuchSurface => "Not sent: Quay no longer has this surface.",
        AnswerRefused::AlreadyAnswered => "Not sent: this was already answered.",
        AnswerRefused::OlderRevision => "Not sent: the agent has changed this since. Check it and send again.",
        AnswerRefused::NotTyped(NotTyped::TerminalOver) => "Not sent: the terminal has exited.",
        AnswerRefused::NotTyped(NotTyped::Failed) => "Not sent: it could not be typed into the terminal.",
    }
}
