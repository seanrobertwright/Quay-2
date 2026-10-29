# Topos scale budget (#370)

<!-- Measurement tables and commands run past 80 columns. -->
<!-- markdownlint-disable MD013 -->

Throwaway code on the `ticket-370` branch, which is built on `ticket-351` and is
never merged. The decisions go into the build tickets; the code does not.

## The question

What scale budget does Topos commit to on repositories of 100k to 1M commits?
Issue #370 asks for five measurements:

- time to first rows and to a full layout, and memory;
- the checkpoint interval against the cost of a splice on refresh;
- how to scroll past Chromium's element-height limit;
- the cost of the two #353 provenance trailer fields;
- whether a full-history "tidy" layout mode is worth offering.

## Run it

```sh
# Synthetic repos from the #351 model (commit objects only, like a treeless clone).
node --experimental-transform-types --import ./scale/register.mjs scale/gen-repo.ts 1053000 <dir>/syn-1m.git

# git log -z stream timings. The third argument "nograph" forces core.commitGraph=false.
node --experimental-transform-types --import ./scale/register.mjs scale/bench-git.ts <repo> 3 [nograph]

# Lane pass, page JSON, heap and the splice experiment.
node --expose-gc --max-old-space-size=24000 --experimental-transform-types --import ./scale/register.mjs scale/bench-layout.ts <repo>

# Lane width in date order against topo order.
node --experimental-transform-types --import ./scale/register.mjs scale/tidy.ts <repo>

# Canvas: run `pnpm proto:topos:prod`, then drive it in Edge (WebView2's engine).
node scale/drive.mjs 1000000,1500000,2000000 native,scaled
```

Run all commands from `src/slices/git/topos-prototype`.

`?scroll=scaled` on the prototype page turns on the scaled-scrolling mode this
ticket adds to `GraphViewport.tsx`. The page's Commits menu now goes up to 2M.

## Repositories

| Repo | Commits | Refs | Notes |
| --- | --- | --- | --- |
| git.git | 85,883 | 8 | Real. Treeless bare clone, no tags. |
| syn-100k / syn-500k / syn-1m | 100,189 / 500,480 / 1,001,006 | 49 / 175 / 332 | The #351 generator with 8 live branches. 15% of commits carry `Quay-Agent`, 10% a Claude `Co-authored-by`. |
| linux | 1,503,174 | 955 | Real. Treeless bare clone with its 953 tags. |

Machine: Windows 11, 32 logical cores, git 2.55.0.windows.5, Node 24.20,
Edge (stable) at DPR 1. Times are medians of 3 runs.

## Findings

### 1. The git stream

Times are in ms from spawn. "First page" means the first 512 records. All runs
use date order.

| Repo | Commit-graph | First page | Full stream | Full stream with trailers |
| --- | --- | --- | --- | --- |
| git.git | no | 501 | 738 | 1,061 |
| git.git | yes | 26 | 765 | 1,153 |
| syn-500k | no | 1,775 | 3,436 | 4,284 |
| syn-500k | yes | 355 | 3,612 | 5,128 |
| syn-1m | no | 3,681 | 7,563 | 9,473 |
| syn-1m | yes | 741 | 8,420 | 12,094 |
| linux (no tags) | no | 9,592 | 16,501 | 30,884 |
| linux (no tags) | yes | 67 | 20,184 | 35,956 |
| linux (953 tags) | yes | 1,232 | 20,646 | 36,408 |

- **Without a commit-graph, the first page waits for nearly the whole walk.**
  It took 1.8 s at 500k, 3.7 s at 1M and 9.6 s on Linux. #369's speed-up banner
  (first rows over 1 s) fires on every repo past about 300k commits that lacks
  one.
- **`--tags` in the rev set is the largest single lever.** With a commit-graph,
  removing `--tags` (keeping `--branches --remotes HEAD`) cut the first page:
  - Linux: from 1,235 ms to 70 ms;
  - syn-1m: from 784 ms to 33 ms.

  Old tags make git walk deep before it can emit anything in date order. Only
  30 of Linux's 1.5M commits are reachable from a tag and from no branch.
  Tag badges still come from `for-each-ref`.
- **The full stream is linear in rows**, at about 8 to 14 µs per row, and does
  not get faster with a commit-graph. The session pauses on backpressure (#350),
  so only rows that are actually loaded cost anything.
- **Writing a commit-graph** (`commit-graph write --reachable --split`) took
  0.56 s at 100k, 3.1 s at 500k and 7.5 s at 1M.
- **Trailer fields (#353)** add 42% to 78% to the full stream with a commit-graph: on Linux,
  20.6 s becomes 36.4 s, and on syn-1m, 8.4 s becomes 12.1 s. They add
  nothing measurable to the first page (+0 to 7 ms). On Linux that is about
  10.5 µs per row, or 5 ms per 512-row page.

### 2. The lane pass and memory

The lane pass runs in TypeScript, as a stand-in for the Rust worker, on the
real stream (Node, buffered).

| Repo | Lane pass | Per row | First page | Peak lanes | Page JSON | JS heap for the history |
| --- | --- | --- | --- | --- | --- | --- |
| git.git | 141 ms | 1.64 µs | 3.1 ms | 282 | 177 B/row | 33 MB |
| syn-500k | 560 ms | 1.12 µs | 5.2 ms | 18 | 137 B/row | 139 MB |
| syn-1m | 1,093 ms | 1.09 µs | 5.1 ms | 19 | 138 B/row | 269 MB |
| linux | 2,494 ms | 1.66 µs | 12.8 ms | 755 | 186 B/row | 902 MB |

In the browser (production build, synthetic source, typed-array pages):

| Rows | Worker lane pass | Main-thread ingest (max page) | JS heap after load |
| --- | --- | --- | --- |
| 949,570 | 615 ms | 689 ms (17.9 ms) | 217–275 MB |
| 1,424,261 | 910 ms | 1,068 ms (36.4 ms) | 328–335 MB |
| 1,898,788 | 1,202 ms | 1,426 ms (35.6 ms) | 393–532 MB |

- The lane pass is never the bottleneck: git's stream costs about 8 times more
  per row.
- The heaviest page ingests on the main thread exceed a frame (18 to 47 ms) once
  the store passes about 1M rows. That is typed-array growth plus GC, and it
  drops frames while history is still loading.
- The frontend holds about 230 to 290 B per row.

### 3. Scrolling past the height limit

- **The limit is lower than #351 assumed.** In Edge at DPR 1, a spacer stops at
  **11,184,809 px**, which is about 33.5M / 3. At H = 28 that is **399,457
  rows**, not 1.2M. With native scrolling at 1M, 1.5M and 2M rows, the last row
  reachable was row 399,457 every time. #351's 475k-row run could not have
  shown its last ~76k rows.
- **Scaled mode** caps the spacer at 8M px and makes a virtual offset `v` the
  source of truth:
  - Wheel deltas move `v` 1:1. One notch arrives as `deltaY = 300` here and
    moves 10 to 11 rows.
  - The scrollbar maps proportionally.
  - Keyboard and jumps set `v` directly.
  - The spacer uses `overflow: clip`, so overscan rows past it don't grow the
    scroll height.

  It reached the last row at 950k, 1.42M and 1.9M rows.
- **Frame rate:** at 60 fps with p95 frames of 16.8 ms in every case, native and
  scaled, from 200k to 1.9M rows, on Steady, Fling and Jumps. At most 2 frames
  in about 300 exceeded 20 ms.
- **Cost:** scaled mode gives up Chromium's smooth-scroll animation on the wheel.
  A build may add a short eased animation of `v`.

### 4. Splice on refresh

The experiment: an "old" session lacks the newest K commits, and the "new"
session is the full history. The table counts how many rows the new pass lays
out before a row's `(oid, lane state)` matches an old checkpoint.

- **#354's rule as written never matches.** After K prepended commits, the old
  checkpoint rows sit at `old + K`, which isn't a multiple of the interval. A
  pass that tests only its own checkpoint rows never visits one. The pass must
  test **every** new row against a map from old checkpoint oid to lane state.
- **On synthetic repos, with that fix,** denser checkpoints converge much
  sooner:
  - an interval of 16 to 64 is as good as checking every row;
  - 512 and 2048 often fall back to Reset;
  - on syn-1m, K = 10 converges at 3,354 rows with an interval of 16, 101,450
    with 64, and never with 512.
- **On real repos, splices barely help.**
  - git.git converges only at row 85,509 of 85,883, which in practice is never.
  - Linux converges at row 663k (K = 1) to 1.28M (K = 1000), at every
    interval.

  Real graphs keep hundreds of lanes open at once, and every lane has to line up
  before a match counts.
- **So on real repos a refresh is effectively a Reset of the loaded rows.** Its
  cost scales with how many rows are loaded, not with history size. At git's
  8 to 14 µs per row, a 20k-row prefix re-streams in about 0.2 s.

### 5. A tidy layout mode

Lane width per row, from `tidy.ts`. The oracle row comes from
`git log --graph`, measuring line width / 2.

| Repo | Order | Peak | Mean | p95 | Rows wider than 12 lanes |
| --- | --- | --- | --- | --- | --- |
| git.git | date | 282 | 203 | 269 | 98% |
| git.git | topo | 280 | 192 | 268 | 95% |
| git.git | `git log --graph`, date order | 190 | 84 | | |
| linux | date | 755 | 427 | 622 | 100% |
| linux | topo | 810 | 460 | 662 | 100% |
| syn-1m | date | 19 | 10.4 | 13 | 7% |
| syn-1m | topo | 47,109 | 25,611 | 47,106 | 100% |

- **Topo order is not narrower on real repos.** It is pathological on the
  synthetic one; `git log --graph` agrees, with a mean of 1,732 at 100k.
- **Our never-shift pass is about 2.4 times wider than git's own graph on
  git.git** (mean 203 against 84). Holes left by freed lanes still count toward
  the drawn width, and git compacts them away.
- **Long real histories are inherently wide**: Linux averages 427 lanes even on
  a single branch. A tidy mode would have to load and lay out the whole history
  first, which is 20 to 36 s of git on Linux. It would also lose streaming and
  splicing, and it still would not fit 12 lanes. The #351 stub column, the #368
  branch filter, and a possible first-parent view do more for the same cost.

## Proposed budgets

These are on the machine above. A build ticket's CI may scale them to its
runner.

1. **First page on screen ≤ 300 ms** on a repo with a commit-graph, up to 1.5M
   commits, measured from `git_graph_open` to the first painted rows. This
   assumes the walk drops `--tags`.
2. **Without a commit-graph**, rows appear when git emits them (up to about 10 s
   on Linux), with a progress line, and #369's banner offers the write.
3. **Lane pass in Rust ≤ 1 µs per row.** The TypeScript stand-in runs at 1.1 to
   1.7 µs.
4. **Eager load ≤ 50k rows** (the soft cap). Beyond that, pages load on demand
   as the viewport nears the loaded end, or when a jump or search needs them.
5. **Frontend memory ≤ 300 B per loaded row**, which is 600 MB at 2M.
6. **Main-thread ingest ≤ 8 ms per 512-row page at p95**, including at 2M
   loaded rows. Preallocate typed arrays by doubling, never per page.
7. **60 fps**, with p95 frames ≤ 16.8 ms and ≤ 1% of frames over 20 ms, on
   Steady, Fling and Jumps at 2M rows.
8. **Native scrolling up to an 8M px spacer, scaled mode above it.** The last
   row must be reachable at 2M rows, and a wheel event moves the content by
   exactly its `deltaY`.
9. **Splice:**
   - test every new row against old checkpoint oids, using a 64-row checkpoint
     interval (separate from the 512-row page checkpoint);
   - give up after 20k rows and Reset only the loaded prefix;
   - a refresh with up to 20k loaded rows takes ≤ 250 ms.
10. **Trailer fields stay in the stream.** They add 0 to 7 ms to the first page
    and up to about 11 µs per row (Linux).
11. **No tidy mode in v1.**

## Questions this raises for the map

- Should the walk drop `--tags`, and should tag-only commits be omitted with a
  count, or fetched in a second, later pass?
- #354's splice saves almost nothing on real repos. Should #354 be amended to
  the every-row test with a give-up limit, or to "Reset the loaded prefix"
  alone?
- #351's resolution states the height limit as 33.5M px (1.2M rows); the
  measured limit is 11.18M px (about 400k rows).
- Narrower lanes (reusing holes, or compacting as git's graph does) and a
  first-parent view are candidates for the map's fog.
