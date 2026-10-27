// The Praxis finite-v1 graph as the builder reads it from `.praxis/graphs/<id>.json`, and
// the layout sidecar in `.praxis/layout/<id>.json`. Both arrive as untrusted JSON, so each
// goes through a parser here before the canvas sees it.

export const NODE_KINDS = [
  "TASK",
  "DECISION",
  "FORK",
  "JOIN",
  "LOOP",
  "WAIT",
  "APPROVAL",
  "SUBWORKFLOW",
  "VERIFICATION",
  "ACCEPTANCE",
  "RECONCILIATION",
  "COMPENSATION",
  "END",
] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export function isNodeKind(kind: string): kind is NodeKind {
  return (NODE_KINDS as readonly string[]).includes(kind);
}

/** The SDK caps a graph at this many nodes. */
export const MAX_NODES = 1000;

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type JsonObject = { [k: string]: Json };

export interface PraxisNode {
  id: string;
  /** One of `NODE_KINDS` in a valid graph; a hand-edited file may hold anything. */
  kind: string;
  dependsOn: string[];
  config: JsonObject;
  inputSchema?: JsonObject;
  outputSchema?: JsonObject;
}

export interface PraxisGraph {
  id: string;
  revision: string;
  nodes: PraxisNode[];
}

export interface XYPosition {
  x: number;
  y: number;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

/** Whether `o` has `k` as its own property, not one inherited from its prototype. */
export const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** Whether `v` is a JSON object: not null and not an array. */
export const isObject = (v: unknown): v is JsonObject =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Reads a graph file's JSON for display. It is lenient where the canvas can still draw
 * something (a missing `dependsOn` or `config` reads as empty), and refuses only what it
 * can't draw: no `nodes` list, a node without a string id, a repeated id, or more nodes
 * than the SDK allows.
 */
export function parseGraph(content: unknown): ParseResult<PraxisGraph> {
  if (!isObject(content)) return { ok: false, message: "The file isn't a JSON object." };
  if (!Array.isArray(content.nodes)) {
    return { ok: false, message: 'The graph has no "nodes" list.' };
  }
  if (content.nodes.length > MAX_NODES) {
    return {
      ok: false,
      message: `The graph has ${content.nodes.length} nodes, more than the ${MAX_NODES} a graph may hold.`,
    };
  }
  const seen = new Set<string>();
  const nodes: PraxisNode[] = [];
  for (const [index, raw] of content.nodes.entries()) {
    if (!isObject(raw) || typeof raw.id !== "string" || raw.id === "") {
      return { ok: false, message: `Node ${index + 1} has no id.` };
    }
    if (seen.has(raw.id)) {
      return { ok: false, message: `More than one node has the id "${raw.id}".` };
    }
    seen.add(raw.id);
    const node: PraxisNode = {
      id: raw.id,
      kind: typeof raw.kind === "string" ? raw.kind : "",
      dependsOn: Array.isArray(raw.dependsOn)
        ? raw.dependsOn.filter((d): d is string => typeof d === "string")
        : [],
      config: isObject(raw.config) ? raw.config : {},
    };
    if (isObject(raw.inputSchema)) node.inputSchema = raw.inputSchema;
    if (isObject(raw.outputSchema)) node.outputSchema = raw.outputSchema;
    nodes.push(node);
  }
  return {
    ok: true,
    value: {
      id: typeof content.id === "string" ? content.id : "",
      revision: typeof content.revision === "string" ? content.revision : "",
      nodes,
    },
  };
}

/**
 * Reads the saved node positions from a layout file's JSON (`{version, nodes: {<id>:
 * {x, y}}, viewport}`). Entries whose `x` or `y` isn't a finite number are skipped, so
 * those nodes get a computed position instead.
 */
export function parseLayoutPositions(layout: unknown): Map<string, XYPosition> {
  const positions = new Map<string, XYPosition>();
  if (!isObject(layout) || !isObject(layout.nodes)) return positions;
  for (const id of Object.keys(layout.nodes)) {
    if (!hasOwn(layout.nodes, id)) continue;
    const p = layout.nodes[id];
    if (!isObject(p)) continue;
    const { x, y } = p;
    if (typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y)) {
      positions.set(id, { x, y });
    }
  }
  return positions;
}

/**
 * Reads the viewport a layout file saved, or `undefined` when it has none or it isn't
 * finite numbers with a positive zoom.
 */
export function parseLayoutViewport(layout: unknown): { x: number; y: number; zoom: number } | undefined {
  if (!isObject(layout) || !isObject(layout.viewport)) return undefined;
  const { x, y, zoom } = layout.viewport;
  const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  return finite(x) && finite(y) && finite(zoom) && zoom > 0 ? { x, y, zoom } : undefined;
}

/** The DECISION branch, if any, that `target` is for `source`. */
export function branchOf(source: PraxisNode, target: string): "then" | "else" | null {
  if (source.kind !== "DECISION") return null;
  if (source.config.then === target) return "then";
  if (source.config.else === target) return "else";
  return null;
}
