//! Graph refreshes (#354, #370, #379) against throwaway repositories: after commits land, a refresh
//! re-runs `git log` and either splices the new top rows onto the rows already sent or resets the
//! session. Either way, the rows the frontend ends up with must be the rows a fresh session sends.

use std::collections::HashMap;
use std::path::Path;
use std::sync::mpsc::Receiver;
use std::time::Duration;

use serde_json::Value;

use super::lane_tests::{build, random_history};
use super::page::OPEN_ROW;
use super::session::{GraphOptions, GraphSessions, Refreshed};
use super::tests::{git, listen, Msg, PageLanes, WAIT};

/// What the frontend holds for one session: every row, edge and track key, closes applied. It
/// follows the contract the frontend's store follows, so tests can check what a refresh leaves.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
struct Graph {
    oids: Vec<String>,
    /// Each row's lane and track.
    rows: Vec<(u32, u32)>,
    /// `[childRow, parentRow, lane, childLane, parentLane, track]`.
    edges: Vec<[u32; 6]>,
    track_keys: Vec<String>,
}

impl Graph {
    fn ingest(&mut self, first_row: u32, oids: Vec<String>, lanes: &PageLanes) {
        assert_eq!(first_row as usize, self.oids.len(), "pages follow on with no gap");
        assert_eq!(lanes.first_edge as usize, self.edges.len(), "edge ids follow on");
        for (i, t) in lanes.new_tracks.iter().enumerate() {
            assert_eq!(t["id"].as_u64().unwrap() as usize, self.track_keys.len() + i, "track ids follow on");
        }
        self.oids.extend(oids);
        self.rows.extend(lanes.rows.iter().copied());
        self.edges.extend(lanes.edges.iter().copied());
        for &[edge, parent_row, parent_lane] in &lanes.closes {
            let e = &mut self.edges[edge as usize];
            assert_eq!(e[1], OPEN_ROW, "edge {edge} is closed once");
            (e[1], e[4]) = (parent_row, parent_lane);
        }
        self.track_keys.extend(lanes.new_tracks.iter().map(|t| t["key"].as_str().unwrap().to_string()));
    }

    /// The rows after `splice`: `top`'s rows replace this graph's first `replaceRows` rows, and the
    /// rest move down by `rowDelta` with their edge and track ids renumbered.
    fn spliced(&self, top: &Graph, splice: &Value) -> Graph {
        let n = |k: &str| splice[k].as_u64().unwrap_or_else(|| panic!("{k} in {splice}")) as u32;
        let (replace, new_rows, delta) = (n("replaceRows"), n("newRows"), splice["rowDelta"].as_i64().unwrap());
        let (edges_from, edges_to, tracks_from, tracks_to) = (n("edgesFrom"), n("edgesTo"), n("tracksFrom"), n("tracksTo"));
        let pairs = |k: &str| -> HashMap<u32, u32> {
            splice[k].as_array().unwrap().iter().map(|p| (p[0].as_u64().unwrap() as u32, p[1].as_u64().unwrap() as u32)).collect()
        };
        let (crossing, live) = (pairs("crossingEdges"), pairs("liveTracks"));
        assert_eq!(top.oids.len() as u32, new_rows);
        assert_eq!(top.edges.len() as u32, edges_to);
        assert_eq!(top.track_keys.len() as u32, tracks_to);
        let shift = |row: u32| if row == OPEN_ROW { row } else { (row as i64 + delta) as u32 };
        let track = |t: u32| if t >= tracks_from { t - tracks_from + tracks_to } else { live[&t] };

        let mut out = top.clone();
        for (&old, &new) in &crossing {
            let e = self.edges[old as usize];
            (out.edges[new as usize][1], out.edges[new as usize][4]) = (shift(e[1]), e[4]);
        }
        for row in replace as usize..self.oids.len() {
            out.oids.push(self.oids[row].clone());
            out.rows.push((self.rows[row].0, track(self.rows[row].1)));
        }
        for e in &self.edges[edges_from as usize..] {
            out.edges.push([shift(e[0]), shift(e[1]), e[2], e[3], e[4], track(e[5])]);
        }
        out.track_keys.extend(self.track_keys[tracks_from as usize..].iter().cloned());
        out
    }
}

/// Reads pages into `graph` until an event arrives, and returns it.
fn read_until_event(rx: &Receiver<Msg>, session: u32, graph: &mut Graph) -> Value {
    loop {
        match rx.recv_timeout(WAIT).expect("the session keeps talking") {
            Msg::Rows { session: s, first_row, oids, lanes, .. } => {
                assert_eq!(s, session);
                graph.ingest(first_row, oids, &lanes);
            }
            Msg::Event(e) if e["event"] == "started" => {}
            Msg::Event(e) => {
                assert_eq!(e["sessionId"], session, "{e}");
                return e;
            }
        }
    }
}

/// Reads exactly `rows` rows of pages into a new graph.
fn read_rows(rx: &Receiver<Msg>, session: u32, rows: usize) -> Graph {
    let mut graph = Graph::default();
    while graph.oids.len() < rows {
        match rx.recv_timeout(WAIT).expect("the session sends the new rows") {
            Msg::Rows { session: s, first_row, oids, lanes, .. } => {
                assert_eq!(s, session);
                graph.ingest(first_row, oids, &lanes);
            }
            Msg::Event(e) => panic!("expected rows, got {e}"),
        }
    }
    assert_eq!(graph.oids.len(), rows);
    graph
}

/// Every row a fresh session on `repo` sends.
fn fresh(repo: &Path) -> Graph {
    let sessions = GraphSessions::default();
    let (ch, rx) = listen();
    let id = sessions.open(repo, GraphOptions::default(), ch).unwrap();
    let mut graph = Graph::default();
    assert_eq!(read_until_event(&rx, id, &mut graph)["event"], "done");
    graph
}

/// Commits `count` commits on top of `branch`, a minute apart from `time`, and returns the new tip.
fn commit_on(repo: &Path, branch: &str, count: usize, time: &mut u64) -> String {
    let mut tip = git(repo, &["rev-parse", branch]).trim().to_string();
    for i in 0..count {
        *time += 60;
        let tree = git(repo, &["rev-parse", &format!("{tip}^{{tree}}")]).trim().to_string();
        let date = format!("{time} +0000");
        let out = crate::spawn::hidden_command("git")
            .arg("-C")
            .arg(repo)
            .args(["commit-tree", &tree, "-p", &tip, "-m", &format!("on {branch} {i}")])
            .env("GIT_AUTHOR_DATE", &date)
            .env("GIT_COMMITTER_DATE", &date)
            .output()
            .unwrap();
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
        tip = String::from_utf8_lossy(&out.stdout).trim().to_string();
    }
    git(repo, &["update-ref", &format!("refs/heads/{branch}"), &tip]);
    tip
}

/// A repo of `random_history(seed, commits)` with HEAD on `b0`.
fn random_history_repo(seed: u64, commits: usize) -> std::path::PathBuf {
    let (history, refs) = random_history(seed, commits);
    let refs: Vec<(&str, &str)> = refs.iter().map(|(r, c)| (r.as_str(), c.as_str())).collect();
    build(&history, &refs, "refs/heads/b0").0
}

/// `random_history_repo` with `origin/b0` as the remote's default branch.
fn random_repo(seed: u64, commits: usize) -> std::path::PathBuf {
    let repo = random_history_repo(seed, commits);
    git(&repo, &["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/b0"]);
    repo
}

/// Deletes every branch and remote ref in `repo` but `keep`.
fn delete_refs_except(repo: &Path, keep: Option<&str>) {
    for r in git(repo, &["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes"]).lines() {
        if Some(r) != keep {
            git(repo, &["update-ref", "--no-deref", "-d", r]);
        }
    }
}

/// Refreshes session `id` and reads what it sends: the `Splice` or `Reset`, then rows up to the
/// next event, which it returns with the rows the frontend then holds.
fn refresh(sessions: &GraphSessions, rx: &Receiver<Msg>, id: u32, old: &Graph) -> (Refreshed, Value, Graph, Value) {
    let outcome = sessions.refresh(id).unwrap();
    let event = match rx.recv_timeout(WAIT).unwrap() {
        Msg::Event(e) => e,
        Msg::Rows { .. } => panic!("a refresh announces itself before its rows"),
    };
    assert_eq!(event["sessionId"], id);
    let mut graph = match event["event"].as_str() {
        Some("splice") => old.spliced(&read_rows(rx, id, event["newRows"].as_u64().unwrap() as usize), &event),
        Some("reset") => Graph::default(),
        _ => panic!("unexpected {event}"),
    };
    let next = read_until_event(rx, id, &mut graph);
    (outcome, event, graph, next)
}

#[test]
fn a_refresh_after_prepended_commits_splices_and_leaves_the_rows_a_fresh_session_sends() {
    let repo = random_repo(7, 3000);
    let sessions = GraphSessions::default();
    let (ch, rx) = listen();
    // Paused part way, so the walk goes on after the splice with renumbered rows.
    let id = sessions.open(&repo, GraphOptions { soft_cap: Some(1000), ..GraphOptions::default() }, ch).unwrap();
    let mut old = Graph::default();
    assert_eq!(read_until_event(&rx, id, &mut old)["event"], "paused");

    let mut time = 1_700_000_000;
    commit_on(&repo, "b0", 3, &mut time);
    git(&repo, &["branch", "fresh-branch", "b0"]);
    commit_on(&repo, "fresh-branch", 2, &mut time);
    let (outcome, event, mut after, next) = refresh(&sessions, &rx, id, &old);
    assert_eq!(event["event"], "splice", "{event}");
    // Five new commits, all newer than every old one, sit above the old rows.
    assert_eq!(event["rowDelta"], 5);
    assert_eq!(outcome, Refreshed::Spliced { row_delta: 5 });
    // The paused walk pauses again with the same rows, moved down.
    assert_eq!((next["event"].as_str(), next["rowsLoaded"].as_u64()), (Some("paused"), Some(1005)), "{next}");
    sessions.more(id, 1_000_000).unwrap();
    assert_eq!(read_until_event(&rx, id, &mut after)["event"], "done");
    assert_eq!(after, fresh(&repo));

    // A second refresh splices onto the spliced rows of the finished walk.
    commit_on(&repo, "b0", 1, &mut time);
    let (_, event, again, next) = refresh(&sessions, &rx, id, &after);
    assert_eq!((event["event"].as_str(), event["rowDelta"].as_i64()), (Some("splice"), Some(1)), "{event}");
    assert_eq!(next["event"], "done");
    assert_eq!(next["total"].as_u64(), Some(again.oids.len() as u64));
    assert_eq!(again, fresh(&repo));
    std::fs::remove_dir_all(repo).ok();
}

#[test]
fn a_refresh_after_history_is_rewritten_resets_and_reloads_the_rows() {
    let repo = random_repo(11, 800);
    let sessions = GraphSessions::default();
    let (ch, rx) = listen();
    let id = sessions.open(&repo, GraphOptions::default(), ch).unwrap();
    let mut old = Graph::default();
    assert_eq!(read_until_event(&rx, id, &mut old)["event"], "done");

    // Every branch now points into a history that shares no commit with the old one.
    delete_refs_except(&repo, Some("refs/heads/b0"));
    let tree = git(&repo, &["rev-parse", "b0^{tree}"]).trim().to_string();
    let root = git(&repo, &["commit-tree", &tree, "-m", "new root"]).trim().to_string();
    git(&repo, &["update-ref", "refs/heads/b0", &root]);
    let mut time = 1_700_000_000;
    commit_on(&repo, "b0", 4, &mut time);

    let (outcome, event, after, next) = refresh(&sessions, &rx, id, &old);
    assert_eq!(event["event"], "reset", "{event}");
    assert_eq!(next["event"], "done");
    // The new walk ended before the search limit, having found no old row to splice at.
    assert_eq!(outcome, Refreshed::Reset { searched_rows: 5 });
    assert_eq!(after, fresh(&repo));
    std::fs::remove_dir_all(repo).ok();
}

#[test]
fn a_refresh_with_no_match_in_20k_rows_resets_and_reloads_only_the_loaded_rows() {
    let repo = random_repo(5, 21_000);
    let sessions = GraphSessions::default();
    let (ch, rx) = listen();
    let id = sessions.open(&repo, GraphOptions { soft_cap: Some(20_500), ..GraphOptions::default() }, ch).unwrap();
    let mut old = Graph::default();
    assert_eq!(read_until_event(&rx, id, &mut old)["event"], "paused");

    // A second history of the same shape, every commit of it new.
    let other = random_history_repo(6, 21_000);
    delete_refs_except(&repo, None);
    git(&repo, &["fetch", "-q", "--update-head-ok", other.to_str().unwrap(), "+refs/heads/*:refs/heads/*"]);

    let outcome = sessions.refresh(id).unwrap();
    assert_eq!(outcome, Refreshed::Reset { searched_rows: 20_000 });
    let mut after = Graph::default();
    loop {
        match rx.recv_timeout(WAIT).unwrap() {
            Msg::Event(e) if e["event"] == "reset" => break,
            Msg::Event(e) => panic!("expected reset, got {e}"),
            Msg::Rows { .. } => panic!("no rows before the reset"),
        }
    }
    let paused = read_until_event(&rx, id, &mut after);
    // Only the rows the frontend had loaded come back.
    assert_eq!((paused["event"].as_str(), paused["rowsLoaded"].as_u64()), (Some("paused"), Some(20_500)), "{paused}");
    let whole = fresh(&repo);
    assert_eq!(after.oids, whole.oids[..20_500]);
    assert_eq!(after.rows, whole.rows[..20_500]);
    assert!(rx.recv_timeout(Duration::from_millis(200)).is_err(), "nothing more until more rows are asked for");
    std::fs::remove_dir_all(repo).ok();
    std::fs::remove_dir_all(other).ok();
}

#[test]
fn a_refresh_of_a_repo_with_no_commits_yet_shows_its_first_commits() {
    let repo = super::tests::temp_dir();
    git(&repo, &["init", "-q", "-b", "main"]);
    let sessions = GraphSessions::default();
    let (ch, rx) = listen();
    let id = sessions.open(&repo, GraphOptions::default(), ch).unwrap();
    let mut old = Graph::default();
    assert_eq!(read_until_event(&rx, id, &mut old)["event"], "done");

    // A branch other than HEAD's gets commits; HEAD stays unborn.
    let tree = git(&repo, &["mktree"]).trim().to_string();
    let root = git(&repo, &["commit-tree", &tree, "-m", "first"]).trim().to_string();
    git(&repo, &["update-ref", "refs/heads/side", &root]);
    let (outcome, event, after, next) = refresh(&sessions, &rx, id, &old);
    assert_eq!(event["event"], "reset");
    assert_eq!(outcome, Refreshed::Reset { searched_rows: 1 });
    assert_eq!((next["event"].as_str(), next["total"].as_u64()), (Some("done"), Some(1)), "{next}");
    assert_eq!(after.oids, vec![root]);
    std::fs::remove_dir_all(repo).ok();
}

/// The #370 budget: a refresh with up to 20k loaded rows takes at most 250 ms, timed from the
/// request until the `Reset` or `Splice` and every row it brings have been sent. The worst case is
/// a Reset, which lays out and sends all 20k rows again. Timings only mean something in an
/// optimized build, so run it as
/// `cargo test --release --lib a_refresh_with_20k_loaded_rows_takes_at_most_250_ms -- --ignored --nocapture`.
#[test]
#[ignore]
fn a_refresh_with_20k_loaded_rows_takes_at_most_250_ms() {
    const LOADED: u32 = 20_000;
    let repo = random_repo(5, 30_000);
    // Two histories with no commit in common, so swapping `b0` between them resets every time.
    let other = random_history_repo(6, 30_000);
    delete_refs_except(&repo, Some("refs/heads/b0"));
    git(&repo, &["fetch", "-q", other.to_str().unwrap(), "+refs/heads/b0:refs/other/b0"]);
    git(&repo, &["commit-graph", "write", "--reachable"]);
    let tips = [git(&repo, &["rev-parse", "b0"]).trim().to_string(), git(&repo, &["rev-parse", "refs/other/b0"]).trim().to_string()];

    let sessions = GraphSessions::default();
    let (ch, rx) = listen();
    let id = sessions.open(&repo, GraphOptions { soft_cap: Some(LOADED), ..GraphOptions::default() }, ch).unwrap();
    assert_eq!(read_until_event(&rx, id, &mut Graph::default())["event"], "paused");
    let drain = |rx: &Receiver<Msg>| while rx.recv_timeout(Duration::from_millis(300)).is_ok() {};

    let mut worst = Duration::ZERO;
    for round in 1..=3 {
        git(&repo, &["update-ref", "refs/heads/b0", &tips[round % 2]]);
        let started = std::time::Instant::now();
        let outcome = sessions.refresh(id).unwrap();
        let took = started.elapsed();
        assert_eq!(outcome, Refreshed::Reset { searched_rows: LOADED });
        println!("refresh by reset with {LOADED} loaded rows: {} ms", took.as_millis());
        worst = worst.max(took);
        drain(&rx);
    }
    let mut time = 1_800_000_000;
    for _ in 1..=3 {
        commit_on(&repo, "b0", 3, &mut time);
        let started = std::time::Instant::now();
        let outcome = sessions.refresh(id).unwrap();
        let took = started.elapsed();
        assert!(matches!(outcome, Refreshed::Spliced { .. }), "{outcome:?}");
        println!("refresh by splice with {LOADED} loaded rows: {} ms", took.as_millis());
        worst = worst.max(took);
        drain(&rx);
    }
    assert!(worst <= Duration::from_millis(250), "the slowest refresh took {} ms", worst.as_millis());
    std::fs::remove_dir_all(repo).ok();
    std::fs::remove_dir_all(other).ok();
}
