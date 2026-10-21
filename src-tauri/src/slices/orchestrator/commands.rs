use tauri::{AppHandle, Emitter, State};

use super::models::{A2ADispatchRequest, A2AMessage, A2AMessageStatus};
use super::router::A2ARouter;
use super::swarms::{SavedSwarm, SwarmDraft, SwarmStore};
use crate::slices::pty::manager::PtyManager;

#[tauri::command]
pub async fn a2a_send_prompt(
    request: A2ADispatchRequest,
    router: State<'_, A2ARouter>,
    pty_manager: State<'_, PtyManager>,
    app_handle: AppHandle,
) -> Result<A2AMessage, String> {
    let msg = router.dispatch_async(request, Some(&pty_manager)).await?;
    emit_message(&app_handle, &msg);
    Ok(msg)
}

/// Shows `msg` in the trail and, when it has just been typed into its target, raises its
/// toast. A queued message raises its toast later, when it is typed in.
pub fn emit_message(app_handle: &AppHandle, msg: &A2AMessage) {
    let _ = app_handle.emit("a2a-message-updated", msg.clone());
    if msg.status == A2AMessageStatus::Dispatched {
        let _ = app_handle.emit("a2a-message-dispatched", msg.clone());
    }
}

#[tauri::command]
pub async fn a2a_broadcast_toast(
    text: String,
    router: State<'_, A2ARouter>,
    pty_manager: State<'_, PtyManager>,
    app_handle: AppHandle,
) -> Result<Vec<A2AMessage>, String> {
    let msgs = router.broadcast_toast_async(&text, &pty_manager).await;
    for msg in &msgs {
        emit_message(&app_handle, msg);
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

/// The launch prompt for each agent of a swarm about to launch, in roster order, or null
/// for an agent whose CLI takes none.
#[tauri::command]
pub async fn swarm_launch_prompts(
    members: Vec<super::launch_prompt::SwarmMember>,
) -> Result<Vec<Option<String>>, String> {
    Ok(super::launch_prompt::compose_launch_prompts(&members))
}
