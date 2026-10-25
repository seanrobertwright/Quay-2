// PROTOTYPE (#226) — throwaway. Variant B, "Pills and a branch picker": compact pills
// with the DECISION as a diamond, plain edges from one handle, then/else chosen in the
// inspector (which adds the dependsOn), an inspector that floats beside the selected node,
// a field-table schema editor, and red rings plus a toolbar Problems dropdown.
import { useMemo, useRef, useState, type FC } from "react";
import {
  Background,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  useReactFlow,
  useViewport,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { ChevronDown, CircleAlert, LayoutGrid, Trash, TriangleAlert, X } from "lucide-react";
import { addNode, branchOf, connect, deleteNode, disconnect, issuesByNode, KINDS, renameNode, setSchema, type Issue, type PNode } from "./model";
import { KIND_META } from "./kinds";
import { edgeId, useFlowNodes } from "./canvas";
import { ConfigForm, DependsOnEditor, FieldIssues, FieldTableSchemaEditor, IdField, type VariantProps } from "./forms";

type BData = { node: PNode; issues: Issue[] };
const W = 180;
const H = 40;
const DH = 76; // decision box: diamond plus the id under it

const hidden = "!w-2 !h-2 !bg-[#484f58] !border-0";

const PillNode: FC<NodeProps<Node<BData>>> = ({ data, selected }) => {
  const { node, issues } = data;
  const meta = KIND_META[node.kind];
  const err = issues.some((i) => i.severity === "error");
  const warn = !err && issues.length > 0;
  const ring = selected ? "ring-2 ring-[#58a6ff]" : err ? "ring-2 ring-[#f85149]" : warn ? "ring-2 ring-[#d29922]" : "";
  const tip = issues.map((i) => i.message).join("\n") || `${meta.label}: ${meta.blurb}`;

  if (node.kind === "DECISION") {
    return (
      <div className="w-[180px] h-[76px] flex flex-col items-center" title={tip}>
        <Handle type="target" position={Position.Top} className={hidden} />
        <div className={`mt-1 w-11 h-11 rotate-45 rounded-md bg-[#2d2208] border border-[#e3b341] flex items-center justify-center ${ring}`}>
          <meta.icon className="w-4 h-4 -rotate-45 text-[#e3b341]" />
        </div>
        <div className="mt-2 px-1.5 rounded bg-[#0d1117]/80 font-mono text-xs text-white truncate max-w-full">{node.id}</div>
        <Handle type="source" position={Position.Bottom} className={hidden} />
      </div>
    );
  }
  return (
    <div className={`w-[180px] h-[40px] rounded-full bg-[#161b22] border border-[#30363d] flex items-center gap-2 pl-1 pr-3 ${ring}`} title={tip}>
      <Handle type="target" position={Position.Top} className={hidden} />
      <span className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: `${meta.color}22`, color: meta.color }}>
        <meta.icon className="w-4 h-4" />
      </span>
      <span className="font-mono text-xs text-white truncate">{node.id}</span>
      {node.kind === "END" ? null : <Handle type="source" position={Position.Bottom} className={hidden} />}
    </div>
  );
};

const nodeTypes = { pill: PillNode };

export const VariantB: FC<VariantProps> = ({ graph, issues, selectedId, select, edit }) => {
  const rf = useReactFlow();
  const vp = useViewport();
  const wrap = useRef<HTMLDivElement>(null);
  const byNode = useMemo(() => issuesByNode(issues), [issues]);
  const flow = useFlowNodes<BData>(graph, selectedId, "pill", (n) => ({ node: n, issues: byNode.get(n.id) ?? [] }), {
    width: W,
    height: H,
    direction: "TB",
    ranksep: 44,
    nodesep: 28,
    sizeOf: (n) => ({ width: W, height: n.kind === "DECISION" ? DH : H }),
  });
  const [selEdge, setSelEdge] = useState<string | null>(null);
  const [problemsOpen, setProblemsOpen] = useState(false);

  const edges = useMemo(() => {
    const ids = new Set(graph.nodes.map((n) => n.id));
    const out: Edge[] = [];
    for (const x of graph.nodes)
      for (const d of x.dependsOn) {
        if (!ids.has(d)) continue;
        const fromDecision = graph.nodes.find((n) => n.id === d)!.kind === "DECISION";
        const b = branchOf(graph, d, x.id);
        const color = b === "then" ? "#3fb950" : b === "else" ? "#f85149" : fromDecision ? "#d29922" : "#484f58";
        const id = edgeId(d, x.id);
        out.push({
          id,
          source: d,
          target: x.id,
          type: "smoothstep",
          label: b ?? (fromDecision ? "not a branch" : undefined),
          labelStyle: { fill: color, fontSize: 10, fontWeight: 600 },
          labelBgStyle: { fill: "#0d1117" },
          style: { stroke: color, strokeWidth: selEdge === id ? 2.5 : 1.25, strokeDasharray: fromDecision && !b ? "4 3" : undefined },
          markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
          selected: selEdge === id,
        });
      }
    return out;
  }, [graph, selEdge]);

  const selected = graph.nodes.find((n) => n.id === selectedId) ?? null;
  const focus = (id: string) => {
    select(id);
    setProblemsOpen(false);
    rf.fitView({ nodes: [{ id }], duration: 300, maxZoom: 1.2 });
  };
  const add = (kind: PNode["kind"]) => {
    const r = addNode(graph, kind);
    const el = wrap.current?.getBoundingClientRect();
    if (el) flow.placeAt(r.id, rf.screenToFlowPosition({ x: el.left + el.width / 3, y: el.top + el.height / 3 }));
    edit(() => r.graph);
    select(r.id);
  };

  // Popover placement: to the right of the selected node, or to its left if it won't fit.
  let pop: { left: number; top: number } | null = null;
  const rfNode = flow.nodes.find((n) => n.id === selectedId);
  if (rfNode && wrap.current) {
    const cw = wrap.current.clientWidth;
    const ch = wrap.current.clientHeight;
    const w = rfNode.measured?.width ?? W;
    const right = (rfNode.position.x + w) * vp.zoom + vp.x + 14;
    const left = right + 360 > cw ? rfNode.position.x * vp.zoom + vp.x - 360 - 14 : right;
    pop = { left: Math.max(8, Math.min(left, cw - 368)), top: Math.max(56, Math.min(rfNode.position.y * vp.zoom + vp.y - 24, ch - 300)) };
  }
  const errors = issues.filter((i) => i.severity === "error").length;

  return (
    <div className="absolute inset-0 flex flex-col">
      {/* toolbar */}
      <div className="h-11 shrink-0 px-3 border-b border-[#30363d] bg-[#161b22] flex items-center gap-2">
        <span className="text-[11px] text-[#6e7681] shrink-0">Add</span>
        <div className="flex gap-1 overflow-x-auto min-w-0">
          {KINDS.map((k) => {
            const m = KIND_META[k];
            return (
              <button key={k} type="button" title={m.blurb} onClick={() => add(k)} className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-full border border-[#30363d] text-[11px] text-[#c9d1d9] hover:border-[#58a6ff]">
                <m.icon className="w-3 h-3" style={{ color: m.color }} />
                {m.label}
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <button type="button" onClick={() => flow.relayout()} aria-label="Auto layout" title="Auto layout" className="p-1.5 rounded-md border border-[#30363d] text-[#8b949e] hover:text-white">
            <LayoutGrid className="w-3.5 h-3.5" />
          </button>
          <div className="relative">
            <button
              type="button"
              aria-expanded={problemsOpen}
              aria-controls="b-problems"
              onClick={() => setProblemsOpen((o) => !o)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs ${
                errors ? "border-[#f85149]/50 bg-[#f85149]/10 text-[#ff7b72]" : issues.length ? "border-[#d29922]/50 text-[#e3b341]" : "border-[#238636]/50 text-[#3fb950]"
              }`}
            >
              {issues.length ? <CircleAlert className="w-3.5 h-3.5" /> : null}
              {issues.length ? `${issues.length} problem${issues.length === 1 ? "" : "s"}` : "Valid"}
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
            {problemsOpen && (
              <ul id="b-problems" className="absolute right-0 top-9 z-30 w-[420px] max-h-80 overflow-y-auto rounded-lg border border-[#30363d] bg-[#161b22] shadow-2xl py-1">
                {issues.length === 0 && <li className="px-3 py-2 text-xs text-[#3fb950]">No problems.</li>}
                {issues.map((i) => (
                  <li key={i.key}>
                    <button type="button" disabled={!i.nodeId} onClick={() => i.nodeId && focus(i.nodeId)} className="w-full px-3 py-1.5 text-left text-xs hover:bg-[#21262d] flex gap-2">
                      {i.severity === "error" ? <CircleAlert className="w-3.5 h-3.5 mt-px text-[#ff7b72] shrink-0" /> : <TriangleAlert className="w-3.5 h-3.5 mt-px text-[#e3b341] shrink-0" />}
                      <span>
                        <span className="font-mono text-white">{i.nodeId ?? "graph"}</span>
                        {i.field && <span className="font-mono text-[#6e7681]"> · {i.field}</span>}
                        <span className="block text-[#8b949e]">{i.message}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
      <div ref={wrap} className="flex-1 min-h-0 relative">
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
            setProblemsOpen(false);
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
          <Background gap={16} size={1} color="#1c2128" />
          <MiniMap pannable zoomable nodeColor={(n) => KIND_META[(n.data as BData).node.kind].color} maskColor="rgba(1,4,9,0.7)" />
        </ReactFlow>
        {selected && pop && (
          <PopoverInspector
            key={selected.id}
            style={pop}
            node={selected}
            graph={graph}
            issues={byNode.get(selected.id) ?? []}
            edit={edit}
            onClose={() => select(null)}
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
        )}
        <p className="absolute left-3 bottom-3 z-10 text-[10px] text-[#6e7681] pointer-events-none">
          Draw plain edges. Out of a decision they stay amber until you pick then or else in its inspector.
        </p>
      </div>
    </div>
  );
};

type Pane = "settings" | "data" | "links";

const PopoverInspector: FC<{
  style: { left: number; top: number };
  node: PNode;
  graph: VariantProps["graph"];
  issues: Issue[];
  edit: VariantProps["edit"];
  onClose: () => void;
  onDelete: () => void;
  onRename: (to: string) => void;
}> = ({ style, node, graph, issues, edit, onClose, onDelete, onRename }) => {
  const [pane, setPane] = useState<Pane>("settings");
  const meta = KIND_META[node.kind];
  const usedBy = graph.nodes.filter((x) => x.dependsOn.includes(node.id)).map((x) => x.id);
  const count = (p: Pane) =>
    issues.filter((i) => (p === "data" ? i.field?.endsWith("Schema") : p === "links" ? i.field === "dependsOn" || !i.field : i.field && !i.field.endsWith("Schema") && i.field !== "dependsOn")).length;
  return (
    <div role="dialog" aria-label={`Edit ${node.id}`} style={style} className="absolute z-20 w-[360px] max-h-[75%] flex flex-col rounded-xl border border-[#30363d] bg-[#161b22]/98 shadow-[0_12px_40px_rgba(0,0,0,0.55)]">
      <div className="px-3 pt-2.5 pb-2 flex items-center gap-2 border-b border-[#30363d]">
        <meta.icon className="w-4 h-4" style={{ color: meta.color }} />
        <span className="text-xs font-semibold" style={{ color: meta.color }}>
          {node.kind}
        </span>
        <span className="font-mono text-xs text-white truncate">{node.id}</span>
        <button type="button" aria-label={`Delete ${node.id}`} onClick={onDelete} className="ml-auto p-1 rounded text-[#8b949e] hover:text-[#ff7b72]">
          <Trash className="w-3.5 h-3.5" />
        </button>
        <button type="button" aria-label="Close inspector" onClick={onClose} className="p-1 rounded text-[#8b949e] hover:text-white">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="px-3 pt-2 flex gap-1">
        {(["settings", "data", "links"] as const).map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={pane === p}
            onClick={() => setPane(p)}
            className={`px-2 py-0.5 rounded-md text-[11px] capitalize ${pane === p ? "bg-[#30363d] text-white" : "text-[#8b949e] hover:text-white"}`}
          >
            {p}
            {count(p) > 0 && <span className="ml-1 text-[#ff7b72]">•{count(p)}</span>}
          </button>
        ))}
      </div>
      <div className="p-3 space-y-3 overflow-y-auto">
        {pane === "settings" && (
          <>
            <IdField node={node} issues={issues} onRename={onRename} />
            <ConfigForm node={node} graph={graph} issues={issues} edit={edit} />
          </>
        )}
        {pane === "data" && (
          <>
            <FieldTableSchemaEditor key={`${node.id}-in`} label="inputSchema" value={node.inputSchema} onChange={(v) => edit((g) => setSchema(g, node.id, "inputSchema", v))} />
            <FieldTableSchemaEditor key={`${node.id}-out`} label="outputSchema" value={node.outputSchema} onChange={(v) => edit((g) => setSchema(g, node.id, "outputSchema", v))} />
          </>
        )}
        {pane === "links" && (
          <>
            <FieldIssues issues={issues.map((i) => (i.field ? i : { ...i, field: "_" }))} field="_" />
            <DependsOnEditor node={node} graph={graph} issues={issues} edit={edit} />
            <div>
              <span className="block text-[11px] font-medium text-[#8b949e] mb-1">Used by</span>
              <p className="text-[11px] font-mono text-[#c9d1d9]">{usedBy.length ? usedBy.join(", ") : <span className="text-[#6e7681] font-sans">nothing</span>}</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
