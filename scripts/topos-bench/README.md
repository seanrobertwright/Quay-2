# Topos scale benchmark

<!-- Commands and result tables run past 80 columns. -->
<!-- markdownlint-disable MD013 -->

The spec's Scale budgets (#370, #371) as a scripted benchmark on a production
build (#377). It follows the throwaway driver on branch `ticket-370`, but
measures the real frontend: the `GraphFeed` and `GraphList` that Topos ships,
fed with pages the real Rust graph session wrote.

## A pre-merge gate, not a CI job

Run this benchmark before you merge a change to Topos's graph: the session,
the page format, the store, the lane pass, or the canvas. Put its table in the
PR. It needs a desktop, Edge, Rust, and several GB of generated repos, and it
measures frame timing on a real display. That is why it is not a per-push CI
job, and no workflow runs it.

## What it checks

`drive.ts` checks these budgets on each recording, and exits 1 when any is
missed:

| Budget | Pass when |
| --- | --- |
| Main-thread ingest | p95 of the per-page time, decode plus store ingest, is at most 8 ms per 512-row page |
| Last row reachable | the last row is on screen after the scrollbar goes to the bottom, and after End |
| Wheel fidelity, scaled lists only | one wheel event, and then ten, move the content by exactly the deltaY the list received, within 0.5 px |
| Steady, Fling and Jumps | p95 frame is at most 16.8 ms, rounded to the 0.1 ms the budget is stated in, and at most 1% of frames are over 20 ms |

- **Steady** and **Fling** send real wheel input through Edge at 3,000 and
  15,000 px/s for 5 s.
- **Jumps** moves the scrollbar to a random place every frame for 5 s.
- Natively, the browser owns the wheel. For Playwright's wheel it scrolls
  100 px while it reports deltaY 300, so the wheel check skips lists short
  enough to scroll natively.

The run also prints rows, load time and JS heap. They are information, not
budgets. The heap includes the recording's own buffers.

## Inputs

These inputs live outside the repository, under the OS temp directory or a
path you choose. Never commit them. The commands below use `$B` for that
directory, for example `$(node -e "console.log(require('os').tmpdir())")/quay-topos-bench`.
Run every command from the repository root.

1. **Synthetic repos** come from `gen-repo.ts`, which writes only commit
   objects, like a treeless clone. Give each one a commit-graph, as a real repo
   with Topos's speed-up banner accepted would have.

   ```sh
   for n in 100000:syn-100k 500000:syn-500k 1000000:syn-1m 2000000:syn-2m; do
     node scripts/topos-bench/gen-repo.ts ${n%%:*} "$B/${n##*:}.git"
     git -C "$B/${n##*:}.git" commit-graph write --reachable
   done
   ```

2. **A treeless Linux clone.** Graph sessions never walk tags (#370), so the
   clone skips them.

   ```sh
   git clone --bare --filter=tree:0 --no-tags --single-branch --branch master https://github.com/torvalds/linux.git "$B/linux.git"
   git -C "$B/linux.git" commit-graph write --reachable
   ```

3. **Recordings.** `dump-pages.ts` runs the ignored Rust test
   `dump_graph_session_for_benchmark`. The test opens a graph session on a repo
   through the code `git_graph_open` uses, grants every row up to the 2M hard
   cap, and writes each channel message to a file as the frontend receives it.

   ```sh
   for r in syn-100k syn-500k syn-1m syn-2m linux; do
     node scripts/topos-bench/dump-pages.ts "$B/$r.git" "$B/$r.pages"
   done
   ```

## Run it

```sh
pnpm topos:bench "$B/syn-100k.pages" "$B/syn-500k.pages" "$B/syn-1m.pages" "$B/linux.pages" "$B/syn-2m.pages"
```

The script builds `page/` for production into `$TMP/quay-topos-bench/dist`. It
serves the page on a free localhost port with Quay's release CSP, plus
`connect-src 'self'` for the recording. It then opens the page in Edge, which
uses WebView2's engine, at 1600 × 1000.

Keep the Edge window in front and leave the machine alone while the benchmark
runs. A hidden window throttles its frames. The budgets were set on the #370
reference machine: Windows 11 with 32 logical cores, at DPR 1. Results on a
slower machine say more about that machine than about the change.
