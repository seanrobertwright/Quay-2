# Praxis Builder

**Praxis** is the workflow engine in the AI-WS-SDK. It runs finite-v1 graphs under contracts, grants and triggers, and it runs coding plans from workflow templates.

The **Praxis Builder** lets you author those definitions in Quay 2 as files in your project: graphs on a canvas, and everything else as forms. It works offline. It reads a Praxis host only through the `praxis` CLI, to show the host's state, each workflow template's state on it and a template's runs. It never submits a definition.

---

## Opening the builder (`Ctrl+Shift+B P`)

Press `Ctrl+Shift+B P`, or choose **Praxis Builder...** in the command palette, to toggle the builder for the active project. It opens as a near full-window dialog with a list of the project's definitions on the left and the open definition beside it.

Closing the builder only hides it. Each project keeps its open definition, its unsaved drafts and its undo history for as long as Quay runs, so the builder reopens where you left it. `Escape` hides the builder once there is nothing smaller for it to close: the shortcuts help, **Go to node**, a connection being drawn, a focused field or the selection.

The list groups definitions by kind: **Graphs** (each with its graph bindings nested under it), **Contracts**, **Grants**, **Triggers** and **Workflow templates**.

---

## Where definitions live

Everything the builder edits is a JSON file under `.praxis/` in the project, so it is committed and reviewed like code:

```text
.praxis/
├── graphs/<id>.json            # finite-v1 graphs
├── layout/<graph-id>.json      # node positions for a graph
├── contracts/<id>.json
├── bindings/<contract-id>.json # the graphs and grants a contract binds
├── grants/<id>.json
├── triggers/<id>.json
├── graph-bindings/<id>.json    # what each node of a graph runs as
└── templates/<name>.json       # workflow templates
```

- **The file name is the id.** Ids use letters, digits, `.`, `_` and `-`, up to 128 characters, with no leading dot and no Windows device name. No two definitions of the same kind may share an id, ignoring case. A file whose id doesn't match its file name is listed with a warning and offers to set the id to the file name. A workflow template holds no id, so its file name alone names it, and that name follows the Praxis host's narrower rule: a lowercase letter, then at most 62 lowercase letters, digits and hyphens, and no Windows device name.
- **Files are written in one canonical form**, so a save that changes nothing makes no diff. Saving sets a content-digest `revision` on graphs and triggers, and `graphBindingRevision` on graph bindings.
- **Broken files still list.** A file that isn't valid JSON is listed with an error badge, and opening it shows the line and column of the error.

---

## The graph canvas

A graph opens on a canvas, laid out from its `.praxis/layout/<graph-id>.json`, or by dagre when it has none. Each node is a card showing its kind, its id, a one-line summary of its config and its problem count.

The palette strip on the canvas holds the node kinds, grouped like this:

| Group | Kinds |
| --- | --- |
| Work | `TASK`, `SUBWORKFLOW`, `LOOP` |
| Flow | `DECISION`, `FORK`, `JOIN`, `WAIT` |
| Gates | `APPROVAL`, `VERIFICATION`, `ACCEPTANCE` |
| Finish | `RECONCILIATION`, `COMPENSATION`, `END` |

- **Add a node** by dragging a kind from the palette onto the canvas.
- **Add a dependency** by dragging from one card's handle to another. Dependencies are the node's `dependsOn`.
- **Branch a decision** by dragging from a `DECISION`'s green `then` or red `else` handle. That sets the branch in its config and the target's `dependsOn` together.
- **The inspector** beside the canvas edits the selected node: its id, its kind's config, its `dependsOn`, and its `inputSchema` and `outputSchema`. Each schema is a table of field name, type and required, or raw JSON for a schema the table can't show. The inspector shows the problems in each field and can delete the node.
- **Renaming or deleting a node** updates every `dependsOn`, decision branch and layout entry that names it. A rename also rewrites the node's key in every graph binding of the graph. A delete leaves the node's binding entries in place until a retarget drops them.

### Problems

Graphs are checked offline in Quay's Rust backend by the AI-WS-SDK's own crate, vendored in `src-tauri/vendor/aiws`. The **Problems** list under the canvas gives each issue's node, field, message and code. Choosing an issue selects its node and zooms to it.

### Layout

- **Auto-arrange** (`Shift+A` in the canvas) lays the whole graph out top to bottom with dagre and fits it in view, with each decision's `then` branch on the left.
- With two or more nodes selected, align their left, right, top or bottom edges or their centres. With three or more, distribute them evenly across or down. These are in the toolbar's **Arrange** menu, and align and distribute are also on a node's right-click menu.
- A single dragged node shows guide lines and snaps to the edges and centres of the others. Hold `Alt` to drag it freely.
- Node positions are written to the layout file only when the graph is saved.

---

## Drafts and saving

Every edit goes to an in-memory draft first. Unsaved drafts show `*` in the list and a dot on the project in the rail, and Quay asks before it quits while any are unsaved.

- **Save** (`Ctrl+S`) writes the open definition. For a graph that includes its layout, and for a contract its bindings file.
- **An invalid definition still saves.** The list marks it with an error badge until it is fixed.
- **If the file changed on disk** after the builder loaded it, a draft with no edits quietly reloads. A draft with edits keeps them, and saving it asks first: **Overwrite** replaces the file with the draft, and **Reload** drops the draft's changes and loads the file. If the file was deleted instead, **Save anyway** writes the draft back.

### Creating, renaming and deleting

- **New** asks for the kind, then names the definition in the list (`graph-1` to start) and checks the name as you type. A new graph starts with a single `END` node, and nothing is written until its first save.
- **Rename** lists every file it will touch, moves the definition and its layout file, and changes the id inside. References follow: renaming a graph or grant rewrites the contract bindings that list it, renaming a contract rewrites the `contractId` of its triggers, and renaming a grant rewrites the `parentId` of the grants under it.
- **Delete** names what refers to the definition and moves it, with its layout file, to the Recycle Bin or Trash. Deleting a graph offers to delete its graph bindings too.
- Neither rename nor delete can be undone in the builder.

---

## Editing comforts

### Undo and redo

`Ctrl+Z` undoes and `Ctrl+Shift+Z` or `Ctrl+Y` redoes. A graph, its layout and its graph bindings share one history, and each form has its own. One gesture is one step: a drag, a layout command, or a run of arrow-key nudges. A history keeps the last 100 steps. It survives saving and hiding the builder, and it is cleared when the definition reloads from disk, is discarded, renamed or deleted, or its project is removed from Quay. In a text field, `Ctrl+Z` is the field's own text undo.

### Copy, cut, paste and duplicate

With focus in the canvas, `Ctrl+C`, `Ctrl+X`, `Ctrl+V` and `Ctrl+D` copy, cut, paste and duplicate the selected nodes. The canvas's right-click menu has **Paste** too, which pastes where you clicked.

- The clipboard is Quay's own, in memory, so nodes paste across graphs and projects but never reach the system clipboard.
- Only dependencies between the copied nodes travel with them. A decision branch that pointed outside the selection is blanked.
- A pasted node whose id is taken gets the next free number in place of its trailing digits, and the pasted dependencies and branches follow the new ids.
- With a graph binding shown, each node's **Runs as** entry travels with it into the binding shown where it is pasted.

### Keyboard-only use

- `Tab` moves through the nodes in file order, then the edges.
- `Enter` or `Space` selects the focused node, and `Shift+Space` adds it to the selection.
- The arrow keys move the selection 8 px, or 40 px with `Shift`.
- `Ctrl+F` opens **Go to node**, which filters by id or kind.
- Pressing a palette button adds a node below the one selected node, depending on it, or in the middle of the view otherwise.
- The inspector's **Add dependency** combobox connects nodes, and a dependency chip goes to its node.
- `Delete` removes the focused node or edge, and `Shift+F10` or the Menu key opens a node's menu.
- Screen readers hear each node's kind, id, summary, dependency count and problem count, and undo, redo, paste, delete and save are announced.

Press `?` in the canvas for every key, including select all (`Ctrl+A`), fit view (`Shift+1`) and zoom (`Ctrl+=`, `Ctrl+-`, `Ctrl+0`). On macOS, `Cmd` replaces `Ctrl` throughout. See also [Keyboard Shortcuts](../reference/shortcuts.md).

---

## Contracts, grants and triggers

These open as full-width forms in place of the canvas.

- **Contracts** are edited in sections for scope, limits, timing and delivery. The **Graphs** and **Grants** sections bind definitions to the contract, and **Triggers** links to the triggers that name it. Saving writes the contract and `.praxis/bindings/<contract-id>.json` together. Each contract is checked with the SDK's `create_mission`.
- **Grants** carry a fixed note that a grant is a proposal and takes effect only when a human approves it in Praxis. The form shows the delegation chain from the root grant down, and checks the limit as you type against the parent grant's limit and the budget of every contract that binds the grant.
- **Triggers** show only the fields their kind and action use. Each is checked with the SDK's `registerTrigger` on a scratch mission.

Budgets and limits are shown in the installation's ledger cost unit. Deadlines and other times are picked in your local time zone, with the UTC time shown.

### Checks across records

Each contract is also checked across records on a scratch mission: the contract, then the grants it binds (each parent first), the graphs it binds and the triggers that name it, as Praxis would apply them. The issues are advisory. They show in an **Across records** section of each form and as a warning badge in the list, and saving still works.

On the canvas, a graph shows **Runs under:** chips for the contracts that bind it, and a collapsible **Run context** panel beside **Problems** lists each contract's grants and triggers. A graph no contract binds gets an info issue with a shortcut that adds it to a contract.

### Changed since last commit

Contracts, grants, graph bindings and workflow templates whose files have uncommitted changes carry a **changed since last commit** badge in the list, so an agent's edits are visible before anyone acts on them. The badge opens the file's diff against the last commit. A project that isn't a git repository shows no badge. Committing a grant doesn't approve it: only a human in Praxis does.

---

## Graph bindings

A graph binding (`aiws-graph-binding/1`) says what each `TASK`, `LOOP` and `COMPENSATION` node of a graph runs as. Bindings are listed under their graph, and bindings whose graph is missing are listed under **Unattached bindings**.

- **Pick a binding** from the canvas toolbar's **Binding** picker: None, an existing binding, or **+ New binding…**. The choice is remembered per graph while Quay runs.
- **Edit a node's entry** in the inspector's **Runs as** section: the execution kind, the agent id, commands as argument lists, output paths or a protocol binding, the exposure, and Work or Validation with its criteria. With no node selected, the **Binding** section edits the cost unit and the run's limits.
- **Checks** mark each node's card bound or unbound, and a missing entry is a `BINDING_INCOMPLETE` problem. Each contract whose bindings list the graph adds warnings: the binding's cost and attempt limits against the contract's, cost-unit agreement with the contract's other graphs, and criteria coverage, which a `VERIFICATION` node shows as a table.
- **Worst case.** The **Runs as** and **Binding** sections show the worst-case cost under each of those contracts: each Bounded entry's allowance times its attempts, and times its iterations for a `LOOP`, as if every attempt spent its whole allowance.
- **Save binding** saves a binding on its own. The first save pins it to the graph as saved on disk. When the graph changes on disk the binding shows **Stale**, and **Retarget to current graph** lists the entries it will drop before it re-pins.

Binding edits, node renames and retargets are steps of the graph's undo history. Bindings are shape-checked in Rust against the PROVISIONAL schema vendored from the AI-WS-SDK.

---

## Workflow templates

A workflow template is a coding plan without a work order or run id, and its file name is the name `praxis run <name>` starts. It opens as a form in sections for intent, commands, outputs, limits, and agent and cost, under a read-only strip of the coding profile's stages.

- **Names follow the host's rule.** New template and rename refuse a name the Praxis host would refuse, and say why as you type. A template file already named that way still opens, with a warning in the list, an issue above the form and a **Rename** button. Quay never passes such a name to `praxis`.
- Commands are argument lists, one row per argument with the executable first. Quay never splits a command line and never runs a command.
- Each template's shape is checked against the SDK's PROVISIONAL coding-plan schema. The form says "Shape checked. Not previewed on a host", because readiness and the host's other rules aren't checked yet.

**Install on host…** opens a dialog that writes nothing. It shows the saved file's path with a **Copy** button and the steps to install it: copy the file into the template directory your host configuration names, restart the host, then run `praxis run <name>`. When the file has uncommitted changes, the dialog leads with their diff and a warning. Quay never writes the host's configuration or template directory.

**Template | Runs** above the form switches the work area to the template's runs on the host, from `praxis runs <name> --json`, newest first. Each run shows its status, stage, control (as a chip), whether it is held, the template revision it ran and when it was created. The list shows the newest 20 runs; **Show more** lists the newest 100, the most `praxis` lists, and says so, because `praxis` can't page past them.

- A run that waits for a person, awaiting approval or held, is marked **Needs you** with **Open in browser**. Decisions are made only in the host's browser page. Quay opens a page only when it is on this machine's host, at `https://127.0.0.1:<port>/`.
- A simulated host's runs are marked **Simulated**, in amber, because its approvals aren't made by a person.
- The list is read every 15 seconds while it is shown, or every 60 seconds after a read fails. The last list stays, with the reason the read failed. While the host can't be used, the list is also dimmed, with the time it was read.
- Reading stops, and the `praxis` call in flight is stopped, as soon as the list leaves the screen: switching to **Template**, opening another definition or project, closing the builder or hiding Quay's window.
