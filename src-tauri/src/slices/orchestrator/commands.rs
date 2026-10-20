use tauri::{AppHandle, Emitter, State};

use super::models::{A2ADispatchRequest, A2AMessage};
use super::router::A2ARouter;
use super::swarms::{SavedSwarm, SwarmDraft, SwarmStore};
use crate::slices::bridge::state::BridgeState;
use crate::slices::pty::manager::PtyManager;

#[tauri::command]
pub async fn a2a_send_prompt(
    request: A2ADispatchRequest,
    router: State<'_, A2ARouter>,
    bridge_state: State<'_, BridgeState>,
    pty_manager: State<'_, PtyManager>,
    app_handle: AppHandle,
) -> Result<A2AMessage, String> {
    let msg = router.dispatch(request, &bridge_state, Some(&pty_manager))?;
    let _ = app_handle.emit("a2a-message-updated", msg.clone());
    let _ = app_handle.emit("a2a-message-dispatched", msg.clone());
    Ok(msg)
}

#[tauri::command]
pub async fn a2a_broadcast_toast(
    text: String,
    router: State<'_, A2ARouter>,
    bridge_state: State<'_, BridgeState>,
    pty_manager: State<'_, PtyManager>,
    app_handle: AppHandle,
) -> Result<Vec<A2AMessage>, String> {
    let msgs = router.broadcast_toast(&text, &bridge_state, &pty_manager);
    for msg in &msgs {
        let _ = app_handle.emit("a2a-message-updated", msg.clone());
        let _ = app_handle.emit("a2a-message-dispatched", msg.clone());
    }
    let _ = app_handle.emit("a2a-toast", text);
    Ok(msgs)
}

#[tauri::command]
pub async fn a2a_get_messages(
    router: State<'_, A2ARouter>,
) -> Result<Vec<A2AMessage>, String> {
    Ok(router.get_messages())
}

#[tauri::command]
pub async fn a2a_clear_messages(
    router: State<'_, A2ARouter>,
    app_handle: AppHandle,
) -> Result<(), String> {
    router.clear_messages();
    let _ = app_handle.emit("a2a-messages-cleared", ());
    Ok(())
}

#[tauri::command]
pub async fn list_saved_swarms(store: State<'_, SwarmStore>) -> Result<Vec<SavedSwarm>, String> {
    store.list()
}

#[tauri::command]
pub async fn save_swarm(
    swarm: SwarmDraft,
    store: State<'_, SwarmStore>,
) -> Result<Vec<SavedSwarm>, String> {
    store.save(swarm)
}

#[tauri::command]
pub async fn remove_saved_swarm(
    id: String,
    store: State<'_, SwarmStore>,
) -> Result<Vec<SavedSwarm>, String> {
    store.remove(&id)
}
