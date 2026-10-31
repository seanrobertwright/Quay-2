//! The operation banner's backend (#352, #389) against throwaway repositories with a linked
//! worktree, built with the system git: what each operation's state files say, and Continue, Skip
//! and Abort run on them.

use std::path::{Path, PathBuf};

use serde_json::{Value, json};

use super::operation::read_operation_state;
use super::staging_tests::{git, repo_with_worktree};

/// Runs `git <args>` in `dir`, which is expected to stop on a conflict and so exit non-zero.
fn git_stops(dir: &Path, args: &[&str]) {
    let out = crate::spawn::hidden_command("git")
        .current_dir(dir)
        .args(args)
        .output()
        .unwrap();
    assert!(
        !out.status.success(),
        "git {args:?} should stop on its conflict: {}",
        String::from_utf8_lossy(&out.stdout)
    );
}

fn state_json(wt: &Path) -> Value {
    serde_json::to_value(read_operation_state(wt).expect("the operation state reads")).unwrap()
}

/// `README.md` changed one way on `main` (in the main repo) and another on `feat` (in the
/// worktree), each in a commit with `subject`.
fn diverged(main_subject: &str, feat_subject: &str) -> (PathBuf, PathBuf) {
    let (root, wt) = repo_with_worktree();
    let repo = root.join("repo");
    std::fs::write(repo.join("README.md"), "main side\n").unwrap();
    git(&repo, &["commit", "-q", "-am", main_subject]);
    std::fs::write(wt.join("README.md"), "feat side\n").unwrap();
    git(&wt, &["commit", "-q", "-am", feat_subject]);
    (root, wt)
}

#[test]
fn a_merge_stopped_on_a_conflict_names_head_and_the_incoming_branch() {
    let (root, wt) = diverged("Main change", "Feat change");
    git_stops(&wt, &["merge", "main"]);

    let state = state_json(&wt);
    assert_eq!(state["kind"], "merge");
    assert_eq!(
        state["leftLabel"],
        json!({ "role": "HEAD", "name": "feat" })
    );
    assert_eq!(
        state["rightLabel"],
        json!({ "role": "Incoming", "name": "main" })
    );
    assert_eq!(
        state["conflicts"],
        json!([{ "path": "README.md", "xy": "UU", "kind": "bothModified" }])
    );
    assert_eq!(state["message"], "Merge branch 'main' into feat\n");
    assert!(
        state.get("step").is_none() && state.get("total").is_none(),
        "a merge has no steps: {state}"
    );
    let _ = std::fs::remove_dir_all(root);
}

fn short_oid(dir: &Path, rev: &str) -> String {
    git(dir, &["rev-parse", "--short=7", rev])
        .trim()
        .to_string()
}

#[test]
fn a_plain_rebase_names_what_it_is_onto_and_the_commit_it_replays_at_its_step() {
    let (root, wt) = diverged("Main change", "Feat change");
    std::fs::write(wt.join("later.txt"), "later\n").unwrap();
    git(&wt, &["add", "later.txt"]);
    git(&wt, &["commit", "-q", "-m", "Later change"]);
    git_stops(&wt, &["rebase", "main"]);

    let state = state_json(&wt);
    assert_eq!(state["kind"], "rebase");
    assert_eq!(
        (state["step"].clone(), state["total"].clone()),
        (json!(1), json!(2))
    );
    assert_eq!(
        state["leftLabel"],
        json!({ "role": "Onto", "name": format!("main @{}", short_oid(&wt, "main")) })
    );
    assert_eq!(
        state["rightLabel"],
        json!({ "role": "Replaying", "name": "Feat change" })
    );
    assert_eq!(
        state["conflicts"],
        json!([{ "path": "README.md", "xy": "UU", "kind": "bothModified" }])
    );
    assert_eq!(state["message"], "Feat change\n");
    let _ = std::fs::remove_dir_all(root);
}

/// Runs `git rebase -i <onto>` in `wt` with its todo list's first `pick` turned into `edit`.
fn rebase_interactive_editing_first(root: &Path, wt: &Path, onto: &str) {
    let script = root.join("edit-first.sh");
    std::fs::write(&script, "#!/bin/sh\nsed -i -e '1s/^pick/edit/' \"$1\"\n").unwrap();
    let editor = format!("sh '{}'", script.to_string_lossy().replace('\\', "/"));
    let out = crate::spawn::hidden_command("git")
        .current_dir(wt)
        .env("GIT_SEQUENCE_EDITOR", editor)
        .args(["rebase", "-i", onto])
        .output()
        .unwrap();
    assert!(out.status.success(), "the rebase should stop at its edit: {}", String::from_utf8_lossy(&out.stderr));
}

#[test]
fn an_interactive_rebase_stopped_at_an_edit_is_a_rebase_with_nothing_to_resolve() {
    let (root, wt) = repo_with_worktree();
    for (file, subject) in [("one.txt", "First step"), ("two.txt", "Second step")] {
        std::fs::write(wt.join(file), "x\n").unwrap();
        git(&wt, &["add", file]);
        git(&wt, &["commit", "-q", "-m", subject]);
    }
    rebase_interactive_editing_first(&root, &wt, "main");

    let state = state_json(&wt);
    assert_eq!(state["kind"], "rebase");
    assert_eq!((state["step"].clone(), state["total"].clone()), (json!(1), json!(2)));
    assert_eq!(state["leftLabel"], json!({ "role": "Onto", "name": format!("main @{}", short_oid(&wt, "main")) }));
    assert_eq!(state["rightLabel"], json!({ "role": "Replaying", "name": "First step" }));
    assert_eq!(state["conflicts"], json!([]));
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn a_cherry_pick_names_head_and_the_commit_it_picks() {
    let (root, wt) = diverged("Main change", "Feat change");
    git_stops(&wt, &["cherry-pick", "main"]);

    let state = state_json(&wt);
    assert_eq!(state["kind"], "cherryPick");
    assert_eq!(state["leftLabel"], json!({ "role": "HEAD", "name": "feat" }));
    assert_eq!(state["rightLabel"], json!({ "role": "Picking", "name": "Main change" }));
    assert_eq!(state["conflicts"], json!([{ "path": "README.md", "xy": "UU", "kind": "bothModified" }]));
    assert_eq!(state["message"], "Main change\n");
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn a_revert_names_head_and_the_commit_it_reverts() {
    let (root, wt) = repo_with_worktree();
    std::fs::write(wt.join("README.md"), "first\n").unwrap();
    git(&wt, &["commit", "-q", "-am", "First edit"]);
    std::fs::write(wt.join("README.md"), "second\n").unwrap();
    git(&wt, &["commit", "-q", "-am", "Second edit"]);
    git_stops(&wt, &["revert", "--no-edit", "HEAD~1"]);

    let state = state_json(&wt);
    assert_eq!(state["kind"], "revert");
    assert_eq!(state["leftLabel"], json!({ "role": "HEAD", "name": "feat" }));
    assert_eq!(state["rightLabel"], json!({ "role": "Reverting", "name": "First edit" }));
    assert_eq!(state["conflicts"], json!([{ "path": "README.md", "xy": "UU", "kind": "bothModified" }]));
    assert!(state["message"].as_str().unwrap().starts_with("Revert \"First edit\"\n"), "{state}");
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn a_conflict_with_no_state_file_lists_its_conflicts_under_no_operation() {
    let (root, wt) = repo_with_worktree();
    std::fs::write(wt.join("README.md"), "stashed\n").unwrap();
    git(&wt, &["stash", "-q"]);
    std::fs::write(wt.join("README.md"), "committed\n").unwrap();
    git(&wt, &["commit", "-q", "-am", "Committed edit"]);
    git_stops(&wt, &["stash", "pop"]);

    let state = state_json(&wt);
    assert_eq!(state["kind"], "none");
    assert_eq!((state["leftLabel"].clone(), state["rightLabel"].clone(), state["message"].clone()), (Value::Null, Value::Null, Value::Null));
    assert_eq!(state["conflicts"], json!([{ "path": "README.md", "xy": "UU", "kind": "bothModified" }]));
    assert_eq!(state["conflictsTotal"], 1);
    let _ = std::fs::remove_dir_all(root);
}
