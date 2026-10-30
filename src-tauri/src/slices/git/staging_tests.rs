//! The staging inspector's status and whole-path staging (#382) against throwaway repositories
//! with a linked worktree, built with the system git.

use std::path::{Path, PathBuf};

use serde_json::Value;

use super::error::GitError;
use super::staging::{ignore_folder, read_status, stage_paths, unstage_paths, PathTarget, StagingLocks, STATUS_CAP};

pub(super) fn git(dir: &Path, args: &[&str]) -> String {
    let out = crate::spawn::hidden_command("git").current_dir(dir).args(args).output().unwrap();
    assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
    String::from_utf8_lossy(&out.stdout).into_owned()
}

/// A repo on `main` with `README.md` and `src/lib.rs` committed, and a linked worktree on `feat`.
/// Returns (root, worktree); the tests work in the worktree, whose index lives under the main
/// repo's `.git/worktrees/`.
pub(super) fn repo_with_worktree() -> (PathBuf, PathBuf) {
    let root = std::env::temp_dir().join(format!("quay-stage-{}", uuid::Uuid::new_v4().simple()));
    let repo = root.join("repo");
    let worktree = root.join("wt");
    std::fs::create_dir_all(repo.join("src")).unwrap();
    git(&repo, &["init", "-q", "-b", "main"]);
    for (k, v) in [
        ("user.name", "Quay Test"),
        ("user.email", "quay@example.invalid"),
        ("core.hooksPath", ".git/no-hooks"),
        ("core.autocrlf", "false"),
        ("commit.gpgSign", "false"),
    ] {
        git(&repo, &["config", k, v]);
    }
    std::fs::write(repo.join("README.md"), "readme\n").unwrap();
    std::fs::write(repo.join("src/lib.rs"), "fn main() {}\n").unwrap();
    git(&repo, &["add", "-A"]);
    git(&repo, &["commit", "-q", "-m", "init"]);
    git(&repo, &["worktree", "add", "-q", "-b", "feat", &worktree.to_string_lossy()]);
    (root, worktree)
}

fn status_json(worktree: &Path, request_id: u32, folder: Option<&str>) -> Value {
    serde_json::to_value(read_status(worktree, request_id, folder).expect("status reads")).unwrap()
}

/// The entries as `(path, xy, kind)`, sorted, so a test doesn't depend on git's order.
fn entries(status: &Value) -> Vec<(String, String, String)> {
    let mut out: Vec<_> = status["entries"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| (e["path"].as_str().unwrap().into(), e["xy"].as_str().unwrap().into(), e["kind"].as_str().unwrap().into()))
        .collect();
    out.sort();
    out
}

fn e(path: &str, xy: &str, kind: &str) -> (String, String, String) {
    (path.into(), xy.into(), kind.into())
}

#[test]
fn status_lists_staged_unstaged_and_untracked_folders_and_echoes_its_request_id() {
    let (root, wt) = repo_with_worktree();
    std::fs::write(wt.join("README.md"), "changed\n").unwrap();
    std::fs::write(wt.join("added.txt"), "new\n").unwrap();
    git(&wt, &["add", "added.txt"]);
    std::fs::create_dir_all(wt.join("notes/deep")).unwrap();
    std::fs::write(wt.join("notes/a.md"), "a\n").unwrap();
    std::fs::write(wt.join("notes/deep/b.md"), "b\n").unwrap();

    let status = status_json(&wt, 7, None);
    assert_eq!(status["requestId"], 7);
    assert_eq!(status["total"], 3);
    assert_eq!(status["truncated"], false);
    // `-unormal` folds an untracked folder into one folder row.
    assert_eq!(
        entries(&status),
        [e("README.md", ".M", "tracked"), e("added.txt", "A.", "tracked"), e("notes", "??", "untrackedFolder")]
    );
    let _ = std::fs::remove_dir_all(root);
}

/// Writes `count` untracked files straight into `dir`, each its own status entry.
fn write_files(dir: &Path, count: usize) {
    std::fs::create_dir_all(dir).unwrap();
    for i in 0..count {
        std::fs::write(dir.join(format!("f{i:05}.txt")), "x").unwrap();
    }
}

#[test]
fn status_keeps_the_first_ten_thousand_entries_and_counts_the_rest() {
    assert_eq!(STATUS_CAP, 10_000);
    let (root, wt) = repo_with_worktree();
    write_files(&wt, 10_004);
    std::fs::write(wt.join("README.md"), "changed\n").unwrap();

    let status = status_json(&wt, 1, None);
    assert_eq!(status["entries"].as_array().unwrap().len(), 10_000);
    assert_eq!(status["total"], 10_005);
    assert_eq!(status["truncated"], true);
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn a_folder_status_lists_only_that_folders_untracked_files_one_by_one() {
    let (root, wt) = repo_with_worktree();
    std::fs::write(wt.join("README.md"), "changed\n").unwrap();
    std::fs::create_dir_all(wt.join("notes/deep")).unwrap();
    std::fs::write(wt.join("notes/a.md"), "a\n").unwrap();
    std::fs::write(wt.join("notes/deep/b.md"), "b\n").unwrap();
    std::fs::create_dir_all(wt.join("other")).unwrap();
    std::fs::write(wt.join("other/c.md"), "c\n").unwrap();

    let status = status_json(&wt, 2, Some("notes"));
    assert_eq!(status["requestId"], 2);
    assert_eq!(entries(&status), [e("notes/a.md", "??", "untracked"), e("notes/deep/b.md", "??", "untracked")]);
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn a_folder_status_is_capped_too() {
    let (root, wt) = repo_with_worktree();
    write_files(&wt.join("many"), 10_002);

    let status = status_json(&wt, 3, Some("many"));
    assert_eq!(status["entries"].as_array().unwrap().len(), 10_000);
    assert_eq!(status["total"], 10_002);
    assert_eq!(status["truncated"], true);
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn a_folder_outside_the_worktree_is_refused() {
    let (root, wt) = repo_with_worktree();
    for bad in ["../repo", "", "/etc", "C:/Windows", "a/../../b"] {
        assert!(
            matches!(read_status(&wt, 1, Some(bad)), Err(GitError::Other { .. })),
            "{bad:?} should be refused"
        );
    }
    let _ = std::fs::remove_dir_all(root);
}

fn paths(list: &[&str]) -> PathTarget {
    PathTarget::Paths { paths: list.iter().map(|p| p.to_string()).collect() }
}

/// What the index holds that HEAD doesn't, as `git diff --cached --name-status` prints it.
fn staged(wt: &Path) -> String {
    git(wt, &["diff", "--cached", "--name-status", "--no-renames"])
}

#[test]
fn staging_files_and_a_folder_returns_the_post_write_status() {
    let (root, wt) = repo_with_worktree();
    std::fs::write(wt.join("README.md"), "changed\n").unwrap();
    std::fs::write(wt.join("src/lib.rs"), "fn main() { 1; }\n").unwrap();
    std::fs::create_dir_all(wt.join("notes/deep")).unwrap();
    std::fs::write(wt.join("notes/a.md"), "a\n").unwrap();
    std::fs::write(wt.join("notes/deep/b.md"), "b\n").unwrap();
    std::fs::write(wt.join("name with spaces [1].txt"), "s\n").unwrap();

    let locks = StagingLocks::default();
    let status = stage_paths(&locks, &wt, 9, &paths(&["README.md", "notes", "name with spaces [1].txt"])).unwrap();
    let status = serde_json::to_value(status).unwrap();
    assert_eq!(status["requestId"], 9);
    assert_eq!(
        entries(&status),
        [
            e("README.md", "M.", "tracked"),
            e("name with spaces [1].txt", "A.", "tracked"),
            e("notes/a.md", "A.", "tracked"),
            e("notes/deep/b.md", "A.", "tracked"),
            e("src/lib.rs", ".M", "tracked"),
        ]
    );
    assert_eq!(staged(&wt), "M\tREADME.md\nA\tname with spaces [1].txt\nA\tnotes/a.md\nA\tnotes/deep/b.md\n");
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn unstaging_puts_the_index_back_to_head_and_drops_a_new_file_from_it() {
    let (root, wt) = repo_with_worktree();
    std::fs::write(wt.join("README.md"), "changed\n").unwrap();
    std::fs::write(wt.join("src/lib.rs"), "fn main() { 1; }\n").unwrap();
    std::fs::write(wt.join("new.txt"), "n\n").unwrap();
    git(&wt, &["add", "-A"]);

    let locks = StagingLocks::default();
    let status = unstage_paths(&locks, &wt, 4, &paths(&["README.md", "new.txt"])).unwrap();
    let status = serde_json::to_value(status).unwrap();
    assert_eq!(status["requestId"], 4);
    assert_eq!(
        entries(&status),
        [e("README.md", ".M", "tracked"), e("new.txt", "??", "untracked"), e("src/lib.rs", "M.", "tracked")]
    );
    // The worktree keeps its bytes; only the index moved.
    assert_eq!(std::fs::read_to_string(wt.join("README.md")).unwrap(), "changed\n");
    assert_eq!(staged(&wt), "M\tsrc/lib.rs\n");
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn stage_all_and_unstage_all_act_on_every_change_beyond_the_cap() {
    let (root, wt) = repo_with_worktree();
    write_files(&wt, 10_003);
    std::fs::write(wt.join("README.md"), "changed\n").unwrap();
    std::fs::remove_file(wt.join("src/lib.rs")).unwrap();

    let locks = StagingLocks::default();
    let status = stage_paths(&locks, &wt, 5, &PathTarget::All).unwrap();
    assert_eq!(status.total, 10_005);
    assert!(status.entries.iter().all(|e| e.xy.ends_with('.')), "something stayed unstaged");
    let staged_now = staged(&wt);
    assert_eq!(staged_now.lines().count(), 10_005);
    assert!(staged_now.contains("D\tsrc/lib.rs\n") && staged_now.contains("A\tf10002.txt\n"));

    let status = unstage_paths(&locks, &wt, 6, &PathTarget::All).unwrap();
    assert_eq!(status.total, 10_005);
    assert_eq!(staged(&wt), "");
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn unstaging_on_an_unborn_branch_takes_the_paths_out_of_the_index() {
    let root = std::env::temp_dir().join(format!("quay-stage-{}", uuid::Uuid::new_v4().simple()));
    std::fs::create_dir_all(&root).unwrap();
    git(&root, &["init", "-q", "-b", "main"]);
    std::fs::write(root.join("a.txt"), "a\n").unwrap();
    std::fs::write(root.join("b.txt"), "b\n").unwrap();
    git(&root, &["add", "-A"]);

    let locks = StagingLocks::default();
    let status = unstage_paths(&locks, &root, 1, &paths(&["a.txt"])).unwrap();
    let status = serde_json::to_value(status).unwrap();
    assert_eq!(entries(&status), [e("a.txt", "??", "untracked"), e("b.txt", "A.", "tracked")]);

    let status = unstage_paths(&locks, &root, 2, &PathTarget::All).unwrap();
    let status = serde_json::to_value(status).unwrap();
    assert_eq!(entries(&status), [e("a.txt", "??", "untracked"), e("b.txt", "??", "untracked")]);
    let _ = std::fs::remove_dir_all(root);
}

/// The worktree's own `index.lock`, under the main repo's `.git/worktrees/`.
pub(super) fn index_lock(wt: &Path) -> PathBuf {
    PathBuf::from(git(wt, &["rev-parse", "--path-format=absolute", "--git-path", "index.lock"]).trim())
}

#[test]
fn a_held_index_lock_reports_index_locked_after_retrying_and_is_never_deleted() {
    let (root, wt) = repo_with_worktree();
    std::fs::write(wt.join("README.md"), "changed\n").unwrap();
    let lock = index_lock(&wt);
    std::fs::write(&lock, "held by another git").unwrap();

    let locks = StagingLocks::default();
    let started = std::time::Instant::now();
    assert_eq!(stage_paths(&locks, &wt, 1, &paths(&["README.md"])), Err(GitError::IndexLocked));
    assert!(started.elapsed() >= std::time::Duration::from_millis(600), "gave up without retrying");
    assert_eq!(unstage_paths(&locks, &wt, 2, &PathTarget::All), Err(GitError::IndexLocked));
    assert_eq!(std::fs::read_to_string(&lock).unwrap(), "held by another git");

    // Once the other process lets go, Retry goes through.
    std::fs::remove_file(&lock).unwrap();
    stage_paths(&locks, &wt, 3, &paths(&["README.md"])).unwrap();
    assert_eq!(staged(&wt), "M\tREADME.md\n");
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn one_staging_operation_runs_per_worktree_at_a_time() {
    let (root, wt) = repo_with_worktree();
    let other = root.join("repo");
    std::fs::write(wt.join("README.md"), "changed\n").unwrap();
    let locks = StagingLocks::default();

    let slot = locks.begin(&wt).unwrap();
    assert_eq!(stage_paths(&locks, &wt, 1, &paths(&["README.md"])), Err(GitError::StagingBusy));
    // Another spelling of the same folder shares its slot.
    let spelled = PathBuf::from(format!("{}/", wt.to_string_lossy()));
    assert_eq!(unstage_paths(&locks, &spelled, 2, &PathTarget::All), Err(GitError::StagingBusy));
    assert_eq!(staged(&wt), "");
    // Another worktree has its own.
    stage_paths(&locks, &other, 3, &PathTarget::All).unwrap();

    drop(slot);
    stage_paths(&locks, &wt, 4, &paths(&["README.md"])).unwrap();
    assert_eq!(staged(&wt), "M\tREADME.md\n");
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn ignoring_a_folder_appends_an_anchored_escaped_line_to_gitignore() {
    let (root, wt) = repo_with_worktree();
    std::fs::write(wt.join(".gitignore"), "target").unwrap();
    std::fs::create_dir_all(wt.join("build out/[x]")).unwrap();
    std::fs::write(wt.join("build out/[x]/a.o"), "o").unwrap();
    std::fs::create_dir_all(wt.join("notes")).unwrap();
    std::fs::write(wt.join("notes/a.md"), "a").unwrap();
    git(&wt, &["add", ".gitignore"]);
    git(&wt, &["commit", "-q", "-m", "ignore"]);

    let locks = StagingLocks::default();
    let status = ignore_folder(&locks, &wt, 8, "build out").unwrap();
    let status = serde_json::to_value(status).unwrap();
    assert_eq!(status["requestId"], 8);
    assert_eq!(entries(&status), [e(".gitignore", ".M", "tracked"), e("notes", "??", "untrackedFolder")]);
    assert_eq!(std::fs::read_to_string(wt.join(".gitignore")).unwrap(), "target\n/build out/\n");

    ignore_folder(&locks, &wt, 9, "notes").unwrap();
    std::fs::create_dir_all(wt.join("odd[1]")).unwrap();
    std::fs::write(wt.join("odd[1]/a"), "a").unwrap();
    std::fs::create_dir_all(wt.join("odd1")).unwrap();
    std::fs::write(wt.join("odd1/a"), "a").unwrap();
    let status = serde_json::to_value(ignore_folder(&locks, &wt, 10, "odd[1]").unwrap()).unwrap();
    // The escaped bracket matches that folder alone, not `odd1`.
    assert_eq!(entries(&status), [e(".gitignore", ".M", "tracked"), e("odd1", "??", "untrackedFolder")]);
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn a_path_target_reads_the_frontends_camel_case_shape() {
    let all: PathTarget = serde_json::from_value(serde_json::json!({ "kind": "all" })).unwrap();
    assert_eq!(all, PathTarget::All);
    let some: PathTarget = serde_json::from_value(serde_json::json!({ "kind": "paths", "paths": ["a.txt"] })).unwrap();
    assert_eq!(some, paths(&["a.txt"]));
}
