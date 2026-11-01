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
- Each template's shape is checked against the SDK's PROVISIONAL coding-plan schema. Readiness and the host's other rules come from the host: beside **Install on host…**, a status line shows the template's [state on the host](#template-host-states).

**Template | Runs** above the form switches the work area between the form and the template's [runs on the host](#runs).

---

## The Praxis host

The builder reaches a Praxis host only by running the `praxis` CLI. Reads and Run are headless `praxis <command> --json` calls: `workflows list`, `workflows show`, `runs`, `status` and `run`. The commands that need a person, `setup`, `serve`, `login` and `trust`, run only in a visible terminal. Quay never writes the host's configuration or template directory, and it has no control for any decision on a run: [decisions happen in the browser](#decisions-happen-in-the-browser).

### Linking the `praxis` CLI

Quay runs `praxis` from an AI-WS-SDK checkout, with Node 24 or later. To link it, run `npm link` in the checkout's `engine` folder.

- **How Quay finds it.** Quay never starts `praxis` through npm's `praxis.cmd` shim or `cmd.exe`. It follows npm's global link for `@aiws/engine` into the checkout, looking beside each `praxis` shim on `PATH`, under `NPM_CONFIG_PREFIX` and under npm's default prefix. It reads `bin.praxis` from that package's `package.json` and runs `node <script>` with the first `node` on `PATH`, once `node --version` says 24 or later. The [`checkout` setting](#per-user-settings) replaces the link.
- **A found `praxis` is kept for 60 seconds** before Quay looks it up again. A failed lookup is never kept, so linking the CLI takes effect on the next call.
- **Every call is bounded.** A read may take 15 seconds and a run creation 75 seconds, and then Quay kills its whole process tree. A `praxis` that prints more than 8 MiB is stopped too.
- **A `praxis` Quay can't read**, one that refuses Quay's arguments or prints a record in a format this Quay doesn't read, gets "Quay needs an update for this praxis".

### Per-user settings

Two optional settings say where Quay finds `praxis` and which installation it uses. They live in `praxis-cli.json` in Quay's data folder (see [Configuration](../guide/configuration.md)). Quay has no screen for them, so edit the file by hand. Quay reads it when it starts, so restart Quay after editing it.

```json
{
  "checkout": "D:\\src\\AI-WS-SDK",
  "installation": null
}
```

- **`checkout`** is an AI-WS-SDK checkout to run `praxis` from, in place of the one npm's global link points at. It, or its `engine` folder, must hold a `package.json` whose `bin.praxis` names a file inside that package.
- **`installation`** is the Praxis installation folder, passed as `--state` on every call, the terminal commands included. Without it, Quay passes no `--state`, so it uses the installation `praxis` in a terminal uses.
- **Both follow the same rules.** Each is `null` or left out when unset, or else the absolute path of an existing folder, not empty and with no space at either end.
- **A bad setting stops every call.** Each folder is checked again on every call, because a folder can go away. A bad one makes the host chip read **praxis CLI not found**, with a reason that names the setting.
- **A file Quay can't read is ignored**, as if it held no settings: one that isn't valid JSON, or that holds any other key. Quay logs a warning and still starts.

### The host chip

The chip in the builder's header shows the project's host condition as the latest `praxis` call left it. Its colour is never the only sign: each condition has a text label.

| Chip | What it means | Its action |
| --- | --- | --- |
| **Host not checked yet** | No call for this project has said anything about the host yet | None |
| **praxis CLI not found** | The CLI isn't linked, Node is older than 24, or a setting is bad | How to link it, with the reason |
| **No host set up** | This machine has no Praxis host | **Set up host** runs `praxis setup` |
| **Host down** | Nothing answered at the host's address | **Start host** runs `praxis serve` |
| **Not signed in** | `praxis` holds no session for the host, or the host refused it | **Sign in** runs `praxis login` |
| **Signed in** | The last call reached the host and was signed in | None |
| **Simulated host** | The host's identity is simulated, so its approvals aren't made by a person | None |

- **Press the chip** to open a panel that says what the condition means and what to do about it. `Escape` closes it.
- **Set up host, Start host and Sign in** each open a new terminal in the project, running that command for you to answer, and hide the builder so the terminal shows. The terminal runs the same `node <script>` as the headless calls, with `--state` when an installation is set, and never a flag that skips a confirmation. Leave the `praxis serve` terminal open.
- **The chip never calls `praxis` itself**, except to recheck: while a failing condition holds, a workflow template is open and Quay's window is shown, Quay checks the host again every 60 seconds, each check starting 60 seconds after the last one ended. The recheck stops, and stops its call, when that view leaves the screen.
- **A simulated host** gets an amber chip and a standing banner across the builder: "This is a simulated Praxis host: its approvals aren't made by a person. Don't treat its runs as reviewed."

#### Signing in lasts about 5 minutes on a real host

The `praxis` CLI never refreshes its 5-minute token on a real host: see [praxis CLI never refreshes its 5-minute token on a real host, and stores credentials in plain text](https://github.com/seanrobertwright/AI-WS-SDK/issues/328). About 5 minutes after `praxis login`, the next call says the session expired, and the chip reads **Not signed in** with **Sign in** again. Quay doesn't work around it, so until the CLI is fixed, sign in again whenever that happens.

### Template host states

Each workflow template has a state on the host, from one `praxis workflows list`, then `praxis workflows show <name>` for each local template the host has installed, at most two at a time. The states are worked out in this order, and a template shows the first that applies:

| State | When |
| --- | --- |
| **Name the host refuses** | The file name breaks the host's name rule. Quay never asks the host about it. |
| **Not installed** | The host's catalog has no template of that name. |
| **Invalid on host** | The host holds its copy invalid, and gives its diagnostics. |
| **Differs from host** | The host's copy has a different digest from the saved file. |
| **Installed, not ready** | The host has the saved file but says it can't run, and gives its reasons. |
| **Installed** | The host has the saved file and can run it. |

A read that failed shows **Couldn't check**, with what it said, and a template not read yet shows **Not checked yet**.

- **When Quay reads.** The first time the builder is shown for a project, Quay reads every template. Saving a template the host has installed rereads that template only, and a save that changed the file shows it as not checked until that read ends. A template the host doesn't have stays **Not installed** until the host restarts. **Check host** rereads everything, and **Check again** rereads one template.
- **Readings live in memory** for as long as Quay runs, never on disk. Each is stamped with the time it was read. After 10 minutes it is shown muted and marked "may be out of date", never dropped. While the host can't be used, every template's reading is dropped and its state is unknown.
- **In the list**, each template's row shows its host state as an icon after its **changed since last commit** badge. The icon's tooltip gives the state and the host's reason, and screen readers hear the state as text. A template whose state is unknown shows no host icon.
- **The Workflow templates group header** shows the host condition, as the chip does, with **Check host**. When the condition is **Not signed in**, it offers **Sign in** too, and when the CLI can't be run, it says how to link it.
- **On host only (N)** ends the group, collapsed, when the host has templates with no local file of the same name. It lists up to 100 of them by name, and its title counts them all. They are read-only: choosing one shows the description, revision and validity the host's list gave, and there's no import and no delete.
- **On the form**, the status line beside **Install on host…** shows the state in words, the host's reason, when it was checked, and **Check again**. While the host can't be used, it reads "Host state unknown:" and the chip's label, and **Check host** in the group header is what rereads.

### Install on host

**Install on host…** opens a dialog that writes nothing. A template that was never saved, or whose file was deleted, has no file to install, so the button stays unavailable until it is saved. The dialog opens on the template's host state:

- **Not installed, or not known**: the saved file's absolute path with a **Copy** button, the name `<name>.json` it takes on the host, and the steps: copy the file into the template directory your host configuration names, restart the host, then run `praxis run <name>`. With the steps, it lists the saved file's implementation, validation and correction commands in full, read-only.
- **Differs from host, or Invalid on host**: the same steps, under a warning that installing replaces the host's copy with this saved file.
- **Installed, or Installed, not ready**: no steps, because the host already has the saved file. For a template that isn't ready, it gives the host's reason, since copying the file again won't help.
- **Name the host refuses**: no steps, only the rule and a pointer to rename the file from the list.

When the file has uncommitted changes, the dialog leads with their diff and a warning, and when the draft has unsaved edits, it says the host gets the saved file. Unless the host refuses the name, the dialog ends with the status line and **Check again**, and notes that the host reads its template directory only when it starts, and that Quay can say the host's copy differs, never how. Quay never writes the host's configuration or template directory, never guesses that directory, and never runs `engine:author`.

### Runs

**Runs** shows the template's runs on the host, from `praxis runs <name> --json`, newest first. Each run shows its status, stage, control (as a chip), whether it is held, the template revision it ran and when it was created. The list shows the newest 20 runs. **Show more** lists the newest 100, the most `praxis` lists, and says so, because `praxis` can't page past them.

- A run that waits for a person, awaiting approval or held, is marked **Needs you** with **Open in browser**.
- A simulated host's runs are marked **Simulated**, in amber, because its approvals aren't made by a person.
- The list is read every 15 seconds while it is shown, or every 60 seconds after a read fails. The last list stays, with the reason the read failed. While the host can't be used, the list is also dimmed, with the time it was read.
- Reading stops, and the `praxis` call in flight is stopped, as soon as the list leaves the screen: switching to **Template**, opening another definition or project, closing the builder or hiding Quay's window.

#### A run's detail

**Show** on a run opens its detail above the list, drawn live on the template's stage strip: the stage the run is at, the stages it finished, its correction rounds and, for a held run, where it stopped. Each mark is in words as well as colour.

- **The detail follows the run** with `praxis status <work-order> --json`, never `praxis follow`, while the Runs view and Quay's window are shown. It reads again 3 seconds after a change, doubling the wait up to 15 seconds while nothing changes. A run waiting for a person is read every 15 seconds, and after a failed read, every 60 seconds. Once the run has ended, it is no longer read.
- **A run that waits for a decision** gets a banner naming what it waits for, such as approval or acceptance of the deliverable, decided in the browser, with **Open in browser**. On a simulated host, the banner says its decisions aren't made by a person.
- **A held run** gets a hold panel with **Resolve in browser**: why it is held, its cause and notes, and the ways out of the hold, each marked when it isn't available now, all taken in the browser.
- **A certificate hint.** When `praxis` says the browser may not trust the host's certificate, the banner or hold panel shows its words, with **Trust certificate** when they ask for `praxis trust`. That opens a terminal running `praxis trust` for you to answer.

#### Run

**Run** in the Runs view's header starts a run of the host's installed copy of the template, with `praxis run <name> --json`. It is unavailable, with the reason shown, while the host says its copy isn't ready or isn't valid, while the name breaks the host's rule, and while a run of the template is starting.

- **Run asks first.** Its confirm checks the host's copy again, then shows its revision and digest, and says the host runs that copy, not the project's file. It warns when the host's copy differs from the saved file, when the draft has unsaved edits, and when the file has uncommitted changes. **Start run** is withheld until the check ends, and while the host has no copy or can't run it. **Install on host…** in the confirm opens the install dialog.
- **A started run** is selected, its detail follows it, and a notice names it with **Open in browser**.
- **Every other outcome gets a notice of its own.** A held run, or one awaiting approval, blocks new runs: the notice says which, with **Open in browser** for the run that blocks it, and **Show run** when `praxis` names its work order. A host that isn't set up, is down, isn't signed in or whose sign-in expired says no run was started, and so does a `praxis` Quay couldn't run. A refusal gives `praxis`'s own words with **Copy**.
- **Quay never stops a creation** before its 75-second bound, and leaving the view doesn't stop it: the Runs view shows its outcome when it ends. When Quay can't tell whether the run was created, after its timeout or an outcome `praxis` didn't report, the notice says so. `praxis` keeps that creation pending, so **Run** again finishes it and can't create a second run. Quay never runs a creation again on its own.

### Decisions happen in the browser

Approving a run, pausing it, cancelling it and resolving a hold are decided only in the host's browser page. Quay has no control for any of them, not even a disabled one, and never runs `praxis hold` or `praxis open`. **Open in browser** and **Resolve in browser** open the run's page in your browser, and only when it is on this machine's Praxis host: an `https` address at the host's browser origin, `https://praxis-<label>.localhost:<port>/`, or at `https://127.0.0.1:<port>/`. Quay refuses any other address and says what `praxis` gave.
