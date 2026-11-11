# Praxis Builder

**Praxis** is the workflow engine in the AI-WS-SDK. It runs finite-v1 graphs under contracts, grants and triggers, and it runs coding plans from workflow templates.

The **Praxis Builder** lets you author those definitions in Quay 2 as files in your project: graphs on a canvas, and everything else as forms. It works offline. It reaches a Praxis host only through the `praxis` CLI, to show the host's state, the state on it of each workflow template, graph workflow and graph trigger, their runs, and a graph trigger's fires. It changes the host only by submitting a graph workflow or graph trigger as a candidate, withdrawing a pending candidate, starting a run, and disabling or retiring a graph trigger. Admitting a candidate, enabling a graph trigger and every decision on a run [happen in the host's browser page](#decisions-happen-in-the-browser), never in Quay, and Quay never fires a trigger by hand.

---

## Opening the builder (`Ctrl+Shift+B P`)

Press `Ctrl+Shift+B P`, or choose **Praxis Builder...** in the command palette, to toggle the builder for the active project. It opens as a near full-window dialog with a list of the project's definitions on the left and the open definition beside it.

Closing the builder only hides it. Each project keeps its open definition, its unsaved drafts and its undo history for as long as Quay runs, so the builder reopens where you left it. `Escape` hides the builder once there is nothing smaller for it to close: the shortcuts help, **Go to node**, a connection being drawn, a focused field or the selection.

The list groups definitions by kind: **Graphs** (each with its graph bindings nested under it), **Contracts**, **Grants**, **Triggers**, **Workflow templates** and **Graph workflows**.

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
├── trigger-targets/<trigger-id>.json # the graph workflow a trigger starts
├── graph-bindings/<id>.json    # what each node of a graph runs as
├── templates/<name>.json       # workflow templates
└── graph-workflows/<name>.json # a contract, a graph and one of its bindings
```

- **The file name is the id.** Ids use letters, digits, `.`, `_` and `-`, up to 128 characters, with no leading dot and no Windows device name. No two definitions of the same kind may share an id, ignoring case. A file whose id doesn't match its file name is listed with a warning and offers to set the id to the file name. A workflow template or graph workflow holds no id, so its file name alone names it, and that name follows the Praxis host's narrower rule: a lowercase letter, then at most 62 lowercase letters, digits and hyphens, and no Windows device name. A trigger with a [Starts target](#graph-triggers) follows that rule too, and the host also refuses the name `check` for a graph workflow and a graph trigger.
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
- **Rename** lists every file it will touch, moves the definition and its layout file, and changes the id inside. References follow: renaming a graph or grant rewrites the contract bindings that list it, renaming a contract rewrites the `contractId` of its triggers, renaming a grant rewrites the `parentId` of the grants under it, and renaming a contract, graph or graph binding rewrites the `contractId`, `graphId` or `graphBindingId` of the graph workflows that name it, and renaming a graph workflow rewrites the trigger targets that name it. A trigger's target file moves with the trigger.
- **Delete** names what refers to the definition and moves it, with its layout file or a trigger's target file, to the Recycle Bin or Trash. The trigger targets that name a deleted graph workflow stay, and the trigger form flags their target as missing. Deleting a graph offers to delete its graph bindings too.
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
- **Triggers** show only the fields their kind and action use. Each is checked with the SDK's `registerTrigger` on a scratch mission. A trigger whose **Starts** picker names a graph workflow is a [graph trigger](#graph-triggers), which Quay can submit to a Praxis host.

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

## Graph workflows

A graph workflow (`.praxis/graph-workflows/<name>.json`) ties a contract, a graph and one of that graph's graph bindings together: `{version, contractId, graphId, graphBindingId}`. It is the unit Quay submits to a Praxis host, carrying the grants of its contract's bindings file.

- **Names follow the host's rule**, as a workflow template's do, with the same warning, issue and **Rename** button on a file named otherwise.
- **Pickers** choose the contract, the graph and one of that graph's bindings. Each also takes an id no record has yet, and flags it as missing.
- **Grants** lists the grant set the graph workflow carries, read-only, with a link to the contract, where it is changed.
- **Triggers** lists the triggers whose saved target file names the graph workflow, each a link that opens the trigger's form. With none, it says no saved trigger starts the graph workflow. The list follows renames, because renaming a trigger moves its target file and renaming the graph workflow rewrites the target files that name it. A target file that can't be read, or whose trigger doesn't exist, is named as skipped. A trigger's target is set from its own **Starts** picker. Each trigger shows only its id here; its state on the host is in the **Triggers** list and on its own form.
- **Local checks** read the records it names as saved on disk, and show as issues on the field naming the record at fault: each record exists and is valid, as is each grant the contract's bindings file lists, the contract's bindings file lists the graph, and the graph binding binds that graph.
- **On the host.** Under the form's header, a status line shows the graph workflow's [state on the host](#graph-workflow-host-states), with **Check on host** and **Submit** under it ([Check on host and Submit](#check-on-host-and-submit)). A **Revisions** panel ends the form, and a pending candidate has **Withdraw** ([Candidates and admission](#candidates-and-admission)).
- **Workflow | Runs** above the form switches the work area between the form and the graph workflow's [runs on the host](#graph-runs).
- **Submitted as** on a graph's canvas, beside **Runs under:**, has one chip per graph workflow that names the graph, saved or drafted, each a link that opens its form. A chip whose graph binding isn't the one the **Binding** picker shows says which binding it uses. The row is left out when no graph workflow names the graph, and it shows no run state.

---

## Graph triggers

A graph trigger is a trigger with a saved **Starts** target: the graph workflow it starts on a Praxis host. The SDK's trigger record has no target field, so the target lives in a file of its own, `.praxis/trigger-targets/<trigger-id>.json`, as `{version, graphWorkflow}`, and the trigger file stays a plain SDK trigger. A trigger without a target stays a local record: it has no state on the host and can't be submitted.

- **Starts** picks the graph workflow the trigger starts, or takes an id no graph workflow has yet and flags it as missing. The target is saved with the trigger, under its one dirty flag and undo history. Picking one fills an empty contract with the graph workflow's, and a different contract is an error with a **Use** fix that sets the graph workflow's.
- **Praxis's graph trigger rules.** A trigger with a target also gets the host's graph trigger rules, as errors with the host's code and a hint: only `SCHEDULED`, `EVENT` and `CONDITION` kinds, only `START_RUN`, a `maxDepth` of 0, no filter on `SCHEDULED`, and a condition mode only on `CONDITION`. The rules live in one table in Quay's Rust backend. The **Kind** and **Action** pickers still list every value and mark the refused ones, so a refused value stays in the file until you change it. An `EVENT` or `CONDITION` trigger with a target also needs its source and event type, which are free text, because Quay can't list the event sources a host admits.
- **Names follow the host's rule** once a trigger has a target: a workflow template's rule, with the name `check` refused too. A new trigger with a target can't be saved, and one with a target can't be renamed, under a name the host would refuse, and rename says why as you type. A trigger named that way shows an issue above its form with a **Rename** button as soon as it has a target, and a warning in the list once the target is saved. A trigger without a target keeps the id rules every definition follows.
- **Renames and deletes.** Renaming a trigger moves its target file, and deleting it deletes the target file with it. Renaming a graph workflow rewrites the target files that name it, and deleting one names them.
- **On the host.** Under the form's header, a status line shows the trigger's [state on the host](#graph-trigger-host-states), with **Check on host** and **Submit** under it ([Check a graph trigger and Submit it](#check-a-graph-trigger-and-submit-it)), then **Withdraw**, **Disable**, **Enable in browser** or **Retire** as the host state allows ([Withdraw, Disable and Retire](#withdraw-disable-and-retire)). A **Revisions** panel and a [**Fires** panel](#fires) end the form.
- **Triggers** on a [graph workflow's form](#graph-workflows) lists the triggers whose saved target file names it, each a link to the trigger's form.

---

## The Praxis host

The builder reaches a Praxis host only by running the `praxis` CLI. Its reads and writes are headless `praxis <command> --json` calls. For workflow templates they are `workflows list`, `workflows show`, `runs`, `status` and `run`. For graph workflows they are `graphs list`, `graphs show`, `graphs check`, `graphs submit` and `graphs withdraw`, then `runs`, `status` and `run` with the graph record formats. For graph triggers they are `triggers list`, `triggers show`, `triggers check`, `triggers submit`, `triggers withdraw`, `triggers disable`, `triggers retire` and `triggers fires`. The commands that need a person, `setup`, `serve`, `login` and `trust`, run only in a visible terminal. Quay never writes the host's configuration or template directory, never fires a trigger by hand, and admission, enabling a graph trigger and every decision on a run [happen in the browser](#decisions-happen-in-the-browser).

### Linking the `praxis` CLI

Quay runs `praxis` from an AI-WS-SDK checkout, with Node 24 or later. To link it, run `npm link` in the checkout's `engine` folder.

- **How Quay finds it.** Quay never starts `praxis` through npm's `praxis.cmd` shim or `cmd.exe`. It follows npm's global link for `@aiws/engine` into the checkout, looking beside each `praxis` shim on `PATH`, under `NPM_CONFIG_PREFIX` and under npm's default prefix. It reads `bin.praxis` from that package's `package.json` and runs `node <script>` with the first `node` on `PATH`, once `node --version` says 24 or later. The [`checkout` setting](#per-user-settings) replaces the link.
- **A found `praxis` is kept for 60 seconds** before Quay looks it up again. A failed lookup is never kept, so linking the CLI takes effect on the next call.
- **Every call is bounded.** A read, `graphs check` included, may take 15 seconds, and a write (a run creation, a submission, a withdrawal, or disabling or retiring a graph trigger) 75 seconds, and then Quay kills its whole process tree. A `praxis` that prints more than 8 MiB is stopped too.
- **A `praxis` Quay can't read**, one that refuses Quay's arguments or prints a record in a format this Quay doesn't read, gets "Quay needs an update for this praxis".

### Per-user settings

Optional settings say where Quay finds `praxis` and which installation it uses. They live in `praxis-cli.json` in Quay's data folder (see [Configuration](../guide/configuration.md)). Quay has no screen for them, so edit the file by hand. Quay reads it when it starts, so restart Quay after editing it.

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
- **The chip never calls `praxis` itself**, except to recheck: while a failing condition holds, a workflow template, graph workflow or trigger is open and Quay's window is shown, Quay checks the host again every 60 seconds, each check starting 60 seconds after the last one ended. The recheck stops, and stops its call, when that view leaves the screen.
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
- **Focus stays in the detail.** When a read of the run removes the banner or the hold panel while a control in it has focus, such as once you decided in the browser, focus moves to the detail's heading, which names the run, so it isn't lost. Focus you moved elsewhere stays where it is.

#### Run

**Run** in the Runs view's header starts a run of the host's installed copy of the template, with `praxis run <name> --json`. It is unavailable, with the reason shown, while the host says its copy isn't ready or isn't valid, while the name breaks the host's rule, and while a run of the template is starting.

- **Run asks first.** Its confirm checks the host's copy again, then shows its revision and digest, and says the host runs that copy, not the project's file. It warns when the host's copy differs from the saved file, when the draft has unsaved edits, and when the file has uncommitted changes. **Start run** is withheld until the check ends, and while the host has no copy or can't run it. **Install on host…** in the confirm opens the install dialog.
- **A started run** is selected, its detail follows it, and a notice names it with **Open in browser**.
- **Every other outcome gets a notice of its own.** A held run, or one awaiting approval, blocks new runs: the notice says which, with **Open in browser** for the run that blocks it, and **Show run** when `praxis` names its work order. A host that isn't set up, is down, isn't signed in or whose sign-in expired says no run was started, and so does a `praxis` Quay couldn't run. A refusal gives `praxis`'s own words with **Copy**.
- **Quay never stops a creation** before its 75-second bound, and leaving the view doesn't stop it: the Runs view shows its outcome when it ends. When Quay can't tell whether the run was created, after its timeout or an outcome `praxis` didn't report, the notice says so. `praxis` keeps that creation pending, so **Run** again finishes it and can't create a second run. Quay never runs a creation again on its own.

### Graph workflow host states

Each graph workflow has a state on the host, from `praxis graphs list`, read page by page, then `praxis graphs show <name>` for each local graph workflow the host has, at most two at a time. A graph workflow shows one of these states, listed worst first:

| State | When |
| --- | --- |
| **Name the host refuses** | The file name breaks the host's name rule. Quay never asks the host about it. |
| **Not submitted** | The host has no graph workflow of that name, or an active one with no admitted revision and no pending candidate, such as when every candidate was rejected or withdrawn. |
| **Retired** | The owner retired it. A new revision the owner admits makes it active again. |
| **Candidate waiting for admission (revision N)** | The host holds a pending candidate, and N is the newest. The owner admits or rejects it in the browser. |
| **Differs from host** | The saved files' bundle digest isn't the admitted revision's. |
| **Admitted, not ready** | The host has an admitted revision but says it can't run, and gives each reason by node. |
| **Admitted** | The host has an admitted revision of the saved files and can run it. |

A pending candidate outranks the admitted revision's state, but the admitted revision is still the one a run uses. A read that failed shows **Couldn't check**, with what it said, and a graph workflow not read yet shows **Not checked yet**. When Quay can't compare the saved files' bundle digest with the admitted revision's, because it can't compute one or the host gave none, it can't tell **Differs from host**, so **Admitted** and **Admitted, not ready** also give "Revision N, submitted T".

- **When Quay reads.** The first time the builder is shown for a project, Quay reads every graph workflow. **Check host** in the Graph workflows group header rereads everything, and **Check again** on the form rereads one graph workflow. A submission, a withdrawal and opening Run's confirm each read that graph workflow again.
- **A pending candidate is polled.** While a graph workflow's form is on screen, shows a pending candidate and Quay's window is shown, Quay reads it again 15 seconds after each read ends, so the owner's decision in the browser shows up. Nothing else polls.
- **Readings live in memory** for as long as Quay runs, never on disk. Each is stamped with the time it was read. After 10 minutes it is shown muted and marked "may be out of date", never dropped. While the host can't be used, every reading is dropped and the state is unknown.
- **In the list**, each graph workflow's row shows its host state as an icon. The icon's tooltip gives the state and the host's reason, and screen readers hear the state as text. A graph workflow whose state is unknown shows no host icon.
- **The Graph workflows group header** shows the host condition, as the chip does, with **Check host**. When the condition is **Not signed in**, it offers **Sign in** too, and when the CLI can't be run, it says how to link it.
- **On the form**, the status line under the header shows the state in words, the host's reason, when it was checked, and **Check again**. For a pending candidate it adds **Open in browser** for the candidate's admission page, and **Withdraw**. While the host can't be used, it reads "Host state unknown:" and the chip's label, and **Check host** in the group header is what rereads.
- **The Revisions panel** at the end of the form lists what the latest `graphs show` gave, newest first: each revision's number and status (**Candidate, waiting for admission**, **Admitted**, **Rejected**, **Withdrawn**, **Current** or **Retired**), when it was submitted and decided, which one is current, and **Withdraw** on a pending candidate. It shows 20 rows, and **Show N more** adds up to 20 at a time. When the host holds older revisions than it listed, the panel says so. Quay doesn't read them.

### Check on host and Submit

**Check on host** and **Submit** sit under the graph workflow form's status line.

- **Check on host** runs `praxis graphs check`, which writes nothing, and lists the host's findings against the bundle file each names, each a link that opens it. Quay doesn't copy the host's refusal list, so a node kind the host refuses shows as its finding.
- **Submit** sends only the saved graph, graph binding, contract and grants the saved graph workflow names, as they are on disk. It is disabled, with each reason shown, while the graph workflow or any of them has unsaved edits, while the graph workflow fails its local checks or its saved bundle can't be built, while the name breaks the host's rule, and unless the host is signed in or simulated. Changes that aren't committed only warn.
- **Submit checks first.** It runs the check and goes on only if it passes. When the host's bundle digest matches the current revision's or a pending candidate's, it stops with "Nothing has changed since revision N".
- **The confirm** lists each file with its digest and an **Uncommitted** badge, and says the submission becomes a candidate and nothing runs until the owner admits it in the browser. Once the host stores it, the confirm names the new revision and offers **Open in browser** for its admission page, and the graph workflow's host state is read again.
- **When Quay can't tell** whether the host stored the candidate, the confirm says so and offers **Submit again**, which resends the same submission, so it can't store a second candidate.

### Candidates and admission

A submission is stored on the host as a candidate revision. Nothing runs until the owner admits it, and **the owner admits or rejects it only in the host's browser page.** Quay has no control for it: [decisions happen in the browser](#decisions-happen-in-the-browser). **Open in browser**, on the status line or in the Submit confirm, opens the candidate's admission page when the host gives one. While the form is on screen, Quay polls the candidate, so the new state shows once the owner decides.

**Withdraw**, on the status line or on a candidate's row in **Revisions**, withdraws a pending candidate with `praxis graphs withdraw <name> <revision>`. It asks first: the confirm names the revision and says the owner can no longer admit it. The host keeps it in the history as **Withdrawn**, and the graph workflow falls back to its admitted revision's state, or to **Not submitted** when it has none.

- **The confirm closes** once the host has answered and the graph workflow has been read again.
- **A refusal stays in the confirm** in the host's words, and Withdraw is then withheld. A candidate that is no longer pending, because the owner admitted or rejected it or it was withdrawn already, is refused that way.
- **When Quay can't tell** whether the host withdrew it, the confirm says so, and **Withdraw** again resends the same request. Pressing Withdraw while one is in flight joins it.

### Graph runs

**Runs** shows the graph workflow's runs on the host, of every revision, from `praxis runs <name> --format aiws-graph-runs/1 --json`, newest first. Each run shows its status, control (as a chip), whether it is held or awaiting approval, the admitted revision it ran and when it was created. The list shows the newest 20 runs, **Show more** lists the newest 100, and it reads and stops reading on the same rules as a [template's runs](#runs).

- A run that is held or awaiting approval is marked **Needs you** with **Open in browser**.
- A simulated host's runs are marked **Simulated**, in amber, because its approvals aren't made by a person.

#### A graph run's detail

**Show** on a run opens its detail above the list. It shows the run-level facts: the run's status, its outcome once it has ended, its control, whether it is held or awaiting approval, the revision it runs, and when it was created and last updated. Under them are the run's [run canvas](#the-run-canvas), with the [node panel](#the-node-panel) of the node you select beside it, and its [node table](#the-node-table).

- **The revision and the times come from the run's row** in the Runs list, because the run's own view doesn't give them. While the row is listed, they follow it, so the updated time keeps moving. Once newer runs push the row off the list, the detail keeps the last row that named the run: the revision and the times stay as that row gave them, and the run canvas stays drawn. A run the list has never named is [looked for](#a-run-the-runs-list-doesn-t-name).
- **The detail follows the run** with `praxis status <work-order> --format aiws-graph-operator-view/1 --json`, on the same delays and stop rules as a template run's detail (see [Runs](#runs)), with one difference: a run waiting for a person is read every 15 seconds only while none of its nodes is `RUNNING`, `PARKED` or `WAITING`. A node in one of those phases changes without anyone deciding, as the host works on it or it waits out a timer or an event, so while one is, the run is read 3 seconds after a change, doubling the wait up to 15 seconds while nothing changes. The view is `STABLE` in the AI-WS-SDK: within its format it only gains optional fields, which Quay ignores, and any other change comes in a new format, which the detail says it can't read.
- **A run that waits for a decision** gets a banner naming what it waits for, such as the run's approval, a node's approval or acceptance, a decision on a hold, a human task, or reconciliation, decided in the browser, with **Open in browser**. On a simulated host, the banner says its decisions aren't made by a person.
- **A held run** gets a hold panel for each open hold, with **Resolve in browser**. Each panel draws the hold's card (`aiws-graph-hold-card/1`): the held node and the host's reason, with its cause when it has one, the effect of the node's attempt, the attempts the node used of those it has, and the ways out of the hold, all taken in the browser. A hold that offers no way out says so, and that the run's page in the browser says what can be done.
- **A certificate hint** shows as it does for a template run, with **Trust certificate** when `praxis` asks for `praxis trust`.
- **Focus stays in the detail**, as it does for a template run: when a read removes a hold panel, a control in one, or the banner's **Open in browser** while it has focus, focus moves to the detail's heading.

#### A run the Runs list doesn't name

A run's detail can show a run the Runs list doesn't name, such as one opened with **Show run** from a graph trigger's [fire](#fires). The run's own view on the host gives neither its revision nor its times, so Quay looks for its row in the list:

- **Quay reads the newest 100 runs once**, as **Show more** does, when the list's first read since the run's detail opened is full at 20 runs and doesn't name it. You don't have to ask. The list then shows the newest 100, as after **Show more**. A run among them draws its run canvas and shows its times. Quay doesn't read them when the first read gave fewer than 20 runs, which is every run the graph workflow has, or while the host can't be used. When the list already shows the newest 100, after **Show more**, Quay looks for the run among them.
- **While the list's first read, or its read of the newest 100, runs**, the run canvas's place says Quay is looking up the revision.
- **A run older than the newest 100** can't be found: `praxis` lists only the newest 100 runs of a graph workflow, with no way to page past them, so Quay can't tell which revision the run ran. The run canvas isn't drawn. Its place says why, and the node table opens by itself to show the run's node phases.
- **A run the list doesn't name when it holds every run** of the graph workflow gets the same, without the cap: the run canvas's place says the Runs list doesn't name the run, so Quay can't tell its revision.

In each case the run-level facts and the node table show as for any run. The created and updated times say "Not given" until a row of the list names the run.

#### The run canvas

The run canvas draws the graph of the revision the run runs, with each node in its [node phase](#the-node-table). Its heading names the run and the revision, so it can't be taken for the graph canvas.

- **It draws the revision as the host holds it**, read with `praxis graphs show <name> --revision <n> --format aiws-graph-workflow-revision/1 --json`, never the project's saved graph file, which may have changed since. A run of an older revision draws that revision. A revision never changes, so Quay keeps the last eight revisions it read in memory and doesn't read those again. One it has dropped, or failed to read, is read again the next time a run's detail needs it.
- **Each card is the graph canvas's card**, at the same size, with the node's kind, id and config summary, and without a problem count. It adds the node phase's chip over its top edge, a border in the phase's colour and the counter line, the same as the node's row in the node table. A `SUBWORKFLOW` node is one card: its child graph isn't drawn.
- **The layout comes from the project's** `.praxis/layout/<graph-id>.json` when the project has a graph of the revision's graph id with a saved layout: saved positions are kept, and a node the layout lacks is placed near the nodes it connects to, as on the graph canvas. Otherwise dagre lays the graph out, and when the layout file is there but can't be used, such as when it isn't valid JSON, a line above the run canvas says it was ignored and why, in the graph canvas's words. The run canvas never writes a layout.
- **It can't be edited.** You can pan, zoom and fit the view, with the pointer, the controls in its corner, or the zoom keys (`Ctrl+=`, `Ctrl+-`, `Ctrl+0`) and fit view (`Shift+1`), and select one node to see its [node panel](#the-node-panel). There is no palette and no right-click menu, cards can't be dragged or connected, and the keys for delete, cut, copy, paste, duplicate, select all, adding to the selection, auto-arrange and moving a node do nothing on it. It is no draft, so nothing on it is saved.
- **When the revision can't be read**, the run canvas's place gives the host's problem and **Try again**, the node table opens by itself, and the run-level facts are unaffected.
- **When the Runs list doesn't name the run**, the run canvas's place says Quay is looking up the revision, or why it can't tell it: see [A run the Runs list doesn't name](#a-run-the-runs-list-doesn-t-name).
- **A revision with more than 1000 nodes**, the most the builder draws and the most a graph may hold, isn't drawn. Neither is one that `praxis` gives without a graph, or with a graph the builder can't read. The run canvas's place says why, and the node table opens by itself.
- **A node the host reports no node phase for** draws no chip and says "no state reported". A node the host reports that isn't in the revision's graph is in the node table only. A problem line under the run canvas names each one.
- **The run canvas follows the run**: each card changes with its node's phase when the detail is next read, and the revision isn't read again. While the host can't be used, the run canvas dims with the run-level facts.

#### The node panel

Choosing a card on the run canvas, or a node's id in the node table, selects that node and opens its node panel beside the run canvas. One node is selected at a time, and choosing another node moves the selection. Choosing the selected node again keeps it selected. The selected node's card has a white ring close around its border, a colour no node phase has, and its row is filled, with its id in bold and underlined. A card with keyboard focus has a ring further out, so a card both selected and focused shows both rings. A screen reader hears the selected card and row as the current one.

To close the node panel, press its close button (**×**, named **Close node panel**) beside its heading, or press `Escape` with focus on the run canvas, in the node table or in the node panel. Either clears the selection, so no card or row is selected, and the builder stays open.

- **With the keyboard**, `Tab` moves through the run canvas's cards, or the node ids in the node table, and `Enter` or `Space` selects the one with focus. `Escape` on a card or a row clears the selection and leaves focus where it is. From the node panel, `Escape` or the close button moves focus to the node's card, or to its row when the run canvas has no card for it, such as when it isn't drawn, or to **Nodes** when the node table is collapsed too. With no node selected, `Escape` on the run canvas or in the node table works as it does elsewhere in the builder.
- **When the run canvas isn't drawn**, such as while its revision is read, or when it can't be read or has too many nodes, choosing a row still opens the node panel, beside the run canvas's place.
- **A card the host reports no node phase for** opens a node panel that says so. A node in the node table only opens its node panel and marks no card.

The node panel is headed with the node's id. It shows only what the host reports for the node, from the same `praxis status` read as the rest of the detail, so it changes when the detail is next read and dims with it:

- its kind and node phase;
- its newest attempt's status and outcome;
- the attempts it used of those it is allowed, and what it has spent;
- for a loop, the iterations it completed of the most it may run, and, while it waits out its interval, when the next is due;
- for a wait node, the wait's kind and status;
- whether a human task is open for it.

A fact the host doesn't report for the node is left out, not shown empty. A node that is held, or blocked by a hold, links to that hold's panel in the detail, and the link moves focus there. When a later read shows the hold closed, the link goes, and focus on it moves to the node panel's heading. Only a hold on a node has a hold card, and so a panel: a node held or blocked by a hold on a grant, a branch or the whole run shows the hold's id, with no link.

The node panel is read-only. Its only control is its close button, and it changes nothing on the run, the graph or a file: approvals, acceptances, hold decisions and human tasks are made in the host's browser page. It doesn't show a loop's history of iterations, or a human task's own record, such as its role, instructions and due time, which would need another read of the host. It isn't the graph canvas's inspector.

#### The node table

**Nodes**, under the run canvas, opens the run's node table and states how many nodes it lists. The table has a row for each node the host reports for the run, in the host's order, with the node's id, its kind, its node phase and a counter line. It comes from the same `praxis status` read as the rest of the detail, so a node's row changes when the detail is next read, and Quay makes no other call for it. While the host can't be used, the table keeps the last read's rows, dimmed with the run-level facts.

- **The node phase** is the host's own word for where the node stands in the run, shown as the host gives it, in a chip coloured by what it means: green when the node finished, red when it failed, amber when it waits on a hold or a person, blue while the host works on it or waits out a timer or an event, and grey otherwise. The word always shows, so the colour is never its only sign. A phase Quay doesn't know shows as its own word in grey. Quay shows the node phase only, never the node's SDK `status`.
- **The counter line** gives the attempts the node used of those it is allowed, or, for a loop, the iterations it completed of the most it may run. A node with neither has none.
- **Choosing a node's id** selects the node, on the run canvas too, and opens its [node panel](#the-node-panel).
- **A node the host reports without its id or its phase** has no row. A problem line under **Nodes** says so instead.
- **A host that doesn't report node phases** gets one line saying so, and no run canvas or table.

Each node has one phase. Where more than one fits, the first in this table wins, as the AI-WS-SDK's GRAPH-WORKFLOWS.md sets it out:

| Phase | Colour | When |
| --- | --- | --- |
| `COMPLETED` | Green | The node finished. |
| `SKIPPED` | Grey, with a dashed outline | The run skipped the node, such as a branch it didn't take. |
| `FAILED` | Red | The node failed, as a loop does when it runs out of iterations. |
| `HELD` | Amber | An open hold names the node. A person resolves the hold in the browser. |
| `BLOCKED_BY_HOLD` | Amber | The node comes after another node's hold, so it waits for that hold. |
| `RUNNING` | Blue | An attempt at the node is in flight, a loop's included, with no human task open. |
| `PARKED` | Blue | A polling loop waits out its interval before its next iteration. |
| `WAITING` | Blue | A wait node waits for its timer, its input or its event. |
| `AWAITING_HUMAN` | Amber | The node waits for a person: its approval or acceptance, or a human task. |
| `READY` | Grey | The node can start, and the host hasn't started it yet. |
| `NOT_READY` | Grey | A node it depends on hasn't finished. |

#### Start a graph run

**Run** in the Runs view's header starts a run of the host's current admitted revision with `praxis run <name> --json`, never of the project's files. It is unavailable, with the reason shown, while the name breaks the host's rule, while the host has no admitted revision (not submitted, retired, or only a candidate waiting for admission), while it says the admitted revision isn't ready, and while a run of the graph workflow is starting.

- **Run asks first.** Its confirm reads the graph workflow on the host again and reads which of its files have uncommitted changes. It names the admitted revision and its review digest, and says the host runs that revision, not the files in the project, and that the run waits for approval in the browser before it does anything. It warns when the saved files differ from the admitted revision, even while a candidate is pending, when the bundle's records have unsaved edits, and when its files have uncommitted changes. **Start run** is withheld until both reads end, and while Quay can't read an admitted revision that can run.
- **Its outcomes are a template run's.** A started run is selected and followed. A run that blocks new ones is named with **Open in browser**, and with **Show run** when `praxis` names its work order. After a timeout or an outcome `praxis` didn't report, the notice says **Run** again finishes the pending creation and can't create a second run. See [Run](#run) for the rest.
- **A template of the same name runs instead.** `praxis run` tries a workflow template of the name first, so when the host has a template and a graph workflow of one name, it starts the template, and Quay can't read what `praxis` prints.

### Graph trigger host states

Each [graph trigger](#graph-triggers) has a state on the host, from `praxis triggers list`, read page by page, then `praxis triggers show <name>` for each local graph trigger the host has, at most two at a time. A graph trigger shows one of these states, listed worst first:

| State | When |
| --- | --- |
| **Name the host refuses** | The trigger's name breaks the host's name rule. Quay never asks the host about it. |
| **Not submitted** | The host has no trigger of that name, or one with no admitted revision and no pending candidate, such as when every candidate was rejected or withdrawn. |
| **Retired** | It was retired on the host. It fires again only once the owner admits a new revision. |
| **Candidate waiting for admission (revision N)** | The host holds a pending candidate, and N is the newest. The owner admits or rejects it in the browser. |
| **Differs from host** | The saved trigger and target files aren't the admitted revision's. |
| **Admitted, disabled** | The admitted revision doesn't fire until the owner enables it in the browser. |
| **Admitted, blocked** | The admitted revision is enabled, but the host says it can't fire, and gives each reason. |
| **Admitted, enabled** | The host has the saved files admitted and enabled, and nothing blocks them. |

A pending candidate outranks the admitted revision's state, and a rejected or withdrawn one falls back to it. A read that failed shows **Couldn't check**, with what it said, and a graph trigger not read yet shows **Not checked yet**.

- **Blocked, and why.** The host names each block by a code, and Quay puts the ones it knows in words with the code: the trigger's `notBefore` time hasn't come or its `expiresAt` time has passed, its contract's deadline has passed, its target graph workflow is retired or has no admitted revision, its event source isn't admitted, is disabled or is revoked, or the source doesn't declare its event type. A code Quay doesn't know shows as the host gave it.
- **Differs, by digest.** The host's digest of a revision covers the revision number, so Quay asks its backend for the saved files' digest at the admitted revision after each read and compares that. When either digest is missing, it can't tell **Differs from host**, so the disabled, blocked and enabled states also give "Revision N, submitted T".
- **When Quay reads.** The host's triggers are read once the builder is shown with a project that lists a graph trigger, so a project without one never reads them. **Check host** in the Triggers group header, offered once the list has a graph trigger, rereads everything, and **Check again** on the form rereads one graph trigger. A submission and each write below read that graph trigger again.
- **A pending candidate is polled.** While a graph trigger's form is on screen, shows a pending candidate and Quay's window is shown, Quay reads it again 15 seconds after each read ends, so the owner's decision in the browser shows up.
- **Readings live in memory** for as long as Quay runs, never on disk. After 10 minutes a reading is shown muted and marked "may be out of date", never dropped. While the host can't be used, every reading is dropped and the state is unknown.
- **In the list**, each graph trigger's row in **Triggers** shows its host state as a badge, whose tooltip gives the state and the host's reason, and screen readers hear the state as text. A trigger without a target, or whose state is unknown, shows none.
- **On the form**, the status line under the header shows the state in words, the host's reason, when it was checked, and **Check again**. For a pending candidate it adds **Open in browser** for the candidate's admission page. While the host can't be used, it reads "Host state unknown:" and the chip's label.
- **The host's `enabled` isn't the file's.** When the host's enabled state differs from the saved file's `enabled`, a note on the status line says so: disabling a trigger on the host doesn't change its file, and the file reaches the host only as a revision the owner admits.
- **The Revisions panel** under the fields lists what the latest `triggers show` gave, newest first: each revision's number, status (**Candidate, waiting for admission**, **Admitted**, **Rejected** or **Withdrawn**), the revision it was based on, when it was submitted, and which one is current. It shows 20 rows, and **Show N more** adds up to 20 at a time. When the host holds older revisions than it listed, the panel says so.

### Check a graph trigger and Submit it

**Check on host** and **Submit** sit under the trigger form's status line.

- **Check on host** runs `praxis triggers check <name> --workflow <target> --trigger <file>`, which writes nothing, on the saved files, and lists the host's findings by code and place, such as `EVENT_SOURCE_NOT_ADMITTED at /source`. Quay refuses to run it, and says why, when the trigger has no saved file or no saved target, its name or its target's name breaks the host's rule, or its saved files break a rule the form checks.
- **Submit** sends only the saved trigger file, as it is on disk, and names the graph workflow its saved target file names. It is disabled, with each reason shown, while:
  - the trigger has no **Starts** target;
  - the trigger or its target has unsaved edits, or was never saved;
  - the name breaks the host's rule;
  - the trigger's local checks, the SDK's and the graph trigger rules, are running or fail;
  - the host isn't signed in or simulated;
  - the target graph workflow isn't on the host, which says to submit it from its form first.
- **Warnings don't disable it.** Submit warns when the trigger file or its target file has changes that aren't committed, which are submitted as saved, or when Quay can't read git status. It warns too when the target graph workflow has no admitted revision on the host, because the host refuses the trigger's fires until the owner admits one.
- **When Quay reads the target.** With a saved target and a host it can use, the form reads the target graph workflow on the host with `praxis graphs show`, and again whenever the builder saves, renames or deletes a record.
- **Submit checks first.** It reads the target on the host again, then runs the check, and opens the confirm only when the target is there and the check passes. A failed read of the target stops it, with what the read said. Once the check passes, it reads the trigger's host state and git status again, and sends the host's current revision as the one the submission is based on.
- **The confirm** says the trigger becomes a candidate that doesn't fire until the owner admits it in the browser, and whether it starts enabled once admitted, from the saved file's `enabled`. It repeats the warning when the target has no admitted revision, and lists the trigger file and the target file, each with an **Uncommitted** badge when it has changes that aren't committed. Once the host stores it, the confirm names the new revision and offers **Open in browser** for its admission page, and the trigger's host state is read again.
- **Faults found at submission** close the confirm and show as the check's findings.
- **When Quay can't tell** whether the host stored the candidate, the confirm says so and offers **Submit again**, which resends the same submission, so it can't store a second candidate.

### Withdraw, Disable and Retire

Any session may stop a graph trigger's new work, so these controls sit under **Submit** on the trigger form, each shown only when the host state allows it and each behind a confirm. They are the only writes Quay makes to a graph trigger besides a submission.

- **Withdraw** is on the newest pending candidate, with `praxis triggers withdraw <name> <revision>`. The confirm names the revision and says the owner can no longer admit it. The host keeps it in the history as withdrawn, and the trigger falls back to its admitted revision's state, or to **Not submitted** when it has none.
- **Disable** is on a trigger the host holds an active, enabled revision of, with `praxis triggers disable <name>`. The confirm says new fires stop from when the host takes the request, that runs the trigger started already go on, that only the owner can enable it again in the browser, and that disabling it on the host doesn't change its saved file.
- **Retire** is on a trigger the host holds an active revision of, enabled or not, with `praxis triggers retire <name>`. Its confirm is stronger: its title and a warning say retiring can't be undone, that no one can bring the revision back, in Quay or in the browser, and that a retired trigger fires nothing until the owner admits a later revision. **Retire** is withheld until you tick that you understand.
- **Disable and Retire act on the trigger as it stands on the host.** `praxis` sends no revision with either, so the host has none to check the request against. Retire's confirm says the host retires the trigger as it stands when the request lands, which may not be the revision Quay shows.
- **The confirm closes** once the host has answered and the trigger has been read again, so the form shows the host's state afterwards.
- **A refusal stays in the confirm** in the host's words, and its button is then withheld. A candidate that is no longer pending, because the owner admitted or rejected it or it was withdrawn already, is refused that way.
- **When Quay can't tell** whether the host did it, the confirm says so, and pressing the button again resends the same request. Pressing it while one is in flight joins it. Closing the builder doesn't stop a write.

#### Enable in browser

Enabling a graph trigger is the owner's decision, so a trigger the host has disabled gets **Enable in browser**, not an enable button. It asks `praxis triggers show <name> --revision <N>` for the current revision's review page, where the owner enables the trigger, and opens it as **Open in browser** does, only on this machine's Praxis host. When `praxis` gives no page, or one elsewhere, Quay opens nothing and a notice says why.

### Fires

The **Fires** panel at the end of a graph trigger's form lists what the host did with each occurrence of the trigger, from `praxis triggers fires <name> --limit <N> --json`, newest first. It is closed until you press **Show fires**, and **Read again** rereads it at once.

- **Each fire** shows when the host received it, in local time, its disposition (`ADMITTED`, `FILTERED`, `REFUSED` or `SKIPPED`, as the host gives it) and the host's reason code, such as `RUN_HELD`. A fire that created a graph run has **Show run**, which opens the target graph workflow on its [Runs](#graph-runs) view with that run's detail shown. When the Runs list doesn't name that run, Quay looks for it: see [A run the Runs list doesn't name](#a-run-the-runs-list-doesn-t-name).
- **The newest 20 fires** show first. **Show more**, offered when the host holds older fires, lists the newest 100, the most one `praxis triggers fires` page gives. When the host holds older fires still, the panel says they aren't shown.
- **The panel reads** as soon as it opens, then 15 seconds after each read while it is open, the builder is shown and Quay's window is shown, or 60 seconds after a read fails. Closing the panel, opening another definition, closing the builder or hiding the window stops it, along with the `praxis` call in flight, and only the newest read's answer is kept.
- **While the host can't be used**, the last list stays, dimmed, with the time it was read and why. Any other failed read keeps the last list too, with what the read said.
- **A name the host refuses** is never sent, so the panel says so and reads nothing.

### Decisions happen in the browser

Admitting or rejecting a graph workflow or graph trigger candidate, retiring a graph workflow, enabling a graph trigger, approving a run, pausing it, cancelling it and resolving a hold are decided only in the host's browser page. Quay has no control for any of them, not even a disabled one, and never runs `praxis hold` or `praxis open`. Quay never fires a trigger by hand or sends a test event either: a trigger fires only on the host, and **Fires** shows what the host did with each occurrence. **Open in browser**, **Enable in browser** and **Resolve in browser** open the admission page, the review page or the run's page in your browser, and only when it is on this machine's Praxis host: an `https` address at the host's browser origin, `https://praxis-<label>.localhost:<port>/`, or at `https://127.0.0.1:<port>/`. Quay refuses any other address and says what `praxis` gave.
