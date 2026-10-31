//! Comparing two commits (#398) against throwaway repositories built with the system git.

use std::path::Path;

use super::checkout_tests::rev;
use super::compare::{compare_files, compare_order, ComparedCommit, CompareOrder};
use super::details::FileStatus;
use super::staging_tests::{git, repo_with_worktree};

/// Writes `content` to `file` in `wt` and commits it with `seconds` as both author and committer
/// date, returning the new commit's oid.
fn commit_at(wt: &Path, file: &str, content: &str, seconds: i64) -> String {
    std::fs::write(wt.join(file), content).unwrap();
    git(wt, &["add", "-A"]);
    let date = format!("@{seconds} +0000");
    let out = crate::spawn::hidden_command("git")
        .current_dir(wt)
        .args(["commit", "-q", "-m", &format!("change {file}")])
        .env("GIT_AUTHOR_DATE", &date)
        .env("GIT_COMMITTER_DATE", &date)
        .output()
        .unwrap();
    assert!(out.status.success(), "commit: {}", String::from_utf8_lossy(&out.stderr));
    rev(wt, "HEAD")
}

#[test]
fn an_ancestor_pair_is_ordered_ancestor_first_and_counts_the_commits_between() {
    let (_root, wt) = repo_with_worktree();
    let base = rev(&wt, "HEAD");
    // Later commits carry earlier dates, so only ancestry can put the base first.
    commit_at(&wt, "one.txt", "one\n", 1_000);
    commit_at(&wt, "two.txt", "two\n", 900);
    let tip = commit_at(&wt, "README.md", "changed\n", 800);

    let ordered = CompareOrder {
        older: ComparedCommit { oid: base.clone(), subject: "init".into() },
        newer: ComparedCommit { oid: tip.clone(), subject: "change README.md".into() },
    };
    assert_eq!(compare_order(&wt, &tip, &base).expect("order read"), ordered, "the ancestor is older whatever the dates");
    assert_eq!(compare_order(&wt, &base, &tip).expect("order read"), ordered, "the argument order doesn't matter");

    let compared = compare_files(&wt, &base, &tip).expect("files read");

    let mut got: Vec<(FileStatus, String)> = compared.files.files.iter().map(|f| (f.status, f.path.clone())).collect();
    got.sort();
    assert_eq!(
        got,
        vec![(FileStatus::A, "one.txt".into()), (FileStatus::A, "two.txt".into()), (FileStatus::M, "README.md".into())]
    );
    assert_eq!(compared.ahead, Some(3), "three commits lead from the base to the tip");
    assert_eq!((compared.files.total, compared.files.truncated), (3, false));
}

#[test]
fn a_pair_on_two_branches_puts_the_earlier_committer_date_first_and_has_no_ahead() {
    let (_root, wt) = repo_with_worktree();
    let base = rev(&wt, "HEAD");
    // The branch made first gets the later date, so the date, not the order made, decides.
    let late = commit_at(&wt, "late.txt", "late\n", 1_700_005_000);
    git(&wt, &["switch", "-q", "-c", "other", &base]);
    let early = commit_at(&wt, "early.txt", "early\n", 1_700_004_000);

    let ordered = CompareOrder {
        older: ComparedCommit { oid: early.clone(), subject: "change early.txt".into() },
        newer: ComparedCommit { oid: late.clone(), subject: "change late.txt".into() },
    };
    assert_eq!(compare_order(&wt, &late, &early).expect("order read"), ordered);
    assert_eq!(compare_order(&wt, &early, &late).expect("order read"), ordered);

    let compared = compare_files(&wt, &early, &late).expect("files read");

    let mut got: Vec<(FileStatus, String)> = compared.files.files.iter().map(|f| (f.status, f.path.clone())).collect();
    got.sort();
    assert_eq!(got, vec![(FileStatus::A, "late.txt".into()), (FileStatus::D, "early.txt".into())]);
    assert_eq!(compared.ahead, None, "neither commit is an ancestor of the other");
}

#[test]
fn a_rename_between_the_two_is_found_and_swapping_the_pair_reverses_the_diff() {
    let (_root, wt) = repo_with_worktree();
    let body: String = (1..=20).map(|n| format!("line {n}\n")).collect();
    let before = commit_at(&wt, "notes.txt", &body, 1_700_001_000);
    commit_at(&wt, "README.md", "between\n", 1_700_002_000);
    git(&wt, &["mv", "notes.txt", "odd name é.txt"]);
    let after = commit_at(&wt, "odd name é.txt", &body.replace("line 3\n", "line three\n"), 1_700_003_000);
    let files_of = |c: &super::compare::CompareFiles| {
        let mut got: Vec<_> = c.files.files.iter().map(|f| (f.status, f.path.clone(), f.old_path.clone(), f.additions, f.deletions)).collect();
        got.sort();
        got
    };

    let forward = compare_files(&wt, &before, &after).expect("files read");
    let back = compare_files(&wt, &after, &before).expect("swapped files read");

    assert_eq!(
        files_of(&forward),
        vec![
            (FileStatus::M, "README.md".into(), None, Some(1), Some(1)),
            (FileStatus::R, "odd name é.txt".into(), Some("notes.txt".into()), Some(1), Some(1)),
        ]
    );
    assert_eq!(
        files_of(&back),
        vec![
            (FileStatus::M, "README.md".into(), None, Some(1), Some(1)),
            (FileStatus::R, "notes.txt".into(), Some("odd name é.txt".into()), Some(1), Some(1)),
        ],
        "swapped, the rename runs the other way"
    );
    assert_eq!((forward.ahead, back.ahead), (Some(2), Some(2)), "the count is the same in either order");
}

#[test]
fn compare_refuses_an_oid_that_is_not_a_commit_it_can_resolve() {
    let (_root, wt) = repo_with_worktree();
    let head = rev(&wt, "HEAD");
    let tree = rev(&wt, "HEAD^{tree}");
    assert_eq!(compare_order(&wt, &head[..8], &head[..8]).expect("an abbreviated oid resolves").older.oid, head);
    for bad in ["", "--all", "-p", "HEAD", "main", "HEAD~1..HEAD", "abc", "zzzzzzz", "0000000000", tree.as_str()] {
        assert!(compare_files(&wt, bad, &head).is_err(), "{bad:?} is refused as the first commit");
        assert!(compare_files(&wt, &head, bad).is_err(), "{bad:?} is refused as the second commit");
        assert!(compare_order(&wt, bad, &head).is_err(), "{bad:?} is refused when ordering");
        assert!(compare_order(&wt, &head, bad).is_err(), "{bad:?} is refused when ordering");
    }
}
