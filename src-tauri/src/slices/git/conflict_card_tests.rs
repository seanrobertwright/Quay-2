//! The side-picker cards' backend (#352, #391) against throwaway repositories with a linked
//! worktree, built with the system git: for each conflict the three-pane resolver can't edit as
//! text, what each card's choice leaves in the index and the worktree.

use std::path::{Path, PathBuf};

use super::conflict::{mark_resolved, open_conflict, remove_conflict, take_side, ConflictSide, NotEditable};
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

fn write(name: &'static str, bytes: impl AsRef<[u8]>) -> impl Fn(&Path) {
    move |dir: &Path| std::fs::write(dir.join(name), bytes.as_ref()).unwrap()
}

fn delete(name: &'static str) -> impl Fn(&Path) {
    move |dir: &Path| std::fs::remove_file(dir.join(name)).unwrap()
}

fn rename(from: &'static str, to: &'static str) -> impl Fn(&Path) {
    move |dir: &Path| std::fs::rename(dir.join(from), dir.join(to)).unwrap()
}

/// `git ls-files -s` for `path`: every index entry it has, stages included.
fn index_entries(wt: &Path, path: &str) -> String {
    git(wt, &["ls-files", "-s", "--", path])
}

/// The raw bytes `git <args>` prints in `dir`.
fn git_bytes(dir: &Path, args: &[&str]) -> Vec<u8> {
    let out = crate::spawn::hidden_command("git").current_dir(dir).args(args).output().unwrap();
    assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
    out.stdout
}

/// A file changed on the left and deleted on the right: `UD`.
fn changed_and_deleted() -> (PathBuf, PathBuf) {
    conflict(&write("notes.txt", "one\n"), &write("notes.txt", "one\nours\n"), &delete("notes.txt"))
}

/// A file deleted on the left and changed on the right: `DU`.
fn deleted_and_changed() -> (PathBuf, PathBuf) {
    conflict(&write("notes.txt", "one\n"), &delete("notes.txt"), &write("notes.txt", "one\ntheirs\n"))
}

#[test]
fn accepting_the_deletion_of_a_file_changed_on_the_left_removes_it_from_the_index_and_the_worktree() {
    let (root, wt) = changed_and_deleted();
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
    for ((root, wt), xy, bytes) in [(changed_and_deleted(), "UD", "one\nours\n"), (deleted_and_changed(), "DU", "one\ntheirs\n")] {
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
    let (root, wt) = deleted_and_changed();
    let opened = open_conflict(&wt, "notes.txt").unwrap();
    assert_eq!(opened.xy, "DU");

    let removed = remove_conflict(&StagingLocks::default(), &wt, 1, "notes.txt", &opened.token).expect("the removal lands");
    assert_eq!(index_entries(&wt, "notes.txt"), "");
    assert!(!wt.join("notes.txt").exists());
    assert_eq!(git(&wt, &["cat-file", "blob", &removed.backup.blob.unwrap()]), "one\ntheirs\n");
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn taking_a_side_that_deleted_the_file_is_refused_and_changes_nothing() {
    let (root, wt) = changed_and_deleted();
    let opened = open_conflict(&wt, "notes.txt").unwrap();
    let before = index_entries(&wt, "notes.txt");

    let taken = take_side(&StagingLocks::default(), &wt, 1, "notes.txt", &opened.token, ConflictSide::Right);
    match taken {
        Err(GitError::Other { stderr }) => assert!(stderr.contains("has no right side"), "{stderr}"),
        other => panic!("refused, not {other:?}"),
    }
    assert_eq!(index_entries(&wt, "notes.txt"), before);
    assert_eq!(std::fs::read(wt.join("notes.txt")).unwrap(), b"one\nours\n");
    let _ = std::fs::remove_dir_all(root);
}

/// `a.txt` renamed to `left.txt` on the left and to `right.txt` on the right, which leaves `a.txt`
/// deleted on both sides (`DD`), `left.txt` added by us (`AU`) and `right.txt` added by them (`UA`).
fn rename_conflict() -> (PathBuf, PathBuf) {
    conflict(&write("a.txt", "shared\n"), &rename("a.txt", "left.txt"), &rename("a.txt", "right.txt"))
}

#[test]
fn a_rename_on_both_sides_opens_as_both_deleted_and_one_addition_per_side() {
    let (root, wt) = rename_conflict();
    assert_eq!(open_conflict(&wt, "a.txt").unwrap().xy, "DD");
    assert_eq!(open_conflict(&wt, "left.txt").unwrap().xy, "AU");
    assert_eq!(open_conflict(&wt, "right.txt").unwrap().xy, "UA");
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn keeping_a_file_one_side_added_stages_it_and_removing_it_drops_it() {
    let (root, wt) = rename_conflict();
    let left = open_conflict(&wt, "left.txt").unwrap();
    let right = open_conflict(&wt, "right.txt").unwrap();

    mark_resolved(&StagingLocks::default(), &wt, 1, "left.txt", &left.token).expect("AU keeps");
    assert_eq!(index_entries(&wt, "left.txt").split_whitespace().nth(2), Some("0"), "staged at stage 0");
    assert_eq!(git(&wt, &["show", ":left.txt"]), "shared\n");
    assert_eq!(std::fs::read(wt.join("left.txt")).unwrap(), b"shared\n");

    let removed = remove_conflict(&StagingLocks::default(), &wt, 1, "right.txt", &right.token).expect("UA removes");
    assert_eq!(index_entries(&wt, "right.txt"), "");
    assert!(!wt.join("right.txt").exists());
    assert_eq!(git(&wt, &["cat-file", "blob", &removed.backup.blob.unwrap()]), "shared\n");
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn keeping_a_file_one_side_added_writes_it_back_when_the_worktree_lost_it() {
    let (root, wt) = rename_conflict();
    std::fs::remove_file(wt.join("right.txt")).unwrap();
    let right = open_conflict(&wt, "right.txt").unwrap();
    assert!(!right.on_disk);

    take_side(&StagingLocks::default(), &wt, 1, "right.txt", &right.token, ConflictSide::Right).expect("UA keeps");
    assert_eq!(git(&wt, &["show", ":right.txt"]), "shared\n");
    assert_eq!(std::fs::read(wt.join("right.txt")).unwrap(), b"shared\n");
    assert_eq!(git(&wt, &["ls-files", "-u", "--", "right.txt"]), "");
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn removing_a_file_both_sides_deleted_clears_its_entries_and_backs_up_nothing() {
    let (root, wt) = rename_conflict();
    let opened = open_conflict(&wt, "a.txt").unwrap();
    assert!(!opened.on_disk);

    let removed = remove_conflict(&StagingLocks::default(), &wt, 1, "a.txt", &opened.token).expect("DD removes");
    assert_eq!(index_entries(&wt, "a.txt"), "");
    assert!(!wt.join("a.txt").exists());
    assert_eq!((removed.backup.blob, removed.backup.after), (None, None));
    let _ = std::fs::remove_dir_all(root);
}

/// For each side in turn: a conflict on `name` from `base`, `ours` and `theirs`, opened (it must
/// give `reason`), then that side taken whole. Checks the index holds that side alone, the
/// worktree holds its bytes, and the bytes the worktree had are backed up.
fn take_each_side(name: &'static str, base: &[u8], ours: &[u8], theirs: &[u8], reason: NotEditable) {
    for (side, bytes) in [(ConflictSide::Left, ours), (ConflictSide::Right, theirs)] {
        let (root, wt) = conflict(&write(name, base.to_vec()), &write(name, ours.to_vec()), &write(name, theirs.to_vec()));
        let opened = open_conflict(&wt, name).unwrap();
        assert_eq!((opened.editable, opened.reason), (false, Some(reason)), "{name} opens as a card");
        let before = std::fs::read(wt.join(name)).unwrap();

        let taken = take_side(&StagingLocks::default(), &wt, 1, name, &opened.token, side).expect("the side lands");
        assert_eq!(git(&wt, &["ls-files", "-u", "--", name]), "", "{side:?}: no unmerged stages remain");
        assert_eq!(git_bytes(&wt, &["show", &format!(":{name}")]), bytes, "{side:?}: the side is staged byte for byte");
        assert_eq!(std::fs::read(wt.join(name)).unwrap(), bytes, "{side:?}: the worktree holds it");
        let blob = taken.backup.blob.expect("the worktree bytes were backed up");
        assert_eq!(git_bytes(&wt, &["cat-file", "blob", &blob]), before);
        let _ = std::fs::remove_dir_all(root);
    }
}

#[test]
fn a_binary_conflict_takes_either_side_whole() {
    take_each_side("logo.bin", b"\x00base\x01", b"\x00ours\x02", b"\x00theirs\x03", NotEditable::Binary);
}

#[test]
fn a_non_utf8_conflict_takes_either_side_whole() {
    take_each_side("latin1.txt", b"caf\xe9\n", b"caf\xe9 ours\n", b"caf\xe9 theirs\n", NotEditable::NotUtf8);
}

#[test]
fn a_mixed_line_ending_conflict_takes_either_side_whole() {
    take_each_side("mixed.txt", b"one\r\ntwo\n", b"one\r\nours\n", b"one\r\ntheirs\n", NotEditable::MixedLineEndings);
}

#[test]
fn a_too_large_conflict_takes_either_side_whole() {
    // Past the 1 MiB cap, with a last line each side changes, so git leaves markers.
    let big = |last: &str| {
        let mut out = "line 01\n".repeat(1024 * 1024 / 8 + 1).into_bytes();
        out.extend_from_slice(last.as_bytes());
        out
    };
    take_each_side("big.txt", &big("base\n"), &big("ours\n"), &big("theirs\n"), NotEditable::TooLarge);
}
