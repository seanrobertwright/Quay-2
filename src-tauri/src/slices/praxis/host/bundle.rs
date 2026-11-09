//! A graph workflow's bundle as `praxis graphs check` and `submit` take it (#444, #460): the
//! paths of the saved files its record names, the graph, the graph binding and the contract, and
//! of each grant its contract's bindings file lists. Only saved files go, so an unsaved draft
//! never does, and `praxis` reads each file itself. The same files give the bundle digest the
//! host reports on each revision (#461), so the builder can tell when they differ from it.

use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use crate::slices::praxis::graph_workflow::validate_graph_workflow;
use crate::slices::praxis::models::PraxisKind;
use crate::slices::praxis::store::{definition_path, display_path, read_capped, read_record, BINDINGS_DIR, PRAXIS_DIR};
use crate::slices::praxis::template_name::check_graph_workflow_name;
use crate::slices::praxis::validate::Severity;

/// The most grants a bundle carries, the host's limit (AI-WS-SDK `GRAPH-WORKFLOWS.md`, "Bundle").
pub const MAX_BUNDLE_GRANTS: usize = 64;

/// The saved files of a graph workflow's bundle, in the order `praxis` is given them.
struct BundleFiles {
    graph: PathBuf,
    binding: PathBuf,
    contract: PathBuf,
    /// In the order the contract's bindings file lists them.
    grants: Vec<PathBuf>,
}

/// The saved files of the graph workflow `name` in `repo`. Refused, naming what is missing, when
/// the name breaks the host's rule, the graph workflow or a record it names isn't saved, its shape
/// isn't valid, or its contract's bindings file lists no grant or more than [`MAX_BUNDLE_GRANTS`].
fn bundle_files(repo: &Path, name: &str) -> Result<BundleFiles, String> {
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
    Ok(BundleFiles {
        graph: definition_path(repo, PraxisKind::Graphs, &id("graphId"))?,
        binding: definition_path(repo, PraxisKind::GraphBindings, &id("graphBindingId"))?,
        contract: definition_path(repo, PraxisKind::Contracts, &contract)?,
        grants: grants.into_iter().map(|g| definition_path(repo, PraxisKind::Grants, g)).collect::<Result<_, _>>()?,
    })
}

/// The operands of `praxis graphs check` and `submit` for the graph workflow `name` saved in
/// `repo`: its name, then `--graph`, `--binding` and `--contract` with the paths of the records
/// it names, then `--grant` with the path of each grant, in the order the contract's bindings
/// file lists them. Refused as [`bundle_files`] refuses.
pub fn bundle_operands(repo: &Path, name: &str) -> Result<Vec<String>, String> {
    let files = bundle_files(repo, name)?;
    let mut operands = vec![
        name.to_string(),
        "--graph".into(),
        display_path(&files.graph)?,
        "--binding".into(),
        display_path(&files.binding)?,
        "--contract".into(),
        display_path(&files.contract)?,
    ];
    for grant in &files.grants {
        operands.push("--grant".into());
        operands.push(display_path(grant)?);
    }
    Ok(operands)
}

/// The bundle digest of the saved files the graph workflow `name` in `repo` names, as the host
/// gives each revision's `bundleDigest` (AI-WS-SDK `GRAPH-WORKFLOWS.md`, "Bundle digest"): the SDK
/// `digest` of `{purpose, graph, binding, contract, grants}`, the grants in `id` order by UTF-16
/// code units. `None` when [`bundle_files`] refuses the bundle, when a file can't be read or is
/// larger than the builder reads, and when a file isn't strict JSON or a grant has no string `id`,
/// which `praxis` refuses too: Quay then can't tell whether a revision has these files.
pub fn bundle_digest(repo: &Path, name: &str) -> Option<String> {
    let files = bundle_files(repo, name).ok()?;
    let read = |path: &Path| -> Option<Value> { aiws_sdk::parse_strict(std::str::from_utf8(&read_capped(path).ok()?).ok()?).ok() };
    let mut grants = files.grants.iter().map(|p| read(p)).collect::<Option<Vec<Value>>>()?;
    if grants.iter().any(|g| !g.get("id").is_some_and(Value::is_string)) {
        return None;
    }
    let grant_id = |g: &Value| g["id"].as_str().unwrap_or_default().encode_utf16().collect::<Vec<u16>>();
    grants.sort_by_key(grant_id);
    let record = json!({
        "purpose": "aiws-graph-workflow-bundle/1",
        "graph": read(&files.graph)?,
        "binding": read(&files.binding)?,
        "contract": read(&files.contract)?,
        "grants": grants,
    });
    aiws_sdk::digest(&record).ok()
}
