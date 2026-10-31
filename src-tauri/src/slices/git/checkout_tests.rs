//! Checkout and branch creation (#393) against throwaway repositories with a linked worktree,
//! built with the system git.

use std::path::Path;
use std::sync::{Arc, Mutex};

use serde_json::Value;
use tauri::ipc::{Channel, InvokeResponseBody};
use uuid::Uuid;

use super::checkout::{branch_create, checkout, CheckoutTarget, NewBranch, RefsOutcome};
use super::error::GitError;
use super::op_runner::{GitOps, OpEvent};
use super::staging::StagingLocks;
use super::staging_tests::{git, repo_with_worktree};

/// A channel that keeps every event it is sent, as the JSON the frontend would receive.
pub(super) fn test_channel() -> Channel<OpEvent> {
    let events = Arc::new(Mutex::new(Vec::<Value>::new()));
    Channel::new(move |body| {
        let json = match body {
            InvokeResponseBody::Json(s) => s,
            InvokeResponseBody::Raw(bytes) => String::from_utf8(bytes).unwrap(),
        };
        events.lock().unwrap().push(serde_json::from_str(&json).unwrap());
        Ok(())
    })
}

fn checkout_in(wt: &Path, target: CheckoutTarget) -> Result<RefsOutcome, GitError> {
    checkout(&GitOps::default(), &StagingLocks::default(), wt, Uuid::new_v4(), &target, &test_channel())
}

fn create_in(wt: &Path, name: &str, at: &str, then_checkout: bool) -> Result<RefsOutcome, GitError> {
    branch_create(&GitOps::default(), &StagingLocks::default(), wt, Uuid::new_v4(), NewBranch { name, at, checkout: then_checkout }, &test_channel())
}

pub(super) fn rev(dir: &Path, name: &str) -> String {
    git(dir, &["rev-parse", name]).trim().to_string()
}

/// The branch `dir` has checked out, or None when its HEAD is detached.
pub(super) fn current_branch(dir: &Path) -> Option<String> {
    let out = crate::spawn::hidden_command("git").current_dir(dir).args(["symbolic-ref", "--quiet", "--short", "HEAD"]).output().unwrap();
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn branch(name: &str) -> CheckoutTarget {
    CheckoutTarget::Branch { name: name.into() }
}

/// The worktree `wt` with a branch `side` one commit ahead of `feat`, which `wt` has checked out.
fn with_side_branch(wt: &Path) -> String {
    git(wt, &["switch", "-q", "-c", "side"]);
    std::fs::write(wt.join("README.md"), "side\n").unwrap();
    git(wt, &["commit", "-q", "-am", "Side change"]);
    git(wt, &["switch", "-q", "feat"]);
    rev(wt, "side")
}

#[test]
fn checking_out_a_local_branch_returns_its_head_and_the_refs() {
    let (_root, wt) = repo_with_worktree();
    let side = with_side_branch(&wt);

    let outcome = checkout_in(&wt, branch("side")).expect("side checks out");

    assert_eq!(current_branch(&wt).as_deref(), Some("side"));
    assert_eq!(outcome.head.as_deref(), Some(side.as_str()));
    let here = outcome.refs.worktrees.iter().find(|w| Path::new(&w.path).canonicalize().unwrap() == wt.canonicalize().unwrap());
    assert_eq!(here.and_then(|w| w.branch.clone()).as_deref(), Some("side"), "the refs show the worktree on side");
}

#[test]
fn checking_out_a_commit_detaches_head_there() {
    let (_root, wt) = repo_with_worktree();
    let side = with_side_branch(&wt);

    let outcome = checkout_in(&wt, CheckoutTarget::Detached { at: side.clone() }).expect("the commit checks out");

    assert_eq!(current_branch(&wt), None, "HEAD is detached");
    assert_eq!(rev(&wt, "HEAD"), side);
    assert_eq!(outcome.head.as_deref(), Some(side.as_str()));
}

/// A bare repo as `origin` of the repo `wt` belongs to, holding `topic` one commit past `main`,
/// fetched so `origin/topic` exists. Returns `origin/topic`'s oid.
pub(super) fn with_remote_topic(root: &Path, wt: &Path) -> String {
    let bare = root.join("origin.git");
    git(root, &["init", "-q", "--bare", &bare.to_string_lossy()]);
    git(wt, &["remote", "add", "origin", &bare.to_string_lossy()]);
    git(wt, &["switch", "-q", "-c", "topic-src", "main"]);
    std::fs::write(wt.join("README.md"), "topic\n").unwrap();
    git(wt, &["commit", "-q", "-am", "Topic change"]);
    git(wt, &["push", "-q", "origin", "topic-src:topic", "main:main"]);
    git(wt, &["switch", "-q", "feat"]);
    git(wt, &["branch", "-q", "-D", "topic-src"]);
    git(wt, &["fetch", "-q", "origin"]);
    rev(wt, "origin/topic")
}

pub(super) fn upstream_of(dir: &Path, branch: &str) -> String {
    git(dir, &["rev-parse", "--abbrev-ref", &format!("{branch}@{{upstream}}")]).trim().to_string()
}

#[test]
fn checking_out_a_remote_branch_creates_its_tracking_branch() {
    let (root, wt) = repo_with_worktree();
    let topic = with_remote_topic(&root, &wt);

    let outcome = checkout_in(&wt, CheckoutTarget::Remote { name: "origin/topic".into() }).expect("origin/topic checks out");

    assert_eq!(current_branch(&wt).as_deref(), Some("topic"));
    assert_eq!(upstream_of(&wt, "topic"), "origin/topic");
    assert_eq!(outcome.head.as_deref(), Some(topic.as_str()));
}

#[test]
fn checking_out_a_remote_branch_reuses_the_local_branch_that_tracks_it() {
    let (root, wt) = repo_with_worktree();
    let topic = with_remote_topic(&root, &wt);
    git(&wt, &["branch", "-q", "--track", "my-topic", "origin/topic"]);

    checkout_in(&wt, CheckoutTarget::Remote { name: "origin/topic".into() }).expect("origin/topic checks out");

    assert_eq!(current_branch(&wt).as_deref(), Some("my-topic"));
    assert_eq!(rev(&wt, "HEAD"), topic);
    let locals = git(&wt, &["branch", "--list", "topic"]);
    assert!(locals.trim().is_empty(), "no second tracking branch is made: {locals}");
}

#[test]
fn a_checkout_that_would_overwrite_local_changes_lists_the_files_and_changes_nothing() {
    let (_root, wt) = repo_with_worktree();
    with_side_branch(&wt);
    std::fs::write(wt.join("README.md"), "mine\n").unwrap();

    let refused = checkout_in(&wt, branch("side"));

    assert_eq!(refused, Err(GitError::CheckoutWouldOverwrite { paths: vec!["README.md".into()] }));
    assert_eq!(current_branch(&wt).as_deref(), Some("feat"));
    assert_eq!(std::fs::read_to_string(wt.join("README.md")).unwrap(), "mine\n");
}

#[test]
fn local_changes_git_can_carry_over_move_to_the_new_branch() {
    let (_root, wt) = repo_with_worktree();
    with_side_branch(&wt);
    std::fs::write(wt.join("src/lib.rs"), "fn mine() {}\n").unwrap();

    checkout_in(&wt, branch("side")).expect("a change side doesn't touch carries over");

    assert_eq!(current_branch(&wt).as_deref(), Some("side"));
    assert_eq!(std::fs::read_to_string(wt.join("src/lib.rs")).unwrap(), "fn mine() {}\n");
}

pub(super) fn same_folder(a: &str, b: &Path) -> bool {
    Path::new(a).canonicalize().unwrap() == b.canonicalize().unwrap()
}

#[test]
fn a_branch_checked_out_in_another_worktree_is_refused_with_that_worktree() {
    let (root, wt) = repo_with_worktree();

    let refused = checkout_in(&wt, branch("main"));

    match refused {
        Err(GitError::BranchInOtherWorktree { worktree }) => assert!(same_folder(&worktree, &root.join("repo")), "names {worktree}"),
        other => panic!("expected BranchInOtherWorktree, got {other:?}"),
    }
    assert_eq!(current_branch(&wt).as_deref(), Some("feat"));
}

#[test]
fn a_remote_branch_whose_tracking_branch_is_in_another_worktree_is_refused_too() {
    let (root, wt) = repo_with_worktree();
    with_remote_topic(&root, &wt);
    let repo = root.join("repo");
    git(&repo, &["switch", "-q", "--track", "-c", "topic", "origin/topic"]);

    let refused = checkout_in(&wt, CheckoutTarget::Remote { name: "origin/topic".into() });

    match refused {
        Err(GitError::BranchInOtherWorktree { worktree }) => assert!(same_folder(&worktree, &repo), "names {worktree}"),
        other => panic!("expected BranchInOtherWorktree, got {other:?}"),
    }
}

#[test]
fn creating_a_branch_at_a_commit_leaves_head_where_it_was() {
    let (_root, wt) = repo_with_worktree();
    let side = with_side_branch(&wt);
    let before = rev(&wt, "HEAD");

    let outcome = create_in(&wt, "fix/at-side", &side, false).expect("the branch is created");

    assert_eq!(rev(&wt, "fix/at-side"), side);
    assert_eq!(current_branch(&wt).as_deref(), Some("feat"));
    assert_eq!(outcome.head.as_deref(), Some(before.as_str()));
    assert!(outcome.refs.refs.iter().any(|r| r.name == "fix/at-side" && r.oid == side), "the refs show the new branch");
}

#[test]
fn creating_a_branch_with_checkout_switches_to_it() {
    let (_root, wt) = repo_with_worktree();
    let side = with_side_branch(&wt);

    let outcome = create_in(&wt, "spike", &side, true).expect("the branch is created and checked out");

    assert_eq!(current_branch(&wt).as_deref(), Some("spike"));
    assert_eq!(outcome.head.as_deref(), Some(side.as_str()));
}

/// Every ref in the repo `dir` belongs to, with its oid, and the oid HEAD names, so a test can
/// show that nothing was written.
pub(super) fn snapshot(dir: &Path) -> (String, String) {
    (git(dir, &["for-each-ref", "--format=%(objectname) %(refname)"]), rev(dir, "HEAD"))
}

#[test]
fn invalid_and_option_like_branch_names_are_refused_before_any_write() {
    let (_root, wt) = repo_with_worktree();
    with_side_branch(&wt);
    // `@{-1}` names the branch checked out before this one, which check-ref-format expands.
    git(&wt, &["switch", "-q", "side"]);
    git(&wt, &["switch", "-q", "feat"]);
    let before = snapshot(&wt);

    for name in ["-f", "--orphan=x", "a..b", "has space", "@{-1}", "HEAD", "", "ends.lock"] {
        assert_eq!(
            create_in(&wt, name, "HEAD", false),
            Err(GitError::InvalidRefName { name: name.into() }),
            "create {name:?}"
        );
        assert_eq!(
            create_in(&wt, name, "HEAD", true),
            Err(GitError::InvalidRefName { name: name.into() }),
            "create and check out {name:?}"
        );
        assert_eq!(checkout_in(&wt, branch(name)), Err(GitError::InvalidRefName { name: name.into() }), "check out {name:?}");
    }
    assert_eq!(snapshot(&wt), before, "no ref and no HEAD moved");
    assert_eq!(current_branch(&wt).as_deref(), Some("feat"));
}

#[test]
fn option_like_and_unknown_commits_are_refused_before_any_write() {
    let (_root, wt) = repo_with_worktree();
    let before = snapshot(&wt);

    for at in ["--all", "-q", "no-such-commit", "HEAD^{tree}"] {
        assert_eq!(create_in(&wt, "fresh", at, false), Err(GitError::InvalidRefName { name: at.into() }), "create at {at:?}");
        assert_eq!(
            checkout_in(&wt, CheckoutTarget::Detached { at: at.into() }),
            Err(GitError::InvalidRefName { name: at.into() }),
            "detach at {at:?}"
        );
    }
    for remote in ["-x", "origin/none", "../heads/feat"] {
        assert_eq!(
            checkout_in(&wt, CheckoutTarget::Remote { name: remote.into() }),
            Err(GitError::InvalidRefName { name: remote.into() }),
            "check out remote {remote:?}"
        );
    }
    assert_eq!(snapshot(&wt), before, "no ref and no HEAD moved");
}

#[test]
fn checkout_targets_read_the_frontends_camel_case_json() {
    let parse = |v: Value| serde_json::from_value::<CheckoutTarget>(v).unwrap();
    assert_eq!(parse(serde_json::json!({ "kind": "branch", "name": "main" })), branch("main"));
    assert_eq!(parse(serde_json::json!({ "kind": "remote", "name": "origin/main" })), CheckoutTarget::Remote { name: "origin/main".into() });
    assert_eq!(parse(serde_json::json!({ "kind": "detached", "at": "abc" })), CheckoutTarget::Detached { at: "abc".into() });
    assert!(serde_json::from_value::<CheckoutTarget>(serde_json::json!({ "kind": "orphan", "name": "x" })).is_err());
}
