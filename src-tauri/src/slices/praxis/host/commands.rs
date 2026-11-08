//! The Tauri commands for the Praxis CLI runner (#446). They are Quay's UI's only way to it:
//! none is reachable through the MCP bridge or A2A (#228). Each one that calls `praxis` takes a
//! registered project, whose host condition it updates, and a `callId` that
//! [`praxis_host_cancel`] cancels. A template or graph workflow name that the host refuses comes
//! back as a refusal from [`PraxisCli::call`], which never runs `praxis` with it. The graph
//! commands (#460) go through the same runner, so they share its bounds, its sharing of
//! identical calls in flight and its host condition.

use std::path::{Path, PathBuf};

use serde::Deserialize;
use tauri::State;
use uuid::Uuid;

use super::bundle::bundle_operands;
use super::outcome::{CallOutcome, HostCondition, Verb};
use super::runner::PraxisCli;
use super::settings::PraxisCliSettings;
use crate::slices::praxis::template_name::check_graph_workflow_name;
use crate::slices::workspace::WorkspaceManager;

/// The most runs `praxis runs --limit` lists.
pub const MAX_RUNS_LIMIT: u32 = 100;

/// Refuses a run that breaks `praxis`'s run grammar: a letter or digit, then letters, digits,
/// `.`, `_`, `:` or `-`, at most 256 characters (`runIdPattern` at the SDK pin).
pub fn check_run_arg(work_order_id: &str) -> Result<(), String> {
    let mut chars = work_order_id.chars();
    let ok = work_order_id.len() <= 256
        && chars.next().is_some_and(|c| c.is_ascii_alphanumeric())
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | ':' | '-'));
    if ok { Ok(()) } else { Err(format!("{work_order_id:?} isn't a run praxis can be given.")) }
}

/// Refuses a `--limit` outside 1 to [`MAX_RUNS_LIMIT`].
pub fn check_runs_limit(limit: u32) -> Result<(), String> {
    if (1..=MAX_RUNS_LIMIT).contains(&limit) { Ok(()) } else { Err(format!("The run limit must be from 1 to {MAX_RUNS_LIMIT}, not {limit}.")) }
}

/// The most graph workflows or revisions `praxis graphs list` and `graphs show --before` give
/// on a page.
pub const MAX_PAGE_LIMIT: u32 = 100;

/// Refuses a page `--limit` outside 1 to [`MAX_PAGE_LIMIT`].
pub fn check_page_limit(limit: u32) -> Result<(), String> {
    if (1..=MAX_PAGE_LIMIT).contains(&limit) { Ok(()) } else { Err(format!("The limit must be from 1 to {MAX_PAGE_LIMIT}, not {limit}.")) }
}

/// Refuses a graph workflow revision `praxis` wouldn't take: revisions count from 1.
pub fn check_revision(revision: u32) -> Result<(), String> {
    if revision >= 1 { Ok(()) } else { Err(format!("A revision is a whole number from 1, not {revision}.")) }
}

/// `--request-id <id>`, when a caller resends a write whose outcome was unknown.
fn request_id_operands(request_id: Option<Uuid>) -> Vec<String> {
    request_id.map(|id| vec!["--request-id".to_string(), id.to_string()]).unwrap_or_default()
}

fn project_root(workspace: &WorkspaceManager, project_path: &str) -> Result<PathBuf, String> {
    let registered: Vec<String> = workspace.list_projects().into_iter().map(|p| p.path).collect();
    crate::slices::praxis::store::resolve_project(project_path, &registered)
}

async fn call(
    cli: &PraxisCli,
    workspace: &WorkspaceManager,
    project_path: &str,
    verb: Verb,
    operands: Vec<String>,
    call_id: Uuid,
) -> Result<CallOutcome, String> {
    call_with(cli, workspace, project_path, verb, call_id, move |_| Ok(operands)).await
}

/// Runs `verb` with the operands `operands` makes from the project's root, off the async
/// runtime. Operands it refuses come back as a refusal, and nothing runs.
async fn call_with(
    cli: &PraxisCli,
    workspace: &WorkspaceManager,
    project_path: &str,
    verb: Verb,
    call_id: Uuid,
    operands: impl FnOnce(&Path) -> Result<Vec<String>, String> + Send + 'static,
) -> Result<CallOutcome, String> {
    let root = project_root(workspace, project_path)?;
    let cli = cli.clone();
    tokio::task::spawn_blocking(move || match operands(&root) {
        Ok(operands) => cli.call(&root, verb, &verb.args(operands), call_id),
        Err(message) => CallOutcome::Refused { message },
    })
    .await
    .map_err(|e| format!("The praxis call failed: {e}"))
}

/// `praxis workflows list --json`: the host's template catalog.
#[tauri::command]
pub async fn praxis_host_workflows_list(
    project_path: String,
    call_id: Uuid,
    cli: State<'_, PraxisCli>,
    workspace: State<'_, WorkspaceManager>,
) -> Result<CallOutcome, String> {
    call(&cli, &workspace, &project_path, Verb::WorkflowsList, vec![], call_id).await
}

/// `praxis workflows show <name> --json`: one template's detail, with fresh readiness.
#[tauri::command]
pub async fn praxis_host_workflow_show(
    project_path: String,
    name: String,
    call_id: Uuid,
    cli: State<'_, PraxisCli>,
    workspace: State<'_, WorkspaceManager>,
) -> Result<CallOutcome, String> {
    call(&cli, &workspace, &project_path, Verb::WorkflowsShow, vec![name], call_id).await
}

/// `praxis runs <name> --limit <limit> --json`: the template's recent runs, newest first.
#[tauri::command]
pub async fn praxis_host_runs(
    project_path: String,
    name: String,
    limit: u32,
    call_id: Uuid,
    cli: State<'_, PraxisCli>,
    workspace: State<'_, WorkspaceManager>,
) -> Result<CallOutcome, String> {
    check_runs_limit(limit)?;
    call(&cli, &workspace, &project_path, Verb::Runs, vec![name, "--limit".into(), limit.to_string()], call_id).await
}

/// `praxis status <workOrderId> --json`: one run's operator view.
#[tauri::command]
pub async fn praxis_host_status(
    project_path: String,
    work_order_id: String,
    call_id: Uuid,
    cli: State<'_, PraxisCli>,
    workspace: State<'_, WorkspaceManager>,
) -> Result<CallOutcome, String> {
    check_run_arg(&work_order_id)?;
    call(&cli, &workspace, &project_path, Verb::Status, vec![work_order_id], call_id).await
}

/// `praxis run <name> --json`: creates a run of the host's installed copy. A repeat while one is
/// in flight joins it. A creation cancelled or timed out after its request was sent stays pending
/// in the `praxis` profile, and the next `run` of the name resumes it rather than creating a
/// second run (#362).
#[tauri::command]
pub async fn praxis_host_run(
    project_path: String,
    name: String,
    call_id: Uuid,
    cli: State<'_, PraxisCli>,
    workspace: State<'_, WorkspaceManager>,
) -> Result<CallOutcome, String> {
    call(&cli, &workspace, &project_path, Verb::Run, vec![name], call_id).await
}

/// `praxis graphs check <name> <bundle> --json`: the host's checks of the graph workflow's
/// saved bundle, which write nothing. See [`bundle_operands`] for the bundle.
#[tauri::command]
pub async fn praxis_host_graph_check(
    project_path: String,
    name: String,
    call_id: Uuid,
    cli: State<'_, PraxisCli>,
    workspace: State<'_, WorkspaceManager>,
) -> Result<CallOutcome, String> {
    call_with(&cli, &workspace, &project_path, Verb::GraphsCheck, call_id, move |root| bundle_operands(root, &name)).await
}

/// `praxis graphs submit <name> <bundle> --json`: submits the graph workflow's saved bundle as a
/// candidate, based on `base_revision` when given. `request_id` resends a submission whose
/// outcome was unknown; without it `praxis` makes one, and a repeat while one is in flight joins it.
#[tauri::command]
pub async fn praxis_host_graph_submit(
    project_path: String,
    name: String,
    base_revision: Option<u32>,
    request_id: Option<Uuid>,
    call_id: Uuid,
    cli: State<'_, PraxisCli>,
    workspace: State<'_, WorkspaceManager>,
) -> Result<CallOutcome, String> {
    if let Some(base) = base_revision {
        check_revision(base)?;
    }
    call_with(&cli, &workspace, &project_path, Verb::GraphsSubmit, call_id, move |root| {
        let mut operands = bundle_operands(root, &name)?;
        if let Some(base) = base_revision {
            operands.extend(["--base".to_string(), base.to_string()]);
        }
        operands.extend(request_id_operands(request_id));
        Ok(operands)
    })
    .await
}

/// `praxis graphs list --limit <limit> [--after <name>] --json`: the host's graph workflows in
/// name order, the page after `after` when given.
#[tauri::command]
pub async fn praxis_host_graphs_list(
    project_path: String,
    limit: u32,
    after: Option<String>,
    call_id: Uuid,
    cli: State<'_, PraxisCli>,
    workspace: State<'_, WorkspaceManager>,
) -> Result<CallOutcome, String> {
    check_page_limit(limit)?;
    let mut operands = vec!["--limit".to_string(), limit.to_string()];
    if let Some(after) = after {
        check_graph_workflow_name(&after)?;
        operands.extend(["--after".to_string(), after]);
    }
    call(&cli, &workspace, &project_path, Verb::GraphsList, operands, call_id).await
}

/// `praxis graphs show <name> --json`: one graph workflow, its newest revisions and their status.
#[tauri::command]
pub async fn praxis_host_graph_show(
    project_path: String,
    name: String,
    call_id: Uuid,
    cli: State<'_, PraxisCli>,
    workspace: State<'_, WorkspaceManager>,
) -> Result<CallOutcome, String> {
    call(&cli, &workspace, &project_path, Verb::GraphsShow, vec![name], call_id).await
}

/// `praxis graphs show <name> --before <before> --limit <limit> --json`: the revisions older
/// than `before`, newest first.
#[tauri::command]
pub async fn praxis_host_graph_revisions(
    project_path: String,
    name: String,
    before: u32,
    limit: u32,
    call_id: Uuid,
    cli: State<'_, PraxisCli>,
    workspace: State<'_, WorkspaceManager>,
) -> Result<CallOutcome, String> {
    check_revision(before)?;
    check_page_limit(limit)?;
    let operands = vec![name, "--before".into(), before.to_string(), "--limit".into(), limit.to_string()];
    call(&cli, &workspace, &project_path, Verb::GraphsRevisions, operands, call_id).await
}

/// `praxis graphs withdraw <name> <revision> --json`: withdraws a pending candidate.
/// `request_id` resends a withdrawal whose outcome was unknown.
#[tauri::command]
pub async fn praxis_host_graph_withdraw(
    project_path: String,
    name: String,
    revision: u32,
    request_id: Option<Uuid>,
    call_id: Uuid,
    cli: State<'_, PraxisCli>,
    workspace: State<'_, WorkspaceManager>,
) -> Result<CallOutcome, String> {
    check_revision(revision)?;
    let mut operands = vec![name, revision.to_string()];
    operands.extend(request_id_operands(request_id));
    call(&cli, &workspace, &project_path, Verb::GraphsWithdraw, operands, call_id).await
}

/// `praxis run <name> --json` for a graph workflow: creates a run of its current admitted
/// revision, waiting for approval. A repeat while one is in flight joins it, and a creation left
/// pending is resumed by the next, as for a template run.
#[tauri::command]
pub async fn praxis_host_graph_run(
    project_path: String,
    name: String,
    call_id: Uuid,
    cli: State<'_, PraxisCli>,
    workspace: State<'_, WorkspaceManager>,
) -> Result<CallOutcome, String> {
    call(&cli, &workspace, &project_path, Verb::GraphRun, vec![name], call_id).await
}

/// `praxis runs <name> --limit <limit> --format aiws-graph-runs/1 --json`: the graph workflow's
/// recent runs of every revision, newest first.
#[tauri::command]
pub async fn praxis_host_graph_runs(
    project_path: String,
    name: String,
    limit: u32,
    call_id: Uuid,
    cli: State<'_, PraxisCli>,
    workspace: State<'_, WorkspaceManager>,
) -> Result<CallOutcome, String> {
    check_runs_limit(limit)?;
    call(&cli, &workspace, &project_path, Verb::GraphRuns, vec![name, "--limit".into(), limit.to_string()], call_id).await
}

/// `praxis status <workOrderId> --format aiws-graph-operator-view/1 --json`: one graph run's
/// operator view.
#[tauri::command]
pub async fn praxis_host_graph_status(
    project_path: String,
    work_order_id: String,
    call_id: Uuid,
    cli: State<'_, PraxisCli>,
    workspace: State<'_, WorkspaceManager>,
) -> Result<CallOutcome, String> {
    check_run_arg(&work_order_id)?;
    call(&cli, &workspace, &project_path, Verb::GraphStatus, vec![work_order_id], call_id).await
}

/// Cancels a call. See [`PraxisCli::cancel`].
#[tauri::command]
pub fn praxis_host_cancel(call_id: Uuid, cli: State<'_, PraxisCli>) {
    cli.cancel(call_id)
}

/// The project's host condition, as the last call for it left it.
#[tauri::command]
pub fn praxis_host_condition(
    project_path: String,
    cli: State<'_, PraxisCli>,
    workspace: State<'_, WorkspaceManager>,
) -> Result<HostCondition, String> {
    Ok(cli.condition(&project_root(&workspace, &project_path)?))
}

#[tauri::command]
pub fn praxis_cli_settings_read(cli: State<'_, PraxisCli>) -> PraxisCliSettings {
    cli.settings()
}

/// Checks and stores the settings, refusing a bad folder with a message naming it.
#[tauri::command]
pub async fn praxis_cli_settings_write(settings: PraxisCliSettings, cli: State<'_, PraxisCli>) -> Result<PraxisCliSettings, String> {
    let cli = cli.inner().clone();
    tokio::task::spawn_blocking(move || cli.write_settings(settings)).await.map_err(|e| format!("Couldn't save the Praxis settings: {e}"))?
}

/// The `praxis` commands that need a person at a terminal. Quay never runs them headless.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum InteractiveCommand {
    Serve,
    Setup,
    Login,
    Trust,
}

impl InteractiveCommand {
    fn verb(self) -> &'static str {
        match self {
            InteractiveCommand::Serve => "serve",
            InteractiveCommand::Setup => "setup",
            InteractiveCommand::Login => "login",
            InteractiveCommand::Trust => "trust",
        }
    }
}

/// The command line a visible terminal types to run `command`: the same `node <script>` the
/// headless calls use, with `--state` when an installation is set, and never a flag that skips
/// a confirmation.
pub fn interactive_argv(cli: &PraxisCli, command: InteractiveCommand) -> Result<Vec<String>, String> {
    let (launch, state) = cli.launch()?;
    let mut argv = vec![launch.node.to_string_lossy().into_owned(), launch.script.to_string_lossy().into_owned(), command.verb().to_string()];
    if let Some(state) = state {
        argv.push("--state".into());
        argv.push(state.to_string_lossy().into_owned());
    }
    Ok(argv)
}

/// See [`interactive_argv`].
#[tauri::command]
pub async fn praxis_host_terminal_argv(command: InteractiveCommand, cli: State<'_, PraxisCli>) -> Result<Vec<String>, String> {
    let cli = cli.inner().clone();
    tokio::task::spawn_blocking(move || interactive_argv(&cli, command)).await.map_err(|e| format!("Couldn't find praxis: {e}"))?
}
