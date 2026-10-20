use tauri::{AppHandle, Emitter, State};

use super::models::{A2ADispatchRequest, A2AMessage};
use super::router::A2ARouter;
use crate::slices::pty::manager::PtyManager;

#[tauri::command]
pub async fn a2a_send_prompt(
    request: A2ADispatchRequest,
    router: State<'_, A2ARouter>,
    pty_manager: State<'_, PtyManager>,
    app_handle: AppHandle,
) -> Result<A2AMessage, String> {
    let msg = router.dispatch(request, Some(&pty_manager))?;
    let _ = app_handle.emit("a2a-message-updated", msg.clone());
    let _ = app_handle.emit("a2a-message-dispatched", msg.clone());
    Ok(msg)
}

#[tauri::command]
pub async fn a2a_broadcast_toast(
    text: String,
    router: State<'_, A2ARouter>,
    pty_manager: State<'_, PtyManager>,
    app_handle: AppHandle,
) -> Result<Vec<A2AMessage>, String> {
    let msgs = router.broadcast_toast(&text, &pty_manager);
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
