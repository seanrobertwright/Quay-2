//! A graph workflow's bundle as `praxis graphs check` and `submit` take it (#444, #460): the
//! paths of the saved files its record names, the graph, the graph binding and the contract, and
//! of each grant its contract's bindings file lists. Only saved files go, so an unsaved draft
//! never does, and `praxis` reads each file itself. The same files give the bundle digest the
//! host reports on each revision (#461), so the builder can tell when they differ from it, and
//! the list of files the Submit confirm shows, each with its record digest and git change (#462),
//! and the uncommitted changes a graph run's confirm warns about (#466).

use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{json, Value};

use crate::slices::praxis::changes::path_changes;
use crate::slices::praxis::graph_workflow::validate_graph_workflow;
use crate::slices::praxis::models::{BundleFileChange, ChangeStatus, PraxisKind};
use crate::slices::praxis::store::{definition_path, display_path, read_capped, read_record, shown_path, BINDINGS_DIR};
use crate::slices::praxis::template_name::check_graph_workflow_name;
use crate::slices::praxis::validate::Severity;

/// The most grants a bundle carries, the host's limit (AI-WS-SDK `GRAPH-WORKFLOWS.md`, "Bundle").
pub const MAX_BUNDLE_GRANTS: usize = 64;

/// One saved file of a bundle: the record it holds and where it is.
struct SavedFile {
    kind: PraxisKind,
    id: String,
    path: PathBuf,
}

impl SavedFile {
    fn new(repo: &Path, kind: PraxisKind, id: &str) -> Result<Self, String> {
        Ok(SavedFile { kind, id: id.to_string(), path: definition_path(repo, kind, id)? })
    }
}

/// The saved files of a graph workflow's bundle, in the order `praxis` is given them.
struct BundleFiles {
    graph: SavedFile,
    binding: SavedFile,
    contract: SavedFile,
    /// In the order the contract's bindings file lists them.
    grants: Vec<SavedFile>,
}

impl BundleFiles {
    /// Each file with the name a host finding gives it (AI-WS-SDK `GRAPH-WORKFLOWS.md`, "Bundle"):
    /// `graph`, `binding`, `contract`, and `grants/<index>` by its place in the bindings file's list.
    fn named(&self) -> Vec<(String, &SavedFile)> {
        let mut named = vec![("graph".to_string(), &self.graph), ("binding".to_string(), &self.binding), ("contract".to_string(), &self.contract)];
        named.extend(self.grants.iter().enumerate().map(|(i, g)| (format!("grants/{i}"), g)));
        named
    }
}

/// One file of a graph workflow's bundle, as the Submit confirm lists it (#462).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleFile {
    /// The name a host finding gives the file: `graph`, `binding`, `contract` or `grants/<index>`.
    pub file: String,
    pub kind: PraxisKind,
    pub id: String,
    /// The file's path in the project, `.praxis/<folder>/<id>.json`.
    pub path: String,
    /// The SDK `digest` of the record the file holds, in `bundleDigest`'s form, which is the
    /// digest the host stores it by. None when the file can't be read or isn't strict JSON.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub digest: Option<String>,
    /// How the file differs from the last commit; none when it doesn't, or outside git.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub change: Option<ChangeStatus>,
}

/// A graph workflow's bundle as its saved files make it (#462).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphWorkflowBundle {
    /// In the order `praxis` is given them.
    pub files: Vec<BundleFile>,
    /// See [`bundle_digest`].
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bundle_digest: Option<String>,
    /// Why git status couldn't be read, so no file's change is known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub changes_error: Option<String>,
}

/// The saved files of the graph workflow `name` in `repo`. Refused, naming what is missing, when
/// the name breaks the host's rule, the graph workflow or a record it names isn't saved, its shape
/// isn't valid, or its contract's bindings file lists no grant or more than [`MAX_BUNDLE_GRANTS`].
fn bundle_files(repo: &Path, name: &str) -> Result<BundleFiles, String> {
    check_graph_workflow_name(name)?;
    let folder = PraxisKind::GraphWorkflows.folder();
    let workflow = read_record(repo, folder, name)?.ok_or_else(|| format!("{} doesn't exist.", shown_path(folder, name)))?;
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
        graph: SavedFile::new(repo, PraxisKind::Graphs, &id("graphId"))?,
        binding: SavedFile::new(repo, PraxisKind::GraphBindings, &id("graphBindingId"))?,
        contract: SavedFile::new(repo, PraxisKind::Contracts, &contract)?,
        grants: grants.into_iter().map(|g| SavedFile::new(repo, PraxisKind::Grants, g)).collect::<Result<_, _>>()?,
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
        display_path(&files.graph.path)?,
        "--binding".into(),
        display_path(&files.binding.path)?,
        "--contract".into(),
        display_path(&files.contract.path)?,
    ];
    for grant in &files.grants {
        operands.push("--grant".into());
        operands.push(display_path(&grant.path)?);
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
    digest_of(&bundle_files(repo, name).ok()?)
}

/// The record a saved file holds, when it can be read and is strict JSON, as `praxis` needs it.
fn read_strict(path: &Path) -> Option<Value> {
    aiws_sdk::parse_strict(std::str::from_utf8(&read_capped(path).ok()?).ok()?).ok()
}

/// See [`bundle_digest`].
fn digest_of(files: &BundleFiles) -> Option<String> {
    let read = |file: &SavedFile| read_strict(&file.path);
    let mut grants = files.grants.iter().map(read).collect::<Option<Vec<Value>>>()?;
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

/// The files of the graph workflow `name` in `repo` that have changed since the last commit, in
/// path order: its own record, the bundle's graph, graph binding, contract and grants, and the
/// contract's bindings file, which picks the grants. Empty when `repo` isn't a git repository.
/// Refused as [`bundle_files`] refuses, since Quay then can't tell which files the bundle has.
pub fn bundle_changes(repo: &Path, name: &str) -> Result<Vec<BundleFileChange>, String> {
    let files = bundle_files(repo, name)?;
    let mut paths = vec![shown_path(PraxisKind::GraphWorkflows.folder(), name), shown_path(BINDINGS_DIR, &files.contract.id)];
    paths.extend(files.named().iter().map(|(_, f)| shown_path(f.kind.folder(), &f.id)));
    Ok(path_changes(repo, &paths)?.into_iter().map(|(path, status)| BundleFileChange { path, status }).collect())
}

/// The saved files of the graph workflow `name` in `repo` as `praxis` is given them, each with
/// the name a host finding gives it, its record digest and how it differs from the last commit,
/// and the bundle's digest. Refused as [`bundle_operands`] refuses. A git status that can't be
/// read leaves every change unknown and says why in `changes_error`.
pub fn graph_workflow_bundle(repo: &Path, name: &str) -> Result<GraphWorkflowBundle, String> {
    let files = bundle_files(repo, name)?;
    let named = files.named();
    let paths: Vec<String> = named.iter().map(|(_, f)| shown_path(f.kind.folder(), &f.id)).collect();
    let (changes, changes_error) = match path_changes(repo, &paths) {
        Ok(changes) => (changes, None),
        Err(why) => (Vec::new(), Some(why)),
    };
    let change_of = |path: &str| changes.iter().find(|(p, _)| p == path).map(|(_, status)| *status);
    let files_out = named
        .iter()
        .zip(&paths)
        .map(|((file, saved), path)| BundleFile {
            file: file.clone(),
            kind: saved.kind,
            id: saved.id.clone(),
            path: path.clone(),
            digest: read_strict(&saved.path).and_then(|record| aiws_sdk::digest(&record).ok()),
            change: change_of(path),
        })
        .collect();
    Ok(GraphWorkflowBundle { files: files_out, bundle_digest: digest_of(&files), changes_error })
}
