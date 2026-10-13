pub mod slices;

use slices::bridge::{get_bridge_port, BridgeServer, BridgeState};
use slices::orchestrator::{
    a2a_broadcast_toast, a2a_get_messages, a2a_send_prompt, A2ARouter,
};
use slices::pty::{
    kill_terminal, list_terminals, resize_pty, spawn_terminal, write_pty, PtyManager,
};
use slices::workspace::{
    add_project, get_active_project, list_projects, set_active_project, WorkspaceManager,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt::init();

    let pty_manager = PtyManager::new();
    let bridge_state = BridgeState::new();
    let workspace_manager = WorkspaceManager::new();
    let a2a_router = A2ARouter::new();

    let pty_manager_clone = pty_manager.clone();
    let bridge_state_clone = bridge_state.clone();
    let a2a_router_clone = a2a_router.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(pty_manager)
        .manage(bridge_state)
        .manage(workspace_manager)
        .manage(a2a_router)
        .setup(move |app| {
            let app_handle = app.handle().clone();

            // Launch the claude-mod-events HTTP bridge on a Tokio task
            tauri::async_runtime::spawn(async move {
                if let Err(e) = BridgeServer::start(
                    bridge_state_clone,
                    pty_manager_clone,
                    a2a_router_clone,
                    app_handle,
                )
                .await
                {
                    tracing::error!("Failed to start bridge server: {}", e);
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_bridge_port,
            spawn_terminal,
            write_pty,
            resize_pty,
            kill_terminal,
            list_terminals,
            list_projects,
            add_project,
            set_active_project,
            get_active_project,
            a2a_send_prompt,
            a2a_broadcast_toast,
            a2a_get_messages,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
