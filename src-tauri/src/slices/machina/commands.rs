use std::path::Path;

use tauri::State;

use super::config::{config_path, load_config_pinned, parse_config, save_config, HOLDBACKS_REL_DIR};
use super::git;
use super::models::{
    FactoryLoopMode, HoldbackSourceInfo, MachinaStatusPayload, MachinaWorkOrder,
    ProjectFactoryInfo, ResolveHoldRequest, SubmitWorkOrderRequest,
};
use super::supervisor::{parse_wo_id, MachinaManager};
use super::vault::list_files;

/// Runs blocking manager work (git, file IO, transcript scans) off the UI thread.
async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| format!("Machina task failed: {}", e))?
}

#[tauri::command]
pub fn machina_get_status(machina: State<'_, MachinaManager>) -> MachinaStatusPayload {
    machina.status()
}

#[tauri::command]
pub async fn machina_list_work_orders(
    machina: State<'_, MachinaManager>,
) -> Result<Vec<MachinaWorkOrder>, String> {
    let mgr = machina.inner().clone();
    blocking(move || Ok(mgr.list_work_orders())).await
}

#[tauri::command]
pub async fn machina_submit_work_order(
    request: SubmitWorkOrderRequest,
    machina: State<'_, MachinaManager>,
) -> Result<MachinaWorkOrder, String> {
    let mgr = machina.inner().clone();
    blocking(move || mgr.submit_work_order(request, None)).await
}

#[tauri::command]
pub async fn machina_bind_author_terminal(
    work_order_id: String,
    terminal_id: String,
    machina: State<'_, MachinaManager>,
) -> Result<MachinaWorkOrder, String> {
    let mgr = machina.inner().clone();
    let id = parse_wo_id(&work_order_id)?;
    blocking(move || mgr.bind_author_terminal(&id, &terminal_id)).await
}

/// Types the brief (`kind = "brief"`) or the latest correction (`"correction"`) into
/// the author terminal.
#[tauri::command]
pub async fn machina_send_to_author(
    work_order_id: String,
    kind: String,
    machina: State<'_, MachinaManager>,
) -> Result<MachinaWorkOrder, String> {
    let mgr = machina.inner().clone();
    let id = parse_wo_id(&work_order_id)?;
    blocking(move || {
        let text = match kind.as_str() {
            "brief" => mgr.brief_text(&id)?,
            "correction" => mgr.correction_text(&id)?,
            other => return Err(format!("Unknown message kind '{}'", other)),
        };
        mgr.send_to_author(&id, &text)?;
        mgr.get_work_order(&id)
    })
    .await
}

/// The text `machina_send_to_author` would type, for preview.
#[tauri::command]
pub async fn machina_preview_author_message(
    work_order_id: String,
    kind: String,
    machina: State<'_, MachinaManager>,
) -> Result<String, String> {
    let mgr = machina.inner().clone();
    let id = parse_wo_id(&work_order_id)?;
    blocking(move || match kind.as_str() {
        "brief" => mgr.brief_text(&id),
        "correction" => mgr.correction_text(&id),
        other => Err(format!("Unknown message kind '{}'", other)),
    })
    .await
}

#[tauri::command]
pub async fn machina_run_gate(
    work_order_id: String,
    machina: State<'_, MachinaManager>,
) -> Result<MachinaWorkOrder, String> {
    let mgr = machina.inner().clone();
    let id = parse_wo_id(&work_order_id)?;
    // A budget hold is reported through the returned work order's status.
    blocking(move || {
        mgr.start_gate(&id, None)?;
        mgr.get_work_order(&id)
    })
    .await
}

#[tauri::command]
pub async fn machina_resolve_hold(
    request: ResolveHoldRequest,
    machina: State<'_, MachinaManager>,
) -> Result<MachinaWorkOrder, String> {
    let mgr = machina.inner().clone();
    blocking(move || mgr.resolve_hold(request)).await
}

#[tauri::command]
pub async fn machina_accept_and_merge(
    work_order_id: String,
    machina: State<'_, MachinaManager>,
) -> Result<MachinaWorkOrder, String> {
    let mgr = machina.inner().clone();
    let id = parse_wo_id(&work_order_id)?;
    blocking(move || mgr.accept_and_merge(&id)).await
}

#[tauri::command]
pub async fn machina_abort(
    work_order_id: String,
    machina: State<'_, MachinaManager>,
) -> Result<MachinaWorkOrder, String> {
    let mgr = machina.inner().clone();
    let id = parse_wo_id(&work_order_id)?;
    blocking(move || mgr.abort(&id)).await
}

#[tauri::command]
pub async fn machina_resume(
    work_order_id: String,
    machina: State<'_, MachinaManager>,
) -> Result<MachinaWorkOrder, String> {
    let mgr = machina.inner().clone();
    let id = parse_wo_id(&work_order_id)?;
    blocking(move || mgr.resume(&id)).await
}

#[tauri::command]
pub async fn machina_remove_worktree(
    work_order_id: String,
    force: bool,
    machina: State<'_, MachinaManager>,
) -> Result<MachinaWorkOrder, String> {
    let mgr = machina.inner().clone();
    let id = parse_wo_id(&work_order_id)?;
    blocking(move || mgr.remove_worktree(&id, force)).await
}

#[tauri::command]
pub async fn machina_set_loop_mode(
    mode: FactoryLoopMode,
    machina: State<'_, MachinaManager>,
) -> Result<MachinaStatusPayload, String> {
    let mgr = machina.inner().clone();
    blocking(move || Ok(mgr.set_loop_mode(mode))).await
}

fn project_info(mgr: &MachinaManager, project_path: &str) -> Result<ProjectFactoryInfo, String> {
    let repo = git::repo_root(Path::new(project_path.trim()))?;
    let (config, config_sha256, config_exists, config_error) = match load_config_pinned(&repo) {
        Ok(loaded) => {
            let exists = loaded.sha256.is_some();
            (loaded.config, loaded.sha256, exists, None)
        }
        Err(e) => (Default::default(), None, true, Some(e)),
    };
    let config_approved = config_sha256.is_some() && config_sha256 == mgr.approved_config(&repo);
    let hb_dir = repo.join(git::native_path(HOLDBACKS_REL_DIR));
    Ok(ProjectFactoryInfo {
        current_branch: git::current_branch(&repo),
        config_path: config_path(&repo).to_string_lossy().to_string(),
        config_exists,
        config,
        config_error,
        config_sha256,
        config_approved,
        holdbacks: HoldbackSourceInfo {
            path: hb_dir.to_string_lossy().to_string(),
            exists: hb_dir.is_dir(),
            file_count: list_files(&hb_dir)?.len(),
            tracked_in_git: !git::ls_files(&repo, HOLDBACKS_REL_DIR)?.is_empty(),
        },
        repo_path: repo.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub async fn machina_get_project_info(
    project_path: String,
    machina: State<'_, MachinaManager>,
) -> Result<ProjectFactoryInfo, String> {
    let mgr = machina.inner().clone();
    blocking(move || project_info(&mgr, &project_path)).await
}

/// Validates `config_json`, writes it to `<repo>/.machina/factory.json`, and approves
/// the written file: the operator authored it, so its commands may run.
#[tauri::command]
pub async fn machina_save_project_config(
    project_path: String,
    config_json: String,
    machina: State<'_, MachinaManager>,
) -> Result<ProjectFactoryInfo, String> {
    let mgr = machina.inner().clone();
    blocking(move || {
        let repo = git::repo_root(Path::new(project_path.trim()))?;
        let cfg = parse_config(&config_json)?;
        let sha = save_config(&repo, cfg)?;
        mgr.approve_config(&repo, &sha)?;
        project_info(&mgr, &project_path)
    })
    .await
}

/// Approves the repository's current factory.json, provided it still hashes to
/// `sha256` (the version shown to the operator).
#[tauri::command]
pub async fn machina_approve_project_config(
    project_path: String,
    sha256: String,
    machina: State<'_, MachinaManager>,
) -> Result<ProjectFactoryInfo, String> {
    let mgr = machina.inner().clone();
    blocking(move || {
        let repo = git::repo_root(Path::new(project_path.trim()))?;
        mgr.approve_config(&repo, &sha256)?;
        project_info(&mgr, &project_path)
    })
    .await
}
