//! Committing from the Topos composer (#366, #388), against throwaway repositories with a linked
//! worktree, built with the system git.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde_json::Value;
use tauri::ipc::{Channel, InvokeResponseBody};
use uuid::Uuid;

use super::commit::{commit, read_commit_context, CommitRequest, Operation};
use super::error::GitError;
use super::op_runner::{GitOps, OpEvent};
use super::staging::StagingLocks;
use super::staging_tests::{git, repo_with_worktree};

/// A channel that keeps every event it is sent, as the JSON the frontend would receive.
fn test_channel() -> (Channel<OpEvent>, Arc<Mutex<Vec<Value>>>) {
    let events = Arc::new(Mutex::new(Vec::new()));
    let sink = events.clone();
    let channel = Channel::new(move |body| {
        let json = match body {
            InvokeResponseBody::Json(s) => s,
            InvokeResponseBody::Raw(bytes) => String::from_utf8(bytes).unwrap(),
        };
        sink.lock().unwrap().push(serde_json::from_str(&json).unwrap());
        Ok(())
    });
    (channel, events)
}

fn request(message: &str) -> CommitRequest {
    CommitRequest { message: message.into(), amend: false, signoff: false }
}

/// Commits `req` in `wt` with fresh ops, slots and channel.
fn commit_in(wt: &Path, req: &CommitRequest) -> Result<String, GitError> {
    let (channel, _events) = test_channel();
    commit(&GitOps::default(), &StagingLocks::default(), wt, Uuid::new_v4(), req, &channel)
}

fn head_message(wt: &Path) -> String {
    git(wt, &["log", "-1", "--format=%B"])
}

fn head_oid(wt: &Path) -> String {
    git(wt, &["rev-parse", "HEAD"]).trim().to_string()
}

/// A worktree with `README.md` changed and staged.
fn staged_change() -> (PathBuf, PathBuf) {
    let (root, wt) = repo_with_worktree();
    std::fs::write(wt.join("README.md"), "changed\n").unwrap();
    git(&wt, &["add", "README.md"]);
    (root, wt)
}

#[test]
fn a_commit_records_the_staged_change_with_the_message_and_returns_the_new_head() {
    let (root, wt) = staged_change();
    let before = head_oid(&wt);

    let new_head = commit_in(&wt, &request("  Change the readme\n\n\n\nWhy it changed.  \n\n")).unwrap();

    assert_eq!(new_head, head_oid(&wt));
    assert_ne!(new_head, before);
    assert_eq!(git(&wt, &["rev-parse", "HEAD^"]).trim(), before);
    // `--cleanup=whitespace`: trailing spaces and runs of blank lines go, leading text stays.
    assert_eq!(head_message(&wt), "  Change the readme\n\nWhy it changed.\n\n");
    assert_eq!(git(&wt, &["diff", "--cached", "--name-only"]), "");
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn amend_replaces_head_with_the_new_message_even_with_nothing_staged() {
    let (root, wt) = repo_with_worktree();
    let before = head_oid(&wt);

    let new_head = commit_in(&wt, &CommitRequest { message: "Reworded".into(), amend: true, signoff: false }).unwrap();

    assert_ne!(new_head, before);
    assert_eq!(head_message(&wt), "Reworded\n\n");
    // The amend replaced HEAD rather than adding a commit on it: still one commit on the branch.
    assert_eq!(git(&wt, &["rev-list", "--count", "HEAD"]).trim(), "1");
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn sign_off_adds_the_committers_signed_off_by_trailer_only_when_asked() {
    let (root, wt) = staged_change();
    commit_in(&wt, &CommitRequest { message: "Signed".into(), amend: false, signoff: true }).unwrap();
    assert_eq!(head_message(&wt), "Signed\n\nSigned-off-by: Quay Test <quay@example.invalid>\n\n");

    std::fs::write(wt.join("README.md"), "again\n").unwrap();
    git(&wt, &["add", "README.md"]);
    commit_in(&wt, &request("Unsigned")).unwrap();
    assert_eq!(head_message(&wt), "Unsigned\n\n");
    let _ = std::fs::remove_dir_all(root);
}

/// Writes `body` as the hook `name` in a hooks folder of its own under `root`, and points the
/// worktree's repo at it.
fn install_hook(root: &Path, wt: &Path, name: &str, body: &str) {
    let dir = root.join("hooks");
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join(name);
    std::fs::write(&path, body).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    git(wt, &["config", "core.hooksPath", &dir.to_string_lossy().replace('\\', "/")]);
}

/// The `chunk` of every `output` event, joined.
fn streamed_output(events: &[Value]) -> String {
    events.iter().filter(|e| e["event"] == "output").map(|e| e["chunk"].as_str().unwrap()).collect()
}

#[test]
fn a_failing_pre_commit_hook_is_hook_failed_with_its_output_and_commits_nothing() {
    let (root, wt) = staged_change();
    install_hook(&root, &wt, "pre-commit", "#!/bin/sh\necho 'lint: 2 problems'\necho 'src/lib.rs: bad' >&2\nexit 1\n");
    let before = head_oid(&wt);

    let (channel, events) = test_channel();
    let result = commit(&GitOps::default(), &StagingLocks::default(), &wt, Uuid::new_v4(), &request("Blocked"), &channel);

    let expected = GitError::HookFailed { hook: "pre-commit".into(), output: "lint: 2 problems\nsrc/lib.rs: bad\n".into() };
    assert_eq!(result, Err(expected.clone()));
    assert_eq!(head_oid(&wt), before);
    assert_eq!(git(&wt, &["diff", "--cached", "--name-only"]), "README.md\n", "the staged change stays staged");
    let events = events.lock().unwrap();
    assert_eq!(streamed_output(&events), "lint: 2 problems\nsrc/lib.rs: bad\n");
    assert_eq!(
        events.last(),
        Some(&serde_json::json!({ "event": "failed", "error": { "kind": "hookFailed", "hook": "pre-commit", "output": "lint: 2 problems\nsrc/lib.rs: bad\n" } }))
    );
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn hook_output_is_capped_at_64_kib_both_as_it_streams_and_in_hook_failed() {
    let (root, wt) = staged_change();
    // About 170 KB of output, then a failure.
    install_hook(&root, &wt, "pre-commit", "#!/bin/sh\nseq 1 30000\necho last-line\nexit 1\n");

    let (channel, events) = test_channel();
    let err = commit(&GitOps::default(), &StagingLocks::default(), &wt, Uuid::new_v4(), &request("Loud"), &channel).unwrap_err();

    let GitError::HookFailed { output, .. } = err else { panic!("expected HookFailed, got {err:?}") };
    assert!(output.len() <= 64 * 1024, "HookFailed kept {} bytes", output.len());
    assert!(output.len() > 60 * 1024, "HookFailed kept only {} bytes", output.len());
    assert!(output.ends_with("29999\n30000\nlast-line\n"), "the newest output is kept");

    let streamed = streamed_output(&events.lock().unwrap());
    let notice = "\n[Quay: output past 64 KiB is not shown]\n";
    assert!(streamed.starts_with("1\n2\n3\n"), "the oldest output streams first");
    assert!(streamed.ends_with(notice), "the stream ends in the notice: {:?}", &streamed[streamed.len().saturating_sub(80)..]);
    assert_eq!(streamed.len(), 64 * 1024 + notice.len());
    let _ = std::fs::remove_dir_all(root);
}

/// Whether a process with this OS process id is running.
fn process_alive(pid: u32) -> bool {
    if cfg!(windows) {
        let filter = format!("PID eq {pid}");
        let out = crate::spawn::hidden_command("tasklist").args(["/FI", &filter, "/NH", "/FO", "CSV"]).output().unwrap();
        String::from_utf8_lossy(&out.stdout).contains(&format!("\"{pid}\""))
    } else {
        crate::spawn::hidden_command("kill").args(["-0", &pid.to_string()]).status().unwrap().success()
    }
}

#[test]
fn cancel_stops_a_long_running_hook_and_leaves_the_worktree_ready_to_commit() {
    let _timed = super::test_load::timed();
    let (root, wt) = staged_change();
    // The hook starts `sleep` and prints its OS process id, then waits on it.
    install_hook(
        &root,
        &wt,
        "pre-commit",
        "#!/bin/sh\nsleep 120 &\nif [ -f /proc/$!/winpid ]; then cat /proc/$!/winpid; else echo $!; fi\nwait\n",
    );
    let before = head_oid(&wt);
    let ops = GitOps::default();
    let locks = StagingLocks::default();
    let op_id = Uuid::new_v4();
    let (channel, events) = test_channel();

    std::thread::scope(|scope| {
        let running = scope.spawn(|| commit(&ops, &locks, &wt, op_id, &request("Slow"), &channel));
        let started = std::time::Instant::now();
        let sleep_pid = loop {
            if let Ok(pid) = streamed_output(&events.lock().unwrap()).trim().parse::<u32>() {
                break pid;
            }
            assert!(started.elapsed() < std::time::Duration::from_secs(20), "the hook never started");
            std::thread::sleep(std::time::Duration::from_millis(50));
        };
        // While the hook runs, the worktree's staging slot is taken.
        assert_eq!(locks.begin(&wt).err(), Some(GitError::StagingBusy));

        ops.cancel(op_id);
        assert_eq!(running.join().unwrap(), Err(GitError::Cancelled));
        assert!(started.elapsed() < std::time::Duration::from_secs(60), "Cancel waited for the hook");
        assert!(!process_alive(sleep_pid), "the hook's sleep {sleep_pid} outlived Cancel");
    });
    assert_eq!(events.lock().unwrap().last(), Some(&serde_json::json!({ "event": "failed", "error": { "kind": "cancelled" } })));
    assert_eq!(head_oid(&wt), before);

    // git let go of index.lock, so the next commit goes through.
    assert!(!super::staging_tests::index_lock(&wt).exists(), "Cancel left index.lock behind");
    git(&wt, &["config", "core.hooksPath", ".git/no-hooks"]);
    commit(&ops, &locks, &wt, Uuid::new_v4(), &request("After cancel"), &test_channel().0).unwrap();
    assert_eq!(head_message(&wt), "After cancel\n\n");
    let _ = std::fs::remove_dir_all(root);
}

/// A worktree on `feat` mid-merge of `main`, stopped on a conflict in README.md that is then
/// resolved and staged, so only the merge commit is left to make.
fn resolved_merge() -> (PathBuf, PathBuf) {
    let (root, wt) = repo_with_worktree();
    let repo = root.join("repo");
    std::fs::write(repo.join("README.md"), "main side\n").unwrap();
    git(&repo, &["commit", "-q", "-am", "main change"]);
    std::fs::write(wt.join("README.md"), "feat side\n").unwrap();
    git(&wt, &["commit", "-q", "-am", "feat change"]);
    let out = crate::spawn::hidden_command("git").current_dir(&wt).args(["merge", "main"]).output().unwrap();
    assert!(!out.status.success(), "the merge should stop on its conflict");
    std::fs::write(wt.join("README.md"), "both sides\n").unwrap();
    git(&wt, &["add", "README.md"]);
    (root, wt)
}

#[test]
fn in_a_merge_the_context_prefills_merge_msg_and_committing_it_concludes_the_merge() {
    let (root, wt) = resolved_merge();

    let context = read_commit_context(&wt).unwrap();
    assert_eq!(context.operation, Operation::Merge);
    // MERGE_MSG's commented conflict list is left out of the prefill.
    assert_eq!(context.merge_message.as_deref(), Some("Merge branch 'main' into feat\n"));
    assert_eq!(context.branch.as_deref(), Some("feat"));

    commit_in(&wt, &request(context.merge_message.as_deref().unwrap())).unwrap();
    assert_eq!(head_message(&wt), "Merge branch 'main' into feat\n\n");
    assert_eq!(git(&wt, &["rev-list", "--parents", "-1", "HEAD"]).split_whitespace().count(), 3, "a merge commit has two parents");
    assert_eq!(read_commit_context(&wt).unwrap().operation, Operation::None);
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn the_context_gives_amend_heads_message_and_says_when_head_is_on_its_upstream() {
    let (root, wt) = repo_with_worktree();
    let no_upstream = read_commit_context(&wt).unwrap().head.unwrap();
    assert_eq!(no_upstream.message, "init\n");
    assert_eq!(no_upstream.oid, head_oid(&wt));
    assert!(!no_upstream.on_upstream, "with no upstream, HEAD isn't on one");

    // `feat` starts where `main` is, so with `main` as its upstream HEAD is already there.
    git(&wt, &["branch", "--set-upstream-to=main"]);
    assert!(read_commit_context(&wt).unwrap().head.unwrap().on_upstream);

    std::fs::write(wt.join("README.md"), "changed\n").unwrap();
    git(&wt, &["commit", "-q", "-am", "Local only\n\nWith a body."]);
    let ahead = read_commit_context(&wt).unwrap().head.unwrap();
    assert_eq!(ahead.message, "Local only\n\nWith a body.\n");
    assert!(!ahead.on_upstream, "a commit not yet on the upstream");
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn the_context_names_a_detached_head_and_each_operation_the_banner_continues() {
    let (root, wt) = repo_with_worktree();
    let context = read_commit_context(&wt).unwrap();
    assert_eq!((context.operation, context.branch.as_deref(), context.merge_message), (Operation::None, Some("feat"), None));

    git(&wt, &["checkout", "-q", "--detach"]);
    let detached = read_commit_context(&wt).unwrap();
    assert_eq!(detached.branch, None);
    assert!(detached.head.is_some());

    // The per-worktree git dir holds each operation's state.
    let git_dir = PathBuf::from(git(&wt, &["rev-parse", "--absolute-git-dir"]).trim());
    let oid = head_oid(&wt);
    for (state, operation) in [("CHERRY_PICK_HEAD", Operation::CherryPick), ("REVERT_HEAD", Operation::Revert)] {
        std::fs::write(git_dir.join(state), format!("{oid}\n")).unwrap();
        assert_eq!(read_commit_context(&wt).unwrap().operation, operation, "{state}");
        std::fs::remove_file(git_dir.join(state)).unwrap();
    }
    std::fs::create_dir_all(git_dir.join("rebase-merge")).unwrap();
    assert_eq!(read_commit_context(&wt).unwrap().operation, Operation::Rebase);
    let _ = std::fs::remove_dir_all(root);
}

/// Names the worktree [`commit_with_the_inherited_env`] commits in, when this test binary runs it
/// as a child process.
const CHILD_WORKTREE_VAR: &str = "QUAY_TEST_TOPOS_COMMIT_WORKTREE";

/// Commits in the worktree [`CHILD_WORKTREE_VAR`] names through `commit`, with whatever env this
/// process was started with. It does nothing in a normal run, where the variable is unset.
#[test]
#[ignore = "run as a child process by a_topos_commit_carries_no_quay_agent_trailer_even_from_an_agent_terminals_env"]
fn commit_with_the_inherited_env() {
    let Some(wt) = std::env::var_os(CHILD_WORKTREE_VAR) else { return };
    commit_in(Path::new(&wt), &request("From Topos")).unwrap();
}

fn stamps(message: &str) -> Vec<&str> {
    message.lines().filter(|l| l.starts_with("Quay-Agent:")).collect()
}

#[test]
fn a_topos_commit_carries_no_quay_agent_trailer_even_from_an_agent_terminals_env() {
    use crate::slices::pty::commit_stamp::{install_hooks, stamping_env};
    use crate::slices::pty::models::RunKind;

    let (root, wt) = staged_change();
    // Stamping on: the env an agent terminal gets, as if Quay itself had been started from one.
    let hooks = install_hooks(&root.join("app-data")).unwrap();
    let env = stamping_env(None, &hooks, RunKind::Claude).unwrap();

    // The env is live: a plain git under it stamps the commit.
    let mut plain = crate::spawn::hidden_command("git");
    plain.current_dir(&wt).env_remove("GIT_CONFIG_COUNT").envs(env.iter().map(|(k, v)| (k, v)));
    let out = plain.args(["commit", "-q", "-m", "From an agent"]).output().unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    assert_eq!(stamps(&head_message(&wt)), ["Quay-Agent: claude"]);

    // A Topos commit, from a process with the same env, is a human commit.
    std::fs::write(wt.join("README.md"), "from topos\n").unwrap();
    git(&wt, &["add", "README.md"]);
    let mut child = crate::spawn::hidden_command(std::env::current_exe().unwrap());
    child
        .args(["--exact", "slices::git::commit_tests::commit_with_the_inherited_env", "--ignored", "--test-threads=1"])
        .env_remove("GIT_CONFIG_COUNT")
        .envs(env.iter().map(|(k, v)| (k, v)))
        .env(CHILD_WORKTREE_VAR, &wt);
    let out = child.output().unwrap();
    let printed = String::from_utf8_lossy(&out.stdout);
    assert!(out.status.success() && printed.contains("1 passed"), "the child commit failed:\n{printed}\n{}", String::from_utf8_lossy(&out.stderr));
    assert_eq!(head_message(&wt), "From Topos\n\n");
    assert!(stamps(&head_message(&wt)).is_empty());
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn a_failure_that_is_not_a_hook_is_other_with_gits_words() {
    let (root, wt) = repo_with_worktree();
    let err = commit_in(&wt, &request("Nothing staged")).unwrap_err();
    match err {
        GitError::Other { stderr } => assert!(stderr.contains("nothing to commit") || stderr.contains("no changes added"), "{stderr}"),
        other => panic!("expected Other, got {other:?}"),
    }
    let _ = std::fs::remove_dir_all(root);
}
