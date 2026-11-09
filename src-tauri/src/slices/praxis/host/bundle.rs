//! A graph workflow's bundle as `praxis graphs check` and `submit` take it (#444, #460): the
//! paths of the saved files its record names, the graph, the graph binding and the contract, and
//! of each grant its contract's bindings file lists. Only saved files go, so an unsaved draft
//! never does, and `praxis` reads each file itself.

use std::path::Path;

use serde_json::Value;

use crate::slices::praxis::graph_workflow::validate_graph_workflow;
use crate::slices::praxis::models::PraxisKind;
use crate::slices::praxis::store::{definition_path, display_path, read_record, BINDINGS_DIR, PRAXIS_DIR};
use crate::slices::praxis::template_name::check_graph_workflow_name;
use crate::slices::praxis::validate::Severity;

/// The most grants a bundle carries, the host's limit (AI-WS-SDK `GRAPH-WORKFLOWS.md`, "Bundle").
pub const MAX_BUNDLE_GRANTS: usize = 64;

/// The path of the saved `kind` record `id`, as `praxis` is given it.
fn path_of(repo: &Path, kind: PraxisKind, id: &str) -> Result<String, String> {
    display_path(&definition_path(repo, kind, id)?)
}

/// The operands of `praxis graphs check` and `submit` for the graph workflow `name` saved in
/// `repo`: its name, then `--graph`, `--binding` and `--contract` with the paths of the records
/// it names, then `--grant` with the path of each grant, in the order the contract's bindings
/// file lists them. Refused, naming what is missing, when the name breaks the host's rule, the
/// graph workflow or a record it names isn't saved, its shape isn't valid, or its contract's
/// bindings file lists no grant or more than [`MAX_BUNDLE_GRANTS`].
pub fn bundle_operands(repo: &Path, name: &str) -> Result<Vec<String>, String> {
    check_graph_workflow_name(name)?;
    let folder = PraxisKind::GraphWorkflows.folder();
    let workflow = read_record(repo, folder, name)?.ok_or_else(|| format!("{PRAXIS_DIR}/{folder}/{name}.json doesn't exist."))?;
    let shape = validate_graph_workflow(&workflow);
    if shape.verdict.is_some() {
        let why = shape.diagnostics.iter().find(|d| d.severity == Severity::Error).map_or("", |d| d.message.as_str());
        return Err(format!("Graph workflow {name} isn't valid: {why}").trim_end_matches(": ").to_string());
    }
    let id = |field: &str| workflow.get(field).and_then(Value::as_str).unwrap_or_default().to_string();
    let contract = id("contractId");
    let bindings = read_record(repo, BINDINGS_DIR, &contract)?
        .ok_or_else(|| format!("Contract {contract} has no bindings file, so graph workflow {name} carries no grants."))?;
    let grants: Vec<&str> = bindings.get("grants").and_then(Value::as_array).map(|g| g.iter().filter_map(Value::as_str).collect()).unwrap_or_default();
    if grants.is_empty() {
        return Err(format!("Contract {contract}'s bindings file lists no grants, and a graph workflow carries at least one."));
    }
    if grants.len() > MAX_BUNDLE_GRANTS {
        return Err(format!(
            "Contract {contract}'s bindings file lists {} grants, and a graph workflow carries at most {MAX_BUNDLE_GRANTS}.",
            grants.len()
        ));
    }
    let mut operands = vec![
        name.to_string(),
        "--graph".into(),
        path_of(repo, PraxisKind::Graphs, &id("graphId"))?,
        "--binding".into(),
        path_of(repo, PraxisKind::GraphBindings, &id("graphBindingId"))?,
        "--contract".into(),
        path_of(repo, PraxisKind::Contracts, &contract)?,
    ];
    for grant in grants {
        operands.push("--grant".into());
        operands.push(path_of(repo, PraxisKind::Grants, grant)?);
    }
    Ok(operands)
}
