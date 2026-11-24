//! What the webview asks of the surfaces.

use serde_json::Value;
use tauri::{AppHandle, Emitter, State};

use super::check::{CheckRequest, Verdict};
use super::store::{AnswerRefused, BeingSent, MoveRefused, SurfaceKey, SurfaceRecord};
use super::tools::{SurfaceTools, Webview};
use super::typing::NotTyped;
use super::unsent::{Page, UnsentRefused, UnsentSave, UNSENT_LIMIT};

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

/// Opens a page for a webview that has just loaded: its number, and what is unsent in each surface.
#[tauri::command]
pub async fn surface_open_page(surfaces: State<'_, SurfaceTools>) -> Result<Page, String> {
    Ok(surfaces.open_page())
}

/// Keeps what the operator has put in a surface and not sent. An error is only that it is too large:
/// a save that comes after its surface was settled, removed or changed, or after a later save, is
/// dropped as a matter of course.
#[tauri::command]
pub async fn surface_save_unsent(
    terminal_id: String,
    id: String,
    unsent: UnsentSave,
    surfaces: State<'_, SurfaceTools>,
) -> Result<(), String> {
    match surfaces.save_unsent(&SurfaceKey::new(terminal_id, id), unsent) {
        Err(UnsentRefused::TooLarge) => Err(format!("More than {} kB is unsent in this surface.", UNSENT_LIMIT / 1024)),
        Err(UnsentRefused::NoSuchSurface | UnsentRefused::OtherRevision | UnsentRefused::OlderSave) | Ok(()) => Ok(()),
    }
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

/// Takes those of a terminal's surfaces `ids` that are locked off the screen. No agent is told.
#[tauri::command]
pub async fn surface_dismiss_locked(
    terminal_id: String,
    ids: Vec<String>,
    surfaces: State<'_, SurfaceTools>,
) -> Result<(), String> {
    surfaces.dismiss_locked(&terminal_id, &ids);
    Ok(())
}

/// Moves a raw companion surface to a stage tab, or back, and gives it as it is then. An error says why it
/// stays, in words for the operator.
#[tauri::command]
pub async fn surface_move(
    terminal_id: String,
    id: String,
    as_tab: bool,
    surfaces: State<'_, SurfaceTools>,
) -> Result<SurfaceRecord, String> {
    let moved = surfaces.move_surface(&SurfaceKey::new(terminal_id, id), as_tab);
    moved.map_err(|refused| {
        let why = match refused {
            MoveRefused::NoSuchSurface => "Not moved: Quay no longer has this surface.",
            MoveRefused::NotMovable => "Not moved: only a raw surface in the companion can be.",
            MoveRefused::Locked => "Not moved: it is over.",
        };
        why.to_string()
    })
}

fn refusal(refused: AnswerRefused) -> &'static str {
    match refused {
        AnswerRefused::NoSuchSurface => "Not sent: Quay no longer has this surface.",
        AnswerRefused::AlreadyAnswered => "Not sent: this was already answered.",
        AnswerRefused::OlderRevision => "Not sent: the agent has changed this since. Check it and send again.",
        AnswerRefused::Ended => "Not sent: the terminal exited before this was answered.",
        AnswerRefused::Withdrawn => "Not sent: the agent withdrew this before you answered.",
        AnswerRefused::NotTyped(NotTyped::TerminalOver) => "Not sent: the terminal has exited.",
        AnswerRefused::NotTyped(NotTyped::Failed) => "Not sent: it could not be typed into the terminal.",
    }
}
