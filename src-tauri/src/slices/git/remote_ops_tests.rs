//! Fetch, pull and push (#395) against throwaway repositories whose remote is a local bare repo
//! under the OS temp dir. Nothing here touches the network.

use std::path::{Path, PathBuf};

use uuid::Uuid;

use super::checkout_tests::{rev, test_channel};
use super::error::GitError;
use super::op_runner::GitOps;
use super::remote_ops::{fetch, lease_plan, pull, push, push_delete, push_refusal, push_tag, tag_remotes, with_repo_config_only, FetchFrom, LeasePlan, PullStrategy, PushTarget, RemoteOutcome};
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
        push(&GitOps::default(), &StagingLocks::default(), wt, Uuid::new_v4(), PushTarget { branch, remote, set_upstream, lease: None }, &test_channel())
    })
}

fn lease_push_in(wt: &Path, branch: &str, remote: Option<&str>, expected: &str) -> Result<RemoteOutcome, GitError> {
    with_repo_config_only(|| {
        let target = PushTarget { branch, remote, set_upstream: false, lease: Some(expected) };
        push(&GitOps::default(), &StagingLocks::default(), wt, Uuid::new_v4(), target, &test_channel())
    })
}

/// `wt` on `feat` with a commit of its own, after another clone pushed `theirs` more commits to
/// `origin/feat` and `wt` fetched them, so a plain push is refused as non-fast-forward. Returns
/// (the remote's tip, ours).
fn rejected_as_non_fast_forward(root: &Path, wt: &Path, theirs: usize) -> (String, String) {
    let bare = with_origin(root, wt);
    git(wt, &["push", "-q", "-u", "origin", "feat"]);
    let other = other_clone(root, &bare);
    git(&other, &["switch", "-q", "feat"]);
    let mut tip = String::new();
    for i in 0..theirs {
        tip = commit_file(&other, &format!("theirs{i}.txt"), "theirs\n");
    }
    git(&other, &["push", "-q", "origin", "feat"]);
    let ours = commit_file(wt, "ours.txt", "ours\n");
    git(wt, &["fetch", "-q", "origin"]);
    assert_eq!(push_in(wt, "feat", None, false), Err(GitError::NonFastForward { r#ref: "refs/heads/feat".into() }));
    (tip, ours)
}

#[test]
fn the_lease_plan_names_the_remote_tip_and_how_many_remote_commits_it_overwrites() {
    let (root, wt) = repo_with_worktree();
    let (tip, _ours) = rejected_as_non_fast_forward(&root, &wt, 2);

    let plan = lease_plan(&wt, "feat", None).expect("the plan reads");

    assert_eq!(
        plan,
        LeasePlan {
            remote: "origin".into(),
            remote_ref: "refs/heads/feat".into(),
            tracking: "origin/feat".into(),
            expected_sha: tip,
            overwrites: 2,
            default_branch: Some("main".into()),
        }
    );
}

#[test]
fn the_lease_plan_reads_the_default_branch_from_the_remotes_head() {
    let (root, wt) = repo_with_worktree();
    rejected_as_non_fast_forward(&root, &wt, 1);
    git(&wt, &["remote", "set-head", "origin", "feat"]);
    assert_eq!(lease_plan(&wt, "feat", None).expect("the plan reads").default_branch.as_deref(), Some("feat"));

    git(&wt, &["remote", "set-head", "origin", "--delete"]);
    assert_eq!(lease_plan(&wt, "feat", None).expect("the plan reads").default_branch, None);
}

#[test]
fn the_lease_refuses_once_the_remote_moved_and_the_remote_keeps_its_commits() {
    let (root, wt) = repo_with_worktree();
    rejected_as_non_fast_forward(&root, &wt, 1);
    let plan = lease_plan(&wt, "feat", None).expect("the plan reads");
    let bare = root.join("origin.git");
    let other = root.join("other");
    let moved = commit_file(&other, "later.txt", "later\n");
    git(&other, &["push", "-q", "origin", "feat"]);

    assert_eq!(lease_push_in(&wt, "feat", None, &plan.expected_sha), Err(GitError::LeaseRefused { r#ref: "refs/heads/feat".into() }));
    assert_eq!(rev(&bare, "refs/heads/feat"), moved, "the remote kept the commit pushed after the fetch");
}

#[test]
fn the_lease_refuses_when_a_fetch_moved_the_remote_tracking_branch_since_the_confirm() {
    let (root, wt) = repo_with_worktree();
    rejected_as_non_fast_forward(&root, &wt, 1);
    let plan = lease_plan(&wt, "feat", None).expect("the plan reads");
    let other = root.join("other");
    let moved = commit_file(&other, "later.txt", "later\n");
    git(&other, &["push", "-q", "origin", "feat"]);
    git(&wt, &["fetch", "-q", "origin"]);

    assert_eq!(lease_push_in(&wt, "feat", None, &plan.expected_sha), Err(GitError::LeaseRefused { r#ref: "refs/heads/feat".into() }));
    assert_eq!(rev(&root.join("origin.git"), "refs/heads/feat"), moved);
}

#[test]
fn a_lease_that_is_not_a_full_commit_id_is_refused_before_git_runs() {
    let (root, wt) = repo_with_worktree();
    let (tip, _ours) = rejected_as_non_fast_forward(&root, &wt, 1);

    for lease in ["--force", "HEAD", &tip[..12]] {
        assert!(matches!(lease_push_in(&wt, "feat", None, lease), Err(GitError::Other { .. })), "{lease}");
    }
    assert_eq!(rev(&root.join("origin.git"), "refs/heads/feat"), tip);
}

#[test]
fn the_porcelain_parser_reads_a_stale_lease() {
    let out = push_output("To ../origin.git\n!\trefs/heads/feat:refs/heads/feat\t[rejected] (stale info)\nDone\n", "");
    assert_eq!(push_refusal(&out), Some(GitError::LeaseRefused { r#ref: "refs/heads/feat".into() }));
}

#[test]
fn a_force_push_with_the_lease_overwrites_the_remote_branch() {
    let (root, wt) = repo_with_worktree();
    let (_tip, ours) = rejected_as_non_fast_forward(&root, &wt, 1);
    let plan = lease_plan(&wt, "feat", None).expect("the plan reads");

    let outcome = lease_push_in(&wt, "feat", None, &plan.expected_sha).expect("the lease holds");

    assert_eq!(rev(&root.join("origin.git"), "refs/heads/feat"), ours);
    assert!(outcome.refs.refs.iter().any(|r| r.name == "origin/feat" && r.oid == ours));
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

/// How long a test waits for something another thread or process should do. Generous, so a
/// busy machine only makes the wait longer, never fails it.
const PATIENCE: std::time::Duration = std::time::Duration::from_secs(60);

/// The remote `slow` that [`with_gated_remote`] adds. Its upload-pack, once a fetch starts it,
/// says so and then serves only when the test lets it, so the fetch holds the repo's lock from
/// [`Gate::wait_until_started`] until [`Gate::release`], or until the upload-pack gives up after
/// at least [`PATIENCE`].
struct Gate {
    started: PathBuf,
    release: PathBuf,
}

impl Gate {
    /// Waits until a fetch from `slow` is running, and so holds the repo's lock, which a fetch
    /// takes before it starts git.
    fn wait_until_started(&self) {
        poll_until(|| self.started.exists(), || "the fetch from slow never started".to_string());
    }

    /// Lets the waiting upload-pack serve, so the fetch from `slow` finishes. Returns the instant it
    /// released the gate.
    fn release(&self) -> std::time::Instant {
        std::fs::write(&self.release, "").unwrap();
        std::time::Instant::now()
    }
}

impl Drop for Gate {
    /// A test that fails or cancels leaves no upload-pack waiting forever.
    fn drop(&mut self) {
        let _ = std::fs::write(&self.release, "");
    }
}

/// `wt`'s repo with a remote `slow` whose upload-pack waits on the returned [`Gate`].
fn with_gated_remote(root: &Path, wt: &Path) -> Gate {
    let bare = with_origin(root, wt);
    git(wt, &["remote", "add", "slow", &bare.to_string_lossy()]);
    let gate = Gate { started: root.join("slow-started"), release: root.join("slow-release") };
    // Git for Windows' shell reads forward slashes; a temp dir path has no quote in it. The wait
    // gives up after at least `PATIENCE`, so a fetch that Cancel failed to stop ends with Ok
    // rather than hanging the test.
    let sh = |p: &Path| p.to_string_lossy().replace('\\', "/");
    let ticks = PATIENCE.as_millis() / 50;
    let upload_pack = format!(
        "touch '{}'; i=0; while [ ! -e '{}' ] && [ $i -lt {ticks} ]; do sleep 0.05; i=$((i+1)); done; git-upload-pack",
        sh(&gate.started),
        sh(&gate.release)
    );
    git(wt, &["config", "remote.slow.uploadpack", &upload_pack]);
    gate
}

/// Waits until `events` holds one matching `want`.
fn wait_for(events: &std::sync::Mutex<Vec<serde_json::Value>>, want: impl Fn(&serde_json::Value) -> bool) {
    poll_until(|| events.lock().unwrap().iter().any(&want), || format!("never saw it in {:?}", events.lock().unwrap()));
}

/// Polls `done` until it holds, and fails with `what` once [`PATIENCE`] has passed.
fn poll_until(done: impl Fn() -> bool, what: impl Fn() -> String) {
    let since = std::time::Instant::now();
    while !done() {
        assert!(since.elapsed() < PATIENCE, "{}", what());
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
}

/// Whether `e` is the progress event of an operation waiting for the repo's lock.
fn is_waiting(e: &serde_json::Value) -> bool {
    e["event"] == "progress" && e["phase"] == super::repo_lock::WAITING_PHASE
}

#[test]
fn the_repo_lock_runs_one_operation_per_repo_and_the_second_waits_for_the_first() {
    let (root, wt) = repo_with_worktree();
    let gate = with_gated_remote(&root, &wt);
    let main_checkout = root.join("repo");
    let (ops, locks) = (GitOps::default(), StagingLocks::default());
    let (slow_channel, _) = recording_channel();
    let (second_channel, second_events) = recording_channel();

    let (released, second_done) = std::thread::scope(|scope| {
        let slow = scope.spawn(|| {
            fetch(&ops, &locks, &wt, Uuid::new_v4(), &FetchFrom::Remote { name: "slow".into() }, false, &slow_channel).expect("the slow fetch runs");
        });
        gate.wait_until_started();
        // From the repo's other worktree: the lock is per repo, not per worktree.
        let second = scope.spawn(|| {
            fetch(&ops, &locks, &main_checkout, Uuid::new_v4(), &FetchFrom::Remote { name: "origin".into() }, false, &second_channel).expect("the second fetch runs");
            std::time::Instant::now()
        });
        wait_for(&second_events, is_waiting);
        assert!(!second.is_finished(), "the second fetch finished while the first held the lock");
        let released = gate.release();
        slow.join().unwrap();
        (released, second.join().unwrap())
    });

    assert!(second_done > released, "the second fetch finished before the first let go");
}

#[test]
fn a_local_ref_operation_waits_behind_a_running_fetch() {
    let (root, wt) = repo_with_worktree();
    let gate = with_gated_remote(&root, &wt);
    let (ops, locks) = (GitOps::default(), StagingLocks::default());
    let (slow_channel, _) = recording_channel();
    let (create_channel, create_events) = recording_channel();
    let later_exists = || {
        let out = crate::spawn::hidden_command("git").current_dir(&wt).args(["rev-parse", "-q", "--verify", "refs/heads/later"]).output().unwrap();
        out.status.success()
    };

    let (released, (created, created_at)) = std::thread::scope(|scope| {
        let slow = scope.spawn(|| {
            fetch(&ops, &locks, &wt, Uuid::new_v4(), &FetchFrom::Remote { name: "slow".into() }, false, &slow_channel).expect("the slow fetch runs");
        });
        gate.wait_until_started();
        let create = scope.spawn(|| {
            let created = super::checkout::branch_create(&ops, &locks, &wt, Uuid::new_v4(), super::checkout::NewBranch { name: "later", at: "HEAD", checkout: false }, &create_channel);
            (created, std::time::Instant::now())
        });
        wait_for(&create_events, is_waiting);
        assert!(!create.is_finished() && !later_exists(), "the create ran while the fetch held the lock");
        let released = gate.release();
        slow.join().unwrap();
        (released, create.join().unwrap())
    });

    created.expect("the branch is created once the fetch is done, not refused");
    assert!(created_at > released, "the create finished before the fetch let go");
    assert!(later_exists(), "the branch was created");
}

#[test]
fn cancel_stops_a_running_fetch_and_frees_the_repo() {
    let (root, wt) = repo_with_worktree();
    // Never released, so the fetch ends early only by Cancel; a fetch the gate let go returns Ok.
    let gate = with_gated_remote(&root, &wt);
    let (ops, locks) = (GitOps::default(), StagingLocks::default());
    let (channel, events) = recording_channel();
    let op_id = Uuid::new_v4();

    let result = std::thread::scope(|scope| {
        let running = scope.spawn(|| fetch(&ops, &locks, &wt, op_id, &FetchFrom::Remote { name: "slow".into() }, false, &channel));
        gate.wait_until_started();
        ops.cancel(op_id);
        running.join().unwrap()
    });

    assert_eq!(result, Err(GitError::Cancelled));
    wait_for(&events, |e| e["event"] == "failed" && e["error"]["kind"] == "cancelled");
    fetch_in(&wt, FetchFrom::Remote { name: "origin".into() }, false).expect("the repo's lock was let go");
}

#[test]
fn cancel_ends_an_operation_waiting_for_the_lock() {
    let (root, wt) = repo_with_worktree();
    let gate = with_gated_remote(&root, &wt);
    let (ops, locks) = (GitOps::default(), StagingLocks::default());
    let (slow_channel, _) = recording_channel();
    let (waiting_channel, waiting_events) = recording_channel();
    let waiting_id = Uuid::new_v4();

    let waited = std::thread::scope(|scope| {
        let slow = scope.spawn(|| fetch(&ops, &locks, &wt, Uuid::new_v4(), &FetchFrom::Remote { name: "slow".into() }, false, &slow_channel));
        gate.wait_until_started();
        let waiting = scope.spawn(|| fetch(&ops, &locks, &wt, waiting_id, &FetchFrom::Remote { name: "origin".into() }, false, &waiting_channel));
        wait_for(&waiting_events, is_waiting);
        ops.cancel(waiting_id);
        // The slow fetch holds the lock until the gate opens, so only Cancel can end this wait.
        let waited = waiting.join().unwrap();
        gate.release();
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
    assert_eq!(sync.remotes, vec!["origin".to_string()]);
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
    assert!(sync.remotes.is_empty());
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

/// Makes the annotated tag `name` at HEAD in `dir`, unsigned whatever git config says.
fn annotated_tag(dir: &Path, name: &str) {
    git(dir, &["-c", "tag.gpgSign=false", "tag", "-a", "-m", name, "--", name]);
}

fn remote_has(bare: &Path, full_ref: &str) -> bool {
    !git(bare, &["for-each-ref", "--format=%(refname)", full_ref]).trim().is_empty()
}

/// `wt` on `feat` tracking `origin/feat`, with an unpushed commit that the annotated tag `v1` is on.
fn tagged_unpushed_commit(root: &Path, wt: &Path) -> PathBuf {
    let bare = with_origin(root, wt);
    git(wt, &["push", "-q", "-u", "origin", "feat"]);
    commit_file(wt, "ours.txt", "ours\n");
    annotated_tag(wt, "v1");
    bare
}

#[test]
fn a_push_sends_no_tags_unless_push_follow_tags_is_set() {
    let (root, wt) = repo_with_worktree();
    let bare = tagged_unpushed_commit(&root, &wt);

    push_in(&wt, "feat", None, false).expect("the push runs");

    assert_eq!(rev(&bare, "refs/heads/feat"), rev(&wt, "feat"));
    assert!(!remote_has(&bare, "refs/tags/v1"), "the tag stayed local");
}

#[test]
fn with_push_follow_tags_a_push_sends_the_annotated_tags_on_what_it_pushes() {
    let (root, wt) = repo_with_worktree();
    let bare = tagged_unpushed_commit(&root, &wt);
    git(&wt, &["config", "--local", "push.followTags", "true"]);

    push_in(&wt, "feat", None, false).expect("the push runs");

    assert!(remote_has(&bare, "refs/tags/v1"), "push.followTags sent the tag");
}

fn push_tag_in(wt: &Path, remote: &str, name: &str) -> Result<RemoteOutcome, GitError> {
    with_repo_config_only(|| push_tag(&GitOps::default(), &StagingLocks::default(), wt, Uuid::new_v4(), remote, name, &test_channel()))
}

#[test]
fn pushing_a_tag_sends_that_one_tag_and_no_other_even_with_push_follow_tags() {
    let (root, wt) = repo_with_worktree();
    let bare = tagged_unpushed_commit(&root, &wt);
    commit_file(&wt, "later.txt", "later\n");
    annotated_tag(&wt, "v2");
    git(&wt, &["config", "--local", "push.followTags", "true"]);

    push_tag_in(&wt, "origin", "v2").expect("the tag push runs");

    assert_eq!(rev(&bare, "refs/tags/v2"), rev(&wt, "refs/tags/v2"));
    assert!(!remote_has(&bare, "refs/tags/v1"), "v1, on a commit v2 reaches, stayed local");
    assert_ne!(rev(&bare, "refs/heads/feat"), rev(&wt, "feat"), "no branch moved");
}

#[test]
fn pushing_a_tag_refuses_a_name_or_remote_that_could_read_as_an_option() {
    let (root, wt) = repo_with_worktree();
    let bare = tagged_unpushed_commit(&root, &wt);

    assert!(matches!(push_tag_in(&wt, "origin", "--mirror"), Err(GitError::InvalidRefName { .. })));
    assert!(matches!(push_tag_in(&wt, "origin", "missing"), Err(GitError::InvalidRefName { .. })));
    assert!(matches!(push_tag_in(&wt, "--receive-pack=evil", "v1"), Err(GitError::Other { .. })));
    assert!(!remote_has(&bare, "refs/tags/v1"));
}

fn push_delete_in(wt: &Path, remote: &str, full_ref: &str) -> Result<RemoteOutcome, GitError> {
    with_repo_config_only(|| push_delete(&GitOps::default(), &StagingLocks::default(), wt, Uuid::new_v4(), remote, full_ref, &test_channel()))
}

#[test]
fn deleting_a_remote_branch_removes_it_from_the_remote_and_its_remote_tracking_branch() {
    let (root, wt) = repo_with_worktree();
    let bare = with_origin(&root, &wt);

    let outcome = push_delete_in(&wt, "origin", "refs/heads/topic").expect("the delete runs");

    assert!(!remote_has(&bare, "refs/heads/topic"));
    assert!(remote_has(&bare, "refs/heads/main"), "only that branch went");
    assert!(!outcome.refs.refs.iter().any(|r| r.name == "origin/topic"), "the refs no longer show origin/topic");
}

#[test]
fn deleting_a_remote_tag_removes_it_from_the_remote_and_leaves_the_local_tag() {
    let (root, wt) = repo_with_worktree();
    let bare = with_origin(&root, &wt);
    annotated_tag(&wt, "v1");
    git(&wt, &["push", "-q", "origin", "refs/tags/v1"]);

    push_delete_in(&wt, "origin", "refs/tags/v1").expect("the delete runs");

    assert!(!remote_has(&bare, "refs/tags/v1"));
    assert!(!rev(&wt, "refs/tags/v1").is_empty(), "the local tag stays");
}

#[test]
fn a_remote_delete_refuses_anything_but_one_branch_or_tag_on_a_known_remote() {
    let (root, wt) = repo_with_worktree();
    let bare = with_origin(&root, &wt);

    for full_ref in ["--mirror", "topic", "refs/remotes/origin/topic", "refs/heads/*", "refs/heads/", "refs/heads/a..b", "refs/heads/-x"] {
        assert!(matches!(push_delete_in(&wt, "origin", full_ref), Err(GitError::InvalidRefName { .. })), "{full_ref}");
    }
    assert!(matches!(push_delete_in(&wt, "-origin", "refs/heads/topic"), Err(GitError::Other { .. })));
    assert!(matches!(push_delete_in(&wt, "elsewhere", "refs/heads/topic"), Err(GitError::Other { .. })));
    assert!(remote_has(&bare, "refs/heads/topic"), "nothing was deleted");
}

#[test]
fn the_remotes_with_a_tag_are_those_whose_refs_have_it() {
    let (root, wt) = repo_with_worktree();
    with_origin(&root, &wt);
    let fork = root.join("fork.git");
    git(&root, &["init", "-q", "--bare", "-b", "main", &fork.to_string_lossy()]);
    git(&wt, &["remote", "add", "fork", &fork.to_string_lossy()]);
    annotated_tag(&wt, "v1");
    git(&wt, &["push", "-q", "origin", "refs/tags/v1"]);
    git(&wt, &["push", "-q", "fork", "main"]);

    let have = with_repo_config_only(|| tag_remotes(&GitOps::default(), &StagingLocks::default(), &wt, Uuid::new_v4(), "v1", &test_channel()));

    assert_eq!(have, Ok(vec!["origin".to_string()]));
}
