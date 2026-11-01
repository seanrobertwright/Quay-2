# Which praxis CLI commands will submit graph workflows and follow graph runs

Research for [Quay-2 #443](https://github.com/seanrobertwright/Quay-2/issues/443), under map
[#227](https://github.com/seanrobertwright/Quay-2/issues/227). It feeds
[#444](https://github.com/seanrobertwright/Quay-2/issues/444).

## Short answer

- **No `praxis` command for graph workflows or graph runs is built, planned by name or ticketed.** The
  routes are decided ([AI-WS-SDK #245](https://github.com/seanrobertwright/AI-WS-SDK/issues/245)), the CLI side
  of them is not. Nothing on map [AI-WS-SDK #247](https://github.com/seanrobertwright/AI-WS-SDK/issues/247)
  names a verb, an argument, a `--json` format or an exit code for them, and the map has not been sliced.
- **The graph-run read model has no shape yet.** #248 already places it in the contracted set and says it
  starts `PROVISIONAL`, but its shape belongs to the map's open item "Events and observability for graph runs".
- **Admission and run approval are browser-only, owner-only and passkey-gated**, as for templates. A client
  can see that a candidate is pending, and can't run it.
- **The bundle is one main graph, its binding, one contract and one grant set, plus child graphs with their own
  bindings.** Triggers and layout are not in it. Quay's `.praxis/` files hold every record, but one Quay contract
  binds many graphs and grants, so Quay has to split it into one bundle per graph.
- **No `praxis` command lists catalog agents.** The host has an agent picker route, but #248 keeps it
  host-internal, and the only client for it is the developer tool `control-cli agent-picker`.

## Source and method

- Read from AI-WS-SDK (`seanrobertwright/AI-WS-SDK`) at `origin/main`, commit `9d5f8860` (2026-11-01). Its
  default branch is `main`.
- Code read: `engine/src/praxis.ts` (`runPraxis`, the `commands` table, `praxisUsage`), `praxis-workflows.ts`
  (`workflowsUsage`), `praxis-runs.ts` (`runUsage`), `praxis-follow.ts` (`followUsage`, `operatorView`),
  `control-cli.ts` (`agentPicker`, `nodeRows`), `control-http.ts`, `control-service.ts` (`agentPicker`),
  `operator-view.ts`, `packages/python/src/aiws/cli.py` and `packages/typescript/src/cli.ts` (the `agents`
  subcommand).
- Docs read: `docs/M12-BUILD-PLAN.md` ("Graph workflow submission and admission", "Graph trigger firing"),
  `CONTEXT.md` (the graph workflow terms, **Agent catalog**, **Agent picker**), `spec/engine-v1/READ-MODELS.md`,
  `spec/engine-v1/read-models.schema.json`, `spec/engine-v1/GRAPH-BINDING.md`, `spec/engine-v1/AUTHENTICATION.md`
  (the action table), `src/content/docs/capabilities.md`.
- Issues read: [#245](https://github.com/seanrobertwright/AI-WS-SDK/issues/245) with its amendment,
  [#248](https://github.com/seanrobertwright/AI-WS-SDK/issues/248),
  [#253](https://github.com/seanrobertwright/AI-WS-SDK/issues/253),
  [#244](https://github.com/seanrobertwright/AI-WS-SDK/issues/244),
  [#261](https://github.com/seanrobertwright/AI-WS-SDK/issues/261),
  [#325](https://github.com/seanrobertwright/AI-WS-SDK/issues/325),
  [#379](https://github.com/seanrobertwright/AI-WS-SDK/issues/379), map
  [#247](https://github.com/seanrobertwright/AI-WS-SDK/issues/247) and its open sub-issues #374 to #378. Searches
  for "graph workflow", "graph run", "praxis graph", "graph-workflows", "agents list" and "agent picker" over open
  and closed issues found no CLI ticket for graphs.
- Quay side: `docs/features/praxis-builder.md` ("Where definitions live"), `src-tauri/src/slices/praxis/models.rs`
  `BindingsInput`, and the earlier note `.scratch/research/praxis-cli-for-quay.md` on branch
  `research/praxis-cli-for-quay`, whose findings on the template commands still hold and are not repeated here.
- No Praxis host was run.

## 1. CLI verbs for the graph workflow routes

**Decided (routes, not verbs).** M12 "Graph workflow submission and admission" fixes these working names, all
profile routes at `PROVISIONAL`, outside wire 1.1.0, answered `422 UNSUPPORTED_CAPABILITY` by a host without
graph workflows. The spec fixes the final names.

| Route | Host action | What #245 says it carries |
| --- | --- | --- |
| `POST /engine/graph-workflows/v1` | `graph-workflow-submit` | The bundle inline, with `name`, `baseRevision` and `requestId` |
| `POST /engine/graph-workflows/v1/check` | `graph-workflow-submit` | Same validation, writes nothing |
| `GET /engine/graph-workflows/v1` | `graph-workflow-read` | Names, current revision, pending count, `RETIRED` |
| `GET /engine/graph-workflows/v1/<name>` | `graph-workflow-read` | Current revision with fresh readiness, `runnable` and the review digest |
| `GET /engine/graph-workflows/v1/<name>/revisions[/<n>]` | `graph-workflow-read` | Candidates, decisions and one revision's material |
| withdraw (no path yet) | `graph-workflow-withdraw` | Any session in scope may withdraw any pending candidate |
| `POST /engine/graph-runs/v1` | `graph-run` | A closed `aiws-graph-run/1` request with `name`, `revision`, `reviewDigest` and `requestId`; the template run's rules for receipts, replay, staleness, readiness and held runs apply |
| graph trigger submit (no path yet) | `graph-trigger-submit` | A trigger record on its own, under its own name and revision |

All of these are in the decision-free session's reach: "Any session in scope, including an `AGENT`-kind session
with no decision rights (the `praxis` CLI, and later Quay)". The template catalog (`aiws-workflow-catalog/1`) and
`aiws-workflow-run/1` don't change, so graph workflows will not show in `praxis workflows list`.

Refusal codes already named: `GRAPH_WORKFLOW_EXPIRED` (`commitStatus: NOT_COMMITTED`), a stale-revision refusal
"as `STALE_WORKFLOW_TEMPLATE` is for templates" (no code name yet), `READINESS_BLOCKED`, `HUMAN_REQUIRED` for
admit, reject and retire from anyone but the owner in the web view, and, from #253, `BUNDLE_CHILD_UNUSED`,
`BUNDLE_CHILD_CYCLE`, `BUNDLE_CHILD_UNVERIFIABLE` and `BINDING_CHILD_UNKNOWN`. Trigger refusals are listed in
M12 "Graph trigger firing".

**Built: nothing.** M12 says "Nothing in it is built: no route, record or web-view page exists yet, and
`spec/engine-v1/` doesn't specify them yet." The code agrees:

- `runPraxis`'s `commands` table holds exactly `workflows`, `run`, `runs`, `follow`, `status`, `hold`, `open`,
  `trust`, `setup`, `login`, `logout` and `serve`. No `praxis-*.ts` file mentions a graph.
- No file in `engine/src` or `spec/engine-v1` contains `graph-workflow` or `graph-run`.
- `AUTHENTICATION.md`'s action table has `workflow-run` and no graph action.
- The capability matrix row "Graph runs on Praxis" is `Proposed`, "none of it built".

**Neither decided nor ticketed: the CLI side.** No source names a `praxis` verb, argument, `--json` record or exit
code for these routes. M12 "Slices" says "Slices are written when the map is sliced", the map's last fog item is
"Slicing", and its open sub-issues #374 to #378 are SDK work (Cargo features, the scratch-mission API, graph
diagnostics, the 0.5.0 release), none of them CLI. When the CLI gets graph verbs is therefore unknown; it is after
the map is sliced and after the routes exist.

What carries over by decision, not by naming:

- **`--format`.** [#261](https://github.com/seanrobertwright/AI-WS-SDK/issues/261) is closed as a decision: every
  `praxis` read command takes `--format <name>/<N>` with `--json`, exits 8 `FORMAT_NOT_SERVED` when the host doesn't
  serve it, exits 2 for a bad value, and prints a `praxis-error/1` record on `--json` failures. It is specified in
  `WORKFLOW-TEMPLATES.md` and not built: no `engine/src` file contains `--format` or `FORMAT_NOT_SERVED`, and
  `READ-MODELS.md` still says `?format=` negotiation is not built. A future graph read command would inherit it.
- **Raw records.** #248 says "`praxis --json` prints the raw read model at the format the CLI requested, so it
  inherits the contract."
- **Run creation behaviour.** "The template run's rules for receipts, replay, staleness, readiness and held runs"
  apply to `graph-run`, so a graph `run` verb would most likely mirror `praxis run`: a saved `requestId`, resends
  while the outcome is unknown, and exit 7 for a held earlier run. That is an inference; nothing states it for the CLI.

**A trap if Quay tries today's commands on a graph run.** `praxis status` and `follow` read
`GET /engine/operator-view/v1/<id>` and exit 1 unless `format === "coding-operator-view/1"` (`praxis-follow.ts`
`operatorView`). Whether a graph run's operator view keeps that format is undecided, so today's `status` and
`follow` can't be assumed to work on a graph run.

## 2. The read model of a graph run, per node

**Decided (status, not shape).** #248 decides that the contracted set is exactly what a decision-free client
session may read, and that "Every graph-run read model starts `PROVISIONAL`". Since a session in scope may create
and read graph runs, their read models will be contracted under #248: a `$def` in `read-models.schema.json`,
fixtures, the engine's strict-mode route test, `format: "<name>/<N>"` on every record, and `PROVISIONAL` until M12
is recorded Complete. #248 also says "The shape of the graph-run read model belongs to 'Events and observability for
graph runs'".

**Neither decided nor built: the shape.** Map #247's "Not yet specified" list has "**Events and observability for
graph runs:** which events and operator-view fields a graph run emits, so a client can draw node states live. Today
the operator view is built around coding stages, and polling is the only way to follow a run." No ticket covers it.

What exists today, for coding runs only:

- `operator-view.ts` builds `coding-operator-view/1`, which already has a `nodes` array (`nodeRowsOf`), the run's
  node table with each row's detail and badges. `control-cli node-rows` prints it. That table is the coding
  profile's stages, not finite-v1 nodes.
- `read-models.schema.json` contracts only the five `aiws-workflow-*` formats. The operator view, hold card, attempt
  history and binding review are decided as contracted (and `STABLE`) by #248 but have no `$def` yet, so they are
  host-internal today (`READ-MODELS.md`, "Contracted records").
- What a graph node's state could be is bounded by the SDK and #244: Praxis runs the SDK's `reduce` and
  `readyNodes` on one snapshot per work order, so node status comes from the finite-v1 snapshot. Which of its fields
  the read model exposes is not decided.

Following a run stays polling: no event stream or push is decided for any run kind.

## 3. How admission and per-run approval reach the operator

**Decided.**

- **Two gates**, as for templates. Admission once per revision, run approval once per run; "Neither gate replaces
  the other."
- **Admit, reject and retire are owner-only, in the web view**, with a one-time human challenge. Anyone else gets
  `HUMAN_REQUIRED`. The challenge covers the graph workflow review digest, RFC 8785 over
  `{purpose: "aiws-graph-workflow-review/1", name, revision, workflowDigest, bindings}`, where `bindings` holds the
  readiness binding of each AGENT node, so a manifest change between viewing and confirming makes the admission
  stale.
- **The admission page shows** the graph, each node's agent, commands and exposure, the contract's budget, deadline
  and criteria, each grant, the diff against the current revision (and whether its base is out of date), the
  submitting actor, fresh readiness per AGENT node, and "unchanged since revision N" for reused records (#245
  sections 4, 5 and 7).
- **Run approval** is unchanged from templates: `POST /engine/graph-runs/v1` creates a run in `AWAITING_APPROVAL`,
  and a human approves it in the web view. One approval covers the whole run tree, child runs included (#253).
- **Triggers** are admitted separately by the owner; a fire only creates a run that waits for approval.

**What a client sees while a revision is a candidate** (decided, not built):

- `GET /engine/graph-workflows/v1` gives each name's current revision and pending count.
- `GET /<name>/revisions[/<n>]` gives candidates, decisions and one revision's material.
- `GET /<name>` gives only the current admitted revision.
- A candidate "is immutable, grants nothing and can't be run" (`CONTEXT.md` **Candidate**). A run request naming
  any revision but the current one is refused as stale. A name with no admitted revision has nothing to run.
- Several candidates may be pending at once, each recording its `baseRevision`; submissions never conflict, and
  pending candidates are capped per name and per host at numbers the spec will fix.
- Admitting candidate N leaves other candidates pending; admitting one older than the current revision is refused.
- Any session in scope may withdraw any pending candidate.

**Neither decided nor built.**

- **How the owner learns a candidate is waiting.** No notification is decided. #248 and #247 leave "the web-view
  deep link that Quay opens for a decision" to the fog item "Clients other than the `praxis` CLI", which says the
  deep link "is written for the `praxis` binary alone". Today's deep link is `runPageAddress`,
  `<browserOrigin>/#work-order=<id>`, for a run; no address exists for an admission page.
- **The record formats** of the list, detail, revisions and submit result. None is named or schematised.

## 4. What the submitted bundle holds, and how `.praxis/` maps onto it

**Decided** (#245 section 4, amended by #253 section 2; M12 "The bundle"):

| In one graph workflow revision | Notes |
| --- | --- |
| One main graph revision | Strict-JSON finite-v1 `Graph`, validated against `spec/schema.json`; marked as main, and the only graph `POST /engine/graph-runs/v1` starts |
| One `aiws-graph-binding/1` revision for it | `GRAPH-BINDING.md`; pins `graphId`, `graphRevision` and `graphDigest` |
| Zero or more child graphs, each with its own binding revision | Reached by a SUBWORKFLOW entry naming `childGraphId`; a tree, each child reached once |
| One `Contract` | Its absolute `deadline` stays literal for every run |
| One grant set | `notBefore` and `expiresAt` stay literal; must be consistent with the contract |

- The bundle has one digest and one admission. Records are stored by content and may be shared between graph
  workflows.
- **Not in the bundle:** triggers (submitted on their own, must name the target's contract), and anything about
  layout (Praxis accepts only finite-v1 records and the binding, and "doesn't trust what authored a definition").
- **Refused at submission:** invalid JSON or over the size cap, schema or `GRAPH-BINDING.md` failures, times
  already passed, contract and grant inconsistency, and any FUNCTION, HUMAN, SUBWORKFLOW or COMPENSATION node,
  with a named reason, until their execution is built. **So a bundle with child graphs is decided but would be
  refused today**, since SUBWORKFLOW stays refused until proposal
  [#371](https://github.com/seanrobertwright/AI-WS-SDK/issues/371) lands.
- **No compiler in Praxis.** "Conversion is the client's job" (M12 exclusion 1), so Quay assembles the bundle.
- The check route is fed by `diagnoseGraph`, whose SDK build is #377; the engine check route is blocked by it (#256).

**Not decided: the request body's field names**, beyond `name`, `baseRevision` and `requestId`. How the graph,
binding, children, contract and grants sit in the JSON waits for `GRAPH-WORKFLOWS.md`.

**How Quay's `.praxis/` files map** (Quay's layout from `docs/features/praxis-builder.md`; the mapping is this
note's reading, not a decision):

| Quay file | Bundle part | Gap |
| --- | --- | --- |
| `graphs/<id>.json` | Main graph, or a child graph | One file can be a child in one bundle and main in another; each child appears once per tree, so reuse at two sites means two ids (#253) |
| `graph-bindings/<id>.json` | The binding for that graph | Quay lets a graph have several bindings and remembers the picked one only while Quay runs; a bundle needs exactly one per graph, chosen at submit |
| `contracts/<id>.json` | The contract | |
| `bindings/<contract-id>.json` (`BindingsInput` `graphs`, `grants`) | Says which graphs and grants go with the contract | **One Quay contract binds many graphs; a bundle has one main graph.** Quay needs one graph workflow per (contract, main graph) pair, carrying all the contract's grants as the grant set |
| `grants/<id>.json` | The grant set | Parent grants of a delegation chain presumably travel too; not stated |
| `triggers/<id>.json` | Not in the bundle; submitted with `graph-trigger-submit`, targeting a graph workflow **name** | A Quay trigger names a contract, not a graph workflow name, so Quay must also pick the target name |
| `layout/<graph-id>.json` | Not sent | |
| `templates/<name>.json` | Not a graph workflow; stays the template catalog | |

Two more frictions:

- **Name grammar.** A graph workflow name follows the template rule `templateNameRefusal`,
  `^[a-z][a-z0-9-]{0,62}$` minus Windows device names, in its own namespace. Quay ids allow upper case, `.` and `_`
  up to 128 characters, so a Quay id can't always be the graph workflow name.
- **Revisions.** Quay writes a content-digest `revision` on graphs and `graphBindingRevision` on bindings. The
  graph workflow revision is a separate host-assigned integer that a client can't predict, and the review digest
  depends on host readiness, so a client can't compute it (as for templates).

## 5. Does any command list catalog agents?

**No `praxis` command does, and none is planned.**

- The host has `GET` and `POST /engine/agent-picker/v1` (`control-http.ts`), serving `aiws-agent-picker/1`: "every
  agent the host's agent catalog offers", each selectable or listed with the reasons it is refused
  (`control-service.ts` `agentPicker`, `CONTEXT.md` **Agent picker**). It needs the host action `agent-picker`.
- Its only client is the developer tool `engine/src/control-cli.ts` `agent-picker [PLAN_JSON] [--json]`, which takes
  an HTTPS origin, a CA file and credential JSON on stdin. It is not part of `praxis`.
- **#248 decides it is host-internal**: "Anything a client session can't read (register view, notice list, upgrade
  preflight, agent picker, authoring preview) stays host-internal and may change without notice." So a decision-free
  CLI session can't read it today, and it has no contract.
- `aiws agents sync|check` in the SDK CLIs (`packages/typescript/src/cli.ts`, `packages/python/src/aiws/cli.py`)
  syncs the agent docs pack into `AGENTS.md`. It has nothing to do with catalog agents.
- The nearest thing a client can read is the per-AGENT-node readiness in a template detail
  (`praxis workflows show NAME --json`, `readiness`) and, once built, in a graph workflow's detail route. That
  checks named agents; it doesn't list the catalog.

So the agent picker in Quay's builder has no host source a client can read. Getting one means a new decision on
AI-WS-SDK: widen the client session's scope to `agent-picker` (which #248 says grows the contracted set with it), or
add a new read.

## Not established from source

- When graph CLI verbs will exist. Nothing dates or tickets them.
- The final route paths, withdraw's and trigger submit's paths, and every record format name except
  `aiws-graph-run/1` (the run request) and `aiws-graph-workflow-review/1` (the digest purpose).
- Whether a graph run's work order id matches `praxis-client.ts` `runIdPattern`, so whether today's
  `praxis status RUN` would even accept it as an argument.
- Whether the grant set in a bundle must include every ancestor of a delegated grant.
- The pending-candidate caps and the bundle size cap; "the spec fixes the numbers".
