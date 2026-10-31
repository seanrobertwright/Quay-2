//! Graph sessions against throwaway repositories built with the system git.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::mpsc::{channel, Receiver};
use std::time::Duration;

use serde_json::Value;
use tauri::ipc::{Channel, InvokeResponseBody};

use super::page::{HEADER_BYTES, PAGE_FORMAT_VERSION, PAGE_MAGIC};
use super::session::{GraphOptions, GraphSessions, PAGE_ROWS};
use super::GraphOrder;

pub(super) fn git(dir: &Path, args: &[&str]) -> String {
    let out = crate::spawn::hidden_command("git").arg("-C").arg(dir).args(args).output().expect("git runs");
    assert!(out.status.success(), "git {args:?} failed: {}", String::from_utf8_lossy(&out.stderr));
    String::from_utf8_lossy(&out.stdout).into_owned()
}

pub(super) fn temp_dir() -> PathBuf {
    let dir = std::env::temp_dir().join(format!("quay-graph-{}", uuid::Uuid::new_v4().simple()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// A repo whose `main` has `commits` commits, one second apart, plus:
/// - `feature`, two commits off the first commit, newer than `main`'s tip;
/// - `refs/remotes/origin/main` at `main`'s tip and `refs/remotes/origin/wip`, one commit on top;
/// - tag `old`, one commit reachable from no branch;
/// - `refs/stash` and `refs/notes/commits`, one commit each, which a rev set using `--all` shows.
pub(super) fn repo_with_history(commits: usize) -> PathBuf {
    let repo = temp_dir();
    git(&repo, &["init", "-q", "-b", "main"]);
    let mut stream = String::new();
    let commit = |stream: &mut String, r#ref: &str, mark: usize, from: Option<usize>, time: usize, msg: &str| {
        stream.push_str(&format!(
            "commit {ref}\nmark :{mark}\nauthor Ann <ann@example.invalid> {t} +0000\ncommitter Ann <ann@example.invalid> {t} +0000\ndata {len}\n{msg}\n",
            ref = r#ref,
            t = 1_600_000_000 + time,
            len = msg.len(),
        ));
        if let Some(from) = from {
            stream.push_str(&format!("from :{from}\n"));
        }
        stream.push('\n');
    };
    for i in 1..=commits {
        commit(&mut stream, "refs/heads/main", i, (i > 1).then(|| i - 1), i, &format!("main {i}"));
    }
    let n = commits;
    commit(&mut stream, "refs/heads/feature", n + 1, Some(1), n + 10, "feature 1");
    commit(&mut stream, "refs/heads/feature", n + 2, Some(n + 1), n + 11, "feature 2");
    commit(&mut stream, "refs/remotes/origin/wip", n + 4, Some(n), n + 12, "remote wip");
    commit(&mut stream, "refs/tags/old", n + 5, Some(1), n + 13, "tag only");
    commit(&mut stream, "refs/stash", n + 6, Some(n), n + 14, "stash");
    commit(&mut stream, "refs/notes/commits", n + 7, None, n + 15, "notes");
    stream.push_str(&format!("reset refs/remotes/origin/main\nfrom :{n}\n\n"));
    let mut child = crate::spawn::hidden_command("git")
        .arg("-C")
        .arg(&repo)
        .args(["fast-import", "--quiet"])
        .stdin(Stdio::piped())
        .spawn()
        .unwrap();
    child.stdin.take().unwrap().write_all(stream.as_bytes()).unwrap();
    assert!(child.wait().unwrap().success());
    git(&repo, &["symbolic-ref", "HEAD", "refs/heads/main"]);
    repo
}

/// What a test sees on the channel.
#[derive(Debug)]
pub(super) enum Msg {
    Rows {
        session: u32,
        page: u32,
        first_row: u32,
        oids: Vec<String>,
        author_ms: f64,
        lanes: Box<PageLanes>,
        /// The page's provenance entries, as JSON (#381).
        agents: Vec<Value>,
    },
    Event(Value),
}

/// The lane layout a page carries (#375).
#[derive(Debug, Default)]
pub(super) struct PageLanes {
    /// Each row's lane and track id.
    pub rows: Vec<(u32, u32)>,
    /// The session-wide id of the page's first edge.
    pub first_edge: u32,
    /// `[childRow, parentRow, lane, childLane, parentLane, track]` per edge opened in the page.
    pub edges: Vec<[u32; 6]>,
    /// `[edge, parentRow, parentLane]` per edge the page closes.
    pub closes: Vec<[u32; 3]>,
    /// Edges open at the page's first row.
    pub checkpoint: Vec<u32>,
    pub peak_lanes: u32,
    pub new_tracks: Vec<Value>,
}

pub(super) fn listen() -> (Channel<InvokeResponseBody>, Receiver<Msg>) {
    let (tx, rx) = channel();
    let ch = Channel::new(move |body| {
        let msg = match body {
            InvokeResponseBody::Json(json) => Msg::Event(serde_json::from_str(&json).unwrap()),
            InvokeResponseBody::Raw(bytes) => decode(&bytes),
        };
        let _ = tx.send(msg);
        Ok(())
    });
    (ch, rx)
}

fn decode(bytes: &[u8]) -> Msg {
    let u32_at = |at: usize| u32::from_le_bytes(bytes[at..at + 4].try_into().unwrap());
    let u16_at = |at: usize| u16::from_le_bytes(bytes[at..at + 2].try_into().unwrap());
    assert_eq!(u32_at(0), PAGE_MAGIC);
    assert_eq!(u16_at(4), PAGE_FORMAT_VERSION);
    assert_eq!(u16_at(6) as usize, HEADER_BYTES);
    let (json_at, json_len) = (u32_at(40) as usize, u32_at(44) as usize);
    let json: Value = serde_json::from_slice(&bytes[json_at..json_at + json_len]).unwrap();
    let oids = json["oids"].as_array().unwrap().iter().map(|o| o.as_str().unwrap().to_string()).collect::<Vec<_>>();
    let n = u32_at(20) as usize;
    assert_eq!(oids.len(), n);
    let (edge_count, close_count, checkpoint_count) = (u32_at(24) as usize, u32_at(28) as usize, u32_at(52) as usize);
    let (lanes_at, tracks_at, edges_at, closes_at, checkpoint_at) =
        (u32_at(60) as usize, u32_at(64) as usize, u32_at(68) as usize, u32_at(72) as usize, u32_at(76) as usize);
    let lanes = PageLanes {
        rows: (0..n).map(|i| (u16_at(lanes_at + 2 * i) as u32, u32_at(tracks_at + 4 * i))).collect(),
        first_edge: u32_at(48),
        edges: (0..edge_count).map(|i| std::array::from_fn(|f| u32_at(edges_at + 24 * i + 4 * f))).collect(),
        closes: (0..close_count).map(|i| std::array::from_fn(|f| u32_at(closes_at + 12 * i + 4 * f))).collect(),
        checkpoint: (0..checkpoint_count).map(|i| u32_at(checkpoint_at + 4 * i)).collect(),
        peak_lanes: u32_at(56),
        new_tracks: json["newTracks"].as_array().cloned().unwrap_or_default(),
    };
    Msg::Rows {
        session: u32_at(8),
        page: u32_at(12),
        first_row: u32_at(16),
        oids,
        author_ms: f64::from_le_bytes(bytes[HEADER_BYTES..HEADER_BYTES + 8].try_into().unwrap()),
        lanes: Box::new(lanes),
        agents: json["agents"].as_array().cloned().unwrap_or_default(),
    }
}

pub(super) const WAIT: Duration = Duration::from_secs(30);

/// Collects rows until an event other than `Started` arrives, and returns the rows and that event.
pub(super) fn rows_until_event(rx: &Receiver<Msg>, session: u32, rows: &mut Vec<String>, pages: &mut Vec<u32>) -> Value {
    loop {
        match rx.recv_timeout(WAIT).expect("the session keeps talking") {
            Msg::Rows { session: s, page, first_row, oids, .. } => {
                assert_eq!(s, session);
                assert_eq!(first_row as usize, rows.len(), "pages arrive in order with no gap");
                assert!(oids.len() <= PAGE_ROWS);
                pages.push(page);
                rows.extend(oids);
            }
            Msg::Event(e) if e["event"] == "started" => assert_eq!(e["sessionId"], session),
            Msg::Event(e) => {
                assert_eq!(e["sessionId"], session, "{e}");
                return e;
            }
        }
    }
}

fn expected_order(repo: &Path, order: &str) -> Vec<String> {
    git(repo, &["rev-list", order, "--branches", "--remotes", "HEAD"]).lines().map(str::to_string).collect()
}

fn options(soft_cap: Option<u32>) -> GraphOptions {
    GraphOptions { soft_cap, ..GraphOptions::default() }
}

#[test]
fn streams_every_branch_and_remote_in_date_order_without_tags_stash_or_notes() {
    let repo = repo_with_history(1200);
    let sessions = GraphSessions::default();
    let (ch, rx) = listen();
    let id = sessions.open(&repo, options(None), ch).unwrap();
    let (mut rows, mut pages) = (Vec::new(), Vec::new());
    let end = rows_until_event(&rx, id, &mut rows, &mut pages);
    assert_eq!(end["event"], "done");
    assert_eq!(end["total"], rows.len());
    assert_eq!(rows, expected_order(&repo, "--date-order"));
    // main's 1200, feature's 2 and origin/wip's 1; the tag, stash and notes commits stay out.
    assert_eq!(rows.len(), 1203);
    let tag_only = git(&repo, &["rev-parse", "old"]).trim().to_string();
    let stash = git(&repo, &["rev-parse", "refs/stash"]).trim().to_string();
    assert!(!rows.contains(&tag_only) && !rows.contains(&stash));
    assert_eq!(pages, (0..pages.len() as u32).collect::<Vec<_>>());
    std::fs::remove_dir_all(repo).ok();
}

#[test]
fn topo_order_is_a_session_option() {
    let repo = repo_with_history(40);
    let sessions = GraphSessions::default();
    let (ch, rx) = listen();
    let id = sessions.open(&repo, GraphOptions { order: GraphOrder::Topo, ..GraphOptions::default() }, ch).unwrap();
    let (mut rows, mut pages) = (Vec::new(), Vec::new());
    assert_eq!(rows_until_event(&rx, id, &mut rows, &mut pages)["event"], "done");
    assert_eq!(rows, expected_order(&repo, "--topo-order"));
    std::fs::remove_dir_all(repo).ok();
}

#[test]
fn pages_carry_epoch_ms_from_the_author_time() {
    let repo = repo_with_history(3);
    let sessions = GraphSessions::default();
    let (ch, rx) = listen();
    sessions.open(&repo, options(None), ch).unwrap();
    let author_ms = loop {
        if let Msg::Rows { author_ms, .. } = rx.recv_timeout(WAIT).unwrap() {
            break author_ms;
        }
    };
    // The newest commit is origin/wip's, at 1_600_000_000 + 3 + 12 seconds.
    assert_eq!(author_ms, 1_600_000_015_000.0);
    std::fs::remove_dir_all(repo).ok();
}

#[test]
fn a_soft_cap_pauses_the_walk_until_more_rows_are_asked_for() {
    // Far more rows than the queue and pipe hold, so git itself blocks while the session waits.
    let repo = repo_with_history(12_000);
    let sessions = GraphSessions::default();
    let (ch, rx) = listen();
    let id = sessions.open(&repo, options(Some(1000)), ch).unwrap();
    let (mut rows, mut pages) = (Vec::new(), Vec::new());
    let paused = rows_until_event(&rx, id, &mut rows, &mut pages);
    assert_eq!(paused["event"], "paused");
    assert_eq!(paused["rowsLoaded"], 1000);
    assert_eq!(rows.len(), 1000);
    // Nothing more arrives while paused.
    assert!(rx.recv_timeout(Duration::from_millis(300)).is_err());

    sessions.more(id, 5000).unwrap();
    assert_eq!(rows_until_event(&rx, id, &mut rows, &mut pages)["rowsLoaded"], 6000);
    sessions.more(id, 1_000_000).unwrap();
    let done = rows_until_event(&rx, id, &mut rows, &mut pages);
    assert_eq!(done["event"], "done");
    // The resumed walk is the same walk: every row once, in git's order.
    assert_eq!(rows, expected_order(&repo, "--date-order"));
    std::fs::remove_dir_all(repo).ok();
}

#[test]
fn a_soft_cap_that_covers_the_history_ends_with_done_not_paused() {
    let repo = repo_with_history(10);
    let sessions = GraphSessions::default();
    let (ch, rx) = listen();
    // Exactly the 13 rows the repo has.
    let id = sessions.open(&repo, options(Some(13)), ch).unwrap();
    let (mut rows, mut pages) = (Vec::new(), Vec::new());
    assert_eq!(rows_until_event(&rx, id, &mut rows, &mut pages)["event"], "done");
    std::fs::remove_dir_all(repo).ok();
}

#[test]
fn opening_another_repo_closes_the_old_session() {
    let (a, b) = (repo_with_history(2000), repo_with_history(5));
    let sessions = GraphSessions::default();
    let (ch_a, rx_a) = listen();
    let first = sessions.open(&a, options(Some(1)), ch_a).unwrap();
    let (mut rows, mut pages) = (Vec::new(), Vec::new());
    assert_eq!(rows_until_event(&rx_a, first, &mut rows, &mut pages)["event"], "paused");

    let (ch_b, rx_b) = listen();
    let second = sessions.open(&b, options(None), ch_b).unwrap();
    assert_ne!(first, second);
    assert!(sessions.more(first, 10).is_err(), "the old session is gone");
    assert!(rx_a.recv_timeout(Duration::from_millis(300)).is_err(), "the old session sends nothing more");
    let (mut rows_b, mut pages_b) = (Vec::new(), Vec::new());
    assert_eq!(rows_until_event(&rx_b, second, &mut rows_b, &mut pages_b)["event"], "done");
    assert_eq!(rows_b.len(), 8);

    sessions.close(second);
    assert!(sessions.more(second, 1).is_err());
    sessions.close(second);
    std::fs::remove_dir_all(a).ok();
    std::fs::remove_dir_all(b).ok();
}

#[test]
fn a_repo_with_no_commits_is_done_with_no_rows() {
    let repo = temp_dir();
    git(&repo, &["init", "-q", "-b", "main"]);
    let sessions = GraphSessions::default();
    let (ch, rx) = listen();
    let id = sessions.open(&repo, options(None), ch).unwrap();
    let (mut rows, mut pages) = (Vec::new(), Vec::new());
    let end = rows_until_event(&rx, id, &mut rows, &mut pages);
    assert_eq!((end["event"].as_str(), end["total"].as_u64()), (Some("done"), Some(0)));
    std::fs::remove_dir_all(repo).ok();
}

#[test]
fn a_folder_that_is_not_a_repo_fails_with_gits_message() {
    let dir = temp_dir();
    let sessions = GraphSessions::default();
    let (ch, rx) = listen();
    let id = sessions.open(&dir, options(None), ch).unwrap();
    let (mut rows, mut pages) = (Vec::new(), Vec::new());
    let end = rows_until_event(&rx, id, &mut rows, &mut pages);
    assert_eq!(end["event"], "failed");
    assert_eq!(end["error"]["kind"], "other");
    assert!(end["error"]["stderr"].as_str().unwrap().contains("not a git repository"), "{end}");
    std::fs::remove_dir_all(dir).ok();
}

#[test]
fn bad_counts_and_relative_paths_are_refused() {
    let sessions = GraphSessions::default();
    let (ch, _rx) = listen();
    assert!(sessions.open(Path::new("relative/repo"), options(None), ch.clone()).is_err());
    assert!(sessions.open(&std::env::temp_dir(), options(Some(0)), ch.clone()).is_err());
    assert!(sessions.open(&std::env::temp_dir(), options(Some(2_000_001)), ch).is_err());
    assert!(sessions.more(1, 0).is_err());
}

#[test]
fn options_parse_from_camel_case_and_reject_unknown_keys() {
    let parsed: GraphOptions =
        serde_json::from_str(r#"{ "order": "topo", "refs": { "kind": "branches" }, "softCap": 500 }"#).unwrap();
    assert_eq!(parsed.order, GraphOrder::Topo);
    assert_eq!(parsed.soft_cap, Some(500));
    assert_eq!(serde_json::from_str::<GraphOptions>("{}").unwrap(), GraphOptions::default());
    assert!(serde_json::from_str::<GraphOptions>(r#"{ "skip": 10 }"#).is_err());
    assert!(serde_json::from_str::<GraphOptions>(r#"{ "refs": { "kind": "all" } }"#).is_err());
    assert!(serde_json::from_str::<GraphOptions>(r#"{ "softCap": -1 }"#).is_err());
}

#[test]
fn object_reads_go_through_one_cat_file_per_session() {
    let repo = repo_with_history(3);
    let sessions = GraphSessions::default();
    let (ch, _rx) = listen();
    let id = sessions.open(&repo, options(None), ch).unwrap();
    let tip = git(&repo, &["rev-parse", "main"]).trim().to_string();
    let commit = sessions.read_object(id, &tip).unwrap().expect("the tip exists");
    assert_eq!(commit.kind, "commit");
    assert!(String::from_utf8_lossy(&commit.bytes).contains("main 3"));
    // A second read reuses the same reader, and a missing object is not an error.
    assert_eq!(sessions.read_object(id, &"0".repeat(40)).unwrap(), None);
    assert!(sessions.read_object(id, "main\nHEAD").is_err());
    assert_eq!(sessions.read_object(id, "main").unwrap().unwrap().kind, "commit");
    assert!(sessions.read_object(id + 1, "main").is_err());
    std::fs::remove_dir_all(repo).ok();
}

/// Commits `message` on `repo`'s current branch, with no changes, and returns its oid.
fn commit_with_message(repo: &Path, message: &str) -> String {
    git(repo, &["-c", "user.name=Ann", "-c", "user.email=ann@example.invalid", "commit", "-q", "--allow-empty", "-m", message]);
    git(repo, &["rev-parse", "HEAD"]).trim().to_string()
}

#[test]
fn rows_carry_each_commits_agent_and_how_quay_knows_it() {
    let repo = temp_dir();
    git(&repo, &["init", "-q", "-b", "main"]);
    let human = commit_with_message(&repo, "By hand

Co-authored-by: Ed <ed@example.invalid>");
    let coauthor = commit_with_message(&repo, "Paired

Co-authored-by: Claude Opus <NoReply@Anthropic.com>");
    let stamp = commit_with_message(&repo, "Stamped

Quay-Agent: codex");
    let both = commit_with_message(&repo, "Both

Co-authored-by: Claude <noreply@anthropic.com>
Quay-Agent: antigravity");
    let unknown = commit_with_message(&repo, "Odd

Quay-Agent: <b>robot</b>");
    let shell = commit_with_message(&repo, "Shell

Quay-Agent: powershell");

    let sessions = GraphSessions::default();
    let (ch, rx) = listen();
    sessions.open(&repo, options(None), ch).unwrap();
    let (oids, agents) = loop {
        if let Msg::Rows { oids, agents, .. } = rx.recv_timeout(WAIT).unwrap() {
            break (oids, agents);
        }
    };
    let row = |oid: &str| oids.iter().position(|o| o == oid).unwrap();
    let mut expected = vec![
        serde_json::json!({ "row": row(coauthor.as_str()), "kind": "claude", "source": "coauthor" }),
        serde_json::json!({ "row": row(stamp.as_str()), "kind": "codex", "source": "stamp" }),
        serde_json::json!({ "row": row(both.as_str()), "kind": "antigravity", "source": "stamp" }),
        serde_json::json!({ "row": row(unknown.as_str()), "kind": null, "source": "stamp", "raw": "<b>robot</b>" }),
        serde_json::json!({ "row": row(shell.as_str()), "kind": null, "source": "stamp", "raw": "powershell" }),
    ];
    expected.sort_by_key(|a| a["row"].as_u64());
    assert_eq!(agents, expected);
    // A human commit has no entry, and no trailer text other than an unknown stamp's reaches the page.
    assert!(!agents.iter().any(|a| a["row"] == row(human.as_str())));
    let text = serde_json::to_string(&agents).unwrap();
    assert!(!text.contains("example.invalid") && !text.contains("anthropic"), "{text}");
    std::fs::remove_dir_all(repo).ok();
}
