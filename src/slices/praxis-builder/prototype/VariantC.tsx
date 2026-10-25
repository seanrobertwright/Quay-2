// PROTOTYPE (#226) — throwaway. Variant C, "Flow left to right, branch on the edge":
// left-to-right tiles with a severity stripe, then/else picked on the edge label itself
// (a decision's edges are plain dependsOn until labelled), a bottom sheet that is the
// inspector when a node is selected and the palette when none is, schema editing as raw
// JSON plus "from an example", and an always-open Problems rail grouped by node.
import { useMemo, useState, type FC } from "react";
import {
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  getSmoothStepPath,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { CircleAlert, LayoutGrid, Trash, TriangleAlert } from "lucide-react";
import {
  addNode,
  branchOf,
  configSummary,
  connect,
  deleteNode,
  disconnect,
  issuesByNode,
  KINDS,
  renameNode,
  setConfig,
  setSchema,
  type Branch,
  type Issue,
  type PGraph,
  type PNode,
} from "./model";
import { KIND_GROUPS, KIND_META } from "./kinds";
import { edgeId, useFlowNodes } from "./canvas";
import { ConfigForm, DependsOnEditor, FieldIssues, IdField, InferSchemaEditor, type VariantProps } from "./forms";

type CData = { node: PNode; issues: Issue[] };
const W = 164;
const H = 78;

const TileNode: FC<NodeProps<Node<CData>>> = ({ data, selected }) => {
  const { node, issues } = data;
  const meta = KIND_META[node.kind];
  const err = issues.some((i) => i.severity === "error");
  const stripe = err ? "#f85149" : issues.length ? "#d29922" : "transparent";
  return (
    <div
      className={`w-[164px] h-[78px] rounded-md bg-[#161b22] border flex overflow-hidden ${selected ? "border-[#58a6ff] shadow-[0_0_0_2px_rgba(88,166,255,0.35)]" : "border-[#30363d]"}`}
      title={issues.map((i) => i.message).join("\n") || undefined}
    >
      <Handle type="target" position={Position.Left} className="!w-2 !h-4 !rounded-sm !bg-[#484f58] !border-0" />
      <div className="w-1 shrink-0" style={{ background: stripe }} />
      <div className="flex-1 min-w-0 px-2 py-1.5 flex flex-col">
        <div className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider" style={{ color: meta.color }}>
          <meta.icon className="w-3 h-3" /> {meta.label}
          {issues.length > 0 && (
            <span className="ml-auto flex items-center gap-0.5 normal-case" style={{ color: stripe }}>
              {err ? <CircleAlert className="w-3 h-3" /> : <TriangleAlert className="w-3 h-3" />}
              {issues.length}
            </span>
          )}
        </div>
        <div className="font-mono text-[13px] text-white truncate mt-0.5">{node.id}</div>
        <div className="text-[10px] text-[#8b949e] truncate mt-auto">{configSummary(node) || " "}</div>
      </div>
      <Handle type="source" position={Position.Right} className="!w-2 !h-4 !rounded-sm !bg-[#484f58] !border-0" />
    </div>
  );
};

type DEData = { branch: Branch | null; open: boolean; onPick: (b: Branch | null) => void; onOpen: () => void };

const DecisionEdge: FC<EdgeProps<Edge<DEData>>> = (p) => {
  const [path, lx, ly] = getSmoothStepPath(p);
  const d = p.data!;
  const color = d.branch === "then" ? "#3fb950" : d.branch === "else" ? "#f85149" : "#d29922";
  const pick = (b: Branch | null) => d.onPick(b);
  return (
    <>
      <BaseEdge id={p.id} path={path} markerEnd={p.markerEnd} style={{ stroke: color, strokeWidth: 1.5, strokeDasharray: d.branch ? undefined : "4 3" }} />
      <EdgeLabelRenderer>
        <div className="nodrag nopan absolute pointer-events-auto" style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}>
          {d.open ? (
            <div role="group" aria-label="Branch for this edge" className="flex rounded-md border border-[#30363d] bg-[#0d1117] shadow-lg overflow-hidden text-[10px] font-semibold">
              {(["then", "else", null] as const).map((b) => (
                <button
                  key={String(b)}
                  type="button"
                  aria-pressed={d.branch === b}
                  onClick={() => pick(b)}
                  className={`px-2 py-1 ${d.branch === b ? "bg-[#30363d] text-white" : "text-[#8b949e] hover:text-white"}`}
                  style={{ color: d.branch === b ? undefined : b === "then" ? "#3fb950" : b === "else" ? "#ff7b72" : undefined }}
                >
                  {b ?? "plain"}
                </button>
              ))}
            </div>
          ) : (
            <button
              type="button"
              onClick={d.onOpen}
              className="px-1.5 py-0.5 rounded-full border text-[10px] font-semibold bg-[#0d1117] hover:brightness-125"
              style={{ color, borderColor: color }}
            >
              {d.branch ?? "set branch"}
            </button>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
};

const nodeTypes = { tile: TileNode };
const edgeTypes = { decision: DecisionEdge };

// On an existing decision edge the branch is only a label: dependsOn already holds it.
function labelEdge(g: PGraph, decision: string, target: string, b: Branch | null): PGraph {
  const d = g.nodes.find((x) => x.id === decision)!;
  let next = g;
  if (d.config.then === target) next = setConfig(next, decision, "then", "");
  if (d.config.else === target) next = setConfig(next, decision, "else", "");
  return b ? setConfig(next, decision, b, target) : next;
}

export const VariantC: FC<VariantProps> = ({ graph, issues, selectedId, select, edit }) => {
  const rf = useReactFlow();
  const byNode = useMemo(() => issuesByNode(issues), [issues]);
  const flow = useFlowNodes<CData>(graph, selectedId, "tile", (n) => ({ node: n, issues: byNode.get(n.id) ?? [] }), {
    width: W,
    height: H,
    direction: "LR",
    ranksep: 64,
    nodesep: 22,
  });
  const [openEdge, setOpenEdge] = useState<string | null>(null);

  const edges = useMemo(() => {
    const ids = new Set(graph.nodes.map((n) => n.id));
    const out: Edge[] = [];
    for (const x of graph.nodes)
      for (const d of x.dependsOn) {
        if (!ids.has(d)) continue;
        const id = edgeId(d, x.id);
        if (graph.nodes.find((n) => n.id === d)!.kind === "DECISION") {
          const b = branchOf(graph, d, x.id);
          const color = b === "then" ? "#3fb950" : b === "else" ? "#f85149" : "#d29922";
          out.push({
            id,
            source: d,
            target: x.id,
            type: "decision",
            markerEnd: { type: MarkerType.ArrowClosed, color },
            data: {
              branch: b,
              open: openEdge === id,
              onOpen: () => setOpenEdge(id),
              onPick: (nb: Branch | null) => {
                edit((g) => labelEdge(g, d, x.id, nb));
                setOpenEdge(null);
              },
            },
          });
        } else {
          out.push({ id, source: d, target: x.id, type: "smoothstep", style: { stroke: "#484f58" }, markerEnd: { type: MarkerType.ArrowClosed, color: "#484f58" } });
        }
      }
    return out;
  }, [graph, openEdge, edit]);

  const selected = graph.nodes.find((n) => n.id === selectedId) ?? null;
  const focus = (id: string) => {
    select(id);
    rf.fitView({ nodes: [{ id }], duration: 300, maxZoom: 1.2 });
  };
  const add = (kind: PNode["kind"]) => {
    const r = addNode(graph, kind);
    const el = document.querySelector(".react-flow")?.getBoundingClientRect();
    if (el) flow.placeAt(r.id, rf.screenToFlowPosition({ x: el.left + el.width / 2, y: el.top + 40 }));
    edit(() => r.graph);
    select(r.id);
  };

  const graphIssues = issues.filter((i) => !i.nodeId);
  const grouped = [...byNode.entries()];

  return (
    <div className="praxis-c absolute inset-0 flex">
      {/* Edge labels are buttons here, so lift them above the node layer. */}
      <style>{".praxis-c .react-flow__edgelabel-renderer { z-index: 1001; }"}</style>
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex-1 min-h-0 relative">
          <ReactFlow
            nodes={flow.nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={flow.onNodesChange}
            onNodeClick={(_, n) => {
              select(n.id);
              setOpenEdge(null);
            }}
            onPaneClick={() => {
              select(null);
              setOpenEdge(null);
            }}
            onConnect={(c) => edit((g) => connect(g, c.source, c.target))}
            onNodesDelete={(ns) => {
              edit((g) => ns.reduce((acc, n) => deleteNode(acc, n.id), g));
              select(null);
            }}
            onEdgesDelete={(es) => edit((g) => es.reduce((acc, e) => disconnect(acc, e.source, e.target), g))}
            deleteKeyCode={["Delete", "Backspace"]}
            colorMode="dark"
            fitView
            fitViewOptions={{ minZoom: 0.6, maxZoom: 1 }}
            minZoom={0.2}
          >
            <Background gap={24} color="#21262d" />
            <Controls showInteractive={false} position="top-left" />
          </ReactFlow>
          <button type="button" onClick={() => flow.relayout()} className="absolute right-3 top-3 z-10 inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-[#161b22] border border-[#30363d] text-xs text-[#8b949e] hover:text-white">
            <LayoutGrid className="w-3.5 h-3.5" /> Auto layout
          </button>
        </div>
        {/* bottom sheet */}
        <section aria-label={selected ? `Edit ${selected.id}` : "Add a node"} className="h-[290px] shrink-0 border-t border-[#30363d] bg-[#0d1117]">
          {selected ? (
            <Sheet
              key={selected.id}
              node={selected}
              graph={graph}
              issues={byNode.get(selected.id) ?? []}
              edit={edit}
              onDelete={() => {
                edit((g) => deleteNode(g, selected.id));
                select(null);
              }}
              onRename={(to) => {
                flow.noteRename(selected.id, to);
                edit((g) => renameNode(g, selected.id, to));
                select(to);
              }}
            />
          ) : (
            <div className="h-full overflow-y-auto p-4">
              <h3 className="text-xs font-semibold text-white mb-2">Add a node</h3>
              <div className="grid grid-cols-4 gap-4">
                {KIND_GROUPS.map((grp) => (
                  <div key={grp}>
                    <div className="text-[10px] uppercase tracking-wider text-[#6e7681] mb-1">{grp}</div>
                    <div className="space-y-1">
                      {KINDS.filter((k) => KIND_META[k].group === grp).map((k) => {
                        const m = KIND_META[k];
                        return (
                          <button key={k} type="button" onClick={() => add(k)} className="w-full text-left flex items-start gap-2 p-1.5 rounded-md border border-transparent hover:border-[#30363d] hover:bg-[#161b22]">
                            <m.icon className="w-4 h-4 mt-0.5 shrink-0" style={{ color: m.color }} />
                            <span>
                              <span className="block text-xs text-white">{m.label}</span>
                              <span className="block text-[10px] text-[#6e7681]">{m.blurb}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
      {/* problems rail */}
      <aside aria-label="Problems" className="w-64 shrink-0 border-l border-[#30363d] bg-[#0d1117] overflow-y-auto">
        <div className="px-3 py-2 border-b border-[#30363d] flex items-center gap-2 text-xs">
          <span className="font-semibold text-white">Problems</span>
          <span className="ml-auto text-[#8b949e]">{issues.length}</span>
        </div>
        {issues.length === 0 && <p className="p-3 text-xs text-[#3fb950]">None. This graph would pass validateGraph.</p>}
        {graphIssues.length > 0 && (
          <div className="px-3 py-2 border-b border-[#21262d]">
            <div className="text-[10px] uppercase tracking-wider text-[#6e7681] mb-1">Graph</div>
            {graphIssues.map((i) => (
              <p key={i.key} className="text-[11px] text-[#ff7b72]">
                {i.message}
              </p>
            ))}
          </div>
        )}
        {grouped.map(([id, list]) => {
          const n = graph.nodes.find((x) => x.id === id);
          const m = n ? KIND_META[n.kind] : null;
          return (
            <button key={id} type="button" onClick={() => focus(id)} className={`w-full text-left px-3 py-2 border-b border-[#21262d] hover:bg-[#161b22] ${id === selectedId ? "bg-[#161b22]" : ""}`}>
              <div className="flex items-center gap-1.5 text-xs">
                {m && <m.icon className="w-3.5 h-3.5" style={{ color: m.color }} />}
                <span className="font-mono text-white truncate">{id}</span>
                <span className="ml-auto text-[10px] text-[#6e7681]">{list.length}</span>
              </div>
              <ul className="mt-1 space-y-0.5">
                {list.map((i) => (
                  <li key={i.key} className={`text-[11px] ${i.severity === "error" ? "text-[#ff7b72]" : "text-[#e3b341]"}`}>
                    {i.field && <span className="font-mono text-[#6e7681]">{i.field}: </span>}
                    {i.message}
                  </li>
                ))}
              </ul>
            </button>
          );
        })}
      </aside>
    </div>
  );
};

const Sheet: FC<{ node: PNode; graph: PGraph; issues: Issue[]; edit: VariantProps["edit"]; onDelete: () => void; onRename: (to: string) => void }> = ({
  node,
  graph,
  issues,
  edit,
  onDelete,
  onRename,
}) => {
  const meta = KIND_META[node.kind];
  const col = "p-3 overflow-y-auto border-r border-[#21262d] space-y-3";
  const h = "text-[10px] font-semibold uppercase tracking-wider text-[#6e7681]";
  return (
    <div className="h-full grid grid-cols-[220px_250px_210px_minmax(0,1fr)]">
      <div className={col}>
        <div className="flex items-center gap-2">
          <meta.icon className="w-4 h-4" style={{ color: meta.color }} />
          <span className="text-xs font-semibold" style={{ color: meta.color }}>
            {node.kind}
          </span>
          <button type="button" aria-label={`Delete ${node.id}`} onClick={onDelete} className="ml-auto p-1 rounded text-[#8b949e] hover:text-[#ff7b72]">
            <Trash className="w-3.5 h-3.5" />
          </button>
        </div>
        <p className="text-[11px] text-[#8b949e]">{meta.blurb}</p>
        <IdField node={node} issues={issues} onRename={onRename} />
        <FieldIssues issues={issues.map((i) => (i.field ? i : { ...i, field: "_" }))} field="_" />
      </div>
      <div className={col}>
        <h3 className={h}>Settings</h3>
        <ConfigForm node={node} graph={graph} issues={issues} edit={edit} branchPickers={false} />
      </div>
      <div className={col}>
        <DependsOnEditor node={node} graph={graph} issues={issues} edit={edit} />
      </div>
      <div className="p-3 overflow-y-auto space-y-4">
        <InferSchemaEditor key={`${node.id}-in`} label="inputSchema" value={node.inputSchema} onChange={(v) => edit((g) => setSchema(g, node.id, "inputSchema", v))} />
        <InferSchemaEditor key={`${node.id}-out`} label="outputSchema" value={node.outputSchema} onChange={(v) => edit((g) => setSchema(g, node.id, "outputSchema", v))} />
      </div>
    </div>
  );
};
