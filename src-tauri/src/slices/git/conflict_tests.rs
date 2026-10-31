//! The three-pane resolver's backend (#352, #390) against throwaway repositories with a linked
//! worktree, built with the system git: what opening a conflicted file reads, and Save, Reset file,
//! take-whole-side and Mark resolved writing it back.

use std::path::{Path, PathBuf};

use serde_json::Value;

use super::conflict::{mark_resolved, open_conflict, reset_conflict, save_conflict, take_side, ConflictSide};
use super::error::GitError;
use super::staging::StagingLocks;
use super::staging_tests::{git, repo_with_worktree};

/// Runs `git <args>` in `dir`, which is expected to stop on a conflict and so exit non-zero.
fn git_stops(dir: &Path, args: &[&str]) {
    let out = crate::spawn::hidden_command("git").current_dir(dir).args(args).output().unwrap();
    assert!(!out.status.success(), "git {args:?} should stop on its conflict: {}", String::from_utf8_lossy(&out.stdout));
}

/// `file` committed as `base` on `main`, changed to `ours` on `feat` (the worktree) and to `theirs`
/// on `main`, then `main` merged into `feat`, which stops on the conflict. Returns (root, worktree).
fn merge_conflict(file: &str, base: &[u8], ours: &[u8], theirs: &[u8]) -> (PathBuf, PathBuf) {
    merge_conflict_with("", file, base, ours, theirs)
}

/// [`merge_conflict`], with `attributes` committed as `.gitattributes` alongside the base.
fn merge_conflict_with(attributes: &str, file: &str, base: &[u8], ours: &[u8], theirs: &[u8]) -> (PathBuf, PathBuf) {
    let (root, wt) = repo_with_worktree();
    let repo = root.join("repo");
    if !attributes.is_empty() {
        std::fs::write(repo.join(".gitattributes"), attributes).unwrap();
        git(&repo, &["add", ".gitattributes"]);
    }
    std::fs::write(repo.join(file), base).unwrap();
    git(&repo, &["add", file]);
    git(&repo, &["commit", "-q", "-m", "Base"]);
    git(&wt, &["merge", "-q", "main"]);
    std::fs::write(repo.join(file), theirs).unwrap();
    git(&repo, &["commit", "-q", "-am", "Theirs"]);
    std::fs::write(wt.join(file), ours).unwrap();
    git(&wt, &["commit", "-q", "-am", "Ours"]);
    git_stops(&wt, &["merge", "main"]);
    (root, wt)
}

fn open_json(wt: &Path, path: &str) -> Value {
    serde_json::to_value(open_conflict(wt, path).expect("the conflict opens")).unwrap()
}

#[test]
fn opening_a_conflicted_text_file_reads_both_sides_and_the_worktree_markers() {
    let (root, wt) = merge_conflict("notes.txt", b"one\ntwo\nthree\n", b"one\nours\nthree\n", b"one\ntheirs\nthree\n");

    let file = open_json(&wt, "notes.txt");
    assert_eq!(file["editable"], true);
    assert_eq!(file["reason"], Value::Null);
    assert_eq!(file["left"], "one\nours\nthree\n");
    assert_eq!(file["right"], "one\ntheirs\nthree\n");
    assert_eq!(file["result"], "one\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> main\nthree\n");
    assert_eq!(file["eol"], "lf");
    assert_eq!(file["bom"], false);
    assert_eq!(file["markerSize"], 7);
    assert!(file["token"].as_str().is_some_and(|t| !t.is_empty()), "a token: {file}");
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn opening_honours_the_files_conflict_marker_size() {
    let (root, wt) = merge_conflict_with("*.txt conflict-marker-size=10\n", "notes.txt", b"one\ntwo\nthree\n", b"one\nours\nthree\n", b"one\ntheirs\nthree\n");

    let file = open_json(&wt, "notes.txt");
    assert_eq!(file["markerSize"], 10);
    assert_eq!(file["result"], "one\n<<<<<<<<<< HEAD\nours\n==========\ntheirs\n>>>>>>>>>> main\nthree\n");
    let _ = std::fs::remove_dir_all(root);
}

/// Opens `path` in `wt` and saves `text` over it with the token it opened with.
fn save(wt: &Path, path: &str, text: &str) -> Result<Value, GitError> {
    let opened = open_conflict(wt, path).expect("the conflict opens");
    save_conflict(&StagingLocks::default(), wt, path, &opened.token, text).map(|f| serde_json::to_value(f).unwrap())
}

#[test]
fn saving_writes_the_result_and_reopens_the_file_with_a_new_token() {
    let (root, wt) = merge_conflict("notes.txt", b"one\ntwo\nthree\n", b"one\nours\nthree\n", b"one\ntheirs\nthree\n");
    let before = open_json(&wt, "notes.txt");

    let saved = save(&wt, "notes.txt", "one\nours and theirs\nthree\n").expect("the save lands");
    assert_eq!(std::fs::read(wt.join("notes.txt")).unwrap(), b"one\nours and theirs\nthree\n");
    assert_eq!(saved["result"], "one\nours and theirs\nthree\n");
    assert_eq!(saved["left"], "one\nours\nthree\n");
    assert_ne!(saved["token"], before["token"], "the token pins the new bytes");
    assert_eq!(saved["token"], open_json(&wt, "notes.txt")["token"]);
    let _ = std::fs::remove_dir_all(root);
}

/// Opens `path`, saves its Result back unchanged, and returns (bytes before, bytes after, opened).
fn round_trip(wt: &Path, path: &str) -> (Vec<u8>, Vec<u8>, Value) {
    let before = std::fs::read(wt.join(path)).unwrap();
    let opened = open_json(wt, path);
    save(wt, path, opened["result"].as_str().expect("an editable result")).expect("the save lands");
    (before, std::fs::read(wt.join(path)).unwrap(), opened)
}

#[test]
fn a_crlf_file_saves_back_byte_for_byte() {
    let (root, wt) = merge_conflict("win.txt", b"one\r\ntwo\r\nthree\r\n", b"one\r\nours\r\nthree\r\n", b"one\r\ntheirs\r\nthree\r\n");

    let (before, after, opened) = round_trip(&wt, "win.txt");
    assert_eq!(opened["eol"], "crlf");
    assert_eq!(opened["left"], "one\nours\nthree\n", "the texts use \n");
    assert_eq!(opened["result"], "one\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> main\nthree\n");
    assert!(before.windows(2).any(|w| w == b"\r\n"), "git wrote CRLF markers");
    assert_eq!(after, before);
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn a_file_with_a_bom_saves_back_byte_for_byte() {
    let (root, wt) = merge_conflict("bom.txt", b"\xEF\xBB\xBFone\ntwo\n", b"\xEF\xBB\xBFone\nours\n", b"\xEF\xBB\xBFone\ntheirs\n");

    let (before, after, opened) = round_trip(&wt, "bom.txt");
    assert_eq!(opened["bom"], true);
    assert!(!opened["result"].as_str().unwrap().starts_with('\u{feff}'), "the text has no BOM");
    assert!(before.starts_with(b"\xEF\xBB\xBF"));
    assert_eq!(after, before);
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn a_crlf_file_with_a_bom_and_no_final_newline_saves_back_byte_for_byte() {
    let (root, wt) = merge_conflict("both.txt", b"\xEF\xBB\xBFone\r\ntwo", b"\xEF\xBB\xBFone\r\nours", b"\xEF\xBB\xBFone\r\ntheirs");

    let (before, after, opened) = round_trip(&wt, "both.txt");
    assert_eq!((opened["eol"].clone(), opened["bom"].clone()), (Value::from("crlf"), Value::from(true)));
    assert_eq!(after, before);
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn a_save_after_an_outside_edit_is_refused_as_stale_and_keeps_the_newer_bytes() {
    let (root, wt) = merge_conflict("notes.txt", b"one\ntwo\n", b"one\nours\n", b"one\ntheirs\n");
    let opened = open_conflict(&wt, "notes.txt").unwrap();
    // An agent resolves the file while the resolver has it open.
    std::fs::write(wt.join("notes.txt"), "one\nagent's pick\n").unwrap();

    let saved = save_conflict(&StagingLocks::default(), &wt, "notes.txt", &opened.token, "one\nmine\n");
    assert_eq!(saved, Err(GitError::ConflictStale));
    assert_eq!(std::fs::read(wt.join("notes.txt")).unwrap(), b"one\nagent's pick\n");
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn a_save_after_the_file_was_staged_elsewhere_is_refused_as_stale() {
    let (root, wt) = merge_conflict("notes.txt", b"one\ntwo\n", b"one\nours\n", b"one\ntheirs\n");
    let opened = open_conflict(&wt, "notes.txt").unwrap();
    git(&wt, &["add", "notes.txt"]);

    let saved = save_conflict(&StagingLocks::default(), &wt, "notes.txt", &opened.token, "one\nmine\n");
    assert_eq!(saved, Err(GitError::ConflictStale));
    assert!(std::fs::read_to_string(wt.join("notes.txt")).unwrap().contains("<<<<<<< HEAD"));
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn open_and_save_refuse_a_path_outside_the_worktree() {
    let (root, wt) = merge_conflict("notes.txt", b"one\ntwo\n", b"one\nours\n", b"one\ntheirs\n");
    let outside = root.join("outside.txt");
    std::fs::write(&outside, "keep\n").unwrap();
    let token = open_conflict(&wt, "notes.txt").unwrap().token;
    let absolute = wt.join("notes.txt").to_string_lossy().into_owned();

    for path in ["../outside.txt", "sub/../../outside.txt", absolute.as_str(), "/notes.txt", ""] {
        assert!(matches!(open_conflict(&wt, path), Err(GitError::Other { .. })), "open refuses {path:?}");
        let saved = save_conflict(&StagingLocks::default(), &wt, path, &token, "x\n");
        assert!(matches!(saved, Err(GitError::Other { .. })), "save refuses {path:?}");
    }
    assert_eq!(std::fs::read(&outside).unwrap(), b"keep\n");
    let _ = std::fs::remove_dir_all(root);
}

#[cfg(windows)]
#[test]
fn open_and_save_refuse_a_path_through_a_junction_out_of_the_worktree() {
    let (root, wt) = merge_conflict("notes.txt", b"one\ntwo\n", b"one\nours\n", b"one\ntheirs\n");
    let away = root.join("away");
    std::fs::create_dir_all(&away).unwrap();
    std::fs::write(away.join("notes.txt"), "keep\n").unwrap();
    let made = crate::spawn::hidden_command("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(wt.join("link"))
        .arg(&away)
        .output()
        .unwrap();
    assert!(made.status.success(), "mklink /J: {}", String::from_utf8_lossy(&made.stderr));
    let token = open_conflict(&wt, "notes.txt").unwrap().token;

    assert!(open_conflict(&wt, "link/notes.txt").is_err());
    assert!(save_conflict(&StagingLocks::default(), &wt, "link/notes.txt", &token, "x\n").is_err());
    assert_eq!(std::fs::read(away.join("notes.txt")).unwrap(), b"keep\n");
    let _ = std::fs::remove_dir(wt.join("link"));
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn reset_file_backs_up_the_saved_result_and_brings_the_markers_back() {
    let (root, wt) = merge_conflict("notes.txt", b"one\ntwo\n", b"one\nours\n", b"one\ntheirs\n");
    let saved = save(&wt, "notes.txt", "one\nhalf done\n").unwrap();

    let reset = reset_conflict(&StagingLocks::default(), &wt, "notes.txt", saved["token"].as_str().unwrap()).expect("the reset lands");
    // `checkout -m` labels the sides with git's own "ours" and "theirs".
    let markers = "one\n<<<<<<< ours\nours\n=======\ntheirs\n>>>>>>> theirs\n";
    assert_eq!(std::fs::read_to_string(wt.join("notes.txt")).unwrap(), markers);
    assert_eq!(reset.file.result.as_deref(), Some(markers));
    let blob = reset.backup.blob.expect("the saved bytes were backed up");
    assert_eq!(git(&wt, &["cat-file", "blob", &blob]), "one\nhalf done\n");
    assert_eq!(reset.backup.after.as_deref(), Some(git(&wt, &["hash-object", "notes.txt"]).trim()));
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn reset_file_after_an_outside_edit_is_refused_as_stale() {
    let (root, wt) = merge_conflict("notes.txt", b"one\ntwo\n", b"one\nours\n", b"one\ntheirs\n");
    let token = open_conflict(&wt, "notes.txt").unwrap().token;
    std::fs::write(wt.join("notes.txt"), "one\nagent's pick\n").unwrap();

    let reset = reset_conflict(&StagingLocks::default(), &wt, "notes.txt", &token);
    assert_eq!(reset.err(), Some(GitError::ConflictStale));
    assert_eq!(std::fs::read(wt.join("notes.txt")).unwrap(), b"one\nagent's pick\n");
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn taking_a_whole_side_writes_its_bytes_stages_them_and_backs_up_the_file() {
    for (side, bytes) in [(ConflictSide::Left, "one\nours\n"), (ConflictSide::Right, "one\ntheirs\n")] {
        let (root, wt) = merge_conflict("notes.txt", b"one\ntwo\n", b"one\nours\n", b"one\ntheirs\n");
        let saved = save(&wt, "notes.txt", "one\nhalf done\n").unwrap();

        let taken = take_side(&StagingLocks::default(), &wt, 9, "notes.txt", saved["token"].as_str().unwrap(), side).expect("the side lands");
        assert_eq!(std::fs::read_to_string(wt.join("notes.txt")).unwrap(), bytes);
        assert_eq!(git(&wt, &["ls-files", "-u"]), "", "no unmerged stages remain");
        assert_eq!(git(&wt, &["show", ":notes.txt"]), bytes, "the side is staged");
        assert_eq!(git(&wt, &["cat-file", "blob", &taken.backup.blob.unwrap()]), "one\nhalf done\n");
        assert_eq!(taken.status.request_id, 9);
        let _ = std::fs::remove_dir_all(root);
    }
}

#[test]
fn taking_a_side_after_an_outside_edit_is_refused_as_stale() {
    let (root, wt) = merge_conflict("notes.txt", b"one\ntwo\n", b"one\nours\n", b"one\ntheirs\n");
    let token = open_conflict(&wt, "notes.txt").unwrap().token;
    std::fs::write(wt.join("notes.txt"), "one\nagent's pick\n").unwrap();

    let taken = take_side(&StagingLocks::default(), &wt, 1, "notes.txt", &token, ConflictSide::Left);
    assert_eq!(taken.err(), Some(GitError::ConflictStale));
    assert_eq!(std::fs::read(wt.join("notes.txt")).unwrap(), b"one\nagent's pick\n");
    assert_ne!(git(&wt, &["ls-files", "-u"]), "", "still conflicted");
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn mark_resolved_stages_the_saved_result() {
    let (root, wt) = merge_conflict("notes.txt", b"one\ntwo\n", b"one\nours\n", b"one\ntheirs\n");
    let saved = save(&wt, "notes.txt", "one\nboth\n").unwrap();

    let status = mark_resolved(&StagingLocks::default(), &wt, 4, "notes.txt", saved["token"].as_str().unwrap()).expect("it stages");
    assert_eq!(git(&wt, &["ls-files", "-u"]), "", "no unmerged stages remain");
    assert_eq!(git(&wt, &["show", ":notes.txt"]), "one\nboth\n", "the Result is staged");
    assert_eq!(status.request_id, 4);
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn mark_resolved_after_an_outside_edit_is_refused_as_stale_and_stages_nothing() {
    let (root, wt) = merge_conflict("notes.txt", b"one\ntwo\n", b"one\nours\n", b"one\ntheirs\n");
    let token = open_conflict(&wt, "notes.txt").unwrap().token;
    // An agent rewrites the file, markers and all, after the resolver opened it.
    std::fs::write(wt.join("notes.txt"), "one\n<<<<<<< HEAD\nagent\n=======\ntheirs\n>>>>>>> main\n").unwrap();

    let marked = mark_resolved(&StagingLocks::default(), &wt, 1, "notes.txt", &token);
    assert_eq!(marked.err(), Some(GitError::ConflictStale));
    assert_ne!(git(&wt, &["ls-files", "-u"]), "", "still conflicted");
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn every_resolver_write_waits_for_the_worktrees_staging_slot() {
    let (root, wt) = merge_conflict("notes.txt", b"one\ntwo\n", b"one\nours\n", b"one\ntheirs\n");
    let token = open_conflict(&wt, "notes.txt").unwrap().token;
    let locks = StagingLocks::default();
    let _held = locks.begin(&wt).unwrap();

    assert_eq!(save_conflict(&locks, &wt, "notes.txt", &token, "x\n").err(), Some(GitError::StagingBusy));
    assert_eq!(reset_conflict(&locks, &wt, "notes.txt", &token).err(), Some(GitError::StagingBusy));
    assert_eq!(take_side(&locks, &wt, 1, "notes.txt", &token, ConflictSide::Left).err(), Some(GitError::StagingBusy));
    assert_eq!(mark_resolved(&locks, &wt, 1, "notes.txt", &token).err(), Some(GitError::StagingBusy));
    assert!(std::fs::read_to_string(wt.join("notes.txt")).unwrap().contains("<<<<<<< HEAD"));
    let _ = std::fs::remove_dir_all(root);
}
