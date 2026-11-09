//! Reads and saves Praxis definitions in `<repo>/.praxis/<kind>/<id>.json`. Callers name
//! a definition by project, kind and id and never by path: the id is checked against the
//! filename-safe rule, and every folder is canonicalized and refused when it resolves
//! outside the repository (through a symlink or junction).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde_json::{json, Map, Value};

use super::canonical::{canonical_record, content_hash, to_canonical_text};
use super::host::bundle_digest;
use super::template_digest::template_digest;
use super::models::{
    BindingsInput, ConflictReason, ContractTriggers, DefinitionEntry, DefinitionFile, DefinitionList, FileProblem,
    IdMismatch, LayoutInput, PraxisKind, SaveOutcome, TargetInput,
};
use crate::atomic_file::write_atomic;

/// The most entries `list_definitions` returns for one kind.
pub const MAX_LISTED: usize = 1000;

/// Files larger than this are listed with a problem and never parsed.
pub const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;

/// The longest id the filename-safe rule allows.
pub const MAX_ID_LEN: usize = 128;

/// The `version` a layout file is written with.
pub const LAYOUT_VERSION: u64 = 1;

pub(super) const PRAXIS_DIR: &str = ".praxis";
pub(super) const LAYOUT_DIR: &str = "layout";
pub(super) const BINDINGS_DIR: &str = "bindings";
/// The folder of trigger targets (#472): `<trigger-id>.json` names the graph workflow a trigger starts.
pub(super) const TRIGGER_TARGETS_DIR: &str = "trigger-targets";

/// The `version` a contract's bindings file is written with.
pub const BINDINGS_VERSION: u64 = 1;

/// The most ids each list of a bindings file holds, as the SDK caps its id lists.
pub const MAX_BINDINGS: usize = 1000;

/// The most trigger files, or trigger target files, one lookup of the triggers that start a
/// contract or a graph workflow reads.
pub const MAX_TRIGGERS_SCANNED: usize = 10_000;

/// Serializes saves, renames and deletes, so two of them from Quay can't interleave their
/// checks and writes.
pub(super) static SAVE_LOCK: Mutex<()> = Mutex::new(());

/// Checks an id against the filename-safe rule: 1 to 128 of `[A-Za-z0-9._-]`, no leading
/// dot, and not a Windows reserved device name (`CON`, `NUL`, `COM1` and the rest),
/// which Windows reserves with any extension, so `nul.x` is refused too.
pub fn validate_id(id: &str) -> Result<(), String> {
    if id.is_empty() {
        return Err("The id is empty.".to_string());
    }
    if id.len() > MAX_ID_LEN {
        return Err(format!("The id is longer than {} characters.", MAX_ID_LEN));
    }
    if let Some(bad) = id
        .chars()
        .find(|c| !(c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-')))
    {
        return Err(format!(
            "The id may only use letters, digits, '.', '_' and '-', not {:?}.",
            bad
        ));
    }
    if id.starts_with('.') {
        return Err("The id can't start with a dot.".to_string());
    }
    let stem = id.split('.').next().unwrap_or(id).to_ascii_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.as_bytes()[3].is_ascii_digit());
    if reserved {
        return Err(format!("'{}' is a reserved device name on Windows.", stem));
    }
    Ok(())
}

/// Canonicalizes `project_path` and confirms it is a project registered in Quay, or a git
/// worktree whose main checkout is one. Returns the canonical repository root.
pub fn resolve_project(project_path: &str, registered: &[String]) -> Result<PathBuf, String> {
    let trimmed = project_path.trim();
    if trimmed.is_empty() {
        return Err("No project is open.".to_string());
    }
    let candidate = std::fs::canonicalize(trimmed)
        .map_err(|e| format!("Project folder '{}' can't be opened: {}", trimmed, e))?;
    let main = main_checkout_of(&candidate);
    let is_registered = |p: &String| {
        std::fs::canonicalize(p).is_ok_and(|c| c == candidate || Some(&c) == main.as_ref())
    };
    if registered.iter().any(is_registered) {
        return Ok(candidate);
    }
    Err(format!("'{}' is not a project registered in Quay.", trimmed))
}

/// The canonical main checkout of the git worktree at `dir`, read from git's link files
/// without running git. `<dir>/.git` is a file naming the worktree's git folder, whose
/// `gitdir` file must point back at `<dir>/.git` and whose `commondir` names the shared
/// `.git` folder of the main checkout. `None` when `dir` isn't a linked worktree.
fn main_checkout_of(dir: &Path) -> Option<PathBuf> {
    let dot_git = dir.join(".git");
    let link = std::fs::read_to_string(&dot_git).ok()?;
    let worktree_git = dir.join(link.trim().strip_prefix("gitdir:")?.trim());
    let back = std::fs::read_to_string(worktree_git.join("gitdir")).ok()?;
    let back = std::fs::canonicalize(worktree_git.join(back.trim())).ok()?;
    if back != std::fs::canonicalize(&dot_git).ok()? {
        return None;
    }
    let common = std::fs::read_to_string(worktree_git.join("commondir")).ok()?;
    let common = std::fs::canonicalize(worktree_git.join(common.trim())).ok()?;
    if common.file_name()? != ".git" {
        return None;
    }
    common.parent().map(Path::to_path_buf)
}

/// The canonical `<repo>/.praxis/<folder>`, or `None` when it doesn't exist. Refused when
/// it resolves outside the repository.
pub(super) fn confined_dir(repo: &Path, folder: &str) -> Result<Option<PathBuf>, String> {
    let dir = repo.join(PRAXIS_DIR).join(folder);
    if std::fs::symlink_metadata(&dir).is_err() {
        return Ok(None);
    }
    let canonical = std::fs::canonicalize(&dir)
        .map_err(|e| format!("{}/{} can't be opened: {}", PRAXIS_DIR, folder, e))?;
    if !canonical.starts_with(repo) {
        return Err(format!(
            "{}/{} resolves outside the repository, so Quay won't read it.",
            PRAXIS_DIR, folder
        ));
    }
    if !canonical.is_dir() {
        return Err(format!("{}/{} is not a folder.", PRAXIS_DIR, folder));
    }
    Ok(Some(canonical))
}

/// The ids of the `.praxis/<folder>/*.json` files in id order, the first `cap` of them. When
/// there are more, a line saying how many weren't searched goes in `unchecked`. A missing folder
/// has none.
pub(super) fn capped_ids(repo: &Path, folder: &str, cap: usize, unchecked: &mut Vec<String>) -> Result<Vec<String>, String> {
    let Some(dir) = confined_dir(repo, folder)? else { return Ok(Vec::new()) };
    let mut ids = json_ids(&dir, folder)?;
    if ids.len() > cap {
        unchecked.push(format!("{}/{}/: the {} files after the first {} weren't searched.", PRAXIS_DIR, folder, ids.len() - cap, cap));
        ids.truncate(cap);
    }
    Ok(ids)
}

/// `.praxis/<folder>/<id>.json` as one JSON object: `Ok(None)` when there is no such file,
/// and `Err` with the reason when it can't be read or isn't an object.
pub(super) fn read_record(repo: &Path, folder: &str, id: &str) -> Result<Option<Value>, String> {
    validate_id(id)?;
    let Some(dir) = confined_dir(repo, folder)? else { return Ok(None) };
    let Some(path) = confined_file(repo, &dir, id)? else { return Ok(None) };
    parse_object_file(&path).map(Some).map_err(|p| p.message)
}

/// The canonical path of `<dir>/<id>.json`, or `None` when there is no such file.
/// Refused when it resolves outside the repository.
pub(super) fn confined_file(repo: &Path, dir: &Path, id: &str) -> Result<Option<PathBuf>, String> {
    let path = dir.join(format!("{}.json", id));
    if std::fs::symlink_metadata(&path).is_err() {
        return Ok(None);
    }
    let canonical = std::fs::canonicalize(&path)
        .map_err(|e| format!("{}.json can't be opened: {}", id, e))?;
    if !canonical.starts_with(repo) {
        return Err(format!(
            "{}.json resolves outside the repository, so Quay won't read it.",
            id
        ));
    }
    Ok(Some(canonical))
}

/// The `<repo>/.praxis/<folder>` folder, created when it is missing, and canonicalized.
/// `.praxis/` is checked before the folder is made inside it, so a link that leads out
/// of the repository is refused before anything is created through it.
pub(super) fn ensure_confined_dir(repo: &Path, folder: &str) -> Result<PathBuf, String> {
    let mut canonical = repo.to_path_buf();
    for (dir, name) in [
        (repo.join(PRAXIS_DIR), PRAXIS_DIR.to_string()),
        (repo.join(PRAXIS_DIR).join(folder), format!("{}/{}", PRAXIS_DIR, folder)),
    ] {
        if std::fs::symlink_metadata(&dir).is_err() {
            match std::fs::create_dir(&dir) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(e) => return Err(format!("{} can't be created: {}", name, e)),
            }
        }
        canonical = std::fs::canonicalize(&dir).map_err(|e| format!("{} can't be opened: {}", name, e))?;
        if !canonical.starts_with(repo) {
            return Err(format!("{} resolves outside the repository, so Quay won't write to it.", name));
        }
        if !canonical.is_dir() {
            return Err(format!("{} is not a folder.", name));
        }
    }
    Ok(canonical)
}

/// A file's bytes, refused when it is larger than `MAX_FILE_BYTES`.
pub(super) fn read_capped(path: &Path) -> Result<Vec<u8>, FileProblem> {
    let size = std::fs::metadata(path)
        .map_err(|e| FileProblem::new(format!("Can't read the file: {}", e)))?
        .len();
    if size > MAX_FILE_BYTES {
        return Err(FileProblem::new(format!(
            "The file is {} bytes, larger than the {} bytes Quay opens.",
            size, MAX_FILE_BYTES
        )));
    }
    std::fs::read(path).map_err(|e| FileProblem::new(format!("Can't read the file: {}", e)))
}

/// Reads and parses a file that must hold one JSON object.
fn parse_object_file(path: &Path) -> Result<Value, FileProblem> {
    parse_object(&read_capped(path)?)
}

/// Parses bytes that must hold one JSON object, describing anything that stops them
/// being one. A leading UTF-8 byte order mark is ignored.
pub(super) fn parse_object(bytes: &[u8]) -> Result<Value, FileProblem> {
    let text = std::str::from_utf8(bytes)
        .map_err(|e| FileProblem::new(format!("Can't read the file as UTF-8: {}", e)))?;
    let body = text.strip_prefix('\u{feff}').unwrap_or(text);
    let value: Value = serde_json::from_str(body).map_err(|e| FileProblem {
        message: format!("Not valid JSON: {}", e),
        line: Some(e.line()),
        column: Some(e.column()),
    })?;
    if !value.is_object() {
        return Err(FileProblem::new("The file holds JSON, but not a JSON object."));
    }
    Ok(value)
}

/// The names, without `.json`, of the `*.json` files directly in `dir`, which is
/// `.praxis/<folder>`, in id order: ignoring case, then by case.
pub(super) fn json_ids(dir: &Path, folder: &str) -> Result<Vec<String>, String> {
    let read = std::fs::read_dir(dir).map_err(|e| format!("{}/{} can't be listed: {}", PRAXIS_DIR, folder, e))?;
    let mut ids: Vec<String> = Vec::new();
    for entry in read.flatten() {
        let Ok(name) = entry.file_name().into_string() else { continue };
        let Some(id) = name.strip_suffix(".json") else { continue };
        // `metadata` follows links, so a junction named `x.json` is skipped like a folder.
        if std::fs::metadata(entry.path()).is_ok_and(|m| m.is_dir()) {
            continue;
        }
        ids.push(id.to_string());
    }
    ids.sort_by(|a, b| a.to_ascii_lowercase().cmp(&b.to_ascii_lowercase()).then(a.cmp(b)));
    Ok(ids)
}

/// Lists a kind's definitions in id order, at most `MAX_LISTED` of them. Only `*.json`
/// files directly in the kind's folder are listed. A missing folder is an empty list. Each
/// file is parsed, so one that can't be opened, or whose `id` isn't its name, is flagged.
/// A workflow template or graph workflow whose name breaks the host's rule is flagged too. A
/// graph binding lists with its graph and cost unit, and a graph workflow with its contract and the
/// bundle digest of the saved files it names.
pub fn list_definitions(repo: &Path, kind: PraxisKind) -> Result<DefinitionList, String> {
    let Some(dir) = confined_dir(repo, kind.folder())? else {
        return Ok(DefinitionList { entries: Vec::new(), truncated: false });
    };
    let mut ids = json_ids(&dir, kind.folder())?;
    let truncated = ids.len() > MAX_LISTED;
    ids.truncate(MAX_LISTED);

    let entries = ids
        .into_iter()
        .map(|id| {
            let parsed = match validate_id(&id) {
                Err(why) => Err(FileProblem::new(format!("The file name isn't a valid id. {}", why))),
                Ok(()) => match confined_file(repo, &dir, &id) {
                    Err(why) => Err(FileProblem::new(why)),
                    Ok(None) => Err(FileProblem::new("The file disappeared while listing.")),
                    Ok(Some(path)) => read_capped(&path).and_then(|bytes| Ok((parse_object(&bytes)?, bytes))),
                },
            };
            let empty = |id: String, problem: Option<FileProblem>| DefinitionEntry {
                id,
                problem,
                id_mismatch: None,
                name_problem: None,
                graph_id: None,
                cost_unit: None,
                template_digest: None,
                bundle_digest: None,
                contract_id: None,
                graph_binding_id: None,
                target: None,
            };
            match parsed {
                Err(problem) => empty(id, Some(problem)),
                Ok((record, bytes)) => {
                    let Some(id_field) = kind.id_field() else {
                        let template_digest = (kind == PraxisKind::Templates).then(|| template_digest(&bytes)).flatten();
                        let workflow_field = |key: &str| {
                            (kind == PraxisKind::GraphWorkflows)
                                .then(|| record.get(key).and_then(Value::as_str).map(str::to_string))
                                .flatten()
                        };
                        let bundle_digest = (kind == PraxisKind::GraphWorkflows).then(|| bundle_digest(repo, &id)).flatten();
                        return DefinitionEntry {
                            template_digest,
                            bundle_digest,
                            contract_id: workflow_field("contractId"),
                            graph_id: workflow_field("graphId"),
                            graph_binding_id: workflow_field("graphBindingId"),
                            ..empty(id, None)
                        };
                    };
                    let found = record.get(id_field).and_then(Value::as_str);
                    let id_mismatch =
                        (found != Some(id.as_str())).then(|| IdMismatch { found: found.map(str::to_string) });
                    let binding_field = |key: &str| {
                        (kind == PraxisKind::GraphBindings)
                            .then(|| record.get(key).and_then(Value::as_str).map(str::to_string))
                            .flatten()
                    };
                    let graph_id = binding_field("graphId");
                    let cost_unit = binding_field("costUnit").filter(|u| !u.is_empty());
                    let target = (kind == PraxisKind::Triggers).then(|| target_graph_workflow(repo, &id)).flatten();
                    DefinitionEntry { id_mismatch, graph_id, cost_unit, target, ..empty(id, None) }
                }
            }
        })
        .map(|mut entry: DefinitionEntry| {
            if validate_id(&entry.id).is_ok() {
                entry.name_problem = kind.name_problem(&entry.id, entry.target.is_some());
            }
            entry
        })
        .collect();
    Ok(DefinitionList { entries, truncated })
}

/// Reads one definition, and for a graph its layout file too. A file that doesn't exist
/// reads as `missing`, so the builder can mark a draft whose file was deleted.
pub fn read_definition(repo: &Path, kind: PraxisKind, id: &str) -> Result<DefinitionFile, String> {
    let Some(path) = find_definition(repo, kind, id)? else {
        return Ok(DefinitionFile {
            id: id.to_string(),
            kind,
            missing: true,
            content_hash: None,
            content: None,
            problem: None,
            layout: None,
            layout_problem: None,
            bindings: None,
            bindings_problem: None,
            bindings_hash: None,
            target: None,
            target_problem: None,
            target_hash: None,
        });
    };
    let (content, problem, content_hash) = match read_capped(&path) {
        Err(problem) => (None, Some(problem), None),
        Ok(bytes) => {
            let (content, problem) = split(parse_object(&bytes));
            (content, problem, Some(content_hash(&bytes)))
        }
    };
    // A layout that can't be used is reported and ignored: the graph still opens, laid out
    // by dagre.
    let (layout, layout_problem) = if kind == PraxisKind::Graphs {
        match confined_dir(repo, LAYOUT_DIR).and_then(|dir| match dir {
            None => Ok(None),
            Some(dir) => confined_file(repo, &dir, id),
        }) {
            Err(why) => (None, Some(FileProblem::new(why))),
            Ok(None) => (None, None),
            Ok(Some(file)) => split(parse_object_file(&file)),
        }
    } else {
        (None, None)
    };
    // Bindings that can't be read are reported, and the contract opens with none. A trigger's
    // target is read the same way (#472).
    let bindings = if kind == PraxisKind::Contracts { read_companion(repo, BINDINGS_DIR, id) } else { Companion::default() };
    let target = if kind == PraxisKind::Triggers { read_companion(repo, TRIGGER_TARGETS_DIR, id) } else { Companion::default() };
    Ok(DefinitionFile {
        id: id.to_string(),
        kind,
        missing: false,
        content_hash,
        content,
        problem,
        layout,
        layout_problem,
        bindings: bindings.value,
        bindings_problem: bindings.problem,
        bindings_hash: bindings.hash,
        target: target.value,
        target_problem: target.problem,
        target_hash: target.hash,
    })
}

/// A file that belongs to a definition as it was read: its object, or why it can't be used,
/// and the hash of its bytes when they could be read. All `None` when there is no such file.
#[derive(Default)]
struct Companion {
    value: Option<Value>,
    problem: Option<FileProblem>,
    hash: Option<String>,
}

/// Reads `.praxis/<folder>/<id>.json`, a file that belongs to a definition.
fn read_companion(repo: &Path, folder: &str, id: &str) -> Companion {
    match companion_file(repo, folder, id) {
        Err(why) => Companion { problem: Some(FileProblem::new(why)), ..Companion::default() },
        Ok(None) => Companion::default(),
        Ok(Some(file)) => match read_capped(&file) {
            Err(problem) => Companion { problem: Some(problem), ..Companion::default() },
            Ok(bytes) => {
                let (value, problem) = split(parse_object(&bytes));
                Companion { value, problem, hash: Some(content_hash(&bytes)) }
            }
        },
    }
}

/// The graph workflow the saved target file of trigger `id` names (#472), or `None` when it has
/// no target file, or one that can't be read or names none, which the builder opens as no target.
pub fn target_graph_workflow(repo: &Path, id: &str) -> Option<String> {
    let id = read_companion(repo, TRIGGER_TARGETS_DIR, id).value?.get("graphWorkflow")?.as_str()?.to_string();
    (!id.is_empty()).then_some(id)
}

/// `.praxis/<folder>/<id>.json`, a file that belongs to a definition, when it exists and
/// resolves inside the repository.
fn companion_file(repo: &Path, folder: &str, id: &str) -> Result<Option<PathBuf>, String> {
    match confined_dir(repo, folder)? {
        None => Ok(None),
        Some(dir) => confined_file(repo, &dir, id),
    }
}

/// The hash of `.praxis/<folder>/<id>.json`, a contract's bindings file or a trigger's target,
/// as it is now, or `None` when there is none.
fn companion_hash_now(repo: &Path, folder: &str, id: &str) -> Result<Option<String>, String> {
    match companion_file(repo, folder, id)? {
        None => Ok(None),
        Some(path) => std::fs::read(&path)
            .map(|bytes| Some(content_hash(&bytes)))
            .map_err(|e| format!("{}/{}/{}.json can't be read: {}", PRAXIS_DIR, folder, id, e)),
    }
}

/// The `version` a trigger's target file is written with.
pub const TARGET_VERSION: u64 = 1;

/// A trigger target file's JSON, `{version, graphWorkflow}`, or `None` for a trigger that
/// starts nothing. Refuses a graph workflow id that isn't filename-safe, since no graph
/// workflow could have it.
fn target_value(target: &TargetInput) -> Result<Option<Value>, String> {
    let Some(id) = &target.graph_workflow else { return Ok(None) };
    validate_id(id).map_err(|why| format!("The graph workflow id '{}' isn't valid. {}", id, why))?;
    Ok(Some(json!({"version": TARGET_VERSION, "graphWorkflow": id})))
}

/// The bindings file's JSON: each list with its ids in the order given and repeats
/// dropped. Refuses an id that isn't filename-safe, since no definition could have it, and
/// a list longer than `MAX_BINDINGS`.
fn bindings_value(bindings: &BindingsInput) -> Result<Value, String> {
    let list = |name: &str, ids: &[String]| -> Result<Value, String> {
        let mut kept: Vec<&str> = Vec::new();
        for id in ids {
            validate_id(id).map_err(|why| format!("The bound {} id '{}' isn't valid. {}", name, id, why))?;
            if !kept.contains(&id.as_str()) {
                kept.push(id);
            }
        }
        if kept.len() > MAX_BINDINGS {
            return Err(format!("A contract binds at most {} {}.", MAX_BINDINGS, name));
        }
        Ok(json!(kept))
    };
    let mut out = Map::new();
    out.insert("version".to_string(), json!(BINDINGS_VERSION));
    out.insert("graphs".to_string(), list("graphs", &bindings.graphs)?);
    out.insert("grants".to_string(), list("grants", &bindings.grants)?);
    Ok(Value::Object(out))
}

/// The ids of the triggers whose `contractId` is `contract_id` (#223), in id order. Files
/// that can't be read, and those past `MAX_TRIGGERS_SCANNED`, are reported as unchecked.
pub fn contract_triggers(repo: &Path, contract_id: &str) -> Result<ContractTriggers, String> {
    validate_id(contract_id)?;
    let folder = PraxisKind::Triggers.folder();
    let mut out = ContractTriggers { ids: Vec::new(), unchecked: Vec::new() };
    for id in capped_ids(repo, folder, MAX_TRIGGERS_SCANNED, &mut out.unchecked)? {
        let record = read_record(repo, folder, &id).and_then(|r| r.ok_or_else(|| "The file disappeared.".to_string()));
        match record {
            Ok(record) if record.get("contractId").and_then(Value::as_str) == Some(contract_id) => out.ids.push(id),
            Ok(_) => {}
            Err(why) => out.unchecked.push(format!("{}/{}/{}.json: {}", PRAXIS_DIR, folder, id, why)),
        }
    }
    Ok(out)
}

fn split<T, E>(result: Result<T, E>) -> (Option<T>, Option<E>) {
    match result {
        Ok(value) => (Some(value), None),
        Err(err) => (None, Some(err)),
    }
}

/// The canonical path of a definition file confined to the repository, or `None` when
/// there is no such file.
fn find_definition(repo: &Path, kind: PraxisKind, id: &str) -> Result<Option<PathBuf>, String> {
    validate_id(id)?;
    match confined_dir(repo, kind.folder())? {
        None => Ok(None),
        Some(dir) => confined_file(repo, &dir, id),
    }
}

/// The path of an existing definition file, confined to the repository, for "Reveal in
/// folder".
pub fn definition_path(repo: &Path, kind: PraxisKind, id: &str) -> Result<PathBuf, String> {
    find_definition(repo, kind, id)?
        .ok_or_else(|| format!("{}/{}/{}.json doesn't exist.", PRAXIS_DIR, kind.folder(), id))
}

/// `path` as a person would type it: without the `\\?\` prefix a canonical Windows path carries.
/// Refused when the path isn't valid Unicode, since a lossy copy would name another file.
pub fn display_path(path: &Path) -> Result<String, String> {
    let text = path
        .to_str()
        .ok_or_else(|| format!("The path {} isn't valid Unicode, so Quay can't show it to copy.", path.display()))?;
    Ok(match text.strip_prefix(r"\\?\UNC\") {
        Some(share) => format!(r"\\{}", share),
        None => text.strip_prefix(r"\\?\").unwrap_or(text).to_string(),
    })
}

/// The layout file's JSON for `record`: positions rounded to integers, in node order, with
/// positions for nodes the graph no longer has dropped, and the viewport. Refuses
/// positions or a viewport that aren't finite numbers.
fn layout_value(layout: &LayoutInput, record: &Map<String, Value>) -> Result<Value, String> {
    let mut by_id: HashMap<&str, (i64, i64)> = HashMap::new();
    for p in &layout.nodes {
        if !p.x.is_finite() || !p.y.is_finite() {
            return Err(format!("The position of node '{}' isn't a finite number.", p.id));
        }
        by_id.entry(p.id.as_str()).or_insert((p.x.round() as i64, p.y.round() as i64));
    }
    let mut nodes = Map::new();
    let ids = record
        .get("nodes")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|n| n.get("id").and_then(Value::as_str));
    for id in ids {
        if let Some((x, y)) = by_id.get(id) {
            if !nodes.contains_key(id) {
                nodes.insert(id.to_string(), json!({ "x": x, "y": y }));
            }
        }
    }
    let mut out = Map::new();
    out.insert("version".to_string(), json!(LAYOUT_VERSION));
    out.insert("nodes".to_string(), Value::Object(nodes));
    if let Some(v) = layout.viewport {
        if !(v.x.is_finite() && v.y.is_finite() && v.zoom.is_finite() && v.zoom > 0.0) {
            return Err("The viewport isn't a finite position and a positive zoom.".to_string());
        }
        let zoom = (v.zoom * 1000.0).round() / 1000.0;
        out.insert(
            "viewport".to_string(),
            json!({ "x": v.x.round() as i64, "y": v.y.round() as i64, "zoom": zoom }),
        );
    }
    Ok(Value::Object(out))
}

/// Whether `dir` holds `<id>.json` under any capitalization, for file systems that tell
/// `Graph.json` and `graph.json` apart.
fn id_taken_ignoring_case(dir: &Path, id: &str) -> Result<bool, String> {
    let read = std::fs::read_dir(dir).map_err(|e| format!("The folder can't be listed: {}", e))?;
    Ok(read.flatten().any(|entry| {
        entry
            .file_name()
            .to_str()
            .and_then(|name| name.strip_suffix(".json"))
            .is_some_and(|stem| stem.eq_ignore_ascii_case(id))
    }))
}

/// Saves a definition in its canonical form (#222), and for a graph its layout file.
///
/// `expected_hash` is the content hash the draft loaded. When it is set and the file no
/// longer has that hash, or no longer exists, nothing is written and the conflict is
/// returned, unless `force` says to overwrite. When it is `None` the definition is new,
/// and the save is refused when its id is already taken, ignoring case. The id must be
/// filename-safe, and a new workflow template's or graph workflow's must follow the host's name
/// rule too; a file already saved under another name still saves. An invalid definition is still written: whatever later runs it refuses
/// it. The definition is written first, so a layout that fails to write afterwards is
/// reported in the outcome and the definition stays saved.
///
/// A graph binding's unset `graphRevision` and `graphDigest` are filled from its graph as
/// saved on disk first (#247, `graph_bindings::fill_pins`).
///
/// A contract's `bindings` are written to its bindings file the same way (#223). For a
/// contract saved before, `expected_bindings_hash` is the hash of the bindings file the
/// draft loaded, `None` for no file, and a bindings file changed since is a conflict too.
#[allow(clippy::too_many_arguments)]
pub fn save_definition(
    repo: &Path,
    kind: PraxisKind,
    id: &str,
    content: Value,
    layout: Option<&LayoutInput>,
    bindings: Option<&BindingsInput>,
    expected_hash: Option<&str>,
    expected_bindings_hash: Option<&str>,
    force: bool,
) -> Result<SaveOutcome, String> {
    let companions = Companions { layout, bindings: bindings.map(|b| (b, expected_bindings_hash)), target: None };
    save(repo, kind, id, content, companions, expected_hash, force)
}

/// Saves a trigger with its target (#472): the trigger as `save_definition` saves it, then
/// its target file, written with the graph workflow `target` names, or removed when it names
/// none. The target never changes the trigger's record, so setting or clearing it alone
/// leaves the trigger file as it is. For a trigger saved before, `expected_target_hash` is the
/// hash of the target file the draft loaded, `None` for no file, and a target file changed
/// since is a conflict too. A new trigger saved with a target must have a name the host's
/// graph trigger rule admits (#473); a trigger saved before keeps saving under its name.
pub fn save_trigger_with_target(
    repo: &Path,
    id: &str,
    content: Value,
    target: &TargetInput,
    expected_hash: Option<&str>,
    expected_target_hash: Option<&str>,
    force: bool,
) -> Result<SaveOutcome, String> {
    let companions = Companions { layout: None, bindings: None, target: Some((target, expected_target_hash)) };
    save(repo, PraxisKind::Triggers, id, content, companions, expected_hash, force)
}

/// What a save writes beside a definition: a graph's layout, a contract's bindings and a
/// trigger's target, the last two each with the hash of its file the draft loaded.
struct Companions<'a> {
    layout: Option<&'a LayoutInput>,
    bindings: Option<(&'a BindingsInput, Option<&'a str>)>,
    target: Option<(&'a TargetInput, Option<&'a str>)>,
}

fn save(
    repo: &Path,
    kind: PraxisKind,
    id: &str,
    content: Value,
    companions: Companions,
    expected_hash: Option<&str>,
    force: bool,
) -> Result<SaveOutcome, String> {
    // A new trigger saved with a target is a name the host will see (#473).
    let has_target = matches!(companions.target, Some((TargetInput { graph_workflow: Some(_) }, _)));
    if expected_hash.is_none()
        && let Some(problem) = kind.name_problem(id, has_target)
    {
        return Err(problem);
    }
    validate_id(id)?;
    let Value::Object(mut record) = content else {
        return Err("A definition must be a JSON object.".to_string());
    };
    if kind == PraxisKind::GraphBindings {
        super::graph_bindings::fill_pins(repo, &mut record);
    }
    let record = canonical_record(kind, record);
    let layout = match companions.layout {
        Some(layout) if kind == PraxisKind::Graphs => Some(layout_value(layout, &record)?),
        _ => None,
    };
    let bindings = match companions.bindings {
        Some((bindings, expected)) if kind == PraxisKind::Contracts => Some((bindings_value(bindings)?, expected)),
        _ => None,
    };
    let target = match companions.target {
        Some((target, expected)) if kind == PraxisKind::Triggers => Some((target_value(target)?, expected)),
        _ => None,
    };

    let _guard = SAVE_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let dir = ensure_confined_dir(repo, kind.folder())?;
    let existing = confined_file(repo, &dir, id)?;
    let taken = || format!("The id '{}' is already taken by another {} file.", id, kind.folder());
    let mut on_disk = None;
    match (&existing, expected_hash) {
        (Some(_), None) => return Err(taken()),
        (None, None) if id_taken_ignoring_case(&dir, id)? => return Err(taken()),
        (None, None) => {}
        (None, Some(_)) if !force => return Ok(SaveOutcome::Conflict { reason: ConflictReason::Deleted }),
        (Some(path), Some(expected)) => {
            let bytes = std::fs::read(path).map_err(|e| format!("{}.json can't be read: {}", id, e))?;
            if !force && content_hash(&bytes) != expected {
                return Ok(SaveOutcome::Conflict { reason: ConflictReason::Changed });
            }
            on_disk = Some(bytes);
        }
        _ => {}
    }
    if expected_hash.is_some() && !force {
        let expected_companions = [
            bindings.as_ref().map(|(_, expected)| (BINDINGS_DIR, *expected)),
            target.as_ref().map(|(_, expected)| (TRIGGER_TARGETS_DIR, *expected)),
        ];
        for (folder, expected) in expected_companions.into_iter().flatten() {
            if companion_hash_now(repo, folder, id)?.as_deref() != expected {
                return Ok(SaveOutcome::Conflict { reason: ConflictReason::Changed });
            }
        }
    }

    let value = Value::Object(record);
    let text = to_canonical_text(&value);
    // Setting or clearing a trigger's target alone leaves the trigger file as it is (#472).
    let unchanged = target.is_some() && on_disk.as_deref() == Some(text.as_bytes());
    if !unchanged {
        write_atomic(&dir.join(format!("{}.json", id)), text.as_bytes())
            .map_err(|e| format!("{}/{}/{}.json can't be written: {}", PRAXIS_DIR, kind.folder(), id, e))?;
    }

    let layout_error = layout.and_then(|layout| write_companion(repo, LAYOUT_DIR, id, &layout).err());
    let (bindings_hash, bindings_error) = match bindings {
        None => (None, None),
        Some((bindings, _)) => split(write_companion(repo, BINDINGS_DIR, id, &bindings)),
    };
    let (target_hash, target_error) = match target {
        None => (None, None),
        Some((Some(target), _)) => split(write_companion(repo, TRIGGER_TARGETS_DIR, id, &target)),
        Some((None, _)) => (None, remove_companion(repo, TRIGGER_TARGETS_DIR, id).err()),
    };
    Ok(SaveOutcome::Saved {
        content: value,
        content_hash: content_hash(text.as_bytes()),
        layout_error,
        bindings_hash,
        bindings_error,
        target_hash,
        target_error,
        template_digest: (kind == PraxisKind::Templates).then(|| template_digest(text.as_bytes())).flatten(),
    })
}

/// Writes `.praxis/<folder>/<id>.json`, a file that belongs to a definition, in canonical form,
/// and returns the hash of what it wrote.
fn write_companion(repo: &Path, folder: &str, id: &str, value: &Value) -> Result<String, String> {
    let dir = ensure_confined_dir(repo, folder)?;
    confined_file(repo, &dir, id)?;
    let text = to_canonical_text(value);
    write_atomic(&dir.join(format!("{}.json", id)), text.as_bytes())
        .map_err(|e| format!("{}/{}/{}.json can't be written: {}", PRAXIS_DIR, folder, id, e))?;
    Ok(content_hash(text.as_bytes()))
}

/// Removes `.praxis/<folder>/<id>.json` when there is one. A link is removed, not the file
/// it leads to.
fn remove_companion(repo: &Path, folder: &str, id: &str) -> Result<(), String> {
    let Some(dir) = confined_dir(repo, folder)? else { return Ok(()) };
    if confined_file(repo, &dir, id)?.is_none() {
        return Ok(());
    }
    std::fs::remove_file(dir.join(format!("{}.json", id)))
        .map_err(|e| format!("{}/{}/{}.json can't be removed: {}", PRAXIS_DIR, folder, id, e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TempDir;
    use crate::slices::praxis::template_name::{GRAPH_WORKFLOW_NAME_RULE, TEMPLATE_NAME_RULE, TRIGGER_NAME_RULE};

    fn temp_repo() -> TempDir {
        TempDir::canonical("praxis")
    }

    fn write(repo: &Path, rel: &str, body: &str) {
        let path = repo.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, body).unwrap();
    }

    /// A directory link that needs no special privilege: a junction on Windows, a
    /// symlink elsewhere.
    fn link_dir(target: &Path, link: &Path) {
        std::fs::create_dir_all(link.parent().unwrap()).unwrap();
        #[cfg(windows)]
        {
            let status = crate::spawn::hidden_command("cmd")
                .args(["/C", "mklink", "/J"])
                .arg(link)
                .arg(target)
                .output()
                .unwrap()
                .status;
            assert!(status.success(), "mklink /J failed");
        }
        #[cfg(not(windows))]
        std::os::unix::fs::symlink(target, link).unwrap();
    }

    fn ids(list: &DefinitionList) -> Vec<&str> {
        list.entries.iter().map(|e| e.id.as_str()).collect()
    }

    // --- the id rule ---------------------------------------------------------------

    #[test]
    fn accepts_filename_safe_ids() {
        for id in ["ship-feature", "a", "Graph_2.v1", "x.", "con-x", "CONSOLE", "com10"] {
            assert_eq!(validate_id(id), Ok(()), "{id}");
        }
        assert_eq!(validate_id(&"a".repeat(MAX_ID_LEN)), Ok(()));
    }

    #[test]
    fn refuses_empty_long_and_leading_dot_ids() {
        assert!(validate_id("").is_err());
        assert!(validate_id(&"a".repeat(MAX_ID_LEN + 1)).is_err());
        assert!(validate_id(".hidden").is_err());
        assert!(validate_id(".").is_err());
        assert!(validate_id("..").is_err());
    }

    #[test]
    fn refuses_characters_outside_the_safe_set() {
        for id in ["a b", "a/b", "a\\b", "c:x", "a*", "é", "a\0", "../x", "a\nb"] {
            assert!(validate_id(id).is_err(), "{id:?}");
        }
    }

    #[test]
    fn refuses_windows_reserved_names_with_or_without_an_extension() {
        for id in ["CON", "con", "Prn", "AUX", "nul", "nul.x", "COM1", "com9.json", "LPT1", "lpt0", "COM0"] {
            assert!(validate_id(id).is_err(), "{id}");
        }
    }

    // --- the project check -----------------------------------------------------------

    #[test]
    fn a_registered_project_resolves_to_its_canonical_root() {
        let repo = temp_repo();
        // The path as the frontend sends it: not verbatim, with a trailing separator.
        let plain = repo.display().to_string().trim_start_matches(r"\\?\").to_string();
        let raw = format!("{}{}", plain, std::path::MAIN_SEPARATOR);
        let got = resolve_project(&raw, &[plain]).unwrap();
        assert_eq!(got, repo.path());
    }

    /// Lays out git's link files for a worktree of `main` at `worktree`, the way
    /// `git worktree add` writes them (forward slashes, a relative `commondir`).
    fn link_worktree(main: &Path, worktree: &Path, name: &str) -> PathBuf {
        let slash = |p: &Path| p.display().to_string().trim_start_matches(r"\\?\").replace('\\', "/");
        let worktree_git = main.join(".git").join("worktrees").join(name);
        std::fs::create_dir_all(&worktree_git).unwrap();
        std::fs::write(worktree_git.join("gitdir"), format!("{}/.git\n", slash(worktree))).unwrap();
        std::fs::write(worktree_git.join("commondir"), "../..\n").unwrap();
        std::fs::write(worktree.join(".git"), format!("gitdir: {}\n", slash(&worktree_git))).unwrap();
        worktree_git
    }

    #[test]
    fn a_worktree_of_a_registered_project_resolves() {
        let main = temp_repo();
        let worktree = temp_repo();
        link_worktree(&main, &worktree, "wt");
        let got = resolve_project(&worktree.display().to_string(), &[main.display().to_string()]).unwrap();
        assert_eq!(got, worktree.path());
    }

    #[test]
    fn a_worktree_of_an_unregistered_project_is_refused() {
        let main = temp_repo();
        let other = temp_repo();
        let worktree = temp_repo();
        link_worktree(&main, &worktree, "wt");
        assert!(resolve_project(&worktree.display().to_string(), &[other.display().to_string()]).is_err());
    }

    #[test]
    fn a_git_link_that_the_main_checkout_does_not_link_back_is_refused() {
        let main = temp_repo();
        let real = temp_repo();
        let forged = temp_repo();
        let worktree_git = link_worktree(&main, &real, "wt");
        // `forged` claims the worktree folder, which points back at `real`, not at it.
        let slash = worktree_git.display().to_string().trim_start_matches(r"\\?\").replace('\\', "/");
        std::fs::write(forged.join(".git"), format!("gitdir: {}\n", slash)).unwrap();
        assert!(resolve_project(&forged.display().to_string(), &[main.display().to_string()]).is_err());
    }

    #[test]
    fn an_unregistered_folder_is_refused() {
        let repo = temp_repo();
        let other = temp_repo();
        assert!(resolve_project(&other.display().to_string(), &[repo.display().to_string()]).is_err());
        assert!(resolve_project("", &[repo.display().to_string()]).is_err());
    }

    // --- listing ---------------------------------------------------------------------

    #[test]
    fn a_missing_folder_lists_nothing() {
        let repo = temp_repo();
        let list = list_definitions(&repo, PraxisKind::Graphs).unwrap();
        assert!(list.entries.is_empty());
        assert!(!list.truncated);
    }

    #[test]
    fn lists_json_files_in_id_order_and_ignores_everything_else() {
        let repo = temp_repo();
        write(&repo, ".praxis/graphs/b.json", "{}");
        write(&repo, ".praxis/graphs/a.json", "{}");
        write(&repo, ".praxis/graphs/notes.txt", "x");
        write(&repo, ".praxis/graphs/nested/c.json", "{}");
        write(&repo, ".praxis/graphs/d.json.tmp-1234", "{}");
        write(&repo, ".praxis/unknown/e.json", "{}");
        let list = list_definitions(&repo, PraxisKind::Graphs).unwrap();
        assert_eq!(ids(&list), vec!["a", "b"]);
        assert!(list.entries.iter().all(|e| e.problem.is_none()));
        assert!(list_definitions(&repo, PraxisKind::Contracts).unwrap().entries.is_empty());
    }

    #[test]
    fn caps_a_listing_at_the_limit_and_flags_it_truncated() {
        let repo = temp_repo();
        let dir = repo.join(".praxis/grants");
        std::fs::create_dir_all(&dir).unwrap();
        for i in 0..=MAX_LISTED {
            std::fs::write(dir.join(format!("g{i:04}.json")), "{}").unwrap();
        }
        let list = list_definitions(&repo, PraxisKind::Grants).unwrap();
        assert_eq!(list.entries.len(), MAX_LISTED);
        assert!(list.truncated);
        assert_eq!(list.entries[0].id, "g0000");

        std::fs::remove_file(dir.join(format!("g{MAX_LISTED:04}.json"))).unwrap();
        let list = list_definitions(&repo, PraxisKind::Grants).unwrap();
        assert_eq!(list.entries.len(), MAX_LISTED);
        assert!(!list.truncated);
    }

    #[test]
    fn flags_invalid_json_with_its_position_and_non_objects() {
        let repo = temp_repo();
        write(&repo, ".praxis/triggers/broken.json", "{\n  \"id\": \"broken\",\n  oops\n}");
        write(&repo, ".praxis/triggers/list.json", "[1, 2]");
        write(&repo, ".praxis/triggers/bom.json", "\u{feff}{\"id\": \"bom\"}");
        let list = list_definitions(&repo, PraxisKind::Triggers).unwrap();
        let by_id = |id: &str| list.entries.iter().find(|e| e.id == id).unwrap().problem.clone();

        let broken = by_id("broken").expect("a parse error");
        assert_eq!(broken.line, Some(3));
        assert_eq!(broken.column, Some(3));
        let list_problem = by_id("list").expect("not an object");
        assert!(list_problem.message.contains("object"), "{}", list_problem.message);
        assert_eq!(list_problem.line, None);
        assert_eq!(by_id("bom"), None);
    }

    #[test]
    fn flags_a_file_whose_name_is_not_a_valid_id() {
        let repo = temp_repo();
        write(&repo, ".praxis/graphs/has space.json", "{}");
        let list = list_definitions(&repo, PraxisKind::Graphs).unwrap();
        assert_eq!(ids(&list), vec!["has space"]);
        assert!(list.entries[0].problem.is_some());
    }

    #[test]
    fn flags_a_file_whose_id_differs_from_its_name() {
        let repo = temp_repo();
        write(&repo, ".praxis/graphs/a.json", r#"{"id": "b"}"#);
        write(&repo, ".praxis/graphs/c.json", r#"{"nodes": []}"#);
        write(&repo, ".praxis/graphs/d.json", r#"{"id": "d"}"#);
        write(&repo, ".praxis/graphs/e.json", r#"{"id": 5}"#);
        write(&repo, ".praxis/graphs/f.json", "{nope");
        let list = list_definitions(&repo, PraxisKind::Graphs).unwrap();
        let by_id = |id: &str| list.entries.iter().find(|e| e.id == id).unwrap().id_mismatch.clone();
        assert_eq!(by_id("a"), Some(IdMismatch { found: Some("b".to_string()) }));
        assert_eq!(by_id("c"), Some(IdMismatch { found: None }));
        assert_eq!(by_id("d"), None);
        assert_eq!(by_id("e"), Some(IdMismatch { found: None }));
        assert_eq!(by_id("f"), None, "a file that doesn't parse has a problem instead");
    }

    #[test]
    fn a_template_is_named_by_its_file_alone() {
        let repo = temp_repo();
        write(&repo, ".praxis/templates/fix-bug.json", r#"{"description": "d"}"#);
        let list = list_definitions(&repo, PraxisKind::Templates).unwrap();
        assert_eq!(ids(&list), vec!["fix-bug"]);
        assert_eq!(list.entries[0].id_mismatch, None);
    }

    #[test]
    fn a_template_whose_name_the_host_refuses_is_flagged_and_still_opens() {
        let repo = temp_repo();
        write(&repo, ".praxis/templates/Fix_Bug.json", r#"{"description": "d"}"#);
        write(&repo, ".praxis/templates/fix-bug.json", r#"{"description": "d"}"#);
        write(&repo, ".praxis/graphs/Fix_Bug.json", r#"{"id": "Fix_Bug"}"#);
        let templates = list_definitions(&repo, PraxisKind::Templates).unwrap();
        let by_id = |id: &str| templates.entries.iter().find(|e| e.id == id).unwrap().clone();
        assert_eq!(by_id("Fix_Bug").name_problem.as_deref(), Some(TEMPLATE_NAME_RULE));
        assert_eq!(by_id("Fix_Bug").problem, None, "the file still opens");
        assert_eq!(by_id("fix-bug").name_problem, None);
        let graphs = list_definitions(&repo, PraxisKind::Graphs).unwrap();
        assert_eq!(graphs.entries[0].name_problem, None, "only templates/ narrows");
    }

    /// One workflow template file and the `templateDigest` the AI-WS-SDK engine gives it at the
    /// vendored pin, computed by the engine's own code. The fixture states how it was made.
    fn engine_template_digest() -> (String, String) {
        let fixture: Value = serde_json::from_str(include_str!("template_digest.fixture.json")).unwrap();
        (fixture["file"].as_str().unwrap().to_string(), fixture["templateDigest"].as_str().unwrap().to_string())
    }

    #[test]
    fn a_template_file_lists_with_the_digest_the_engine_gives_it() {
        let repo = temp_repo();
        let (file, digest) = engine_template_digest();
        write(&repo, ".praxis/templates/review-code.json", &file);
        let list = list_definitions(&repo, PraxisKind::Templates).unwrap();
        assert_eq!(list.entries[0].template_digest.as_deref(), Some(digest.as_str()));
    }

    #[test]
    fn a_saved_template_has_the_digest_the_engine_gives_its_file() {
        let repo = temp_repo();
        let (file, digest) = engine_template_digest();
        let content: Value = serde_json::from_str(&file).unwrap();
        let outcome = save_definition(&repo, PraxisKind::Templates, "review-code", content, None, None, None, None, false).unwrap();
        let SaveOutcome::Saved { template_digest, .. } = outcome else { panic!("{outcome:?}") };
        assert_eq!(template_digest.as_deref(), Some(digest.as_str()));
        // Quay writes the file in its own key order, and the digest is still the engine's.
        assert_ne!(std::fs::read_to_string(repo.join(".praxis/templates/review-code.json")).unwrap(), file);
        let list = list_definitions(&repo, PraxisKind::Templates).unwrap();
        assert_eq!(list.entries[0].template_digest.as_deref(), Some(digest.as_str()));
    }

    #[test]
    fn only_a_template_file_that_parses_strictly_has_a_digest() {
        let repo = temp_repo();
        write(&repo, ".praxis/templates/broken.json", r#"{"description": "#);
        write(&repo, ".praxis/templates/twice.json", r#"{"description": "a", "description": "b"}"#);
        write(&repo, ".praxis/graphs/g.json", r#"{"id": "g"}"#);
        let list = list_definitions(&repo, PraxisKind::Templates).unwrap();
        assert!(list.entries.iter().all(|e| e.template_digest.is_none()), "{list:?}");
        assert_eq!(list_definitions(&repo, PraxisKind::Graphs).unwrap().entries[0].template_digest, None);
    }

    #[test]
    fn a_new_template_must_have_a_name_the_host_accepts_but_a_saved_one_still_saves() {
        let repo = temp_repo();
        let template = json!({"description": "d"});
        let why = save_definition(&repo, PraxisKind::Templates, "Fix_Bug", template.clone(), None, None, None, None, false).unwrap_err();
        assert_eq!(why, TEMPLATE_NAME_RULE);
        assert!(!repo.join(".praxis/templates/Fix_Bug.json").exists());
        assert!(save_definition(&repo, PraxisKind::Templates, "fix-bug", template.clone(), None, None, None, None, false).is_ok());
        assert!(save_definition(&repo, PraxisKind::Graphs, "Fix_Bug", graph(), None, None, None, None, false).is_ok());
        // A file already named badly can be edited and saved until it is renamed.
        write(&repo, ".praxis/templates/Old.Name.json", r#"{"description": "d"}"#);
        let hash = read_definition(&repo, PraxisKind::Templates, "Old.Name").unwrap().content_hash.unwrap();
        let outcome = save_definition(&repo, PraxisKind::Templates, "Old.Name", json!({"description": "e"}), None, None, Some(&hash), None, false);
        assert!(matches!(outcome, Ok(SaveOutcome::Saved { .. })), "{outcome:?}");
    }

    // --- graph workflows (#459) ------------------------------------------------------------

    const WORKFLOW: &str = r#"{"graphBindingId": "g-1", "graphId": "g", "contractId": "c", "version": 1}"#;

    #[test]
    fn a_graph_workflow_is_named_by_its_file_and_one_the_host_refuses_is_flagged() {
        let repo = temp_repo();
        write(&repo, ".praxis/graph-workflows/ship-it.json", WORKFLOW);
        write(&repo, ".praxis/graph-workflows/Ship_It.json", WORKFLOW);
        let list = list_definitions(&repo, PraxisKind::GraphWorkflows).unwrap();
        let by_id = |id: &str| list.entries.iter().find(|e| e.id == id).unwrap().clone();
        assert_eq!(by_id("ship-it").id_mismatch, None, "a graph workflow holds no id");
        assert_eq!(by_id("ship-it").name_problem, None);
        assert_eq!(by_id("Ship_It").name_problem.as_deref(), Some(GRAPH_WORKFLOW_NAME_RULE));
        assert_eq!(by_id("Ship_It").problem, None, "it still opens");
        let read = read_definition(&repo, PraxisKind::GraphWorkflows, "ship-it").unwrap();
        assert_eq!(read.content.unwrap()["graphBindingId"], "g-1");
    }

    /// Saves the bundle of `host/bundle_digest.fixture.json` as graph workflow `ship`, and gives
    /// the `bundleDigest` the AI-WS-SDK engine computes for its files. The fixture says how it was made.
    fn engine_bundle(repo: &Path) -> String {
        let fixture: Value = serde_json::from_str(include_str!("host/bundle_digest.fixture.json")).unwrap();
        let id = |part: &Value| part["id"].as_str().unwrap().to_string();
        let file = |part: &Value| part["file"].as_str().unwrap().to_string();
        let (graph, binding, contract) = (&fixture["graph"], &fixture["binding"], &fixture["contract"]);
        write(repo, &format!(".praxis/graphs/{}.json", id(graph)), &file(graph));
        write(repo, &format!(".praxis/graph-bindings/{}.json", id(binding)), &file(binding));
        write(repo, &format!(".praxis/contracts/{}.json", id(contract)), &file(contract));
        let grants = fixture["grants"].as_array().unwrap();
        for grant in grants {
            write(repo, &format!(".praxis/grants/{}.json", id(grant)), &file(grant));
        }
        let listed: Vec<String> = grants.iter().map(id).collect();
        let bindings = json!({ "version": 1, "graphs": [id(graph)], "grants": listed });
        write(repo, &format!(".praxis/bindings/{}.json", id(contract)), &bindings.to_string());
        let workflow = json!({ "version": 1, "contractId": id(contract), "graphId": id(graph), "graphBindingId": id(binding) });
        write(repo, ".praxis/graph-workflows/ship.json", &workflow.to_string());
        fixture["bundleDigest"].as_str().unwrap().to_string()
    }

    #[test]
    fn a_graph_workflow_lists_with_the_bundle_digest_the_engine_gives_its_saved_files() {
        let repo = temp_repo();
        let digest = engine_bundle(&repo);
        let list = list_definitions(&repo, PraxisKind::GraphWorkflows).unwrap();
        assert_eq!(list.entries[0].bundle_digest.as_deref(), Some(digest.as_str()));
        // Only graph workflows have one.
        assert!(list_definitions(&repo, PraxisKind::Graphs).unwrap().entries.iter().all(|e| e.bundle_digest.is_none()));
    }

    #[test]
    fn a_graph_workflow_whose_bundle_isnt_whole_or_strict_json_has_no_bundle_digest() {
        let digest_after = |change: &dyn Fn(&Path)| {
            let repo = temp_repo();
            engine_bundle(&repo);
            change(&repo);
            list_definitions(&repo, PraxisKind::GraphWorkflows).unwrap().entries[0].bundle_digest.clone()
        };
        let fixture: Value = serde_json::from_str(include_str!("host/bundle_digest.fixture.json")).unwrap();
        let grant = format!(".praxis/grants/{}.json", fixture["grants"][0]["id"].as_str().unwrap());
        let contract = format!(".praxis/contracts/{}.json", fixture["contract"]["id"].as_str().unwrap());
        assert_eq!(digest_after(&|repo| std::fs::remove_file(repo.join(&grant)).unwrap()), None, "a grant is missing");
        // praxis refuses a file that isn't strict JSON, so the host can have no digest for it.
        assert_eq!(digest_after(&|repo| write(repo, &contract, r#"{"id": "release", "id": "release"}"#)), None, "a duplicate key");
        assert_eq!(digest_after(&|repo| write(repo, ".praxis/graph-workflows/ship.json", r#"{"version": 1}"#)), None, "nothing picked");
    }

    #[test]
    fn a_graph_workflow_lists_with_its_contract_id_so_a_trigger_can_take_it() {
        let repo = temp_repo();
        write(&repo, ".praxis/graph-workflows/ship.json", WORKFLOW);
        write(&repo, ".praxis/graph-workflows/odd.json", "{\"version\": 1, \"contractId\": 3}");
        write(&repo, ".praxis/triggers/t.json", "{\"id\": \"t\", \"contractId\": \"c\"}");
        let list = list_definitions(&repo, PraxisKind::GraphWorkflows).unwrap();
        let contract = |id: &str| list.entries.iter().find(|e| e.id == id).unwrap().contract_id.clone();
        assert_eq!(contract("ship").as_deref(), Some("c"));
        assert_eq!(contract("odd"), None);
        // Only graph workflows list it.
        assert_eq!(list_definitions(&repo, PraxisKind::Triggers).unwrap().entries[0].contract_id, None);
    }

    #[test]
    fn a_graph_workflow_lists_with_its_graph_and_binding_so_the_graph_canvas_can_show_it() {
        let repo = temp_repo();
        write(&repo, ".praxis/graph-workflows/ship.json", WORKFLOW);
        write(&repo, ".praxis/graph-workflows/odd.json", "{\"version\": 1, \"graphId\": 3, \"graphBindingId\": null}");
        write(&repo, ".praxis/graph-bindings/b.json", "{\"graphBindingId\": \"b\", \"graphId\": \"g\"}");
        let list = list_definitions(&repo, PraxisKind::GraphWorkflows).unwrap();
        let entry = |id: &str| list.entries.iter().find(|e| e.id == id).unwrap().clone();
        assert_eq!(entry("ship").graph_id.as_deref(), Some("g"));
        assert_eq!(entry("ship").graph_binding_id.as_deref(), Some("g-1"));
        assert_eq!((entry("odd").graph_id, entry("odd").graph_binding_id), (None, None));
        // A graph binding still lists its graph, and no binding id of its own.
        let binding = &list_definitions(&repo, PraxisKind::GraphBindings).unwrap().entries[0];
        assert_eq!((binding.graph_id.as_deref(), binding.graph_binding_id.as_deref()), (Some("g"), None));
    }

    #[test]
    fn a_new_graph_workflow_must_have_a_name_the_host_accepts_and_saves_in_record_order() {
        let repo = temp_repo();
        let workflow: Value = serde_json::from_str(WORKFLOW).unwrap();
        let why = save_definition(&repo, PraxisKind::GraphWorkflows, "Ship.It", workflow.clone(), None, None, None, None, false).unwrap_err();
        assert_eq!(why, GRAPH_WORKFLOW_NAME_RULE);
        assert!(!repo.join(".praxis/graph-workflows/Ship.It.json").exists());
        let outcome = save_definition(&repo, PraxisKind::GraphWorkflows, "ship-it", workflow, None, None, None, None, false).unwrap();
        assert!(matches!(outcome, SaveOutcome::Saved { template_digest: None, .. }), "{outcome:?}");
        assert_eq!(
            read(&repo, ".praxis/graph-workflows/ship-it.json"),
            "{\n  \"version\": 1,\n  \"contractId\": \"c\",\n  \"graphId\": \"g\",\n  \"graphBindingId\": \"g-1\"\n}\n"
        );
    }

    #[test]
    fn flags_a_file_over_the_size_limit_without_parsing_it() {
        let repo = temp_repo();
        write(&repo, ".praxis/graphs/big.json", &" ".repeat(MAX_FILE_BYTES as usize + 1));
        let list = list_definitions(&repo, PraxisKind::Graphs).unwrap();
        let problem = list.entries[0].problem.clone().expect("too large");
        assert!(problem.message.contains("larger"), "{}", problem.message);
    }

    // --- confinement -----------------------------------------------------------------

    #[test]
    fn refuses_a_kind_folder_that_links_outside_the_repo() {
        let repo = temp_repo();
        let outside = temp_repo();
        std::fs::write(outside.join("secret.json"), "{}").unwrap();
        link_dir(&outside, &repo.join(".praxis/graphs"));
        assert!(list_definitions(&repo, PraxisKind::Graphs).is_err());
        assert!(read_definition(&repo, PraxisKind::Graphs, "secret").is_err());
        assert!(definition_path(&repo, PraxisKind::Graphs, "secret").is_err());
    }

    #[test]
    fn refuses_a_praxis_folder_that_links_outside_the_repo() {
        let repo = temp_repo();
        let outside = temp_repo();
        write(&outside, "contracts/c.json", "{}");
        link_dir(&outside, &repo.join(".praxis"));
        assert!(list_definitions(&repo, PraxisKind::Contracts).is_err());
    }

    #[test]
    fn skips_a_linked_folder_named_like_a_definition() {
        let repo = temp_repo();
        write(&repo, "elsewhere/inner.json", "{}");
        write(&repo, ".praxis/graphs/real.json", "{}");
        link_dir(&repo.join("elsewhere"), &repo.join(".praxis/graphs/folder.json"));
        assert_eq!(ids(&list_definitions(&repo, PraxisKind::Graphs).unwrap()), vec!["real"]);
    }

    #[test]
    fn a_layout_folder_outside_the_repo_is_reported_and_the_graph_still_opens() {
        let repo = temp_repo();
        let outside = temp_repo();
        std::fs::write(outside.join("g.json"), r#"{"nodes":{}}"#).unwrap();
        write(&repo, ".praxis/graphs/g.json", r#"{"nodes":[]}"#);
        link_dir(&outside, &repo.join(".praxis/layout"));
        let file = read_definition(&repo, PraxisKind::Graphs, "g").unwrap();
        assert!(file.content.is_some());
        assert!(file.layout.is_none());
        assert!(file.layout_problem.unwrap().message.contains("outside"));
    }

    #[test]
    fn allows_a_kind_folder_that_links_inside_the_repo() {
        let repo = temp_repo();
        write(&repo, "defs/graphs/g.json", "{}");
        link_dir(&repo.join("defs/graphs"), &repo.join(".praxis/graphs"));
        assert_eq!(ids(&list_definitions(&repo, PraxisKind::Graphs).unwrap()), vec!["g"]);
    }

    // --- reading ---------------------------------------------------------------------

    #[test]
    fn reads_a_graph_with_its_layout() {
        let repo = temp_repo();
        write(&repo, ".praxis/graphs/g.json", r#"{"id":"g","revision":"r","nodes":[]}"#);
        write(&repo, ".praxis/layout/g.json", r#"{"version":1,"nodes":{"a":{"x":1,"y":2}}}"#);
        let file = read_definition(&repo, PraxisKind::Graphs, "g").unwrap();
        assert_eq!(file.content.unwrap()["id"], "g");
        assert_eq!(file.layout.unwrap()["nodes"]["a"]["y"], 2);
        assert!(file.problem.is_none());
        assert!(file.layout_problem.is_none());
    }

    #[test]
    fn a_missing_layout_is_no_layout_and_a_broken_one_is_reported() {
        let repo = temp_repo();
        write(&repo, ".praxis/graphs/g.json", r#"{"nodes":[]}"#);
        let file = read_definition(&repo, PraxisKind::Graphs, "g").unwrap();
        assert!(file.layout.is_none());
        assert!(file.layout_problem.is_none());

        write(&repo, ".praxis/layout/g.json", "{nope");
        let file = read_definition(&repo, PraxisKind::Graphs, "g").unwrap();
        assert!(file.layout.is_none());
        assert!(file.layout_problem.is_some());
        assert!(file.content.is_some());
    }

    #[test]
    fn only_graphs_read_a_layout() {
        let repo = temp_repo();
        write(&repo, ".praxis/contracts/g.json", "{}");
        write(&repo, ".praxis/layout/g.json", r#"{"nodes":{}}"#);
        let file = read_definition(&repo, PraxisKind::Contracts, "g").unwrap();
        assert!(file.layout.is_none());
    }

    #[test]
    fn a_broken_definition_reads_as_a_problem_not_an_error() {
        let repo = temp_repo();
        write(&repo, ".praxis/graphs/g.json", "{\"a\": }");
        let file = read_definition(&repo, PraxisKind::Graphs, "g").unwrap();
        assert!(file.content.is_none());
        let problem = file.problem.unwrap();
        assert_eq!((problem.line, problem.column), (Some(1), Some(7)));
    }

    #[test]
    fn reading_refuses_bad_ids_and_reports_missing_files() {
        let repo = temp_repo();
        write(&repo, ".praxis/graphs/g.json", "{}");
        assert!(read_definition(&repo, PraxisKind::Graphs, "../graphs/g").is_err());
        let missing = read_definition(&repo, PraxisKind::Graphs, "missing").unwrap();
        assert!(missing.missing);
        assert!(missing.content.is_none() && missing.problem.is_none() && missing.content_hash.is_none());
        assert!(read_definition(&repo, PraxisKind::Contracts, "no-folder").unwrap().missing);
        assert!(definition_path(&repo, PraxisKind::Graphs, "missing").is_err());
        assert_eq!(
            definition_path(&repo, PraxisKind::Graphs, "g").unwrap(),
            repo.join(".praxis").join("graphs").join("g.json")
        );
    }

    #[test]
    fn reading_returns_the_hash_of_the_bytes_on_disk() {
        let repo = temp_repo();
        let body = "{\"id\": \"g\", \"nodes\": []}";
        write(&repo, ".praxis/graphs/g.json", body);
        let file = read_definition(&repo, PraxisKind::Graphs, "g").unwrap();
        assert!(!file.missing);
        assert_eq!(file.content_hash.unwrap(), content_hash(body.as_bytes()));
    }

    // --- saving ----------------------------------------------------------------------

    fn read(repo: &Path, rel: &str) -> String {
        std::fs::read_to_string(repo.join(rel)).unwrap()
    }

    fn graph() -> Value {
        json!({
            "nodes": [
                {"config": {}, "dependsOn": [], "kind": "TASK", "id": "task-1"},
                {"id": "end-1", "kind": "END", "dependsOn": ["task-1"], "config": {}}
            ],
            "id": "g",
            "revision": "1"
        })
    }

    fn saved(outcome: SaveOutcome) -> (Value, String, Option<String>) {
        match outcome {
            SaveOutcome::Saved { content, content_hash, layout_error, .. } => (content, content_hash, layout_error),
            other => panic!("expected a save, got {other:?}"),
        }
    }

    fn layout(nodes: &[(&str, f64, f64)], viewport: Option<(f64, f64, f64)>) -> LayoutInput {
        LayoutInput {
            nodes: nodes
                .iter()
                .map(|(id, x, y)| super::super::models::LayoutPosition { id: id.to_string(), x: *x, y: *y })
                .collect(),
            viewport: viewport.map(|(x, y, zoom)| super::super::models::LayoutViewport { x, y, zoom }),
        }
    }

    #[test]
    fn saving_a_new_graph_writes_the_canonical_file_with_a_revision() {
        let repo = temp_repo();
        let (content, hash, layout_error) =
            saved(save_definition(&repo, PraxisKind::Graphs, "g", graph(), None, None, None, None, false).unwrap());
        assert!(layout_error.is_none());
        let text = read(&repo, ".praxis/graphs/g.json");
        assert!(text.starts_with("{\n  \"id\": \"g\",\n  \"revision\": \"sha256:"), "{text}");
        assert!(text.ends_with("}\n") && !text.contains('\r'));
        assert_eq!(hash, content_hash(text.as_bytes()));
        assert_eq!(serde_json::from_str::<Value>(&text).unwrap(), content);
        assert_eq!(content["nodes"][0]["id"], "task-1");
        assert!(!repo.join(".praxis/layout").exists(), "no layout was sent");
    }

    #[test]
    fn saving_unchanged_content_again_leaves_the_bytes_alone() {
        let repo = temp_repo();
        let (content, hash, _) =
            saved(save_definition(&repo, PraxisKind::Graphs, "g", graph(), None, None, None, None, false).unwrap());
        let before = read(&repo, ".praxis/graphs/g.json");
        let (_, again, _) =
            saved(save_definition(&repo, PraxisKind::Graphs, "g", content, None, None, Some(&hash), None, false).unwrap());
        assert_eq!(read(&repo, ".praxis/graphs/g.json"), before);
        assert_eq!(again, hash);
    }

    #[test]
    fn a_file_changed_since_it_was_loaded_is_a_conflict_until_forced() {
        let repo = temp_repo();
        let (content, hash, _) =
            saved(save_definition(&repo, PraxisKind::Graphs, "g", graph(), None, None, None, None, false).unwrap());
        write(&repo, ".praxis/graphs/g.json", "{\"id\": \"g\", \"edited\": true}");
        let outcome = save_definition(&repo, PraxisKind::Graphs, "g", content.clone(), None, None, Some(&hash), None, false).unwrap();
        assert_eq!(outcome, SaveOutcome::Conflict { reason: ConflictReason::Changed });
        assert!(read(&repo, ".praxis/graphs/g.json").contains("edited"), "a conflict writes nothing");

        let (_, forced, _) =
            saved(save_definition(&repo, PraxisKind::Graphs, "g", content, None, None, Some(&hash), None, true).unwrap());
        assert_eq!(forced, hash);
        assert!(!read(&repo, ".praxis/graphs/g.json").contains("edited"));
    }

    #[test]
    fn a_deleted_file_is_a_conflict_until_forced() {
        let repo = temp_repo();
        let (content, hash, _) =
            saved(save_definition(&repo, PraxisKind::Graphs, "g", graph(), None, None, None, None, false).unwrap());
        std::fs::remove_file(repo.join(".praxis/graphs/g.json")).unwrap();
        let outcome = save_definition(&repo, PraxisKind::Graphs, "g", content.clone(), None, None, Some(&hash), None, false).unwrap();
        assert_eq!(outcome, SaveOutcome::Conflict { reason: ConflictReason::Deleted });
        assert!(!repo.join(".praxis/graphs/g.json").exists());
        saved(save_definition(&repo, PraxisKind::Graphs, "g", content, None, None, Some(&hash), None, true).unwrap());
        assert!(repo.join(".praxis/graphs/g.json").exists());
    }

    #[test]
    fn saving_refuses_an_id_that_is_taken_or_not_filename_safe() {
        let repo = temp_repo();
        write(&repo, ".praxis/graphs/Taken.json", "{}");
        assert!(save_definition(&repo, PraxisKind::Graphs, "Taken", graph(), None, None, None, None, false).is_err());
        assert!(save_definition(&repo, PraxisKind::Graphs, "taken", graph(), None, None, None, None, false).is_err());
        assert!(save_definition(&repo, PraxisKind::Graphs, "taken", graph(), None, None, None, None, true).is_err());
        assert_eq!(read(&repo, ".praxis/graphs/Taken.json"), "{}");
        for bad in ["../g", "a b", "nul", ".g"] {
            assert!(save_definition(&repo, PraxisKind::Graphs, bad, graph(), None, None, None, None, false).is_err(), "{bad}");
        }
        assert!(save_definition(&repo, PraxisKind::Graphs, "g", json!([1]), None, None, None, None, false).is_err());
    }

    #[test]
    fn saving_writes_an_invalid_graph() {
        let repo = temp_repo();
        // No nodes, an unknown kind and a dangling dependency: the schema refuses all three.
        let invalid = json!({"id": "g", "nodes": [{"id": "a", "kind": "NOPE", "dependsOn": ["ghost"]}]});
        saved(save_definition(&repo, PraxisKind::Graphs, "g", invalid, None, None, None, None, false).unwrap());
        assert!(read(&repo, ".praxis/graphs/g.json").contains("NOPE"));
    }

    #[test]
    fn the_layout_is_written_with_integer_positions_the_viewport_and_no_deleted_nodes() {
        let repo = temp_repo();
        let sent = layout(
            &[("end-1", 10.4, -3.6), ("gone", 1.0, 1.0), ("task-1", 0.5, 99.0)],
            Some((-12.7, 40.2, 0.81234)),
        );
        saved(save_definition(&repo, PraxisKind::Graphs, "g", graph(), Some(&sent), None, None, None, false).unwrap());
        assert_eq!(
            read(&repo, ".praxis/layout/g.json"),
            "{\n  \"version\": 1,\n  \"nodes\": {\n    \"task-1\": {\n      \"x\": 1,\n      \"y\": 99\n    },\n    \"end-1\": {\n      \"x\": 10,\n      \"y\": -4\n    }\n  },\n  \"viewport\": {\n    \"x\": -13,\n    \"y\": 40,\n    \"zoom\": 0.812\n  }\n}\n"
        );
    }

    #[test]
    fn saving_refuses_positions_that_are_not_finite_and_writes_nothing() {
        let repo = temp_repo();
        let sent = layout(&[("task-1", f64::NAN, 0.0)], None);
        assert!(save_definition(&repo, PraxisKind::Graphs, "g", graph(), Some(&sent), None, None, None, false).is_err());
        let sent = layout(&[], Some((0.0, 0.0, 0.0)));
        assert!(save_definition(&repo, PraxisKind::Graphs, "g", graph(), Some(&sent), None, None, None, false).is_err());
        assert!(!repo.join(".praxis").exists());
    }

    #[test]
    fn only_graphs_write_a_layout() {
        let repo = temp_repo();
        let sent = layout(&[], None);
        saved(save_definition(&repo, PraxisKind::Contracts, "c", json!({"id": "c"}), Some(&sent), None, None, None, false).unwrap());
        assert!(!repo.join(".praxis/layout").exists());
    }

    #[test]
    fn saving_refuses_a_praxis_folder_that_links_outside_the_repo() {
        let repo = temp_repo();
        let outside = temp_repo();
        link_dir(&outside, &repo.join(".praxis"));
        assert!(save_definition(&repo, PraxisKind::Graphs, "g", graph(), None, None, None, None, false).is_err());
        assert!(!outside.join("graphs").exists(), "nothing is created through the link");
    }

    #[test]
    fn a_layout_folder_outside_the_repo_is_reported_and_the_graph_is_saved() {
        let repo = temp_repo();
        let outside = temp_repo();
        link_dir(&outside, &repo.join(".praxis/layout"));
        let sent = layout(&[("task-1", 0.0, 0.0)], None);
        let (_, _, layout_error) =
            saved(save_definition(&repo, PraxisKind::Graphs, "g", graph(), Some(&sent), None, None, None, false).unwrap());
        assert!(layout_error.unwrap().contains("outside"));
        assert!(repo.join(".praxis/graphs/g.json").exists());
        assert!(!outside.join("g.json").exists());
    }

    // --- contract bindings -------------------------------------------------------------

    fn bindings(graphs: &[&str], grants: &[&str]) -> BindingsInput {
        BindingsInput {
            graphs: graphs.iter().map(|s| s.to_string()).collect(),
            grants: grants.iter().map(|s| s.to_string()).collect(),
        }
    }

    fn saved_bindings(outcome: SaveOutcome) -> (String, Option<String>, Option<String>) {
        match outcome {
            SaveOutcome::Saved { content_hash, bindings_hash, bindings_error, .. } => (content_hash, bindings_hash, bindings_error),
            other => panic!("expected a save, got {other:?}"),
        }
    }

    #[test]
    fn saving_a_contract_writes_its_bindings_without_repeats() {
        let repo = temp_repo();
        let sent = bindings(&["g1", "g2", "g1"], &["a"]);
        let (_, hash, error) = saved_bindings(
            save_definition(&repo, PraxisKind::Contracts, "c", json!({"id": "c"}), None, Some(&sent), None, None, false)
                .unwrap(),
        );
        assert_eq!(error, None);
        let text = read(&repo, ".praxis/bindings/c.json");
        assert_eq!(text, "{\n  \"version\": 1,\n  \"graphs\": [\n    \"g1\",\n    \"g2\"\n  ],\n  \"grants\": [\n    \"a\"\n  ]\n}\n");
        assert_eq!(hash, Some(content_hash(text.as_bytes())));

        let file = read_definition(&repo, PraxisKind::Contracts, "c").unwrap();
        assert_eq!(file.bindings, Some(json!({"version": 1, "graphs": ["g1", "g2"], "grants": ["a"]})));
        assert_eq!(file.bindings_hash, hash);
    }

    #[test]
    fn only_contracts_write_bindings() {
        let repo = temp_repo();
        let sent = bindings(&["g"], &[]);
        saved(save_definition(&repo, PraxisKind::Graphs, "g", graph(), None, Some(&sent), None, None, false).unwrap());
        assert!(!repo.join(".praxis/bindings").exists());
    }

    #[test]
    fn bindings_refuse_an_id_that_isnt_filename_safe() {
        let repo = temp_repo();
        let sent = bindings(&["a/b"], &[]);
        assert!(save_definition(&repo, PraxisKind::Contracts, "c", json!({"id": "c"}), None, Some(&sent), None, None, false)
            .is_err());
        assert!(!repo.join(".praxis").exists(), "nothing is written");
    }

    #[test]
    fn a_bindings_file_changed_since_the_draft_loaded_it_is_a_conflict() {
        let repo = temp_repo();
        let sent = bindings(&["g"], &[]);
        let (hash, bindings_hash, _) = saved_bindings(
            save_definition(&repo, PraxisKind::Contracts, "c", json!({"id": "c"}), None, Some(&sent), None, None, false)
                .unwrap(),
        );
        write(&repo, ".praxis/bindings/c.json", "{\"version\": 1, \"graphs\": [], \"grants\": []}\n");
        let outcome = save_definition(
            &repo,
            PraxisKind::Contracts,
            "c",
            json!({"id": "c"}),
            None,
            Some(&sent),
            Some(&hash),
            bindings_hash.as_deref(),
            false,
        )
        .unwrap();
        assert_eq!(outcome, SaveOutcome::Conflict { reason: ConflictReason::Changed });
        // A bindings file that appeared where the draft loaded none conflicts too.
        std::fs::remove_file(repo.join(".praxis/bindings/c.json")).unwrap();
        let (hash, _, _) = saved_bindings(
            save_definition(&repo, PraxisKind::Contracts, "c", json!({"id": "c"}), None, None, Some(&hash), None, true)
                .unwrap(),
        );
        write(&repo, ".praxis/bindings/c.json", "{}\n");
        let outcome =
            save_definition(&repo, PraxisKind::Contracts, "c", json!({"id": "c"}), None, Some(&sent), Some(&hash), None, false)
                .unwrap();
        assert_eq!(outcome, SaveOutcome::Conflict { reason: ConflictReason::Changed });
        // Forcing overwrites it.
        saved_bindings(
            save_definition(&repo, PraxisKind::Contracts, "c", json!({"id": "c"}), None, Some(&sent), Some(&hash), None, true)
                .unwrap(),
        );
        assert!(read(&repo, ".praxis/bindings/c.json").contains("\"g\""));
    }

    #[test]
    fn a_bindings_file_that_doesnt_parse_is_reported_and_the_contract_opens() {
        let repo = temp_repo();
        write(&repo, ".praxis/contracts/c.json", "{\"id\": \"c\"}\n");
        write(&repo, ".praxis/bindings/c.json", "{nope");
        let file = read_definition(&repo, PraxisKind::Contracts, "c").unwrap();
        assert!(file.content.is_some());
        assert_eq!(file.bindings, None);
        assert!(file.bindings_problem.is_some());
        assert!(file.bindings_hash.is_some());
    }

    // --- trigger targets (#472) ----------------------------------------------------------

    fn starts(id: Option<&str>) -> TargetInput {
        TargetInput { graph_workflow: id.map(str::to_string) }
    }

    fn saved_target(outcome: SaveOutcome) -> (String, Option<String>, Option<String>) {
        match outcome {
            SaveOutcome::Saved { content_hash, target_hash, target_error, .. } => (content_hash, target_hash, target_error),
            other => panic!("expected a save, got {other:?}"),
        }
    }

    fn trigger_record() -> Value {
        json!({"id": "t", "contractId": "c"})
    }

    #[test]
    fn saving_a_trigger_with_a_target_writes_the_target_file_and_reads_it_back() {
        let repo = temp_repo();
        let (_, hash, error) = saved_target(
            save_trigger_with_target(&repo, "t", trigger_record(), &starts(Some("ship")), None, None, false).unwrap(),
        );
        assert_eq!(error, None);
        let text = read(&repo, ".praxis/trigger-targets/t.json");
        assert_eq!(text, "{\n  \"version\": 1,\n  \"graphWorkflow\": \"ship\"\n}\n");
        assert_eq!(hash, Some(content_hash(text.as_bytes())));
        // The trigger file stays a plain trigger, the same as one saved without a target.
        let trigger = read(&repo, ".praxis/triggers/t.json");
        let plain = temp_repo();
        saved(save_definition(&plain, PraxisKind::Triggers, "t", trigger_record(), None, None, None, None, false).unwrap());
        assert_eq!(trigger, read(&plain, ".praxis/triggers/t.json"));
        assert!(!trigger.contains("ship"));

        let file = read_definition(&repo, PraxisKind::Triggers, "t").unwrap();
        assert_eq!(file.target, Some(json!({"version": 1, "graphWorkflow": "ship"})));
        assert_eq!(file.target_hash, hash);
        assert_eq!(file.target_problem, None);
    }

    /// The trigger file's modified time, after setting it to an old time so a rewrite shows.
    fn aged(repo: &Path, rel: &str) -> std::time::SystemTime {
        let old = std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1_000_000_000);
        let file = std::fs::OpenOptions::new().write(true).open(repo.join(rel)).unwrap();
        file.set_modified(old).unwrap();
        std::fs::metadata(repo.join(rel)).unwrap().modified().unwrap()
    }

    #[test]
    fn setting_or_clearing_a_target_leaves_the_trigger_file_alone_and_clearing_removes_the_target() {
        let repo = temp_repo();
        let (hash, _, _) =
            saved_target(save_definition(&repo, PraxisKind::Triggers, "t", trigger_record(), None, None, None, None, false).unwrap());
        let content = read_definition(&repo, PraxisKind::Triggers, "t").unwrap().content.unwrap();
        let before = aged(&repo, ".praxis/triggers/t.json");

        let (hash, target_hash, error) = saved_target(
            save_trigger_with_target(&repo, "t", content.clone(), &starts(Some("ship")), Some(&hash), None, false).unwrap(),
        );
        assert_eq!(error, None);
        assert!(repo.join(".praxis/trigger-targets/t.json").is_file());
        assert_eq!(std::fs::metadata(repo.join(".praxis/triggers/t.json")).unwrap().modified().unwrap(), before);

        let (_, cleared, error) = saved_target(
            save_trigger_with_target(&repo, "t", content, &starts(None), Some(&hash), target_hash.as_deref(), false).unwrap(),
        );
        assert_eq!((cleared, error), (None, None));
        assert!(!repo.join(".praxis/trigger-targets/t.json").exists());
        assert_eq!(std::fs::metadata(repo.join(".praxis/triggers/t.json")).unwrap().modified().unwrap(), before);
        let file = read_definition(&repo, PraxisKind::Triggers, "t").unwrap();
        assert_eq!((file.target, file.target_hash), (None, None));
    }

    #[test]
    fn a_target_file_changed_since_the_draft_loaded_it_is_a_conflict_until_forced() {
        let repo = temp_repo();
        let (hash, target_hash, _) = saved_target(
            save_trigger_with_target(&repo, "t", trigger_record(), &starts(Some("ship")), None, None, false).unwrap(),
        );
        write(&repo, ".praxis/trigger-targets/t.json", "{\"version\": 1, \"graphWorkflow\": \"other\"}\n");
        let save = |force| {
            save_trigger_with_target(&repo, "t", trigger_record(), &starts(None), Some(&hash), target_hash.as_deref(), force).unwrap()
        };
        assert_eq!(save(false), SaveOutcome::Conflict { reason: ConflictReason::Changed });
        assert!(repo.join(".praxis/trigger-targets/t.json").is_file(), "nothing was removed");
        saved_target(save(true));
        assert!(!repo.join(".praxis/trigger-targets/t.json").exists());
    }

    #[test]
    fn a_target_refuses_a_graph_workflow_id_that_isnt_filename_safe_and_only_triggers_have_one() {
        let repo = temp_repo();
        assert!(save_trigger_with_target(&repo, "t", trigger_record(), &starts(Some("a/b")), None, None, false).is_err());
        assert!(!repo.join(".praxis").exists(), "nothing is written");
    }

    // --- trigger names with a target (#473) ---------------------------------------------

    #[test]
    fn a_new_trigger_with_a_target_must_have_a_name_the_host_accepts() {
        let repo = temp_repo();
        for bad in ["Nightly.Review", "check"] {
            let record = json!({"id": bad, "contractId": "c"});
            let why = save_trigger_with_target(&repo, bad, record, &starts(Some("ship")), None, None, false).unwrap_err();
            assert_eq!(why, TRIGGER_NAME_RULE, "{bad}");
            assert!(!repo.join(format!(".praxis/triggers/{bad}.json")).exists(), "{bad}");
            assert!(!repo.join(format!(".praxis/trigger-targets/{bad}.json")).exists(), "{bad}");
        }
        let record = json!({"id": "nightly-review", "contractId": "c"});
        saved_target(save_trigger_with_target(&repo, "nightly-review", record, &starts(Some("ship")), None, None, false).unwrap());
    }

    #[test]
    fn a_new_trigger_without_a_target_keeps_the_id_rules() {
        let repo = temp_repo();
        let record = json!({"id": "Nightly.Review", "contractId": "c"});
        saved_target(save_trigger_with_target(&repo, "Nightly.Review", record.clone(), &starts(None), None, None, false).unwrap());
        let record = json!({"id": "check", "contractId": "c"});
        saved_target(save_definition(&repo, PraxisKind::Triggers, "check", record, None, None, None, None, false).unwrap());
    }

    #[test]
    fn a_trigger_lists_with_its_target_and_only_one_with_a_target_has_its_name_flagged() {
        let repo = temp_repo();
        for id in ["nightly", "Nightly.V2", "check", "Loose.V2", "broken"] {
            write(&repo, &format!(".praxis/triggers/{id}.json"), &format!("{{\"id\": \"{id}\"}}"));
        }
        for id in ["nightly", "Nightly.V2", "check"] {
            write(&repo, &format!(".praxis/trigger-targets/{id}.json"), "{\"version\": 1, \"graphWorkflow\": \"ship\"}");
        }
        // A target file that can't be read opens as no target.
        write(&repo, ".praxis/trigger-targets/broken.json", "{nope");
        let list = list_definitions(&repo, PraxisKind::Triggers).unwrap();
        let by_id = |id: &str| list.entries.iter().find(|e| e.id == id).unwrap().clone();
        assert_eq!(by_id("nightly").target.as_deref(), Some("ship"));
        assert_eq!(by_id("nightly").name_problem, None);
        assert_eq!(by_id("Nightly.V2").name_problem.as_deref(), Some(TRIGGER_NAME_RULE));
        assert_eq!(by_id("check").name_problem.as_deref(), Some(TRIGGER_NAME_RULE));
        assert_eq!((by_id("Loose.V2").target, by_id("Loose.V2").name_problem), (None, None));
        assert_eq!((by_id("broken").target, by_id("broken").name_problem), (None, None));
        // Only triggers have a target.
        write(&repo, ".praxis/contracts/nightly.json", "{\"id\": \"nightly\"}");
        assert_eq!(list_definitions(&repo, PraxisKind::Contracts).unwrap().entries[0].target, None);
    }

    /// Like a template file named badly, a saved trigger named badly can be given a target and
    /// saved, and its list entry flags the name until it is renamed.
    #[test]
    fn a_saved_trigger_named_badly_can_take_a_target_and_save() {
        let repo = temp_repo();
        let record = json!({"id": "Nightly", "contractId": "c"});
        let (hash, _, _) =
            saved_target(save_definition(&repo, PraxisKind::Triggers, "Nightly", record.clone(), None, None, None, None, false).unwrap());
        saved_target(save_trigger_with_target(&repo, "Nightly", record, &starts(Some("ship")), Some(&hash), None, false).unwrap());
        assert!(repo.join(".praxis/trigger-targets/Nightly.json").is_file());
    }

    #[test]
    fn a_target_file_that_doesnt_parse_is_reported_and_the_trigger_opens() {
        let repo = temp_repo();
        write(&repo, ".praxis/triggers/t.json", "{\"id\": \"t\"}\n");
        write(&repo, ".praxis/trigger-targets/t.json", "{nope");
        let file = read_definition(&repo, PraxisKind::Triggers, "t").unwrap();
        assert!(file.content.is_some());
        assert_eq!(file.target, None);
        assert!(file.target_problem.is_some());
        assert!(file.target_hash.is_some());
        // Other kinds read no target.
        write(&repo, ".praxis/contracts/t.json", "{\"id\": \"t\"}\n");
        assert_eq!(read_definition(&repo, PraxisKind::Contracts, "t").unwrap().target_problem, None);
    }

    #[test]
    fn contract_triggers_lists_the_triggers_that_name_the_contract() {
        let repo = temp_repo();
        write(&repo, ".praxis/triggers/b.json", "{\"id\": \"b\", \"contractId\": \"c\"}\n");
        write(&repo, ".praxis/triggers/a.json", "{\"id\": \"a\", \"contractId\": \"c\"}\n");
        write(&repo, ".praxis/triggers/other.json", "{\"id\": \"other\", \"contractId\": \"d\"}\n");
        write(&repo, ".praxis/triggers/broken.json", "{");
        let found = contract_triggers(&repo, "c").unwrap();
        assert_eq!(found.ids, vec!["a", "b"]);
        assert_eq!(found.unchecked.len(), 1);
        assert!(found.unchecked[0].starts_with(".praxis/triggers/broken.json"));
        assert!(contract_triggers(&repo, "../c").is_err());
        assert!(contract_triggers(&temp_repo(), "c").unwrap().ids.is_empty());
    }

    #[test]
    fn display_path_drops_the_verbatim_prefix_of_a_windows_canonical_path() {
        assert_eq!(display_path(Path::new(r"\\?\E:\repo\.praxis\templates\t.json")).unwrap(), r"E:\repo\.praxis\templates\t.json");
        assert_eq!(display_path(Path::new(r"\\?\UNC\server\share\t.json")).unwrap(), r"\\server\share\t.json");
        assert_eq!(display_path(Path::new("/home/me/repo/t.json")).unwrap(), "/home/me/repo/t.json");
    }
}
