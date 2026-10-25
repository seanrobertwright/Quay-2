// PROTOTYPE (#226) — throwaway. The graph model, edits and issue checks shared by the
// three canvas variants. Mirrors the SDK finite-v1 Graph and validateGraph rules, but
// returns every issue with a node and field path instead of throwing the first.

export const KINDS = [
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
export type Kind = (typeof KINDS)[number];

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type JsonObject = { [k: string]: Json };

export interface PNode {
  id: string;
  kind: Kind;
  dependsOn: string[];
  config: JsonObject;
  inputSchema?: JsonObject;
  outputSchema?: JsonObject;
}

export interface PGraph {
  id: string;
  revision: string;
  nodes: PNode[];
}

export type Branch = "then" | "else";

export const EXECUTION_KINDS = ["AGENT", "FUNCTION", "TOOL", "HUMAN"] as const;
export const JOIN_MODES = ["ALL", "ANY"] as const;

export const CONFIG_KEYS: Record<Kind, string[]> = {
  TASK: ["executionKind"],
  DECISION: ["field", "equals", "then", "else"],
  FORK: [],
  JOIN: ["mode"],
  LOOP: ["maxIterations"],
  WAIT: [],
  APPROVAL: [],
  SUBWORKFLOW: [],
  VERIFICATION: [],
  ACCEPTANCE: [],
  RECONCILIATION: [],
  COMPENSATION: [],
  END: [],
};

export function defaultConfig(kind: Kind): JsonObject {
  switch (kind) {
    case "TASK":
      return { executionKind: "AGENT" };
    case "DECISION":
      return { field: "", equals: true, then: "", else: "" };
    case "JOIN":
      return { mode: "ALL" };
    case "LOOP":
      return { maxIterations: "3" };
    default:
      return {};
  }
}

// --- sample ---------------------------------------------------------------

const n = (id: string, kind: Kind, dependsOn: string[], extra: Partial<PNode> = {}): PNode => ({
  id,
  kind,
  dependsOn,
  config: extra.config ?? defaultConfig(kind),
  ...(extra.inputSchema ? { inputSchema: extra.inputSchema } : {}),
  ...(extra.outputSchema ? { outputSchema: extra.outputSchema } : {}),
});

const passedSchema: JsonObject = {
  type: "object",
  properties: { passed: { type: "boolean" }, failures: { type: "integer", minimum: 0 } },
  required: ["passed"],
};

// Uses all 13 kinds, and carries two deliberate problems on `notify` (empty executionKind,
// no path to END) so the issue displays have something to show on first load.
export function sampleGraph(): PGraph {
  return {
    id: "ship-feature",
    revision: "sha256:4f1c…",
    nodes: [
      n("plan", "TASK", [], {
        inputSchema: {
          type: "object",
          properties: { issue: { type: "integer" }, repo: { type: "string" } },
          required: ["issue", "repo"],
        },
      }),
      n("approve-plan", "APPROVAL", ["plan"]),
      n("split-work", "FORK", ["approve-plan"]),
      n("write-code", "TASK", ["split-work"]),
      n("write-tests", "TASK", ["split-work"]),
      n("both-done", "JOIN", ["write-code", "write-tests"]),
      n("fix-until-green", "LOOP", ["both-done"], { config: { maxIterations: "5" } }),
      n("verify", "VERIFICATION", ["fix-until-green"], { outputSchema: passedSchema }),
      n("tests-passed", "DECISION", ["verify"], {
        config: { field: "passed", equals: true, then: "accept", else: "roll-back" },
        outputSchema: passedSchema,
      }),
      n("accept", "ACCEPTANCE", ["tests-passed"]),
      n("roll-back", "COMPENSATION", ["tests-passed"]),
      n("wait-for-ci", "WAIT", ["accept"]),
      n("deploy", "SUBWORKFLOW", ["wait-for-ci"]),
      n("either-path", "JOIN", ["deploy", "roll-back"], { config: { mode: "ANY" } }),
      n("reconcile", "RECONCILIATION", ["either-path"]),
      n("end", "END", ["reconcile"]),
      n("notify", "TASK", ["accept"], { config: { executionKind: "" } }),
    ],
  };
}

// --- edits ----------------------------------------------------------------
// Every edit returns a new graph. Node ids also live in DECISION.then/else, so delete,
// rename and disconnect rewrite config as well as dependsOn.

const mapNodes = (g: PGraph, f: (x: PNode) => PNode): PGraph => ({ ...g, nodes: g.nodes.map(f) });

export function uniqueId(g: PGraph, base: string): string {
  const taken = new Set(g.nodes.map((x) => x.id.toLowerCase()));
  for (let i = 1; ; i++) {
    const id = `${base}-${i}`;
    if (!taken.has(id)) return id;
  }
}

export function addNode(g: PGraph, kind: Kind): { graph: PGraph; id: string } {
  const id = uniqueId(g, kind.toLowerCase());
  return { graph: { ...g, nodes: [...g.nodes, n(id, kind, [])] }, id };
}

export function deleteNode(g: PGraph, id: string): PGraph {
  return {
    ...g,
    nodes: g.nodes
      .filter((x) => x.id !== id)
      .map((x) => {
        const dependsOn = x.dependsOn.filter((d) => d !== id);
        if (x.kind !== "DECISION") return { ...x, dependsOn };
        const config = { ...x.config };
        if (config.then === id) config.then = "";
        if (config.else === id) config.else = "";
        return { ...x, dependsOn, config };
      }),
  };
}

export function renameNode(g: PGraph, from: string, to: string): PGraph {
  if (!to || from === to) return g;
  return mapNodes(g, (x) => {
    const out = { ...x, id: x.id === from ? to : x.id, dependsOn: x.dependsOn.map((d) => (d === from ? to : d)) };
    if (x.kind === "DECISION") {
      out.config = { ...x.config };
      if (out.config.then === from) out.config.then = to;
      if (out.config.else === from) out.config.else = to;
    }
    return out;
  });
}

export function connect(g: PGraph, source: string, target: string): PGraph {
  if (source === target) return g;
  return mapNodes(g, (x) =>
    x.id === target && !x.dependsOn.includes(source) ? { ...x, dependsOn: [...x.dependsOn, source] } : x,
  );
}

export function disconnect(g: PGraph, source: string, target: string): PGraph {
  return mapNodes(g, (x) => {
    if (x.id === target) return { ...x, dependsOn: x.dependsOn.filter((d) => d !== source) };
    if (x.id === source && x.kind === "DECISION") {
      const config = { ...x.config };
      if (config.then === target) config.then = "";
      if (config.else === target) config.else = "";
      return { ...x, config };
    }
    return x;
  });
}

// Points a DECISION branch at `target` (or clears it with ""), keeping dependsOn in step:
// the new target gains the decision, and the old target loses it unless it is still the
// other branch.
export function setBranch(g: PGraph, decision: string, branch: Branch, target: string): PGraph {
  const d = g.nodes.find((x) => x.id === decision);
  if (!d) return g;
  const old = typeof d.config[branch] === "string" ? (d.config[branch] as string) : "";
  const other = branch === "then" ? d.config.else : d.config.then;
  let next = mapNodes(g, (x) => (x.id === decision ? { ...x, config: { ...x.config, [branch]: target } } : x));
  if (old && old !== target && old !== other) {
    next = mapNodes(next, (x) => (x.id === old ? { ...x, dependsOn: x.dependsOn.filter((y) => y !== decision) } : x));
  }
  if (target) next = connect(next, decision, target);
  return next;
}

export function branchOf(g: PGraph, source: string, target: string): Branch | null {
  const d = g.nodes.find((x) => x.id === source);
  if (!d || d.kind !== "DECISION") return null;
  if (d.config.then === target) return "then";
  if (d.config.else === target) return "else";
  return null;
}

export function setConfig(g: PGraph, id: string, key: string, value: Json): PGraph {
  return mapNodes(g, (x) => (x.id === id ? { ...x, config: { ...x.config, [key]: value } } : x));
}

export function setSchema(g: PGraph, id: string, which: "inputSchema" | "outputSchema", value: JsonObject | undefined): PGraph {
  return mapNodes(g, (x) => {
    if (x.id !== id) return x;
    const out = { ...x };
    if (value) out[which] = value;
    else delete out[which];
    return out;
  });
}

export function setDependsOn(g: PGraph, id: string, dependsOn: string[]): PGraph {
  return mapNodes(g, (x) => (x.id === id ? { ...x, dependsOn } : x));
}

// The repo targets ES2020, which has no Object.hasOwn.
const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

// --- issues ---------------------------------------------------------------

export interface Issue {
  key: string;
  severity: "error" | "warning";
  code: string;
  nodeId?: string;
  field?: string; // "config.then", "dependsOn", "outputSchema", "id"
  message: string;
}

// The SDK stores maxIterations as a decimal string (it compares with BigInt).
const isPositiveIntString = (v: Json | undefined) => typeof v === "string" && /^[1-9][0-9]*$/.test(v);

export function validate(g: PGraph): Issue[] {
  const out: Issue[] = [];
  const push = (i: Omit<Issue, "key">) => out.push({ ...i, key: `${out.length}:${i.code}:${i.nodeId ?? ""}:${i.field ?? ""}` });
  const ids = new Set(g.nodes.map((x) => x.id));
  const byId = new Map(g.nodes.map((x) => [x.id, x]));

  const seen = new Map<string, string>();
  for (const x of g.nodes) {
    if (!x.id) push({ severity: "error", code: "NODE_ID", nodeId: x.id, field: "id", message: "Node id is empty." });
    const k = x.id.toLowerCase();
    if (seen.has(k))
      push({ severity: "error", code: "DUPLICATE_NODE", nodeId: x.id, field: "id", message: `Id clashes with "${seen.get(k)}" (ids are unique ignoring case).` });
    else seen.set(k, x.id);
  }
  if (!g.nodes.some((x) => x.kind === "END"))
    push({ severity: "error", code: "MISSING_END", message: "The graph has no END node." });

  for (const x of g.nodes) {
    for (const d of x.dependsOn) {
      if (d === x.id) push({ severity: "error", code: "INVALID_DEPENDENCY", nodeId: x.id, field: "dependsOn", message: "Depends on itself." });
      else if (!ids.has(d)) push({ severity: "error", code: "INVALID_DEPENDENCY", nodeId: x.id, field: "dependsOn", message: `Depends on "${d}", which does not exist.` });
    }
    const keys = CONFIG_KEYS[x.kind];
    for (const k of Object.keys(x.config))
      if (!keys.includes(k)) push({ severity: "error", code: "NODE_CONFIG", nodeId: x.id, field: `config.${k}`, message: `${x.kind} has no "${k}" setting.` });
    for (const k of keys)
      if (!hasOwn(x.config, k)) push({ severity: "error", code: "NODE_CONFIG", nodeId: x.id, field: `config.${k}`, message: `"${k}" is required.` });
    const c = x.config;
    if (x.kind === "TASK" && !EXECUTION_KINDS.includes(c.executionKind as never))
      push({ severity: "error", code: "NODE_CONFIG", nodeId: x.id, field: "config.executionKind", message: "Pick an execution kind: AGENT, FUNCTION, TOOL or HUMAN." });
    if (x.kind === "JOIN") {
      if (!JOIN_MODES.includes(c.mode as never)) push({ severity: "error", code: "NODE_CONFIG", nodeId: x.id, field: "config.mode", message: "Mode must be ALL or ANY." });
      if (x.dependsOn.length === 0) push({ severity: "error", code: "NODE_CONFIG", nodeId: x.id, field: "dependsOn", message: "A JOIN needs at least one incoming node." });
    }
    if (x.kind === "LOOP" && !isPositiveIntString(c.maxIterations))
      push({ severity: "error", code: "NODE_CONFIG", nodeId: x.id, field: "config.maxIterations", message: "Max iterations must be a whole number above 0." });
    if (x.kind === "DECISION") {
      if (typeof c.field !== "string" || c.field === "")
        push({ severity: "error", code: "NODE_CONFIG", nodeId: x.id, field: "config.field", message: "Name the result field to test." });
      for (const b of ["then", "else"] as const) {
        const t = c[b];
        if (typeof t !== "string" || t === "") push({ severity: "error", code: "NODE_CONFIG", nodeId: x.id, field: `config.${b}`, message: `Choose the "${b}" target.` });
        else if (!ids.has(t)) push({ severity: "error", code: "NODE_CONFIG", nodeId: x.id, field: `config.${b}`, message: `"${b}" points at "${t}", which does not exist.` });
        else if (!byId.get(t)!.dependsOn.includes(x.id))
          push({ severity: "error", code: "NODE_CONFIG", nodeId: x.id, field: `config.${b}`, message: `"${t}" must depend on this decision.` });
      }
      if (c.then && c.then === c.else) push({ severity: "error", code: "NODE_CONFIG", nodeId: x.id, field: "config.else", message: '"then" and "else" must differ.' });
      const props = x.outputSchema?.properties;
      if (typeof c.field === "string" && c.field && props && typeof props === "object" && !Array.isArray(props) && !hasOwn(props, c.field))
        push({ severity: "warning", code: "DECISION_FIELD", nodeId: x.id, field: "config.field", message: `outputSchema does not declare "${c.field}".` });
    }
  }

  // Cycles: report every node on a back edge's cycle once.
  const state = new Map<string, 1 | 2>();
  const stack: string[] = [];
  const inCycle = new Set<string>();
  const visit = (id: string) => {
    state.set(id, 1);
    stack.push(id);
    for (const d of byId.get(id)?.dependsOn ?? []) {
      if (!byId.has(d)) continue;
      if (state.get(d) === 1) stack.slice(stack.indexOf(d)).forEach((c) => inCycle.add(c));
      else if (!state.has(d)) visit(d);
    }
    stack.pop();
    state.set(id, 2);
  };
  for (const x of g.nodes) if (!state.has(x.id)) visit(x.id);
  for (const id of inCycle) push({ severity: "error", code: "GRAPH_CYCLE", nodeId: id, field: "dependsOn", message: "Sits on a dependency cycle." });

  const reachable = new Set<string>();
  const queue = g.nodes.filter((x) => x.kind === "END").map((x) => x.id);
  while (queue.length) {
    const id = queue.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    queue.push(...(byId.get(id)?.dependsOn ?? []));
  }
  if (g.nodes.some((x) => x.kind === "END"))
    for (const x of g.nodes)
      if (!reachable.has(x.id)) push({ severity: "error", code: "NO_END_PATH", nodeId: x.id, message: "No path from here to an END node." });

  return out;
}

export function issuesByNode(issues: Issue[]): Map<string, Issue[]> {
  const m = new Map<string, Issue[]>();
  for (const i of issues) if (i.nodeId !== undefined) m.set(i.nodeId, [...(m.get(i.nodeId) ?? []), i]);
  return m;
}

export function configSummary(x: PNode): string {
  const c = x.config;
  switch (x.kind) {
    case "TASK":
      return c.executionKind ? String(c.executionKind) : "no execution kind";
    case "DECISION":
      return c.field ? `${c.field} == ${JSON.stringify(c.equals)}` : "no field";
    case "JOIN":
      return `wait for ${c.mode === "ANY" ? "any" : "all"}`;
    case "LOOP":
      return `≤ ${c.maxIterations} iterations`;
    default:
      return "";
  }
}
