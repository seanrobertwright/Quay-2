//! The side-picker cards' backend (#352, #391) against throwaway repositories with a linked
//! worktree, built with the system git: for each conflict the three-pane resolver can't edit as
//! text, what each card's choice leaves in the index and the worktree.

use std::path::{Path, PathBuf};

use super::conflict::{mark_resolved, open_conflict, remove_conflict, take_side, ConflictSide};
use super::error::GitError;
use super::staging::StagingLocks;
use super::staging_tests::{git, repo_with_worktree};

/// Runs `git <args>` in `dir`, which is expected to stop on a conflict and so exit non-zero.
fn git_stops(dir: &Path, args: &[&str]) {
    let out = crate::spawn::hidden_command("git").current_dir(dir).args(args).output().unwrap();
    assert!(!out.status.success(), "git {args:?} should stop on its conflict: {}", String::from_utf8_lossy(&out.stdout));
}

/// What one side of the merge does to the tree, staged with `git add -A` and committed.
type Change<'a> = &'a dyn Fn(&Path);

/// `base` committed on `main`, then `ours` committed on `feat` (the worktree) and `theirs` on
/// `main`, then `main` merged into `feat`, which stops on the conflict. Returns (root, worktree).
fn conflict(base: Change, ours: Change, theirs: Change) -> (PathBuf, PathBuf) {
    let (root, wt) = repo_with_worktree();
    let repo = root.join("repo");
    base(&repo);
    git(&repo, &["add", "-A"]);
    git(&repo, &["commit", "-q", "-m", "Base"]);
    git(&wt, &["merge", "-q", "main"]);
    theirs(&repo);
    git(&repo, &["add", "-A"]);
    git(&repo, &["commit", "-q", "-m", "Theirs"]);
    ours(&wt);
    git(&wt, &["add", "-A"]);
    git(&wt, &["commit", "-q", "-m", "Ours"]);
    git_stops(&wt, &["merge", "main"]);
    (root, wt)
}

fn write(name: &'static str, bytes: &'static [u8]) -> impl Fn(&Path) {
    move |dir: &Path| std::fs::write(dir.join(name), bytes).unwrap()
}

fn delete(name: &'static str) -> impl Fn(&Path) {
    move |dir: &Path| std::fs::remove_file(dir.join(name)).unwrap()
}

fn nothing(_: &Path) {}

/// `git ls-files -s` for `path`: every index entry it has, stages included.
fn index_entries(wt: &Path, path: &str) -> String {
    git(wt, &["ls-files", "-s", "--", path])
}

#[test]
fn accepting_the_deletion_of_a_file_changed_on_the_left_removes_it_from_the_index_and_the_worktree() {
    let (root, wt) = conflict(&write("notes.txt", b"one\n"), &write("notes.txt", b"one\nours\n"), &delete("notes.txt"));
    let opened = open_conflict(&wt, "notes.txt").unwrap();
    assert_eq!(opened.xy, "UD");

    let removed = remove_conflict(&StagingLocks::default(), &wt, 3, "notes.txt", &opened.token).expect("the removal lands");
    assert_eq!(index_entries(&wt, "notes.txt"), "", "no entry, staged or unmerged, remains");
    assert!(!wt.join("notes.txt").exists(), "the file is gone from the worktree");
    assert_eq!(git(&wt, &["cat-file", "blob", &removed.backup.blob.expect("the file was backed up")]), "one\nours\n");
    assert_eq!(removed.backup.after, None);
    assert_eq!(removed.status.request_id, 3);
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn keeping_a_file_changed_on_one_side_and_deleted_on_the_other_stages_it_as_it_stands() {
    let ours_changed = conflict(&write("notes.txt", b"one
"), &write("notes.txt", b"one
ours
"), &delete("notes.txt"));
    let theirs_changed = conflict(&write("notes.txt", b"one
"), &delete("notes.txt"), &write("notes.txt", b"one
theirs
"));
    for ((root, wt), xy, bytes) in [(ours_changed, "UD", "one
ours
"), (theirs_changed, "DU", "one
theirs
")] {
        let opened = open_conflict(&wt, "notes.txt").unwrap();
        assert_eq!(opened.xy, xy);

        mark_resolved(&StagingLocks::default(), &wt, 1, "notes.txt", &opened.token).expect("it stages");
        assert_eq!(git(&wt, &["ls-files", "-u"]), "", "{xy}: no unmerged stages remain");
        assert_eq!(git(&wt, &["show", ":notes.txt"]), bytes, "{xy}: the changed file is staged");
        assert_eq!(std::fs::read_to_string(wt.join("notes.txt")).unwrap(), bytes, "{xy}: the worktree keeps it");
        let _ = std::fs::remove_dir_all(root);
    }
}

#[test]
fn accepting_the_deletion_of_a_file_changed_on_the_right_removes_it() {
    let (root, wt) = conflict(&write("notes.txt", b"one
"), &delete("notes.txt"), &write("notes.txt", b"one
theirs
"));
    let opened = open_conflict(&wt, "notes.txt").unwrap();
    assert_eq!(opened.xy, "DU");

    let removed = remove_conflict(&StagingLocks::default(), &wt, 1, "notes.txt", &opened.token).expect("the removal lands");
    assert_eq!(index_entries(&wt, "notes.txt"), "");
    assert!(!wt.join("notes.txt").exists());
    assert_eq!(git(&wt, &["cat-file", "blob", &removed.backup.blob.unwrap()]), "one
theirs
");
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn taking_a_side_that_deleted_the_file_is_refused_and_changes_nothing() {
    let (root, wt) = conflict(&write("notes.txt", b"one
"), &write("notes.txt", b"one
ours
"), &delete("notes.txt"));
    let opened = open_conflict(&wt, "notes.txt").unwrap();
    let before = index_entries(&wt, "notes.txt");

    let taken = take_side(&StagingLocks::default(), &wt, 1, "notes.txt", &opened.token, ConflictSide::Right);
    match taken {
        Err(GitError::Other { stderr }) => assert!(stderr.contains("has no right side"), "{stderr}"),
        other => panic!("refused, not {other:?}"),
    }
    assert_eq!(index_entries(&wt, "notes.txt"), before);
    assert_eq!(std::fs::read(wt.join("notes.txt")).unwrap(), b"one
ours
");
    let _ = std::fs::remove_dir_all(root);
}
