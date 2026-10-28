// Copied from the Archon builder (coleam00/Archon b9624b7,
// packages/web/src/experiments/console/builder/editor/clipboard.ts), MIT; see ./NOTICE.
// Quay changes: retyped for Praxis finite-v1 nodes, versioned envelope `quay-praxis-nodes/1`,
// id clash remapping (drops trailing digits and takes the smallest free n), DECISION branch
// blanking for targets outside selection and remapping for internal targets, and position
// centring/offsetting.
/**
 * Versioned copy/cut/paste envelope. Holds nodes in an app-wide in-memory envelope
 * (`quay-praxis-nodes/1`), so copy and paste work across graphs and projects without
 * reading or writing the system clipboard.
 *
 * Copy filters `dependsOn` to edges inside the selection and blanks external DECISION
 * branch targets to `""`. Paste remaps colliding ids (dropping trailing digits and taking
 * the smallest free integer), rewires internal dependencies and branches through the
 * remap, and computes positions: a cascading offset when the originals are in view, at a
 * click point for the canvas's context-menu Paste, and centred in the viewport otherwise.
 * Each copied node's Runs as entry from the graph binding shown travels with it, and paste
 * writes it into the binding shown in the target under the remapped id (#248).
 */
import { withChanges, type Draft } from "./drafts.ts";
import { MAX_ID_LENGTH, nodesOf } from "./editor.ts";
import { entriesForNodes, withPastedEntries } from "./graphBinding.ts";
import { NODE_HEIGHT, NODE_WIDTH } from "./flow/layout.ts";
import { isObject, MAX_NODES, type JsonObject, type XYPosition } from "./model.ts";

/** A deep copy of a node, so an envelope and the drafts it is pasted into share no objects. */
const cloneNode = (node: JsonObject): JsonObject => JSON.parse(JSON.stringify(node)) as JsonObject;

export const CLIPBOARD_VERSION = "quay-praxis-nodes/1" as const;

export interface ClipboardEnvelope {
  version: typeof CLIPBOARD_VERSION;
  nodes: JsonObject[];
  /** Canvas positions of the copied nodes, keyed by (pre-remap) node id. */
  positions: Record<string, XYPosition>;
  /** Key of the source graph workspace, for checking if originals are in the same graph. */
  sourceKey?: string;
  /**
   * The copied nodes' Runs as entries from the graph binding shown at copy time, keyed by
   * (pre-remap) node id (#248, #273). Absent when no binding was shown.
   */
  runsAs?: Record<string, JsonObject>;
}

/** How far a pasted fragment is offset when the originals are in view (#248). */
export const PASTE_OFFSET = 24;

let appClipboard: ClipboardEnvelope | null = null;

/** The current app-wide in-memory clipboard envelope, or null when empty. */
export function getClipboard(): ClipboardEnvelope | null {
  return appClipboard;
}

/** Sets the app-wide in-memory clipboard. */
export function setClipboard(envelope: ClipboardEnvelope | null): void {
  appClipboard = envelope;
}

/**
 * An id that clashes drops any trailing `-<digits>` and takes the smallest free `n`
 * (`task-3` becomes `task-5`, `review` becomes `review-2`). Other ids are kept.
 */
export function remapId(id: string, taken: ReadonlySet<string>): string {
  if (!taken.has(id)) return id;
  const base = [...id.replace(/-\d+$/, "")];
  for (let n = 1; ; n++) {
    // A bare `base` counts as its first copy, so `review` becomes `review-2`.
    if (n === 1 && taken.has(base.join(""))) continue;
    const suffix = `-${n}`;
    // Shortened by code points where needed, so the id stays within the SDK's limit.
    const candidate = base.slice(0, MAX_ID_LENGTH - suffix.length).join("") + suffix;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Builds an envelope from the selected nodes. Only `dependsOn` edges inside the selection
 * are kept. A DECISION `then`/`else` inside the selection is kept, and one outside becomes `""`.
 * `bindingEntries` are the entries of the binding shown, whose entries for the selected nodes
 * travel with them. Returns null when the selection has no matching nodes.
 */
export function copySelection(
  nodes: readonly JsonObject[],
  selection: ReadonlySet<string>,
  positions: ReadonlyMap<string, XYPosition>,
  sourceKey?: string,
  bindingEntries?: Readonly<Record<string, JsonObject>>
): ClipboardEnvelope | null {
  const selected = nodes.filter((n) => typeof n.id === "string" && selection.has(n.id));
  if (selected.length === 0) return null;
  const internalIds = new Set(selected.map((n) => n.id as string));

  const copiedNodes: JsonObject[] = selected.map((node) => {
    const copy = cloneNode(node);
    const deps = Array.isArray(copy.dependsOn) ? copy.dependsOn : [];
    copy.dependsOn = deps.filter((dep) => typeof dep === "string" && internalIds.has(dep));
    if (copy.kind === "DECISION" && isObject(copy.config)) {
      const config = copy.config;
      if (typeof config.then === "string" && !internalIds.has(config.then)) config.then = "";
      if (typeof config.else === "string" && !internalIds.has(config.else)) config.else = "";
    }
    return copy;
  });

  const copiedPositions: Record<string, XYPosition> = {};
  for (const id of internalIds) {
    const pos = positions.get(id);
    if (pos !== undefined) copiedPositions[id] = { x: Math.round(pos.x), y: Math.round(pos.y) };
  }

  return {
    version: CLIPBOARD_VERSION,
    nodes: copiedNodes,
    positions: copiedPositions,
    ...(sourceKey !== undefined ? { sourceKey } : {}),
    ...(bindingEntries !== undefined ? { runsAs: entriesForNodes({ nodes: { ...bindingEntries } }, internalIds) } : {}),
  };
}

/**
 * The binding shown in the target graph with the envelope's Runs as entries written under the
 * ids its nodes were pasted as (#248): `pastedIds` are in the envelope's node order, as
 * `pasteIntoDraft` returns them. An envelope without entries leaves the binding as it is.
 */
export function pasteRunsAs(binding: JsonObject, envelope: ClipboardEnvelope, pastedIds: readonly string[]): JsonObject {
  if (!envelope.runsAs) return binding;
  const remap = new Map(envelope.nodes.map((n, i) => [n.id as string, pastedIds[i]]));
  return withPastedEntries(binding, envelope.runsAs, remap);
}

/**
 * Materializes an envelope: remaps colliding ids, rewires internal dependencies and
 * DECISION branches through the remap, and offsets positions by `delta`.
 */
export function pasteEnvelope(
  envelope: ClipboardEnvelope,
  existingIds: ReadonlySet<string>,
  delta: XYPosition = { x: PASTE_OFFSET, y: PASTE_OFFSET }
): { nodes: JsonObject[]; positions: Map<string, XYPosition>; remappedIds: string[] } {
  // A pasted id that clashes with nothing is kept, so a remapped id must not take it either.
  const ids = envelope.nodes.map((n) => n.id as string);
  const taken = new Set([...existingIds, ...ids]);
  const remap = new Map<string, string>();
  for (const id of ids) {
    const next = existingIds.has(id) ? remapId(id, taken) : id;
    remap.set(id, next);
    taken.add(next);
  }

  const nodes = envelope.nodes.map((node) => {
    const copy = cloneNode(node);
    copy.id = remap.get(node.id as string)!;
    const deps = Array.isArray(copy.dependsOn) ? copy.dependsOn : [];
    copy.dependsOn = deps.map((dep) => (typeof dep === "string" ? (remap.get(dep) ?? dep) : dep));
    if (copy.kind === "DECISION" && isObject(copy.config)) {
      const config = copy.config;
      if (typeof config.then === "string" && config.then !== "") config.then = remap.get(config.then) ?? "";
      if (typeof config.else === "string" && config.else !== "") config.else = remap.get(config.else) ?? "";
    }
    return copy;
  });

  const positions = new Map<string, XYPosition>();
  for (const node of envelope.nodes) {
    const id = node.id as string;
    const next = remap.get(id) ?? id;
    const orig = envelope.positions[id] ?? { x: 0, y: 0 };
    positions.set(next, {
      x: Math.round(orig.x + delta.x),
      y: Math.round(orig.y + delta.y),
    });
  }

  return {
    nodes,
    positions,
    remappedIds: envelope.nodes.map((n) => remap.get(n.id as string)!),
  };
}

/** Whether a graph of `nodeCount` nodes has room for the envelope's nodes. */
export const pasteFits = (nodeCount: number, envelope: ClipboardEnvelope): boolean =>
  nodeCount + envelope.nodes.length <= MAX_NODES;

/**
 * Applies a clipboard envelope into a draft at `delta`, returning the new draft and
 * the ids of the pasted nodes. Refuses if adding the nodes would exceed `MAX_NODES`.
 */
export function pasteIntoDraft(
  draft: Draft,
  envelope: ClipboardEnvelope,
  delta: XYPosition
): { draft: Draft; pastedIds: string[] } | null {
  const existingIds = new Set(nodesOf(draft.content).map((n) => n.id as string));
  if (!pasteFits(existingIds.size, envelope)) return null;
  const { nodes: newNodes, positions: newPositions, remappedIds } = pasteEnvelope(envelope, existingIds, delta);
  const before = Array.isArray(draft.content.nodes) ? draft.content.nodes : [];
  const positions = new Map(draft.positions);
  for (const [id, pos] of newPositions) positions.set(id, pos);
  const nextDraft = withChanges(draft, { ...draft.content, nodes: [...before, ...newNodes] }, positions);
  return { draft: nextDraft, pastedIds: remappedIds };
}

/**
 * Duplicates the selection in `draft` without touching the clipboard, offset as a paste
 * beside its originals is. Returns the updated draft and the ids of the new nodes, or null
 * when the selection is empty or the graph has no room.
 */
export function duplicateSelection(
  draft: Draft,
  selection: ReadonlySet<string>
): { draft: Draft; pastedIds: string[] } | null {
  const envelope = copySelection(nodesOf(draft.content), selection, draft.positions);
  if (!envelope) return null;
  return pasteIntoDraft(draft, envelope, cascadeDelta(envelope, draft.positions));
}

type Viewport = { x: number; y: number; zoom: number };
type Box = { width: number; height: number };
type Bounds = { left: number; top: number; right: number; bottom: number };

/** The part of the canvas the viewport shows, in canvas coordinates; null at a zoom of 0. */
function viewBounds(viewport: Viewport, box: Box): Bounds | null {
  if (!(viewport.zoom > 0)) return null;
  return {
    left: -viewport.x / viewport.zoom,
    top: -viewport.y / viewport.zoom,
    right: (-viewport.x + box.width) / viewport.zoom,
    bottom: (-viewport.y + box.height) / viewport.zoom,
  };
}

/** The box around the envelope's cards; null when it has none. */
function fragmentBounds(envelope: ClipboardEnvelope): Bounds | null {
  if (envelope.nodes.length === 0) return null;
  const at = envelope.nodes.map((n) => envelope.positions[n.id as string] ?? { x: 0, y: 0 });
  return {
    left: Math.min(...at.map((p) => p.x)),
    top: Math.min(...at.map((p) => p.y)),
    right: Math.max(...at.map((p) => p.x + NODE_WIDTH)),
    bottom: Math.max(...at.map((p) => p.y + NODE_HEIGHT)),
  };
}

/**
 * Whether any of the envelope's originals is still in the graph and shows in the viewport.
 * `positions` are the graph's own, so nodes since cut or deleted don't count.
 */
export function isOriginalsInView(
  envelope: ClipboardEnvelope,
  positions: ReadonlyMap<string, XYPosition>,
  viewport: Viewport,
  box: Box
): boolean {
  const view = viewBounds(viewport, box);
  if (!view) return false;
  return envelope.nodes.some((node) => {
    const p = positions.get(node.id as string);
    return (
      p !== undefined &&
      p.x + NODE_WIDTH > view.left &&
      p.x < view.right &&
      p.y + NODE_HEIGHT > view.top &&
      p.y < view.bottom
    );
  });
}

/** The delta that centres the envelope's cards in the viewport. */
export function computeCenteredDelta(envelope: ClipboardEnvelope, viewport: Viewport, box: Box): XYPosition {
  const view = viewBounds(viewport, box);
  const fragment = fragmentBounds(envelope);
  if (!view || !fragment) return { x: 0, y: 0 };
  return {
    x: Math.round((view.left + view.right) / 2 - (fragment.left + fragment.right) / 2),
    y: Math.round((view.top + view.bottom) / 2 - (fragment.top + fragment.bottom) / 2),
  };
}

/** The delta that puts the top-left of the envelope's cards at `clickPoint`. */
export function computeClickDelta(envelope: ClipboardEnvelope, clickPoint: XYPosition): XYPosition {
  const fragment = fragmentBounds(envelope);
  if (!fragment) return { x: 0, y: 0 };
  return { x: Math.round(clickPoint.x - fragment.left), y: Math.round(clickPoint.y - fragment.top) };
}

/**
 * The smallest multiple of `PASTE_OFFSET` at which none of the envelope's cards lands on a
 * card already in the graph, so each repeat paste beside the originals cascades.
 */
export function cascadeDelta(envelope: ClipboardEnvelope, positions: ReadonlyMap<string, XYPosition>): XYPosition {
  const spot = (x: number, y: number) => `${Math.round(x)},${Math.round(y)}`;
  const taken = new Set([...positions.values()].map((p) => spot(p.x, p.y)));
  const origins = envelope.nodes.map((n) => envelope.positions[n.id as string] ?? { x: 0, y: 0 });
  // Each card in the graph blocks at most one step per pasted card, so this ends.
  for (let n = 1; ; n++) {
    const d = PASTE_OFFSET * n;
    if (!origins.some((p) => taken.has(spot(p.x + d, p.y + d)))) return { x: d, y: d };
  }
}

/**
 * Where a paste into `draft` goes, as a delta from the copied positions: at `at`, a point on
 * the canvas, for the context menu's Paste; offset beside the originals when they are in
 * this graph and in view; centred in the viewport otherwise.
 */
export function pasteDelta(
  envelope: ClipboardEnvelope,
  draft: Draft,
  graphKey: string,
  viewport: Viewport,
  box: Box,
  at?: XYPosition
): XYPosition {
  if (at) return computeClickDelta(envelope, at);
  if (envelope.sourceKey === graphKey && isOriginalsInView(envelope, draft.positions, viewport, box)) {
    return cascadeDelta(envelope, draft.positions);
  }
  return computeCenteredDelta(envelope, viewport, box);
}
