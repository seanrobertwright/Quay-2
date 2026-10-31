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

/// Points the symbolic link `name` at `target` in the index. The repo keeps `core.symlinks` off,
/// as Git for Windows does, so the worktree holds a plain file with the target and the test runs
/// the same everywhere.
fn link(name: &'static str, target: &'static str) -> impl Fn(&Path) {
    move |dir: &Path| {
        git(dir, &["config", "core.symlinks", "false"]);
        std::fs::write(dir.join(name), target).unwrap();
        let oid = git(dir, &["hash-object", "-w", name]);
        git(dir, &["update-index", "--add", "--cacheinfo", &format!("120000,{},{name}", oid.trim())]);
    }
}

#[test]
fn a_symlink_conflict_takes_either_side_whole_and_stays_a_link() {
    for (side, target) in [(ConflictSide::Left, "ours-target"), (ConflictSide::Right, "theirs-target")] {
        let (root, wt) = conflict(&link("current", "base-target"), &link("current", "ours-target"), &link("current", "theirs-target"));
        let opened = open_conflict(&wt, "current").unwrap();
        assert_eq!((opened.editable, opened.reason), (false, Some(NotEditable::Symlink)));

        let taken = take_side(&StagingLocks::default(), &wt, 1, "current", &opened.token, side).expect("the side lands");
        let entry = index_entries(&wt, "current");
        assert!(entry.starts_with("120000 ") && entry.trim_end().ends_with(" 0\tcurrent"), "{side:?}: a resolved link: {entry}");
        assert_eq!(git(&wt, &["show", ":current"]), target, "{side:?}: it points at that side's target");
        assert_eq!(std::fs::read_to_string(wt.join("current")).unwrap(), target);
        assert!(taken.backup.blob.is_some());
        let _ = std::fs::remove_dir_all(root);
    }
}

/// A new commit in `dir` with git's empty tree and `message`, for a submodule entry to point at.
fn commit_oid(dir: &Path, message: &str) -> String {
    git(dir, &["commit-tree", "4b825dc642cb6eb9a060e54bf8d69288fbee4904", "-m", message]).trim().to_string()
}

/// Points the submodule entry `sub` at a fresh commit named `message`, and returns that change.
fn gitlink(message: &'static str) -> impl Fn(&Path) {
    move |dir: &Path| {
        let oid = commit_oid(dir, message);
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        git(dir, &["update-index", "--add", "--cacheinfo", &format!("160000,{oid},sub")]);
    }
}

#[test]
fn a_submodule_conflict_shows_both_commits_and_refuses_every_card_write() {
    let (root, wt) = conflict(&gitlink("base"), &gitlink("ours"), &gitlink("theirs"));
    let opened = open_conflict(&wt, "sub").unwrap();
    assert_eq!((opened.editable, opened.reason), (false, Some(NotEditable::Submodule)));
    let stage = |n: &str| {
        index_entries(&wt, "sub").lines().find(|l| l.ends_with(&format!(" {n}\tsub"))).and_then(|l| l.split(' ').nth(1)).map(str::to_string)
    };
    assert_eq!(opened.left_oid, stage("2"), "stage 2's commit");
    assert_eq!(opened.right_oid, stage("3"), "stage 3's commit");
    assert!(opened.left_oid.is_some() && opened.left_oid != opened.right_oid);
    let before = index_entries(&wt, "sub");

    let locks = StagingLocks::default();
    for side in [ConflictSide::Left, ConflictSide::Right] {
        let taken = take_side(&locks, &wt, 1, "sub", &opened.token, side);
        assert!(matches!(&taken, Err(GitError::Other { stderr }) if stderr.contains("submodule")), "take {side:?} refused: {taken:?}");
    }
    let removed = remove_conflict(&locks, &wt, 1, "sub", &opened.token);
    assert!(matches!(&removed, Err(GitError::Other { stderr }) if stderr.contains("submodule")), "remove refused: {removed:?}");
    assert_eq!(index_entries(&wt, "sub"), before, "the index is unchanged");
    let _ = std::fs::remove_dir_all(root);
}

/// Makes `name` a real symbolic link to `target`, with `core.symlinks` on so git writes real links.
fn real_link(name: &'static str, target: &'static str) -> impl Fn(&Path) {
    move |dir: &Path| {
        git(dir, &["config", "core.symlinks", "true"]);
        let at = dir.join(name);
        let _ = std::fs::remove_file(&at);
        #[cfg(windows)]
        std::os::windows::fs::symlink_file(target, &at).expect("this machine can create symbolic links");
        #[cfg(unix)]
        std::os::unix::fs::symlink(target, &at).unwrap();
    }
}

#[test]
fn a_real_symlink_conflict_can_be_taken_and_removed_without_writing_through_the_link() {
    let base = real_link("current", "base-target");
    let ours = real_link("current", "ours-target");
    let theirs = real_link("current", "theirs-target");
    let (root, wt) = conflict(&base, &ours, &theirs);
    assert!(std::fs::symlink_metadata(wt.join("current")).unwrap().file_type().is_symlink(), "git left a real link");
    let opened = open_conflict(&wt, "current").unwrap();
    assert_eq!(opened.reason, Some(NotEditable::Symlink));

    let taken = take_side(&StagingLocks::default(), &wt, 1, "current", &opened.token, ConflictSide::Right).expect("the side lands");
    assert_eq!(git(&wt, &["show", ":current"]), "theirs-target");
    assert_eq!(std::fs::read_link(wt.join("current")).unwrap(), Path::new("theirs-target"), "the worktree holds their link");
    let blob = taken.backup.blob.expect("the link was backed up");
    assert_eq!(git(&wt, &["cat-file", "blob", &blob]), "ours-target", "as the target it pointed at");
    let _ = std::fs::remove_dir_all(&root);

    let (root, wt) = conflict(&base, &ours, &theirs);
    let opened = open_conflict(&wt, "current").unwrap();
    remove_conflict(&StagingLocks::default(), &wt, 1, "current", &opened.token).expect("the removal lands");
    assert_eq!(index_entries(&wt, "current"), "");
    assert!(std::fs::symlink_metadata(wt.join("current")).is_err(), "the link is gone");
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn every_card_write_after_an_outside_edit_is_refused_as_stale_and_changes_nothing() {
    let (root, wt) = changed_and_deleted();
    let token = open_conflict(&wt, "notes.txt").unwrap().token;
    // An agent edits the file while its card is open.
    std::fs::write(wt.join("notes.txt"), "one\nagent's pick\n").unwrap();
    let before = index_entries(&wt, "notes.txt");
    let locks = StagingLocks::default();

    assert_eq!(remove_conflict(&locks, &wt, 1, "notes.txt", &token).err(), Some(GitError::ConflictStale));
    assert_eq!(take_side(&locks, &wt, 1, "notes.txt", &token, ConflictSide::Left).err(), Some(GitError::ConflictStale));
    assert_eq!(mark_resolved(&locks, &wt, 1, "notes.txt", &token).err(), Some(GitError::ConflictStale));
    assert_eq!(std::fs::read(wt.join("notes.txt")).unwrap(), b"one\nagent's pick\n");
    assert_eq!(index_entries(&wt, "notes.txt"), before);
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn a_binary_side_taken_after_an_outside_edit_is_refused_as_stale() {
    let (root, wt) = conflict(&write("logo.bin", b"\x00base".to_vec()), &write("logo.bin", b"\x00ours".to_vec()), &write("logo.bin", b"\x00theirs".to_vec()));
    let token = open_conflict(&wt, "logo.bin").unwrap().token;
    std::fs::write(wt.join("logo.bin"), b"\x00agent").unwrap();

    let taken = take_side(&StagingLocks::default(), &wt, 1, "logo.bin", &token, ConflictSide::Right);
    assert_eq!(taken.err(), Some(GitError::ConflictStale));
    assert_eq!(std::fs::read(wt.join("logo.bin")).unwrap(), b"\x00agent");
    assert_ne!(git(&wt, &["ls-files", "-u"]), "", "still conflicted");
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn a_link_retargeted_after_it_was_opened_is_refused_as_stale() {
    let (root, wt) = conflict(&real_link("current", "base-target"), &real_link("current", "ours-target"), &real_link("current", "theirs-target"));
    let token = open_conflict(&wt, "current").unwrap().token;
    std::fs::remove_file(wt.join("current")).unwrap();
    real_link("current", "agent-target")(&wt);

    let removed = remove_conflict(&StagingLocks::default(), &wt, 1, "current", &token);
    assert_eq!(removed.err(), Some(GitError::ConflictStale));
    assert_eq!(std::fs::read_link(wt.join("current")).unwrap(), Path::new("agent-target"));
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn remove_refuses_a_path_outside_the_worktree() {
    let (root, wt) = changed_and_deleted();
    let outside = root.join("outside.txt");
    std::fs::write(&outside, "keep\n").unwrap();
    let token = open_conflict(&wt, "notes.txt").unwrap().token;
    let absolute = wt.join("notes.txt").to_string_lossy().into_owned();

    for path in ["../outside.txt", "sub/../../outside.txt", absolute.as_str(), "/notes.txt", ".git/index", ""] {
        let removed = remove_conflict(&StagingLocks::default(), &wt, 1, path, &token);
        assert!(matches!(removed, Err(GitError::Other { .. })), "remove refuses {path:?}");
    }
    assert_eq!(std::fs::read(&outside).unwrap(), b"keep\n");
    assert_ne!(index_entries(&wt, "notes.txt"), "", "still conflicted");
    let _ = std::fs::remove_dir_all(root);
}

#[cfg(windows)]
#[test]
fn remove_refuses_a_path_through_a_junction_out_of_the_worktree() {
    let (root, wt) = changed_and_deleted();
    let away = root.join("away");
    std::fs::create_dir_all(&away).unwrap();
    std::fs::write(away.join("notes.txt"), "keep\n").unwrap();
    let made = crate::spawn::hidden_command("cmd").args(["/C", "mklink", "/J"]).arg(wt.join("link")).arg(&away).output().unwrap();
    assert!(made.status.success(), "mklink /J: {}", String::from_utf8_lossy(&made.stderr));
    let token = open_conflict(&wt, "notes.txt").unwrap().token;

    assert!(remove_conflict(&StagingLocks::default(), &wt, 1, "link/notes.txt", &token).is_err());
    assert_eq!(std::fs::read(away.join("notes.txt")).unwrap(), b"keep\n");
    let _ = std::fs::remove_dir(wt.join("link"));
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn remove_waits_for_the_worktrees_staging_slot() {
    let (root, wt) = changed_and_deleted();
    let token = open_conflict(&wt, "notes.txt").unwrap().token;
    let locks = StagingLocks::default();
    let _held = locks.begin(&wt).unwrap();

    assert_eq!(remove_conflict(&locks, &wt, 1, "notes.txt", &token).err(), Some(GitError::StagingBusy));
    assert!(wt.join("notes.txt").exists());
    let _ = std::fs::remove_dir_all(root);
}
