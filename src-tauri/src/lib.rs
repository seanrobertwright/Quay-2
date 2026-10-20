pub mod dates;
pub mod slices;

use tauri::Emitter;

use slices::archon::{
    archon_check_service, archon_get_run_detail, archon_get_runs, archon_get_workflows,
    archon_parse_repo_specs, archon_run_action,
};
use slices::audit::run_pre_pr_audit;
use slices::bridge::port::{parse_bridge_port, BRIDGE_PORT_VAR};
use slices::bridge::{
    get_bridge_port, get_pending_permissions, resolve_permission, set_terminal_live_mode,
    BridgeServer, BridgeState,
};
use slices::git::{create_git_worktree, is_git_repo, list_git_worktrees, remove_git_worktree};
use slices::github::{
    check_gh_cli_installed, get_github_issue, get_github_repo_info, list_github_issues,
    list_github_prs,
};
use slices::machina::{
    machina_abort, machina_accept_and_merge, machina_approve_project_config,
    machina_bind_author_terminal,
    machina_get_project_info, machina_get_status, machina_list_work_orders,
    machina_preview_author_message, machina_remove_worktree, machina_resolve_hold,
    machina_resume, machina_run_gate, machina_save_project_config, machina_send_to_author,
    machina_set_loop_mode, machina_submit_work_order, MachinaManager,
};
use slices::orchestrator::{
    a2a_broadcast_toast, a2a_clear_messages, a2a_get_messages, a2a_send_prompt, A2ARouter,
};
use slices::pty::{
    get_terminal_output, kill_terminal, list_terminals, relaunch_terminal, rename_terminal,
    resize_pty, spawn_terminal, write_pty, PtyManager,
};
use slices::sessions::{get_claude_stats, list_claude_sessions};
use slices::workspace::{
    add_project, get_active_project, list_projects, pick_folder, remove_project,
    set_active_project, update_project_settings, validate_path, WorkspaceManager,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt::init();

    let pty_manager = PtyManager::new();
    let bridge_state = BridgeState::new();
    let workspace_manager = WorkspaceManager::new();
    let a2a_router = A2ARouter::new();
    let machina_manager = MachinaManager::new();

    let pty_manager_clone = pty_manager.clone();
    let machina_pty = pty_manager.clone();
    let bridge_state_clone = bridge_state.clone();
    let a2a_router_clone = a2a_router.clone();
    let machina_manager_clone = machina_manager.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(pty_manager)
        .manage(bridge_state)
        .manage(workspace_manager)
        .manage(a2a_router)
        .manage(machina_manager)
        .setup(move |app| {
            let app_handle = app.handle().clone();

            // Forward Machina changes as events and connect it to the terminals; this
            // also starts queued work orders that are ready.
            let machina_events = app_handle.clone();
            machina_manager_clone.start_supervisor(
                move |status| {
                    let _ = machina_events.emit("machina-state-updated", status);
                },
                machina_pty,
            );

            // Launch the claude-mod-events HTTP bridge & MCP server on a Tokio task.
            // A bad QUAY_BRIDGE_PORT stops the bridge instead of falling back to random.
            match parse_bridge_port(std::env::var(BRIDGE_PORT_VAR)) {
                Ok(port) => {
                    tauri::async_runtime::spawn(async move {
                        if let Err(e) = BridgeServer::start(
                            bridge_state_clone,
                            pty_manager_clone,
                            a2a_router_clone,
                            machina_manager_clone,
                            app_handle,
                            port,
                        )
                        .await
                        {
                            tracing::error!("Failed to start bridge server: {}", e);
                        }
                    });
                }
                Err(e) => tracing::error!("Bridge server not started: {}", e),
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_bridge_port,
            spawn_terminal,
            get_terminal_output,
            write_pty,
            resize_pty,
            kill_terminal,
            list_terminals,
            rename_terminal,
            relaunch_terminal,
            list_projects,
            add_project,
            remove_project,
            set_active_project,
            get_active_project,
            update_project_settings,
            pick_folder,
            validate_path,
            a2a_send_prompt,
            a2a_broadcast_toast,
            a2a_get_messages,
            a2a_clear_messages,
            resolve_permission,
            get_pending_permissions,
            set_terminal_live_mode,
            is_git_repo,
            list_git_worktrees,
            create_git_worktree,
            remove_git_worktree,
            check_gh_cli_installed,
            get_github_repo_info,
            list_github_issues,
            get_github_issue,
            list_github_prs,
            run_pre_pr_audit,
            list_claude_sessions,
            get_claude_stats,
            archon_check_service,
            archon_get_workflows,
            archon_get_runs,
            archon_get_run_detail,
            archon_run_action,
            archon_parse_repo_specs,
            machina_get_status,
            machina_list_work_orders,
            machina_submit_work_order,
            machina_bind_author_terminal,
            machina_send_to_author,
            machina_preview_author_message,
            machina_run_gate,
            machina_resolve_hold,
            machina_accept_and_merge,
            machina_abort,
            machina_resume,
            machina_remove_worktree,
            machina_set_loop_mode,
            machina_get_project_info,
            machina_save_project_config,
            machina_approve_project_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
