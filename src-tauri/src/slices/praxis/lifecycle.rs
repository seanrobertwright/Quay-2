//! Renames and deletes Praxis definitions (#222). What a definition owns and what refers to
//! it differ by kind, so each kind registers a `ReferenceHook` in `HOOKS`: the files that
//! belong to its definitions, such as a graph's layout, and the references other files
//! hold to them. A rename writes every new file before it removes an old one, so a failure
//! part-way leaves duplicates, never losses. A delete moves files to the OS trash.

use std::path::{Path, PathBuf};

use serde_json::{Map, Value};

use super::canonical::{canonical_record, content_hash, to_canonical_text};
use super::models::{DeleteOutcome, DraftContent, FileChange, HashChange, PraxisKind, RenameOutcome};
use super::store::{
    confined_dir, confined_file, json_ids, parse_object, read_capped, validate_id, BINDINGS_DIR,
    LAYOUT_DIR, PRAXIS_DIR, SAVE_LOCK,
};
use crate::atomic_file::write_atomic;

/// The most files a rename or delete reads in one folder when it looks for references.
/// Files past it are reported as unchecked.
pub const MAX_SCANNED: usize = 10_000;

/// The most drafts a rename takes.
pub const MAX_DRAFTS: usize = 1000;

/// Rewrites the references in `record`, a file from `.praxis/<folder>/`, to the definition
/// of kind `target` named `old`: to `new`, or, when `new` is `None`, leaves them as they
/// are. Returns whether `record` refers to it.
pub type RewriteFn = fn(folder: &str, record: &mut Map<String, Value>, target: PraxisKind, old: &str, new: Option<&str>) -> bool;

/// What one kind contributes to renames and deletes.
pub struct ReferenceHook {
    /// `(kind, folder)`: a definition of `kind` owns `.praxis/<folder>/<id>.json`, which
    /// moves with it on rename and goes to the trash with it on delete.
    pub companions: &'static [(PraxisKind, &'static str)],
    /// The folders under `.praxis/` whose files `rewrite` reads for references.
    pub scans: &'static [&'static str],
    pub rewrite: RewriteFn,
}

fn refers_to_nothing(_: &str, _: &mut Map<String, Value>, _: PraxisKind, _: &str, _: Option<&str>) -> bool {
    false
}

/// A graph owns its layout file. Nothing in a graph refers to another definition.
pub const GRAPH_HOOK: ReferenceHook = ReferenceHook {
    companions: &[(PraxisKind::Graphs, LAYOUT_DIR)],
    scans: &[],
    rewrite: refers_to_nothing,
};

/// The list in a contract's bindings file that holds definitions of `kind`, if any.
fn binding_list(kind: PraxisKind) -> Option<&'static str> {
    match kind {
        PraxisKind::Graphs => Some("graphs"),
        PraxisKind::Grants => Some("grants"),
        _ => None,
    }
}

/// Rewrites a bindings file's entries for the graph or grant named `old` (#223). Entries
/// that aren't strings are left alone.
fn rewrite_bindings(folder: &str, record: &mut Map<String, Value>, target: PraxisKind, old: &str, new: Option<&str>) -> bool {
    let Some(list) = binding_list(target).filter(|_| folder == BINDINGS_DIR) else {
        return false;
    };
    let Some(Value::Array(ids)) = record.get_mut(list) else {
        return false;
    };
    let mut found = false;
    for id in ids.iter_mut().filter(|id| id.as_str() == Some(old)) {
        found = true;
        if let Some(new) = new {
            *id = Value::String(new.to_string());
        }
    }
    found
}

/// A contract owns its bindings file, which lists the graphs and grants bound to it, so a
/// rename of either rewrites the entries and a delete names the files that hold them.
pub const CONTRACT_HOOK: ReferenceHook = ReferenceHook {
    companions: &[(PraxisKind::Contracts, BINDINGS_DIR)],
    scans: &[BINDINGS_DIR],
    rewrite: rewrite_bindings,
};

/// Rewrites a grant's `parentId` when it names the grant `old` (#223).
fn rewrite_parent(folder: &str, record: &mut Map<String, Value>, target: PraxisKind, old: &str, new: Option<&str>) -> bool {
    let grants = PraxisKind::Grants.folder();
    if target != PraxisKind::Grants || folder != grants || record.get("parentId").and_then(Value::as_str) != Some(old) {
        return false;
    }
    if let Some(new) = new {
        record.insert("parentId".to_string(), Value::String(new.to_string()));
    }
    true
}

/// A grant names its parent grant in `parentId`, so a rename of the parent rewrites it and a
/// delete names the grants that hold it.
pub const GRANT_HOOK: ReferenceHook = ReferenceHook { companions: &[], scans: &["grants"], rewrite: rewrite_parent };

/// Every kind's hook. A kind that owns files or holds references adds its hook here.
pub const HOOKS: &[ReferenceHook] = &[GRAPH_HOOK, CONTRACT_HOOK, GRANT_HOOK];

/// A file's path relative to the repository, as reports show it.
fn shown(folder: &str, id: &str) -> String {
    format!("{}/{}/{}.json", PRAXIS_DIR, folder, id)
}

/// Runs every hook over `record`, and says whether any found a reference.
fn rewrite_all(
    hooks: &[ReferenceHook],
    folder: &str,
    record: &mut Map<String, Value>,
    target: PraxisKind,
    old: &str,
    new: Option<&str>,
) -> bool {
    hooks
        .iter()
        .fold(false, |found, hook| (hook.rewrite)(folder, record, target, old, new) | found)
}

/// The record as written to `.praxis/<folder>/`: canonical for a kind's folder, and in its
/// own key order for any other.
fn file_text(folder: &str, record: Map<String, Value>) -> String {
    match PraxisKind::from_folder(folder) {
        Some(kind) => to_canonical_text(&Value::Object(canonical_record(kind, record))),
        None => to_canonical_text(&Value::Object(record)),
    }
}

/// A file that refers to the definition, read from a scanned folder.
struct Referrer {
    folder: &'static str,
    path: PathBuf,
    shown: String,
    bytes: Vec<u8>,
    record: Map<String, Value>,
}

/// The files in the hooks' scanned folders that refer to `target` named `id`, skipping
/// that definition's own file, and the files that couldn't be read.
fn find_referrers(
    repo: &Path,
    hooks: &[ReferenceHook],
    target: PraxisKind,
    id: &str,
) -> Result<(Vec<Referrer>, Vec<String>), String> {
    let mut folders: Vec<&'static str> = Vec::new();
    for folder in hooks.iter().flat_map(|h| h.scans.iter().copied()) {
        if !folders.contains(&folder) {
            folders.push(folder);
        }
    }
    let mut referrers = Vec::new();
    let mut unchecked = Vec::new();
    for folder in folders {
        let Some(dir) = confined_dir(repo, folder)? else { continue };
        let ids = json_ids(&dir, folder)?;
        if ids.len() > MAX_SCANNED {
            unchecked.push(format!(
                "{}/{}/: the {} files after the first {} weren't searched.",
                PRAXIS_DIR,
                folder,
                ids.len() - MAX_SCANNED,
                MAX_SCANNED
            ));
        }
        for other in ids.into_iter().take(MAX_SCANNED) {
            if Some(target) == PraxisKind::from_folder(folder) && other == id {
                continue;
            }
            let shown = shown(folder, &other);
            let parsed = match confined_file(repo, &dir, &other) {
                Ok(Some(path)) => read_capped(&path)
                    .and_then(|bytes| parse_object(&bytes).map(|value| (path, bytes, value)))
                    .map_err(|p| p.message),
                Ok(None) => Err("The file disappeared.".to_string()),
                Err(why) => Err(why),
            };
            let (path, bytes, value) = match parsed {
                Ok(read) => read,
                Err(why) => {
                    unchecked.push(format!("{}: {}", shown, why));
                    continue;
                }
            };
            let Value::Object(record) = value else { continue };
            // Kept as read: a rename rewrites it, a delete only names it.
            if rewrite_all(hooks, folder, &mut record.clone(), target, id, None) {
                referrers.push(Referrer { folder, path, shown, bytes, record });
            }
        }
    }
    Ok((referrers, unchecked))
}

/// The folders holding files that belong to a definition of `kind`.
fn companion_folders(hooks: &[ReferenceHook], kind: PraxisKind) -> Vec<&'static str> {
    let mut folders = Vec::new();
    for (owner, folder) in hooks.iter().flat_map(|h| h.companions.iter().copied()) {
        if owner == kind && !folders.contains(&folder) {
            folders.push(folder);
        }
    }
    folders
}

/// `<dir>/<id>.json` when it exists and resolves inside the repository. The path in the
/// folder is returned, not where a link leads, so it is the link that moves or goes to the
/// trash and the file it points at stays.
fn existing_file(repo: &Path, dir: &Path, id: &str) -> Result<Option<PathBuf>, String> {
    Ok(confined_file(repo, dir, id)?.map(|_| dir.join(format!("{}.json", id))))
}

/// One file operation of a rename, with the line that reports it.
enum Step {
    Write { path: PathBuf, bytes: Vec<u8>, line: String },
    Copy { from: PathBuf, to: PathBuf, line: String },
    Rename { from: PathBuf, to: PathBuf, line: String },
    Remove { path: PathBuf, line: String },
}

impl Step {
    fn run(&self) -> Result<&str, String> {
        let (result, line) = match self {
            Step::Write { path, bytes, line } => (write_atomic(path, bytes), line),
            Step::Copy { from, to, line } => (std::fs::read(from).and_then(|bytes| write_atomic(to, &bytes)), line),
            Step::Rename { from, to, line } => (std::fs::rename(from, to), line),
            Step::Remove { path, line } => (std::fs::remove_file(path), line),
        };
        result.map(|()| line.as_str()).map_err(|e| format!("{} failed: {}", line, e))
    }
}

/// Whether `dir` holds a `*.json` file, other than `<id>.json` itself, named `new_id`
/// ignoring case.
fn taken_by_another(dir: &Path, folder: &str, id: &str, new_id: &str) -> Result<bool, String> {
    Ok(json_ids(dir, folder)?
        .iter()
        .any(|other| other != id && other.eq_ignore_ascii_case(new_id)))
}

/// Renames the definition `kind`/`id` to `new_id` (#222): writes it under the new name
/// with the new `id` inside, moves the files that belong to it, and rewrites the
/// references the hooks find in other files and in `drafts`. Every new file is written
/// before any old one is removed. A rename to the same id writes the definition with that
/// id inside and nothing else, which is how a file whose name and id differ is fixed.
///
/// Refused, with nothing written, when either id isn't filename-safe, the definition
/// doesn't exist or can't be read, or `new_id` is taken by another file, ignoring case.
/// With `dry_run` it reports what it would do and writes nothing.
pub fn rename_definition(
    repo: &Path,
    kind: PraxisKind,
    id: &str,
    new_id: &str,
    drafts: &[DraftContent],
    dry_run: bool,
    hooks: &[ReferenceHook],
) -> Result<RenameOutcome, String> {
    validate_id(id)?;
    validate_id(new_id)?;
    if drafts.len() > MAX_DRAFTS {
        return Err(format!("A rename takes at most {} drafts.", MAX_DRAFTS));
    }
    let folder = kind.folder();
    let missing = || format!("{} doesn't exist.", shown(folder, id));

    let _guard = SAVE_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let dir = confined_dir(repo, folder)?.ok_or_else(missing)?;
    let old_path = existing_file(repo, &dir, id)?.ok_or_else(missing)?;
    let same_id = id == new_id;
    // On a file system that ignores case, `G.json` and `g.json` are one file, so writing
    // the new name and removing the old would remove both. A case-only rename rewrites the
    // file in place and then renames it.
    let case_only = !same_id && id.eq_ignore_ascii_case(new_id);
    if !same_id && taken_by_another(&dir, folder, id, new_id)? {
        return Err(format!("The id '{}' is already taken by another {} file.", new_id, folder));
    }
    let bytes = read_capped(&old_path).map_err(|p| format!("{} can't be renamed: {}", shown(folder, id), p.message))?;
    let Value::Object(mut record) =
        parse_object(&bytes).map_err(|p| format!("{} can't be renamed: {}", shown(folder, id), p.message))?
    else {
        unreachable!("parse_object returns only objects");
    };
    record.insert("id".to_string(), Value::String(new_id.to_string()));
    if !same_id {
        rewrite_all(hooks, folder, &mut record, kind, id, Some(new_id));
    }
    let text = file_text(folder, record);

    let mut changes = Vec::new();
    let mut writes = Vec::new();
    let mut finishes = Vec::new();
    let new_path = dir.join(format!("{}.json", new_id));
    let (old_shown, new_shown) = (shown(folder, id), shown(folder, new_id));
    changes.push(FileChange {
        path: old_shown.clone(),
        new_path: (!same_id).then(|| new_shown.clone()),
        hashes: Some(HashChange { previous: content_hash(&bytes), next: content_hash(text.as_bytes()) }),
    });
    if case_only {
        writes.push(Step::Write { path: old_path.clone(), bytes: text.into_bytes(), line: format!("Rewrote {}", old_shown) });
        finishes.push(Step::Rename { from: old_path, to: new_path, line: format!("Renamed {} to {}", old_shown, new_shown) });
    } else {
        writes.push(Step::Write { path: new_path, bytes: text.into_bytes(), line: format!("Wrote {}", new_shown) });
        if !same_id {
            finishes.push(Step::Remove { path: old_path, line: format!("Removed {}", old_shown) });
        }
    }

    let mut unchecked = Vec::new();
    let mut rewritten_drafts = Vec::new();
    if !same_id {
        for companion in companion_folders(hooks, kind) {
            let Some(cdir) = confined_dir(repo, companion)? else { continue };
            let Some(from) = existing_file(repo, &cdir, id)? else { continue };
            // Refuses a file at the new name that links out of the repository.
            confined_file(repo, &cdir, new_id)?;
            let to = cdir.join(format!("{}.json", new_id));
            let (from_shown, to_shown) = (shown(companion, id), shown(companion, new_id));
            changes.push(FileChange { path: from_shown.clone(), new_path: Some(to_shown.clone()), hashes: None });
            if case_only {
                finishes.push(Step::Rename { from, to, line: format!("Renamed {} to {}", from_shown, to_shown) });
            } else {
                writes.push(Step::Copy { from: from.clone(), to, line: format!("Copied {} to {}", from_shown, to_shown) });
                finishes.push(Step::Remove { path: from, line: format!("Removed {}", from_shown) });
            }
        }

        let (referrers, skipped) = find_referrers(repo, hooks, kind, id)?;
        unchecked = skipped;
        for mut r in referrers {
            rewrite_all(hooks, r.folder, &mut r.record, kind, id, Some(new_id));
            let text = file_text(r.folder, r.record);
            let hashes = HashChange { previous: content_hash(&r.bytes), next: content_hash(text.as_bytes()) };
            changes.push(FileChange { path: r.shown.clone(), new_path: None, hashes: Some(hashes) });
            writes.push(Step::Write { path: r.path, bytes: text.into_bytes(), line: format!("Rewrote {}", r.shown) });
        }

        for draft in drafts {
            if draft.kind == kind && draft.id == id {
                continue;
            }
            let Value::Object(mut content) = draft.content.clone() else { continue };
            if rewrite_all(hooks, draft.kind.folder(), &mut content, kind, id, Some(new_id)) {
                rewritten_drafts.push(DraftContent { kind: draft.kind, id: draft.id.clone(), content: Value::Object(content) });
            }
        }
    }

    let mut outcome = RenameOutcome { changes, unchecked, drafts: rewritten_drafts, done: Vec::new(), error: None };
    if dry_run {
        return Ok(outcome);
    }
    for step in writes.iter().chain(finishes.iter()) {
        match step.run() {
            Ok(line) => outcome.done.push(line.to_string()),
            Err(why) => {
                outcome.error = Some(why);
                break;
            }
        }
    }
    Ok(outcome)
}

/// Deletes the definition `kind`/`id` (#222): moves it to the OS trash through `trash`,
/// then the files that belong to it, and names the files that refer to it, which are left
/// as they are. Refused when the id isn't filename-safe or the definition doesn't exist.
/// With `dry_run` it reports what it would do and moves nothing.
pub fn delete_definition(
    repo: &Path,
    kind: PraxisKind,
    id: &str,
    dry_run: bool,
    hooks: &[ReferenceHook],
    trash: &dyn Fn(&Path) -> Result<(), String>,
) -> Result<DeleteOutcome, String> {
    validate_id(id)?;
    let folder = kind.folder();
    let missing = || format!("{} doesn't exist.", shown(folder, id));

    let _guard = SAVE_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let dir = confined_dir(repo, folder)?.ok_or_else(missing)?;
    let path = existing_file(repo, &dir, id)?.ok_or_else(missing)?;
    let mut targets = vec![(path, shown(folder, id))];
    for companion in companion_folders(hooks, kind) {
        let Some(cdir) = confined_dir(repo, companion)? else { continue };
        if let Some(file) = existing_file(repo, &cdir, id)? {
            targets.push((file, shown(companion, id)));
        }
    }
    let (referrers, unchecked) = find_referrers(repo, hooks, kind, id)?;
    let mut outcome = DeleteOutcome {
        files: targets.iter().map(|(_, shown)| shown.clone()).collect(),
        referrers: referrers.into_iter().map(|r| r.shown).collect(),
        unchecked,
        done: Vec::new(),
        error: None,
    };
    if dry_run {
        return Ok(outcome);
    }
    for (file, shown) in targets {
        match trash(&file) {
            Ok(()) => outcome.done.push(format!("Moved {} to the trash", shown)),
            Err(why) => {
                outcome.error = Some(format!("Moving {} to the trash failed: {}", shown, why));
                break;
            }
        }
    }
    Ok(outcome)
}

/// Moves a file to the Recycle Bin or Trash.
pub fn move_to_trash(path: &Path) -> Result<(), String> {
    trash::delete(path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;

    use serde_json::json;

    use super::*;

    fn temp_repo() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("quay2-praxis-life-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::canonicalize(dir).unwrap()
    }

    fn write(repo: &Path, rel: &str, body: &str) {
        let path = repo.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, body).unwrap();
    }

    fn read(repo: &Path, rel: &str) -> Value {
        serde_json::from_str(&std::fs::read_to_string(repo.join(rel)).unwrap()).unwrap()
    }

    /// The names in a folder exactly as the file system stores them, which `exists` can't
    /// tell apart on a file system that ignores case.
    fn names(repo: &Path, rel: &str) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(repo.join(rel))
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .collect();
        names.sort();
        names
    }

    const GRAPH: &str = r#"{"id": "g", "revision": "x", "nodes": [{"id": "end-1", "kind": "END", "dependsOn": [], "config": {}}]}"#;
    const LAYOUT: &str = r#"{"version": 1, "nodes": {"end-1": {"x": 1, "y": 2}}}"#;

    fn graph_repo() -> PathBuf {
        let repo = temp_repo();
        write(&repo, ".praxis/graphs/g.json", GRAPH);
        write(&repo, ".praxis/layout/g.json", LAYOUT);
        repo
    }

    /// A stand-in for the trigger form's hook: triggers refer to contracts by `contractId`.
    fn contract_id(_: &str, record: &mut Map<String, Value>, target: PraxisKind, old: &str, new: Option<&str>) -> bool {
        if target != PraxisKind::Contracts || record.get("contractId").and_then(Value::as_str) != Some(old) {
            return false;
        }
        if let Some(new) = new {
            record.insert("contractId".to_string(), json!(new));
        }
        true
    }
    const CONTRACT_ID_HOOK: ReferenceHook = ReferenceHook { companions: &[], scans: &["triggers"], rewrite: contract_id };
    const TEST_HOOKS: &[ReferenceHook] = &[GRAPH_HOOK, CONTRACT_HOOK, CONTRACT_ID_HOOK];

    fn contract_repo() -> PathBuf {
        let repo = temp_repo();
        write(&repo, ".praxis/contracts/c1.json", r#"{"id": "c1", "missionId": "c1"}"#);
        write(&repo, ".praxis/bindings/c1.json", r#"{"version": 1, "graphs": ["g"]}"#);
        write(&repo, ".praxis/triggers/t1.json", r#"{"id": "t1", "contractId": "c1"}"#);
        write(&repo, ".praxis/triggers/t2.json", r#"{"id": "t2", "contractId": "other"}"#);
        write(&repo, ".praxis/triggers/broken.json", "{nope");
        repo
    }

    // --- renaming ----------------------------------------------------------------------

    #[test]
    fn renaming_a_graph_moves_it_and_its_layout_and_changes_the_id_inside() {
        let repo = graph_repo();
        let outcome = rename_definition(&repo, PraxisKind::Graphs, "g", "h", &[], false, HOOKS).unwrap();
        assert_eq!(outcome.error, None);
        assert_eq!(names(&repo, ".praxis/graphs"), vec!["h.json"]);
        assert_eq!(names(&repo, ".praxis/layout"), vec!["h.json"]);
        let graph = read(&repo, ".praxis/graphs/h.json");
        assert_eq!(graph["id"], "h");
        assert!(graph["revision"].as_str().unwrap().starts_with("sha256:"), "written in canonical form");
        assert_eq!(read(&repo, ".praxis/layout/h.json"), serde_json::from_str::<Value>(LAYOUT).unwrap());
        let paths: Vec<_> = outcome.changes.iter().map(|c| (c.path.as_str(), c.new_path.as_deref())).collect();
        assert_eq!(
            paths,
            vec![
                (".praxis/graphs/g.json", Some(".praxis/graphs/h.json")),
                (".praxis/layout/g.json", Some(".praxis/layout/h.json")),
            ]
        );
    }

    #[test]
    fn a_rename_writes_every_new_file_before_it_removes_an_old_one() {
        let repo = contract_repo();
        let outcome = rename_definition(&repo, PraxisKind::Contracts, "c1", "c2", &[], false, TEST_HOOKS).unwrap();
        assert_eq!(
            outcome.done,
            vec![
                "Wrote .praxis/contracts/c2.json",
                "Copied .praxis/bindings/c1.json to .praxis/bindings/c2.json",
                "Rewrote .praxis/triggers/t1.json",
                "Removed .praxis/contracts/c1.json",
                "Removed .praxis/bindings/c1.json",
            ]
        );
    }

    #[test]
    fn a_rename_that_fails_part_way_leaves_duplicates_and_reports_what_it_did() {
        let repo = graph_repo();
        // A folder where the new layout file goes, so copying the layout fails.
        std::fs::create_dir_all(repo.join(".praxis/layout/h.json")).unwrap();
        let outcome = rename_definition(&repo, PraxisKind::Graphs, "g", "h", &[], false, HOOKS).unwrap();
        assert_eq!(outcome.done, vec!["Wrote .praxis/graphs/h.json"]);
        assert!(outcome.error.unwrap().starts_with("Copied .praxis/layout/g.json"));
        assert_eq!(names(&repo, ".praxis/graphs"), vec!["g.json", "h.json"], "nothing was removed");
        assert!(repo.join(".praxis/layout/g.json").is_file());
    }

    #[test]
    fn a_dry_run_reports_the_rename_and_writes_nothing() {
        let repo = graph_repo();
        let outcome = rename_definition(&repo, PraxisKind::Graphs, "g", "h", &[], true, HOOKS).unwrap();
        assert_eq!(outcome.changes.len(), 2);
        assert!(outcome.done.is_empty());
        assert_eq!(names(&repo, ".praxis/graphs"), vec!["g.json"]);
        assert_eq!(names(&repo, ".praxis/layout"), vec!["g.json"]);
    }

    #[test]
    fn a_graph_without_a_layout_file_renames_alone() {
        let repo = temp_repo();
        write(&repo, ".praxis/graphs/g.json", GRAPH);
        let outcome = rename_definition(&repo, PraxisKind::Graphs, "g", "h", &[], false, HOOKS).unwrap();
        assert_eq!(outcome.changes.len(), 1);
        assert_eq!(names(&repo, ".praxis/graphs"), vec!["h.json"]);
        assert!(!repo.join(".praxis/layout").exists());
    }

    #[test]
    fn a_case_only_rename_changes_the_file_names_without_losing_them() {
        let repo = graph_repo();
        let outcome = rename_definition(&repo, PraxisKind::Graphs, "g", "G", &[], false, HOOKS).unwrap();
        assert_eq!(outcome.error, None);
        assert_eq!(names(&repo, ".praxis/graphs"), vec!["G.json"]);
        assert_eq!(names(&repo, ".praxis/layout"), vec!["G.json"]);
        assert_eq!(read(&repo, ".praxis/graphs/G.json")["id"], "G");
    }

    #[test]
    fn renaming_to_the_same_id_makes_the_id_inside_match_the_file_name() {
        let repo = temp_repo();
        write(&repo, ".praxis/graphs/g.json", &GRAPH.replace(r#""id": "g""#, r#""id": "other""#));
        write(&repo, ".praxis/layout/g.json", LAYOUT);
        let outcome = rename_definition(&repo, PraxisKind::Graphs, "g", "g", &[], false, HOOKS).unwrap();
        assert_eq!(outcome.done, vec!["Wrote .praxis/graphs/g.json"]);
        assert_eq!(read(&repo, ".praxis/graphs/g.json")["id"], "g");
        assert_eq!(outcome.changes[0].new_path, None);
        assert!(repo.join(".praxis/layout/g.json").is_file());
    }

    #[test]
    fn renaming_refuses_a_taken_or_unsafe_id_and_writes_nothing() {
        let repo = graph_repo();
        write(&repo, ".praxis/graphs/Taken.json", GRAPH);
        for new in ["Taken", "taken", "a b", "nul", ".h", "../h"] {
            assert!(rename_definition(&repo, PraxisKind::Graphs, "g", new, &[], false, HOOKS).is_err(), "{new}");
        }
        assert_eq!(names(&repo, ".praxis/graphs"), vec!["Taken.json", "g.json"]);
        assert_eq!(names(&repo, ".praxis/layout"), vec!["g.json"]);
    }

    #[test]
    fn renaming_refuses_a_missing_or_unreadable_definition() {
        let repo = temp_repo();
        assert!(rename_definition(&repo, PraxisKind::Graphs, "g", "h", &[], false, HOOKS).is_err());
        write(&repo, ".praxis/graphs/g.json", "{nope");
        assert!(rename_definition(&repo, PraxisKind::Graphs, "g", "h", &[], false, HOOKS).is_err());
        assert_eq!(names(&repo, ".praxis/graphs"), vec!["g.json"]);
    }

    #[test]
    fn renaming_refuses_a_layout_file_at_the_new_name_that_links_outside_the_repo() {
        let repo = graph_repo();
        let outside = temp_repo();
        std::fs::write(outside.join("h.json"), "{}").unwrap();
        if !link_file(&outside.join("h.json"), &repo.join(".praxis/layout/h.json")) {
            return;
        }
        assert!(rename_definition(&repo, PraxisKind::Graphs, "g", "h", &[], false, HOOKS).is_err());
        assert_eq!(std::fs::read_to_string(outside.join("h.json")).unwrap(), "{}");
        assert_eq!(names(&repo, ".praxis/graphs"), vec!["g.json"]);
    }

    /// Links `link` to the file `target`, or returns false where the OS doesn't let a test
    /// create a file symlink (Windows without developer mode).
    fn link_file(target: &Path, link: &Path) -> bool {
        #[cfg(windows)]
        let linked = std::os::windows::fs::symlink_file(target, link);
        #[cfg(not(windows))]
        let linked = std::os::unix::fs::symlink(target, link);
        linked.is_ok()
    }

    #[test]
    fn a_linked_definition_moves_its_link_and_leaves_the_target_alone() {
        let repo = temp_repo();
        write(&repo, "shared/g.json", GRAPH);
        std::fs::create_dir_all(repo.join(".praxis/graphs")).unwrap();
        if !link_file(&repo.join("shared/g.json"), &repo.join(".praxis/graphs/g.json")) {
            return;
        }
        let outcome = rename_definition(&repo, PraxisKind::Graphs, "g", "h", &[], false, HOOKS).unwrap();
        assert_eq!(outcome.error, None);
        assert!(repo.join("shared/g.json").is_file(), "the link's target stays");
        assert_eq!(names(&repo, ".praxis/graphs"), vec!["h.json"]);

        let trashed = RefCell::new(Vec::new());
        let trash = |p: &Path| {
            trashed.borrow_mut().push(p.to_path_buf());
            Ok(())
        };
        write(&repo, "shared/k.json", GRAPH);
        assert!(link_file(&repo.join("shared/k.json"), &repo.join(".praxis/graphs/k.json")));
        delete_definition(&repo, PraxisKind::Graphs, "k", false, HOOKS, &trash).unwrap();
        assert_eq!(*trashed.borrow(), vec![repo.join(".praxis").join("graphs").join("k.json")]);
    }

    // --- references --------------------------------------------------------------------

    #[test]
    fn renaming_rewrites_references_in_other_files_through_the_hooks() {
        let repo = contract_repo();
        let outcome = rename_definition(&repo, PraxisKind::Contracts, "c1", "c2", &[], false, TEST_HOOKS).unwrap();
        assert_eq!(outcome.error, None);
        assert_eq!(read(&repo, ".praxis/triggers/t1.json")["contractId"], "c2");
        assert_eq!(read(&repo, ".praxis/triggers/t2.json")["contractId"], "other");
        assert_eq!(names(&repo, ".praxis/bindings"), vec!["c2.json"]);
        assert_eq!(outcome.unchecked.len(), 1);
        assert!(outcome.unchecked[0].starts_with(".praxis/triggers/broken.json"), "{:?}", outcome.unchecked);

        let t1 = outcome.changes.iter().find(|c| c.path == ".praxis/triggers/t1.json").unwrap();
        let hashes = t1.hashes.as_ref().unwrap();
        assert_eq!(hashes.next, content_hash(&std::fs::read(repo.join(".praxis/triggers/t1.json")).unwrap()));
        assert_eq!(hashes.previous, content_hash(br#"{"id": "t1", "contractId": "c1"}"#));
    }

    #[test]
    fn renaming_rewrites_references_in_drafts_but_not_the_renamed_one() {
        let repo = contract_repo();
        let drafts = vec![
            DraftContent { kind: PraxisKind::Triggers, id: "t9".into(), content: json!({"id": "t9", "contractId": "c1"}) },
            DraftContent { kind: PraxisKind::Triggers, id: "t8".into(), content: json!({"id": "t8", "contractId": "x"}) },
            DraftContent { kind: PraxisKind::Contracts, id: "c1".into(), content: json!({"id": "c1", "contractId": "c1"}) },
        ];
        let outcome = rename_definition(&repo, PraxisKind::Contracts, "c1", "c2", &drafts, true, TEST_HOOKS).unwrap();
        assert_eq!(
            outcome.drafts,
            vec![DraftContent { kind: PraxisKind::Triggers, id: "t9".into(), content: json!({"id": "t9", "contractId": "c2"}) }]
        );
    }

    #[test]
    fn renaming_another_kind_leaves_unrelated_references_alone() {
        let repo = contract_repo();
        write(&repo, ".praxis/grants/c1.json", r#"{"id": "c1"}"#);
        let outcome = rename_definition(&repo, PraxisKind::Grants, "c1", "c2", &[], false, TEST_HOOKS).unwrap();
        assert_eq!(outcome.changes.len(), 1);
        assert_eq!(read(&repo, ".praxis/triggers/t1.json")["contractId"], "c1");
        assert_eq!(names(&repo, ".praxis/bindings"), vec!["c1.json"]);
    }

    fn bound_repo() -> PathBuf {
        let repo = graph_repo();
        write(&repo, ".praxis/grants/a.json", r#"{"id": "a"}"#);
        write(&repo, ".praxis/bindings/c1.json", r#"{"version": 1, "graphs": ["g", "other"], "grants": ["a"]}"#);
        write(&repo, ".praxis/bindings/c2.json", r#"{"version": 1, "graphs": ["other"], "grants": ["g"]}"#);
        repo
    }

    #[test]
    fn renaming_a_bound_graph_rewrites_the_bindings_that_list_it() {
        let repo = bound_repo();
        let outcome = rename_definition(&repo, PraxisKind::Graphs, "g", "h", &[], false, HOOKS).unwrap();
        assert_eq!(outcome.error, None);
        assert_eq!(read(&repo, ".praxis/bindings/c1.json")["graphs"], json!(["h", "other"]));
        // A grant with the same id is a different definition.
        assert_eq!(read(&repo, ".praxis/bindings/c2.json")["grants"], json!(["g"]));
        let change = outcome.changes.iter().find(|c| c.path == ".praxis/bindings/c1.json").unwrap();
        let hashes = change.hashes.as_ref().unwrap();
        assert_eq!(hashes.next, content_hash(&std::fs::read(repo.join(".praxis/bindings/c1.json")).unwrap()));
        assert!(!outcome.changes.iter().any(|c| c.path == ".praxis/bindings/c2.json"));
    }

    #[test]
    fn renaming_a_bound_grant_rewrites_the_bindings_that_list_it() {
        let repo = bound_repo();
        let outcome = rename_definition(&repo, PraxisKind::Grants, "a", "b", &[], false, HOOKS).unwrap();
        assert_eq!(outcome.error, None);
        assert_eq!(read(&repo, ".praxis/bindings/c1.json")["grants"], json!(["b"]));
        assert_eq!(read(&repo, ".praxis/bindings/c1.json")["graphs"], json!(["g", "other"]));
    }

    #[test]
    fn renaming_a_contract_moves_its_bindings_file() {
        let repo = bound_repo();
        write(&repo, ".praxis/contracts/c1.json", r#"{"id": "c1"}"#);
        let outcome = rename_definition(&repo, PraxisKind::Contracts, "c1", "c9", &[], false, HOOKS).unwrap();
        assert_eq!(outcome.error, None);
        assert_eq!(names(&repo, ".praxis/bindings"), vec!["c2.json", "c9.json"]);
        assert_eq!(read(&repo, ".praxis/bindings/c9.json")["graphs"], json!(["g", "other"]));
    }

    #[test]
    fn deleting_a_bound_graph_names_the_bindings_and_leaves_them() {
        let repo = bound_repo();
        let trash = |p: &Path| std::fs::remove_file(p).map_err(|e| e.to_string());
        let outcome = delete_definition(&repo, PraxisKind::Graphs, "g", false, HOOKS, &trash).unwrap();
        assert_eq!(outcome.referrers, vec![".praxis/bindings/c1.json"]);
        assert_eq!(read(&repo, ".praxis/bindings/c1.json")["graphs"], json!(["g", "other"]));
    }

    #[test]
    fn renaming_a_parent_grant_rewrites_its_children_and_their_drafts() {
        let repo = temp_repo();
        write(&repo, ".praxis/grants/p.json", r#"{"id": "p"}"#);
        write(&repo, ".praxis/grants/child.json", r#"{"id": "child", "parentId": "p"}"#);
        write(&repo, ".praxis/grants/other.json", r#"{"id": "other", "parentId": "x"}"#);
        write(&repo, ".praxis/bindings/c1.json", r#"{"version": 1, "graphs": [], "grants": ["p"]}"#);
        let drafts = vec![DraftContent { kind: PraxisKind::Grants, id: "new".into(), content: json!({"id": "new", "parentId": "p"}) }];
        let outcome = rename_definition(&repo, PraxisKind::Grants, "p", "q", &drafts, false, HOOKS).unwrap();
        assert_eq!(outcome.error, None);
        assert_eq!(read(&repo, ".praxis/grants/child.json")["parentId"], "q");
        assert_eq!(read(&repo, ".praxis/grants/other.json")["parentId"], "x");
        assert_eq!(read(&repo, ".praxis/bindings/c1.json")["grants"], json!(["q"]));
        assert_eq!(outcome.drafts[0].content["parentId"], "q");
        let child = outcome.changes.iter().find(|c| c.path == ".praxis/grants/child.json").unwrap();
        assert!(child.hashes.is_some());
    }

    #[test]
    fn deleting_a_parent_grant_names_its_children_and_leaves_them() {
        let repo = temp_repo();
        write(&repo, ".praxis/grants/p.json", r#"{"id": "p"}"#);
        write(&repo, ".praxis/grants/child.json", r#"{"id": "child", "parentId": "p"}"#);
        let trash = |p: &Path| std::fs::remove_file(p).map_err(|e| e.to_string());
        let outcome = delete_definition(&repo, PraxisKind::Grants, "p", false, HOOKS, &trash).unwrap();
        assert_eq!(outcome.referrers, vec![".praxis/grants/child.json"]);
        assert_eq!(read(&repo, ".praxis/grants/child.json")["parentId"], "p");
    }

    #[test]
    fn a_graph_or_contract_named_like_a_grant_s_parent_is_another_definition() {
        let repo = temp_repo();
        write(&repo, ".praxis/graphs/p.json", GRAPH);
        write(&repo, ".praxis/grants/child.json", r#"{"id": "child", "parentId": "p"}"#);
        rename_definition(&repo, PraxisKind::Graphs, "p", "q", &[], false, HOOKS).unwrap();
        assert_eq!(read(&repo, ".praxis/grants/child.json")["parentId"], "p");
    }

    // --- deleting ----------------------------------------------------------------------

    #[test]
    fn deleting_a_graph_trashes_it_then_its_layout() {
        let repo = graph_repo();
        let trashed = RefCell::new(Vec::new());
        let trash = |p: &Path| {
            trashed.borrow_mut().push(p.to_path_buf());
            std::fs::remove_file(p).map_err(|e| e.to_string())
        };
        let outcome = delete_definition(&repo, PraxisKind::Graphs, "g", false, HOOKS, &trash).unwrap();
        assert_eq!(outcome.files, vec![".praxis/graphs/g.json", ".praxis/layout/g.json"]);
        assert_eq!(outcome.done.len(), 2);
        assert_eq!(outcome.error, None);
        assert_eq!(
            *trashed.borrow(),
            vec![repo.join(".praxis").join("graphs").join("g.json"), repo.join(".praxis").join("layout").join("g.json")]
        );
    }

    #[test]
    fn a_delete_dry_run_names_the_referrers_and_trashes_nothing() {
        let repo = contract_repo();
        let trash = |_: &Path| -> Result<(), String> { panic!("a dry run trashes nothing") };
        let outcome = delete_definition(&repo, PraxisKind::Contracts, "c1", true, TEST_HOOKS, &trash).unwrap();
        assert_eq!(outcome.files, vec![".praxis/contracts/c1.json", ".praxis/bindings/c1.json"]);
        assert_eq!(outcome.referrers, vec![".praxis/triggers/t1.json"]);
        assert_eq!(outcome.unchecked.len(), 1);
        assert!(outcome.done.is_empty());
    }

    #[test]
    fn a_delete_that_cannot_trash_the_definition_stops_and_says_so() {
        let repo = graph_repo();
        let trash = |_: &Path| -> Result<(), String> { Err("no bin".to_string()) };
        let outcome = delete_definition(&repo, PraxisKind::Graphs, "g", false, HOOKS, &trash).unwrap();
        assert!(outcome.done.is_empty());
        assert!(outcome.error.unwrap().contains("no bin"));
    }

    #[test]
    fn deleting_refuses_a_missing_definition_or_an_unsafe_id() {
        let repo = graph_repo();
        let trash = |_: &Path| -> Result<(), String> { panic!("nothing to trash") };
        assert!(delete_definition(&repo, PraxisKind::Graphs, "missing", false, HOOKS, &trash).is_err());
        assert!(delete_definition(&repo, PraxisKind::Graphs, "../g", false, HOOKS, &trash).is_err());
        assert!(delete_definition(&repo, PraxisKind::Contracts, "g", false, HOOKS, &trash).is_err());
    }
}
