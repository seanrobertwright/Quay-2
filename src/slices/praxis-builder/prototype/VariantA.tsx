// PROTOTYPE (#226) — throwaway. Variant A, "Cards and branch handles": Archon-style cards
// with a config summary, a DECISION with labelled then/else source handles (dragging one
// sets config and dependsOn together), a docked right inspector, raw JSON schema fields,
// and issue-count badges plus a bottom Problems list.
import { useMemo, useState, type FC } from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { ChevronDown, ChevronUp, CircleAlert, LayoutGrid, Trash, TriangleAlert } from "lucide-react";
import { addNode, branchOf, connect, configSummary, deleteNode, disconnect, issuesByNode, KINDS, renameNode, setBranch, setSchema, type Issue, type PNode } from "./model";
import { KIND_GROUPS, KIND_META } from "./kinds";
import { edgeId, useFlowNodes } from "./canvas";
import { ConfigForm, DependsOnEditor, FieldIssues, IdField, RawSchemaEditor, type VariantProps } from "./forms";

type AData = { node: PNode; issues: Issue[] };
const W = 230;
const H = 92;

const handleCls = "!w-2.5 !h-2.5 !border-2 !border-[#0d1117]";

const CardNode: FC<NodeProps<Node<AData>>> = ({ data, selected }) => {
  const { node, issues } = data;
  const meta = KIND_META[node.kind];
  const errors = issues.filter((i) => i.severity === "error").length;
  const summary = configSummary(node);
  return (
    <div
      className={`relative w-[230px] rounded-lg border bg-[#161b22] shadow-md ${
        selected ? "border-[#58a6ff] ring-2 ring-[#58a6ff]/40" : errors ? "border-[#f85149]/70" : "border-[#30363d]"
      }`}
      style={{ borderTop: `3px solid ${meta.color}` }}
    >
      <Handle type="target" position={Position.Top} className={handleCls} style={{ background: "#8b949e" }} />
      <div className="flex items-center gap-1.5 px-2.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: meta.color }}>
        <meta.icon className="w-3.5 h-3.5" />
        {meta.label}
        <span className="ml-auto flex gap-1 normal-case tracking-normal font-normal">
          {node.inputSchema && <span className="px-1 rounded bg-[#21262d] text-[#8b949e]">in</span>}
          {node.outputSchema && <span className="px-1 rounded bg-[#21262d] text-[#8b949e]">out</span>}
        </span>
      </div>
      <div className="px-2.5 pb-3 pt-0.5">
        <div className="font-mono text-sm text-white truncate">{node.id}</div>
        <div className={`text-[11px] truncate ${summary ? "text-[#8b949e]" : "text-[#484f58] italic"}`}>{summary || "no settings"}</div>
      </div>
      {issues.length > 0 && (
        <span
          title={issues.map((i) => i.message).join("\n")}
          className={`absolute -top-2.5 -right-2.5 min-w-5 h-5 px-1 rounded-full flex items-center justify-center text-[10px] font-bold text-white ${errors ? "bg-[#da3633]" : "bg-[#9e6a03]"}`}
        >
          {issues.length}
        </span>
      )}
      {node.kind === "DECISION" ? (
        <>
          <Handle id="then" type="source" position={Position.Bottom} className={handleCls} style={{ left: "30%", background: "#3fb950" }} />
          <Handle id="else" type="source" position={Position.Bottom} className={handleCls} style={{ left: "70%", background: "#f85149" }} />
          <Handle id="dep" type="source" position={Position.Right} className={handleCls} style={{ background: "#8b949e" }} />
          <span className="absolute -bottom-4 text-[9px] font-semibold text-[#3fb950]" style={{ left: "30%", transform: "translateX(-50%)" }}>
            then
          </span>
          <span className="absolute -bottom-4 text-[9px] font-semibold text-[#ff7b72]" style={{ left: "70%", transform: "translateX(-50%)" }}>
            else
          </span>
        </>
      ) : (
        <Handle type="source" position={Position.Bottom} className={handleCls} style={{ background: "#8b949e" }} />
      )}
    </div>
  );
};

const nodeTypes = { card: CardNode };

export const VariantA: FC<VariantProps> = ({ graph, issues, selectedId, select, edit }) => {
  const rf = useReactFlow();
  const byNode = useMemo(() => issuesByNode(issues), [issues]);
  const flow = useFlowNodes<AData>(graph, selectedId, "card", (n) => ({ node: n, issues: byNode.get(n.id) ?? [] }), { width: W, height: H, direction: "TB", ranksep: 70 });
  const [selEdge, setSelEdge] = useState<string | null>(null);
  const [problemsOpen, setProblemsOpen] = useState(true);

  const edges = useMemo(() => {
    const ids = new Set(graph.nodes.map((n) => n.id));
    const out: Edge[] = [];
    for (const x of graph.nodes) {
      for (const d of x.dependsOn) {
        if (!ids.has(d)) continue;
        const src = graph.nodes.find((n) => n.id === d)!;
        const b = branchOf(graph, d, x.id);
        const color = b === "then" ? "#3fb950" : b === "else" ? "#f85149" : "#6e7681";
        const id = edgeId(d, x.id);
        out.push({
          id,
          source: d,
          target: x.id,
          sourceHandle: src.kind === "DECISION" ? (b ?? "dep") : undefined,
          label: b ?? undefined,
          labelStyle: { fill: color, fontSize: 10, fontWeight: 600 },
          labelBgStyle: { fill: "#0d1117" },
          style: { stroke: color, strokeWidth: selEdge === id ? 2.5 : 1.5 },
          markerEnd: { type: MarkerType.ArrowClosed, color },
          selected: selEdge === id,
        });
      }
      if (x.kind === "DECISION")
        for (const b of ["then", "else"] as const) {
          const t = x.config[b];
          const target = graph.nodes.find((n) => n.id === t);
          if (target && !target.dependsOn.includes(x.id)) {
            const id = edgeId(x.id, target.id, `ghost-${b}`);
            out.push({
              id,
              source: x.id,
              target: target.id,
              sourceHandle: b,
              label: `${b}, but no dependsOn`,
              labelStyle: { fill: "#ff7b72", fontSize: 10 },
              labelBgStyle: { fill: "#0d1117" },
              style: { stroke: "#f85149", strokeDasharray: "5 4" },
              selected: selEdge === id,
            });
          }
        }
    }
    return out;
  }, [graph, selEdge]);

  const selected = graph.nodes.find((n) => n.id === selectedId) ?? null;
  const focus = (id: string) => {
    select(id);
    rf.fitView({ nodes: [{ id }], duration: 300, maxZoom: 1.1 });
  };
  const add = (kind: PNode["kind"]) => {
    const r = addNode(graph, kind);
    const el = document.querySelector(".react-flow")?.getBoundingClientRect();
    if (el) flow.placeAt(r.id, rf.screenToFlowPosition({ x: el.left + el.width / 2 - W / 2, y: el.top + el.height / 3 }));
    edit(() => r.graph);
    select(r.id);
  };
  const errors = issues.filter((i) => i.severity === "error").length;

  return (
    <div className="absolute inset-0 flex">
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex-1 min-h-0 relative">
          <ReactFlow
            nodes={flow.nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={flow.onNodesChange}
            onNodeClick={(_, n) => {
              select(n.id);
              setSelEdge(null);
            }}
            onEdgeClick={(_, e) => {
              setSelEdge(e.id);
              select(null);
            }}
            onPaneClick={() => {
              select(null);
              setSelEdge(null);
            }}
            onConnect={(c) => {
              if (c.sourceHandle === "then" || c.sourceHandle === "else") {
                const b = c.sourceHandle;
                edit((g) => setBranch(g, c.source, b, c.target));
              } else edit((g) => connect(g, c.source, c.target));
            }}
            onNodesDelete={(ns) => {
              edit((g) => ns.reduce((acc, n) => deleteNode(acc, n.id), g));
              select(null);
            }}
            onEdgesDelete={(es) =>
              edit((g) =>
                es.reduce((acc, e) => {
                  const [s, t, tag] = JSON.parse(e.id) as [string, string, string];
                  return tag.startsWith("ghost-") ? setBranch(acc, s, tag.slice(6) as "then" | "else", "") : disconnect(acc, s, t);
                }, g),
              )
            }
            deleteKeyCode={["Delete", "Backspace"]}
            colorMode="dark"
            fitView
            fitViewOptions={{ minZoom: 0.6, maxZoom: 1 }}
            minZoom={0.2}
          >
            <Background gap={20} color="#21262d" />
            <Controls showInteractive={false} />
          </ReactFlow>
          {/* palette */}
          <div className="absolute left-3 top-3 z-10 flex flex-col gap-0.5 p-1 rounded-lg bg-[#161b22]/95 border border-[#30363d] shadow-lg">
            {KIND_GROUPS.map((grp, gi) => (
              <div key={grp} className={`flex flex-col gap-0.5 ${gi ? "pt-1 mt-0.5 border-t border-[#30363d]" : ""}`}>
                {KINDS.filter((k) => KIND_META[k].group === grp).map((k) => {
                  const m = KIND_META[k];
                  return (
                    <button key={k} type="button" aria-label={`Add ${m.label}`} title={`${m.label}: ${m.blurb}`} onClick={() => add(k)} className="p-1.5 rounded-md hover:bg-[#21262d]" style={{ color: m.color }}>
                      <m.icon className="w-4 h-4" />
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="absolute right-3 top-3 z-10 flex gap-1.5">
            <button type="button" onClick={() => flow.relayout()} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-[#161b22] border border-[#30363d] text-xs text-[#8b949e] hover:text-white">
              <LayoutGrid className="w-3.5 h-3.5" /> Auto layout
            </button>
          </div>
          <p className="absolute left-16 bottom-3 z-10 text-[10px] text-[#6e7681] pointer-events-none">
            Drag from a decision&apos;s green or red dot to set then or else. Select an edge and press Delete to remove it.
          </p>
        </div>
        {/* problems */}
        <section aria-label="Problems" className="shrink-0 border-t border-[#30363d] bg-[#161b22]">
          <button type="button" aria-expanded={problemsOpen} aria-controls="a-problems" onClick={() => setProblemsOpen((o) => !o)} className="w-full h-8 px-3 flex items-center gap-3 text-xs">
            <span className="font-semibold text-white">Problems</span>
            <span className="inline-flex items-center gap-1 text-[#ff7b72]">
              <CircleAlert className="w-3.5 h-3.5" /> {errors}
            </span>
            <span className="inline-flex items-center gap-1 text-[#e3b341]">
              <TriangleAlert className="w-3.5 h-3.5" /> {issues.length - errors}
            </span>
            <span className="ml-auto text-[#8b949e]">{problemsOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}</span>
          </button>
          {problemsOpen && (
            <ul id="a-problems" className="max-h-36 overflow-y-auto pb-1">
              {issues.length === 0 && <li className="px-3 py-1 text-xs text-[#3fb950]">No problems. The graph would pass validateGraph.</li>}
              {issues.map((i) => (
                <li key={i.key}>
                  <button type="button" disabled={!i.nodeId} onClick={() => i.nodeId && focus(i.nodeId)} className="w-full px-3 py-1 flex items-center gap-2 text-left text-xs hover:bg-[#21262d] disabled:hover:bg-transparent">
                    {i.severity === "error" ? <CircleAlert className="w-3.5 h-3.5 text-[#ff7b72] shrink-0" /> : <TriangleAlert className="w-3.5 h-3.5 text-[#e3b341] shrink-0" />}
                    <span className="font-mono text-[#c9d1d9] w-36 truncate">{i.nodeId ?? "(graph)"}</span>
                    <span className="font-mono text-[#6e7681] w-40 truncate">{i.field ?? ""}</span>
                    <span className="text-[#8b949e] truncate">{i.message}</span>
                    <span className="ml-auto font-mono text-[10px] text-[#484f58]">{i.code}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {/* inspector */}
      <aside aria-label="Inspector" className="w-[340px] shrink-0 border-l border-[#30363d] bg-[#0d1117] overflow-y-auto">
        {!selected ? (
          <div className="p-4 text-xs text-[#6e7681] space-y-2">
            <p className="text-[#8b949e] font-medium">Nothing selected</p>
            <p>Select a node to edit it, or add one from the palette on the left of the canvas.</p>
            <p className="font-mono">
              {graph.nodes.length} nodes · revision {graph.revision}
            </p>
          </div>
        ) : (
          <Inspector key={selected.id} node={selected} {...{ graph, issues: byNode.get(selected.id) ?? [], edit, select }} onRename={(to) => {
            flow.noteRename(selected.id, to);
            edit((g) => renameNode(g, selected.id, to));
            select(to);
          }} />
        )}
      </aside>
    </div>
  );
};

const Inspector: FC<{ node: PNode; graph: VariantProps["graph"]; issues: Issue[]; edit: VariantProps["edit"]; select: VariantProps["select"]; onRename: (to: string) => void }> = ({
  node,
  graph,
  issues,
  edit,
  select,
  onRename,
}) => {
  const meta = KIND_META[node.kind];
  const section = "px-4 py-3 border-b border-[#21262d] space-y-3";
  return (
    <div>
      <div className="px-4 py-3 border-b border-[#30363d] flex items-start gap-2.5">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${meta.color}22`, color: meta.color }}>
          <meta.icon className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <div className="text-xs font-semibold" style={{ color: meta.color }}>
            {node.kind}
          </div>
          <div className="text-[11px] text-[#8b949e]">{meta.blurb}</div>
        </div>
        <button
          type="button"
          aria-label={`Delete ${node.id}`}
          onClick={() => {
            edit((g) => deleteNode(g, node.id));
            select(null);
          }}
          className="ml-auto p-1 rounded-md text-[#8b949e] hover:text-[#ff7b72] hover:bg-[#21262d]"
        >
          <Trash className="w-4 h-4" />
        </button>
      </div>
      {issues.some((i) => !i.field) && (
        <div className="px-4 pt-3">
          <FieldIssues issues={issues.map((i) => (i.field ? i : { ...i, field: "_" }))} field="_" />
        </div>
      )}
      <div className={section}>
        <IdField node={node} issues={issues} onRename={onRename} />
      </div>
      <div className={section}>
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[#6e7681]">Config</h3>
        <ConfigForm node={node} graph={graph} issues={issues} edit={edit} />
      </div>
      <div className={section}>
        <DependsOnEditor node={node} graph={graph} issues={issues} edit={edit} />
      </div>
      <div className={section}>
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[#6e7681]">Data</h3>
        <RawSchemaEditor label="inputSchema" value={node.inputSchema} onChange={(v) => edit((g) => setSchema(g, node.id, "inputSchema", v))} />
        <RawSchemaEditor label="outputSchema" value={node.outputSchema} onChange={(v) => edit((g) => setSchema(g, node.id, "outputSchema", v))} />
      </div>
    </div>
  );
};
