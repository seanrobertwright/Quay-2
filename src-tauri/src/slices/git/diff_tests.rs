//! One file's diff and staging by hunk, line and mode change (#383, #386) against throwaway repositories with
//! a linked worktree, built with the system git.

use std::path::Path;

use serde_json::{json, Value};

use super::diff::{
    file_bytes, read_file_diff, roll_back_intent_to_add, stage_new_file_lines, stage_selection, ByteSource, DiffSide, LineRef, Selection, StageRequest, IMAGE_PREVIEW_CAP,
};
use super::error::GitError;
use super::staging::StagingLocks;
use super::staging_tests::{git, index_lock, repo_with_worktree};

fn diff_json(wt: &Path, path: &str, side: DiffSide) -> Value {
    serde_json::to_value(read_file_diff(wt, 1, path, &side, 3, false).expect("diff reads")).unwrap()
}

/// Each hunk as its header's numbers and its lines as `kind text`.
fn hunks(diff: &Value) -> Vec<(Value, Vec<String>)> {
    diff["hunks"]
        .as_array()
        .unwrap()
        .iter()
        .map(|h| {
            let nums = json!([h["oldStart"], h["oldLines"], h["newStart"], h["newLines"]]);
            let lines = h["lines"]
                .as_array()
                .unwrap()
                .iter()
                .map(|l| format!("{} {}", l["kind"].as_str().unwrap(), l["text"].as_str().unwrap()))
                .collect();
            (nums, lines)
        })
        .collect()
}

/// Twelve numbered lines, so changes at the top and the bottom land in two hunks.
fn twelve() -> String {
    (1..=12).map(|i| format!("line {i}\n")).collect()
}

#[test]
fn an_unstaged_diff_lists_each_hunk_with_its_lines() {
    let (root, wt) = repo_with_worktree();
    std::fs::write(wt.join("README.md"), twelve()).unwrap();
    git(&wt, &["commit", "-q", "-am", "twelve"]);
    std::fs::write(wt.join("README.md"), twelve().replace("line 2\n", "line two\n").replace("line 11\n", "")).unwrap();

    let diff = diff_json(&wt, "README.md", DiffSide::Unstaged);
    assert_eq!(diff["requestId"], 1);
    assert_eq!(diff["change"], "modified");
    assert_eq!(diff["binary"], false);
    assert_eq!(diff["tooLarge"], false);
    assert_eq!(diff["modeChange"], Value::Null);
    assert!(diff["diffToken"].as_str().is_some_and(|t| !t.is_empty()));
    assert_eq!(
        hunks(&diff),
        [
            (
                json!([1, 5, 1, 5]),
                vec!["context line 1", "del line 2", "add line two", "context line 3", "context line 4", "context line 5"]
                    .into_iter()
                    .map(String::from)
                    .collect::<Vec<_>>()
            ),
            (
                json!([8, 5, 8, 4]),
                vec!["context line 8", "context line 9", "context line 10", "del line 11", "context line 12"]
                    .into_iter()
                    .map(String::from)
                    .collect()
            ),
        ]
    );
    let _ = std::fs::remove_dir_all(root);
}

/// The index's bytes for `path`.
fn index_bytes(wt: &Path, path: &str) -> Vec<u8> {
    let out = crate::spawn::hidden_command("git").current_dir(wt).args(["show", &format!(":{path}")]).output().unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    out.stdout
}

fn request(path: &str, side: DiffSide, token: &str, selection: Selection) -> StageRequest {
    StageRequest { path: path.into(), side, diff_token: token.into(), selection, load_large: false }
}

/// A committed twelve-line README with line 2 changed and line 11 deleted in the worktree.
fn two_hunks() -> (std::path::PathBuf, std::path::PathBuf) {
    let (root, wt) = repo_with_worktree();
    std::fs::write(wt.join("README.md"), twelve()).unwrap();
    git(&wt, &["commit", "-q", "-am", "twelve"]);
    std::fs::write(wt.join("README.md"), twelve().replace("line 2\n", "line two\n").replace("line 11\n", "")).unwrap();
    (root, wt)
}

#[test]
fn staging_one_hunk_puts_only_that_hunk_in_the_index_and_returns_the_new_diff_and_status() {
    let (root, wt) = two_hunks();
    let before = read_file_diff(&wt, 1, "README.md", &DiffSide::Unstaged, 3, false).unwrap();

    let locks = StagingLocks::default();
    let req = request("README.md", DiffSide::Unstaged, &before.diff_token, Selection::Hunks { hunks: vec![1] });
    let out = stage_selection(&locks, &wt, 5, 6, &req).unwrap();

    assert_eq!(String::from_utf8(index_bytes(&wt, "README.md")).unwrap(), twelve().replace("line 11\n", ""));
    assert_eq!(out.status.request_id, 5);
    assert_eq!(out.status.entries.iter().map(|e| (e.path.as_str(), e.xy.as_str())).collect::<Vec<_>>(), [("README.md", "MM")]);
    let diff = serde_json::to_value(&out.diff).unwrap();
    assert_eq!(diff["requestId"], 6);
    assert_eq!(hunks(&diff).iter().map(|h| h.0.clone()).collect::<Vec<_>>(), [json!([1, 5, 1, 5])]);
    // The worktree keeps every change.
    assert_eq!(std::fs::read_to_string(wt.join("README.md")).unwrap(), twelve().replace("line 2\n", "line two\n").replace("line 11\n", ""));
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn unstaging_one_hunk_takes_only_that_hunk_out_of_the_index() {
    let (root, wt) = two_hunks();
    git(&wt, &["add", "README.md"]);
    let before = read_file_diff(&wt, 1, "README.md", &DiffSide::Staged, 3, false).unwrap();
    assert_eq!(before.hunks.len(), 2);

    let locks = StagingLocks::default();
    let req = request("README.md", DiffSide::Staged, &before.diff_token, Selection::Hunks { hunks: vec![0] });
    let out = stage_selection(&locks, &wt, 1, 2, &req).unwrap();

    assert_eq!(String::from_utf8(index_bytes(&wt, "README.md")).unwrap(), twelve().replace("line 11\n", ""));
    assert_eq!(out.diff.hunks.len(), 1);
    assert_eq!((out.diff.hunks[0].old_start, out.diff.hunks[0].old_lines), (8, 5));
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn a_stale_diff_is_refused_and_the_index_is_left_alone() {
    let (root, wt) = two_hunks();
    let read = read_file_diff(&wt, 1, "README.md", &DiffSide::Unstaged, 3, false).unwrap();
    // An agent stages the second change by itself, so the index moves under the diff.
    let index_moved = twelve().replace("line 11\n", "");
    let blob = {
        let mut child = crate::spawn::hidden_command("git")
            .current_dir(&wt)
            .args(["hash-object", "-w", "--stdin"])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        use std::io::Write;
        child.stdin.take().unwrap().write_all(index_moved.as_bytes()).unwrap();
        String::from_utf8(child.wait_with_output().unwrap().stdout).unwrap().trim().to_string()
    };
    git(&wt, &["update-index", "--cacheinfo", &format!("100644,{blob},README.md")]);

    let locks = StagingLocks::default();
    let req = request("README.md", DiffSide::Unstaged, &read.diff_token, Selection::Hunks { hunks: vec![1] });
    assert_eq!(stage_selection(&locks, &wt, 1, 2, &req), Err(GitError::StaleDiff));
    assert_eq!(String::from_utf8(index_bytes(&wt, "README.md")).unwrap(), index_moved);

    // An edit in the worktree also makes the diff stale, even with the index unchanged.
    let read = read_file_diff(&wt, 1, "README.md", &DiffSide::Unstaged, 3, false).unwrap();
    std::fs::write(wt.join("README.md"), twelve().replace("line 2\n", "line 2 again\n")).unwrap();
    let req = request("README.md", DiffSide::Unstaged, &read.diff_token, Selection::Hunks { hunks: vec![0] });
    assert_eq!(stage_selection(&locks, &wt, 1, 2, &req), Err(GitError::StaleDiff));
    assert_eq!(String::from_utf8(index_bytes(&wt, "README.md")).unwrap(), index_moved);
    // The slot was let go, so a fresh read stages.
    let read = read_file_diff(&wt, 1, "README.md", &DiffSide::Unstaged, 3, false).unwrap();
    let req = request("README.md", DiffSide::Unstaged, &read.diff_token, Selection::Hunks { hunks: vec![0] });
    stage_selection(&locks, &wt, 1, 2, &req).unwrap();
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn cr_bytes_survive_the_diff_and_a_hunk_stage_byte_for_byte() {
    let (root, wt) = repo_with_worktree();
    let original: &[u8] = b"one\r\ntwo\r\nthree\rstill three\r\n4\n5\n6\n7\n8\n9\n10\r\nlast\r\n";
    std::fs::write(wt.join("README.md"), original).unwrap();
    git(&wt, &["commit", "-q", "-am", "crlf"]);
    let changed: &[u8] = b"one\r\nTWO\r\nthree\rstill three\r\n4\n5\n6\n7\n8\n9\n10\r\nLAST\r\n";
    std::fs::write(wt.join("README.md"), changed).unwrap();

    let read = read_file_diff(&wt, 1, "README.md", &DiffSide::Unstaged, 1, false).unwrap();
    assert_eq!(read.hunks.len(), 2);
    let texts: Vec<&str> = read.hunks[0].lines.iter().map(|l| l.text.as_str()).collect();
    assert_eq!(texts, ["one\r", "two\r", "TWO\r", "three\rstill three\r"]);

    let locks = StagingLocks::default();
    let req = request("README.md", DiffSide::Unstaged, &read.diff_token, Selection::Hunks { hunks: vec![0] });
    stage_selection(&locks, &wt, 1, 2, &req).unwrap();
    assert_eq!(index_bytes(&wt, "README.md"), b"one\r\nTWO\r\nthree\rstill three\r\n4\n5\n6\n7\n8\n9\n10\r\nlast\r\n");

    let staged = read_file_diff(&wt, 1, "README.md", &DiffSide::Staged, 1, false).unwrap();
    let req = request("README.md", DiffSide::Staged, &staged.diff_token, Selection::Hunks { hunks: vec![0] });
    stage_selection(&locks, &wt, 1, 2, &req).unwrap();
    assert_eq!(index_bytes(&wt, "README.md"), original);
    assert_eq!(std::fs::read(wt.join("README.md")).unwrap(), changed);
    let _ = std::fs::remove_dir_all(root);
}

/// The index's mode for `path`, as `ls-files -s` prints it.
fn index_mode(wt: &Path, path: &str) -> String {
    git(wt, &["ls-files", "-s", "--", path]).split(' ').next().unwrap().to_string()
}

#[test]
fn a_mode_change_stages_and_unstages_on_its_own_without_the_content() {
    let (root, wt) = repo_with_worktree();
    std::fs::write(wt.join("README.md"), twelve()).unwrap();
    // A committed executable bit the worktree doesn't have, which git sees with core.fileMode.
    git(&wt, &["add", "README.md"]);
    git(&wt, &["update-index", "--chmod=+x", "README.md"]);
    git(&wt, &["commit", "-q", "-m", "exec"]);
    git(&wt, &["config", "core.fileMode", "true"]);
    std::fs::write(wt.join("README.md"), twelve().replace("line 2\n", "line two\n").replace("line 11\n", "")).unwrap();
    let exec_mode = index_mode(&wt, "README.md");
    assert_eq!(exec_mode, "100755");

    let read = read_file_diff(&wt, 1, "README.md", &DiffSide::Unstaged, 3, false).unwrap();
    let mode = read.mode_change.clone();
    let worktree_mode = mode.as_ref().map(|m| m.new_mode.clone());
    assert_eq!(mode.map(|m| m.old_mode), Some("100755".to_string()));
    assert_eq!(read.hunks.len(), 2);

    let locks = StagingLocks::default();
    let req = request("README.md", DiffSide::Unstaged, &read.diff_token, Selection::ModeChange);
    let out = stage_selection(&locks, &wt, 1, 2, &req).unwrap();
    assert_eq!(Some(index_mode(&wt, "README.md")), worktree_mode);
    assert_eq!(String::from_utf8(index_bytes(&wt, "README.md")).unwrap(), twelve(), "the content stayed unstaged");
    assert_eq!(out.diff.mode_change, None);
    assert_eq!(out.diff.hunks.len(), 2);

    // Unstaging the mode change puts the executable bit back, and a hunk staged while the mode
    // differs leaves the mode alone.
    let staged = read_file_diff(&wt, 1, "README.md", &DiffSide::Staged, 3, false).unwrap();
    assert!(staged.mode_change.is_some());
    let req = request("README.md", DiffSide::Staged, &staged.diff_token, Selection::ModeChange);
    stage_selection(&locks, &wt, 1, 2, &req).unwrap();
    assert_eq!(index_mode(&wt, "README.md"), "100755");
    let read = read_file_diff(&wt, 1, "README.md", &DiffSide::Unstaged, 3, false).unwrap();
    let req = request("README.md", DiffSide::Unstaged, &read.diff_token, Selection::Hunks { hunks: vec![0] });
    stage_selection(&locks, &wt, 1, 2, &req).unwrap();
    assert_eq!(index_mode(&wt, "README.md"), "100755");
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn a_binary_file_stages_only_whole() {
    let (root, wt) = repo_with_worktree();
    std::fs::write(wt.join("logo.png"), [0x89, b'P', b'N', b'G', 0, 1, 2, 3]).unwrap();
    git(&wt, &["add", "logo.png"]);
    git(&wt, &["commit", "-q", "-m", "logo"]);
    std::fs::write(wt.join("logo.png"), [0x89, b'P', b'N', b'G', 0, 9, 9, 9, 9]).unwrap();

    let read = read_file_diff(&wt, 1, "logo.png", &DiffSide::Unstaged, 3, false).unwrap();
    assert!(read.binary);
    assert!(read.hunks.is_empty());
    assert!(read.old_oid.is_some());

    let locks = StagingLocks::default();
    let req = request("logo.png", DiffSide::Unstaged, &read.diff_token, Selection::Hunks { hunks: vec![0] });
    assert!(matches!(stage_selection(&locks, &wt, 1, 2, &req), Err(GitError::Other { .. })));
    let req = request("logo.png", DiffSide::Unstaged, &read.diff_token, Selection::File);
    let out = stage_selection(&locks, &wt, 1, 2, &req).unwrap();
    assert_eq!(index_bytes(&wt, "logo.png"), [0x89, b'P', b'N', b'G', 0, 9, 9, 9, 9]);
    assert_eq!(serde_json::to_value(&out.diff).unwrap()["change"], "unchanged");
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn a_too_large_diff_leaves_out_its_hunks_until_loaded_and_still_stages_whole() {
    let (root, wt) = repo_with_worktree();
    let big: String = (0..30_000).map(|i| format!("row {i}\n")).collect();
    std::fs::write(wt.join("big.txt"), "start\n").unwrap();
    git(&wt, &["add", "big.txt"]);
    git(&wt, &["commit", "-q", "-m", "big"]);
    std::fs::write(wt.join("big.txt"), &big).unwrap();

    let read = read_file_diff(&wt, 1, "big.txt", &DiffSide::Unstaged, 3, false).unwrap();
    assert!(read.too_large);
    assert!(read.hunks.is_empty());
    assert_eq!(read.line_count, 30_001);
    assert!(read.bytes > 30_000 * 5);

    let loaded = read_file_diff(&wt, 1, "big.txt", &DiffSide::Unstaged, 3, true).unwrap();
    assert!(!loaded.too_large);
    assert_eq!(loaded.hunks[0].lines.len(), 30_001);
    // Loading it doesn't change what the diff is, so either token stages.
    assert_eq!(loaded.diff_token, read.diff_token);

    let locks = StagingLocks::default();
    let req = request("big.txt", DiffSide::Unstaged, &read.diff_token, Selection::File);
    stage_selection(&locks, &wt, 1, 2, &req).unwrap();
    assert_eq!(String::from_utf8(index_bytes(&wt, "big.txt")).unwrap(), big);
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn an_untracked_file_reads_against_an_empty_file_and_stages_whole() {
    let (root, wt) = repo_with_worktree();
    std::fs::write(wt.join("new.txt"), "a\r\nb\n").unwrap();

    let read = read_file_diff(&wt, 1, "new.txt", &DiffSide::Unstaged, 3, false).unwrap();
    assert_eq!(serde_json::to_value(&read).unwrap()["change"], "untracked");
    assert_eq!(read.hunks.len(), 1);
    let texts: Vec<&str> = read.hunks[0].lines.iter().map(|l| l.text.as_str()).collect();
    assert_eq!(texts, ["a\r", "b"]);
    // Reading it never touched the index.
    assert_eq!(git(&wt, &["ls-files", "--", "new.txt"]), "");

    let locks = StagingLocks::default();
    let req = request("new.txt", DiffSide::Unstaged, &read.diff_token, Selection::Hunks { hunks: vec![0] });
    stage_selection(&locks, &wt, 1, 2, &req).unwrap();
    assert_eq!(index_bytes(&wt, "new.txt"), b"a\r\nb\n");

    // Unstaging the only hunk of an added file takes it out of the index again.
    let staged = read_file_diff(&wt, 1, "new.txt", &DiffSide::Staged, 3, false).unwrap();
    assert_eq!(serde_json::to_value(&staged).unwrap()["change"], "added");
    let req = request("new.txt", DiffSide::Staged, &staged.diff_token, Selection::Hunks { hunks: vec![0] });
    stage_selection(&locks, &wt, 1, 2, &req).unwrap();
    assert_eq!(git(&wt, &["ls-files", "--", "new.txt"]), "");
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn a_commit_diff_reads_against_its_parent_and_is_read_only() {
    let (root, wt) = two_hunks();
    git(&wt, &["commit", "-q", "-am", "edit"]);
    let head = git(&wt, &["rev-parse", "HEAD"]).trim().to_string();
    let side = DiffSide::Commit { oid: head.clone(), parent: None };
    let read = read_file_diff(&wt, 1, "README.md", &side, 3, false).unwrap();
    assert_eq!(read.hunks.len(), 2);
    let parent = git(&wt, &["rev-parse", "HEAD~2"]).trim().to_string();
    let side = DiffSide::Commit { oid: head, parent: Some(parent) };
    let read = read_file_diff(&wt, 1, "README.md", &side, 3, false).unwrap();
    assert_eq!(read.hunks.len(), 1, "against the first commit's one-line README");

    let locks = StagingLocks::default();
    let req = request("README.md", side.clone(), &read.diff_token, Selection::File);
    assert!(matches!(stage_selection(&locks, &wt, 1, 2, &req), Err(GitError::Other { .. })));
    let bad = DiffSide::Commit { oid: "--output=x".into(), parent: None };
    assert!(matches!(read_file_diff(&wt, 1, "README.md", &bad, 3, false), Err(GitError::Other { .. })));
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn a_hunk_stage_waits_on_a_held_index_lock_shares_the_staging_slot_and_never_deletes_the_lock() {
    let (root, wt) = two_hunks();
    let read = read_file_diff(&wt, 1, "README.md", &DiffSide::Unstaged, 3, false).unwrap();
    let req = request("README.md", DiffSide::Unstaged, &read.diff_token, Selection::Hunks { hunks: vec![0] });
    let locks = StagingLocks::default();

    let slot = locks.begin(&wt).unwrap();
    assert_eq!(stage_selection(&locks, &wt, 1, 2, &req), Err(GitError::StagingBusy));
    drop(slot);

    let lock = index_lock(&wt);
    std::fs::write(&lock, "held").unwrap();
    assert_eq!(stage_selection(&locks, &wt, 1, 2, &req), Err(GitError::IndexLocked));
    assert_eq!(std::fs::read_to_string(&lock).unwrap(), "held");
    std::fs::remove_file(&lock).unwrap();
    stage_selection(&locks, &wt, 1, 2, &req).unwrap();
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn image_bytes_come_from_a_blob_or_the_worktree_and_stop_at_five_megabytes() {
    let (root, wt) = repo_with_worktree();
    std::fs::write(wt.join("logo.svg"), "<svg/>").unwrap();
    git(&wt, &["add", "logo.svg"]);
    std::fs::write(wt.join("logo.svg"), "<svg></svg>").unwrap();
    let staged = read_file_diff(&wt, 1, "logo.svg", &DiffSide::Staged, 3, false).unwrap();
    let blob = staged.new_oid.clone().unwrap();

    assert_eq!(file_bytes(&wt, "logo.svg", &ByteSource::Blob { oid: blob }).unwrap(), b"<svg/>");
    assert_eq!(file_bytes(&wt, "logo.svg", &ByteSource::Worktree).unwrap(), b"<svg></svg>");

    std::fs::write(wt.join("huge.png"), vec![0u8; IMAGE_PREVIEW_CAP as usize + 1]).unwrap();
    assert!(matches!(file_bytes(&wt, "huge.png", &ByteSource::Worktree), Err(GitError::Other { .. })));
    git(&wt, &["add", "huge.png"]);
    let huge = read_file_diff(&wt, 1, "huge.png", &DiffSide::Staged, 3, false).unwrap().new_oid.unwrap();
    assert!(matches!(file_bytes(&wt, "huge.png", &ByteSource::Blob { oid: huge }), Err(GitError::Other { .. })));
    assert!(matches!(file_bytes(&wt, "../x.png", &ByteSource::Worktree), Err(GitError::Other { .. })));
    assert!(matches!(file_bytes(&wt, "x.png", &ByteSource::Blob { oid: "HEAD".into() }), Err(GitError::Other { .. })));
    let _ = std::fs::remove_dir_all(root);
}

fn lines(refs: &[(u32, u32)]) -> Selection {
    Selection::Lines { lines: refs.iter().map(|&(hunk, line)| LineRef { hunk, line }).collect() }
}

#[test]
fn staging_lines_across_two_hunks_stages_only_those_lines() {
    let (root, wt) = two_hunks();
    let read = read_file_diff(&wt, 1, "README.md", &DiffSide::Unstaged, 3, false).unwrap();
    // Hunk 0 is `line 1`, `-line 2`, `+line two`, then context; hunk 1 ends `-line 11`, `line 12`.
    let locks = StagingLocks::default();
    let req = request("README.md", DiffSide::Unstaged, &read.diff_token, lines(&[(0, 2), (1, 3)]));
    let out = stage_selection(&locks, &wt, 1, 2, &req).unwrap();

    // The unpicked deletion of `line 2` stays, the picked addition and deletion land.
    let staged = twelve().replace("line 2
", "line 2
line two
").replace("line 11
", "");
    assert_eq!(String::from_utf8(index_bytes(&wt, "README.md")).unwrap(), staged);
    assert_eq!(out.diff.hunks.len(), 1, "only the deletion of line 2 is left unstaged");
    assert_eq!(std::fs::read_to_string(wt.join("README.md")).unwrap(), twelve().replace("line 2
", "line two
").replace("line 11
", ""));

    // Unstaging the added line from the staged side leaves only the deletion of line 11 staged.
    let staged_diff = read_file_diff(&wt, 1, "README.md", &DiffSide::Staged, 3, false).unwrap();
    let added = staged_diff.hunks[0].lines.iter().position(|l| l.text == "line two").unwrap() as u32;
    let req = request("README.md", DiffSide::Staged, &staged_diff.diff_token, lines(&[(0, added)]));
    stage_selection(&locks, &wt, 1, 2, &req).unwrap();
    assert_eq!(String::from_utf8(index_bytes(&wt, "README.md")).unwrap(), twelve().replace("line 11
", ""));
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn a_context_line_or_a_line_past_its_hunk_is_refused_and_the_index_is_left_alone() {
    let (root, wt) = two_hunks();
    let read = read_file_diff(&wt, 1, "README.md", &DiffSide::Unstaged, 3, false).unwrap();
    let locks = StagingLocks::default();
    for bad in [lines(&[(0, 0)]), lines(&[(0, 99)]), lines(&[(7, 1)]), lines(&[])] {
        let req = request("README.md", DiffSide::Unstaged, &read.diff_token, bad);
        assert!(matches!(stage_selection(&locks, &wt, 1, 2, &req), Err(GitError::Other { .. })));
    }
    assert_eq!(String::from_utf8(index_bytes(&wt, "README.md")).unwrap(), twelve());
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn lines_after_a_last_line_without_a_newline_stage_with_the_no_newline_pair() {
    let (root, wt) = repo_with_worktree();
    std::fs::write(wt.join("README.md"), "a\nb").unwrap();
    git(&wt, &["commit", "-q", "-am", "no newline"]);
    std::fs::write(wt.join("README.md"), "a\nb\nc\n").unwrap();
    let read = read_file_diff(&wt, 1, "README.md", &DiffSide::Unstaged, 3, false).unwrap();
    let kinds: Vec<String> = read.hunks[0].lines.iter().map(|l| format!("{:?} {}", l.kind, l.text)).collect();
    assert_eq!(kinds, ["Context a", "Del b", "NoNewline  No newline at end of file", "Add b", "Add c"]);

    // `-b` and `+b` are the pair that gives b its newline; `+c` needs them.
    let locks = StagingLocks::default();
    let req = request("README.md", DiffSide::Unstaged, &read.diff_token, lines(&[(0, 1), (0, 3), (0, 4)]));
    stage_selection(&locks, &wt, 1, 2, &req).unwrap();
    assert_eq!(index_bytes(&wt, "README.md"), b"a\nb\nc\n");

    // Unstaging the pair alone would leave `c` after a last line with no newline, which
    // `git apply` would join into `bc`, so it is refused and nothing moves.
    let staged = read_file_diff(&wt, 1, "README.md", &DiffSide::Staged, 3, false).unwrap();
    let req = request("README.md", DiffSide::Staged, &staged.diff_token, lines(&[(0, 1), (0, 3)]));
    assert!(matches!(stage_selection(&locks, &wt, 1, 2, &req), Err(GitError::Other { .. })));
    assert_eq!(index_bytes(&wt, "README.md"), b"a\nb\nc\n");
    let req = request("README.md", DiffSide::Staged, &staged.diff_token, lines(&[(0, 1), (0, 3), (0, 4)]));
    stage_selection(&locks, &wt, 1, 2, &req).unwrap();
    assert_eq!(index_bytes(&wt, "README.md"), b"a\nb");
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn a_new_last_line_without_a_newline_stages_on_its_own() {
    let (root, wt) = repo_with_worktree();
    std::fs::write(wt.join("README.md"), "a\nb\n").unwrap();
    git(&wt, &["commit", "-q", "-am", "two"]);
    std::fs::write(wt.join("README.md"), "a\nB\nc").unwrap();
    let read = read_file_diff(&wt, 1, "README.md", &DiffSide::Unstaged, 3, false).unwrap();
    // ` a`, `-b`, `+B`, `+c`, then the marker for c.
    let locks = StagingLocks::default();
    let req = request("README.md", DiffSide::Unstaged, &read.diff_token, lines(&[(0, 3)]));
    stage_selection(&locks, &wt, 1, 2, &req).unwrap();
    assert_eq!(index_bytes(&wt, "README.md"), b"a\nb\nc");
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn part_of_an_untracked_file_stages_and_unstaging_the_rest_removes_its_empty_entry() {
    let (root, wt) = repo_with_worktree();
    std::fs::write(wt.join("new.txt"), "a\nb\nc\n").unwrap();
    let read = read_file_diff(&wt, 1, "new.txt", &DiffSide::Unstaged, 3, false).unwrap();

    let locks = StagingLocks::default();
    let req = request("new.txt", DiffSide::Unstaged, &read.diff_token, lines(&[(0, 1)]));
    let out = stage_selection(&locks, &wt, 1, 2, &req).unwrap();
    assert_eq!(index_bytes(&wt, "new.txt"), b"b\n");
    assert_eq!(std::fs::read_to_string(wt.join("new.txt")).unwrap(), "a\nb\nc\n");
    let entry: Vec<_> = out.status.entries.iter().filter(|e| e.path == "new.txt").map(|e| e.xy.as_str()).collect();
    assert_eq!(entry, ["AM"]);
    // The unstaged side now reads against the index and holds the other two lines.
    assert_eq!(out.diff.hunks.len(), 1);

    // Unstaging its only staged line would leave an empty entry for a path HEAD lacks, so the
    // entry goes and the file is untracked again.
    let staged = read_file_diff(&wt, 1, "new.txt", &DiffSide::Staged, 3, false).unwrap();
    assert_eq!(serde_json::to_value(&staged).unwrap()["change"], "added");
    let req = request("new.txt", DiffSide::Staged, &staged.diff_token, lines(&[(0, 0)]));
    let out = stage_selection(&locks, &wt, 1, 2, &req).unwrap();
    assert_eq!(git(&wt, &["ls-files", "--", "new.txt"]), "");
    assert_eq!(out.status.entries.iter().find(|e| e.path == "new.txt").map(|e| e.xy.as_str()), Some("??"));
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn unstaging_some_lines_of_an_added_file_keeps_the_rest_staged() {
    let (root, wt) = repo_with_worktree();
    std::fs::write(wt.join("new.txt"), "a\nb\nc\n").unwrap();
    git(&wt, &["add", "new.txt"]);
    let staged = read_file_diff(&wt, 1, "new.txt", &DiffSide::Staged, 3, false).unwrap();
    let locks = StagingLocks::default();
    let req = request("new.txt", DiffSide::Staged, &staged.diff_token, lines(&[(0, 0), (0, 2)]));
    stage_selection(&locks, &wt, 1, 2, &req).unwrap();
    assert_eq!(index_bytes(&wt, "new.txt"), b"b\n");
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn every_line_of_an_untracked_file_stages_it_whole() {
    let (root, wt) = repo_with_worktree();
    std::fs::write(wt.join("new.txt"), "a\nb\n").unwrap();
    let read = read_file_diff(&wt, 1, "new.txt", &DiffSide::Unstaged, 3, false).unwrap();
    let locks = StagingLocks::default();
    let req = request("new.txt", DiffSide::Unstaged, &read.diff_token, lines(&[(0, 0), (0, 1)]));
    stage_selection(&locks, &wt, 1, 2, &req).unwrap();
    assert_eq!(index_bytes(&wt, "new.txt"), b"a\nb\n");
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn a_failed_apply_after_intent_to_add_rolls_the_empty_entry_back() {
    let (root, wt) = repo_with_worktree();
    std::fs::write(wt.join("new.txt"), "a\n").unwrap();
    let bad = b"diff --git a/new.txt b/new.txt\n--- a/new.txt\n+++ b/new.txt\n@@ -1,1 +1,1 @@\n-not there\n+a\n";
    assert!(matches!(stage_new_file_lines(&wt, "new.txt", bad, 3), Err(GitError::Other { .. })));
    assert_eq!(git(&wt, &["ls-files", "--", "new.txt"]), "", "the intent-to-add entry was rolled back");
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn the_rollback_never_removes_a_real_staged_change() {
    let (root, wt) = repo_with_worktree();
    // Something else stages the file for real after the intent-to-add entry was made.
    std::fs::write(wt.join("new.txt"), "a\n").unwrap();
    git(&wt, &["add", "-N", "new.txt"]);
    git(&wt, &["add", "new.txt"]);
    assert!(!roll_back_intent_to_add(&wt, "new.txt").unwrap());
    assert_eq!(index_bytes(&wt, "new.txt"), b"a\n");

    // A staged empty file is a real change too, not an intent-to-add entry.
    std::fs::write(wt.join("empty.txt"), "").unwrap();
    git(&wt, &["add", "empty.txt"]);
    assert!(!roll_back_intent_to_add(&wt, "empty.txt").unwrap());
    assert_eq!(git(&wt, &["ls-files", "--", "empty.txt"]), "empty.txt\n");

    // Only the bare intent-to-add entry goes.
    std::fs::write(wt.join("ita.txt"), "x\n").unwrap();
    git(&wt, &["add", "-N", "ita.txt"]);
    assert!(roll_back_intent_to_add(&wt, "ita.txt").unwrap());
    assert_eq!(git(&wt, &["ls-files", "--", "ita.txt"]), "");
    let _ = std::fs::remove_dir_all(root);
}
