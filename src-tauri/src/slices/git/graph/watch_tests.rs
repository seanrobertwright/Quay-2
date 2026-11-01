//! The repository watcher a graph session owns (#354, #379), against throwaway repositories: what
//! git does on disk becomes the dirty bits of `git-repo-changed`, debounced.

use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Receiver};
use std::time::{Duration, Instant};

use super::session::{GraphOptions, GraphSessions};
use super::tests::{git, listen, temp_dir, Msg};
use super::watch::{Dirty, RepoChanged, WatchState, CEILING};

/// Longer than the 150 ms debounce plus a loaded machine's slack.
const SETTLE: Duration = Duration::from_millis(1500);

/// A repo with one commit on `main`, an identity, and no hooks.
fn repo() -> PathBuf {
    let repo = temp_dir().join("repo");
    std::fs::create_dir_all(&repo).unwrap();
    git(&repo, &["init", "-q", "-b", "main"]);
    for (k, v) in [("user.name", "Quay Test"), ("user.email", "quay@example.invalid"), ("core.hooksPath", ".git/no-hooks")] {
        git(&repo, &["config", k, v]);
    }
    std::fs::write(repo.join("a.txt"), "a\n").unwrap();
    git(&repo, &["add", "-A"]);
    git(&repo, &["commit", "-q", "-m", "init"]);
    repo
}

/// A session on `repo` whose `git-repo-changed` events land in the returned receiver.
fn watched(repo: &Path) -> (GraphSessions, u32, Receiver<RepoChanged>, Receiver<Msg>) {
    let sessions = GraphSessions::default();
    let (tx, changes) = channel();
    sessions.on_repo_changed(move |change| {
        let _ = tx.send(change);
    });
    let (ch, rx) = listen();
    let id = sessions.open(repo, GraphOptions::default(), ch).unwrap();
    (sessions, id, changes, rx)
}

/// Every change that arrives within `SETTLE` of the last one.
fn settle(changes: &Receiver<RepoChanged>) -> Vec<RepoChanged> {
    let mut out = Vec::new();
    while let Ok(change) = changes.recv_timeout(SETTLE) {
        out.push(change);
    }
    out
}

/// The dirty bits of every change in `changes`, or-ed together.
fn bits(changes: &[RepoChanged]) -> Dirty {
    changes.iter().fold(Dirty::default(), |a, c| a.or(c.dirty))
}

fn only(refs: bool, head: bool, index: bool, worktree: bool, operation: bool) -> Dirty {
    Dirty { refs, head, index, worktree, operation }
}

#[test]
fn a_commit_dirties_refs_and_names_the_repo_and_worktree() {
    let _timed = crate::slices::git::test_load::timed();
    let repo = repo();
    let (sessions, id, changes, _rx) = watched(&repo);
    assert_eq!(sessions.watch(id, &repo, false).unwrap(), WatchState::Live);

    git(&repo, &["commit", "-q", "--allow-empty", "-m", "next"]);
    let seen = settle(&changes);
    assert!(!seen.is_empty(), "a commit is seen");
    assert!(bits(&seen).refs, "{seen:?}");
    assert!(!bits(&seen).worktree, "the working tree isn't watched while Topos is hidden");
    assert_eq!(seen[0].repo_root, repo.to_string_lossy());
    assert_eq!(seen[0].worktree_path, repo.to_string_lossy());
    std::fs::remove_dir_all(repo.parent().unwrap()).ok();
}

#[test]
fn a_checkout_dirties_head_staging_dirties_the_index_and_files_count_only_while_visible() {
    let _timed = crate::slices::git::test_load::timed();
    let repo = repo();
    let (sessions, id, changes, _rx) = watched(&repo);
    assert_eq!(sessions.watch(id, &repo, false).unwrap(), WatchState::Live);

    git(&repo, &["checkout", "-q", "-b", "other"]);
    assert!(bits(&settle(&changes)).head, "HEAD moved to another branch");

    std::fs::write(repo.join("a.txt"), "hidden edit\n").unwrap();
    assert!(settle(&changes).is_empty(), "files aren't watched while hidden");
    git(&repo, &["add", "a.txt"]);
    assert_eq!(bits(&settle(&changes)), only(false, false, true, false, false));

    assert_eq!(sessions.watch(id, &repo, true).unwrap(), WatchState::Live);
    std::fs::write(repo.join("b.txt"), "visible edit\n").unwrap();
    assert_eq!(bits(&settle(&changes)), only(false, false, false, true, false));

    // Objects and logs alone change nothing Topos shows.
    git(&repo, &["hash-object", "-w", "a.txt"]);
    assert!(settle(&changes).is_empty(), "a new loose object is ignored");

    assert_eq!(sessions.watch(id, &repo, false).unwrap(), WatchState::Live);
    std::fs::write(repo.join("b.txt"), "hidden again\n").unwrap();
    assert!(settle(&changes).is_empty(), "hiding Topos stops the working-tree watch");
    std::fs::remove_dir_all(repo.parent().unwrap()).ok();
}

#[test]
fn a_burst_of_ref_updates_coalesces_and_steady_events_still_send_each_second() {
    let _timed = crate::slices::git::test_load::timed();
    let repo = repo();
    let (sessions, id, changes, _rx) = watched(&repo);
    assert_eq!(sessions.watch(id, &repo, true).unwrap(), WatchState::Live);

    // An agent's rebase rewriting hundreds of refs.
    let tip = git(&repo, &["rev-parse", "HEAD"]).trim().to_string();
    let stdin: String = (0..300).map(|i| format!("create refs/heads/burst-{i} {tip}\n")).collect();
    let started = Instant::now();
    let mut child = crate::spawn::hidden_command("git")
        .arg("-C")
        .arg(&repo)
        .args(["update-ref", "--no-deref", "--stdin"])
        .stdin(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    std::io::Write::write_all(&mut child.stdin.take().unwrap(), stdin.as_bytes()).unwrap();
    assert!(child.wait().unwrap().success());
    let burst = started.elapsed();
    let seen = settle(&changes);
    // Hundreds of ref writes become one change, or two if git paused for 150 ms between them, plus
    // the one the ceiling sends for each second the burst lasted: a busy machine stretches this
    // burst past two seconds.
    let most = 2 + (burst.as_millis() / CEILING.as_millis()) as usize;
    assert!((1..=most).contains(&seen.len()), "{} changes for one burst over {burst:?}, at most {most}", seen.len());
    assert!(bits(&seen).refs);

    // Edits every 100 ms never leave 150 ms of quiet, yet changes arrive while they go on: the
    // ceiling sends one each second. Edits go on until two have arrived. After the first, the
    // next edit opens a new window that the ceiling closes a second later, so the gap between
    // the two is at most the ceiling plus the longest pause between edits, plus half a ceiling
    // for the watcher's own latency. The longest pause is what a busy machine stretches. The
    // bound is a literal second, not `CEILING`, so a slower ceiling fails it.
    let started = Instant::now();
    let mut arrivals = Vec::new();
    let mut last_edit = None;
    let mut longest_pause = Duration::ZERO;
    let mut i = 0;
    while arrivals.len() < 2 {
        assert!(started.elapsed() < Duration::from_secs(60), "{} changes during {i} steady edits", arrivals.len());
        std::fs::write(repo.join("steady.txt"), format!("{i}\n")).unwrap();
        let edited = Instant::now();
        if let Some(last) = last_edit {
            longest_pause = longest_pause.max(edited - last);
        }
        last_edit = Some(edited);
        i += 1;
        let next_edit = edited + Duration::from_millis(100);
        while let Some(left) = next_edit.checked_duration_since(Instant::now()) {
            match changes.recv_timeout(left) {
                Ok(_) => arrivals.push(Instant::now()),
                Err(_) => break,
            }
        }
    }
    let gap = arrivals[1] - arrivals[0];
    let second = Duration::from_secs(1);
    let most = second + second / 2 + longest_pause;
    assert!(gap <= most, "{gap:?} between steady changes, at most {most:?} (longest pause between edits {longest_pause:?})");
    std::fs::remove_dir_all(repo.parent().unwrap()).ok();
}

#[test]
fn an_operation_dirties_operation_and_holds_while_its_directory_exists() {
    let _timed = crate::slices::git::test_load::timed();
    let repo = repo();
    let (sessions, id, changes, _rx) = watched(&repo);
    assert_eq!(sessions.watch(id, &repo, false).unwrap(), WatchState::Live);

    // What `git rebase` leaves while it stops for a conflict.
    let rebase = repo.join(".git").join("rebase-merge");
    std::fs::create_dir(&rebase).unwrap();
    std::fs::write(rebase.join("head-name"), "refs/heads/main\n").unwrap();
    let seen = settle(&changes);
    assert!(bits(&seen).operation, "{seen:?}");
    assert!(seen.last().unwrap().in_operation);

    git(&repo, &["update-ref", "refs/heads/during", "HEAD"]);
    let seen = settle(&changes);
    assert!(bits(&seen).refs && seen.last().unwrap().in_operation, "{seen:?}");

    std::fs::remove_dir_all(&rebase).unwrap();
    let seen = settle(&changes);
    assert!(bits(&seen).operation, "{seen:?}");
    assert!(!seen.last().unwrap().in_operation, "the operation ended");

    std::fs::write(repo.join(".git").join("MERGE_HEAD"), "x\n").unwrap();
    let seen = settle(&changes);
    assert!(bits(&seen).operation && !seen.last().unwrap().in_operation, "a merge holds nothing: {seen:?}");
    std::fs::remove_dir_all(repo.parent().unwrap()).ok();
}

#[test]
fn a_linked_worktree_follows_its_own_git_dir_and_sees_other_heads_as_refs() {
    let _timed = crate::slices::git::test_load::timed();
    let repo = repo();
    let wt = repo.parent().unwrap().join("wt");
    git(&repo, &["worktree", "add", "-q", "-b", "feat", &wt.to_string_lossy()]);
    let (sessions, id, changes, _rx) = watched(&repo);
    assert_eq!(sessions.watch(id, &wt, false).unwrap(), WatchState::Live);

    git(&wt, &["checkout", "-q", "-b", "feat-2"]);
    let seen = settle(&changes);
    assert!(bits(&seen).head, "the selected worktree's HEAD: {seen:?}");
    assert_eq!(seen[0].worktree_path, wt.to_string_lossy());
    assert_eq!(seen[0].repo_root, repo.to_string_lossy());

    std::fs::write(wt.join("a.txt"), "edit\n").unwrap();
    git(&wt, &["add", "a.txt"]);
    assert_eq!(bits(&settle(&changes)), only(false, false, true, false, false), "its own index");

    // The main worktree's HEAD and index are another worktree's: only its HEAD badge changes.
    git(&repo, &["checkout", "-q", "-b", "main-2"]);
    let seen = bits(&settle(&changes));
    assert!(seen.refs && !seen.head && !seen.index, "{seen:?}");
    std::fs::remove_dir_all(repo.parent().unwrap()).ok();
}

#[test]
fn a_removed_worktree_says_gone_and_a_watch_that_cannot_start_says_off() {
    let _timed = crate::slices::git::test_load::timed();
    let repo = repo();
    let wt = repo.parent().unwrap().join("wt");
    git(&repo, &["worktree", "add", "-q", "-b", "feat", &wt.to_string_lossy()]);
    let (sessions, id, _changes, rx) = watched(&repo);
    assert_eq!(sessions.watch(id, &wt, true).unwrap(), WatchState::Live);

    git(&repo, &["worktree", "remove", "--force", &wt.to_string_lossy()]);
    let deadline = Instant::now() + Duration::from_secs(10);
    let gone = loop {
        match rx.recv_timeout(deadline.saturating_duration_since(Instant::now())).expect("the watch says it is gone") {
            Msg::Event(e) if e["event"] == "watch" => break e,
            _ => {}
        }
    };
    assert_eq!(gone["sessionId"], id);
    assert_eq!(gone["watch"]["state"], "gone", "{gone}");

    let missing = repo.parent().unwrap().join("missing");
    assert_eq!(sessions.watch(id, &missing, true).unwrap(), WatchState::Gone, "a folder that isn't there is gone");
    assert_eq!(sessions.watch(id, &wt, true).unwrap(), WatchState::Gone, "so is the removed worktree on the next show");
    let not_a_repo = temp_dir();
    match sessions.watch(id, &not_a_repo, true).unwrap() {
        WatchState::Off { reason } => assert!(reason.contains("not a git repository"), "{reason}"),
        other => panic!("{other:?}"),
    }
    // Retry on the repo itself starts it again.
    assert_eq!(sessions.watch(id, &repo, true).unwrap(), WatchState::Live);
    assert!(sessions.watch(id + 1, &repo, true).is_err(), "only the live session has a watch");
    std::fs::remove_dir_all(repo.parent().unwrap()).ok();
    std::fs::remove_dir_all(not_a_repo).ok();
}

#[test]
fn the_fingerprint_changes_with_refs_head_and_index_and_only_then() {
    let _timed = crate::slices::git::test_load::timed();
    let repo = repo();
    let print = || super::watch::fingerprint(&repo).unwrap();
    let first = print();
    assert_eq!(print(), first, "nothing changed");
    std::fs::write(repo.join("a.txt"), "edit\n").unwrap();
    assert_eq!(print(), first, "a file edit alone is not in the fingerprint");
    git(&repo, &["add", "a.txt"]);
    let staged = print();
    assert_ne!(staged, first, "the index changed");
    git(&repo, &["tag", "v1"]);
    let tagged = print();
    assert_ne!(tagged, staged, "a ref changed");
    git(&repo, &["checkout", "-q", "--detach", "HEAD"]);
    git(&repo, &["commit", "-q", "-m", "detached"]);
    assert_ne!(print(), tagged, "HEAD moved");
    assert!(super::watch::fingerprint(&temp_dir()).is_err());
    std::fs::remove_dir_all(repo.parent().unwrap()).ok();
}
