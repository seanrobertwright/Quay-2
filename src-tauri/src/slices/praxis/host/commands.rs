//! The Tauri commands for the Praxis CLI runner (#446). They are Quay's UI's only way to it:
//! none is reachable through the MCP bridge or A2A (#228). Each one that calls `praxis` takes a
//! registered project, whose host condition it updates, and a `callId` that
//! [`praxis_host_cancel`] cancels. A template name that breaks the host's rule comes back as a
//! refusal from [`PraxisCli::call`], which never runs `praxis` with it.

use std::path::PathBuf;

use serde::Deserialize;
use tauri::State;
use uuid::Uuid;

use super::outcome::{CallOutcome, HostCondition, Verb};
use super::runner::PraxisCli;
use super::settings::PraxisCliSettings;
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

fn project_root(workspace: &WorkspaceManager, project_path: &str) -> Result<PathBuf, String> {
    let registered: Vec<String> = workspace.list_projects().into_iter().map(|p| p.path).collect();
    crate::slices::praxis::store::resolve_project(project_path, &registered)
}

async fn call(
    cli: &PraxisCli,
    workspace: &WorkspaceManager,
    project_path: &str,
    verb: Verb,
    args: Vec<String>,
    call_id: Uuid,
) -> Result<CallOutcome, String> {
    let root = project_root(workspace, project_path)?;
    let cli = cli.clone();
    tokio::task::spawn_blocking(move || cli.call(&root, verb, &args, call_id))
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
    call(&cli, &workspace, &project_path, Verb::WorkflowsList, vec!["workflows".into(), "list".into()], call_id).await
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
    call(&cli, &workspace, &project_path, Verb::WorkflowsShow, vec!["workflows".into(), "show".into(), name], call_id).await
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
    call(&cli, &workspace, &project_path, Verb::Runs, vec!["runs".into(), name, "--limit".into(), limit.to_string()], call_id).await
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
    call(&cli, &workspace, &project_path, Verb::Status, vec!["status".into(), work_order_id], call_id).await
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
    call(&cli, &workspace, &project_path, Verb::Run, vec!["run".into(), name], call_id).await
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
