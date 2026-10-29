//! Reads and saves Praxis definitions in `<repo>/.praxis/<kind>/<id>.json`. Callers name
//! a definition by project, kind and id and never by path: the id is checked against the
//! filename-safe rule, and every folder is canonicalized and refused when it resolves
//! outside the repository (through a symlink or junction).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde_json::{json, Map, Value};

use super::canonical::{canonical_record, content_hash, to_canonical_text};
use super::models::{
    BindingsInput, ConflictReason, ContractTriggers, DefinitionEntry, DefinitionFile, DefinitionList, FileProblem,
    IdMismatch, LayoutInput, PraxisKind, SaveOutcome,
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

/// The `version` a contract's bindings file is written with.
pub const BINDINGS_VERSION: u64 = 1;

/// The most ids each list of a bindings file holds, as the SDK caps its id lists.
pub const MAX_BINDINGS: usize = 1000;

/// The most trigger files `contract_triggers` reads.
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
                    Ok(Some(path)) => parse_object_file(&path),
                },
            };
            match parsed {
                Err(problem) => DefinitionEntry { id, problem: Some(problem), id_mismatch: None, graph_id: None, cost_unit: None },
                Ok(record) => {
                    let Some(id_field) = kind.id_field() else {
                        return DefinitionEntry { id, problem: None, id_mismatch: None, graph_id: None, cost_unit: None };
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
                    DefinitionEntry { id, problem: None, id_mismatch, graph_id, cost_unit }
                }
            }
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
    // Bindings that can't be read are reported, and the contract opens with none.
    let (bindings, bindings_problem, bindings_hash) = if kind == PraxisKind::Contracts {
        match companion_file(repo, BINDINGS_DIR, id) {
            Err(why) => (None, Some(FileProblem::new(why)), None),
            Ok(None) => (None, None, None),
            Ok(Some(file)) => match read_capped(&file) {
                Err(problem) => (None, Some(problem), None),
                Ok(bytes) => {
                    let (value, problem) = split(parse_object(&bytes));
                    (value, problem, Some(super::canonical::content_hash(&bytes)))
                }
            },
        }
    } else {
        (None, None, None)
    };
    Ok(DefinitionFile {
        id: id.to_string(),
        kind,
        missing: false,
        content_hash,
        content,
        problem,
        layout,
        layout_problem,
        bindings,
        bindings_problem,
        bindings_hash,
    })
}

/// `.praxis/<folder>/<id>.json`, a file that belongs to a definition, when it exists and
/// resolves inside the repository.
fn companion_file(repo: &Path, folder: &str, id: &str) -> Result<Option<PathBuf>, String> {
    match confined_dir(repo, folder)? {
        None => Ok(None),
        Some(dir) => confined_file(repo, &dir, id),
    }
}

/// The hash of a contract's bindings file as it is now, or `None` when there is none.
fn bindings_hash_now(repo: &Path, id: &str) -> Result<Option<String>, String> {
    match companion_file(repo, BINDINGS_DIR, id)? {
        None => Ok(None),
        Some(path) => std::fs::read(&path)
            .map(|bytes| Some(content_hash(&bytes)))
            .map_err(|e| format!("{}/{}/{}.json can't be read: {}", PRAXIS_DIR, BINDINGS_DIR, id, e)),
    }
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
    let Some(dir) = confined_dir(repo, folder)? else { return Ok(out) };
    let ids = json_ids(&dir, folder)?;
    if ids.len() > MAX_TRIGGERS_SCANNED {
        out.unchecked.push(format!(
            "{}/{}/: the {} files after the first {} weren't searched.",
            PRAXIS_DIR,
            folder,
            ids.len() - MAX_TRIGGERS_SCANNED,
            MAX_TRIGGERS_SCANNED
        ));
    }
    for id in ids.into_iter().take(MAX_TRIGGERS_SCANNED) {
        let record = match confined_file(repo, &dir, &id) {
            Ok(Some(path)) => parse_object_file(&path).map_err(|p| p.message),
            Ok(None) => Err("The file disappeared.".to_string()),
            Err(why) => Err(why),
        };
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
/// filename-safe. An invalid definition is still written: whatever later runs it refuses
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
    validate_id(id)?;
    let Value::Object(mut record) = content else {
        return Err("A definition must be a JSON object.".to_string());
    };
    if kind == PraxisKind::GraphBindings {
        super::graph_bindings::fill_pins(repo, &mut record);
    }
    let record = canonical_record(kind, record);
    let layout = match layout {
        Some(layout) if kind == PraxisKind::Graphs => Some(layout_value(layout, &record)?),
        _ => None,
    };
    let bindings = match bindings {
        Some(bindings) if kind == PraxisKind::Contracts => Some(bindings_value(bindings)?),
        _ => None,
    };

    let _guard = SAVE_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let dir = ensure_confined_dir(repo, kind.folder())?;
    let existing = confined_file(repo, &dir, id)?;
    let taken = || format!("The id '{}' is already taken by another {} file.", id, kind.folder());
    match (&existing, expected_hash) {
        (Some(_), None) => return Err(taken()),
        (None, None) if id_taken_ignoring_case(&dir, id)? => return Err(taken()),
        (None, None) => {}
        (None, Some(_)) if !force => return Ok(SaveOutcome::Conflict { reason: ConflictReason::Deleted }),
        (Some(path), Some(expected)) if !force => {
            let bytes = std::fs::read(path).map_err(|e| format!("{}.json can't be read: {}", id, e))?;
            if content_hash(&bytes) != expected {
                return Ok(SaveOutcome::Conflict { reason: ConflictReason::Changed });
            }
        }
        _ => {}
    }
    if bindings.is_some()
        && expected_hash.is_some()
        && !force
        && bindings_hash_now(repo, id)?.as_deref() != expected_bindings_hash
    {
        return Ok(SaveOutcome::Conflict { reason: ConflictReason::Changed });
    }

    let value = Value::Object(record);
    let text = to_canonical_text(&value);
    write_atomic(&dir.join(format!("{}.json", id)), text.as_bytes())
        .map_err(|e| format!("{}/{}/{}.json can't be written: {}", PRAXIS_DIR, kind.folder(), id, e))?;

    let layout_error = layout.and_then(|layout| {
        let write = || -> Result<(), String> {
            let dir = ensure_confined_dir(repo, LAYOUT_DIR)?;
            confined_file(repo, &dir, id)?;
            write_atomic(&dir.join(format!("{}.json", id)), to_canonical_text(&layout).as_bytes())
                .map_err(|e| format!("{}/{}/{}.json can't be written: {}", PRAXIS_DIR, LAYOUT_DIR, id, e))
        };
        write().err()
    });
    let (bindings_hash, bindings_error) = match bindings {
        None => (None, None),
        Some(bindings) => {
            let write = || -> Result<String, String> {
                let dir = ensure_confined_dir(repo, BINDINGS_DIR)?;
                confined_file(repo, &dir, id)?;
                let text = to_canonical_text(&bindings);
                write_atomic(&dir.join(format!("{}.json", id)), text.as_bytes())
                    .map_err(|e| format!("{}/{}/{}.json can't be written: {}", PRAXIS_DIR, BINDINGS_DIR, id, e))?;
                Ok(content_hash(text.as_bytes()))
            };
            split(write())
        }
    };
    Ok(SaveOutcome::Saved {
        content: value,
        content_hash: content_hash(text.as_bytes()),
        layout_error,
        bindings_hash,
        bindings_error,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_repo() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("quay2-praxis-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::canonicalize(dir).unwrap()
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
        assert_eq!(got, repo);
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
        assert_eq!(got, worktree);
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
