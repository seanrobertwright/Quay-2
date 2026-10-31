//! Deep search over all history (#400) against throwaway repositories built with the system git.

use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::Value;
use tauri::ipc::{Channel, InvokeResponseBody};

use super::checkout_tests::rev;
use super::search::{GitSearches, SearchKind, SearchQuery, SearchRefs};
use super::staging_tests::{git, repo_with_worktree};

/// A channel that keeps every event it is sent, as the JSON the frontend would receive.
fn test_channel() -> (Channel<super::search::SearchEvent>, Arc<Mutex<Vec<Value>>>) {
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

/// Commits a change to `file` in `wt` with `message`, as `author` (name, email), returning its oid.
fn commit(wt: &Path, file: &str, content: &str, message: &str, author: (&str, &str)) -> String {
    let path = wt.join(file);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).unwrap();
    }
    std::fs::write(&path, content).unwrap();
    git(wt, &["add", "-A"]);
    let out = crate::spawn::hidden_command("git")
        .current_dir(wt)
        .args(["commit", "-q", "-m", message])
        .env("GIT_AUTHOR_NAME", author.0)
        .env("GIT_AUTHOR_EMAIL", author.1)
        .output()
        .unwrap();
    assert!(out.status.success(), "commit: {}", String::from_utf8_lossy(&out.stderr));
    rev(wt, "HEAD")
}

const ANN: (&str, &str) = ("Ann", "ann@example.invalid");

fn query(kind: SearchKind, text: &str) -> SearchQuery {
    SearchQuery { kind, text: text.into(), refs: SearchRefs::Branches }
}

fn is_terminal(event: &Value) -> bool {
    matches!(event["event"].as_str(), Some("done" | "capped" | "failed"))
}

/// Waits until `events` holds `count` terminal events, and returns them all.
fn wait_for_terminal(events: &Arc<Mutex<Vec<Value>>>, count: usize) -> Vec<Value> {
    let started = Instant::now();
    loop {
        let got = events.lock().unwrap().clone();
        if got.iter().filter(|e| is_terminal(e)).count() >= count {
            return got;
        }
        assert!(started.elapsed() < Duration::from_secs(60), "the search never ended: {got:?}");
        std::thread::sleep(Duration::from_millis(20));
    }
}

/// Every oid the `matches` events carry, in order.
fn matched(events: &[Value]) -> Vec<String> {
    events
        .iter()
        .filter(|e| e["event"] == "matches")
        .flat_map(|e| e["oids"].as_array().unwrap().iter().map(|o| o.as_str().unwrap().to_string()))
        .collect()
}

/// Runs `query` in `repo` to its end and returns the matching oids and the last event.
fn search(repo: &Path, query: SearchQuery) -> (Vec<String>, Value) {
    let searches = GitSearches::default();
    let (channel, events) = test_channel();
    let id = searches.start(repo, query, channel).expect("the search starts");
    let events = wait_for_terminal(&events, 1);
    for event in &events {
        assert_eq!(event["searchId"], id, "every event names its search: {event}");
    }
    (matched(&events), events.last().unwrap().clone())
}

#[test]
fn a_message_search_is_literal_and_ignores_case() {
    let (_root, wt) = repo_with_worktree();
    let literal = commit(&wt, "a.txt", "a\n", "Handle a+b (x) [y]* in the parser", ANN);
    // A regex `a+b (x)` would match this one too.
    commit(&wt, "b.txt", "b\n", "handle aab x in the parser", ANN);

    let (oids, last) = search(&wt, query(SearchKind::Message, "A+B (X) [Y]*"));

    assert_eq!(oids, vec![literal]);
    assert_eq!(last, serde_json::json!({ "event": "done", "searchId": last["searchId"], "total": 1 }));
}

#[test]
fn an_author_search_reads_a_dot_as_a_dot() {
    let (_root, wt) = repo_with_worktree();
    let dotted = commit(&wt, "a.txt", "a\n", "one", ("J. Doe", "jd@example.invalid"));
    // A regex `J. Doe` would match this author too.
    commit(&wt, "b.txt", "b\n", "two", ("JX Doe", "jx@example.invalid"));

    let (oids, last) = search(&wt, query(SearchKind::Author, "J. Doe"));

    assert_eq!(oids, vec![dotted]);
    assert_eq!(last["event"], "done");
}

#[test]
fn a_path_search_takes_glob_characters_literally() {
    let (_root, wt) = repo_with_worktree();
    // Windows refuses `*` and `?` in file names, so the glob is a bracket class.
    let bracketed = commit(&wt, "docs/[ab].txt", "brackets\n", "add the bracketed file", ANN);
    // As a glob, `docs/[ab].txt` would match this path instead.
    commit(&wt, "docs/a.txt", "a\n", "add the other file", ANN);

    let (oids, last) = search(&wt, query(SearchKind::Path, "docs/[ab].txt"));

    assert_eq!(oids, vec![bracketed]);
    assert_eq!(last["event"], "done");
}

#[test]
fn a_code_search_finds_the_commits_that_add_or_remove_the_text() {
    let (_root, wt) = repo_with_worktree();
    let added = commit(&wt, "src/calc.rs", "fn f() { x.*y }\n", "add f", ANN);
    // Moving the text within the file keeps its count, so the pickaxe skips this one.
    commit(&wt, "src/calc.rs", "// moved\nfn f() { x.*y }\n", "comment f", ANN);
    // A regex `x.*y` would match this line.
    commit(&wt, "src/other.rs", "x and then y\n", "add other", ANN);
    let removed = commit(&wt, "src/calc.rs", "// moved\n", "drop f", ANN);

    let (oids, last) = search(&wt, query(SearchKind::Code, "x.*y"));

    assert_eq!(oids, vec![removed, added], "newest first");
    assert_eq!(last["event"], "done");
}

#[test]
fn search_text_that_looks_like_an_option_is_still_text() {
    let (_root, wt) = repo_with_worktree();
    let dashed = commit(&wt, "a.txt", "a\n", "--all of it", ANN);

    let (oids, _) = search(&wt, query(SearchKind::Message, "--all"));

    assert_eq!(oids, vec![dashed]);
}

#[test]
fn refs_limit_the_search_to_the_commits_they_reach() {
    let (_root, wt) = repo_with_worktree();
    let on_feat = commit(&wt, "a.txt", "a\n", "needle on feat", ANN);
    git(&wt, &["switch", "-q", "-c", "side", "HEAD~1"]);
    let on_side = commit(&wt, "b.txt", "b\n", "needle on side", ANN);

    let only = |refs: &[&str]| SearchQuery {
        kind: SearchKind::Message,
        text: "needle".into(),
        refs: SearchRefs::Only { refs: refs.iter().map(|r| r.to_string()).collect() },
    };
    assert_eq!(search(&wt, only(&["refs/heads/feat"])).0, vec![on_feat.clone()]);
    assert_eq!(search(&wt, only(&["HEAD"])).0, vec![on_side.clone()]);
    let mut every = search(&wt, query(SearchKind::Message, "needle")).0;
    every.sort();
    let mut expected = vec![on_feat, on_side];
    expected.sort();
    assert_eq!(every, expected, "the graph's ref set reaches both branches");
}

#[test]
fn a_filtered_search_walks_the_graphs_reduced_ref_set_and_the_selected_head() {
    let (_root, wt) = repo_with_worktree();
    let on_feat = commit(&wt, "a.txt", "a
", "needle on feat", ANN);
    git(&wt, &["switch", "-q", "-c", "other", "HEAD~1"]);
    let on_other = commit(&wt, "c.txt", "c
", "needle on other", ANN);
    git(&wt, &["switch", "-q", "-c", "side", "HEAD~1"]);
    let on_side = commit(&wt, "b.txt", "b
", "needle on side", ANN);

    let refs = SearchRefs::Filtered {
        branches: vec!["refs/heads/feat".into()],
        remotes: true,
        tags: false,
        worktree_path: Some(wt.to_string_lossy().into_owned()),
    };
    let mut found = search(&wt, SearchQuery { kind: SearchKind::Message, text: "needle".into(), refs }).0;
    found.sort();
    let mut expected = vec![on_feat, on_side];
    expected.sort();
    assert_eq!(found, expected, "feat from the filter, side from the worktree's HEAD");
    assert!(!found.contains(&on_other));
}

#[test]
fn a_ref_that_is_option_like_short_or_missing_is_refused_before_git_runs() {
    let (_root, wt) = repo_with_worktree();
    for bad in ["--all", "feat", "refs/heads/nope", "refs/heads/a..b", ""] {
        let searches = GitSearches::default();
        let (channel, _events) = test_channel();
        let refs = SearchRefs::Only { refs: vec![bad.to_string()] };
        let started = searches.start(&wt, SearchQuery { kind: SearchKind::Message, text: "x".into(), refs }, channel);
        assert!(matches!(started, Err(super::error::GitError::InvalidRefName { .. })), "{bad:?} gave {started:?}");
    }
}

/// A repo on `main` with `count` commits, each with the message `needle <n>`, built in one
/// `git fast-import` so a test can pass the cap quickly.
fn repo_with_commits(count: usize) -> std::path::PathBuf {
    let repo = std::env::temp_dir().join(format!("quay-search-{}", uuid::Uuid::new_v4().simple()));
    std::fs::create_dir_all(&repo).unwrap();
    git(&repo, &["init", "-q", "-b", "main"]);
    let mut stream = String::new();
    for n in 1..=count {
        let message = format!("needle {n}");
        stream.push_str(&format!(
            "commit refs/heads/main\ncommitter Ann <ann@example.invalid> {} +0000\ndata {}\n{message}\nM 644 inline f.txt\ndata {}\n{n}\n\n",
            1_700_000_000 + n,
            message.len() + 1,
            n.to_string().len() + 1,
        ));
    }
    let mut child = crate::spawn::hidden_command("git")
        .current_dir(&repo)
        .args(["fast-import", "--quiet"])
        .stdin(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    {
        use std::io::Write;
        child.stdin.take().unwrap().write_all(stream.as_bytes()).unwrap();
    }
    assert!(child.wait().unwrap().success(), "fast-import failed");
    git(&repo, &["reset", "-q", "--hard", "main"]);
    repo
}

#[test]
fn results_cap_at_a_thousand_and_load_more_sends_the_rest() {
    let repo = repo_with_commits(1_500);
    let searches = GitSearches::default();
    let (channel, events) = test_channel();
    let id = searches.start(&repo, query(SearchKind::Message, "needle"), channel).unwrap();

    let first = wait_for_terminal(&events, 1);
    assert_eq!(first.last().unwrap(), &serde_json::json!({ "event": "capped", "searchId": id, "total": 1000 }));
    assert_eq!(matched(&first).len(), 1000);

    searches.more(id);
    let all = wait_for_terminal(&events, 2);
    assert_eq!(all.last().unwrap(), &serde_json::json!({ "event": "done", "searchId": id, "total": 1500 }));
    let oids = matched(&all);
    assert_eq!(oids.len(), 1500);
    assert_eq!(oids.iter().collect::<std::collections::HashSet<_>>().len(), 1500, "no oid is sent twice");
    assert_eq!(oids[0], rev(&repo, "main"), "newest first");
    let _ = std::fs::remove_dir_all(repo);
}

#[test]
fn a_search_with_exactly_the_cap_of_matches_ends_in_done() {
    let repo = repo_with_commits(1_000);
    let (oids, last) = search(&repo, query(SearchKind::Message, "needle"));
    assert_eq!(oids.len(), 1000);
    assert_eq!(last["event"], "done");
    assert_eq!(last["total"], 1000);
    let _ = std::fs::remove_dir_all(repo);
}

/// Commits enough that the oids past the cap overflow the pipe, so git blocks until Load more.
const BLOCKING_COMMITS: usize = 5_000;

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
fn cancel_kills_the_searchs_git_and_ends_it_cancelled() {
    let repo = repo_with_commits(BLOCKING_COMMITS);
    let searches = GitSearches::default();
    let (channel, events) = test_channel();
    let id = searches.start(&repo, query(SearchKind::Message, "needle"), channel).unwrap();
    // Capped, git waits on its full pipe for Load more.
    wait_for_terminal(&events, 1);
    let pid = searches.process_id(id).expect("the search is live");
    assert!(process_alive(pid), "git {pid} should still be running while the search waits");

    searches.cancel(id);

    let all = wait_for_terminal(&events, 2);
    assert_eq!(all.last().unwrap(), &serde_json::json!({ "event": "failed", "searchId": id, "error": { "kind": "cancelled" } }));
    assert!(!process_alive(pid), "git {pid} outlived the cancel");
    assert_eq!(searches.process_id(id), None);
    let _ = std::fs::remove_dir_all(repo);
}

#[test]
fn a_new_search_cancels_the_running_one() {
    let repo = repo_with_commits(BLOCKING_COMMITS);
    let searches = GitSearches::default();
    let (first_channel, first_events) = test_channel();
    let first = searches.start(&repo, query(SearchKind::Message, "needle"), first_channel).unwrap();
    wait_for_terminal(&first_events, 1);
    let pid = searches.process_id(first).unwrap();

    let (channel, events) = test_channel();
    let second = searches.start(&repo, query(SearchKind::Message, "needle 7"), channel).unwrap();

    assert_ne!(first, second);
    let ended = wait_for_terminal(&first_events, 2);
    assert_eq!(ended.last().unwrap()["error"]["kind"], "cancelled");
    assert!(!process_alive(pid), "the first search's git outlived the second search");
    searches.more(first);
    let last = wait_for_terminal(&events, 1);
    assert_eq!(last.last().unwrap()["event"], "done", "the second search runs to its end");
    let _ = std::fs::remove_dir_all(repo);
}
