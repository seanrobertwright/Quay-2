//! Rename, upstream, delete with Restore, and local tags (#394) against throwaway repositories
//! with a linked worktree, built with the system git.

use std::path::Path;

use uuid::Uuid;

use super::checkout::{branch_create, NewBranch, RefsOutcome};
use super::checkout_tests::{current_branch, rev, same_folder, snapshot, test_channel, upstream_of, with_remote_topic};
use super::error::GitError;
use super::op_runner::GitOps;
use super::ref_ops::{branch_delete, branch_rename, branch_set_upstream, tag_create, tag_delete, BranchDeleted, NewTag};
use super::staging::StagingLocks;
use super::staging_tests::{git, repo_with_worktree};

fn rename_in(wt: &Path, name: &str, new_name: &str) -> Result<RefsOutcome, GitError> {
    branch_rename(&GitOps::default(), &StagingLocks::default(), wt, Uuid::new_v4(), name, new_name, &test_channel())
}

fn set_upstream_in(wt: &Path, name: &str, upstream: Option<&str>) -> Result<RefsOutcome, GitError> {
    branch_set_upstream(&GitOps::default(), &StagingLocks::default(), wt, Uuid::new_v4(), name, upstream, &test_channel())
}

fn delete_in(wt: &Path, name: &str, force: bool) -> Result<BranchDeleted, GitError> {
    branch_delete(&GitOps::default(), &StagingLocks::default(), wt, Uuid::new_v4(), name, force, &test_channel())
}

/// Restore, as the toast runs it: the branch made again at the tip the delete returned.
fn restore_in(wt: &Path, name: &str, tip: &str) -> Result<RefsOutcome, GitError> {
    branch_create(&GitOps::default(), &StagingLocks::default(), wt, Uuid::new_v4(), NewBranch { name, at: tip, checkout: false }, &test_channel())
}

fn branch_exists(dir: &Path, name: &str) -> bool {
    !git(dir, &["branch", "--list", name]).trim().is_empty()
}

/// `wt` with a branch `spike` two commits past `main` that no other ref reaches. Returns its oid.
fn with_unmerged_spike(wt: &Path) -> String {
    git(wt, &["switch", "-q", "-c", "spike", "main"]);
    for n in ["one", "two"] {
        std::fs::write(wt.join("README.md"), format!("{n}
")).unwrap();
        git(wt, &["commit", "-q", "-am", n]);
    }
    git(wt, &["switch", "-q", "feat"]);
    rev(wt, "spike")
}

/// Whether `branch` in the repo `dir` belongs to has an upstream.
fn has_upstream(dir: &Path, branch: &str) -> bool {
    crate::spawn::hidden_command("git")
        .current_dir(dir)
        .args(["rev-parse", "--verify", "--quiet", &format!("{branch}@{{upstream}}")])
        .output()
        .unwrap()
        .status
        .success()
}

/// `wt` with a branch `side` made at its HEAD and left unchecked-out. Returns its oid.
fn with_side(wt: &Path) -> String {
    git(wt, &["branch", "-q", "side"]);
    rev(wt, "side")
}

#[test]
fn renaming_a_branch_keeps_its_commit_and_returns_the_refs() {
    let (_root, wt) = repo_with_worktree();
    let side = with_side(&wt);

    let outcome = rename_in(&wt, "side", "renamed").expect("side is renamed");

    assert_eq!(rev(&wt, "renamed"), side);
    assert!(git(&wt, &["branch", "--list", "side"]).trim().is_empty(), "side is gone");
    assert!(outcome.refs.refs.iter().any(|r| r.name == "renamed" && r.oid == side), "the refs show the new name");
    assert!(!outcome.refs.refs.iter().any(|r| r.name == "side"), "and not the old one");
}

#[test]
fn renaming_the_checked_out_branch_keeps_the_worktree_on_it() {
    let (_root, wt) = repo_with_worktree();

    rename_in(&wt, "feat", "feature").expect("feat is renamed");

    assert_eq!(current_branch(&wt).as_deref(), Some("feature"));
}

#[test]
fn setting_an_upstream_makes_the_branch_track_it() {
    let (root, wt) = repo_with_worktree();
    with_remote_topic(&root, &wt);
    with_side(&wt);

    set_upstream_in(&wt, "side", Some("origin/topic")).expect("the upstream is set");

    assert_eq!(upstream_of(&wt, "side"), "origin/topic");
}

#[test]
fn a_local_branch_can_be_the_upstream_too() {
    let (_root, wt) = repo_with_worktree();
    with_side(&wt);

    set_upstream_in(&wt, "side", Some("main")).expect("main is the upstream");

    assert_eq!(upstream_of(&wt, "side"), "main");
}

#[test]
fn no_upstream_unsets_it_and_unsetting_none_is_fine() {
    let (root, wt) = repo_with_worktree();
    with_remote_topic(&root, &wt);
    with_side(&wt);
    git(&wt, &["branch", "-q", "--set-upstream-to=origin/topic", "side"]);

    set_upstream_in(&wt, "side", None).expect("the upstream is unset");
    assert!(!has_upstream(&wt, "side"), "side tracks nothing");

    set_upstream_in(&wt, "side", None).expect("unsetting an unset upstream changes nothing and succeeds");
}

#[test]
fn an_upstream_that_names_no_branch_is_refused() {
    let (_root, wt) = repo_with_worktree();
    with_side(&wt);

    for upstream in ["origin/none", "-x", "--unset-upstream", "a..b", ""] {
        assert_eq!(
            set_upstream_in(&wt, "side", Some(upstream)),
            Err(GitError::InvalidRefName { name: upstream.into() }),
            "upstream {upstream:?}"
        );
    }
    assert!(!has_upstream(&wt, "side"));
}

#[test]
fn deleting_a_merged_branch_returns_its_tip_and_the_refs() {
    let (_root, wt) = repo_with_worktree();
    let side = with_side(&wt);

    let deleted = delete_in(&wt, "side", false).expect("a merged branch deletes");

    assert_eq!(deleted.tip, side);
    assert!(!branch_exists(&wt, "side"));
    assert!(!deleted.refs.refs.iter().any(|r| r.name == "side"), "the refs no longer show side");
}

#[test]
fn an_unmerged_branch_is_refused_with_its_unique_commit_count_and_tip() {
    let (_root, wt) = repo_with_worktree();
    let spike = with_unmerged_spike(&wt);
    // A second branch holding the first of spike's two commits leaves one unique to spike.
    git(&wt, &["branch", "-q", "spike-base", "spike~1"]);

    let refused = delete_in(&wt, "spike", false);

    assert_eq!(refused, Err(GitError::NotFullyMerged { ahead: 1, tip: spike.clone() }));
    assert_eq!(rev(&wt, "spike"), spike, "spike is still there");

    git(&wt, &["branch", "-q", "-D", "spike-base"]);
    assert_eq!(delete_in(&wt, "spike", false), Err(GitError::NotFullyMerged { ahead: 2, tip: spike }));
}

#[test]
fn delete_anyway_force_deletes_an_unmerged_branch_and_restore_brings_it_back_at_its_tip() {
    let (_root, wt) = repo_with_worktree();
    let spike = with_unmerged_spike(&wt);

    let deleted = delete_in(&wt, "spike", true).expect("-D deletes it");
    assert_eq!(deleted.tip, spike);
    assert!(!branch_exists(&wt, "spike"));

    let restored = restore_in(&wt, "spike", &deleted.tip).expect("Restore makes it again");

    assert_eq!(rev(&wt, "spike"), spike);
    assert!(restored.refs.refs.iter().any(|r| r.name == "spike" && r.oid == spike));
    assert_eq!(current_branch(&wt).as_deref(), Some("feat"), "Restore checks nothing out");
}

#[test]
fn restore_refuses_when_a_branch_of_that_name_exists_again() {
    let (_root, wt) = repo_with_worktree();
    let side = with_side(&wt);
    let deleted = delete_in(&wt, "side", false).expect("side deletes");
    git(&wt, &["branch", "-q", "side", "main"]);
    let now = rev(&wt, "side");

    assert_eq!(restore_in(&wt, "side", &deleted.tip), Err(GitError::RefExists { name: "side".into() }));
    assert_eq!(rev(&wt, "side"), now, "the new side is untouched");
    assert_eq!(deleted.tip, side);
}

#[test]
fn the_current_branch_and_one_checked_out_in_another_worktree_are_never_deleted() {
    let (root, wt) = repo_with_worktree();
    let repo = root.join("repo");

    for force in [false, true] {
        match delete_in(&wt, "feat", force) {
            Err(GitError::BranchInOtherWorktree { worktree }) => assert!(same_folder(&worktree, &wt), "names {worktree}"),
            other => panic!("deleting the current branch: expected BranchInOtherWorktree, got {other:?}"),
        }
        match delete_in(&wt, "main", force) {
            Err(GitError::BranchInOtherWorktree { worktree }) => assert!(same_folder(&worktree, &repo), "names {worktree}"),
            other => panic!("deleting another worktree's branch: expected BranchInOtherWorktree, got {other:?}"),
        }
    }
    assert!(branch_exists(&wt, "feat") && branch_exists(&wt, "main"));
}

/// The folder holding `ref`'s loose file in the repo `dir` belongs to, for holding its `.lock`.
fn common_dir(dir: &Path) -> std::path::PathBuf {
    let out = git(dir, &["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    std::path::PathBuf::from(out.trim())
}

#[test]
fn a_held_ref_lock_is_reported_as_ref_locked_and_never_removed() {
    let (_root, wt) = repo_with_worktree();
    let side = with_side(&wt);
    let lock = common_dir(&wt).join("refs/heads/side.lock");
    std::fs::write(&lock, "").unwrap();

    assert_eq!(delete_in(&wt, "side", true), Err(GitError::RefLocked), "delete");
    assert_eq!(rename_in(&wt, "side", "other"), Err(GitError::RefLocked), "rename");
    assert_eq!(restore_in(&wt, "side", "main").err(), Some(GitError::RefExists { name: "side".into() }), "side still exists");

    assert!(lock.exists(), "Topos never deletes a lock");
    std::fs::remove_file(&lock).unwrap();
    assert_eq!(rev(&wt, "side"), side);
}

#[test]
fn invalid_and_option_like_names_are_refused_before_any_write() {
    let (_root, wt) = repo_with_worktree();
    with_side(&wt);
    let before = snapshot(&wt);

    for name in ["-f", "--orphan=x", "-D", "a..b", "has space", "@{-1}", "HEAD", "", "ends.lock"] {
        let invalid = Some(GitError::InvalidRefName { name: name.into() });
        assert_eq!(rename_in(&wt, name, "fresh").err(), invalid, "rename from {name:?}");
        assert_eq!(rename_in(&wt, "side", name).err(), invalid, "rename to {name:?}");
        assert_eq!(set_upstream_in(&wt, name, Some("main")).err(), invalid, "upstream of {name:?}");
        assert_eq!(set_upstream_in(&wt, name, None).err(), invalid, "unset upstream of {name:?}");
        assert_eq!(delete_in(&wt, name, false).err(), invalid, "delete {name:?}");
        assert_eq!(delete_in(&wt, name, true).err(), invalid, "force delete {name:?}");
    }
    assert_eq!(snapshot(&wt), before, "no ref and no HEAD moved");
}

fn tag_in(wt: &Path, name: &str, at: &str, message: Option<&str>) -> Result<RefsOutcome, GitError> {
    tag_create(&GitOps::default(), &StagingLocks::default(), wt, Uuid::new_v4(), NewTag { name, at, message }, &test_channel())
}

fn untag_in(wt: &Path, name: &str) -> Result<RefsOutcome, GitError> {
    tag_delete(&GitOps::default(), &StagingLocks::default(), wt, Uuid::new_v4(), name, &test_channel())
}

/// The object type `refs/tags/<name>` points at: `tag` for an annotated tag, `commit` for a
/// lightweight one.
fn tag_object_type(dir: &Path, name: &str) -> String {
    git(dir, &["cat-file", "-t", &format!("refs/tags/{name}")]).trim().to_string()
}

#[test]
fn a_tag_with_a_message_is_annotated_and_never_pushed() {
    let (root, wt) = repo_with_worktree();
    with_remote_topic(&root, &wt);
    let side = with_side(&wt);

    let outcome = tag_in(&wt, "v1.0", &side, Some("First release

With notes.")).expect("the tag is made");

    assert_eq!(tag_object_type(&wt, "v1.0"), "tag");
    assert_eq!(rev(&wt, "v1.0^{commit}"), side);
    let message = git(&wt, &["tag", "-l", "--format=%(contents)", "v1.0"]);
    assert_eq!(message.trim_end(), "First release

With notes.");
    assert!(outcome.refs.refs.iter().any(|r| r.name == "v1.0" && r.oid == side), "the refs show the tag on its commit");
    let remote_tags = git(&wt, &["ls-remote", "--tags", "origin"]);
    assert!(remote_tags.trim().is_empty(), "nothing was pushed: {remote_tags}");
}

#[test]
fn a_tag_without_a_message_is_lightweight() {
    let (_root, wt) = repo_with_worktree();
    let side = with_side(&wt);

    tag_in(&wt, "light", &side, None).expect("the tag is made");
    tag_in(&wt, "blank", &side, Some("  
")).expect("a blank message counts as none");

    assert_eq!(tag_object_type(&wt, "light"), "commit");
    assert_eq!(tag_object_type(&wt, "blank"), "commit");
    assert_eq!(rev(&wt, "light"), side);
}

#[test]
fn a_tag_that_exists_is_refused_and_left_alone() {
    let (_root, wt) = repo_with_worktree();
    let side = with_side(&wt);
    git(&wt, &["tag", "v1", "main"]);
    let main = rev(&wt, "main");

    assert_eq!(tag_in(&wt, "v1", &side, None), Err(GitError::RefExists { name: "v1".into() }));
    assert_eq!(rev(&wt, "v1"), main);
}

#[test]
fn deleting_a_tag_removes_only_the_local_tag() {
    let (root, wt) = repo_with_worktree();
    with_remote_topic(&root, &wt);
    git(&wt, &["tag", "v1", "main"]);
    git(&wt, &["push", "-q", "origin", "v1"]);

    let outcome = untag_in(&wt, "v1").expect("the tag is deleted");

    assert!(git(&wt, &["tag", "--list", "v1"]).trim().is_empty(), "the local tag is gone");
    assert!(!outcome.refs.refs.iter().any(|r| r.name == "v1"));
    assert!(git(&wt, &["ls-remote", "--tags", "origin", "v1"]).contains("refs/tags/v1"), "the remote's tag is untouched");
}

#[test]
fn invalid_and_option_like_tag_names_and_commits_are_refused_before_any_write() {
    let (_root, wt) = repo_with_worktree();
    git(&wt, &["tag", "kept", "main"]);
    let before = snapshot(&wt);

    for name in ["-f", "--delete", "-d", "a..b", "has space", "", "ends.lock", "a:b", "no-such-tag"] {
        let invalid = Some(GitError::InvalidRefName { name: name.into() });
        if name != "no-such-tag" {
            assert_eq!(tag_in(&wt, name, "HEAD", None).err(), invalid, "lightweight {name:?}");
            assert_eq!(tag_in(&wt, name, "HEAD", Some("msg")).err(), invalid, "annotated {name:?}");
        }
        assert_eq!(untag_in(&wt, name).err(), invalid, "delete {name:?}");
    }
    for at in ["--all", "-q", "no-such-commit"] {
        assert_eq!(tag_in(&wt, "fresh", at, None).err(), Some(GitError::InvalidRefName { name: at.into() }), "at {at:?}");
    }
    assert_eq!(snapshot(&wt), before, "no ref and no HEAD moved");
}
