# Topos graph prototype (#351)

Throwaway code. It lives on the `ticket-351` branch and is never merged.
The decisions it settles go into the build tickets; the code does not.

## The question

How should the React 19 virtualized SVG graph be structured to hold 60 FPS
on repositories with 10,000+ commits? How does row windowing coordinate with
ribbons that span visible and off-screen rows? How are sticky branch badges,
hover tooltips and commit hit-targets built? It also carries the questions
inherited from #348 and #350: edge style and its k and corner radius, graph
column width and lane cap, color-clash probing, and the per-page payload.

## Run it

```sh
pnpm install
pnpm proto:topos                      # dev server, opens the page on port 1430
pnpm proto:topos:dump <repo> [name]   # adds a real repo to the Source menu
pnpm proto:topos:prod                 # production build on port 1431
```

Judge frame rates on `proto:topos:prod`. Dev-mode React 19 records a debug
stack for every element it creates. In the dev server that cut random jumps
through 191k rows from 60 to about 35 FPS.

Every control is kept in the URL, so a setting can be shared as a link. The
yellow bar at the bottom (or the left and right arrow keys, when focus is not
in the list or a form control) cycles three presets:

- **A**: S-curve, k = 0.62, graph column at the global maximum lane count.
- **B**: rounded elbow, ρ = 6, column width follows the visible rows.
- **C**: S-curve, k = 0.8, user-resizable column, clash probing for derived
  and anonymous tracks.

The #370 scale measurements, their scripts and findings live in
[`scale/`](scale/README.md). `?scroll=scaled` turns on the scaled-scrolling mode
they added.

## How it is built

- `layout.worker.ts` stands in for the Rust graph session. It loads a
  history (synthetic, or a dump from `dump-repo.mjs`), runs the lane pass
  from `lanes.ts` one 512-row page at a time, and posts each page as soon as
  it is laid out. `lanes.ts` is written fresh from the #348 findings, as #355
  requires.
- `store.ts` holds the frontend copy in growable typed arrays. Rows and edges
  are append-only and stored in child-row order.
- `GraphViewport.tsx` is the canvas. Its header comment lists the structure.
  In short:
  - One scroll container over a spacer `rows × H` tall. Only the rows in a
    window are in the DOM. The window start is rounded down to a multiple of
    the "re-render every" setting, so React renders once per chunk of rows.
  - The SVG covers only the window and uses window-local y, so path numbers
    stay small at any scroll depth.
  - Visible edges come from the checkpoint query: the edges open at the page
    start, plus the edges opened since. No interval tree and no per-row
    passing-lane lists.
  - A ribbon whose ends are off-screen is drawn as one clipped vertical run.
    Its curve is drawn only when that end is within the window.
  - Edges are batched into one `<path>` per color slot: at most 12 edge
    elements, plus one for capped lanes and one for the hovered track.
  - Hit-testing is arithmetic in one `pointermove` handler: `row = y / H`,
    then the node in that row's lane, else the nearest ribbon lane in that
    row. There are no per-node listeners and only one tooltip element.
  - Sticky badges: a strip above the list names each track that passes the
    top visible row but whose tip has scrolled out of view. Clicking a badge
    or a ribbon jumps to where that track starts.
- `geometry.ts` turns `(row, lane)` data into S-curve or elbow paths using the
  #348 formulas.

## Payload shape this prototype proposes

- One message per 512-row page holds that page's rows and the edges whose
  child row falls in the page.
- An edge whose parent lies in a later page is sent once, with
  `parentRow = OPEN_ROW`. A later page carries a `close` triple for it:
  edge id, parent row and parent lane. So edges stay sorted by child row,
  and the frontend can binary-search them.
- Each page carries its checkpoint: the ids of the edges open at its first
  row.
- Track records (id, name, slot, rank) arrive in the page that creates them.
  Refs arrive keyed by row.
- `laneCount` is the peak lane count so far, for the global-width column.

## Measurements

These are headless Edge runs on the developer's Windows machine at a 1500×900
viewport, using the production build (`proto:topos:prod`) under Quay's release
CSP. The benchmark scrolls the list for five seconds per mode.

| History | Rows | Lanes | First page | All pages | Steady | Fling | Jumps |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ghostty | 15,230 | 29 | 460 ms | 609 ms | 60 | 60 | 60 |
| syn, 30 live | 9,632 | 38 | 98 ms | 177 ms | 60 | 60 | 60 |
| syn, 30 live | 191,044 | 41 | 460 ms | 2.5 s | 60 | 60 | 60 |
| syn, 8 live | 474,830 | 19 | 1.2 s | 6.6 s | 60 | 60 | 58 |

"Lanes" is the peak lane count. "syn, 30 live" is the synthetic history with
30 live branches. Steady, Fling and Jumps are average FPS.

"First page" includes loading the source. For ghostty that means fetching and
parsing a 2.6 MB JSON dump inside the worker. In the dev server the same
ghostty page showed the first page at 79 ms.

Payload, 191k rows, dev server: typed arrays took 23.3 MB in total and 193 ms
of main-thread ingest. JSON took 25.9 MB and 311 ms. The largest single page
cost about 12 ms to ingest either way: under one frame, but not by much.
Typed arrays win on total throughput, not on the worst page.

## Findings so far

- **60 FPS holds** with this structure from 10k to 475k rows. Frame time does
  not depend on history length; only the window size does.
- **Pin lane 0 to whichever default-branch tip arrives first.** Pinning it to
  the local `master` left lane 0 empty for the whole top of the graph in an
  agent worktree whose local `master` was behind `origin/master`. The lane
  pass now waits for the local and remote tips together.
- **The spacer has a ceiling.** Chromium caps an element at about 33.5M px.
  At H = 28 that is about 1.2M rows. Beyond that, the scroll needs to be
  scaled or paged.
- **A module worker from `'self'` loads under Quay's release CSP** with no
  change. The real build streams over IPC instead, so `connect-src` needs no
  change either; only this prototype's preview adds `'self'` to fetch its
  dumps.
- **Global width wastes space** in deep history. ghostty peaks at 29 lanes,
  but the screens captured near rows 5,000 and 7,000 used between 4 and 11.
  Visible-rows width avoids that but jumps as you scroll. React to presets
  A, B and C to choose.

## What to react to

1. S-curve or elbow, and the k or ρ value.
2. Graph width: global maximum, visible rows, or resizable, and the lane cap.
3. Clash probing: off, derived and anonymous tracks only, or every track.
4. Sticky badge strip: keep it, change it, or drop it.
5. Payload: typed arrays or JSON for the Channel.
