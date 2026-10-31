//! Filtered graph sessions (#401) against throwaway repositories built with the system git: a
//! filter reopens the session with a reduced ref set that always holds the selected worktree's HEAD.

use std::path::{Path, PathBuf};

use super::session::{GraphOptions, GraphRefs, GraphSessions};
use super::tests::{git, listen, repo_with_history, rows_until_event};

fn filtered(branches: &[&str], remotes: bool, tags: bool, worktree: Option<&Path>) -> GraphOptions {
    GraphOptions {
        refs: GraphRefs::Filtered {
            branches: branches.iter().map(|b| b.to_string()).collect(),
            remotes,
            tags,
            worktree_path: worktree.map(|w| w.to_string_lossy().into_owned()),
        },
        ..GraphOptions::default()
    }
}

/// Opens `options` on `repo` and returns every row once the walk is done.
fn walk(repo: &Path, options: GraphOptions) -> Vec<String> {
    let sessions = GraphSessions::default();
    let (ch, rx) = listen();
    let id = sessions.open(repo, options, ch).unwrap();
    let mut rows = Vec::new();
    let end = rows_until_event(&rx, id, &mut rows, &mut Vec::new());
    assert_eq!(end["event"], "done", "{end}");
    rows
}

fn rev_list(repo: &Path, revs: &[&str]) -> Vec<String> {
    let mut args = vec!["rev-list", "--date-order"];
    args.extend_from_slice(revs);
    git(repo, &args).lines().map(str::to_string).collect()
}

/// [`repo_with_history`] plus a worktree whose HEAD is detached at the commit only tag `old` reaches.
fn repo_with_detached_worktree(commits: usize) -> (PathBuf, PathBuf) {
    let repo = repo_with_history(commits);
    let wt = repo.with_extension("wt");
    git(&repo, &["worktree", "add", "-q", "--detach", &wt.to_string_lossy(), "old"]);
    (repo, wt)
}

#[test]
fn a_branch_filter_walks_only_those_branches_and_the_selected_worktrees_head() {
    let (repo, wt) = repo_with_detached_worktree(100);
    let rows = walk(&repo, filtered(&["refs/heads/feature"], true, false, Some(&wt)));
    assert_eq!(rows, rev_list(&repo, &["refs/heads/feature", "old"]));
    // feature's 2, main's first commit under them, and the tag-only commit at the worktree's HEAD.
    assert_eq!(rows.len(), 4);
    std::fs::remove_dir_all(&wt).ok();
    std::fs::remove_dir_all(&repo).ok();
}

#[test]
fn remotes_off_and_tags_on_walk_local_branches_tags_and_head() {
    let repo = repo_with_history(50);
    let rows = walk(&repo, filtered(&[], false, true, None));
    assert_eq!(rows, rev_list(&repo, &["--branches", "--tags", "HEAD"]));
    let tag_only = git(&repo, &["rev-parse", "old"]).trim().to_string();
    let remote_only = git(&repo, &["rev-parse", "refs/remotes/origin/wip"]).trim().to_string();
    assert!(rows.contains(&tag_only));
    assert!(!rows.contains(&remote_only));
    std::fs::remove_dir_all(&repo).ok();
}

#[test]
fn remotes_off_drops_a_remote_branch_from_the_branch_filter() {
    let repo = repo_with_history(20);
    let rows = walk(&repo, filtered(&["refs/remotes/origin/wip", "refs/heads/feature"], false, false, None));
    // HEAD is main, so main's history stays; origin/wip's own commit does not.
    assert_eq!(rows, rev_list(&repo, &["refs/heads/feature", "HEAD"]));
    let rows_with_remotes = walk(&repo, filtered(&["refs/remotes/origin/wip"], true, false, None));
    assert_eq!(rows_with_remotes, rev_list(&repo, &["refs/remotes/origin/wip", "HEAD"]));
    std::fs::remove_dir_all(&repo).ok();
}

#[test]
fn a_filter_naming_a_branch_that_is_gone_walks_the_rest() {
    let repo = repo_with_history(20);
    let rows = walk(&repo, filtered(&["refs/heads/gone", "refs/heads/feature"], true, false, None));
    assert_eq!(rows, rev_list(&repo, &["refs/heads/feature", "HEAD"]));
    std::fs::remove_dir_all(&repo).ok();
}

#[test]
fn a_filter_naming_anything_but_a_full_branch_name_is_refused_before_git_runs() {
    let repo = repo_with_history(3);
    let sessions = GraphSessions::default();
    for bad in ["--all", "-n1", "main", "refs/tags/old", "refs/heads/", "", "HEAD"] {
        let (ch, _rx) = listen();
        let err = sessions.open(&repo, filtered(&[bad], true, false, None), ch).unwrap_err();
        assert!(matches!(err, super::super::error::GitError::InvalidRefName { .. }), "{bad:?}: {err:?}");
    }
    let (ch, _rx) = listen();
    assert!(sessions.open(&repo, filtered(&["refs/heads/main"], true, false, Some(Path::new("relative"))), ch).is_err());
    std::fs::remove_dir_all(&repo).ok();
}

#[test]
fn filtered_options_parse_from_camel_case() {
    let parsed: GraphOptions = serde_json::from_str(
        r#"{ "refs": { "kind": "filtered", "branches": ["refs/heads/main"], "remotes": false, "tags": true, "worktreePath": null } }"#,
    )
    .unwrap();
    assert_eq!(parsed, filtered(&["refs/heads/main"], false, true, None));
    assert!(serde_json::from_str::<GraphOptions>(r#"{ "refs": { "kind": "filtered", "branches": [], "remotes": true, "tags": false, "worktreePath": null, "all": true } }"#).is_err());
}

/// Commits one empty commit on top of `branch`, a full ref name, and returns it.
fn commit_on(repo: &Path, branch: &str, message: &str) -> String {
    let tip = git(repo, &["rev-parse", branch]).trim().to_string();
    let tree = git(repo, &["rev-parse", &format!("{tip}^{{tree}}")]).trim().to_string();
    let oid = git(repo, &["commit-tree", &tree, "-p", &tip, "-m", message]).trim().to_string();
    git(repo, &["update-ref", branch, &oid]);
    oid
}

#[test]
fn a_refresh_walks_the_sessions_reduced_ref_set_again() {
    let repo = repo_with_history(20);
    let sessions = GraphSessions::default();
    let (ch, rx) = listen();
    let id = sessions.open(&repo, filtered(&["refs/heads/feature"], false, false, None), ch).unwrap();
    let mut rows = Vec::new();
    assert_eq!(rows_until_event(&rx, id, &mut rows, &mut Vec::new())["event"], "done");

    let on_feature = commit_on(&repo, "refs/heads/feature", "feature 3");
    let on_remote = commit_on(&repo, "refs/remotes/origin/wip", "remote wip 2");
    sessions.refresh(id).unwrap();
    let mut after = Vec::new();
    let mut end = rows_until_event(&rx, id, &mut after, &mut Vec::new());
    if end["event"] == "reset" {
        after.clear();
        end = rows_until_event(&rx, id, &mut after, &mut Vec::new());
    }
    assert_eq!(end["event"], "done", "{end}");
    assert_eq!(after, rev_list(&repo, &["refs/heads/feature", "HEAD"]));
    assert!(after.contains(&on_feature) && !after.contains(&on_remote));
    std::fs::remove_dir_all(&repo).ok();
}
