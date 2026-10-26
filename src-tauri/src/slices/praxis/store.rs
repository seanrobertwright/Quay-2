//! Reads Praxis definitions from `<repo>/.praxis/<kind>/<id>.json`. Callers name a
//! definition by project, kind and id and never by path: the id is checked against the
//! filename-safe rule, and every folder is canonicalized and refused when it resolves
//! outside the repository (through a symlink or junction).

use std::path::{Path, PathBuf};

use super::models::{DefinitionEntry, DefinitionFile, DefinitionList, FileProblem, PraxisKind};

/// The most entries `list_definitions` returns for one kind.
pub const MAX_LISTED: usize = 1000;

/// Files larger than this are listed with a problem and never parsed.
pub const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;

/// The longest id the filename-safe rule allows.
pub const MAX_ID_LEN: usize = 128;

const PRAXIS_DIR: &str = ".praxis";
const LAYOUT_DIR: &str = "layout";

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
fn confined_dir(repo: &Path, folder: &str) -> Result<Option<PathBuf>, String> {
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
fn confined_file(repo: &Path, dir: &Path, id: &str) -> Result<Option<PathBuf>, String> {
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

/// Reads and parses a file that must hold one JSON object, describing anything that
/// stops it being one. A leading UTF-8 byte order mark is ignored.
fn parse_object_file(path: &Path) -> Result<serde_json::Value, FileProblem> {
    let size = std::fs::metadata(path)
        .map_err(|e| FileProblem::new(format!("Can't read the file: {}", e)))?
        .len();
    if size > MAX_FILE_BYTES {
        return Err(FileProblem::new(format!(
            "The file is {} bytes, larger than the {} bytes Quay opens.",
            size, MAX_FILE_BYTES
        )));
    }
    let text = std::fs::read_to_string(path)
        .map_err(|e| FileProblem::new(format!("Can't read the file as UTF-8: {}", e)))?;
    let body = text.strip_prefix('\u{feff}').unwrap_or(&text);
    let value: serde_json::Value = serde_json::from_str(body).map_err(|e| FileProblem {
        message: format!("Not valid JSON: {}", e),
        line: Some(e.line()),
        column: Some(e.column()),
    })?;
    if !value.is_object() {
        return Err(FileProblem::new("The file holds JSON, but not a JSON object."));
    }
    Ok(value)
}

/// Lists a kind's definitions in id order, at most `MAX_LISTED` of them. Only `*.json`
/// files directly in the kind's folder are listed. A missing folder is an empty list.
pub fn list_definitions(repo: &Path, kind: PraxisKind) -> Result<DefinitionList, String> {
    let Some(dir) = confined_dir(repo, kind.folder())? else {
        return Ok(DefinitionList { entries: Vec::new(), truncated: false });
    };
    let read = std::fs::read_dir(&dir)
        .map_err(|e| format!("{}/{} can't be listed: {}", PRAXIS_DIR, kind.folder(), e))?;
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
    let truncated = ids.len() > MAX_LISTED;
    ids.truncate(MAX_LISTED);

    let entries = ids
        .into_iter()
        .map(|id| {
            let problem = match validate_id(&id) {
                Err(why) => Some(FileProblem::new(format!(
                    "The file name isn't a valid id. {}",
                    why
                ))),
                Ok(()) => match confined_file(repo, &dir, &id) {
                    Err(why) => Some(FileProblem::new(why)),
                    Ok(None) => Some(FileProblem::new("The file disappeared while listing.")),
                    Ok(Some(path)) => parse_object_file(&path).err(),
                },
            };
            DefinitionEntry { id, problem }
        })
        .collect();
    Ok(DefinitionList { entries, truncated })
}

/// Reads one definition, and for a graph its layout file too.
pub fn read_definition(repo: &Path, kind: PraxisKind, id: &str) -> Result<DefinitionFile, String> {
    let path = definition_path(repo, kind, id)?;
    let (content, problem) = split(parse_object_file(&path));
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
    Ok(DefinitionFile { id: id.to_string(), kind, content, problem, layout, layout_problem })
}

fn split<T, E>(result: Result<T, E>) -> (Option<T>, Option<E>) {
    match result {
        Ok(value) => (Some(value), None),
        Err(err) => (None, Some(err)),
    }
}

/// The path of an existing definition file, confined to the repository, for "Reveal in
/// folder".
pub fn definition_path(repo: &Path, kind: PraxisKind, id: &str) -> Result<PathBuf, String> {
    validate_id(id)?;
    let missing = || format!("{}/{}/{}.json doesn't exist.", PRAXIS_DIR, kind.folder(), id);
    let dir = confined_dir(repo, kind.folder())?.ok_or_else(missing)?;
    confined_file(repo, &dir, id)?.ok_or_else(missing)
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
    fn reading_refuses_bad_ids_and_missing_files() {
        let repo = temp_repo();
        write(&repo, ".praxis/graphs/g.json", "{}");
        assert!(read_definition(&repo, PraxisKind::Graphs, "../graphs/g").is_err());
        assert!(read_definition(&repo, PraxisKind::Graphs, "missing").is_err());
        assert!(definition_path(&repo, PraxisKind::Graphs, "missing").is_err());
        assert_eq!(
            definition_path(&repo, PraxisKind::Graphs, "g").unwrap(),
            repo.join(".praxis").join("graphs").join("g.json")
        );
    }
}
