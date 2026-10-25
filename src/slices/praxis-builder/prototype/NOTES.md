# Praxis Builder canvas prototype (#226)

Throwaway. Delete this folder, `praxis-builder.prototype.html` and the
`proto:praxis-builder` script once the verdict below is recorded on #226.

## Question

How should the builder's canvas and per-kind inspector look and behave? See
[#226](https://github.com/seanrobertwright/Quay-2/issues/226).

## Run it

```sh
pnpm proto:praxis-builder
```

Run it from a checkout of the `prototype/praxis-builder-canvas` branch. It
opens `http://localhost:1430/praxis-builder.prototype.html`. Flip
variants with the bar at the bottom or the arrow keys, or add `?variant=A`,
`B` or `C` to the URL. The graph is in memory. Edits carry across variants,
and **Reset sample** restores the sample. **Graph JSON** shows the definition
as it would be saved.

The sample graph uses all 13 kinds. Its `notify` task starts with two problems
(empty `executionKind`, no path to END), so the issue displays have something
to show.

## What each variant answers

A is "Cards, branch handles", B is "Pills, branch picker", and C is "Left to
right, branch on the edge".

### Node look

- A: a wide card with a kind strip, the id, a config summary and in/out chips.
- B: a compact pill. A DECISION is a diamond.
- C: a tile with a severity stripe and a summary, laid out left to right.

### DECISION `then` and `else`

- A: green and red source handles. Dragging one sets `config.then` or
  `config.else` and `dependsOn` together. A side handle gives plain dependents.
- B: plain edges only. An edge out of a decision stays amber until `then` or
  `else` is picked in the inspector, and picking adds the `dependsOn`.
- C: plain edges. Click an edge's label to mark it `then`, `else` or plain.

### Inspector

- A: a docked right panel with every section stacked.
- B: a popover beside the selected node, with Settings, Data and Links panes.
- C: a bottom sheet in columns. With nothing selected it becomes the palette.

### `inputSchema` and `outputSchema`

- A: a raw JSON field.
- B: a field table (name, type, required) with a raw JSON toggle. A schema the
  table can't show opens as JSON.
- C: raw JSON, plus "from an example" and a read-only field list.

### Validation issues

- A: a count badge on the node, and a collapsible Problems list under the
  canvas.
- B: a red or amber ring on the node, and a Problems dropdown in the toolbar.
- C: a stripe on the tile, and a Problems rail that stays open, grouped by
  node.

### Palette

- A: an icon strip on the canvas.
- B: a chip row in the toolbar.
- C: the bottom sheet when nothing is selected.

All three share the per-kind config form (TASK `executionKind`, DECISION
`field`/`equals`/`then`/`else`, JOIN `mode`, LOOP `maxIterations`, an empty
config note for the other kinds), the id field (rename rewrites `dependsOn`
and decision targets), the `dependsOn` editor, and one issue checker. C's form
shows `then` and `else` read-only, since it sets them on the canvas. The
checker ports `validateGraph`'s rules but returns every issue instead of the
first, each with its node and field where it has one. It adds a warning when a
decision's `outputSchema` doesn't declare its `field`.

## Observations while building

- The sample's top-to-bottom layout is 13 ranks deep, so fitting all of it on
  open shrinks A's cards until they're unreadable. Every variant now caps the
  first fit at 60% zoom and centres the graph. C's left-to-right layout suits
  a wide modal better.
- B's popover covers nodes next to the one being edited. The canvas has to be
  panned, or the popover closed, to reach them.
- C's branch control sits on the edge label. At low zoom the label is small,
  and next to a node it overlaps the tile unless the label layer sits above
  the nodes.
- A's handles let `then` and `else` be set without leaving the canvas, but a
  decision needs a third handle for dependents that are not branches.
- The field table can't show most JSON Schema keywords. B keeps a property's
  extra keywords and shows "+N rule", but anything beyond a flat object
  schema still falls back to raw JSON.

## Verdict

Variant A, with B's schema editor.

### Node look

- A: a wide card with a kind strip, the id, a config summary and in/out chips.

### DECISION `then` and `else`

- A: green and red source handles. Dragging one sets `config.then` or
  `config.else` and `dependsOn` together. A side handle gives plain dependents.

### Inspector

- A: a docked right panel with every section stacked.

### `inputSchema` and `outputSchema`

- B: a field table (name, type, required) with a raw JSON toggle. A schema the
  table can't show opens as JSON.

### Validation issues

- A: a count badge on the node, and a collapsible Problems list under the
  canvas.
- The palette must never cover the Problems list. In the prototype, A's
  palette is about 430px tall and runs into the list when the window is under
  about 600px tall.

### Palette

- A: an icon strip on the canvas.
