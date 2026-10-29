// Graph bindings (#247, #273): `aiws-graph-binding/1` documents in
// `.praxis/graph-bindings/<id>.json`, one per binding, each saying what every TASK, LOOP and
// COMPENSATION node of one graph runs. These are the rules the builder applies to a binding's
// JSON: a new one's entries, the pins that tell it is Stale, what Retarget to current graph
// drops, and the edits the Runs as and Binding sections make. The backend shape-checks the
// document against the vendored PROVISIONAL schema; nothing here validates it.
import type { Step } from "./history.ts";
import { nextDefinitionId } from "./lifecycle.ts";
import { hasOwn, isObject, type Json, type JsonObject } from "./model.ts";
import type { GraphPin } from "./types.ts";

export const BINDING_FORMAT = "aiws-graph-binding/1";

/** The node kinds Praxis dispatches, which are the kinds a binding has an entry for. */
export const DISPATCHABLE_KINDS = ["TASK", "LOOP", "COMPENSATION"] as const;

export const isDispatchable = (kind: unknown): boolean =>
  typeof kind === "string" && (DISPATCHABLE_KINDS as readonly string[]).includes(kind);

/** A graph's nodes that are objects, in node order; none when it has no `nodes` array. */
const graphNodes = (graph: JsonObject): JsonObject[] => (Array.isArray(graph.nodes) ? graph.nodes.filter(isObject) : []);

/** A graph's dispatchable nodes, in node order: their id, kind and a TASK's `executionKind`. */
export function dispatchableNodes(graph: JsonObject): { id: string; kind: string; executionKind?: string }[] {
  return graphNodes(graph).flatMap((n) => {
    if (typeof n.id !== "string" || !isDispatchable(n.kind)) return [];
    const config = isObject(n.config) ? n.config : {};
    const executionKind = n.kind === "TASK" && typeof config.executionKind === "string" ? config.executionKind : undefined;
    return [{ id: n.id, kind: n.kind as string, ...(executionKind !== undefined && { executionKind }) }];
  });
}

/** A new binding's id (#247): the graph's id and the smallest free `n`, ignoring case. */
export const nextBindingId = (graphId: string, taken: Iterable<string>) => nextDefinitionId(graphId, taken);

const blankExposure = (): JsonObject => ({ kind: "BOUNDED", allowance: "", stopThreshold: "" });

/** A blank entry of `executionKind` with role Work: the fields the schema requires, empty. */
export function blankEntry(executionKind: string): JsonObject {
  switch (executionKind) {
    case "AGENT":
      return {
        executionKind,
        role: "WORK",
        agentId: "",
        commands: [],
        outputPaths: [],
        exposure: blankExposure(),
        requirements: [],
      };
    case "TOOL":
      return {
        executionKind,
        role: "WORK",
        protocolBindingId: "",
        action: "",
        resource: "",
        payload: {},
        exposure: blankExposure(),
      };
    default:
      // FUNCTION and HUMAN entries carry only their kind until Praxis decides how it runs them.
      return { executionKind };
  }
}

/** A node's entry in a new binding: a TASK's own `executionKind`, AGENT for a LOOP or COMPENSATION. */
const entryFor = (node: { kind: string; executionKind?: string }): JsonObject =>
  blankEntry(node.kind === "TASK" ? (node.executionKind ?? "AGENT") : "AGENT");

/**
 * A new binding of `graph` (#247): one blank entry per dispatchable node, with empty pins.
 * Saving the binding fills them from the graph as saved on disk.
 */
export function newBindingContent(id: string, graph: JsonObject): JsonObject {
  const nodes: JsonObject = {};
  for (const node of dispatchableNodes(graph)) nodes[node.id] = entryFor(node);
  return {
    format: BINDING_FORMAT,
    graphBindingId: id,
    graphBindingRevision: 1,
    graphId: typeof graph.id === "string" ? graph.id : "",
    graphRevision: "",
    graphDigest: "",
    costUnit: "",
    nodes,
  };
}

/**
 * How a binding stands against its graph as saved on disk (#247): `current` when its pins
 * match `pin`, `stale` when the graph has changed since, `unpinned` when it has no pins yet
 * (it was never saved), and `graph-unsaved` when there is no graph on disk.
 */
export type BindingStatus = "current" | "stale" | "unpinned" | "graph-unsaved";

export function bindingStatus(binding: JsonObject, pin: GraphPin | null): BindingStatus {
  if (pin === null) return "graph-unsaved";
  const revision = typeof binding.graphRevision === "string" ? binding.graphRevision : "";
  const digest = typeof binding.graphDigest === "string" ? binding.graphDigest : "";
  if (revision === "" && digest === "") return "unpinned";
  return revision === pin.revision && digest === pin.digest ? "current" : "stale";
}

/** What Retarget to current graph does (#247): the entries it drops, and why, and the dispatchable nodes left unbound. */
export interface RetargetPlan {
  drop: { id: string; reason: string }[];
  unbound: string[];
}

/** The entries a retarget onto `graph` drops (nodes gone, or no longer dispatchable) and the new nodes it leaves unbound. */
export function retargetPlan(binding: JsonObject, graph: JsonObject): RetargetPlan {
  const kinds = new Map<string, unknown>();
  for (const n of graphNodes(graph)) {
    if (typeof n.id === "string") kinds.set(n.id, n.kind);
  }
  const entries = entriesOf(binding);
  const drop = Object.keys(entries).flatMap((id) => {
    if (!kinds.has(id)) return [{ id, reason: `The graph has no node ${id}.` }];
    const kind = kinds.get(id);
    return isDispatchable(kind) ? [] : [{ id, reason: `${id} is a ${String(kind)} node, which a binding doesn't run.` }];
  });
  const unbound = dispatchableNodes(graph)
    .map((n) => n.id)
    .filter((id) => !hasOwn(entries, id));
  return { drop, unbound };
}

/** The binding re-pinned to `pin`, its graph as saved on disk, without the entries `retargetPlan` drops. */
export function retargetBinding(binding: JsonObject, graph: JsonObject, pin: GraphPin): JsonObject {
  const dropped = new Set(retargetPlan(binding, graph).drop.map((d) => d.id));
  const nodes: JsonObject = {};
  for (const [id, entry] of Object.entries(isObject(binding.nodes) ? binding.nodes : {})) {
    if (!dropped.has(id)) nodes[id] = entry;
  }
  return { ...binding, graphRevision: pin.revision ?? "", graphDigest: pin.digest, nodes };
}

/** A binding's entries, keyed by node id; an entry that isn't an object is left out. */
export function entriesOf(binding: JsonObject): Record<string, JsonObject> {
  const nodes = isObject(binding.nodes) ? binding.nodes : {};
  const out: Record<string, JsonObject> = {};
  for (const [id, entry] of Object.entries(nodes)) if (isObject(entry)) out[id] = entry;
  return out;
}

/** A copy of the binding with `nodes` as its entries. */
const withNodes = (binding: JsonObject, nodes: JsonObject): JsonObject => ({ ...binding, nodes });
/** The binding's `nodes` object, or an empty one when it has none. */
const nodesOfBinding = (binding: JsonObject): JsonObject => (isObject(binding.nodes) ? binding.nodes : {});

/**
 * The binding after node `from` was renamed to `to` (#247): the entry moves to the new key, in
 * the same place. A binding without an entry for `from` is returned as it is.
 */
export function renameNodeInBinding(binding: JsonObject, from: string, to: string): JsonObject {
  const nodes = nodesOfBinding(binding);
  if (from === to || !hasOwn(nodes, from)) return binding;
  const renamed: JsonObject = {};
  for (const [id, entry] of Object.entries(nodes)) {
    if (id === to) continue;
    renamed[id === from ? to : id] = entry;
  }
  return withNodes(binding, renamed);
}

export type BindingRole = "WORK" | "VALIDATION";

export type BindingEdit =
  /** Sets one field of a node's entry, or removes it when `value` is undefined. `live` marks a keystroke. */
  | { type: "set-entry-field"; node: string; key: string; value: Json | undefined; live?: boolean }
  /** Work or Validation (#247): Validation carries criteria, Work none. */
  | { type: "set-role"; node: string; role: BindingRole }
  /** A LOOP's or COMPENSATION's executionKind: a blank entry of that kind, keeping the role and criteria. */
  | { type: "set-execution-kind"; node: string; executionKind: string }
  /** Sets a graph-level field of the binding, or removes it when `value` is undefined. */
  | { type: "set-field"; key: string; value: Json | undefined; live?: boolean }
  /** A blank entry of `executionKind` for a node that has none. */
  | { type: "add-entry"; node: string; executionKind: string }
  /** Retarget to current graph: the whole binding as `retargetBinding` makes it. */
  | { type: "replace"; content: JsonObject; label: string };

const same = (a: Json | undefined, b: Json | undefined) => JSON.stringify(a) === JSON.stringify(b);

/** `object` with `key` set to `value`, or without it when `value` is undefined; the same object when nothing changes. */
function withKey(object: JsonObject, key: string, value: Json | undefined): JsonObject {
  if (value === undefined) {
    if (!hasOwn(object, key)) return object;
    const next = { ...object };
    delete next[key];
    return next;
  }
  return hasOwn(object, key) && same(object[key], value) ? object : { ...object, [key]: value };
}

/** The binding with node `id`'s entry replaced by `change` of it; the same binding when nothing changes. */
function changeEntry(binding: JsonObject, id: string, change: (entry: JsonObject) => JsonObject): JsonObject {
  const nodes = nodesOfBinding(binding);
  const entry = nodes[id];
  if (!isObject(entry)) return binding;
  const next = change(entry);
  return next === entry ? binding : withNodes(binding, { ...nodes, [id]: next });
}

/** The binding after `edit`, or the same binding when the edit changes nothing. */
export function applyBindingEdit(binding: JsonObject, edit: BindingEdit): JsonObject {
  switch (edit.type) {
    case "set-entry-field":
      return changeEntry(binding, edit.node, (e) => withKey(e, edit.key, edit.value));
    case "set-role":
      return changeEntry(binding, edit.node, (e) => {
        if (e.role === edit.role) return e;
        const next: JsonObject = { ...e, role: edit.role };
        if (edit.role === "VALIDATION") return Array.isArray(e.criteria) ? next : { ...next, criteria: [] };
        delete next.criteria;
        return next;
      });
    case "set-execution-kind":
      return changeEntry(binding, edit.node, (e) => {
        if (e.executionKind === edit.executionKind) return e;
        const blank = blankEntry(edit.executionKind);
        if (!hasOwn(blank, "role")) return blank;
        const role = e.role === "VALIDATION" ? "VALIDATION" : "WORK";
        return { ...blank, role, ...(role === "VALIDATION" && { criteria: Array.isArray(e.criteria) ? e.criteria : [] }) };
      });
    case "set-field":
      return withKey(binding, edit.key, edit.value);
    case "add-entry": {
      const nodes = nodesOfBinding(binding);
      return hasOwn(nodes, edit.node) ? binding : withNodes(binding, { ...nodes, [edit.node]: blankEntry(edit.executionKind) });
    }
    case "replace":
      return same(binding, edit.content) ? binding : edit.content;
  }
}

/**
 * The undo step a binding edit makes, labelled with the binding's id: one step each, except
 * that live keystrokes in one field merge until the field's blur, Enter or another edit (#248).
 */
export function bindingStepFor(bindingId: string, edit: BindingEdit): Step {
  const merge = (node: string, key: string) => ({ key: `graph-bindings/${bindingId}|${node}|${key}` });
  switch (edit.type) {
    case "set-entry-field": {
      const label = `Set ${edit.key} of ${edit.node} in ${bindingId}`;
      return edit.live ? { label, merge: merge(edit.node, edit.key) } : { label };
    }
    case "set-role":
      return { label: `Set role of ${edit.node} in ${bindingId}` };
    case "set-execution-kind":
      return { label: `Set executionKind of ${edit.node} in ${bindingId}` };
    case "set-field": {
      const label = `Set ${edit.key} of ${bindingId}`;
      return edit.live ? { label, merge: merge("", edit.key) } : { label };
    }
    case "add-entry":
      return { label: `Add an entry for ${edit.node} to ${bindingId}` };
    case "replace":
      return { label: edit.label };
  }
}

/** The entries of `ids` that the binding has, keyed by node id, for the clipboard (#248). */
export function entriesForNodes(binding: JsonObject, ids: Iterable<string>): Record<string, JsonObject> {
  const entries = entriesOf(binding);
  const out: Record<string, JsonObject> = {};
  for (const id of ids) if (hasOwn(entries, id)) out[id] = JSON.parse(JSON.stringify(entries[id])) as JsonObject;
  return out;
}

/**
 * The binding with pasted entries written under the pasted nodes' ids (#248): `remap` takes a
 * copied node's id to the id it was pasted as. Entries of copied nodes not in `remap` are left out.
 */
export function withPastedEntries(
  binding: JsonObject,
  entries: Readonly<Record<string, JsonObject>>,
  remap: ReadonlyMap<string, string>
): JsonObject {
  const pasted = Object.entries(entries).flatMap(([id, entry]) => {
    const to = remap.get(id);
    return to === undefined ? [] : [[to, JSON.parse(JSON.stringify(entry)) as JsonObject] as const];
  });
  if (pasted.length === 0) return binding;
  return withNodes(binding, { ...nodesOfBinding(binding), ...Object.fromEntries(pasted) });
}

/** An entry field whose ids are suggested from the ones already used in the project (#247). */
export type SuggestedField = "agentId" | "protocolBindingId" | "action" | "resource";

/**
 * The distinct non-empty values of `field` across these bindings' entries and `saved`, the
 * values `praxis_binding_suggestions` read from the project's saved bindings and workflow
 * templates, sorted.
 */
export function idSuggestions(bindings: Iterable<JsonObject>, field: SuggestedField, saved: Iterable<string> = []): string[] {
  const found = new Set<string>(saved);
  for (const binding of bindings) {
    for (const entry of Object.values(entriesOf(binding))) {
      const value = entry[field];
      if (typeof value === "string" && value.trim() !== "") found.add(value);
    }
  }
  return [...found].sort();
}

/** How a dispatchable node's card shows the binding chosen (#247). */
export interface BindingMark {
  bound: boolean;
  /** The entry's role is Validation. */
  validation: boolean;
}

/** A mark for each of the graph's dispatchable nodes: bound when the binding has its entry. */
export function bindingMarks(binding: JsonObject, graph: JsonObject): Map<string, BindingMark> {
  const entries = entriesOf(binding);
  return new Map(
    dispatchableNodes(graph).map((n) => {
      const entry = hasOwn(entries, n.id) ? entries[n.id] : undefined;
      return [n.id, { bound: entry !== undefined, validation: entry?.role === "VALIDATION" }];
    })
  );
}
