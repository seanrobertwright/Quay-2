use tauri::{AppHandle, Emitter, State};

use super::manager::PtyManager;
use super::models::{SpawnTerminalRequest, TerminalInfo, TerminalOutputPayload};
use crate::slices::bridge::state::BridgeState;
use crate::slices::orchestrator::A2ARouter;

#[tauri::command]
pub async fn spawn_terminal(
    mut request: SpawnTerminalRequest,
    pty_manager: State<'_, PtyManager>,
    bridge_state: State<'_, BridgeState>,
    workspace_manager: State<'_, crate::slices::workspace::manager::WorkspaceManager>,
    app_handle: AppHandle,
) -> Result<TerminalInfo, String> {
    let terminal_id = request
        .id
        .clone()
        .unwrap_or_else(|| format!("term-{}", uuid::Uuid::new_v4().simple()));
    request.id = Some(terminal_id.clone());

    // Inherit workspace environment variables and custom flags
    if let Some((proj_env, proj_flags)) =
        workspace_manager.get_project_settings(&request.project_path)
    {
        if request.env_vars.is_none() && !proj_env.is_empty() {
            request.env_vars = Some(proj_env);
        } else if let Some(ref mut envs) = request.env_vars {
            for (k, v) in proj_env {
                envs.entry(k).or_insert(v);
            }
        }

        if request.custom_flags.is_none() && proj_flags.is_some() {
            request.custom_flags = proj_flags;
        }
    }

    let port = bridge_state.port();
    let token = bridge_state.token_for(&terminal_id);

    pty_manager.spawn(request, port, token, app_handle)
}

#[tauri::command]
pub async fn get_terminal_output(
    terminal_id: String,
    pty_manager: State<'_, PtyManager>,
) -> Result<TerminalOutputPayload, String> {
    pty_manager.get_output(&terminal_id)
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
    bridge_state: State<'_, BridgeState>,
) -> Result<(), String> {
    bridge_state.cancel_pending_permissions_for_terminal(&terminal_id);
    pty_manager.kill(&terminal_id)
}

#[tauri::command]
pub async fn list_terminals(
    pty_manager: State<'_, PtyManager>,
) -> Result<Vec<TerminalInfo>, String> {
    Ok(pty_manager.list())
}

#[tauri::command]
pub async fn rename_terminal(
    terminal_id: String,
    name: String,
    pty_manager: State<'_, PtyManager>,
) -> Result<(), String> {
    pty_manager.rename(&terminal_id, &name)
}

/// Hides the plugin hint in the terminal's pane until it is relaunched.
#[tauri::command]
pub async fn dismiss_plugin_hint(
    terminal_id: String,
    pty_manager: State<'_, PtyManager>,
    app_handle: AppHandle,
) -> Result<(), String> {
    let status = pty_manager
        .dismiss_plugin_hint(&terminal_id)
        .ok_or_else(|| format!("Terminal {} not found", terminal_id))?;
    let _ = app_handle.emit("terminal-status", status);
    Ok(())
}

#[tauri::command]
pub async fn relaunch_terminal(
    terminal_id: String,
    rows: Option<u16>,
    cols: Option<u16>,
    pty_manager: State<'_, PtyManager>,
    bridge_state: State<'_, BridgeState>,
    workspace_manager: State<'_, crate::slices::workspace::manager::WorkspaceManager>,
    a2a_router: State<'_, A2ARouter>,
    app_handle: AppHandle,
) -> Result<TerminalInfo, String> {
    // No turn of the new launch answers a message typed into the old one. A Claude terminal's
    // plugin already said so with `session.ended`; a Codex terminal reports no session end.
    a2a_router.forget_turns(&terminal_id);

    // Relaunch re-reads workspace env vars so a restarted terminal matches a fresh spawn.
    // Its launch flags come from the stored terminal info, so they are not re-merged here.
    let env_vars = pty_manager
        .get_info(&terminal_id)
        .and_then(|info| workspace_manager.get_project_settings(&info.project_path))
        .map(|(env, _flags)| env)
        .filter(|env| !env.is_empty());

    let port = bridge_state.port();
    let token = bridge_state.token_for(&terminal_id);
    // The pane's fitted size; a zero dimension falls back to the session default.
    let rows = rows.filter(|&n| n > 0);
    let cols = cols.filter(|&n| n > 0);
    pty_manager.relaunch(&terminal_id, rows, cols, port, token, env_vars, app_handle)
}

