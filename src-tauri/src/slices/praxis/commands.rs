use std::path::PathBuf;

use tauri::State;

use super::changes;
use super::grants;
use super::lifecycle;
use super::models::{
    BindingsInput, ChangedFiles, ContractTriggers, DefinitionFile, DefinitionList, DeleteOutcome, DraftContent, FileDiff,
    GrantCheck, LayoutInput, PraxisKind, RenameOutcome, SaveOutcome,
};
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

/// Reads one definition, and a graph's layout file or a contract's bindings file.
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

/// Saves one definition in its canonical form, and a graph's layout or a contract's
/// bindings. Nothing is written when the file no longer has `expectedHash` (the hash the
/// draft loaded), or a contract's bindings file no longer has `expectedBindingsHash`, unless
/// `force` is set; `expectedHash` is null for a definition that has never been saved.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn praxis_save(
    project_path: String,
    kind: PraxisKind,
    id: String,
    content: serde_json::Value,
    layout: Option<LayoutInput>,
    bindings: Option<BindingsInput>,
    expected_hash: Option<String>,
    expected_bindings_hash: Option<String>,
    force: bool,
    workspace: State<'_, WorkspaceManager>,
) -> Result<SaveOutcome, String> {
    let workspace = workspace.inner().clone();
    blocking(move || {
        let repo = project_root(&workspace, &project_path)?;
        store::save_definition(
            &repo,
            kind,
            &id,
            content,
            layout.as_ref(),
            bindings.as_ref(),
            expected_hash.as_deref(),
            expected_bindings_hash.as_deref(),
            force,
        )
    })
    .await
}

/// The triggers whose `contractId` names the contract `contractId`, for the contract form.
#[tauri::command]
pub async fn praxis_contract_triggers(
    project_path: String,
    contract_id: String,
    workspace: State<'_, WorkspaceManager>,
) -> Result<ContractTriggers, String> {
    let workspace = workspace.inner().clone();
    blocking(move || store::contract_triggers(&project_root(&workspace, &project_path)?, &contract_id)).await
}

/// Checks the grant `id`, with `content` as its record so an unsaved draft is checked, against
/// the saved records around it: its delegation chain, and a scratch mission under each
/// contract whose bindings list it (#223, #231).
#[tauri::command]
pub async fn praxis_check_grant(
    project_path: String,
    id: String,
    content: serde_json::Value,
    workspace: State<'_, WorkspaceManager>,
) -> Result<GrantCheck, String> {
    let workspace = workspace.inner().clone();
    blocking(move || {
        validate::check_size(&content)?;
        grants::check_grant(&project_root(&workspace, &project_path)?, &id, &content)
    })
    .await
}

/// The contracts and grants whose files have changed since the last commit (#223), for the
/// list's badge. Empty for a project that isn't a git repository.
#[tauri::command]
pub async fn praxis_changes(project_path: String, workspace: State<'_, WorkspaceManager>) -> Result<ChangedFiles, String> {
    let workspace = workspace.inner().clone();
    blocking(move || changes::changed_files(&project_root(&workspace, &project_path)?)).await
}

/// The diff of one contract or grant file against the last commit, for the badge's diff view.
#[tauri::command]
pub async fn praxis_diff(
    project_path: String,
    kind: PraxisKind,
    id: String,
    workspace: State<'_, WorkspaceManager>,
) -> Result<FileDiff, String> {
    let workspace = workspace.inner().clone();
    blocking(move || changes::file_diff(&project_root(&workspace, &project_path)?, kind, &id)).await
}

/// Renames a definition to `newId`, moving the files that belong to it and rewriting the
/// references other files and `drafts` hold, through the registered hooks. With `dryRun`
/// it only reports what it would do, for the confirmation.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn praxis_rename(
    project_path: String,
    kind: PraxisKind,
    id: String,
    new_id: String,
    drafts: Vec<DraftContent>,
    dry_run: bool,
    workspace: State<'_, WorkspaceManager>,
) -> Result<RenameOutcome, String> {
    let workspace = workspace.inner().clone();
    blocking(move || {
        let repo = project_root(&workspace, &project_path)?;
        lifecycle::rename_definition(&repo, kind, &id, &new_id, &drafts, dry_run, lifecycle::HOOKS)
    })
    .await
}

/// Moves a definition, and the files that belong to it, to the Recycle Bin or Trash. With
/// `dryRun` it only reports what it would move and what refers to it, for the confirmation.
#[tauri::command]
pub async fn praxis_delete(
    project_path: String,
    kind: PraxisKind,
    id: String,
    dry_run: bool,
    workspace: State<'_, WorkspaceManager>,
) -> Result<DeleteOutcome, String> {
    let workspace = workspace.inner().clone();
    blocking(move || {
        let repo = project_root(&workspace, &project_path)?;
        lifecycle::delete_definition(&repo, kind, &id, dry_run, lifecycle::HOOKS, &lifecycle::move_to_trash)
    })
    .await
}
