# Code review: ticket-374, Topos graph session and virtualized list

**Stats:**

- Files Modified: 6
- Files Added: 17
- Files Deleted: 0

## Issues

```text
severity: high
file: src/slices/git/topos/useGraphSession.ts
issue: Two opens in flight at once could reach the backend in either order, so an older open could replace the newer session.
detail: StrictMode mounts the effect twice in dev, and a fast repo switch does the same in production. If open B ran before open A, A dropped B and A's cleanup then closed A, so no session was left and the list stayed on "Loading" forever.
suggestion: Run every open and close through one queue, in the order asked. Fixed in this change.
```

```text
severity: medium
file: src/slices/git/topos/useGraphSession.ts
issue: On a repo switch the list remounted with the new key while still holding the old feed.
detail: Its first effect could call git_graph_more on the old session, and for one frame the new repo's list showed the old rows.
suggestion: Hand out a feed only for the repo path it was opened for. Fixed in this change.
```

```text
severity: medium
file: src/slices/git/topos/GraphList.tsx
issue: The spacer is rowCount * 28 px tall, so rows past about 399k can't be scrolled to in WebView2.
detail: #370 measured the height limit at 11,184,809 px. The backend's hard cap is 2M rows, the #370 budget.
suggestion: Scaled scrolling above an 8M px spacer is #377. Left for that ticket and named in the PR.
```

```text
severity: low
file: src-tauri/src/slices/git/graph/session.rs
issue: read_object held the live-session lock for the whole cat-file round trip, and git_graph_more took that lock on an async worker thread.
detail: A long read, or an open waiting for the old git to exit, would block more, open and close behind it.
suggestion: Clone the session's cat-file handle and release the lock before reading, and run more in block_in_place like open and close. Fixed in this change.
```

```text
severity: low
file: src-tauri/src/slices/git/graph/page.rs
issue: The page carried committer times that nothing read.
detail: That was 8 bytes per row on the wire, and a section the decoder validated for no consumer.
suggestion: Left out of format 1. Commit details (#397) fetch the committer on demand. Fixed in this change.
```

```text
severity: low
file: src/App.tsx, src/slices/git/topos/useGraphSession.ts
issue: A second root-repo lookup and a second copy of errorMessage.
suggestion: Use activeRootRepo, and export errorMessage once from gitVersion.ts. Fixed in this change. A dead stale-response guard in reachedRow now compares against the feed on screen.
```

```text
severity: low
file: src/slices/git/topos/ToposOverlay.tsx
issue: The graph area was blank until the feed existed.
suggestion: Show "Loading commits…" until then. Fixed in this change.
```

Checked and found sound:

- A paused walk holds git mid-walk: the queue fills, then the pipe, and resuming continues the same walk. The test runs 12,000 commits and checks every row arrives once, in git's order.
- `Paused` is sent only when another row is waiting, so a soft cap equal to the history ends with `Done`.
- A closed session sends nothing more, and its git is killed, never left running.
- A repo with an unborn HEAD walks its branches alone, and an empty repo ends with `Done` and no rows.
- Each `GraphEvent` serializes to its camelCase fixture.
