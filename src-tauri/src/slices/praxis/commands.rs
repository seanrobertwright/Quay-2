use std::path::PathBuf;

use tauri::State;

use super::models::{DefinitionFile, DefinitionList, LayoutInput, PraxisKind, SaveOutcome};
use super::store;
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

/// Saves one definition in its canonical form, and a graph's layout. Nothing is written
/// when the file no longer has `expectedHash` (the hash the draft loaded) unless `force`
/// is set; `expectedHash` is null for a definition that has never been saved.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn praxis_save(
    project_path: String,
    kind: PraxisKind,
    id: String,
    content: serde_json::Value,
    layout: Option<LayoutInput>,
    expected_hash: Option<String>,
    force: bool,
    workspace: State<'_, WorkspaceManager>,
) -> Result<SaveOutcome, String> {
    let workspace = workspace.inner().clone();
    blocking(move || {
        let repo = project_root(&workspace, &project_path)?;
        store::save_definition(&repo, kind, &id, content, layout.as_ref(), expected_hash.as_deref(), force)
    })
    .await
}
