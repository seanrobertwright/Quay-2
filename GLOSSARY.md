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
One of the five groups of Quay's features: Projects, Source control, Agents, Workflows and Project.
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
One of the companion's views: Pull request, Ticket, Repository, Activity, Surface, Run, Topos or Inspector.
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

## Agent surfaces

The terms of the A2UI surfaces spec. The build adds what they name.

**Surface**:
One piece of UI an agent describes to Quay through a tool call, which Quay draws with its own
components. Say "agent surface" where the text also means parts of Quay's own window.
_Avoid_: widget, artifact, card (Quay's own cards are not surfaces)

**Typed tool**:
A Quay tool that takes content and lays it out itself: `quay_ask`, `quay_review`, `quay_board`.
_Avoid_: simple tool, shortcut

**Raw tool**:
`quay_surface`, the tool that takes A2UI messages as the agent wrote them. A surface sent through it
is a raw surface.
_Avoid_: A2UI tool, low-level tool

**Guide tool**:
`quay_surface_guide`, the tool that teaches the raw format when an agent asks.
_Avoid_: help, docs tool

**Engine**:
The official A2UI packages' message handling, data model and validation, without their components.
_Avoid_: renderer, which also covers Quay's components

**Quay's catalog**:
The components and functions a surface may use, all of them drawn or run by Quay.
_Avoid_: basic catalog, which is the standard's own

**Place**:
Where a surface is drawn: `companion`, `tab` or `strip`. Fixed for the surface's life.
_Avoid_: location, slot, target

**Strip**:
The line a board or a raw surface with that place has on its terminal's pane, which opens over the
terminal.
_Avoid_: banner, status strip (removed from the shell); and "reply strip", which is a lens's foot

**Surface view**:
The companion view that shows the selected terminal's companion surfaces.
_Avoid_: question view, inbox

**Surface frame**:
What Quay draws around every agent surface, naming the terminal and its CLI.
_Avoid_: chrome, wrapper

**Asking surface**:
A live surface with an action to its agent that the operator has not taken yet.
_Avoid_: pending surface, open question (one kind of it)

**Wait**:
The bounded time a tool call stays open for the operator's answer. The surface outlives it.
_Avoid_: timeout, which is the CLI's own limit on the call

**Settled**:
Said of a surface whose one answer has been given, or of a board marked done or failed.
_Avoid_: closed, completed

**Ended**:
Said of a surface whose terminal exited before it was settled.
_Avoid_: dead, orphaned

**Withdrawn**:
Said of an asking surface its agent deleted before the operator answered.
_Avoid_: cancelled, retracted

**Relay**:
The stdio program that connects a CLI with only static configuration to Quay's MCP server.
_Avoid_: proxy, bridge (the event bridge is another thing)

**Connect**:
The control that writes the relay's entry into a CLI's own configuration, and removes it again.
_Avoid_: install, register

**Quay card**:
A decision Quay itself asks for: a permission request or one of the Run view's decisions. It carries
the Quay mark and is never a surface.
_Avoid_: modal, dialog, surface

**Quay mark**:
The accent glow and QUAY badge on a Quay card. In a lens the badge stands alone. No agent surface can
have it.
_Avoid_: brand, highlight
