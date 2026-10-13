use tauri::State;

use super::manager::WorkspaceManager;
use super::models::Project;

#[tauri::command]
pub async fn list_projects(
    manager: State<'_, WorkspaceManager>,
) -> Result<Vec<Project>, String> {
    Ok(manager.list_projects())
}

#[tauri::command]
pub async fn add_project(
    path: String,
    manager: State<'_, WorkspaceManager>,
) -> Result<Project, String> {
    Ok(manager.add_project(&path))
}

#[tauri::command]
pub async fn set_active_project(
    path: String,
    manager: State<'_, WorkspaceManager>,
) -> Result<(), String> {
    manager.set_active_project(&path);
    Ok(())
}

#[tauri::command]
pub async fn get_active_project(
    manager: State<'_, WorkspaceManager>,
) -> Result<Option<String>, String> {
    Ok(manager.get_active_project())
}
