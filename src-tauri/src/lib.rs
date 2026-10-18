pub mod dates;
pub mod slices;

use slices::archon::{
    archon_check_service, archon_get_runs, archon_get_workflows, archon_parse_repo_specs,
};
use slices::audit::run_pre_pr_audit;
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
    machina_accept_and_merge, machina_calibrate_gate, machina_get_status, machina_list_work_orders,
    machina_rebind_stage_agent, machina_resolve_hold, machina_run_stage_validation,
    machina_set_loop_mode, machina_submit_work_order, machina_trigger_epoch_recovery,
    machina_update_constitution, MachinaManager,
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
    let bridge_state_clone = bridge_state.clone();
    let a2a_router_clone = a2a_router.clone();
    let machina_manager_clone = machina_manager.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(pty_manager)
        .manage(bridge_state)
        .manage(workspace_manager)
        .manage(a2a_router)
        .manage(machina_manager)
        .setup(move |app| {
            let app_handle = app.handle().clone();

            // Start Machina Praxis sidecar supervisor
            machina_manager_clone.start_supervisor(app_handle.clone());

            // Launch the claude-mod-events HTTP bridge & MCP server on a Tokio task
            tauri::async_runtime::spawn(async move {
                if let Err(e) = BridgeServer::start(
                    bridge_state_clone,
                    pty_manager_clone,
                    a2a_router_clone,
                    machina_manager_clone,
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
            archon_parse_repo_specs,
            machina_get_status,
            machina_list_work_orders,
            machina_submit_work_order,
            machina_resolve_hold,
            machina_rebind_stage_agent,
            machina_accept_and_merge,
            machina_trigger_epoch_recovery,
            machina_run_stage_validation,
            machina_set_loop_mode,
            machina_update_constitution,
            machina_calibrate_gate,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
