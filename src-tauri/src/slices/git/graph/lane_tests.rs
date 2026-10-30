//! The lane layout graph sessions send (#375), against throwaway repositories built with the system
//! git. Hand-built histories pin each rule of the lane pass; built random histories compare its
//! topology with `git log --graph`.

use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde_json::Value;

use super::page::OPEN_ROW;
use super::session::{GraphOptions, GraphSessions};
use super::tests::{git, listen, temp_dir, Msg, WAIT};
use super::GraphOrder;

/// One commit of a hand-built history. Commits are listed oldest first and get increasing times.
struct C {
    name: String,
    parents: Vec<String>,
    msg: String,
}

fn c(name: &str, parents: &[&str]) -> C {
    merge(name, parents, "")
}

fn merge(name: &str, parents: &[&str], msg: &str) -> C {
    C { name: name.into(), parents: parents.iter().map(|p| p.to_string()).collect(), msg: msg.into() }
}

/// Builds `commits` with fast-import, points each `(ref, commit)` in `refs` at its commit, and sets
/// HEAD to `head` (a ref name). Returns the repo and the oid of each commit by name.
fn build(commits: &[C], refs: &[(&str, &str)], head: &str) -> (PathBuf, HashMap<String, String>) {
    let repo = temp_dir();
    git(&repo, &["init", "-q", "-b", "main"]);
    let mut stream = String::new();
    let mark_of: HashMap<&str, usize> = commits.iter().enumerate().map(|(i, c)| (c.name.as_str(), i + 1)).collect();
    for (i, commit) in commits.iter().enumerate() {
        let msg = if commit.msg.is_empty() { &commit.name } else { &commit.msg };
        stream.push_str(&format!(
            "commit refs/quay-build\nmark :{}\nauthor A <a@example.invalid> {t} +0000\ncommitter A <a@example.invalid> {t} +0000\ndata {}\n{msg}\n",
            i + 1,
            msg.len(),
            t = 1_600_000_000 + i * 60,
        ));
        for (k, p) in commit.parents.iter().enumerate() {
            stream.push_str(&format!("{} :{}\n", if k == 0 { "from" } else { "merge" }, mark_of[p.as_str()]));
        }
        if commit.parents.is_empty() {
            stream.push_str("deleteall\n");
        }
        stream.push_str(&format!("M 644 inline f\ndata {}\n{}\n\nreset refs/quay-build\n\n", commit.name.len(), commit.name));
    }
    stream.push_str("done\n");
    let marks = repo.join("marks");
    let mut child = crate::spawn::hidden_command("git")
        .arg("-C")
        .arg(&repo)
        .args(["fast-import", "--quiet", "--done"])
        .arg(format!("--export-marks={}", marks.display()))
        .stdin(Stdio::piped())
        .spawn()
        .unwrap();
    child.stdin.take().unwrap().write_all(stream.as_bytes()).unwrap();
    assert!(child.wait().unwrap().success());
    let by_mark: HashMap<usize, String> = std::fs::read_to_string(&marks)
        .unwrap()
        .lines()
        .map(|l| {
            let (m, oid) = l.split_once(' ').unwrap();
            (m.trim_start_matches(':').parse().unwrap(), oid.to_string())
        })
        .collect();
    std::fs::remove_file(&marks).ok();
    let oids: HashMap<String, String> =
        commits.iter().map(|c| (c.name.clone(), by_mark[&mark_of[c.name.as_str()]].clone())).collect();
    for (r#ref, commit) in refs {
        git(&repo, &["update-ref", r#ref, &oids[*commit]]);
    }
    git(&repo, &["symbolic-ref", "HEAD", head]);
    (repo, oids)
}

/// One edge, with its close applied.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Edge {
    child_row: u32,
    parent_row: u32,
    lane: u32,
    child_lane: u32,
    parent_lane: u32,
    track: u32,
}

/// A whole session's layout, with every page's closes applied.
#[derive(Debug, Default)]
struct Layout {
    oids: Vec<String>,
    /// Each row's lane and track.
    rows: Vec<(u32, u32)>,
    edges: Vec<Edge>,
    /// Each page's first row and checkpoint.
    checkpoints: Vec<(u32, Vec<u32>)>,
    /// The peak lane count each page reported.
    peaks: Vec<u32>,
    tracks: Vec<Value>,
    /// Edge ids closed by a later page than the one that opened them.
    closed_later: HashSet<u32>,
}

impl Layout {
    fn row_of(&self, oid: &str) -> u32 {
        self.oids.iter().position(|o| o == oid).unwrap_or_else(|| panic!("{oid} is a row")) as u32
    }

    fn lane_of(&self, oid: &str) -> u32 {
        self.rows[self.row_of(oid) as usize].0
    }

    fn track_key(&self, track: u32) -> &str {
        self.tracks[track as usize]["key"].as_str().unwrap()
    }

    /// The edges whose child is `oid`.
    fn edges_from(&self, oid: &str) -> Vec<Edge> {
        let row = self.row_of(oid);
        self.edges.iter().copied().filter(|e| e.child_row == row).collect()
    }
}

fn layout(repo: &Path, order: GraphOrder) -> Layout {
    let sessions = GraphSessions::default();
    let (ch, rx) = listen();
    let id = sessions.open(repo, GraphOptions { order, ..GraphOptions::default() }, ch).unwrap();
    let mut out = Layout::default();
    loop {
        match rx.recv_timeout(WAIT).expect("the session keeps talking") {
            Msg::Rows { session, first_row, oids, lanes, .. } => {
                assert_eq!(session, id);
                assert_eq!(first_row as usize, out.oids.len());
                assert_eq!(lanes.first_edge as usize, out.edges.len(), "edge ids run on across pages");
                assert_eq!(lanes.new_tracks.first().map(|t| t["id"].as_u64().unwrap() as usize), {
                    if lanes.new_tracks.is_empty() { None } else { Some(out.tracks.len()) }
                });
                let opened_here = out.edges.len() as u32..(out.edges.len() + lanes.edges.len()) as u32;
                out.oids.extend(oids);
                out.rows.extend(lanes.rows.iter().copied());
                out.edges.extend(lanes.edges.iter().map(|&[child_row, parent_row, lane, child_lane, parent_lane, track]| {
                    Edge { child_row, parent_row, lane, child_lane, parent_lane, track }
                }));
                for &[edge, parent_row, parent_lane] in &lanes.closes {
                    let e = &mut out.edges[edge as usize];
                    assert_eq!(e.parent_row, OPEN_ROW, "edge {edge} is sent open and closed once");
                    assert!(!opened_here.contains(&edge), "an edge closed in its own page is sent closed");
                    (e.parent_row, e.parent_lane) = (parent_row, parent_lane);
                    out.closed_later.insert(edge);
                }
                out.checkpoints.push((first_row, lanes.checkpoint.clone()));
                out.peaks.push(lanes.peak_lanes);
                out.tracks.extend(lanes.new_tracks.iter().cloned());
            }
            Msg::Event(e) if e["event"] == "started" => {}
            Msg::Event(e) => {
                assert_eq!(e["event"], "done", "{e}");
                break;
            }
        }
    }
    out
}

#[test]
fn a_linear_history_runs_down_lane_zero_with_one_edge_per_parent() {
    let (repo, oid) = build(&[c("a", &[]), c("b", &["a"]), c("c", &["b"])], &[("refs/heads/main", "c")], "refs/heads/main");
    let l = layout(&repo, GraphOrder::Date);
    assert_eq!(l.oids, vec![oid["c"].clone(), oid["b"].clone(), oid["a"].clone()]);
    assert_eq!(l.rows.iter().map(|r| r.0).collect::<Vec<_>>(), vec![0, 0, 0]);
    let main = l.rows[0].1;
    assert_eq!(l.track_key(main), "main");
    assert!(l.rows.iter().all(|r| r.1 == main));
    assert_eq!(
        l.edges,
        vec![
            Edge { child_row: 0, parent_row: 1, lane: 0, child_lane: 0, parent_lane: 0, track: main },
            Edge { child_row: 1, parent_row: 2, lane: 0, child_lane: 0, parent_lane: 0, track: main },
        ]
    );
    assert_eq!(l.peaks, vec![1]);
    std::fs::remove_dir_all(repo).ok();
}

#[test]
fn lane_zero_waits_for_the_default_branch_while_newer_tips_take_the_next_free_lane() {
    let (repo, oid) = build(
        &[c("a", &[]), c("b", &["a"]), c("f1", &["a"]), c("f2", &["f1"])],
        &[("refs/heads/main", "b"), ("refs/heads/feature", "f2")],
        "refs/heads/feature",
    );
    let l = layout(&repo, GraphOrder::Date);
    let lanes: Vec<u32> = ["f2", "f1", "b", "a"].iter().map(|n| l.lane_of(&oid[*n])).collect();
    assert_eq!(lanes, vec![1, 1, 0, 0]);
    let main = l.rows[l.row_of(&oid["b"]) as usize].1;
    assert_eq!((l.track_key(main), l.tracks[main as usize]["kind"].as_str()), ("main", Some("default")));
    let feature = l.rows[0].1;
    assert_eq!((l.track_key(feature), l.tracks[feature as usize]["kind"].as_str()), ("feature", Some("named")));
    // f1's edge runs down lane 1 and curves into a, which lands in lane 0.
    let [fork] = l.edges_from(&oid["f1"])[..] else { panic!("f1 has one edge") };
    assert_eq!((fork.lane, fork.child_lane, fork.parent_lane, fork.parent_row), (1, 1, 0, 3));
    assert_eq!(l.peaks, vec![2]);
    std::fs::remove_dir_all(repo).ok();
}

#[test]
fn a_new_tip_takes_the_lowest_free_lane_and_live_lanes_never_shift() {
    let (repo, oid) = build(
        &[c("a", &[]), c("z1", &["a"]), c("b", &["a"]), c("c", &["b"]), c("y1", &["a"]), c("x1", &["b"])],
        &[("refs/heads/main", "c"), ("refs/heads/x", "x1"), ("refs/heads/y", "y1"), ("refs/heads/z", "z1")],
        "refs/heads/main",
    );
    let l = layout(&repo, GraphOrder::Date);
    let names = ["x1", "y1", "c", "b", "z1", "a"];
    assert_eq!(l.oids, names.iter().map(|n| oid[*n].clone()).collect::<Vec<_>>());
    // x's lane frees at b, below y's still-live lane 2; z's new tip fills that hole.
    assert_eq!(names.iter().map(|n| l.lane_of(&oid[*n])).collect::<Vec<_>>(), vec![1, 2, 0, 0, 1, 0]);
    assert_eq!(l.track_key(l.rows[4].1), "z");
    // y's edge stays in lane 2 from y1 all the way down to a.
    let [y] = l.edges_from(&oid["y1"])[..] else { panic!("y1 has one edge") };
    assert_eq!((y.lane, y.child_lane, y.parent_row, y.parent_lane), (2, 2, 5, 0));
    assert_eq!(l.peaks, vec![3]);
    std::fs::remove_dir_all(repo).ok();
}

#[test]
fn a_merge_parent_takes_the_nearest_free_lane_right_of_the_merge_on_a_track_named_by_the_message() {
    let (repo, oid) = build(
        &[c("a", &[]), c("m1", &["a"]), c("x1", &["a"]), merge("m", &["m1", "x1"], "Merge branch 'topic'"), c("b", &["m"])],
        &[("refs/heads/main", "b")],
        "refs/heads/main",
    );
    let l = layout(&repo, GraphOrder::Date);
    let names = ["b", "m", "x1", "m1", "a"];
    assert_eq!(l.oids, names.iter().map(|n| oid[*n].clone()).collect::<Vec<_>>());
    assert_eq!(names.iter().map(|n| l.lane_of(&oid[*n])).collect::<Vec<_>>(), vec![0, 0, 1, 0, 0]);
    let edges = l.edges_from(&oid["m"]);
    assert_eq!(edges.len(), 2);
    // The first parent runs straight down lane 0; the merge edge curves at its top into lane 1.
    assert_eq!((edges[0].lane, edges[0].child_lane, edges[0].parent_lane, edges[0].parent_row), (0, 0, 0, 3));
    assert_eq!((edges[1].lane, edges[1].child_lane, edges[1].parent_lane, edges[1].parent_row), (1, 0, 1, 2));
    let topic = l.rows[2].1;
    assert_eq!(edges[1].track, topic);
    assert_eq!((l.track_key(topic), l.tracks[topic as usize]["kind"].as_str()), ("topic", Some("derived")));
    // Lane 0's track is to its left when the topic lane opens.
    assert_eq!(l.tracks[topic as usize]["left"], l.rows[0].1);
    std::fs::remove_dir_all(repo).ok();
}

fn lanes_of(l: &Layout, oid: &HashMap<String, String>, names: &[&str]) -> Vec<u32> {
    names.iter().map(|n| l.lane_of(&oid[*n])).collect()
}

#[test]
fn lane_zero_takes_whichever_default_tip_streams_in_first_and_remote_head_is_never_a_key() {
    // origin/HEAD says the default branch is trunk; the local trunk is behind origin/trunk.
    let (repo, oid) = build(
        &[c("a", &[]), c("b", &["a"]), c("m", &["a"]), c("c", &["b"])],
        &[("refs/heads/trunk", "a"), ("refs/remotes/origin/trunk", "c"), ("refs/heads/main", "m")],
        "refs/heads/main",
    );
    git(&repo, &["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/trunk"]);
    let l = layout(&repo, GraphOrder::Date);
    assert_eq!(lanes_of(&l, &oid, &["c", "m", "b", "a"]), vec![0, 1, 0, 0]);
    let trunk = l.rows[0].1;
    assert_eq!((l.track_key(trunk), l.tracks[trunk as usize]["kind"].as_str()), ("trunk", Some("default")));
    assert_eq!(l.track_key(l.rows[1].1), "main");
    assert!(l.tracks.iter().all(|t| !t["key"].as_str().unwrap().contains("HEAD")), "{:?}", l.tracks);

    // With the local branch ahead instead, the local tip streams in first and takes lane 0.
    git(&repo, &["update-ref", "refs/heads/trunk", &oid["c"]]);
    git(&repo, &["update-ref", "refs/remotes/origin/trunk", &oid["a"]]);
    let l = layout(&repo, GraphOrder::Date);
    assert_eq!(lanes_of(&l, &oid, &["c", "m", "b", "a"]), vec![0, 1, 0, 0]);
    std::fs::remove_dir_all(repo).ok();
}

#[test]
fn a_merge_into_lane_zero_before_its_tip_arrives_opens_a_merge_edge_down_lane_zero() {
    let (repo, oid) = build(
        &[c("a", &[]), c("tip", &["a"]), c("f0", &["a"]), merge("f", &["f0", "tip"], "Merge branch 'main' into feature")],
        &[("refs/heads/main", "tip"), ("refs/heads/feature", "f")],
        "refs/heads/feature",
    );
    let l = layout(&repo, GraphOrder::Date);
    assert_eq!(lanes_of(&l, &oid, &["f", "f0", "tip", "a"]), vec![1, 1, 0, 0]);
    let edges = l.edges_from(&oid["f"]);
    let main = l.rows[l.row_of(&oid["tip"]) as usize].1;
    let merge = edges[1];
    assert_eq!((merge.lane, merge.child_lane, merge.parent_row, merge.parent_lane), (0, 1, 2, 0));
    assert_eq!(merge.track, main);
    std::fs::remove_dir_all(repo).ok();
}

#[test]
fn a_join_ends_at_the_parent_when_the_parent_is_the_next_row_and_on_the_lane_otherwise() {
    // x merges p, which main's lane already waits for, and p is the very next row.
    let (repo, oid) = build(
        &[c("a", &[]), c("q", &["a"]), c("p", &["a"]), merge("x", &["q", "p"], "Merge branch 'main' into topic"), c("top", &["p"])],
        &[("refs/heads/main", "top"), ("refs/heads/topic", "x")],
        "refs/heads/main",
    );
    let l = layout(&repo, GraphOrder::Date);
    assert_eq!(lanes_of(&l, &oid, &["top", "x", "p", "q", "a"]), vec![0, 1, 0, 1, 0]);
    let join = l.edges_from(&oid["x"])[1];
    assert_eq!((join.child_row, join.child_lane, join.lane, join.parent_row, join.parent_lane), (1, 1, 0, 2, 0));
    assert_eq!(join.track, l.rows[0].1, "a join takes the color of the lane it joins");
    std::fs::remove_dir_all(repo).ok();

    // With another row between, the join ends one row down, on main's lane.
    let (repo, oid) = build(
        &[
            c("a", &[]),
            c("q", &["a"]),
            c("p", &["a"]),
            c("y", &["a"]),
            merge("x", &["q", "p"], "Merge branch 'main' into topic"),
            c("top", &["p"]),
        ],
        &[("refs/heads/main", "top"), ("refs/heads/topic", "x"), ("refs/heads/y", "y")],
        "refs/heads/main",
    );
    let l = layout(&repo, GraphOrder::Date);
    assert_eq!(lanes_of(&l, &oid, &["top", "x", "y", "p", "q", "a"]), vec![0, 1, 2, 0, 1, 0]);
    let join = l.edges_from(&oid["x"])[1];
    assert_eq!((join.child_row, join.child_lane, join.lane, join.parent_row, join.parent_lane), (1, 1, 0, 2, 0));
    std::fs::remove_dir_all(repo).ok();
}

#[test]
fn a_merge_lane_ends_in_a_join_once_a_lane_left_of_it_heads_for_the_same_parent() {
    // m merges p into lane 2 (topic holds lane 1). c, on lane 1, then heads for p too, and p will
    // land on lane 1, the leftmost. Rather than curve at both ends, the merge edge stops at c's
    // row and a one-row join carries it into lane 1.
    let (repo, oid) = build(
        &[c("a", &[]), c("p", &["a"]), c("m0", &["a"]), c("c", &["p"]), merge("m", &["m0", "p"], "Merge branch 'x'"), c("t", &["c"])],
        &[("refs/heads/main", "m"), ("refs/heads/topic", "t")],
        "refs/heads/main",
    );
    let l = layout(&repo, GraphOrder::Date);
    assert_eq!(lanes_of(&l, &oid, &["t", "m", "c", "m0", "p", "a"]), vec![1, 0, 1, 0, 1, 0]);
    let merge = l.edges_from(&oid["m"])[1];
    assert_eq!((merge.child_row, merge.child_lane, merge.lane, merge.parent_row, merge.parent_lane), (1, 0, 2, 2, 2));
    let from_c = l.edges_from(&oid["c"]);
    assert_eq!(from_c.len(), 2, "c's own edge and the join");
    let join = from_c[1];
    assert_eq!((join.child_row, join.child_lane, join.lane, join.parent_row, join.parent_lane), (2, 2, 1, 3, 1));
    assert_eq!(join.track, l.rows[2].1, "a join takes the color of the lane it joins");
    assert_eq!(l.peaks, vec![3]);
    std::fs::remove_dir_all(repo).ok();
}

#[test]
fn an_octopus_merge_fans_one_edge_per_extra_parent_out_to_the_right_in_parent_order() {
    let (repo, oid) = build(
        &[
            c("a", &[]),
            c("d1", &["a"]),
            c("c1", &["a"]),
            c("b1", &["a"]),
            c("m1", &["a"]),
            merge("o", &["m1", "b1", "c1", "d1"], "Merge branches 'b', 'c' and 'd'"),
        ],
        &[("refs/heads/main", "o")],
        "refs/heads/main",
    );
    let l = layout(&repo, GraphOrder::Date);
    assert_eq!(lanes_of(&l, &oid, &["o", "m1", "b1", "c1", "d1", "a"]), vec![0, 0, 1, 2, 3, 0]);
    let edges = l.edges_from(&oid["o"]);
    assert_eq!(edges.iter().map(|e| (e.child_lane, e.lane)).collect::<Vec<_>>(), vec![(0, 0), (0, 1), (0, 2), (0, 3)]);
    let keys: Vec<&str> = edges[1..].iter().map(|e| l.track_key(e.track)).collect();
    assert_eq!(keys, vec!["b", "c", "d"]);
    assert_eq!(l.peaks, vec![4]);
    std::fs::remove_dir_all(repo).ok();
}

#[test]
fn each_page_carries_the_edges_open_at_its_first_row_and_long_edges_close_in_a_later_page() {
    let mut commits = vec![c("root", &[]), c("m1", &["root"])];
    for i in 2..1300 {
        commits.push(c(&format!("m{i}"), &[&format!("m{}", i - 1)]));
    }
    commits.push(c("side", &["root"]));
    let (repo, oid) = build(&commits, &[("refs/heads/main", "m1299"), ("refs/heads/side", "side")], "refs/heads/main");
    let l = layout(&repo, GraphOrder::Date);
    assert!(l.checkpoints.len() >= 3, "{} pages", l.checkpoints.len());
    for (first_row, checkpoint) in &l.checkpoints {
        let expected: HashSet<u32> = (0..l.edges.len() as u32)
            .filter(|&e| l.edges[e as usize].child_row < *first_row && l.edges[e as usize].parent_row >= *first_row)
            .collect();
        assert_eq!(checkpoint.iter().copied().collect::<HashSet<_>>(), expected, "checkpoint at row {first_row}");
    }
    // side's edge runs from row 0 to the root at the bottom, in lane 1, and closes in the last page.
    let [side] = l.edges_from(&oid["side"])[..] else { panic!("side has one edge") };
    assert_eq!((side.lane, side.parent_row, side.parent_lane), (1, l.row_of(&oid["root"]), 0));
    assert!(l.closed_later.iter().any(|&e| l.edges[e as usize] == side), "side's edge was sent open, then closed");
    assert!(l.checkpoints[1..].iter().all(|(_, cp)| cp.len() == 2), "main's edge and side's edge cross every page start");
    std::fs::remove_dir_all(repo).ok();
}

/// A deterministic pseudo-random history: branches commit, fork, merge (sometimes octopus) and
/// get deleted once merged, so it has named, derived and anonymous tracks. Main is `b0`; origin
/// has a stale copy of it.
fn random_history(seed: u64, commits: usize) -> (Vec<C>, Vec<(String, String)>) {
    let mut state = seed;
    let mut next = move |n: usize| {
        state = state.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1_442_695_040_888_963_407);
        ((state >> 33) % n as u64) as usize
    };
    let mut history = vec![c("c0", &[])];
    // Live branches: (name, tip).
    let mut branches: Vec<(String, String)> = vec![("b0".into(), "c0".into())];
    let mut made = 1;
    let mut stale_main = String::from("c0");
    for i in 1..commits {
        let name = format!("c{i}");
        let roll = next(100);
        if roll < 15 && branches.len() < 12 {
            // Fork a new branch from a recent commit.
            let from = format!("c{}", i - 1 - next(i.min(20)));
            history.push(c(&name, &[&from]));
            branches.push((format!("b{made}"), name.clone()));
            made += 1;
        } else if roll < 30 && branches.len() > 1 {
            // Merge one or (rarely) three other branches into a branch, then delete some of them.
            let into = next(branches.len());
            let mut others: Vec<usize> = (0..branches.len()).filter(|&b| b != into).collect();
            let take = if roll < 18 && others.len() >= 3 { 3 } else { 1 };
            let mut picked = Vec::new();
            for _ in 0..take {
                picked.push(others.remove(next(others.len())));
            }
            let mut parents = vec![branches[into].1.clone()];
            parents.extend(picked.iter().map(|&b| branches[b].1.clone()));
            let msg = match picked.len() {
                1 => format!("Merge branch '{}' into {}", branches[picked[0]].0, branches[into].0),
                _ => format!(
                    "Merge branches '{}', '{}' and '{}' into {}",
                    branches[picked[0]].0, branches[picked[1]].0, branches[picked[2]].0, branches[into].0
                ),
            };
            let parents: Vec<&str> = parents.iter().map(String::as_str).collect();
            history.push(merge(&name, &parents, if roll % 3 == 0 { "" } else { &msg }));
            branches[into].1 = name.clone();
            picked.sort_unstable();
            for &b in picked.iter().rev() {
                if b != 0 && next(2) == 0 {
                    branches.remove(b);
                }
            }
        } else {
            let on = next(branches.len());
            let tip = branches[on].1.clone();
            history.push(c(&name, &[&tip]));
            branches[on].1 = name.clone();
        }
        if i == commits * 2 / 3 {
            stale_main = branches[0].1.clone();
        }
    }
    let mut refs: Vec<(String, String)> = branches.into_iter().map(|(b, tip)| (format!("refs/heads/{b}"), tip)).collect();
    refs.push(("refs/remotes/origin/b0".into(), stale_main));
    (history, refs)
}

/// What `git log --graph` shows for each commit line: the commit, and how many columns it draws.
/// An octopus merge's line draws the columns right of it as `\`.
fn git_graph_columns(repo: &Path, order: &str) -> Vec<(String, usize)> {
    git(repo, &["log", "--graph", order, "--format=%x01%H", "--branches", "--remotes", "HEAD"])
        .lines()
        .filter_map(|line| {
            let (graph, oid) = line.split_once('\u{1}')?;
            Some((oid.to_string(), graph.chars().filter(|ch| matches!(ch, '*' | '|' | '/' | '\\')).count()))
        })
        .collect()
}

/// Checks a layout against `git log --graph` and against the lane rules:
/// - the rows are git's commit lines, in git's order;
/// - at every row, the distinct commits the lanes are heading for, plus the row's own commit, are
///   as many as the columns git draws on that line;
/// - no edge curves at both ends;
/// - following each commit's edges, through joins, reaches exactly its parents, in order;
/// - no two edges ever share a stretch of the same lane, so lanes never shift.
fn check_against_git_graph(repo: &Path, order: GraphOrder) {
    let flag = match order {
        GraphOrder::Date => "--date-order",
        GraphOrder::Topo => "--topo-order",
    };
    let l = layout(repo, order);
    let oracle = git_graph_columns(repo, flag);
    assert_eq!(l.oids, oracle.iter().map(|(o, _)| o.clone()).collect::<Vec<_>>(), "rows follow git's order");
    assert!(l.edges.iter().all(|e| e.parent_row != OPEN_ROW), "every edge closes once the walk is done");

    // The row each edge leads to: its parent row when it ends on that row's node, else the row
    // the edge carrying on from its end is heading for: one running down that lane past the row,
    // or a join starting there.
    let target = |e: &Edge| -> u32 {
        let mut e = *e;
        loop {
            if l.rows[e.parent_row as usize].0 == e.parent_lane {
                return e.parent_row;
            }
            e = *l
                .edges
                .iter()
                .find(|f| {
                    (f.lane == e.parent_lane && f.child_row < e.parent_row && f.parent_row > e.parent_row)
                        || (f.child_row == e.parent_row && f.child_lane == e.parent_lane)
                })
                .unwrap_or_else(|| panic!("edge {e:?} ends where no lane runs"));
        }
    };
    let targets: Vec<u32> = l.edges.iter().map(target).collect();
    for e in &l.edges {
        assert!(e.child_lane == e.lane || e.parent_lane == e.lane, "edge {e:?} curves at both ends");
    }

    for (row, (oid, columns)) in oracle.iter().enumerate() {
        let row = row as u32;
        let mut heading: HashSet<u32> = l
            .edges
            .iter()
            .zip(&targets)
            .filter(|(e, _)| e.child_row < row && e.parent_row >= row)
            .map(|(_, &t)| t)
            .collect();
        heading.insert(row);
        assert_eq!(heading.len(), *columns, "row {row} ({oid}): lanes head for rows {heading:?} in {}", repo.display());
    }

    let parents_of: HashMap<String, Vec<String>> = git(repo, &["log", "--format=%H %P", "--branches", "--remotes", "HEAD"])
        .lines()
        .map(|line| {
            let mut it = line.split_whitespace().map(str::to_string);
            (it.next().unwrap(), it.collect())
        })
        .collect();
    for (row, oid) in l.oids.iter().enumerate() {
        let reached: Vec<String> = l
            .edges
            .iter()
            .zip(&targets)
            .filter(|(e, _)| e.child_row == row as u32 && e.child_lane == l.rows[row].0)
            .map(|(_, &t)| l.oids[t as usize].clone())
            .collect();
        assert_eq!(&reached, &parents_of[oid], "the edges from row {row} reach its parents, in order");
    }

    // The gaps between rows that each edge's straight run fills, by lane.
    let mut owner: HashMap<(u32, u32), usize> = HashMap::new();
    for (i, e) in l.edges.iter().enumerate() {
        let top = if e.child_lane == e.lane { e.child_row } else { e.child_row + 1 };
        let bottom = if e.parent_lane == e.lane { e.parent_row } else { e.parent_row - 1 };
        for gap in top..bottom {
            if let Some(other) = owner.insert((e.lane, gap), i) {
                panic!("edges {other} and {i} both run down lane {} below row {gap}", e.lane);
            }
        }
    }
}

#[test]
fn lane_topology_matches_git_log_graph_on_built_histories() {
    for seed in [1, 2, 3, 4, 5] {
        let (history, refs) = random_history(seed, 400);
        let refs: Vec<(&str, &str)> = refs.iter().map(|(r, c)| (r.as_str(), c.as_str())).collect();
        let (repo, _) = build(&history, &refs, "refs/heads/b0");
        git(&repo, &["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/b0"]);
        check_against_git_graph(&repo, GraphOrder::Date);
        check_against_git_graph(&repo, GraphOrder::Topo);
        std::fs::remove_dir_all(repo).ok();
    }
}

#[test]
fn merged_in_tracks_take_their_key_from_pull_request_and_remote_tracking_messages_or_else_an_oid() {
    let (repo, oid) = build(
        &[
            c("a", &[]),
            c("x", &["a"]),
            c("y", &["a"]),
            c("z", &["a"]),
            merge("m1", &["a", "x"], "Merge pull request #12 from owner/fix-x"),
            merge("m2", &["m1", "y"], "Merge remote-tracking branch 'origin/feat/y'"),
            merge("m3", &["m2", "z"], "Tidy up"),
        ],
        &[("refs/heads/main", "m3")],
        "refs/heads/main",
    );
    let l = layout(&repo, GraphOrder::Date);
    let key_of = |name: &str| l.track_key(l.rows[l.row_of(&oid[name]) as usize].1).to_string();
    assert_eq!(key_of("x"), "fix-x");
    assert_eq!(key_of("y"), "feat/y");
    assert_eq!(key_of("z"), format!("{}^2", oid["m3"]));
    let kind_of = |name: &str| l.tracks[l.rows[l.row_of(&oid[name]) as usize].1 as usize]["kind"].as_str().unwrap().to_string();
    assert_eq!((kind_of("x"), kind_of("z")), ("derived".to_string(), "anonymous".to_string()));
    std::fs::remove_dir_all(repo).ok();
}
