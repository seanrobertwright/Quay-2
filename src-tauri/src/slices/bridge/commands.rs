use tauri::State;
use super::state::BridgeState;

#[tauri::command]
pub async fn get_bridge_port(bridge_state: State<'_, BridgeState>) -> Result<u16, String> {
    Ok(bridge_state.port())
}
