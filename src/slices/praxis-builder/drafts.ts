// A definition's draft (#221): the record as loaded, saved or edited, with every node's
// position for a graph and the binding record for a contract (#223). Each graph, contract or
// grant touched in a session gets one. A draft is dirty when any of these differ from what was
// last loaded or saved (#248), compared by fingerprint, so moving a node back to where it
// was makes it clean again. The viewport isn't part of it, so pan and zoom never make a
// draft dirty.
import { applyContractEdit, EMPTY_BINDINGS, parseBindings, type Bindings, type ContractEdit } from "./contract.ts";
import { graphToFlow } from "./flow/to-flow.ts";
import { applyGrantEdit, type GrantEdit } from "./grant.ts";
import { isObject, parseGraph, parseLayoutPositions, type JsonObject, type ParseResult, type XYPosition } from "./model.ts";
import type { Viewport } from "./session.ts";
import type { DefinitionFile, DefinitionRef, LayoutInput } from "./types.ts";

export interface Draft {
  ref: DefinitionRef;
  /** The record as last edited. Moving nodes never changes it. */
  content: JsonObject;
  /** Every node's position in integers, keyed by node id, in node order; empty for a contract. */
  positions: ReadonlyMap<string, XYPosition>;
  /** A contract's graphs and grants, saved to its bindings file; null for any other kind. */
  bindings: Bindings | null;
  /** The hash of the file as loaded or last saved, which a save expects to find; null for a definition never saved. */
  baseHash: string | null;
  /** The hash of a contract's bindings file as loaded or last saved; null when there was none. */
  baseBindingsHash: string | null;
  /** The fingerprint of the content, positions and bindings as loaded or last saved. */
  baseFingerprint: string;
  /** The fingerprint of the content, positions and bindings now. */
  fingerprint: string;
  /** The file was gone the last time the builder read it. */
  deletedOnDisk: boolean;
}

function fingerprintOf(content: JsonObject, positions: ReadonlyMap<string, XYPosition>, bindings: Bindings | null): string {
  return JSON.stringify([content, [...positions], bindings]);
}

const rounded = (p: XYPosition): XYPosition => ({ x: Math.round(p.x), y: Math.round(p.y) });

function cleanDraft(
  ref: DefinitionRef,
  content: JsonObject,
  positions: ReadonlyMap<string, XYPosition>,
  bindings: Bindings | null,
  file: DefinitionFile
): Draft {
  const fingerprint = fingerprintOf(content, positions, bindings);
  return {
    ref,
    content,
    positions,
    bindings,
    baseHash: file.contentHash ?? null,
    baseBindingsHash: file.bindingsHash ?? null,
    baseFingerprint: fingerprint,
    fingerprint,
    deletedOnDisk: false,
  };
}

/**
 * A clean draft of a graph file that the canvas can draw. Nodes without a saved position
 * get the position the canvas would compute for them, so opening a graph never makes it
 * dirty.
 */
export function createGraphDraft(ref: DefinitionRef, file: DefinitionFile): ParseResult<Draft> {
  const graph = parseGraph(file.content);
  if (!graph.ok) return graph;
  const { nodes } = graphToFlow(graph.value, parseLayoutPositions(file.layout));
  const positions = new Map(nodes.map((n) => [n.id, rounded(n.position)]));
  return { ok: true, value: cleanDraft(ref, file.content as JsonObject, positions, null, file) };
}

/**
 * A clean draft of a contract file and its bindings file (#223). Any JSON object opens,
 * since the form shows what the SDK refuses. A bindings file that can't be read opens as none.
 */
export function createContractDraft(ref: DefinitionRef, file: DefinitionFile): ParseResult<Draft> {
  if (!isObject(file.content)) return { ok: false, message: "The contract isn't a JSON object." };
  const bindings = file.bindings === undefined ? EMPTY_BINDINGS : parseBindings(file.bindings);
  return { ok: true, value: cleanDraft(ref, file.content, new Map(), bindings, file) };
}

/** A clean draft of a grant file (#223). Any JSON object opens, since the form shows what the SDK refuses. */
export function createGrantDraft(ref: DefinitionRef, file: DefinitionFile): ParseResult<Draft> {
  if (!isObject(file.content)) return { ok: false, message: "The grant isn't a JSON object." };
  return { ok: true, value: cleanDraft(ref, file.content, new Map(), null, file) };
}

/** Whether the builder edits definitions of `kind` through drafts: graphs, contracts and grants so far. */
export const hasDrafts = (kind: DefinitionRef["kind"]) => kind === "graphs" || kind === "contracts" || kind === "grants";

/** A clean draft of a file of a kind the builder edits, a graph, a contract or a grant; other kinds have none. */
export function createDraft(ref: DefinitionRef, file: DefinitionFile): ParseResult<Draft> {
  switch (ref.kind) {
    case "graphs":
      return createGraphDraft(ref, file);
    case "contracts":
      return createContractDraft(ref, file);
    case "grants":
      return createGrantDraft(ref, file);
    default:
      return { ok: false, message: `The builder can't edit ${ref.kind} yet.` };
  }
}

/**
 * The draft of a definition created in the builder and not yet saved (#222). It is dirty
 * until its first save, which writes the file and its folder.
 */
export function createNewDraft(ref: DefinitionRef, content: JsonObject): ParseResult<Draft> {
  const created = createDraft(ref, { id: ref.id, kind: ref.kind, missing: false, content });
  if (!created.ok) return created;
  return { ok: true, value: { ...created.value, baseHash: null, baseFingerprint: "" } };
}

/** The draft under another id, with that id inside its record. */
export function withId(draft: Draft, ref: DefinitionRef): Draft {
  return { ...withChanges(draft, { ...draft.content, id: ref.id }, draft.positions), ref };
}

export function isDirty(draft: Draft): boolean {
  return draft.fingerprint !== draft.baseFingerprint;
}

/** The draft with `moved` nodes at new positions, rounded to integers. Unknown ids are ignored. */
export function moveNodes(draft: Draft, moved: Iterable<[string, XYPosition]>): Draft {
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

/** The draft with this content, these positions and these bindings, and its fingerprint to match. */
export function withChanges(
  draft: Draft,
  content: JsonObject,
  positions: ReadonlyMap<string, XYPosition>,
  bindings: Bindings | null = draft.bindings
): Draft {
  return { ...draft, content, positions, bindings, fingerprint: fingerprintOf(content, positions, bindings) };
}

/** A contract's draft after `edit`, or the same draft when the edit changes nothing. */
export function editContractDraft(draft: Draft, edit: ContractEdit): Draft {
  const bindings = draft.bindings ?? EMPTY_BINDINGS;
  const next = applyContractEdit(draft.content, bindings, edit);
  if (next.content === draft.content && next.bindings === bindings) return draft;
  return withChanges(draft, next.content, draft.positions, next.bindings);
}

/** A grant's draft after `edit`, or the same draft when the edit changes nothing. */
export function editGrantDraft(draft: Draft, edit: GrantEdit): Draft {
  const content = applyGrantEdit(draft.content, edit);
  return content === draft.content ? draft : withChanges(draft, content, draft.positions);
}

/** The layout `praxis_save` writes beside the graph. */
export function layoutForSave(draft: Draft, viewport: Viewport | undefined): LayoutInput {
  return {
    nodes: [...draft.positions].map(([id, { x, y }]) => ({ id, x, y })),
    viewport: viewport ? { x: viewport.x, y: viewport.y, zoom: viewport.zoom } : null,
  };
}

/**
 * The draft after a save: the record as written, and the positions and bindings that were
 * sent, are its new base. An edit or a move made while the save was in flight keeps the
 * draft dirty, and an edit keeps its content in place of what was written. Bindings the
 * save didn't write (no `saved.bindingsHash` after sending some) keep it dirty, so the
 * next save writes them.
 */
export function markSaved(
  draft: Draft,
  saved: { content: JsonObject; contentHash: string; bindingsHash?: string },
  sent: { content: JsonObject; layout: LayoutInput | null; bindings?: Bindings | null }
): Draft {
  const sentPositions = new Map((sent.layout?.nodes ?? []).map(({ id, x, y }) => [id, { x, y }]));
  const content = draft.content === sent.content ? saved.content : draft.content;
  const sentBindings = sent.bindings ?? null;
  const bindingsWritten = sentBindings === null || saved.bindingsHash !== undefined;
  return {
    ...draft,
    content,
    baseHash: saved.contentHash,
    baseBindingsHash: saved.bindingsHash ?? draft.baseBindingsHash,
    baseFingerprint: bindingsWritten ? fingerprintOf(saved.content, sentPositions, sentBindings) : "",
    fingerprint: fingerprintOf(content, draft.positions, draft.bindings),
    deletedOnDisk: false,
  };
}

export function markDeletedOnDisk(draft: Draft): Draft {
  return draft.deletedOnDisk ? draft : { ...draft, deletedOnDisk: true };
}

/**
 * What to do with a draft when its file is read again (#221). A file with the hash the
 * draft loaded, and for a contract a bindings file with the hash it loaded, keeps it. A
 * changed file reloads a clean draft quietly, and keeps a dirty one, whose save then finds
 * the conflict. A deleted file marks the draft deleted on disk, unless the draft was never
 * saved, so has no file yet.
 */
export function reconcileWithDisk(
  draft: Draft,
  file: DefinitionFile
): { action: "keep"; draft: Draft } | { action: "reload" } {
  if (file.missing) return { action: "keep", draft: draft.baseHash === null ? draft : markDeletedOnDisk(draft) };
  const same =
    file.contentHash !== undefined &&
    file.contentHash === draft.baseHash &&
    (draft.bindings === null || (file.bindingsHash ?? null) === draft.baseBindingsHash);
  if (!same && !isDirty(draft)) return { action: "reload" };
  return { action: "keep", draft: draft.deletedOnDisk ? { ...draft, deletedOnDisk: false } : draft };
}

/** What one undo step restores: the record, a graph's node positions and a contract's bindings. */
export interface DraftSnapshot {
  content: JsonObject;
  positions: ReadonlyMap<string, XYPosition>;
  bindings: Bindings | null;
}

export const snapshotOf = (draft: Draft): DraftSnapshot => ({
  content: draft.content,
  positions: draft.positions,
  bindings: draft.bindings,
});

/** The draft with a snapshot's record, positions and bindings, dirty or clean by fingerprint. */
export const restoreSnapshot = (draft: Draft, snapshot: DraftSnapshot): Draft =>
  withChanges(draft, snapshot.content, snapshot.positions, snapshot.bindings);


const nodeList = (content: JsonObject): { id?: unknown }[] =>
  Array.isArray(content.nodes) ? (content.nodes as { id?: unknown }[]) : [];

/**
 * The ids of the nodes in `after` that `before` lacks, or that differ from it in content or
 * position, in `after`'s node order. Undo and redo select these.
 */
export function changedNodeIds(before: DraftSnapshot, after: DraftSnapshot): string[] {
  const old = new Map(nodeList(before.content).map((n) => [n.id, n]));
  const changed: string[] = [];
  for (const n of nodeList(after.content)) {
    if (typeof n.id !== "string") continue;
    const was = old.get(n.id);
    const p = after.positions.get(n.id);
    const q = before.positions.get(n.id);
    const moved = p?.x !== q?.x || p?.y !== q?.y;
    if (!was || moved || (was !== n && JSON.stringify(was) !== JSON.stringify(n))) changed.push(n.id);
  }
  return changed;
}
