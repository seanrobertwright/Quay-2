# Glossary

The words Quay uses for one idea each. Use them in code comments, UI text and docs, and don't use
the words listed to avoid under each.

## Praxis Builder: graph runs

**Run canvas**:
The read-only drawing of a graph run's revision in the run's detail.
_Avoid_: live canvas, run overlay

**Graph canvas**:
The builder's editing canvas, called so when text needs to tell it apart from the run canvas.
_Avoid_: plain "the canvas" in text that mentions both

**Node phase**:
The host's own word for where a node stands in a run, the node's `phase` in
`aiws-graph-operator-view/1`, shown verbatim. Quay never shows the node's SDK `status` in its place.
_Avoid_: node state, node status

**Node panel**:
The read-only panel beside a graph run's run canvas for the node selected on it or in the node table.
_Avoid_: inspector, which stays the graph canvas's editing panel

**Node table**:
The table of a run's nodes under the run canvas.
_Avoid_: node list
