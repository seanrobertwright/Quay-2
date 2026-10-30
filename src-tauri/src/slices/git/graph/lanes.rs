//! The lane pass (#348, #351, #375): one online, top-down pass over a session's rows in stream
//! order. Written fresh from the `topos-lane-geometry` findings; nothing is ported (#355).
//!
//! - Each lane waits for one commit, and a map from oid to waiting lanes places each commit. When
//!   several lanes wait for it, it lands in the leftmost, which is lane 0 when the default branch's
//!   lane is one of them.
//! - The first parent continues in the commit's own lane. Each other parent gets a lane at the
//!   merge row, the nearest free one to the right, or joins a lane already coming down for it.
//! - No edge curves at both ends. When a lane left of a merge lane starts down toward the same
//!   parent, the merge edge stops there and a one-row join carries it into that lane.
//! - Live lanes never shift sideways. A new tip takes the lowest free lane. Empty lanes at the
//!   right edge are trimmed.
//! - A row's layout depends only on the rows above it, so rows already sent never move.

use std::collections::{BTreeSet, HashMap};

use serde::Serialize;

use super::page::OPEN_ROW;
use super::refs::BranchTips;

/// What a track's color key came from, which decides whether its color may be probed (#351).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TrackKind {
    /// The default branch, local or remote: color slot 0.
    Default,
    /// A branch ref at the track's tip.
    Named,
    /// A branch name parsed from the merge message that opened the track.
    Derived,
    /// No name: the key is an oid.
    Anonymous,
}

/// One run of first parents drawn in one lane. Its color comes from `key`, never from its lane.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub id: u32,
    pub key: String,
    pub kind: TrackKind,
    /// The tracks in the lanes either side of this one when it was opened, which clash probing
    /// steers away from.
    pub left: Option<u32>,
    pub right: Option<u32>,
}

/// An edge from a child row down to a parent row. Its vertical run lives in `lane`; it curves
/// at the end whose lane differs from `lane`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Edge {
    pub child_row: u32,
    /// [`OPEN_ROW`] until the parent row is placed.
    pub parent_row: u32,
    pub lane: u32,
    pub child_lane: u32,
    pub parent_lane: u32,
    pub track: u32,
}

/// The closing of an edge sent open in an earlier page.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Close {
    pub edge: u32,
    pub parent_row: u32,
    pub parent_lane: u32,
}

/// The layout of one page of rows.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct PageLayout {
    /// The session-wide id of `edges[0]`.
    pub first_edge: u32,
    /// The ids of the edges open at the page's first row.
    pub checkpoint: Vec<u32>,
    /// Each row's lane and track.
    pub rows: Vec<(u32, u32)>,
    /// Edges whose child row is in this page, in child-row order.
    pub edges: Vec<Edge>,
    /// Edges from earlier pages whose parent row is in this page.
    pub closes: Vec<Close>,
    /// Tracks this page opens, in id order.
    pub tracks: Vec<Track>,
    /// The most lanes any row so far has needed.
    pub peak_lanes: u32,
}

/// A lane in use.
#[derive(Debug, Clone)]
struct Slot {
    track: u32,
    /// The edge running down this lane; None while lane 0 waits for the default branch's first tip.
    edge: Option<u32>,
    /// Whether that edge curved in from a merge at its top, so it can't also curve at its bottom.
    merged: bool,
}


/// An edge into a lane already coming down for its parent: from a merge, or from a merge lane
/// folded into a lane left of it. It ends one row below where it starts, on that lane, or at the
/// parent itself when the parent is that next row (#351).
#[derive(Debug, Clone)]
struct Join {
    edge: u32,
    lane: u32,
    awaits: String,
}

/// The session's lane state.
pub struct LanePass {
    tips: BranchTips,
    lanes: Vec<Option<Slot>>,
    /// Holes below `lanes.len()`.
    free: BTreeSet<u32>,
    /// The lanes waiting for each commit.
    awaiting: HashMap<String, Vec<u32>>,
    /// The default branch's local and remote tips, which lane 0 waits for together until the
    /// first of them streams in.
    seed_tips: Vec<String>,
    /// Join edges opened at the previous row, which end at this row.
    joins: Vec<Join>,
    next_edge: u32,
    next_track: u32,
    peak: u32,
    page: PageLayout,
}

impl LanePass {
    pub fn new(tips: BranchTips) -> Self {
        let mut pass = Self {
            lanes: Vec::new(),
            free: BTreeSet::new(),
            awaiting: HashMap::new(),
            seed_tips: Vec::new(),
            joins: Vec::new(),
            next_edge: 0,
            next_track: 0,
            peak: 0,
            page: PageLayout::default(),
            tips: BranchTips::default(),
        };
        // Pin lane 0 to the default branch: it waits for every local and remote tip of it at once,
        // so a stale local branch can't leave it empty at the top (#351).
        if let (Some(key), false) = (&tips.default_key, tips.default_tips.is_empty()) {
            let track = pass.open_track(key.clone(), TrackKind::Default, 0);
            pass.lanes.push(Some(Slot { track, edge: None, merged: false }));
            for tip in &tips.default_tips {
                pass.awaiting.entry(tip.clone()).or_default().push(0);
            }
            pass.seed_tips = tips.default_tips.clone();
        }
        pass.tips = tips;
        pass
    }

    /// Lane 0 has started down toward `kept`: it no longer waits for the other default tips.
    fn unseed(&mut self, kept: &str) {
        for tip in std::mem::take(&mut self.seed_tips) {
            if tip == kept {
                continue;
            }
            if let Some(lanes) = self.awaiting.get_mut(&tip) {
                lanes.retain(|&l| l != 0);
                if lanes.is_empty() {
                    self.awaiting.remove(&tip);
                }
            }
        }
    }

    /// Starts a page: the next row placed is its first.
    pub fn begin_page(&mut self) {
        self.page.first_edge = self.next_edge;
        self.page.checkpoint =
            self.lanes.iter().flatten().filter_map(|s| s.edge).chain(self.joins.iter().map(|j| j.edge)).collect();
    }

    /// Ends the page begun last and returns its layout.
    pub fn take_page(&mut self) -> PageLayout {
        self.page.peak_lanes = self.peak;
        std::mem::take(&mut self.page)
    }

    /// Opens a track in `lane`. A named or derived key that is the default branch's opens a
    /// default track. Derived and anonymous tracks note their neighbours for clash probing; named
    /// and default tracks keep their pure-hash color and need none.
    fn open_track(&mut self, key: String, kind: TrackKind, lane: u32) -> u32 {
        let kind = match kind {
            TrackKind::Named | TrackKind::Derived if self.tips.default_key.as_ref() == Some(&key) => TrackKind::Default,
            kind => kind,
        };
        let (left, right) = match kind {
            TrackKind::Derived | TrackKind::Anonymous => {
                let track_in =
                    |l: Option<u32>| l.and_then(|l| self.lanes.get(l as usize)).and_then(|s| s.as_ref()).map(|s| s.track);
                (track_in(lane.checked_sub(1)), track_in(Some(lane + 1)))
            }
            TrackKind::Default | TrackKind::Named => (None, None),
        };
        let id = self.next_track;
        self.next_track += 1;
        self.page.tracks.push(Track { id, key, kind, left, right });
        id
    }

    /// The track for a new tip in `lane`, keyed by the branch at that tip.
    fn tip_track(&mut self, oid: &str, lane: u32) -> u32 {
        match self.tips.keys.get(oid).cloned() {
            Some(key) => self.open_track(key, TrackKind::Named, lane),
            None => self.open_track(oid.to_string(), TrackKind::Anonymous, lane),
        }
    }

    fn open_edge(&mut self, row: u32, child_lane: u32, lane: u32, track: u32) -> u32 {
        let id = self.next_edge;
        self.next_edge += 1;
        self.page.edges.push(Edge { child_row: row, parent_row: OPEN_ROW, lane, child_lane, parent_lane: lane, track });
        id
    }

    fn close_edge(&mut self, edge: u32, parent_row: u32, parent_lane: u32) {
        if let Some(e) = edge.checked_sub(self.page.first_edge).and_then(|i| self.page.edges.get_mut(i as usize)) {
            (e.parent_row, e.parent_lane) = (parent_row, parent_lane);
        } else {
            self.page.closes.push(Close { edge, parent_row, parent_lane });
        }
    }

    fn lowest_free_lane(&mut self) -> u32 {
        self.free.pop_first().unwrap_or_else(|| {
            self.lanes.push(None);
            self.lanes.len() as u32 - 1
        })
    }

    /// The nearest free lane right of `lane`, or a new lane at the right edge.
    fn free_lane_right_of(&mut self, lane: u32) -> u32 {
        match self.free.range(lane + 1..).next().copied() {
            Some(l) => {
                self.free.remove(&l);
                l
            }
            None => {
                self.lanes.push(None);
                self.lanes.len() as u32 - 1
            }
        }
    }

    /// Gives `parent`, parent number `index` (from 0) of the commit `oid` in `lane` at `row`, its
    /// merge edge: into a lane already waiting for it, or down a lane of its own.
    fn place_merge_parent(&mut self, row: u32, oid: &str, lane: u32, parent: &str, index: usize, subject: &str) {
        if let Some(&target) = self.awaiting.get(parent).and_then(|lanes| lanes.iter().min()) {
            let slot = self.lanes[target as usize].clone().expect("a waiting lane is in use");
            let edge = self.open_edge(row, lane, target, slot.track);
            if slot.edge.is_some() {
                self.joins.push(Join { edge, lane: target, awaits: parent.to_string() });
            } else {
                // Lane 0 has drawn nothing yet, so a join would end in empty space. The merge
                // opens lane 0's first edge instead, and lane 0 now waits for this parent alone.
                self.lanes[target as usize] = Some(Slot { track: slot.track, edge: Some(edge), merged: true });
                self.unseed(parent);
            }
            return;
        }
        let target = self.free_lane_right_of(lane);
        let track = match merged_branch(subject, index) {
            Some(key) => self.open_track(key, TrackKind::Derived, target),
            None => self.open_track(format!("{oid}^{}", index + 1), TrackKind::Anonymous, target),
        };
        let edge = self.open_edge(row, lane, target, track);
        self.lanes[target as usize] = Some(Slot { track, edge: Some(edge), merged: true });
        self.awaiting.entry(parent.to_string()).or_default().push(target);
    }

    /// `lane`, holding `track` at `row`, has started down toward `parent`. A merge lane right of
    /// it waiting for the same parent would lose it to `lane` and so curve at both ends: its edge
    /// stops at this row, and a join takes it into `lane` at the next.
    fn fold_merge_lanes(&mut self, row: u32, lane: u32, track: u32, parent: &str) {
        let Some(waiting) = self.awaiting.get(parent) else { return };
        let folded: Vec<u32> = waiting
            .iter()
            .copied()
            .filter(|&l| l > lane && self.lanes[l as usize].as_ref().is_some_and(|s| s.merged))
            .collect();
        for l in folded {
            if let Some(Slot { edge: Some(edge), .. }) = self.lanes[l as usize].take() {
                self.close_edge(edge, row, l);
            }
            self.free.insert(l);
            let edge = self.open_edge(row, l, lane, track);
            self.joins.push(Join { edge, lane, awaits: parent.to_string() });
        }
        if let Some(waiting) = self.awaiting.get_mut(parent) {
            waiting.retain(|&l| self.lanes[l as usize].is_some());
        }
    }

    /// Places the commit `oid`, whose message starts `subject`, at `row`, the next row in stream
    /// order.
    pub fn place(&mut self, row: u32, oid: &str, parents: &[String], subject: &str) {
        let waiting = self.awaiting.remove(oid).unwrap_or_default();
        let (lane, track) = match waiting.iter().min() {
            None => {
                let lane = self.lowest_free_lane();
                (lane, self.tip_track(oid, lane))
            }
            Some(&lane) => {
                let slot = self.lanes[lane as usize].take().expect("a waiting lane is in use");
                match slot.edge {
                    Some(edge) => self.close_edge(edge, row, lane),
                    None => self.unseed(oid),
                }
                // Every other lane waiting for this commit ends here, curving into its lane.
                for &other in waiting.iter().filter(|&&l| l != lane) {
                    if let Some(Slot { edge: Some(edge), .. }) = self.lanes[other as usize].take() {
                        self.close_edge(edge, row, lane);
                    }
                    self.free.insert(other);
                }
                (lane, slot.track)
            }
        };
        self.page.rows.push((lane, track));
        for join in std::mem::take(&mut self.joins) {
            let parent_lane = if join.awaits == oid { lane } else { join.lane };
            self.close_edge(join.edge, row, parent_lane);
        }

        match parents.first() {
            None => {
                self.free.insert(lane);
            }
            Some(first) => {
                let edge = self.open_edge(row, lane, lane, track);
                self.lanes[lane as usize] = Some(Slot { track, edge: Some(edge), merged: false });
                self.awaiting.entry(first.clone()).or_default().push(lane);
                for (index, parent) in parents.iter().enumerate().skip(1) {
                    self.place_merge_parent(row, oid, lane, parent, index, subject);
                }
                // After the merge parents, so none of them takes a lane this frees at this row.
                self.fold_merge_lanes(row, lane, track, first);
            }
        }
        while matches!(self.lanes.last(), Some(None)) {
            self.lanes.pop();
            self.free.remove(&(self.lanes.len() as u32));
        }
        self.peak = self.peak.max(self.lanes.len() as u32);
    }
}

/// The branch a merge message names for parent number `index` (from 0; the first merged-in
/// branch is 1), without a remote or owner prefix: `Merge branch 'x'`, `Merge branches 'x' and
/// 'y'`, `Merge remote-tracking branch 'origin/x'` and `Merge pull request #N from owner/x`.
pub fn merged_branch(subject: &str, index: usize) -> Option<String> {
    let name = if let Some(rest) = subject.strip_prefix("Merge pull request #") {
        if index != 1 {
            return None;
        }
        let from = rest.split_once(" from ")?.1.split_whitespace().next()?;
        from.split_once('/').map_or(from, |(_, branch)| branch)
    } else {
        let (remote, rest) = if let Some(rest) = subject.strip_prefix("Merge remote-tracking branch") {
            (true, rest)
        } else if let Some(rest) = subject.strip_prefix("Merge branch") {
            (false, rest)
        } else {
            return None;
        };
        // The quoted names come before any " into ..." or " of ...".
        let name = rest.split('\'').skip(1).step_by(2).nth(index.checked_sub(1)?)?;
        if remote { name.split_once('/').map_or(name, |(_, branch)| branch) } else { name }
    };
    (!name.is_empty() && name != "HEAD").then(|| name.to_string())
}

#[cfg(test)]
mod tests {
    use std::time::Instant;

    use super::*;

    /// A synthetic history, newest first: `live` branches commit in turn, and every so often one
    /// merges into another or a new branch forks off, so lanes open, join and close all the time.
    fn synthetic_history(rows: usize, live: usize) -> Vec<(String, Vec<String>, String)> {
        let mut state = 7u64;
        let mut next = move |n: usize| {
            state = state.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1_442_695_040_888_963_407);
            ((state >> 33) % n as u64) as usize
        };
        let oid = |i: usize| format!("{i:040x}");
        let mut tips: Vec<usize> = vec![0];
        let mut oldest_first = vec![(oid(0), vec![], "root".to_string())];
        for i in 1..rows {
            let roll = next(100);
            let (parents, subject) = if roll < 5 && tips.len() < live {
                let from = i - 1 - next(i.min(50));
                tips.push(i);
                (vec![oid(from)], format!("fork {i}"))
            } else if roll < 12 && tips.len() > 1 {
                let into = next(tips.len());
                let from = (into + 1 + next(tips.len() - 1)) % tips.len();
                let parents = vec![oid(tips[into]), oid(tips[from])];
                tips[into] = i;
                tips.swap_remove(from);
                (parents, format!("Merge branch 'b{from}'"))
            } else {
                let on = next(tips.len());
                let parent = tips[on];
                tips[on] = i;
                (vec![oid(parent)], format!("commit {i}"))
            };
            oldest_first.push((oid(i), parents, subject));
        }
        oldest_first.reverse();
        oldest_first
    }

    /// The #370 budget: the lane pass costs at most 1 µs per row. Timings only mean something in
    /// an optimized build, so run it as
    /// `cargo test --release --lib lane_pass_costs_at_most_a_microsecond_per_row -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn lane_pass_costs_at_most_a_microsecond_per_row() {
        const ROWS: usize = 1_000_000;
        let history = synthetic_history(ROWS, 40);
        let mut best = f64::INFINITY;
        for _ in 0..3 {
            let mut pass = LanePass::new(BranchTips::default());
            let started = Instant::now();
            for (row, (oid, parents, subject)) in history.iter().enumerate() {
                if row % 512 == 0 {
                    if row > 0 {
                        std::hint::black_box(pass.take_page());
                    }
                    pass.begin_page();
                }
                pass.place(row as u32, oid, parents, subject);
            }
            std::hint::black_box(pass.take_page());
            let per_row_ns = started.elapsed().as_nanos() as f64 / ROWS as f64;
            println!("lane pass: {per_row_ns:.0} ns per row over {ROWS} rows, peak {} lanes", pass.peak);
            best = best.min(per_row_ns);
        }
        assert!(best <= 1000.0, "the lane pass took {best:.0} ns per row");
    }
}
