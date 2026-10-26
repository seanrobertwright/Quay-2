use tauri::State;

use super::manager::WorkspaceManager;
use super::models::{Project, ProjectView};

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
pub async fn remove_project(
    path: String,
    manager: State<'_, WorkspaceManager>,
) -> Result<Vec<Project>, String> {
    Ok(manager.remove_project(&path))
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

#[tauri::command]
pub async fn get_project_views(
    manager: State<'_, WorkspaceManager>,
) -> Result<std::collections::HashMap<String, ProjectView>, String> {
    Ok(manager.get_project_views())
}

#[tauri::command]
pub async fn save_project_view(
    path: String,
    view: ProjectView,
    manager: State<'_, WorkspaceManager>,
) -> Result<(), String> {
    manager.save_project_view(&path, view);
    Ok(())
}

#[tauri::command]
pub async fn pick_folder() -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(|| {
        let output = std::process::Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = 'Select Project Folder'; $f.ShowNewFolderButton = $true; if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $f.SelectedPath }",
            ])
            .output()
            .map_err(|e| format!("Failed to open folder picker: {}", e))?;

        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if stdout.is_empty() {
            Ok(None)
        } else {
            Ok(Some(stdout))
        }
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
pub async fn validate_path(path: String) -> Result<bool, String> {
    Ok(std::path::Path::new(&path).is_dir())
}

#[tauri::command]
pub async fn update_project_settings(
    path: String,
    env_vars: std::collections::HashMap<String, String>,
    default_flags: Option<String>,
    manager: State<'_, WorkspaceManager>,
) -> Result<Project, String> {
    manager.update_project_settings(&path, env_vars, default_flags)
}
