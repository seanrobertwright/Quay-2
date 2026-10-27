// Edits to a graph draft (#259). Each edit is one step from one draft to the next, and it
// changes the record and the node positions together. Node ids also sit in a DECISION's
// `then` and `else` and in the layout, so rename and delete rewrite those as well as every
// `dependsOn`. An edit works on the record's JSON as it is, so a node it doesn't touch
// keeps whatever it holds, even when that is something the SDK refuses.
import { withChanges, type GraphDraft } from "./drafts.ts";
import { NODE_KINDS_REGISTRY } from "./kinds.ts";
import { hasOwn, isObject, MAX_NODES, type Json, type JsonObject, type NodeKind, type XYPosition } from "./model.ts";

export type Branch = "then" | "else";

export type GraphEdit =
  /** Adds a node of `kind` with its default config. `id` must be free; `nextNodeId` gives one. */
  | { type: "add-node"; id: string; kind: NodeKind; position: XYPosition }
  /** Adds `source` to `target`'s `dependsOn`. */
  | { type: "connect"; source: string; target: string }
  /** Removes `source` from `target`'s `dependsOn`, and clears a branch of `source` that names `target`. */
  | { type: "disconnect"; source: string; target: string }
  /**
   * Points a DECISION's branch at `target`, or clears it when `target` is "". The target
   * gains the decision in `dependsOn`, and the old target loses it unless the other branch
   * still names it.
   */
  | { type: "set-branch"; decision: string; branch: Branch; target: string }
  /** Renames a node, when `renameProblem` finds nothing wrong with the new id. */
  | { type: "rename-node"; from: string; to: string }
  /** Removes a node, its position, and every `dependsOn` entry and branch that names it. */
  | { type: "delete-node"; id: string }
  /** Sets one entry of a node's config. */
  | { type: "set-config"; id: string; key: string; value: Json }
  /** Sets a node's `inputSchema` or `outputSchema`, or removes it when `schema` is null. */
  | { type: "set-schema"; id: string; which: SchemaSlot; schema: JsonObject | null };

export type SchemaSlot = "inputSchema" | "outputSchema";

/** The SDK's longest node id, in characters (code points, as JSON Schema counts them). */
const MAX_ID_LENGTH = 256;

// A draft's record always has a `nodes` list of objects with unique string ids: parseGraph
// refuses anything else, and no edit makes one.
const nodesOf = (content: JsonObject): JsonObject[] =>
  Array.isArray(content.nodes) ? content.nodes.filter(isObject) : [];
const depsOf = (node: JsonObject): Json[] => (Array.isArray(node.dependsOn) ? node.dependsOn : []);
const configOf = (node: JsonObject): JsonObject => (isObject(node.config) ? node.config : {});
const isDecision = (node: JsonObject) => node.kind === "DECISION";

const rounded = (p: XYPosition): XYPosition => ({ x: Math.round(p.x), y: Math.round(p.y) });

/** A new node's id: the kind in lower case and the smallest number no node has, `task-1`. */
export function nextNodeId(nodeIds: Iterable<string>, kind: NodeKind): string {
  const taken = new Set(nodeIds);
  const base = kind.toLowerCase();
  for (let n = 1; ; n++) {
    const id = `${base}-${n}`;
    if (!taken.has(id)) return id;
  }
}

/**
 * Why `from` can't be renamed to `to`, or null when it can. The SDK takes any string of 1
 * to 256 characters as an id, and ids must differ exactly (case counts).
 */
export function renameProblem(nodeIds: readonly string[], from: string, to: string): string | null {
  if (to === "") return "An id can't be empty.";
  if ([...to].length > MAX_ID_LENGTH) return `An id can be at most ${MAX_ID_LENGTH} characters long.`;
  if (to !== from && nodeIds.includes(to)) return `Another node already has the id "${to}".`;
  return null;
}

/** The draft after `edit`, or the same draft when the edit changes nothing or doesn't apply. */
export function editDraft(draft: GraphDraft, edit: GraphEdit): GraphDraft {
  const nodes = nodesOf(draft.content);
  const result = apply(nodes, draft.positions, edit);
  if (!result) return draft;
  const changed =
    result.positions !== draft.positions ||
    result.nodes.length !== nodes.length ||
    result.nodes.some((n, i) => n !== nodes[i]);
  return changed ? withChanges(draft, { ...draft.content, nodes: result.nodes }, result.positions) : draft;
}

type Result = { nodes: JsonObject[]; positions: ReadonlyMap<string, XYPosition> } | null;

function apply(nodes: JsonObject[], positions: ReadonlyMap<string, XYPosition>, edit: GraphEdit): Result {
  const has = (id: string) => nodes.some((n) => n.id === id);
  // Nodes `f` returns unchanged stay the same objects, which is how `editDraft` sees no change.
  const mapped = (f: (n: JsonObject) => JsonObject): Result => ({ nodes: nodes.map(f), positions });

  switch (edit.type) {
    case "add-node": {
      if (nodes.length >= MAX_NODES || has(edit.id)) return null;
      const node = { id: edit.id, kind: edit.kind, dependsOn: [], config: NODE_KINDS_REGISTRY[edit.kind].defaultConfig() };
      return { nodes: [...nodes, node], positions: new Map(positions).set(edit.id, rounded(edit.position)) };
    }

    case "connect": {
      const { source, target } = edit;
      if (source === target || !has(source) || !has(target)) return null;
      return mapped((n) => (n.id === target ? withDependency(n, source) : n));
    }

    case "disconnect": {
      const { source, target } = edit;
      return mapped((n) => {
        if (n.id === target) return withoutDependency(n, source);
        if (n.id === source && isDecision(n)) return withBranchesCleared(n, target);
        return n;
      });
    }

    case "set-branch": {
      const { decision: decisionId, branch, target } = edit;
      const decision = nodes.find((n) => n.id === decisionId);
      if (!decision || !isDecision(decision) || target === decisionId || (target !== "" && !has(target))) return null;
      const config = configOf(decision);
      const old = typeof config[branch] === "string" ? config[branch] : "";
      const other = config[branch === "then" ? "else" : "then"];
      const dropFromOld = old !== "" && old !== target && old !== other;
      return mapped((n) => {
        if (n.id === decisionId) {
          return config[branch] === target ? n : { ...n, config: { ...config, [branch]: target } };
        }
        if (n.id === target) return withDependency(n, decisionId);
        if (dropFromOld && n.id === old) return withoutDependency(n, decisionId);
        return n;
      });
    }

    case "rename-node": {
      const { from, to } = edit;
      if (from === to || !has(from) || renameProblem(nodes.map((n) => n.id as string), from, to) !== null) return null;
      const renamed = nodes.map((n) => {
        let next = n.id === from ? { ...n, id: to } : n;
        const deps = depsOf(n);
        if (deps.includes(from)) next = { ...next, dependsOn: deps.map((d) => (d === from ? to : d)) };
        if (isDecision(n)) {
          const config = configOf(n);
          if (config.then === from || config.else === from) {
            next = {
              ...next,
              config: { ...config, ...(config.then === from && { then: to }), ...(config.else === from && { else: to }) },
            };
          }
        }
        return next;
      });
      const moved = new Map([...positions].map(([id, p]) => [id === from ? to : id, p]));
      return { nodes: renamed, positions: moved };
    }

    case "delete-node": {
      const { id } = edit;
      if (!has(id)) return null;
      const kept = nodes
        .filter((n) => n.id !== id)
        .map((n) => {
          const next = withoutDependency(n, id);
          return isDecision(next) ? withBranchesCleared(next, id) : next;
        });
      const left = new Map(positions);
      left.delete(id);
      return { nodes: kept, positions: left };
    }

    case "set-config": {
      const { id, key, value } = edit;
      return mapped((n) => {
        if (n.id !== id) return n;
        const config = configOf(n);
        const same = hasOwn(config, key) && JSON.stringify(config[key]) === JSON.stringify(value);
        return same ? n : { ...n, config: { ...config, [key]: value } };
      });
    }

    case "set-schema": {
      const { id, which, schema } = edit;
      return mapped((n) => {
        if (n.id !== id) return n;
        const had = hasOwn(n, which);
        if (schema === null) {
          if (!had) return n;
          const next = { ...n };
          delete next[which];
          return next;
        }
        return had && JSON.stringify(n[which]) === JSON.stringify(schema) ? n : { ...n, [which]: schema };
      });
    }
  }
}

function withDependency(node: JsonObject, id: string): JsonObject {
  const deps = depsOf(node);
  return deps.includes(id) ? node : { ...node, dependsOn: [...deps, id] };
}

function withoutDependency(node: JsonObject, id: string): JsonObject {
  const deps = depsOf(node);
  return deps.includes(id) ? { ...node, dependsOn: deps.filter((d) => d !== id) } : node;
}

/** The decision with any branch that names `id` set to "", the way a new decision has it. */
function withBranchesCleared(node: JsonObject, id: string): JsonObject {
  const config = configOf(node);
  if (config.then !== id && config.else !== id) return node;
  return { ...node, config: { ...config, ...(config.then === id && { then: "" }), ...(config.else === id && { else: "" }) } };
}
