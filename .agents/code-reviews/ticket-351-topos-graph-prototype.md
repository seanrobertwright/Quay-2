# Code review: ticket-351 Topos graph prototype

Scope: the uncommitted work on `ticket-351`. That is the new throwaway folder
`src/slices/git/topos-prototype/` and three `proto:topos*` scripts in
`package.json`. The code is a wayfinder prototype, so it has no tests and
only minimal error handling by design. This review looks for correctness bugs
that would mislead someone reacting to the prototype.

**Stats:**

- Files Modified: 1
- Files Added: 17
- Files Deleted: 0
- New lines: 2259
- Deleted lines: 0

## Issues

```text
severity: medium
file: src/slices/git/topos-prototype/lanes.ts
line: 49
issue: trackKeyOfRef turns refs/remotes/<remote>/HEAD into the track key "HEAD"
detail: tipTrack sorts the candidate keys by name, and "HEAD" sorts before
  "main". A tip that carries both upstream/HEAD and upstream/main, and that
  does not land in the pinned lane 0, gets a track named "HEAD" with a hashed
  color instead of "main" with slot 0. The ghostty dump has this case:
  upstream/main and origin/main point at different commits.
suggestion: Return null for a remote ref whose short name is HEAD, as
  shortRefName already does.
```

```text
severity: low
file: src/slices/git/topos-prototype/GraphViewport.tsx
line: 344
issue: The tooltip can index past the end of a new store
detail: Hover state holds a row number. If the session changes while the
  pointer stays over the graph, Tooltip reads store.oid[r].slice on a row
  the new store does not have yet, and the page throws.
suggestion: Render nothing when hover.row >= store.rows.
```

```text
severity: low
file: src/slices/git/topos-prototype/layout.worker.ts
line: 85
issue: The payload size counts UTF-16 code units, not bytes
detail: body.length, and meta.length on the columnar path, count JavaScript
  string units. The README reports the totals in MB and compares the two
  formats. Author names and subjects that are not ASCII are undercounted,
  so the comparison skews.
suggestion: Count the UTF-8 length with TextEncoder in the worker, after
  layoutMs is measured.
```

```text
severity: low
file: src/slices/git/topos-prototype/geometry.ts
line: 126
issue: Join edges into capped lanes skip the overflow style
detail: Every other edge that touches a lane at or past the cap is drawn
  as a grey dashed stub. A join edge is drawn in its track color, even when
  both of its ends sit on the stub column. Capped lanes then look
  inconsistent.
suggestion: Drop the EDGE_JOIN exception so every capped edge uses the
  overflow path.
```

```text
severity: medium
file: src/slices/git/topos-prototype/lanes.ts
line: 286
issue: A join edge can end on an empty lane
detail: A join curves into lane `into` and ends one row lower, on the
  assumption that the lane's vertical line continues there. That fails in
  two cases. The common one: a merge of the default branch above the
  default branch's tip joins pinned lane 0 before lane 0 draws anything,
  so the curve ends in empty space. The browser check on the synthetic
  history showed it at row 0. The rare one: the awaited parent is the very
  next row and lands in a higher-priority lane, so lane `into` curves away.
suggestion: When the target lane has no edge yet, open a merge edge down
  that lane and let the tip close it. Leave the rare case as a note for
  the build ticket, which should end a join at the parent's actual lane.
```

```text
severity: low
file: src/slices/git/topos-prototype/GraphViewport.tsx
line: 291
issue: aria-activedescendant can name a row that is not rendered
detail: After a mouse scroll, the selected row can leave the window. The
  listbox then points at an id that is not in the DOM.
suggestion: Leave the code as it is. A real build keeps the active row
  rendered or moves the selection with the scroll. Record it as a note for
  the build ticket.
```

## Fixed in this change

- The `<remote>/HEAD` key bug in `trackKeyOfRef`.
- The tooltip guard for rows the store does not have.
- The UTF-8 byte count for payloads.
- Capped join edges, which now use the overflow style.
- Joins into a pinned lane that has not started, which are now merge edges.

The rare join case and the `aria-activedescendant` finding are left as notes
for the build tickets.
