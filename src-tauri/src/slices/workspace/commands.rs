use tauri::State;

use super::manager::WorkspaceManager;
use super::browse::{self, FolderInfo, FolderListing};
use super::models::{Project, ProjectView};
use super::recents::RecentProjectInfo;

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

/// One folder's visible subfolders, with git state, for the Open Project dialog.
#[tauri::command]
pub async fn list_folder(path: String) -> Result<FolderListing, String> {
    tokio::task::spawn_blocking(move || browse::list_folder(&path))
        .await
        .map_err(|e| format!("Task join error: {}", e))?
}

/// Whether `path` is a folder, and its git state, for the Open Project path bar.
#[tauri::command]
pub async fn inspect_folder(path: String) -> Result<FolderInfo, String> {
    tokio::task::spawn_blocking(move || browse::inspect_folder(&path))
        .await
        .map_err(|e| format!("Task join error: {}", e))
}

#[derive(serde::Serialize)]
pub struct OpenProjectPlaces {
    pub home: Option<String>,
    pub drives: Vec<String>,
}

/// The home folder and drive roots for the Open Project sidebar.
#[tauri::command]
pub async fn open_project_places() -> Result<OpenProjectPlaces, String> {
    Ok(OpenProjectPlaces { home: browse::home_folder(), drives: browse::drives() })
}

/// Recently opened projects, newest first, with each folder's current git state.
#[tauri::command]
pub async fn list_recent_projects(
    manager: State<'_, WorkspaceManager>,
) -> Result<Vec<RecentProjectInfo>, String> {
    let recent = manager.list_recent_projects();
    tokio::task::spawn_blocking(move || {
        recent
            .into_iter()
            .map(|r| {
                let info = browse::inspect_folder(&r.path);
                RecentProjectInfo {
                    path: r.path,
                    name: r.name,
                    last_opened: r.last_opened,
                    exists: info.exists,
                    is_git: info.is_git,
                    branch: info.branch,
                }
            })
            .collect()
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))
}
