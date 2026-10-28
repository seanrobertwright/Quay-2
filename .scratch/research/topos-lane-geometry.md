# Topos commit graph: lane allocation, ribbon geometry and lane colors

Research for #348 (parent map #347, "Topos visual Git cockpit in Quay").
The git-log and IPC streaming pipeline is out of scope; it is covered by a
separate ticket. This note assumes that pipeline delivers commits in an order
where every child comes before its parents.

## Recommendation in brief

- **Row order.** Default to commit-date order with the child-before-parent
  guarantee (`git log --date-order`). Offer topological order
  (`--topo-order`) as a toggle. The lane algorithm needs only the guarantee
  that every child precedes its parents, which both orders give.
- **Lane algorithm.** A single top-down sweep with straight lanes. Each lane
  is a slot that waits for one commit (an "awaited" OID). A commit lands in
  the highest-priority lane that awaits it. Its first parent continues in the
  same lane, and each other parent gets a lane reserved at the merge row.
  Lanes never shift sideways. A freed lane becomes a hole that a later
  allocation reuses. This combines git's `graph.c` column model, JGit's
  `PlotCommitList` free-position reuse, and the "straight branches" rule from
  pvigier's writeup.
- **Compaction.** Do not compact by shifting live lanes, because shifting
  is what makes `git log --graph` lines wander diagonally. Compaction only
  fills holes. New tips take the lowest free lane. A merge's extra parents take
  the nearest free lane to the right of the merge commit, or a new lane on the
  right. Trailing empty lanes are trimmed from the width.
- **Incremental layout.** A row's layout depends only on the rows above it,
  so rows already laid out never change as more rows stream in. Every page of
  K rows, store a checkpoint of the active-lane state. The checkpoint gives a
  place to resume and also says which edges pass through each page, so it
  replaces pvigier's interval tree. When a refresh changes the top of history,
  lay out from row 0 again and stop when a checkpoint matches the old one.
- **Geometry.** Draw each edge as a vertical run in the one lane it owns,
  plus at most one cubic Bézier S-curve that spans exactly one row pitch.
  A merge edge (from a non-first parent) curves at its top end. A first-parent
  edge that joins another lane curves at its bottom end. The control points
  sit straight above and below the endpoints, so the curve meets the vertical
  runs smoothly. The formulas are in the geometry section below.
- **Color.** Hash a normalized track name with a fixed, specified hash
  (FNV-1a 32-bit) into a 12-slot palette. The default branch is pinned to
  slot 0. Each slot has one color for dark themes and one for light themes,
  both defined in OKLCH. Every color computed below has at least 4.7:1
  contrast on its background, above the 3:1 that WCAG 1.4.11 requires for
  graphical objects.

## Sources and licenses

A later ticket decides what may be ported into this AGPL-3.0-only repository.
The "Port?" column is a first read for that ticket, not a legal ruling.

| Source | What it gives | License | Port? |
| --- | --- | --- | --- |
| git `graph.c` (`graph_update_columns`, `graph_insert_into_new_columns`, `graph_increment_column_color`, `graph_output_collapsing_line`, `graph_draw_octopus_merge`), <https://github.com/git/git/blob/master/graph.c> | Column array per row, dedupe of shared parents, octopus layout, per-new-column color cycling | GPL-2.0-only (git `COPYING`: "the only valid version of the GPL as far as this project is concerned is ... v2") | **Describe only.** GPL-2.0-only code cannot be combined with GPL-3.0 or AGPL-3.0 code. |
| git docs, `Documentation/rev-list-options.adoc` (`--date-order`, `--topo-order`, `--graph-lane-limit`) | Ordering guarantees, lane cap | GPL-2.0 (docs) | Facts only |
| vscode-git-graph by mhutchie, `web/graph.ts` (`Graph.determinePath`, `Graph.getAvailableColour`, `Vertex.registerUnavailablePoint`, `Branch.draw`), <https://github.com/mhutchie/vscode-git-graph> | Per-row next free column, colors reused once a branch ends, cubic transition between adjacent rows | **Not MIT.** A custom license since the "Updated License" commits of 2019-05-09: "Permission is NOT GRANTED to publish, distribute, sublicense, and/or sell derivative works." GitHub reports `NOASSERTION`. | **Describe only.** The ticket text calls this MIT. That is out of date. |
| pvigier, "Commit Graph Drawing Algorithms" (2019-05-06), <https://pvigier.github.io/2019/05/06/commit-graph-drawing-algorithms.html> | Temporal topological sort, `curved_branches` vs `straight_branches`, forbidden columns J(c), interval tree for visible edges, client survey | No license stated on the page (all rights reserved by default) | **Describe only**, with citation |
| gitamine by pvigier, `src/renderer/helpers/commit-graph.ts` (`CommitGraph.computePositions`, `getBranchColor`), `src/renderer/components/graph-canvas.tsx` (`drawEdges`), <https://github.com/pvigier/gitamine> | Working straight-branch implementation, elbow-style edges | GPL-3.0 | Probably portable. GPLv3 §13 and AGPLv3 §13 allow combining the two, but the license ticket must confirm. Do not port `computePositions` verbatim: its forbidden-column loop sets `iMin = i` where it means `iMin = iChild`. |
| JGit `org.eclipse.jgit.revplot.PlotCommitList` (`enter`, `handleBlockedLanes`, `handleMerge`, `getFreePosition`, `closeLane`), `PlotWalk` (defaults to `RevSort.TOPO`), <https://github.com/eclipse-jgit/jgit> | Free-position set with lowest-free reuse, "continue the longest lane" heuristic, blocked-position bitset, detour lanes, lane recycling hook (`recycleLane`) | EDL-1.0 (`SPDX-License-Identifier: BSD-3-Clause`) | **Portable** with notice |
| gitgraph.js `packages/gitgraph-core/src/branches-paths.ts` (`smoothBranchesPaths`, `toSvgPath`), `branches-order.ts` (`BranchesOrder.getColorOf`), `template.ts`, <https://github.com/nicoespeon/gitgraph.js> | One-row S-curve with control points at mid-height, straight vertical runs between curves | MIT (repo archived 2024) | **Portable** with notice |
| gleisbau (layout crate split out of mlange-42/git-graph), `src/layout.rs` (`assign_branch_columns`, `assign_group_columns`, `check_merge_collision`, `branch_color`), `src/track.rs` (`BranchInfo.persistence`), `src/settings.rs` (`BranchSettingsDef::git_flow`, `BranchOrder`), <https://github.com/git-bahn/gleisbau>; crates.io `gleisbau` 0.7.5 | Branch-first layout: interval scheduling of whole branches into columns (shortest first), "persistence" priority (main beats develop beats feature), role-based colors chosen by regex | MIT (crate and parent repo) | **Portable** with notice; it is already Rust |
| Sublime Merge theme docs, `commit_edges_control`, <https://www.sublimemerge.com/docs/themes> | `num_colors` ("max 8") colors `color0`..`color7`, which edges cycle through; `line_width` snapped to device pixels | Public docs | Visual reference only |
| GitLens `package.json` color contributions `gitlens.graphLane1Color`..`gitlens.graphLane10Color`, <https://github.com/gitkraken/vscode-gitlens> | A GitKraken-family graph uses a 10-lane palette with separate light and dark values, and the dark values are lighter and less saturated | MIT outside `plus/` | **Visual reference only.** This is GitKraken's own product, so under the GitKraken rule its hex values are not reused. |
| Rust std `DefaultHasher` docs, <https://doc.rust-lang.org/std/hash/struct.DefaultHasher.html> | "The internal algorithm is not specified, and so it and its hashes should not be relied upon over releases." | Docs | Fact |

GitKraken itself is used only through pvigier's published survey. In that
survey, GitKraken is the one client that "draws branches as totally straight
lines" and probably sorts by committer date. No GitKraken bundle, install, or
binary was opened.

## 1. Row ordering

- `--date-order`: "Show no parents before all of its children are shown, but
  otherwise show commits in the commit timestamp order." Recent work stays at
  the top, the way GitKraken and Fork users expect. Parallel branches
  interleave, so more lanes are open at once.
- `--topo-order`: the same child-before-parent rule, and it also "avoid[s]
  showing commits on multiple lines of history intermixed". Fewer lanes are
  open at once, so the graph is narrower, but older commits can appear above
  newer ones.
- pvigier's "temporal topological sort" visits commits by descending
  committer date and runs a DFS through children first. It always yields a
  topological order, gives the same output whatever the input order, and
  costs O(n log n + m). It equals the date order whenever committer dates
  are consistent. Git's `--date-order` already gives the same guarantee, so
  Topos does not need its own sort.
- **Decision:** the layout depends only on the child-before-parent rule. Use
  date order by default and topo order as a user toggle. Both must come from
  the same source so that a reload reproduces the same order. Ties need a
  fixed tie-break; that is the IPC ticket's job.

## 2. Lane allocation

### Data structures (Rust worker)

```text
LaneId   = u16                      // index; x = laneX(LaneId)
TrackId  = u32                      // one first-parent run drawn in one lane
EdgeId   = u32

LaneSlot {
  awaits:   Oid            // the commit this lane is waiting for
  track:    TrackId        // color + identity of what is drawn in this lane
  edge:     EdgeId         // the open edge currently running down this lane
  rank:     u8             // persistence: 0 pinned default branch, 1 named ref,
                           // 2 derived from merge message, 3 anonymous
}

LaneState {
  lanes:    Vec<Option<LaneSlot>>          // holes are None; never shifted
  free:     BTreeSet<LaneId>               // holes below lanes.len()
  awaiting: HashMap<Oid, SmallVec<[LaneId; 2]>>   // oid -> lanes waiting for it
}

Edge {                       // stored append-only, in child-row order
  child_row: u32, parent_row: u32 /* u32::MAX while open */,
  lane: LaneId,              // the lane the vertical run lives in
  child_lane: LaneId, parent_lane: LaneId,
  kind: FirstParent | Merge, parent_index: u8, track: TrackId
}

RowOut { row: u32, oid: Oid, lane: LaneId, track: TrackId, first_edge: EdgeId }
Checkpoint { row: u32, state: LaneState, open_edges: Vec<EdgeId>, hash: u64 }
```

### Sweep (one commit at a time, top-down)

```text
fn place(c: Commit, row: u32, st: &mut LaneState):
    // 1. Where does c land?
    waiting = st.awaiting.remove(c.oid).unwrap_or_default()
    if waiting.is_empty():
        // New tip (no child in the loaded rows). Lowest hole, else append.
        lane  = st.free.pop_first().unwrap_or(st.lanes.len() as LaneId)
        track = new_track(key = track_key_for_tip(c), rank = rank_of_refs(c))
    else:
        // Several children may await c (fork point). Highest priority wins:
        // lowest rank (pinned default branch first), then leftmost lane.
        lane = min_by_key(waiting, |l| (st.lanes[l].rank, l))
        track = st.lanes[lane].track
        for l in waiting where l != lane:
            close_edge(st.lanes[l].edge, parent_row = row, parent_lane = lane)
            //   -> drawn as a vertical run in l plus an S-curve into c (bottom end)
            st.lanes[l] = None; st.free.insert(l)
        close_edge(st.lanes[lane].edge, parent_row = row, parent_lane = lane)
    emit RowOut { row, oid: c.oid, lane, track }

    // 2. Reserve lanes for c's parents (parents are always below c).
    if c.parents.is_empty():                      // root
        st.lanes[lane] = None; st.free.insert(lane)
        return
    p0 = c.parents[0]
    e  = open_edge(row, lane, FirstParent, 0, track)
    st.lanes[lane] = Some(LaneSlot { awaits: p0, track, edge: e, rank })
    st.awaiting[p0].push(lane)      // even if another lane awaits p0 already:
                                    // straight lanes keep this lane open until p0
    for (k, p) in c.parents[1..].enumerate(1):    // merge and octopus parents
        if let Some(&l) = st.awaiting.get(p).and_then(first):
            // p already has a lane coming down: join it (git graph.c dedupe)
            open_join_edge(row, from = lane, into = l, Merge, k) // curve at top
            continue
        l = nearest_free_right_of(st, lane)       // free.range(lane+1..).next()
              .unwrap_or_else(|| append(st))      // else a new rightmost lane
        t = new_track(key = merge_track_key(c, k), rank = 2 or 3)
        e = open_edge(row, l, Merge, k, t)        // child_lane = lane, lane = l
        st.lanes[l] = Some(LaneSlot { awaits: p, track: t, edge: e, rank })
        st.awaiting[p].push(l)

    trim trailing None lanes (pop from lanes, remove from free)
```

`nearest_free_right_of` takes octopus parents in parent order, so their
lanes fan out left to right and their ribbons do not cross each other. JGit
`handleMerge` reserves a lane for the merge side in the same way. git
`graph_update_columns` likewise puts new parent columns to the right of the
commit.

**Why there is no forbidden-column search.** pvigier's `straight_branches`
places a commit when the sweep reaches it. It then needs J(c), the set of
columns that are not empty between the highest merge child and c. The sweep
above reserves the merge parent's lane at the merge row, as `graph.c` and
vscode-git-graph do. Nothing else can use that column until the parent
arrives, so no search is needed. JGit needs detour lanes only because it
places lanes when it reaches the parent.

**Pinned default branch.** Before the sweep starts, seed lane 0 with
`awaits = tip(default branch)` and rank 0, but draw nothing until the tip
arrives. Lane 0 then always holds the default branch's first-parent chain,
which matches gleisbau's `persistence` rule ("When two branches want the same
commit, the one that is most persistent wins"). Without pinning, the leftmost
lane wins, which is the tie-break gitamine and pvigier use. JGit's
"continue the longest lane" is an alternative, but it needs a lane-length
table, and its result moves as more rows stream in.

**Commits outside the loaded set** (a page boundary, `--max-count`, or
filtered parents). The lane stays open to the bottom of the loaded rows and
is flagged as an open end (gleisbau `BranchVis.open_end`; vscode-git-graph's
null vertex). When the next page streams in, the same lane continues.

## 3. Recycling and compaction policy

1. **Never shift a live lane.** A shift turns every vertical line below into
   a diagonal for one row. That is git's `GRAPH_COLLAPSING` state, the
   "wandering" look that pvigier contrasts with straight branches.
2. **Free a lane only when its edge ends.** A merge lane ends at the
   parent's row. A first-parent lane that loses the landing contest ends at
   the parent's row with a curve into the parent. A root ends at its own row.
3. **Reuse holes.** New tips take the lowest free index, as JGit
   `getFreePosition` does with `TreeSet.first()`. Merge parents take the
   nearest free lane to the right of the merge commit, or a new rightmost lane.
4. **Immediate reuse is allowed.** A lane freed at row r can receive a merge
   reservation at the same row r. The freed lane's curve sits in the band
   (r-1, r) and the new curve sits in the band (r, r+1), so they meet only at
   the node. A one-row cool-down is an option if the "<" shape reads badly in
   the prototype.
5. **Width** is `lanes.len()` after trailing holes are trimmed. The graph
   column renders at the maximum width over the visible rows, or over all
   rows (open question 2).
6. **Lane cap.** git master documents `--graph-lane-limit=<n>`: "Lanes over
   the limit are replaced with a truncation mark". Topos needs the same
   guard for repositories with hundreds of concurrent lanes. It should be a
   render-time cap, with lanes past the cap drawn as a stub at the cap edge,
   so the layout itself stays the same.

## 4. Incremental and paged layout (100k+ commits)

- **Prefix stability.** `place` reads only `LaneState`, which reflects rows
  0..row-1, so the output for a row is final once that row is emitted. As
  rows stream in, earlier rows never move. This is what keeps lanes stable
  on screen.
- **Checkpoints.** Every K rows (K = 512 is a starting point; benchmark it),
  store a `Checkpoint` with a clone of `LaneState`, the open edge ids (one
  per occupied lane), and a 64-bit hash of `(lanes[].awaits, lanes[].track)`.
  Memory is O((n / K) · W).
- **Visible-edge query without an interval tree.** For a viewport over rows
  [a, b], take the checkpoint at or before a. Its open edges are every edge
  that crosses the page start. Add the edges whose `child_row` falls in
  [page_start, b]; these are contiguous, because edges are stored in
  child-row order. Drop any edge whose `parent_row < a`. The cost is
  O(W + k) for k visible edges. pvigier's interval tree gives
  O(k log m) and was measured at 0.58 ms per frame in gitamine. The
  checkpoint approach gets the same effect from data the sweep already keeps.
- **Jump to a row not yet laid out.** Row r depends on every row above it, so
  the sweep has to run through r. The sweep is linear and cheap per row, so
  that should be acceptable, but it must be benchmarked (see the open
  questions).
- **Refresh after new commits, a fetch, or a rebase.** The layout is a pure
  function of the row order and the pinned refs, so a reload of the same
  history reproduces it exactly. When the top changes, lay out from row 0
  again and compare each new checkpoint hash with the old checkpoint for the
  same commit (match by the OID at the checkpoint row, not by row number).
  At the first match, the lane state is identical, so every later row is
  identical too, and the old rows (shifted by the row delta) can be reused.
- **Do not port vscode-git-graph's approach for this.** Its
  `determinePath` walks one branch at a time forward through the whole
  vertex array, so it needs every commit up front and cannot stream.
- **Do not port gleisbau's approach for this either.** Its
  `assign_branch_columns` sorts whole branches by length and packs their row
  intervals into columns. It produces the tidiest branch-model layout, but
  it needs the full history and can move columns when history grows. It
  could serve as an optional "tidy" mode for small repositories (open
  question 6).

### Complexity

- **Time:** O(n + e) hash operations plus O(log W) for each lane allocated
  or freed, so O((n + e) log W) in total. Here n is the number of commits,
  e the number of parent edges, and W the peak lane count.
- **Working memory:** O(W) for `LaneState`.
- **Output:** O(n + e) for `RowOut` and `Edge` (about 20 bytes per edge),
  plus O((n / K) · W) for checkpoints.
- Per-row passing-lane lists (vscode-git-graph's `connections`, JGit's
  `addPassingLane`) would cost O(n · W). Topos never builds them, because the
  viewport query above rebuilds passing lanes on demand.

## 5. Ribbon geometry (cubic Bézier)

Let the row pitch be **H** (equal to the commit list row height; vscode-git-graph
reads `grid.y` from the table row), the lane pitch **W**, the node radius
**R**, and the left padding **P**:

```text
laneX(l) = P + l·W + W/2
rowY(r)  = r·H + H/2
```

Starting values for the prototype: H = 28, W = 16, R = 4.5, stroke 2, and
P = W/2. vscode-git-graph uses r = 4. gitamine uses `RADIUS` 11,
`OFFSET_X` 22, and `OFFSET_Y` 28.

### The S-curve primitive (one row pitch)

To change lanes from (x0, y0) to (x1, y1) with y1 = y0 + H:

```text
P0 = (x0, y0)
P1 = (x0, y0 + k·H)
P2 = (x1, y1 − k·H)
P3 = (x1, y1)
SVG: C x0,(y0+kH) x1,(y1−kH) x1,y1
```

- Both end tangents are vertical, so the curve joins the vertical runs above
  and below with matching tangents (G1).
- The slope at the midpoint (t = ½) is B′(½) = (1.5·Δx, 1.5·H·(1 − k)),
  so dx/dy = Δx / (H·(1 − k)).
  - k = 0.5 puts both control points at mid-height. This is gitgraph.js
    `toSvgPath`; the midpoint slope is 2Δx/H.
  - k = 0.8 is vscode-git-graph's default `Branch.draw`. Its midpoint slope
    is 5Δx/H, so it reads as a rounded elbow.
  - **Recommendation:** k = 0.6–0.65 as a token, chosen in the prototype.
    Keep k·H ≥ R so the stroke leaves the node through the bottom of the
    circle, which the node paints over.
- Draw nodes after edges so each node covers the stroke ends at its center.

### Edge = vertical run + at most one curve

Each edge owns exactly one lane, `Edge.lane`, and the curve goes at the end
whose node is not in that lane. Because lanes never shift, the rows in
between need no per-row points (gitgraph.js `smoothBranchesPaths` has to
insert them; Topos does not):

```text
xc = laneX(child_lane), yc = rowY(child_row)
xp = laneX(parent_lane), yp = rowY(parent_row)
xl = laneX(lane)

Same lane (lane == child_lane == parent_lane):
    M xc,yc  V yp

Merge edge (lane == parent_lane != child_lane): curve at the TOP
    M xc,yc  C xc,(yc+kH) xl,(yc+H−kH) xl,(yc+H)  V yp

Fork or losing first-parent edge (lane == child_lane != parent_lane):
    // curve at the BOTTOM
    M xc,yc  V (yp−H)  C xc,(yp−H+kH) xp,(yp−kH) xp,yp

Join edge (merge parent already has lane l coming down):
    M xc,yc  C xc,(yc+kH) xl,(yc+H−kH) xl,(yc+H)
    // ends on lane l's vertical line one row below; drawn in l's color
```

- **One-row edges** (parent_row = child_row + 1, different lanes): the
  vertical run is empty and the path is just the S-curve, which is the same
  in both variants.
- **Long spans** (thousands of rows): one `V` command, and the curve stays
  at one end. When the visible rows are [a, b], clamp the vertical run to
  [rowY(a) − H, rowY(b) + H]. Very long `V` segments then never reach the
  rasterizer, and the clamped path stays correct because the run is straight.
- **Octopus merges** (parents 1..k−1): each extra parent becomes its own
  merge edge with its own S-curve out of the same node in the band
  (r, r+1), each to a different lane in parent order. The curves fan out
  from the node like git's `*-.` / `|\ \ \` shape (`graph_draw_octopus_merge`).
  They share a start point and separate as they leave the node.
  If a parent already has a lane,
  its edge is a join edge into that lane.
- **Edge color** is the color of the track that owns the lane. A merge edge
  takes the merged (parent) side's color, and a fork edge takes the child
  branch's color. gitamine's `drawEdges` uses the same rule: `getBranchColor(j1)`
  for merge edges and `getBranchColor(j0)` otherwise.
- **SVG batching.** In the visible window, emit one `<path>` per color slot,
  with many `M…` subpaths, rather than one element per edge. That keeps the
  edge DOM at no more than 12 path elements at any zoom. Draw the nodes as
  one `<g>` of `<circle>` elements, or one `<path>` of arcs, per slot.

### Alternative: rounded elbow

gitamine's `drawEdges` draws a merge edge horizontally along the merge row,
turns it with a quadratic corner of radius R, and then runs it vertically.
A fork edge is drawn the mirror way round. To build the same shape from
cubics with corner radius ρ = min(H/2, |Δx|), s = sign(xl − xc), and
κ = 0.5523, the usual constant for approximating a quarter circle with a
cubic:

```text
Merge elbow: M xc,yc  H (xl − s·ρ)
             C (xl − s·ρ + s·κρ),yc  xl,(yc + ρ − κρ)  xl,(yc + ρ)
             V yp
Fork elbow:  M xc,yc  V (yp − ρ)
             C xc,(yp − ρ + κρ)  (xc + s·ρ − s·κρ),yp  (xc + s·ρ),yp
             H xp
```

Elbows read as "rails". However, the horizontal runs of an octopus merge all
overlap on the merge row, and every horizontal run crosses the lanes between
its ends exactly at a node row. S-curves cross in the gap between rows, so
the recommendation is S-curves by default, with the elbow as an option the
prototype compares (open question 3).

## 6. Lane and branch colors

### Key: what a color belongs to

Color belongs to a track (a run of first parents that occupies one lane),
not to a lane index. Colors picked by lane index or by allocation order
change whenever the layout changes. gitamine `getBranchColor(j)` picks by
column, and Sublime Merge's `num_colors` cycles through a fixed set (its
docs do not say what it cycles by). git
`graph_increment_column_color` advances a counter for each new column, and
vscode-git-graph `getAvailableColour` takes the first color whose last
branch has ended. Each of these depends on the order of allocation. In
Topos, the track's color key is chosen once, when the lane is allocated,
and never changes:

1. If the tip commit carries a branch ref, the key is the ref name with
   `refs/heads/` or `refs/remotes/<remote>/` stripped, so `main` and
   `origin/main` share a color. When there are several refs, use the
   checked-out branch first, then local before remote, then the name that
   sorts first.
2. A lane allocated for a merge's extra parent takes the branch name parsed
   from the merge message (`Merge branch 'x'`, `Merge pull request #N from
   owner/x`, `Merge remote-tracking branch 'origin/x'`). gleisbau does the
   same for branches derived from merge summaries (`BranchInfo` "derived from
   merge summary").
3. Otherwise, use an immutable anchor: the tip OID, or for a merge lane, the
   merge OID together with the parent index. Commits never change, so the
   color is the same on every reload.

### Slot

```text
slot(key) = 0                                   if key is the default branch
          = 1 + (fnv1a_32(utf8(key)) mod 11)    otherwise
```

FNV-1a needs no dependency and gives the same result in Rust and TS. **Do not
use** Rust's `DefaultHasher` or `HashMap`'s `RandomState`. The std docs say
its hashes "should not be relied upon over releases", and `RandomState` is
random for each process.

### Palette (OKLCH, gamut-clipped by reducing chroma)

Twelve hues spaced 30° apart, starting at 255° so that slot 0 is blue. For
dark themes: L = 0.76, C ≤ 0.14, checked against Quay's `body` background
`#0d1117`. For light themes: L = 0.54, C ≤ 0.17, checked against `#ffffff`.
The values below were computed with the OKLab → linear sRGB matrices, and the
contrast is the WCAG relative-luminance ratio.

| Slot | Hue | Dark | Contrast on #0d1117 | Light | Contrast on #ffffff |
| --- | --- | --- | --- | --- | --- |
| 0 | 255 | `#7ab4fe` | 8.82 | `#106dce` | 5.13 |
| 1 | 285 | `#a9a5ff` | 8.56 | `#685acb` | 5.38 |
| 2 | 315 | `#d294ee` | 8.34 | `#9348b1` | 5.52 |
| 3 | 345 | `#ef8bc5` | 8.26 | `#af3b85` | 5.57 |
| 4 | 15 | `#fd8994` | 8.29 | `#bc364e` | 5.54 |
| 5 | 45 | `#f99262` | 8.41 | `#b44901` | 5.40 |
| 6 | 75 | `#e4a339` | 8.64 | `#946406` | 5.16 |
| 7 | 105 | `#bfb53b` | 8.93 | `#797202` | 5.00 |
| 8 | 135 | `#89c566` | 9.21 | `#428104` | 4.79 |
| 9 | 165 | `#40cd9b` | 9.36 | `#07835e` | 4.78 |
| 10 | 195 | `#10caca` | 9.29 | `#017f7f` | 4.84 |
| 11 | 225 | `#1bc3f3` | 9.12 | `#017a9b` | 4.92 |

- Define the palette as CSS custom properties (`--topos-lane-0` …
  `--topos-lane-11`) and redefine them per theme. The Rust worker sends only
  the slot number, so a theme switch never triggers a new layout. Quay is
  dark-only today (`src/index.css` sets `color-scheme: dark`). The light set
  is ready for when Quay gets a light theme.
- Keeping L constant gives every slot roughly the same visual weight. GitLens
  also uses separate light and dark lane palettes, with lighter, less
  saturated dark values (visual reference only).
- Color must not be the only cue (WCAG 1.4.1). Branch labels sit on their
  tip rows, hovering a ribbon highlights its whole track, and the
  checked-out branch gets a ring node (vscode-git-graph draws `current` as a
  stroked circle). Neighbouring hues that are 30° apart can be hard to tell
  apart for color-vision-deficient users, so the prototype should run a
  CVD simulation pass over the palette.
- **Collisions.** Two adjacent lanes get the same or a neighbouring slot
  with probability of about 3/11 per pair. Pure hashing accepts this to keep
  colors stable. The alternative is open question 4.

## New open questions for later tickets

1. **Edge style.** The prototype should compare the S-curve (with k
   between 0.5 and 0.8) against the rounded elbow, using real repositories.
   The k and ρ tokens follow from that choice.
2. **Graph column width.** Should it be fixed to the global maximum lane
   count, follow the visible window (which jitters while scrolling), or be
   user-resizable with a lane cap and truncation stubs? What should the cap
   be?
3. **Lane reuse.** Should a freed lane be reused at the same row, or after
   a one-row cool-down? Should new tips take the lowest hole (narrowest
   graph) or the hole nearest their first child?
4. **Neighbour-aware color probing.** At allocation time, if the hashed slot
   is within one hue step of an adjacent active lane, step by 5 (mod 11)
   until it is not. This stays deterministic for a given row order but
   depends on layout context. Decide whether to probe for derived and
   anonymous tracks only, or not at all.
5. **What to pin.** Should lane 0 hold the default branch, `HEAD`, or a
   user-chosen ref? Should more lanes be pinned (for example `develop` in
   git-flow repositories, as in gleisbau's `persistence` and `order` lists)?
6. **Tidy mode.** For small repositories, is a gleisbau-style branch-first
   layout worth offering, given that it needs the full history and is not
   prefix-stable?
7. **Benchmarks.** Measure sweep time and memory on a 100k–1M commit
   repository (for example linux or chromium) to settle the checkpoint
   interval K, and to confirm that jumping to an unloaded row and relaying
   out after a refresh stay within the frame budget.
8. **Licensing.** The license ticket must confirm that gitamine (GPL-3.0)
   may be combined under AGPL-3.0 §13, and must record notice requirements
   for JGit (EDL-1.0/BSD-3-Clause), gitgraph.js (MIT) and gleisbau (MIT)
   before any port.
9. **Interface with the IPC ticket.** The IPC ticket must agree to the
   layout's output shape (`RowOut`, `Edge`, `Checkpoint`), to how open edges
   at a page boundary are sent, and to the tie-break in row order that makes
   layouts reproducible.
