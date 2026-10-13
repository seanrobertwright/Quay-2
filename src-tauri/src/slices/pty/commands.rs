use tauri::{AppHandle, State};

use super::manager::PtyManager;
use super::models::{SpawnTerminalRequest, TerminalInfo};
use crate::slices::bridge::state::BridgeState;

#[tauri::command]
pub async fn spawn_terminal(
    request: SpawnTerminalRequest,
    pty_manager: State<'_, PtyManager>,
    bridge_state: State<'_, BridgeState>,
    app_handle: AppHandle,
) -> Result<TerminalInfo, String> {
    let port = bridge_state.port();
    let token = bridge_state.token_for(request.id.as_deref().unwrap_or(""));

    pty_manager.spawn(request, port, token, app_handle)
}

#[tauri::command]
pub async fn write_pty(
    terminal_id: String,
    data: String,
    pty_manager: State<'_, PtyManager>,
) -> Result<(), String> {
    pty_manager.write(&terminal_id, &data)
}

#[tauri::command]
pub async fn resize_pty(
    terminal_id: String,
    rows: u16,
    cols: u16,
    pty_manager: State<'_, PtyManager>,
) -> Result<(), String> {
    pty_manager.resize(&terminal_id, rows, cols)
}

#[tauri::command]
pub async fn kill_terminal(
    terminal_id: String,
    pty_manager: State<'_, PtyManager>,
) -> Result<(), String> {
    pty_manager.kill(&terminal_id)
}

#[tauri::command]
pub async fn list_terminals(
    pty_manager: State<'_, PtyManager>,
) -> Result<Vec<TerminalInfo>, String> {
    Ok(pty_manager.list())
}
