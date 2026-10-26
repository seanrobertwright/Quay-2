use std::path::PathBuf;

use tauri::State;

use super::models::{DefinitionFile, DefinitionList, PraxisKind};
use super::store;
use super::validate::{self, Validation};
use crate::slices::workspace::WorkspaceManager;

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| format!("Praxis task failed: {}", e))?
}

/// The canonical root of `project_path`, which must be a registered project or a git
/// worktree of one.
fn project_root(workspace: &WorkspaceManager, project_path: &str) -> Result<PathBuf, String> {
    let registered: Vec<String> = workspace.list_projects().into_iter().map(|p| p.path).collect();
    store::resolve_project(project_path, &registered)
}

/// Lists one kind's definitions in `<projectPath>/.praxis/<kind>/`.
#[tauri::command]
pub async fn praxis_list(
    project_path: String,
    kind: PraxisKind,
    workspace: State<'_, WorkspaceManager>,
) -> Result<DefinitionList, String> {
    let workspace = workspace.inner().clone();
    blocking(move || store::list_definitions(&project_root(&workspace, &project_path)?, kind)).await
}

/// Reads one definition, and a graph's layout file.
#[tauri::command]
pub async fn praxis_read(
    project_path: String,
    kind: PraxisKind,
    id: String,
    workspace: State<'_, WorkspaceManager>,
) -> Result<DefinitionFile, String> {
    let workspace = workspace.inner().clone();
    blocking(move || store::read_definition(&project_root(&workspace, &project_path)?, kind, &id)).await
}

/// Validates a definition's content offline with the vendored AI-WS-SDK, reporting every
/// issue with its location. The content is passed in, not read from disk, so an unsaved
/// draft can be checked.
#[tauri::command]
pub async fn praxis_validate(kind: PraxisKind, content: serde_json::Value) -> Result<Validation, String> {
    blocking(move || validate::validate_definition(kind, &content)).await
}

/// Shows a definition file in the system file manager.
#[tauri::command]
pub async fn praxis_reveal(
    project_path: String,
    kind: PraxisKind,
    id: String,
    workspace: State<'_, WorkspaceManager>,
) -> Result<(), String> {
    let workspace = workspace.inner().clone();
    blocking(move || {
        let path = store::definition_path(&project_root(&workspace, &project_path)?, kind, &id)?;
        tauri_plugin_opener::reveal_item_in_dir(&path)
            .map_err(|e| format!("Could not reveal {}: {}", path.display(), e))
    })
    .await
}
