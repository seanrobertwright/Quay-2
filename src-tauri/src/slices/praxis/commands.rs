use std::path::PathBuf;

use tauri::State;

use super::binding_attach::{self, BindingAttach};
use super::changes;
use super::context;
use super::grants;
use super::graph_bindings;
use super::graph_workflow::{self, GraphWorkflowCheck};
use super::host::{self, graph_workflow_bundle, GraphWorkflowBundle};
use super::lifecycle;
use super::models::{
    BindingSuggestions, BindingsInput, BundleChanges, ChangedFiles, ContextCheck, ContractTriggers, DefinitionFile, DefinitionList, DeleteOutcome, DraftContent,
    FileDiff, GrantCheck, GraphPin, LayoutInput, PraxisKind, RecordRef, RenameOutcome, SaveOutcome, TargetInput,
};
use super::store;
use super::trigger_target::{self, GraphWorkflowTriggers, TriggerTargetCheck};
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

/// Reads one definition, and a graph's layout file, a contract's bindings file or a trigger's
/// target file.
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
/// draft can be checked. A graph binding is also checked against `graph`, the content of its
/// graph's draft, when it is given (#273).
#[tauri::command]
pub async fn praxis_validate(
    kind: PraxisKind,
    content: serde_json::Value,
    graph: Option<serde_json::Value>,
) -> Result<Validation, String> {
    blocking(move || match (kind, graph) {
        (PraxisKind::GraphBindings, Some(graph)) => {
            validate::check_size(&content)?;
            validate::check_size(&graph)?;
            Ok(graph_bindings::validate_graph_binding(&content, Some(&graph)))
        }
        _ => validate::validate_definition(kind, &content),
    })
    .await
}

/// The pin of the graph `graphId` as saved on disk (#247): its revision and SDK digest, which
/// a binding's `graphRevision` and `graphDigest` are compared with to tell it is Stale, and
/// which Retarget to current graph copies into it. `None` when the graph isn't saved.
#[tauri::command]
pub async fn praxis_graph_pin(
    project_path: String,
    graph_id: String,
    workspace: State<'_, WorkspaceManager>,
) -> Result<Option<GraphPin>, String> {
    let workspace = workspace.inner().clone();
    blocking(move || graph_bindings::graph_pin(&project_root(&workspace, &project_path)?, &graph_id)).await
}

/// The attach checks of a graph binding (#274), with `content` as the binding and `graph` as its
/// graph's draft, so unsaved drafts are checked, against each saved contract whose bindings list
/// the graph: its limits, cost unit and criteria, and the coverage table of those criteria.
#[tauri::command]
pub async fn praxis_check_binding(
    project_path: String,
    content: serde_json::Value,
    graph: serde_json::Value,
    workspace: State<'_, WorkspaceManager>,
) -> Result<BindingAttach, String> {
    let workspace = workspace.inner().clone();
    blocking(move || {
        validate::check_size(&content)?;
        validate::check_size(&graph)?;
        binding_attach::check_attach(&project_root(&workspace, &project_path)?, &content, &graph)
    })
    .await
}

/// A graph workflow's local checks (#459), with `content` as its draft, against the contract,
/// graph and graph binding it names as saved on disk, and the grants its contract's bindings
/// file lists, which it carries.
#[tauri::command]
pub async fn praxis_check_graph_workflow(
    project_path: String,
    content: serde_json::Value,
    workspace: State<'_, WorkspaceManager>,
) -> Result<GraphWorkflowCheck, String> {
    let workspace = workspace.inner().clone();
    blocking(move || graph_workflow::check_graph_workflow(&project_root(&workspace, &project_path)?, &content)).await
}

/// The saved files graph workflow `name` submits (#462), as `praxis graphs submit` is given them,
/// each with the name a host finding gives it, its record digest and its git change, for the
/// Submit confirm and the findings' links. Refused as the submission's bundle is.
#[tauri::command]
pub async fn praxis_graph_workflow_bundle(
    project_path: String,
    name: String,
    workspace: State<'_, WorkspaceManager>,
) -> Result<GraphWorkflowBundle, String> {
    let workspace = workspace.inner().clone();
    blocking(move || graph_workflow_bundle(&project_root(&workspace, &project_path)?, &name)).await
}

/// A trigger's checks as a graph trigger (#472), with `content` as its draft and `target` the
/// graph workflow it starts: the Praxis host's graph trigger rules, and its contract against the
/// target's as saved. A trigger without a target gets none of them.
#[tauri::command]
pub async fn praxis_check_trigger(
    project_path: String,
    content: serde_json::Value,
    target: Option<String>,
    workspace: State<'_, WorkspaceManager>,
) -> Result<TriggerTargetCheck, String> {
    let workspace = workspace.inner().clone();
    blocking(move || trigger_target::check_trigger_target(&project_root(&workspace, &project_path)?, &content, target.as_deref())).await
}

/// The triggers whose saved target file names the graph workflow `graphWorkflowId` (#479), for the
/// graph workflow form's Triggers section.
#[tauri::command]
pub async fn praxis_graph_workflow_triggers(
    project_path: String,
    graph_workflow_id: String,
    workspace: State<'_, WorkspaceManager>,
) -> Result<GraphWorkflowTriggers, String> {
    let workspace = workspace.inner().clone();
    blocking(move || trigger_target::graph_workflow_triggers(&project_root(&workspace, &project_path)?, &graph_workflow_id)).await
}

/// The ids used across the project's saved graph bindings, and the agents of its saved workflow
/// templates (#247), which the Runs as section suggests for its agent, protocol-binding, action
/// and resource fields.
#[tauri::command]
pub async fn praxis_binding_suggestions(
    project_path: String,
    workspace: State<'_, WorkspaceManager>,
) -> Result<BindingSuggestions, String> {
    let workspace = workspace.inner().clone();
    blocking(move || graph_bindings::binding_suggestions(&project_root(&workspace, &project_path)?)).await
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

/// The absolute path of an existing definition file, for "Install on host…" to show and copy.
#[tauri::command]
pub async fn praxis_path(
    project_path: String,
    kind: PraxisKind,
    id: String,
    workspace: State<'_, WorkspaceManager>,
) -> Result<String, String> {
    let workspace = workspace.inner().clone();
    blocking(move || {
        let path = store::definition_path(&project_root(&workspace, &project_path)?, kind, &id)?;
        store::display_path(&path)
    })
    .await
}

/// Saves one definition in its canonical form, and a graph's layout, a contract's bindings or
/// a trigger's target (#472). Nothing is written when the file no longer has `expectedHash` (the
/// hash the draft loaded), or a contract's bindings file no longer has `expectedBindingsHash`, or
/// a trigger's target file no longer has `expectedTargetHash`, unless `force` is set;
/// `expectedHash` is null for a definition that has never been saved. A trigger saved without
/// `target` leaves its target file as it is.
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
    target: Option<TargetInput>,
    expected_target_hash: Option<String>,
    force: bool,
    workspace: State<'_, WorkspaceManager>,
) -> Result<SaveOutcome, String> {
    let workspace = workspace.inner().clone();
    blocking(move || {
        let repo = project_root(&workspace, &project_path)?;
        if let (PraxisKind::Triggers, Some(target)) = (kind, &target) {
            let (expected, expected_target) = (expected_hash.as_deref(), expected_target_hash.as_deref());
            return store::save_trigger_with_target(&repo, &id, content, target, expected, expected_target, force);
        }
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

/// Checks contracts across records (#223, #269): a scratch mission per contract, from the saved
/// contract, its bound grants and graphs and the triggers that name it. With `record` it checks
/// only the contracts that record affects, plus those in `also`; without, every contract.
#[tauri::command]
pub async fn praxis_check_context(
    project_path: String,
    record: Option<RecordRef>,
    also: Vec<String>,
    workspace: State<'_, WorkspaceManager>,
) -> Result<ContextCheck, String> {
    let workspace = workspace.inner().clone();
    blocking(move || context::check_context(&project_root(&workspace, &project_path)?, record.as_ref(), &also)).await
}

/// The contracts, grants, templates and graph bindings whose files have changed since the last commit (#223), for the
/// list's badge. Empty for a project that isn't a git repository.
#[tauri::command]
pub async fn praxis_changes(project_path: String, workspace: State<'_, WorkspaceManager>) -> Result<ChangedFiles, String> {
    let workspace = workspace.inner().clone();
    blocking(move || changes::changed_files(&project_root(&workspace, &project_path)?)).await
}

/// The files of graph workflow `name`'s bundle that have changed since the last commit, for a graph
/// run's confirm (#466). See [`host::bundle_changes`].
#[tauri::command]
pub async fn praxis_graph_workflow_changes(project_path: String, name: String, workspace: State<'_, WorkspaceManager>) -> Result<BundleChanges, String> {
    let workspace = workspace.inner().clone();
    blocking(move || Ok(BundleChanges { files: host::bundle_changes(&project_root(&workspace, &project_path)?, &name)? })).await
}

/// The diff of one contract, grant, template or graph binding file against the last commit, for the badge's diff view.
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
