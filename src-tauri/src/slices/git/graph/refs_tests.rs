//! `git_refs` (#378) against throwaway repositories with worktrees, built with the system git.

use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use super::git_refs;
use super::tests::{git, temp_dir};

fn rev(repo: &Path, name: &str) -> String {
    git(repo, &["rev-parse", name]).trim().to_string()
}

/// A repo whose `main` has one commit, `init`, with git's identity set for commits.
fn repo() -> (PathBuf, PathBuf) {
    let root = temp_dir();
    let repo = root.join("repo");
    std::fs::create_dir_all(&repo).unwrap();
    git(&repo, &["init", "-q", "-b", "main"]);
    for (k, v) in [
        ("user.name", "Quay Test"),
        ("user.email", "quay@example.invalid"),
        ("core.hooksPath", ".git/no-hooks"),
        ("tag.gpgSign", "false"),
        ("commit.gpgSign", "false"),
    ] {
        git(&repo, &["config", k, v]);
    }
    git(&repo, &["commit", "-q", "--allow-empty", "-m", "init"]);
    (root, repo)
}

/// A commit on `parent` that no branch reaches.
fn loose_commit(repo: &Path, parent: &str, msg: &str) -> String {
    let tree = rev(repo, &format!("{parent}^{{tree}}"));
    git(repo, &["commit-tree", &tree, "-p", parent, "-m", msg]).trim().to_string()
}

async fn refs_of(repo: &Path) -> Value {
    serde_json::to_value(git_refs(repo.to_string_lossy().into_owned()).await.expect("git_refs reads the repo")).unwrap()
}

/// The badges as `(kind, name, oid)`, sorted, so the test doesn't depend on git's order.
fn badges(refs: &Value) -> Vec<(String, String, String)> {
    let mut out: Vec<_> = refs["refs"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| (r["kind"].as_str().unwrap().into(), r["name"].as_str().unwrap().into(), r["oid"].as_str().unwrap().into()))
        .collect();
    out.sort();
    out
}

fn same_folder(a: &str, b: &Path) -> bool {
    Path::new(a).canonicalize().unwrap() == b.canonicalize().unwrap()
}

#[tokio::test]
async fn reads_branch_remote_and_tag_badges_and_every_worktree_head() {
    let (root, repo) = repo();
    let init = rev(&repo, "HEAD");
    git(&repo, &["tag", "v1"]);
    git(&repo, &["tag", "-a", "rel", "-m", "release"]);
    let feat_wt = root.join("wt-feat");
    git(&repo, &["worktree", "add", "-q", "-b", "feat", &feat_wt.to_string_lossy()]);
    git(&feat_wt, &["commit", "-q", "--allow-empty", "-m", "feat 1"]);
    let feat = rev(&feat_wt, "HEAD");
    let detached_wt = root.join("wt-detached");
    git(&repo, &["worktree", "add", "-q", "--detach", &detached_wt.to_string_lossy(), &init]);
    git(&repo, &["update-ref", "refs/remotes/origin/main", &init]);
    git(&repo, &["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);
    git(&repo, &["update-ref", "refs/stash", &feat]);

    let refs = refs_of(&repo).await;

    // `origin/HEAD` is no branch, `rel` names the commit its tag object points at, and the stash
    // is no badge.
    let expected = vec![
        ("local".to_string(), "feat".to_string(), feat.clone()),
        ("local".into(), "main".into(), init.clone()),
        ("remote".into(), "origin/main".into(), init.clone()),
        ("tag".into(), "rel".into(), init.clone()),
        ("tag".into(), "v1".into(), init.clone()),
    ];
    assert_eq!(badges(&refs), expected);

    let worktrees = refs["worktrees"].as_array().unwrap();
    assert_eq!(worktrees.len(), 3, "{worktrees:?}");
    let find = |dir: &Path| worktrees.iter().find(|w| same_folder(w["path"].as_str().unwrap(), dir)).unwrap();
    assert_eq!(find(&repo)["oid"], json!(init));
    assert_eq!(find(&repo)["branch"], json!("main"));
    assert_eq!(find(&feat_wt)["oid"], json!(feat));
    assert_eq!(find(&feat_wt)["branch"], json!("feat"));
    assert_eq!(find(&detached_wt)["oid"], json!(init));
    assert_eq!(find(&detached_wt)["branch"], Value::Null);
    std::fs::remove_dir_all(root).ok();
}

#[tokio::test]
async fn counts_the_commits_only_a_tag_reaches() {
    let (root, repo) = repo();
    let init = rev(&repo, "HEAD");
    // Two commits only tag `orphan` reaches, and one under both a tag and a remote branch.
    let t1 = loose_commit(&repo, &init, "tag only 1");
    let t2 = loose_commit(&repo, &t1, "tag only 2");
    git(&repo, &["tag", "-a", "orphan", "-m", "orphan", &t2]);
    let wip = loose_commit(&repo, &init, "remote wip");
    git(&repo, &["update-ref", "refs/remotes/origin/wip", &wip]);
    git(&repo, &["tag", "on-remote", &wip]);
    git(&repo, &["tag", "on-main", &init]);
    // A linked worktree on a branch of its own: its commits are on a branch, so they count as drawn.
    let wt = root.join("wt");
    git(&repo, &["worktree", "add", "-q", "-b", "side", &wt.to_string_lossy()]);
    git(&wt, &["commit", "-q", "--allow-empty", "-m", "side 1"]);
    git(&repo, &["tag", "on-side", "side"]);

    let refs = refs_of(&repo).await;
    assert_eq!(refs["tagOnlyCount"], json!(2));
    std::fs::remove_dir_all(root).ok();
}

#[tokio::test]
async fn a_repo_without_tags_or_commits_counts_none() {
    let (root, repo) = repo();
    assert_eq!(refs_of(&repo).await["tagOnlyCount"], json!(0));
    let empty = root.join("empty");
    std::fs::create_dir_all(&empty).unwrap();
    git(&empty, &["init", "-q", "-b", "main"]);
    let refs = refs_of(&empty).await;
    assert_eq!(refs["tagOnlyCount"], json!(0));
    assert_eq!(refs["refs"], json!([]));
    std::fs::remove_dir_all(root).ok();
}

#[tokio::test]
async fn a_relative_or_missing_folder_is_refused() {
    for path in ["relative/repo", "C:/no/such/quay/folder", ""] {
        assert!(git_refs(path.to_string()).await.is_err(), "{path:?} was accepted");
    }
}
