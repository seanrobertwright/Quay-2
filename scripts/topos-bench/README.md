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

`drive.ts` first runs the Rust tests
`lane_pass_costs_at_most_a_microsecond_per_row` and
`a_refresh_with_20k_loaded_rows_takes_at_most_250_ms` in the release profile.
It then checks these budgets on each recording, and exits 1 when any is
missed:

| Budget | Pass when |
| --- | --- |
| Lane pass (once per run) | the Rust lane pass costs at most 1 µs per row over 1M synthetic rows |
| Refresh (once per run) | with 20k rows loaded from a 30k-commit synthetic repo, each of three refreshes that reset and three that splice takes at most 250 ms, from the request until the `Reset` or `Splice` and every row it brings are sent |
| First rows | the session's time to its first Rows page, from the recording's `.json`, plus the page's time from that page to the first frame that shows rows, is at most 300 ms |
| Frontend memory | the JS heap after a full GC grows by at most 300 B per loaded row from before the recording is fetched to after it is applied |
| Main-thread ingest | p95 of the per-page time, decode plus store ingest, is at most 8 ms per 512-row page |
| Last row reachable | the last row is on screen after the scrollbar goes to the bottom, and after End |
| Wheel fidelity, scaled lists only | one wheel event, and then ten, move the content by exactly the deltaY the list received, within 0.5 px |
| Steady, Fling and Jumps | the unrounded p95 frame is at most 16.8 ms, allowing 1 ns of float noise from subtracting timestamps, and at most 1% of frames are over 20 ms |

- **Steady** and **Fling** send real wheel input through Edge at 3,000 and
  15,000 px/s for 5 s.
- **Jumps** moves the scrollbar to a random place every frame for 5 s.
- Natively, the browser owns the wheel. For Playwright's wheel it scrolls
  100 px while it reports deltaY 300, so the wheel check skips lists short
  enough to scroll natively.

- **Refresh** times the Rust session alone. The frontend then ingests the
  rows it sends, about 40 pages for 20k rows, at the per-page cost the Ingest
  column shows.
- **First rows** leaves out the Tauri IPC hop from the session to the page.
  The spec states this budget for repos with a commit-graph and up to 1.5M
  commits. The gate holds every recording to it, so a 2M recording that misses
  it is stricter than the spec.

The run also prints rows and load time. They are information, not budgets.

### Budgets this benchmark does not check

Of the spec's Scale budgets, the table above covers 1, 3, 5, 6, 7, 8 and 9.
The others are checked elsewhere or have nothing to measure yet:

| Budget | Where it stands |
| --- | --- |
| 2. Rows appear without a commit-graph, with a progress line and the speed-up banner | Behavior, not a timing. The banner is #385. |
| 4. At most 50k rows load eagerly | `DEFAULT_SOFT_CAP` in the Rust session, with its soft-cap tests |
| 10. Trailer fields add at most 10 ms to the first page | The session always asks git for the trailers, so there is no trailer-free session to compare against. #370 measured +0 to 7 ms. #381 timed git's first 512 records with and without the two fields, median of 25 interleaved runs: +1.5 ms on `syn-1m` and +7.3 ms on `linux`. Classifying them in the session left its first-page time where it was. |

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
   Next to it, `<name>.pages.json` holds the session's time to its first Rows
   page. The test runs in the release profile so that time is the optimized
   build's.

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
