// A graph's draft (#221): the record as loaded, saved or edited, and every node's position.
// Each definition touched in a session gets one. A draft is dirty when its content or
// positions differ from what was last loaded or saved (#248), compared by fingerprint, so
// moving a node back to where it was makes it clean again. The viewport isn't part of
// it, so pan and zoom never make a draft dirty.
import { graphToFlow } from "./flow/to-flow.ts";
import { parseGraph, parseLayoutPositions, type JsonObject, type ParseResult, type XYPosition } from "./model.ts";
import type { Viewport } from "./session.ts";
import type { DefinitionFile, DefinitionRef, LayoutInput } from "./types.ts";

export interface GraphDraft {
  ref: DefinitionRef;
  /** The record as last edited. Moving nodes never changes it. */
  content: JsonObject;
  /** Every node's position in integers, keyed by node id, in node order. */
  positions: ReadonlyMap<string, XYPosition>;
  /** The hash of the file as loaded or last saved, which a save expects to find. */
  baseHash: string | null;
  /** The fingerprint of the content and positions as loaded or last saved. */
  baseFingerprint: string;
  /** The fingerprint of the content and positions now. */
  fingerprint: string;
  /** The file was gone the last time the builder read it. */
  deletedOnDisk: boolean;
}

function fingerprintOf(content: JsonObject, positions: ReadonlyMap<string, XYPosition>): string {
  return JSON.stringify([content, [...positions]]);
}

const rounded = (p: XYPosition): XYPosition => ({ x: Math.round(p.x), y: Math.round(p.y) });

/**
 * A clean draft of a graph file that the canvas can draw. Nodes without a saved position
 * get the position the canvas would compute for them, so opening a graph never makes it
 * dirty.
 */
export function createGraphDraft(ref: DefinitionRef, file: DefinitionFile): ParseResult<GraphDraft> {
  const graph = parseGraph(file.content);
  if (!graph.ok) return graph;
  const content = file.content as JsonObject;
  const { nodes } = graphToFlow(graph.value, parseLayoutPositions(file.layout));
  const positions = new Map(nodes.map((n) => [n.id, rounded(n.position)]));
  const fingerprint = fingerprintOf(content, positions);
  return {
    ok: true,
    value: {
      ref,
      content,
      positions,
      baseHash: file.contentHash ?? null,
      baseFingerprint: fingerprint,
      fingerprint,
      deletedOnDisk: false,
    },
  };
}

export function isDirty(draft: GraphDraft): boolean {
  return draft.fingerprint !== draft.baseFingerprint;
}

/** The draft with `moved` nodes at new positions, rounded to integers. Unknown ids are ignored. */
export function moveNodes(draft: GraphDraft, moved: Iterable<[string, XYPosition]>): GraphDraft {
  let positions: Map<string, XYPosition> | null = null;
  for (const [id, position] of moved) {
    const current = draft.positions.get(id);
    const next = rounded(position);
    if (!current || (current.x === next.x && current.y === next.y)) continue;
    positions ??= new Map(draft.positions);
    positions.set(id, next);
  }
  if (!positions) return draft;
  return withChanges(draft, draft.content, positions);
}

/** The draft with this content and these positions, and its fingerprint to match. */
export function withChanges(draft: GraphDraft, content: JsonObject, positions: ReadonlyMap<string, XYPosition>): GraphDraft {
  return { ...draft, content, positions, fingerprint: fingerprintOf(content, positions) };
}

/** The layout `praxis_save` writes beside the graph. */
export function layoutForSave(draft: GraphDraft, viewport: Viewport | undefined): LayoutInput {
  return {
    nodes: [...draft.positions].map(([id, { x, y }]) => ({ id, x, y })),
    viewport: viewport ? { x: viewport.x, y: viewport.y, zoom: viewport.zoom } : null,
  };
}

/**
 * The draft after a save: the record as written, and the positions that were sent, are
 * its new base. An edit or a move made while the save was in flight keeps the draft dirty,
 * and an edit keeps its content in place of what was written.
 */
export function markSaved(
  draft: GraphDraft,
  saved: { content: JsonObject; contentHash: string },
  sent: { content: JsonObject; layout: LayoutInput }
): GraphDraft {
  const sentPositions = new Map(sent.layout.nodes.map(({ id, x, y }) => [id, { x, y }]));
  const content = draft.content === sent.content ? saved.content : draft.content;
  return {
    ...draft,
    content,
    baseHash: saved.contentHash,
    baseFingerprint: fingerprintOf(saved.content, sentPositions),
    fingerprint: fingerprintOf(content, draft.positions),
    deletedOnDisk: false,
  };
}

export function markDeletedOnDisk(draft: GraphDraft): GraphDraft {
  return draft.deletedOnDisk ? draft : { ...draft, deletedOnDisk: true };
}

/**
 * What to do with a draft when its file is read again (#221). A file with the hash the
 * draft loaded keeps it. A changed file reloads a clean draft quietly, and keeps a dirty
 * one, whose save then finds the conflict. A deleted file marks the draft deleted on disk.
 */
export function reconcileWithDisk(
  draft: GraphDraft,
  file: DefinitionFile
): { action: "keep"; draft: GraphDraft } | { action: "reload" } {
  if (file.missing) return { action: "keep", draft: markDeletedOnDisk(draft) };
  const same = file.contentHash !== undefined && file.contentHash === draft.baseHash;
  if (!same && !isDirty(draft)) return { action: "reload" };
  return { action: "keep", draft: draft.deletedOnDisk ? { ...draft, deletedOnDisk: false } : draft };
}
