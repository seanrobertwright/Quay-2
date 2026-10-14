use tauri::State;
use super::models::PermissionRequestPayload;
use super::state::BridgeState;
use crate::slices::pty::manager::PtyManager;
use crate::slices::pty::models::PermissionMode;

#[tauri::command]
pub async fn get_bridge_port(bridge_state: State<'_, BridgeState>) -> Result<u16, String> {
    Ok(bridge_state.port())
}

#[tauri::command]
pub async fn resolve_permission(
    request_id: String,
    decision: String,
    reason: Option<String>,
    remember_for_session: Option<bool>,
    bridge_state: State<'_, BridgeState>,
) -> Result<(), String> {
    bridge_state.resolve_permission(
        &request_id,
        &decision,
        reason,
        remember_for_session.unwrap_or(false),
    )
}

#[tauri::command]
pub async fn get_pending_permissions(
    bridge_state: State<'_, BridgeState>,
) -> Result<Vec<PermissionRequestPayload>, String> {
    Ok(bridge_state.list_pending_permissions())
}

#[tauri::command]
pub async fn set_terminal_live_mode(
    terminal_id: String,
    mode: PermissionMode,
    pty_manager: State<'_, PtyManager>,
) -> Result<(), String> {
    pty_manager.set_live_mode(&terminal_id, mode)
}
