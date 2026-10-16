use tauri::{AppHandle, State};

use super::models::{
    MachinaStatusPayload, MachinaWorkOrder, RebindStageAgentRequest, ResolveHoldRequest,
    SubmitWorkOrderRequest,
};
use super::supervisor::MachinaManager;

#[tauri::command]
pub fn machina_get_status(
    machina: State<'_, MachinaManager>,
) -> Result<MachinaStatusPayload, String> {
    Ok(machina.get_status())
}

#[tauri::command]
pub fn machina_list_work_orders(
    machina: State<'_, MachinaManager>,
) -> Result<Vec<MachinaWorkOrder>, String> {
    Ok(machina.list_work_orders())
}

#[tauri::command]
pub fn machina_submit_work_order(
    request: SubmitWorkOrderRequest,
    machina: State<'_, MachinaManager>,
    app_handle: AppHandle,
) -> Result<MachinaWorkOrder, String> {
    machina.submit_work_order(request, Some(&app_handle))
}

#[tauri::command]
pub fn machina_resolve_hold(
    request: ResolveHoldRequest,
    machina: State<'_, MachinaManager>,
    app_handle: AppHandle,
) -> Result<MachinaWorkOrder, String> {
    machina.resolve_hold(request, Some(&app_handle))
}

#[tauri::command]
pub fn machina_rebind_stage_agent(
    request: RebindStageAgentRequest,
    machina: State<'_, MachinaManager>,
    app_handle: AppHandle,
) -> Result<MachinaWorkOrder, String> {
    machina.rebind_stage_agent(request, Some(&app_handle))
}

#[tauri::command]
pub fn machina_accept_and_merge(
    work_order_id: String,
    machina: State<'_, MachinaManager>,
    app_handle: AppHandle,
) -> Result<MachinaWorkOrder, String> {
    machina.accept_and_merge(&work_order_id, Some(&app_handle))
}

#[tauri::command]
pub fn machina_trigger_epoch_recovery(
    machina: State<'_, MachinaManager>,
    app_handle: AppHandle,
) -> Result<MachinaStatusPayload, String> {
    Ok(machina.trigger_epoch_recovery(Some(&app_handle)))
}

#[tauri::command]
pub async fn machina_run_stage_validation(
    work_order_id: String,
    project_path: String,
    machina: State<'_, MachinaManager>,
    app_handle: AppHandle,
) -> Result<MachinaWorkOrder, String> {
    let mgr = machina.inner().clone();
    tokio::task::spawn_blocking(move || {
        mgr.run_stage_validation(&work_order_id, &project_path, Some(&app_handle))
    })
    .await
    .map_err(|e| format!("Validation task panicked: {}", e))?
}
