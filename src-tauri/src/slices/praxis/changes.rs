//! Which definitions have changed since the last commit, and how (#223): the badge and the
//! diff that show an agent's edits before anyone submits them. Only the kinds in
//! `SHOWS_CHANGES` are asked about. Git is only asked about the repository whose root is the
//! project, never one around it, so a project that isn't a repository shows no changes.

use std::path::Path;
use std::process::{Output, Stdio};

use super::models::{ChangeStatus, ChangedFile, ChangedFiles, FileDiff, PraxisKind};
use super::store::{confined_dir, confined_file, validate_id, MAX_FILE_BYTES, MAX_LISTED, PRAXIS_DIR};

/// The kinds whose files show changes since the last commit. A kind enables the badge and
/// the diff by joining this list.
pub const SHOWS_CHANGES: [PraxisKind; 2] = [PraxisKind::Contracts, PraxisKind::Grants];

/// Runs git in `repo` without a console window or a prompt, with paths printed unquoted and
/// without taking the index lock, so an agent's git in the same repository isn't blocked.
fn git(repo: &Path, args: &[&str]) -> Result<Output, String> {
    crate::spawn::hidden_command("git")
        .current_dir(repo)
        .args(["-c", "core.quotepath=false"])
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("Quay can't run git: {}", e))
}

fn failed(args: &[&str], out: &Output) -> String {
    format!("git {} failed: {}", args.join(" "), String::from_utf8_lossy(&out.stderr).trim())
}

/// Whether `repo` is the root of a git repository or worktree. A folder inside some other
/// repository isn't, since that repository isn't the project's.
fn is_repository(repo: &Path) -> Result<bool, String> {
    let out = git(repo, &["rev-parse", "--show-prefix"])?;
    Ok(out.status.success() && String::from_utf8_lossy(&out.stdout).trim().is_empty())
}

/// The definition `.praxis/<folder>/<id>.json` names, when its kind shows changes.
fn definition_at(path: &str) -> Option<(PraxisKind, String)> {
    let rest = path.strip_prefix(PRAXIS_DIR)?.strip_prefix('/')?;
    let (folder, name) = rest.split_once('/')?;
    let id = name.strip_suffix(".json")?;
    let kind = PraxisKind::from_folder(folder).filter(|k| SHOWS_CHANGES.contains(k))?;
    validate_id(id).ok()?;
    Some((kind, id.to_string()))
}

/// How `git status` marks a file, as a change since the last commit: `None` for a file added
/// to the index and then deleted, which the last commit doesn't have either.
fn status_of(xy: &str) -> Option<ChangeStatus> {
    let (x, y) = (xy.as_bytes()[0], xy.as_bytes()[1]);
    match (x, y) {
        (b'?', b'?') => Some(ChangeStatus::Added),
        (b'A', b'D') => None,
        (b'A', _) => Some(ChangeStatus::Added),
        (b'D', _) | (_, b'D') => Some(ChangeStatus::Deleted),
        _ => Some(ChangeStatus::Modified),
    }
}

/// The definitions of the kinds in `SHOWS_CHANGES` whose files differ from the last commit,
/// staged or not, or that are new since it, in path order. Empty when the project isn't a
/// git repository. At most `MAX_LISTED` files per kind are returned.
pub fn changed_files(repo: &Path) -> Result<ChangedFiles, String> {
    if !is_repository(repo)? {
        return Ok(ChangedFiles { files: Vec::new() });
    }
    let folders: Vec<String> = SHOWS_CHANGES.iter().map(|k| format!("{}/{}", PRAXIS_DIR, k.folder())).collect();
    let mut files = status(repo, &folders)?;
    files.sort_by(|a, b| (a.kind.folder(), &a.id).cmp(&(b.kind.folder(), &b.id)));
    // Sorted by kind, so each kind's files are counted in one run.
    let mut run: Option<(PraxisKind, usize)> = None;
    files.retain(|f| {
        let n = match run {
            Some((kind, n)) if kind == f.kind => n + 1,
            _ => 1,
        };
        run = Some((f.kind, n));
        n <= MAX_LISTED
    });
    Ok(ChangedFiles { files })
}

/// `git status` of the files under `pathspecs`, as changed definitions of the kinds that show
/// changes. Other files are left out.
fn status(repo: &Path, pathspecs: &[String]) -> Result<Vec<ChangedFile>, String> {
    let mut args = vec!["status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames", "--"];
    args.extend(pathspecs.iter().map(String::as_str));
    let out = git(repo, &args)?;
    if !out.status.success() {
        return Err(failed(&args, &out));
    }
    Ok(String::from_utf8_lossy(&out.stdout)
        .split('\0')
        .filter(|entry| entry.len() > 3)
        .filter_map(|entry| {
            let (xy, path) = entry.split_at(3);
            let status = status_of(xy)?;
            let (kind, id) = definition_at(path)?;
            Some(ChangedFile { kind, id, status })
        })
        .collect())
}

/// The most bytes of diff `file_diff` returns: enough for a file of the size Quay opens to be
/// replaced by another.
pub const MAX_DIFF_BYTES: usize = 2 * MAX_FILE_BYTES as usize + 64 * 1024;

/// The diff of the definition `kind`/`id` against the last commit, staged changes included.
/// A file new since the commit shows as all added, and a deleted one as all removed.
/// Refused for a kind that doesn't show changes, an unsafe id, a file or folder that leads
/// out of the repository, and a project that isn't a git repository.
pub fn file_diff(repo: &Path, kind: PraxisKind, id: &str) -> Result<FileDiff, String> {
    validate_id(id)?;
    if !SHOWS_CHANGES.contains(&kind) {
        return Err(format!("The builder doesn't show changes since the last commit for {}.", kind.folder()));
    }
    if let Some(dir) = confined_dir(repo, kind.folder())? {
        confined_file(repo, &dir, id)?;
    }
    let path = format!("{}/{}/{}.json", PRAXIS_DIR, kind.folder(), id);
    if !is_repository(repo)? {
        return Err(format!("The project isn't a git repository, so {} has no last commit to compare with.", path));
    }
    let status = status(repo, std::slice::from_ref(&path))?.into_iter().next().map(|f| f.status);
    let base = ["diff", "--no-color", "--no-ext-diff", "--no-textconv"];
    let args: Vec<&str> = match status {
        None => return Ok(FileDiff { path, status, diff: String::new(), truncated: false }),
        // The last commit doesn't have it, or there is no commit yet: all of it is new.
        Some(ChangeStatus::Added) => [&base[..], &["--no-index", "--", "/dev/null", &path]].concat(),
        Some(_) => [&base[..], &["HEAD", "--", &path]].concat(),
    };
    let out = git(repo, &args)?;
    // `--no-index` exits 1 when the files differ, as they always do here.
    let ok = out.status.success() || (status == Some(ChangeStatus::Added) && out.status.code() == Some(1));
    if !ok {
        return Err(failed(&args, &out));
    }
    let mut diff = String::from_utf8_lossy(&out.stdout).into_owned();
    let truncated = diff.len() > MAX_DIFF_BYTES;
    if truncated {
        let mut end = MAX_DIFF_BYTES;
        while !diff.is_char_boundary(end) {
            end -= 1;
        }
        diff.truncate(diff[..end].rfind('\n').map_or(0, |i| i + 1));
    }
    Ok(FileDiff { path, status, diff, truncated })
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;
    use crate::slices::praxis::models::{ChangeStatus, ChangedFile};

    fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("quay2-praxis-changes-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::canonicalize(dir).unwrap()
    }

    fn git(repo: &Path, args: &[&str]) {
        let out = crate::spawn::hidden_command("git").current_dir(repo).args(args).output().unwrap();
        assert!(out.status.success(), "git {:?}: {}", args, String::from_utf8_lossy(&out.stderr));
    }

    fn write(repo: &Path, rel: &str, body: &str) {
        let path = repo.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, body).unwrap();
    }

    /// A repository with one commit holding `files`.
    fn committed_repo(files: &[(&str, &str)]) -> PathBuf {
        let repo = temp_dir();
        git(&repo, &["init", "-q"]);
        for (k, v) in [("user.name", "Quay Test"), ("user.email", "quay@example.invalid"), ("core.autocrlf", "false")] {
            git(&repo, &["config", k, v]);
        }
        for (rel, body) in files {
            write(&repo, rel, body);
        }
        git(&repo, &["add", "-A"]);
        git(&repo, &["commit", "-q", "--allow-empty", "-m", "init"]);
        repo
    }

    fn changed(kind: PraxisKind, id: &str, status: ChangeStatus) -> ChangedFile {
        ChangedFile { kind, id: id.to_string(), status }
    }

    #[test]
    fn an_edited_grant_is_changed_since_the_last_commit() {
        let repo = committed_repo(&[(".praxis/grants/a.json", "{\"id\":\"a\"}\n"), (".praxis/grants/b.json", "{\"id\":\"b\"}\n")]);
        write(&repo, ".praxis/grants/a.json", "{\"id\":\"a\",\"limit\":\"5\"}\n");
        let got = changed_files(&repo).unwrap();
        assert_eq!(got.files, vec![changed(PraxisKind::Grants, "a", ChangeStatus::Modified)]);
    }

    #[test]
    fn a_project_that_is_not_a_git_repository_has_no_changes_and_no_error() {
        let repo = temp_dir();
        write(&repo, ".praxis/grants/a.json", "{}");
        assert_eq!(changed_files(&repo).unwrap().files, vec![]);
    }

    #[test]
    fn a_project_inside_another_repository_has_no_changes() {
        let outer = committed_repo(&[]);
        write(&outer, "project/.praxis/grants/a.json", "{}");
        assert_eq!(changed_files(&outer.join("project")).unwrap().files, vec![]);
    }

    #[test]
    fn new_staged_and_deleted_contracts_and_grants_are_changed() {
        let repo = committed_repo(&[
            (".praxis/contracts/kept.json", "{}\n"),
            (".praxis/contracts/gone.json", "{}\n"),
            (".praxis/grants/staged.json", "{}\n"),
        ]);
        write(&repo, ".praxis/contracts/new.json", "{}\n");
        std::fs::remove_file(repo.join(".praxis/contracts/gone.json")).unwrap();
        write(&repo, ".praxis/grants/staged.json", "{\"limit\":\"1\"}\n");
        write(&repo, ".praxis/grants/added.json", "{}\n");
        git(&repo, &["add", ".praxis/grants"]);
        assert_eq!(
            changed_files(&repo).unwrap().files,
            vec![
                changed(PraxisKind::Contracts, "gone", ChangeStatus::Deleted),
                changed(PraxisKind::Contracts, "new", ChangeStatus::Added),
                changed(PraxisKind::Grants, "added", ChangeStatus::Added),
                changed(PraxisKind::Grants, "staged", ChangeStatus::Modified),
            ]
        );
    }

    #[test]
    fn a_repository_with_no_commit_yet_has_every_file_new() {
        let repo = temp_dir();
        git(&repo, &["init", "-q"]);
        write(&repo, ".praxis/grants/a.json", "{}\n");
        assert_eq!(changed_files(&repo).unwrap().files, vec![changed(PraxisKind::Grants, "a", ChangeStatus::Added)]);
    }

    #[test]
    fn only_the_kinds_that_show_changes_are_reported() {
        let repo = committed_repo(&[]);
        for rel in [
            ".praxis/graphs/g.json",
            ".praxis/triggers/t.json",
            ".praxis/bindings/c.json",
            ".praxis/layout/g.json",
            ".praxis/grants/nested/x.json",
            ".praxis/grants/notes.txt",
            ".machina/factory.json",
        ] {
            write(&repo, rel, "{}\n");
        }
        assert_eq!(changed_files(&repo).unwrap().files, vec![]);
    }

    /// The diff's changed lines, with their `+` or `-`, leaving out the headers.
    fn changed_lines(diff: &FileDiff) -> Vec<&str> {
        diff.diff
            .lines()
            .skip_while(|l| !l.starts_with("@@"))
            .filter(|l| l.starts_with('+') || l.starts_with('-'))
            .collect()
    }

    #[test]
    fn the_diff_shows_an_edited_grant_against_the_last_commit() {
        let repo = committed_repo(&[(".praxis/grants/a.json", "{\n  \"id\": \"a\",\n  \"limit\": \"5\"\n}\n")]);
        write(&repo, ".praxis/grants/a.json", "{\n  \"id\": \"a\",\n  \"limit\": \"50\"\n}\n");
        let diff = file_diff(&repo, PraxisKind::Grants, "a").unwrap();
        assert_eq!(diff.path, ".praxis/grants/a.json");
        assert_eq!(diff.status, Some(ChangeStatus::Modified));
        assert_eq!(changed_lines(&diff), vec!["-  \"limit\": \"5\"", "+  \"limit\": \"50\""]);
    }

    #[test]
    fn a_new_contract_diffs_as_all_added_and_a_deleted_one_as_all_removed() {
        let repo = committed_repo(&[(".praxis/contracts/gone.json", "{\n  \"id\": \"gone\"\n}\n")]);
        write(&repo, ".praxis/contracts/new.json", "{\n  \"id\": \"new\"\n}\n");
        std::fs::remove_file(repo.join(".praxis/contracts/gone.json")).unwrap();

        let new = file_diff(&repo, PraxisKind::Contracts, "new").unwrap();
        assert_eq!(new.status, Some(ChangeStatus::Added));
        assert_eq!(changed_lines(&new), vec!["+{", "+  \"id\": \"new\"", "+}"]);

        let gone = file_diff(&repo, PraxisKind::Contracts, "gone").unwrap();
        assert_eq!(gone.status, Some(ChangeStatus::Deleted));
        assert_eq!(changed_lines(&gone), vec!["-{", "-  \"id\": \"gone\"", "-}"]);
    }

    #[test]
    fn a_new_grant_in_a_repository_with_no_commit_yet_diffs_as_all_added() {
        let repo = temp_dir();
        git(&repo, &["init", "-q"]);
        write(&repo, ".praxis/grants/a.json", "{}\n");
        git(&repo, &["add", "-A"]);
        let diff = file_diff(&repo, PraxisKind::Grants, "a").unwrap();
        assert_eq!(diff.status, Some(ChangeStatus::Added));
        assert_eq!(changed_lines(&diff), vec!["+{}"]);
    }

    #[test]
    fn an_unchanged_grant_has_an_empty_diff() {
        let repo = committed_repo(&[(".praxis/grants/a.json", "{}\n")]);
        let diff = file_diff(&repo, PraxisKind::Grants, "a").unwrap();
        assert_eq!((diff.status, diff.diff.as_str(), diff.truncated), (None, "", false));
    }

    #[test]
    fn the_diff_is_refused_outside_a_repository_rooted_at_the_project() {
        let plain = temp_dir();
        write(&plain, ".praxis/grants/a.json", "{}\n");
        assert!(file_diff(&plain, PraxisKind::Grants, "a").unwrap_err().contains("isn't a git repository"));

        let outer = committed_repo(&[("project/.praxis/grants/a.json", "{}\n")]);
        write(&outer, "project/.praxis/grants/a.json", "{\"limit\":\"1\"}\n");
        assert!(file_diff(&outer.join("project"), PraxisKind::Grants, "a").is_err());
    }

    #[test]
    fn the_diff_is_refused_for_other_kinds_and_unsafe_ids() {
        let repo = committed_repo(&[]);
        write(&repo, ".praxis/graphs/g.json", "{}\n");
        assert!(file_diff(&repo, PraxisKind::Graphs, "g").is_err());
        assert!(file_diff(&repo, PraxisKind::Grants, "../../secret").is_err());
    }
}
