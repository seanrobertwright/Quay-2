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

## Shell

The parts of the redesigned shell, named in the shell redesign spec. The build replaces the rail,
the stage header and the status strip with these.

**Module bar**:
The permanent 48 px icon bar on the window's left edge: one icon per module, the terminal status
list, badges and the spend ticker. Its buttons start at x = 0.
_Avoid_: rail, sidebar, activity bar

**Module**:
One of the five groups of Quay's surfaces: Projects, Source control, Agents, Workflows and Project.
Each has one icon on the module bar and one panel.
_Avoid_: section, tool

**Panel**:
The column beside the module bar that shows the open module. Clicking the open module's icon
folds it.
_Avoid_: drawer, sidebar; and "node panel", which is the run canvas's panel

**Terminal status list**:
The column of status dots under the Projects icon, one per terminal, shown whichever panel is open.
_Avoid_: badges, terminal chips

**Stage**:
The middle of the window, between the panel and the companion, where terminal panes and stage
tabs show.
_Avoid_: workspace, main area

**Stage tab bar**:
The 34 px bar on top of the stage that holds terminal and tool tabs, the layout switchers and Zoom.
_Avoid_: stage header, which it replaces

**Companion**:
The right-hand column that shows what the selected terminal is working on.
_Avoid_: drawer, GitHub drawer, side panel

**Companion view**:
One of the companion's views: Pull request, Ticket, Repository, Activity, Run, Topos or Inspector.
_Avoid_: tab, mode

**Terminal link**:
A terminal's two recorded slots, a ticket and a pull request, each with the source that set it
and whether it is pinned.
_Avoid_: association, binding

**Readiness card**:
The card at the top of the companion's pull request view: headline, merge control and the Checks,
Comments, Files and Commits cells.
_Avoid_: merge box

**Status card**:
The card at the top of the companion's ticket view: headline, one state-driven button and the
Blocked by, Comments, Pull request and Details cells.
_Avoid_: issue summary

**Lens**:
A view that slides over the terminal, from the module bar side to the companion's edge, and leaves
the companion in place: the diff lens, the run lens and the Topos lens.
_Avoid_: wide mode, overlay, flip

**Lane**:
The ticket's four-step bar (Ticket, Terminal, Pull request, Merged) and state on a terminal row in
the Projects panel.
_Avoid_: pipeline row, card

**Pie menu**:
The two-ring neon wireframe menu that opens at the pointer.
_Avoid_: radial menu, marking menu, context menu

**Stroke**:
One pie menu selection: press, drag toward an action, release. Named by direction (N, NE, ...).
_Avoid_: gesture, swipe

**Second ring**:
The pie menu's outer ring, reached by pushing past the first ring from an action that has
sub-actions.
_Avoid_: submenu, outer menu

**Shell-wide warning**:
A dismissible one-line banner under the stage tab bar for a problem that affects the whole window,
such as an inherited RedirectionGuard.
_Avoid_: status message, toast
