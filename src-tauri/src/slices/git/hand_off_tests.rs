//! Handing conflicted files to an agent (#352, #392) against throwaway repositories with a linked
//! worktree: what is recorded, what clears it, and the conflict writes refusing a handed-off file.

use super::conflict::{mark_resolved, open_conflict, remove_conflict, reset_conflict, save_conflict, take_side, ConflictSide};
use super::conflict_tests::merge_conflict;
use super::error::GitError;
use super::hand_off::{hand_off, hand_offs, take_back, Agent, HandOff};
use super::staging::{stage_paths, PathTarget, StagingLocks};
use super::staging_tests::git;

fn claude() -> Agent {
    Agent { terminal_id: "term-1".into(), name: "claude 1".into() }
}

fn paths(list: &[&str]) -> Vec<String> {
    list.iter().map(|p| p.to_string()).collect()
}

fn with(path: &str, agent: &Agent) -> HandOff {
    HandOff { path: path.into(), terminal_id: agent.terminal_id.clone(), agent_name: agent.name.clone() }
}

fn conflicted() -> (std::path::PathBuf, std::path::PathBuf) {
    merge_conflict("notes.txt", b"one\ntwo\nthree\n", b"one\nours\nthree\n", b"one\ntheirs\nthree\n")
}

#[test]
fn a_handed_off_conflict_is_listed_with_its_agent() {
    let (root, wt) = conflicted();
    let locks = StagingLocks::default();

    let listed = hand_off(&locks, &wt, &paths(&["notes.txt"]), &claude()).expect("the hand-off lands");
    assert_eq!(listed, vec![with("notes.txt", &claude())]);
    assert_eq!(hand_offs(&locks, &wt).unwrap(), vec![with("notes.txt", &claude())]);
    let _ = std::fs::remove_dir_all(root);
}

fn handed_off(path: &str) -> GitError {
    GitError::HandedOff { path: path.into(), agent: "claude 1".into() }
}

#[test]
fn every_write_refuses_a_handed_off_file_and_leaves_it_untouched() {
    let (root, wt) = conflicted();
    let locks = StagingLocks::default();
    let token = open_conflict(&wt, "notes.txt").unwrap().token;
    let before = std::fs::read(wt.join("notes.txt")).unwrap();
    hand_off(&locks, &wt, &paths(&["notes.txt"]), &claude()).unwrap();

    assert_eq!(save_conflict(&locks, &wt, "notes.txt", &token, "mine
").unwrap_err(), handed_off("notes.txt"));
    assert_eq!(reset_conflict(&locks, &wt, "notes.txt", &token).unwrap_err(), handed_off("notes.txt"));
    assert_eq!(take_side(&locks, &wt, 1, "notes.txt", &token, ConflictSide::Left).unwrap_err(), handed_off("notes.txt"));
    assert_eq!(remove_conflict(&locks, &wt, 1, "notes.txt", &token).unwrap_err(), handed_off("notes.txt"));
    assert_eq!(mark_resolved(&locks, &wt, 1, "notes.txt", &token).unwrap_err(), handed_off("notes.txt"));
    assert_eq!(
        stage_paths(&locks, &wt, 1, &PathTarget::Paths { paths: paths(&["notes.txt"]) }).unwrap_err(),
        handed_off("notes.txt")
    );
    // Stage all would stage the handed-off file too.
    assert_eq!(stage_paths(&locks, &wt, 1, &PathTarget::All).unwrap_err(), handed_off("notes.txt"));

    assert_eq!(std::fs::read(wt.join("notes.txt")).unwrap(), before);
    assert!(git(&wt, &["ls-files", "-u"]).contains("notes.txt"), "still unmerged");
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn the_hand_off_clears_once_the_agent_stages_the_file() {
    let (root, wt) = conflicted();
    let locks = StagingLocks::default();
    hand_off(&locks, &wt, &paths(&["notes.txt"]), &claude()).unwrap();

    // The agent resolves and stages it in its own terminal.
    std::fs::write(wt.join("notes.txt"), "one
resolved
three
").unwrap();
    git(&wt, &["add", "notes.txt"]);

    assert_eq!(hand_offs(&locks, &wt).unwrap(), vec![]);
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn taking_a_file_back_makes_it_writable_again() {
    let (root, wt) = conflicted();
    let locks = StagingLocks::default();
    hand_off(&locks, &wt, &paths(&["notes.txt"]), &claude()).unwrap();

    assert_eq!(take_back(&locks, &wt, &paths(&["notes.txt"])).unwrap(), vec![]);
    let token = open_conflict(&wt, "notes.txt").unwrap().token;
    save_conflict(&locks, &wt, "notes.txt", &token, "mine
").expect("the save lands");
    assert_eq!(std::fs::read(wt.join("notes.txt")).unwrap(), b"mine
");
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn a_hand_off_in_one_worktree_never_reaches_another() {
    let (root_a, wt_a) = conflicted();
    let (root_b, wt_b) = conflicted();
    let locks = StagingLocks::default();
    hand_off(&locks, &wt_a, &paths(&["notes.txt"]), &claude()).unwrap();

    assert_eq!(hand_offs(&locks, &wt_b).unwrap(), vec![]);
    let token = open_conflict(&wt_b, "notes.txt").unwrap().token;
    save_conflict(&locks, &wt_b, "notes.txt", &token, "mine
").expect("the other worktree's file stays writable");
    assert_eq!(hand_offs(&locks, &wt_a).unwrap(), vec![with("notes.txt", &claude())]);
    let _ = std::fs::remove_dir_all(root_a);
    let _ = std::fs::remove_dir_all(root_b);
}

#[test]
fn staging_a_folder_that_holds_a_handed_off_file_is_refused() {
    let (root, wt) = merge_conflict("src/notes.txt", b"one
", b"ours
", b"theirs
");
    let locks = StagingLocks::default();
    hand_off(&locks, &wt, &paths(&["src/notes.txt"]), &claude()).unwrap();

    assert_eq!(
        stage_paths(&locks, &wt, 1, &PathTarget::Paths { paths: paths(&["src/"]) }).unwrap_err(),
        handed_off("src/notes.txt")
    );
    // A sibling folder whose name only starts the same is not reached.
    std::fs::create_dir_all(wt.join("sr")).unwrap();
    std::fs::write(wt.join("sr/other.txt"), "x
").unwrap();
    stage_paths(&locks, &wt, 1, &PathTarget::Paths { paths: paths(&["sr"]) }).expect("sr/ is not src/");
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn only_a_conflicted_file_can_be_handed_off() {
    let (root, wt) = conflicted();
    let locks = StagingLocks::default();

    assert!(matches!(hand_off(&locks, &wt, &paths(&["README.md"]), &claude()), Err(GitError::Other { .. })));
    assert!(matches!(hand_off(&locks, &wt, &paths(&["../escape.txt"]), &claude()), Err(GitError::Other { .. })));
    assert!(matches!(hand_off(&locks, &wt, &[], &claude()), Err(GitError::Other { .. })));
    // A refused list records nothing, not even its conflicted files.
    assert!(hand_off(&locks, &wt, &paths(&["notes.txt", "README.md"]), &claude()).is_err());
    assert_eq!(hand_offs(&locks, &wt).unwrap(), vec![]);
    let _ = std::fs::remove_dir_all(root);
}
