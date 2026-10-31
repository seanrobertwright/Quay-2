//! The operation banner's backend (#352, #389) against throwaway repositories with a linked
//! worktree, built with the system git: what each operation's state files say, and Continue, Skip
//! and Abort run on them.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde_json::{Value, json};
use tauri::ipc::{Channel, InvokeResponseBody};
use uuid::Uuid;

use super::commit::Operation;
use super::error::GitError;
use super::op_runner::{GitOps, OpEvent};
use super::operation::{OpOutcome, op_abort, op_continue, op_skip, read_operation_state};
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

/// Continues `expected` in `wt` with `message`, with fresh ops, slots and channel.
fn continue_in(wt: &Path, expected: Operation, message: Option<&str>) -> Result<OpOutcome, GitError> {
    op_continue(&GitOps::default(), &StagingLocks::default(), wt, Uuid::new_v4(), expected, message, &test_channel().0)
}

/// Resolves README.md in `wt` to `text` and stages it.
fn resolve(wt: &Path, text: &str) {
    std::fs::write(wt.join("README.md"), text).unwrap();
    git(wt, &["add", "README.md"]);
}

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


#[test]
fn continue_concludes_a_resolved_merge_with_the_edited_message_and_no_editor() {
    let (root, wt) = diverged("Main change", "Feat change");
    // An editor that fails: Continue must never open one.
    git(&wt, &["config", "core.editor", "false"]);
    git_stops(&wt, &["merge", "main"]);
    resolve(&wt, "both sides\n");

    let outcome = continue_in(&wt, Operation::Merge, Some("Merge main, resolved by hand\n")).unwrap();

    assert_eq!(outcome.head.as_deref(), Some(git(&wt, &["rev-parse", "HEAD"]).trim()));
    assert_eq!(outcome.state.kind, Operation::None);
    assert_eq!(git(&wt, &["log", "-1", "--format=%B"]), "Merge main, resolved by hand\n\n");
    assert_eq!(git(&wt, &["rev-list", "--parents", "-1", "HEAD"]).split_whitespace().count(), 3, "a merge commit has two parents");
    assert_eq!(std::fs::read_to_string(wt.join("README.md")).unwrap(), "both sides\n");
    let _ = std::fs::remove_dir_all(root);
}

fn subjects(wt: &Path, range: &str) -> Vec<String> {
    git(wt, &["log", "--format=%s", range]).lines().map(str::to_string).collect()
}

/// `feat` with two commits that each change README.md, rebasing onto a `main` that changed it too,
/// stopped on the first one's conflict.
fn rebase_with_two_conflicts() -> (PathBuf, PathBuf) {
    let (root, wt) = diverged("Main change", "First feat change");
    std::fs::write(wt.join("README.md"), "feat side again\n").unwrap();
    git(&wt, &["commit", "-q", "-am", "Second feat change"]);
    git(&wt, &["config", "core.editor", "false"]);
    git_stops(&wt, &["rebase", "main"]);
    (root, wt)
}

#[test]
fn continue_in_a_rebase_stops_again_on_the_next_conflict_then_finishes() {
    let (root, wt) = rebase_with_two_conflicts();
    resolve(&wt, "first resolved\n");

    let stopped = continue_in(&wt, Operation::Rebase, Some("First feat change, reworded\n")).unwrap();
    assert_eq!(stopped.state.kind, Operation::Rebase, "the second commit conflicts too");
    assert_eq!((stopped.state.step, stopped.state.total), (Some(2), Some(2)));
    assert_eq!(stopped.state.right_label.as_ref().unwrap().name, "Second feat change");
    assert_eq!(stopped.state.conflicts_total, 1);

    resolve(&wt, "second resolved\n");
    let done = continue_in(&wt, Operation::Rebase, stopped.state.message.as_deref()).unwrap();
    assert_eq!(done.state.kind, Operation::None);
    assert_eq!(git(&wt, &["symbolic-ref", "--short", "HEAD"]).trim(), "feat", "the rebase finished on its branch");
    assert_eq!(subjects(&wt, "main..feat"), ["Second feat change", "First feat change, reworded"]);
    assert_eq!(std::fs::read_to_string(wt.join("README.md")).unwrap(), "second resolved\n");
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn continue_concludes_a_resolved_cherry_pick() {
    let (root, wt) = diverged("Main change", "Feat change");
    git(&wt, &["config", "core.editor", "false"]);
    git_stops(&wt, &["cherry-pick", "main"]);
    resolve(&wt, "picked\n");

    let outcome = continue_in(&wt, Operation::CherryPick, Some("Main change\n")).unwrap();
    assert_eq!(outcome.state.kind, Operation::None);
    assert_eq!(subjects(&wt, "-2"), ["Main change", "Feat change"]);
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn continue_is_refused_while_a_conflict_remains_and_runs_nothing() {
    let (root, wt) = diverged("Main change", "Feat change");
    git_stops(&wt, &["merge", "main"]);
    let before = git(&wt, &["rev-parse", "HEAD"]);

    assert_eq!(continue_in(&wt, Operation::Merge, None), Err(GitError::ConflictsRemain { count: 1 }));
    assert_eq!(git(&wt, &["rev-parse", "HEAD"]), before);
    assert_eq!(read_operation_state(&wt).unwrap().kind, Operation::Merge);
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn each_step_acts_only_on_the_operation_under_way() {
    let (root, wt) = diverged("Main change", "Feat change");
    // With nothing under way, there is nothing to continue, skip or abort, and nothing is started.
    assert_eq!(continue_in(&wt, Operation::Merge, None), Err(GitError::NoOperation));
    assert_eq!(abort_in(&wt, Operation::Rebase), Err(GitError::NoOperation));
    assert_eq!(skip_in(&wt, Operation::CherryPick), Err(GitError::NoOperation));
    assert_eq!(read_operation_state(&wt).unwrap().kind, Operation::None);

    // A merge is under way, so a rebase the banner showed earlier is gone.
    git_stops(&wt, &["merge", "main"]);
    resolve(&wt, "both\n");
    assert_eq!(continue_in(&wt, Operation::Rebase, None), Err(GitError::NoOperation));
    assert_eq!(read_operation_state(&wt).unwrap().kind, Operation::Merge);
    let _ = std::fs::remove_dir_all(root);
}

/// Skips `expected` in `wt`, with fresh ops, slots and channel.
fn skip_in(wt: &Path, expected: Operation) -> Result<OpOutcome, GitError> {
    op_skip(&GitOps::default(), &StagingLocks::default(), wt, Uuid::new_v4(), expected, &test_channel().0)
}

/// Aborts `expected` in `wt`, with fresh ops, slots and channel.
fn abort_in(wt: &Path, expected: Operation) -> Result<OpOutcome, GitError> {
    op_abort(&GitOps::default(), &StagingLocks::default(), wt, Uuid::new_v4(), expected, &test_channel().0)
}

#[test]
fn skip_drops_the_commit_a_rebase_stopped_on_and_moves_to_the_next() {
    let (root, wt) = rebase_with_two_conflicts();

    let stopped = skip_in(&wt, Operation::Rebase).unwrap();
    assert_eq!(stopped.state.kind, Operation::Rebase);
    assert_eq!(stopped.state.right_label.as_ref().unwrap().name, "Second feat change");

    resolve(&wt, "second resolved\n");
    continue_in(&wt, Operation::Rebase, None).unwrap();
    assert_eq!(subjects(&wt, "main..feat"), ["Second feat change"], "the skipped commit is gone");
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn a_merge_has_nothing_to_skip() {
    let (root, wt) = diverged("Main change", "Feat change");
    git_stops(&wt, &["merge", "main"]);
    assert!(matches!(skip_in(&wt, Operation::Merge), Err(GitError::Other { .. })));
    assert_eq!(read_operation_state(&wt).unwrap().kind, Operation::Merge);
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn abort_puts_head_back_as_it_was_before_a_merge_or_a_rebase() {
    let (root, wt) = diverged("Main change", "Feat change");
    let before = git(&wt, &["rev-parse", "HEAD"]).trim().to_string();
    git_stops(&wt, &["merge", "main"]);
    let aborted = abort_in(&wt, Operation::Merge).unwrap();
    assert_eq!(aborted.state.kind, Operation::None);
    assert_eq!(aborted.head.as_deref(), Some(before.as_str()));
    assert_eq!(std::fs::read_to_string(wt.join("README.md")).unwrap(), "feat side\n");

    git_stops(&wt, &["rebase", "main"]);
    let aborted = abort_in(&wt, Operation::Rebase).unwrap();
    assert_eq!(aborted.state.kind, Operation::None);
    assert_eq!(aborted.head.as_deref(), Some(before.as_str()));
    assert_eq!(git(&wt, &["symbolic-ref", "--short", "HEAD"]).trim(), "feat");
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
fn a_hook_that_fails_continue_is_hook_failed_with_its_streamed_output_and_the_operation_stays() {
    // `merge --continue` runs the hook itself; `cherry-pick --continue` runs it from a child `git commit`.
    for (operation, start) in [(Operation::Merge, "merge"), (Operation::CherryPick, "cherry-pick")] {
        let (root, wt) = diverged("Main change", "Feat change");
        git_stops(&wt, &[start, "main"]);
        resolve(&wt, "both sides\n");
        install_hook(&root, &wt, "pre-commit", "#!/bin/sh\necho 'lint check: no'\nexit 1\n");

        let (channel, events) = test_channel();
        let result = op_continue(&GitOps::default(), &StagingLocks::default(), &wt, Uuid::new_v4(), operation, None, &channel);

        let Err(GitError::HookFailed { hook, output }) = result else { panic!("{start}: expected HookFailed, got {result:?}") };
        assert_eq!(hook, "pre-commit", "{start}");
        assert!(output.contains("lint check: no"), "{start}: {output}");
        let events = events.lock().unwrap();
        assert!(streamed_output(&events).contains("lint check: no"), "{start}");
        assert_eq!(events.last().unwrap()["event"], "failed");
        assert_eq!(read_operation_state(&wt).unwrap().kind, operation, "the {start} is still under way");
        let _ = std::fs::remove_dir_all(root);
    }
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
fn cancel_stops_a_slow_hook_in_continue_and_the_merge_can_continue_after() {
    let _timed = super::test_load::timed();
    let (root, wt) = diverged("Main change", "Feat change");
    git_stops(&wt, &["merge", "main"]);
    resolve(&wt, "both sides\n");
    // The hook starts `sleep` and prints its OS process id, then waits on it.
    install_hook(
        &root,
        &wt,
        "pre-commit",
        "#!/bin/sh\nsleep 120 &\nif [ -f /proc/$!/winpid ]; then cat /proc/$!/winpid; else echo $!; fi\nwait\n",
    );
    let ops = GitOps::default();
    let locks = StagingLocks::default();
    let op_id = Uuid::new_v4();
    let (channel, events) = test_channel();

    std::thread::scope(|scope| {
        let running = scope.spawn(|| op_continue(&ops, &locks, &wt, op_id, Operation::Merge, None, &channel));
        let started = std::time::Instant::now();
        let sleep_pid = loop {
            if let Ok(pid) = streamed_output(&events.lock().unwrap()).trim().parse::<u32>() {
                break pid;
            }
            assert!(started.elapsed() < std::time::Duration::from_secs(20), "the hook never started");
            std::thread::sleep(std::time::Duration::from_millis(50));
        };
        // While Continue runs, the worktree's staging slot is taken.
        assert_eq!(locks.begin(&wt).err(), Some(GitError::StagingBusy));

        ops.cancel(op_id);
        assert_eq!(running.join().unwrap(), Err(GitError::Cancelled));
        assert!(started.elapsed() < std::time::Duration::from_secs(60), "Cancel waited for the hook");
        assert!(!process_alive(sleep_pid), "the hook's sleep {sleep_pid} outlived Cancel");
    });
    assert_eq!(events.lock().unwrap().last(), Some(&json!({ "event": "failed", "error": { "kind": "cancelled" } })));
    assert_eq!(read_operation_state(&wt).unwrap().kind, Operation::Merge);

    git(&wt, &["config", "core.hooksPath", ".git/no-hooks"]);
    let done = op_continue(&ops, &locks, &wt, Uuid::new_v4(), Operation::Merge, None, &test_channel().0).unwrap();
    assert_eq!(done.state.kind, Operation::None);
    let _ = std::fs::remove_dir_all(root);
}
