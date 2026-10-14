pub mod slices;

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
use slices::orchestrator::{
    a2a_broadcast_toast, a2a_clear_messages, a2a_get_messages, a2a_send_prompt, A2ARouter,
};
use slices::pty::{
    get_terminal_output, kill_terminal, list_terminals, rename_terminal, resize_pty,
    spawn_terminal, write_pty, PtyManager,
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
            get_terminal_output,
            write_pty,
            resize_pty,
            kill_terminal,
            list_terminals,
            rename_terminal,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
