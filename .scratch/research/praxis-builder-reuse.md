# Research: which builder code Quay borrows, and how

Ticket: seanrobertwright/Quay-2 #219, on the map "Wayfinder map: Praxis visual builder in Quay" (#227).
Researched 2026-10-23.

## Question

Which visual-builder code should Quay's Praxis builder borrow, and how? Judge the two candidates
against a node model that fits the SDK finite-v1 `Graph` (`{id, kind, dependsOn[], config,
inputSchema?, outputSchema?}`), not Archon's `DagNode`.

## Answer

- **Source:** the Archon builder is the primary source. Archon Workflow Studio contributes one
  design idea, the per-kind registry entry that carries its own renderer and inspector, and no
  copied code.
- **How:** copy files into Quay and adapt them, keeping the MIT notice. No package dependency is
  possible, and a full rewrite would throw away tested code that is already generic.
- **What carries over:** the pure editor kernels (undo history, alignment and distribution, smart
  guides, clipboard, dagre layout, reference and cycle checks, issue identity) almost unchanged.
  The reducer, the flow bridge and the canvas, issue list, toolbar, context menu and palette
  carry over after retyping and restyling.
- **What does not:** Archon's schema layer (`types/`, `variants/`, `model/`, `yaml/`), its inspector
  forms, its `when:` grammar and content rules, its keymap bindings, and everything in
  `BuilderConnected.tsx` and `connect/`.
- **New dependencies:** `@xyflow/react` and `@dagrejs/dagre`. Nothing else is required. Studio's
  zustand, zod, CodeMirror, react-query, react-hotkeys-hook and lodash are not needed.

## Sources

All read directly. Third-party content was treated as data.

- **Archon builder.** A sparse clone of coleam00/Archon `dev`, at commit
  `b9624b7581f7a13daf59afb80a6ec720f384b914`, path `packages/web/src/experiments/console/builder`.
  License: the repository `LICENSE`, MIT, "Copyright (c) 2025-2026 Cole Medin". Package
  versions from `packages/web/package.json`.
- **Archon Workflow Studio.** The local checkout of `seanrobertwright/archon-workflow-studio` at
  commit `084d359`, path `packages/studio-core`. It has no `LICENSE` file, and `README.md` says
  "License TBD". The repository belongs to Quay's author, so its licence does not block reuse.
- **Target model.** `AI-WS-SDK` at commit `9970459`: `spec/schema.json` `$defs.Graph` and
  `$defs.Node`, and `packages/typescript/src/workflow.ts` (`WorkflowNode`, `WorkflowGraph`,
  `NodeKind`, `validateGraph`). Package name and exports from `packages/typescript/package.json`.
- **Quay.** `package.json`, `tsconfig.json`, `src/index.css`, `src/slices/archon/dagLayout.ts`,
  `src/slices/stage/singlePane.test.ts`, on `origin/master` at commit `3381f8d`.
- **npm registry.** `npm view` on the current versions of `@xyflow/react` and `@dagrejs/dagre`,
  and on whether `@aiws/sdk` is published.

## What the target model asks of a builder

Read from `$defs.Graph`, `$defs.Node` and `validateGraph` in `workflow.ts`:

- A graph is `{id, revision, nodes}`. `nodes` holds 1 to 1000 entries. Both objects set
  `additionalProperties: false`, so **canvas positions cannot live in the graph**.
- A node is `{id, kind, dependsOn, config, inputSchema?, outputSchema?}`. `dependsOn` is a unique
  list of ids. Ids are any string of 1 to 256 characters, with no grammar.
- `validateGraph` requires unique ids, at least one `END`, `dependsOn` entries that name other
  existing nodes, and no cycles (`GRAPH_CYCLE`). Every node must reach an `END` (`NO_END_PATH`).
  `inputSchema` and `outputSchema` must compile as data schemas.
- Config is closed per kind. `TASK` takes `{executionKind}`, one of `AGENT`, `FUNCTION`, `TOOL`,
  `HUMAN`. `DECISION` takes `{field, equals, then, else}`. `JOIN` takes `{mode}`, `ALL` or `ANY`,
  and at least one dependency. `LOOP` takes `{maxIterations}`, a positive integer string. Every
  other kind takes `{}`.
- `DECISION.then` and `DECISION.else` are node ids. They must differ, and both targets must list
  the decision in their own `dependsOn`. So **node ids live in config as well as in
  `dependsOn`**, and a branch is a `dependsOn` edge with a label.
- `validateGraph` throws an `AiwsError` with one code on the first failure. It returns no list of
  issues and no node path.

## How each candidate fits

### Archon builder

The builder is the later of the two codebases. `editor/history.ts`, `editor/align.ts`,
`editor/clipboard.ts`, `editor/smart-guides.ts` and `flow/to-flow.ts` each say they were ported
from "the standalone studio", Archon Workflow Studio. The port removed zustand and module-level
state. History takes time as an explicit parameter. The reducer in `editor/state.ts` is a pure
`(state, action) => state` function with bun tests beside it.

The kernels are generic in all but their type imports:

| Module | Coupling to Archon | Change for Praxis |
| --- | --- | --- |
| `editor/history.ts` | `Snapshot` holds a `BuilderWorkflow` | Make `Snapshot` generic over the document type |
| `editor/align.ts` | None. Rectangles and positions only | None |
| `editor/smart-guides.ts` | None | None |
| `flow/layout.ts` (`layoutWithDagre`) | None | None |
| `validation/make-issue.ts`, `types/issue.ts` | None | None |
| `editor/clipboard.ts` | Reads `node.base.depends_on` | Read `dependsOn`. Remap or drop `DECISION.then`/`else` |
| `validation/graph.ts` (`validateGraph`) | Reads `node.base.depends_on` | Read `dependsOn`. Add Praxis rules (see below) |
| `flow/to-flow.ts`, `flow/from-flow.ts` | `BuilderWorkflow`, `nodeLabel`, dashed `when:` edges | Retype. Label `DECISION` branch edges |
| `editor/state.ts` (`editorReducer`) | `VariantId`, `VARIANT_REGISTRY`, `NODE_ID_PATTERN`, `edgeId` | Retype. Rewrite the reference sweeps (see below) |

The schema layer is Archon's own. `types/variant.ts` splits a wire `DagNode` into
`{id, variant, base, data}`. `types/wire.ts` imports the generated OpenAPI types from
`@/lib/api.generated`. `variants/` holds one `fromDag`/`toDag` pair per Archon kind. `model/` and
`yaml/` read and write Archon YAML. None of it fits a graph with 13 kinds and a closed config.

`variants/registry.ts` (`VARIANT_REGISTRY`) is a typed map from kind to label, default factory,
converters and capabilities. It carries no React components. `components/Inspector.tsx` and
`components/BuilderNodeView.tsx` (`contentPreview`) each `switch` on `node.variant` instead, so
adding a kind touches three places.

The components depend on the Archon console:

- `BuilderPage.tsx` uses the console's `useKeymap` and `KeymapHelp` (`../lib/keymap`,
  `../components/KeymapHelp`).
- `editor/keymap.ts` binds single keys with no modifiers ("vim-flavored single keys and
  `g`-chords"), because the console reserves Cmd/Ctrl combinations for the browser.
- Components style themselves with console token classes (`text-text-tertiary`,
  `bg-surface-hover`, `border-border`, `text-error`) and `--node-<variant>` CSS variables.
- `BuilderConnected.tsx` and `connect/` use the console's skills, store cache, router and HTTP
  helpers.

### Archon Workflow Studio (`packages/studio-core`)

- **Global state.** State lives in global zustand stores (`store/builder-store.ts`
  `useBuilderStore`, `store/undo-store.ts` `useUndoStore`). The undo coalescing window is
  module-level mutable state (`withUndo`, `resetCoalesceState`). That allows one builder per
  page, and its tests must reset globals.
- **Coupled to Archon's schema.** The schema is a zod mirror of Archon's `DagNode`
  (`schemas/dag-node.ts`). Each kind declares a `schema: z.ZodTypeAny` and maps to `DagNode`.
- **Different styling.** Components use CSS modules and their own `theme/tokens.css`, not
  Tailwind classes.
- **Heavier dependencies.** `package.json` lists zustand, zod, `@tanstack/react-query`,
  `react-hotkeys-hook`, `lodash.mergewith`, `yaml` and several CodeMirror packages. Its tests
  need happy-dom and Testing Library. `src` imports `@archon-studio/fixtures`.
- **Not a package.** It is `"private": true` and exports `./src/index.ts` (raw TypeScript). It
  is not a publishable package.

Its one idea worth taking is `nodes/shared/types.ts` `VariantDefinition<TData>`. Each kind's entry
carries `capabilities`, `library` (palette label, description, colour token, icon, id hint),
`createDefault`, `fromDag`/`toDag`, a `Renderer` component, an `Inspector` component and an
optional `renameBodyRefs`. `nodes/registry.ts` `buildRegistry` throws when a kind is missing or
listed under the wrong id. With this shape, adding a kind means adding one module. The optional
rename hook is the slot a Praxis `DECISION` needs, since its `then`/`else` hold node ids.

Its kernels (`alignment.ts`, `smart-guides.ts`, `hooks/useDagre.ts`, `clipboard.ts`,
`validation/rules/graph.ts`) are the earlier versions of the Archon builder's kernels. The
Archon versions are better on the points that matter here:

- `computeGuides` returns a snap position as well as the guide lines.
- `pasteEnvelope` remaps colliding ids and rewires internal dependencies. Studio's
  `parseClipboard` only parses JSON.
- `makeIssue` hashes a JSON-encoded key, so issue ids do not collide. Studio's `issueId` joins
  fields with `|` and documents the possible collisions.
- `layoutWithDagre` lets errors propagate. Studio's version catches them and stacks every node
  at the origin.

### Package dependency is not an option

Neither source is published. `@archon/web` and `@archon-studio/core` are both `"private": true`,
and both are bound to Archon's `DagNode`. No seam would let a Praxis `Graph` through either
package.

## Recommendation

**Take the Archon builder by copying and adapting it, with the MIT notice kept, and organise the
per-kind code on Studio's `VariantDefinition` pattern.**

Quay is `AGPL-3.0-only` (`package.json` `license`). MIT code may be included in an AGPL work
provided the copyright and permission notice stay with it. A sensible layout:

- A builder slice, for example `src/slices/praxis-builder/`, with a `NOTICE` (or `LICENSE.archon`)
  holding Archon's MIT text and copyright line, and the upstream commit
  `b9624b7581f7a13daf59afb80a6ec720f384b914`.
- A one-line provenance header on each copied file, naming the upstream path.
- The Studio-shaped registry is rewritten from the idea and cites no Studio code, so it needs no
  notice.

### Modules that carry over

Nearly as they are, with only type renames:

- Undo and redo: `editor/history.ts`, with a generic `Snapshot<Doc>`.
- Alignment, distribution and auto-arrange: `editor/align.ts`.
- Smart guides: `editor/smart-guides.ts` and the `components/SmartGuides.tsx` overlay.
- Dagre layout: `flow/layout.ts` `layoutWithDagre`.
- Issue identity: `validation/make-issue.ts` and `types/issue.ts` (`Issue`, `IssueId`,
  `Severity`, `IssuePath`). `IssueSource`'s `'server'` tier fits Praxis-side validation.

After retargeting to `dependsOn` and Praxis references:

- Clipboard: `editor/clipboard.ts`. Copy keeps internal `dependsOn` edges only. It must also clear
  `DECISION.then`/`else` that point outside the selection, and paste must remap the ones inside
  it.
- Reference and cycle checks: `validation/graph.ts`. Keep `graph.ref.unknown` and the
  three-colour cycle DFS. Add the rules `validateGraph` enforces, each with a node path:
  self-dependency, missing `END`, no path to `END`, duplicate ids, closed config per kind,
  `DECISION` target rules, `JOIN` needing a dependency, and `LOOP.maxIterations` format. The
  SDK's `validateGraph` stays the final gate before save.
- The flow bridge: `flow/to-flow.ts`, `flow/from-flow.ts`, `flow/types.ts`. Derive edges from
  `dependsOn`. Draw `DECISION` branches as labelled `then`/`else` edges in place of the dashed
  `when:` style. Keep the controlled-mode `initialWidth`/`initialHeight` seeding: the MiniMap
  needs it and its comment explains why.
- The reducer: `editor/state.ts`. The action set (`add-node`, `patch-node`, `rename-node`,
  `remove-nodes`, `add-edge`, `remove-selection`, `move-nodes`, selection, copy, cut and paste,
  align, distribute, auto-arrange, undo, redo) carries over. Three things change. `rename-node`,
  `remove-nodes` and `stripDeps` must also rewrite or clear `DECISION.then`/`else`, through the
  registry's rename hook. The `NODE_ID_PATTERN` check (`@/lib/node-ref`) goes, because Praxis ids
  have no grammar. And `edgeId` (`` `${source}->${target}` ``) is no longer safe: a Praxis id may
  contain `->`, so edge ids need an unambiguous encoding such as `JSON.stringify([source,
  target])`.

After restyling to Quay's Tailwind classes:

- `components/BuilderCanvas.tsx`: controlled ReactFlow, drop from the palette, smart-guide snap
  on single-node drag, keymap-owned delete.
- `components/IssueList.tsx`: grouped by severity; clicking an issue selects its node.
- `components/BuilderContextMenu.tsx`, `components/Toolbar.tsx` and `components/NodePalette.tsx`.

Quay has no token layer. `src/index.css` sets hex colours and imports Tailwind, so the console
token classes become Tailwind palette classes. The Toolbar's icons come from lucide-react, which
Quay already has at a newer major version (`^1.55.0` against Archon's `^0.563.0`). Check each
icon name when copying.

As patterns only:

- `editor/keymap.ts`. Keep the single `ENTRIES` table that feeds both the bindings and the help
  overlay. Drop the bindings themselves. Quay's builder wants Ctrl/Cmd chords (undo, copy,
  paste), and they must coexist with Quay's `Ctrl+B` prefix (`src/slices/workspace/ctrlBPrefix.ts`).
- `components/inspector/fields.tsx`. The field primitives are small and worth copying for their
  labelled markup. The per-kind forms are rewritten.

The tests carry over with their modules. `history`, `align`, `clipboard`, `smart-guides`,
`graph`, `state` and `flow` have pure unit tests written for `bun:test` (`describe`, `test`,
`expect`). Quay runs `node --test "src/**/*.test.ts"` with `node:test` and `node:assert/strict`,
and imports with explicit `.ts` extensions (`allowImportingTsExtensions`). Porting means
rewriting the assertions and adding extensions to relative imports.

### Modules that do not carry over

- **The Archon schema layer.** `types/variant.ts`, `types/wire.ts`, `types/wire-keys.ts`,
  `types/when.ts`, `variants/`, `model/`, `yaml/`, `fixtures/`. Praxis needs its own types: one
  entry per `NodeKind` holding a closed config shape, a default config, palette metadata, a node
  renderer, an inspector form and the reference-rewrite hook.
- **Archon content validation.** `validation/structural.ts`, `validation/content.ts`,
  `validation/when-grammar.ts` and `components/WhenBuilder.tsx`. They check Archon fields, `when:`
  expressions and `$node.output` references, none of which Praxis has. A `DECISION` holds
  `field` and `equals`, not an expression.
- **Archon inspector forms.** `components/Inspector.tsx` and `components/inspector/*Fields.tsx`.
  They are written per Archon kind and dispatched by `switch`.
- **The node view.** `components/BuilderNodeView.tsx` and its `contentPreview` switch. The layout
  idea (colour stripe, badge, label, preview) can be kept, but the code is per kind.
- **The YAML preview.** `components/YamlPreview.tsx` pulls in `react-markdown` and
  `rehype-highlight`. A JSON preview of the `Graph` would replace it if one is wanted.
- **Archon console wiring.** `BuilderConnected.tsx`, `connect/save-logic.ts` and
  `connect/use-builder-project.ts`. Quay's load and save path depends on how Quay talks to
  Praxis.
- **Copilot terms.** `CONTEXT.md` describes Archon's "Builder Copilot" and "Proposed Edit". This
  is out of scope, although the reducer's plain action objects would make such a feature easy
  later.
- **All of Studio's code.** It is the earlier version of the kernels above, and it is tied to
  zustand, zod and `DagNode`.

### Dependencies Quay would add

- `@xyflow/react`: Archon pins `^12.10.1`. The registry's current release is 12.12.0. The CSS
  import is `@xyflow/react/dist/style.css`, which Archon's `src/index.css` imports.
- `@dagrejs/dagre`: Archon pins `^2.0.4`, and the registry's current release is 3.1.2, with one
  dependency, `@dagrejs/graphlib`. Pin to the major version the copied `layoutWithDagre` was
  tested with, or test it on 3.x before taking the newer one.

React 19, Tailwind 4 and lucide-react are already Quay dependencies. Quay's own
`src/slices/archon/dagLayout.ts` `computeDagLayout` is a hand-written left-to-right layered
layout for read-only Archon graphs. It could stand in for dagre, but it computes Bezier paths for
its own SVG and has no crossing reduction. Dagre is the better fit for an editable canvas.

## Open questions this research surfaced

1. **Where canvas positions live.** `Graph` and `Node` reject extra properties, so positions
   need a sidecar: Quay app state, a file beside the definition, or a Praxis-side layout record.
   Studio's answer was `localStorage` keyed by server, working directory and workflow name
   (`hooks/usePositionPersistence.ts`). Archon's answer was "UI state", re-laid out by dagre on
   load.
2. **How a `DECISION` branch is drawn.** One option is two labelled source handles on the node,
   where drawing from `then` sets both `config.then` and the target's `dependsOn`. The other is
   ordinary edges with a branch picker in the inspector. `validateGraph` requires both halves to
   agree, so the editor should keep them in step. Leaving that to validation alone would be
   weaker.
3. **Who owns the issue list.** The SDK's `validateGraph` throws on the first failure and gives
   no node path, so the builder has to restate its rules to show issues per node. Should
   AI-WS-SDK export a validator that returns issues, so that the two cannot drift? This is a
   possible ticket on the paired map (AI-WS-SDK#247).
4. **How Quay gets the SDK's types and validator.** `@aiws/sdk` (0.4.0) is not on the npm
   registry, and its `package.json` has no `license` field (the repository root is CC0). Quay
   could vendor it, use a git or workspace dependency, or redeclare `NodeKind` and run validation
   only on the Praxis side.
5. **Who sets `revision`.** `Graph.revision` is required. Does the builder mint it on save, or
   does Praxis assign it when a definition is submitted? This ties to AI-WS-SDK#245.
6. **Editors for `inputSchema` and `outputSchema`.** Neither source has a JSON Schema editor.
   Studio's `JsonField` (a raw JSON textarea that rejects invalid input) is the minimal model.
   Is that enough for v1?
