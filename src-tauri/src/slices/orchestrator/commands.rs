use tauri::State;

use super::models::{A2ADispatchRequest, A2AMessage};
use super::router::A2ARouter;
use crate::slices::bridge::state::BridgeState;
use crate::slices::pty::manager::PtyManager;

#[tauri::command]
pub async fn a2a_send_prompt(
    request: A2ADispatchRequest,
    router: State<'_, A2ARouter>,
    bridge_state: State<'_, BridgeState>,
) -> Result<A2AMessage, String> {
    router.dispatch(request, &bridge_state)
}

#[tauri::command]
pub async fn a2a_broadcast_toast(
    text: String,
    router: State<'_, A2ARouter>,
    bridge_state: State<'_, BridgeState>,
    pty_manager: State<'_, PtyManager>,
) -> Result<(), String> {
    router.broadcast_toast(&text, &bridge_state, &pty_manager);
    Ok(())
}

#[tauri::command]
pub async fn a2a_get_messages(
    router: State<'_, A2ARouter>,
) -> Result<Vec<A2AMessage>, String> {
    Ok(router.get_messages())
}
