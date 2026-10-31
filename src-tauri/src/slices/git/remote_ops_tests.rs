//! Fetch, pull and push (#395) against throwaway repositories whose remote is a local bare repo
//! under the OS temp dir. Nothing here touches the network.

use std::path::{Path, PathBuf};

use uuid::Uuid;

use super::checkout_tests::{rev, test_channel};
use super::error::GitError;
use super::op_runner::GitOps;
use super::remote_ops::{fetch, pull, push, push_refusal, with_repo_config_only, FetchFrom, PullStrategy, PushTarget, RemoteOutcome};
use super::staging::StagingLocks;
use super::staging_tests::{git, repo_with_worktree};

/// `wt`'s repo with a bare `origin` under `root` that has `main` and `topic`, fetched, and `wt`
/// (on `feat`) tracking nothing. Returns the bare repo's path.
fn with_origin(root: &Path, wt: &Path) -> PathBuf {
    let bare = root.join("origin.git");
    git(root, &["init", "-q", "--bare", "-b", "main", &bare.to_string_lossy()]);
    git(wt, &["remote", "add", "origin", &bare.to_string_lossy()]);
    git(wt, &["push", "-q", "origin", "main:main", "main:topic"]);
    git(wt, &["fetch", "-q", "origin"]);
    bare
}

/// A second clone of `bare`, as another operator, under `root`.
fn other_clone(root: &Path, bare: &Path) -> PathBuf {
    let other = root.join("other");
    git(root, &["clone", "-q", "-b", "main", &bare.to_string_lossy(), &other.to_string_lossy()]);
    for (k, v) in [("user.name", "Other"), ("user.email", "other@example.invalid"), ("core.hooksPath", ".git/no-hooks"), ("commit.gpgSign", "false")] {
        git(&other, &["config", k, v]);
    }
    other
}

/// Commits `file` with `text` in `dir`, and returns the new HEAD.
fn commit_file(dir: &Path, file: &str, text: &str) -> String {
    std::fs::write(dir.join(file), text).unwrap();
    git(dir, &["add", "--", file]);
    git(dir, &["commit", "-q", "-m", file]);
    rev(dir, "HEAD")
}

fn fetch_in(wt: &Path, from: FetchFrom, prune: bool) -> Result<RemoteOutcome, GitError> {
    fetch(&GitOps::default(), &StagingLocks::default(), wt, Uuid::new_v4(), &from, prune, &test_channel())
}

#[test]
fn fetch_with_prune_brings_new_commits_and_drops_deleted_remote_branches() {
    let (root, wt) = repo_with_worktree();
    let bare = with_origin(&root, &wt);
    let other = other_clone(&root, &bare);
    let pushed = commit_file(&other, "other.txt", "other\n");
    git(&other, &["push", "-q", "origin", "main", ":topic"]);

    let outcome = fetch_in(&wt, FetchFrom::Remote { name: "origin".into() }, true).expect("the fetch runs");

    assert_eq!(rev(&wt, "origin/main"), pushed);
    let remote_names: Vec<&str> = outcome.refs.refs.iter().map(|r| r.name.as_str()).collect();
    assert!(remote_names.contains(&"origin/main"), "refs: {remote_names:?}");
    assert!(!remote_names.contains(&"origin/topic"), "prune drops origin/topic: {remote_names:?}");
}

/// Pulls in `wt` with git config from the repo alone, so the system and global config of the
/// machine running the tests (Git for Windows sets `pull.rebase=false`) can't pick a strategy.
fn pull_in(wt: &Path, strategy: Option<PullStrategy>, remember: bool) -> Result<RemoteOutcome, GitError> {
    with_repo_config_only(|| pull(&GitOps::default(), &StagingLocks::default(), wt, Uuid::new_v4(), strategy, remember, &test_channel()))
}

/// `wt` on `feat` tracking `origin/feat`, and another clone that has pushed one more commit to it.
/// Returns that commit.
fn behind_origin(root: &Path, wt: &Path) -> String {
    let bare = with_origin(root, wt);
    git(wt, &["push", "-q", "-u", "origin", "feat"]);
    let other = other_clone(root, &bare);
    git(&other, &["switch", "-q", "feat"]);
    let theirs = commit_file(&other, "theirs.txt", "theirs\n");
    git(&other, &["push", "-q", "origin", "feat"]);
    theirs
}

#[test]
fn a_pull_that_can_fast_forward_moves_the_branch_to_the_remote() {
    let (root, wt) = repo_with_worktree();
    let theirs = behind_origin(&root, &wt);

    let outcome = pull_in(&wt, None, false).expect("the pull runs");

    assert_eq!(rev(&wt, "HEAD"), theirs);
    assert_eq!(outcome.head.as_deref(), Some(theirs.as_str()));
    assert!(wt.join("theirs.txt").is_file());
}

/// [`behind_origin`] with a commit of `wt`'s own on `feat` too, so the branches have diverged.
/// Returns (theirs, ours).
fn diverged_from_origin(root: &Path, wt: &Path) -> (String, String) {
    let theirs = behind_origin(root, wt);
    let ours = commit_file(wt, "ours.txt", "ours\n");
    git(wt, &["fetch", "-q", "origin"]);
    (theirs, ours)
}

fn local_config(dir: &Path, key: &str) -> Option<String> {
    let out = crate::spawn::hidden_command("git").current_dir(dir).args(["config", "--local", "--get", key]).output().unwrap();
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
}

#[test]
fn a_divergent_pull_with_no_strategy_set_asks_for_one_and_changes_nothing() {
    let (root, wt) = repo_with_worktree();
    let (_theirs, ours) = diverged_from_origin(&root, &wt);

    assert_eq!(pull_in(&wt, None, false), Err(GitError::DivergentPullNeedsStrategy));

    assert_eq!(rev(&wt, "HEAD"), ours);
    assert_eq!(local_config(&wt, "pull.rebase"), None);
}

#[test]
fn merge_for_this_pull_makes_a_merge_commit_and_writes_no_config() {
    let (root, wt) = repo_with_worktree();
    let (theirs, ours) = diverged_from_origin(&root, &wt);

    let outcome = pull_in(&wt, Some(PullStrategy::Merge), false).expect("the merge pull runs");

    assert_eq!(rev(&wt, "HEAD^1"), ours);
    assert_eq!(rev(&wt, "HEAD^2"), theirs);
    assert_eq!(outcome.head, Some(rev(&wt, "HEAD")));
    assert_eq!(local_config(&wt, "pull.rebase"), None);
    assert_eq!(local_config(&wt, "pull.ff"), None);
}

#[test]
fn rebase_for_this_pull_replays_our_commit_on_theirs() {
    let (root, wt) = repo_with_worktree();
    let (theirs, _ours) = diverged_from_origin(&root, &wt);

    pull_in(&wt, Some(PullStrategy::Rebase), false).expect("the rebase pull runs");

    assert_eq!(rev(&wt, "HEAD^"), theirs);
    assert!(wt.join("ours.txt").is_file() && wt.join("theirs.txt").is_file());
}

#[test]
fn fast_forward_only_on_divergent_branches_refuses_and_changes_nothing() {
    let (root, wt) = repo_with_worktree();
    let (_theirs, ours) = diverged_from_origin(&root, &wt);

    assert_eq!(pull_in(&wt, Some(PullStrategy::FastForward), false), Err(GitError::DivergentPullNeedsStrategy));
    assert_eq!(rev(&wt, "HEAD"), ours);
}

#[test]
fn remember_for_this_repo_writes_the_strategy_to_the_repos_local_config() {
    for (strategy, key, value) in [
        (PullStrategy::Merge, "pull.rebase", "false"),
        (PullStrategy::Rebase, "pull.rebase", "true"),
        (PullStrategy::FastForward, "pull.ff", "only"),
    ] {
        let (root, wt) = repo_with_worktree();
        let _ = diverged_from_origin(&root, &wt);

        let _ = pull_in(&wt, Some(strategy), true);

        assert_eq!(local_config(&wt, key).as_deref(), Some(value), "{strategy:?}");
    }
}

#[test]
fn a_remembered_strategy_applies_to_the_next_plain_pull() {
    let (root, wt) = repo_with_worktree();
    let (theirs, _ours) = diverged_from_origin(&root, &wt);
    git(&wt, &["config", "--local", "pull.rebase", "true"]);

    pull_in(&wt, None, false).expect("plain git pull follows pull.rebase");

    assert_eq!(rev(&wt, "HEAD^"), theirs);
}

#[test]
fn pulling_a_branch_with_no_upstream_says_so() {
    let (root, wt) = repo_with_worktree();
    with_origin(&root, &wt);

    assert_eq!(pull_in(&wt, None, false), Err(GitError::NoUpstream { branch: "feat".into(), remotes: vec!["origin".into()] }));
}

fn push_in(wt: &Path, branch: &str, remote: Option<&str>, set_upstream: bool) -> Result<RemoteOutcome, GitError> {
    with_repo_config_only(|| {
        push(&GitOps::default(), &StagingLocks::default(), wt, Uuid::new_v4(), PushTarget { branch, remote, set_upstream }, &test_channel())
    })
}

#[test]
fn pushing_a_branch_with_an_upstream_updates_the_remote_branch() {
    let (root, wt) = repo_with_worktree();
    let bare = with_origin(&root, &wt);
    git(&wt, &["push", "-q", "-u", "origin", "feat"]);
    let ours = commit_file(&wt, "ours.txt", "ours\n");

    let outcome = push_in(&wt, "feat", None, false).expect("the push runs");

    assert_eq!(rev(&bare, "refs/heads/feat"), ours);
    assert!(outcome.refs.refs.iter().any(|r| r.name == "origin/feat" && r.oid == ours), "the refs show origin/feat moved");
}

#[test]
fn pushing_a_branch_with_no_upstream_offers_to_set_one() {
    let (root, wt) = repo_with_worktree();
    let bare = with_origin(&root, &wt);

    assert_eq!(push_in(&wt, "feat", None, false), Err(GitError::NoUpstream { branch: "feat".into(), remotes: vec!["origin".into()] }));
    assert!(git(&bare, &["branch", "--list", "feat"]).trim().is_empty(), "nothing was pushed");
}

#[test]
fn push_and_set_upstream_pushes_and_tracks_the_remote_branch() {
    let (root, wt) = repo_with_worktree();
    let bare = with_origin(&root, &wt);

    push_in(&wt, "feat", Some("origin"), true).expect("push -u runs");

    assert_eq!(rev(&bare, "refs/heads/feat"), rev(&wt, "feat"));
    assert_eq!(super::checkout_tests::upstream_of(&wt, "feat"), "origin/feat");
}

#[test]
fn push_auto_setup_remote_in_config_sets_the_upstream_itself() {
    let (root, wt) = repo_with_worktree();
    let bare = with_origin(&root, &wt);
    git(&wt, &["config", "--local", "push.autoSetupRemote", "true"]);

    push_in(&wt, "feat", None, false).expect("git config decides");

    assert_eq!(rev(&bare, "refs/heads/feat"), rev(&wt, "feat"));
    assert_eq!(super::checkout_tests::upstream_of(&wt, "feat"), "origin/feat");
}

#[test]
fn a_push_behind_the_remote_is_refused_as_non_fast_forward() {
    let (root, wt) = repo_with_worktree();
    let theirs = behind_origin(&root, &wt);
    commit_file(&wt, "ours.txt", "ours\n");

    assert_eq!(push_in(&wt, "feat", None, false), Err(GitError::NonFastForward { r#ref: "refs/heads/feat".into() }));
    assert_eq!(rev(&root.join("origin.git"), "refs/heads/feat"), theirs, "the remote kept its commit");
}

#[test]
fn a_push_a_pre_receive_hook_rejects_returns_the_hooks_remote_lines() {
    let (root, wt) = repo_with_worktree();
    let bare = with_origin(&root, &wt);
    let hook = bare.join("hooks").join("pre-receive");
    std::fs::write(&hook, "#!/bin/sh\necho 'protected: feat is frozen' >&2\necho '<b>not html</b>' >&2\nexit 1\n").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755)).unwrap();
    }

    assert_eq!(
        push_in(&wt, "feat", Some("origin"), true),
        Err(GitError::RemoteRejected {
            r#ref: "refs/heads/feat".into(),
            reason: "pre-receive hook declined".into(),
            remote_lines: vec!["protected: feat is frozen".into(), "<b>not html</b>".into()],
        })
    );
}

/// A channel that keeps every event it is sent, as the JSON the frontend would receive.
fn recording_channel() -> (tauri::ipc::Channel<super::op_runner::OpEvent>, std::sync::Arc<std::sync::Mutex<Vec<serde_json::Value>>>) {
    let events = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let sink = events.clone();
    let channel = tauri::ipc::Channel::new(move |body| {
        let json = match body {
            tauri::ipc::InvokeResponseBody::Json(s) => s,
            tauri::ipc::InvokeResponseBody::Raw(bytes) => String::from_utf8(bytes).unwrap(),
        };
        sink.lock().unwrap().push(serde_json::from_str(&json).unwrap());
        Ok(())
    });
    (channel, events)
}

/// `wt`'s repo with a remote `slow` whose upload-pack waits `seconds` before it serves, so a fetch
/// from it runs that long.
fn with_slow_remote(root: &Path, wt: &Path, seconds: u32) {
    let bare = with_origin(root, wt);
    git(wt, &["remote", "add", "slow", &bare.to_string_lossy()]);
    git(wt, &["config", "remote.slow.uploadpack", &format!("sleep {seconds}; git-upload-pack")]);
}

/// Waits until `events` holds one matching `want`, failing after 20 s.
fn wait_for(events: &std::sync::Mutex<Vec<serde_json::Value>>, want: impl Fn(&serde_json::Value) -> bool) {
    let started = std::time::Instant::now();
    while !events.lock().unwrap().iter().any(&want) {
        assert!(started.elapsed() < std::time::Duration::from_secs(20), "never saw it in {:?}", events.lock().unwrap());
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
}

/// Gives an op started on another thread time to take the repo's network lock; the slow remote
/// keeps it held for seconds after that.
fn let_it_start() {
    std::thread::sleep(std::time::Duration::from_millis(400));
}

#[test]
fn the_network_lock_runs_one_operation_per_repo_and_the_second_waits_for_the_first() {
    let (root, wt) = repo_with_worktree();
    with_slow_remote(&root, &wt, 2);
    let main_checkout = root.join("repo");
    let (ops, locks) = (GitOps::default(), StagingLocks::default());
    let (slow_channel, _) = recording_channel();
    let (second_channel, second_events) = recording_channel();

    let (slow_done, second_done) = std::thread::scope(|scope| {
        let slow = scope.spawn(|| {
            fetch(&ops, &locks, &wt, Uuid::new_v4(), &FetchFrom::Remote { name: "slow".into() }, false, &slow_channel).expect("the slow fetch runs");
            std::time::Instant::now()
        });
        let_it_start();
        // From the repo's other worktree: the lock is per repo, not per worktree.
        let second = scope.spawn(|| {
            fetch(&ops, &locks, &main_checkout, Uuid::new_v4(), &FetchFrom::Remote { name: "origin".into() }, false, &second_channel).expect("the second fetch runs");
            std::time::Instant::now()
        });
        (slow.join().unwrap(), second.join().unwrap())
    });

    assert!(second_done > slow_done, "the second fetch finished before the first let go");
    let waited = second_events.lock().unwrap().iter().any(|e| e["event"] == "progress" && e["phase"] == super::remote_ops::WAITING_PHASE);
    assert!(waited, "the second fetch said it was waiting");
}

#[test]
fn a_local_ref_operation_waits_behind_a_running_fetch() {
    let (root, wt) = repo_with_worktree();
    with_slow_remote(&root, &wt, 2);
    let (ops, locks) = (GitOps::default(), StagingLocks::default());
    let (slow_channel, _) = recording_channel();

    let (slow_done, create) = std::thread::scope(|scope| {
        let slow = scope.spawn(|| {
            fetch(&ops, &locks, &wt, Uuid::new_v4(), &FetchFrom::Remote { name: "slow".into() }, false, &slow_channel).expect("the slow fetch runs");
            std::time::Instant::now()
        });
        let_it_start();
        let created = super::checkout::branch_create(&ops, &locks, &wt, Uuid::new_v4(), super::checkout::NewBranch { name: "later", at: "HEAD", checkout: false }, &test_channel());
        let created_at = std::time::Instant::now();
        (slow.join().unwrap(), (created, created_at))
    });

    let (created, created_at) = create;
    created.expect("the branch is created once the fetch is done, not refused");
    assert!(created_at > slow_done, "the create ran while the fetch held the lock");
}

#[test]
fn cancel_stops_a_running_fetch_and_frees_the_repo() {
    let (root, wt) = repo_with_worktree();
    with_slow_remote(&root, &wt, 60);
    let (ops, locks) = (GitOps::default(), StagingLocks::default());
    let (channel, events) = recording_channel();
    let op_id = Uuid::new_v4();

    let started = std::time::Instant::now();
    let result = std::thread::scope(|scope| {
        let running = scope.spawn(|| fetch(&ops, &locks, &wt, op_id, &FetchFrom::Remote { name: "slow".into() }, false, &channel));
        let_it_start();
        ops.cancel(op_id);
        running.join().unwrap()
    });

    assert_eq!(result, Err(GitError::Cancelled));
    assert!(started.elapsed() < std::time::Duration::from_secs(30), "cancel waited for the remote");
    wait_for(&events, |e| e["event"] == "failed" && e["error"]["kind"] == "cancelled");
    fetch_in(&wt, FetchFrom::Remote { name: "origin".into() }, false).expect("the repo's lock was let go");
}

#[test]
fn cancel_ends_an_operation_waiting_for_the_lock() {
    let (root, wt) = repo_with_worktree();
    with_slow_remote(&root, &wt, 3);
    let (ops, locks) = (GitOps::default(), StagingLocks::default());
    let (slow_channel, _) = recording_channel();
    let (waiting_channel, waiting_events) = recording_channel();
    let waiting_id = Uuid::new_v4();

    let waited = std::thread::scope(|scope| {
        let slow = scope.spawn(|| fetch(&ops, &locks, &wt, Uuid::new_v4(), &FetchFrom::Remote { name: "slow".into() }, false, &slow_channel));
        let_it_start();
        let waiting = scope.spawn(|| fetch(&ops, &locks, &wt, waiting_id, &FetchFrom::Remote { name: "origin".into() }, false, &waiting_channel));
        wait_for(&waiting_events, |e| e["event"] == "progress");
        ops.cancel(waiting_id);
        let waited = waiting.join().unwrap();
        slow.join().unwrap().expect("the slow fetch is unaffected");
        waited
    });

    assert_eq!(waited, Err(GitError::Cancelled));
}

#[test]
fn the_sync_status_counts_ahead_and_behind_as_of_the_last_fetch() {
    let (root, wt) = repo_with_worktree();
    behind_origin(&root, &wt);
    commit_file(&wt, "ours.txt", "ours\n");
    let before = crate::dates::now_ms();

    let outcome = fetch_in(&wt, FetchFrom::All, false).expect("the fetch runs");

    let sync = outcome.sync;
    assert_eq!(sync.branch.as_deref(), Some("feat"));
    assert_eq!(sync.upstream.as_deref(), Some("origin/feat"));
    assert_eq!((sync.ahead, sync.behind), (1, 1));
    let fetched = sync.fetched_at_ms.expect("FETCH_HEAD has a time");
    // Filesystem times can lag the clock by a few ms, and some round to the second.
    assert!(fetched >= before - 2_000 && fetched <= crate::dates::now_ms() + 2_000, "fetched {fetched}, started {before}");
}

#[test]
fn a_branch_with_no_upstream_has_no_counts() {
    let (_root, wt) = repo_with_worktree();

    let sync = super::remote_ops::sync_status(&wt).expect("the status reads");

    assert_eq!(sync.branch.as_deref(), Some("feat"));
    assert_eq!((sync.upstream, sync.ahead, sync.behind, sync.fetched_at_ms), (None, 0, 0, None));
}

/// What a failed `push --porcelain` printed: `stdout` its ref lines, `stderr` the rest.
fn push_output(stdout: &str, stderr: &str) -> super::op_runner::OpOutput {
    super::op_runner::OpOutput { stdout: stdout.into(), stderr: stderr.into(), combined: String::new() }
}

#[test]
fn the_porcelain_parser_reads_a_non_fast_forward_rejection() {
    for reason in ["non-fast-forward", "fetch first"] {
        let out = push_output(&format!("To ../origin.git\n!\trefs/heads/main:refs/heads/main\t[rejected] ({reason})\nDone\n"), "");
        assert_eq!(push_refusal(&out), Some(GitError::NonFastForward { r#ref: "refs/heads/main".into() }));
    }
}

#[test]
fn the_porcelain_parser_reads_a_remote_rejection_with_the_remotes_lines() {
    let out = push_output(
        "To ../origin.git\n!\trefs/heads/feat:refs/heads/main\t[remote rejected] (pre-receive hook declined)\nDone\n",
        "remote: <b>no</b> pushes today   \nremote: \nerror: failed to push some refs\n",
    );
    assert_eq!(
        push_refusal(&out),
        Some(GitError::RemoteRejected {
            r#ref: "refs/heads/main".into(),
            reason: "pre-receive hook declined".into(),
            remote_lines: vec!["<b>no</b> pushes today".into()],
        })
    );
}

#[test]
fn the_porcelain_parser_skips_accepted_refs_and_reports_the_first_rejected_one() {
    let out = push_output(
        "To ../origin.git\n \trefs/heads/a:refs/heads/a\t[up to date]\n!\trefs/heads/b:refs/heads/b\t[rejected] (already exists)\n",
        "",
    );
    assert_eq!(push_refusal(&out), Some(GitError::Other { stderr: "refs/heads/b: [rejected] (already exists)".into() }));
}

#[test]
fn with_no_rejected_ref_the_porcelain_parser_falls_back_to_the_network_refusals() {
    let unreachable = push_output("", "fatal: unable to access 'https://example.invalid/r.git/': Could not resolve host: example.invalid\n");
    assert_eq!(push_refusal(&unreachable), Some(GitError::Network));
    let auth = push_output("", "fatal: could not read Username for 'https://example.invalid': terminal prompts disabled\n");
    assert_eq!(push_refusal(&auth), Some(GitError::AuthFailed));
    assert_eq!(push_refusal(&push_output("", "Host key verification failed.\n")), Some(GitError::HostKeyUnknown));
    assert_eq!(push_refusal(&push_output("To ../origin.git\nDone\n", "error: something new\n")), None);
}
