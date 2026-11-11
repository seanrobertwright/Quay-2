// Throwaway screenshot harness for ticket 585. Never committed.
import { useEffect, useState, type FC } from "react";
import { createRoot } from "react-dom/client";
import { Background, ReactFlow, ReactFlowProvider, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./index.css";
import { NODE_FOCUS_CLASS, NodeCard } from "./slices/praxis-builder/NodeCard.tsx";
import { NodePhaseChip, phaseFrame } from "./slices/praxis-builder/NodePhaseChip.tsx";
import { RunCanvas } from "./slices/praxis-builder/RunCanvas.tsx";
import type { RevisionCache } from "./slices/praxis-builder/graphRevision.ts";
import type { GraphRunNode } from "./slices/praxis-builder/graphRunDetail.ts";
import type { PraxisGraph, PraxisNode } from "./slices/praxis-builder/model.ts";

const params = new URLSearchParams(location.search);

const TONES: [string, string | null][] = [
  ["ok", "COMPLETED"],
  ["error", "FAILED"],
  ["amber", "HELD"],
  ["active", "RUNNING"],
  ["neutral", "READY"],
  ["no-state", null],
];

// ---- explore: candidate marks, drawn the way RunCard draws a card ----

const VARIANTS: Record<string, string> = {
  V0: "ring-2 ring-[#58a6ff]",
  V1: "ring-2 ring-[#f0f6fc]",
  V2: "ring-2 ring-[#f0f6fc] ring-offset-2 ring-offset-[#141414]",
  V3: "ring-2 ring-[#f0f6fc] ring-offset-1 ring-offset-[#141414]",
  V4: "ring-2 ring-inset ring-[#f0f6fc]",
  V5: "ring-[3px] ring-[#f0f6fc]",
};
/** NODE_FOCUS_CLASS as it draws while the card has keyboard focus. */
const FOCUS_SHOWN = "rounded-lg outline-2 outline-offset-4 outline-[#f0f6fc]";

interface ExploreData extends Record<string, unknown> {
  node: PraxisNode;
  phase: string | null;
  mark: string | null;
}

const ExploreCard: FC<NodeProps<Node<ExploreData>>> = ({ data }) => {
  const frame = data.phase === null ? "border-dashed border-[#30363d]" : phaseFrame(data.phase);
  const footer =
    data.phase === null ? <span className="italic text-[#8b949e]">no state reported</span> : <span className="text-[#8b949e]">Attempts: 1 of 2</span>;
  return (
    <NodeCard node={data.node} frame={data.mark ? `${frame} ${data.mark}` : frame} connectable={false} footer={footer}>
      {data.phase !== null && (
        <span className="absolute -top-3 right-2 rounded-full bg-[#161b22]">
          <NodePhaseChip phase={data.phase} />
        </span>
      )}
    </NodeCard>
  );
};
const EXPLORE_TYPES = { card: ExploreCard };

const ROWS = [
  ["plain", false, false],
  ["selected", true, false],
  ["focused", false, true],
  ["sel+focus", true, true],
] as const;

const Explore: FC<{ variant: string; zoom: number }> = ({ variant, zoom }) => {
  const mark = VARIANTS[variant];
  const nodes: Node<ExploreData>[] = ROWS.flatMap(([row, selected, focused], r) =>
    TONES.map(([tone, phase], c) => ({
      id: `${tone}-${row}`,
      type: "card",
      position: { x: c * 260, y: r * 130 },
      className: focused ? FOCUS_SHOWN : NODE_FOCUS_CLASS,
      data: { node: { id: `${tone} ${row}`, kind: "TASK", dependsOn: [], config: { executionKind: "AGENT" } }, phase, mark: selected ? mark : null },
    }))
  );
  return (
    <div>
      <p className="text-white text-sm p-1">
        {variant}: <code>{mark}</code> at zoom {zoom}
      </p>
      <div style={{ width: 1600 * zoom + 40, height: 540 * zoom + 40 }} className="border border-[#30363d]">
        <ReactFlowProvider>
          <ReactFlow
            nodes={nodes}
            edges={[]}
            nodeTypes={EXPLORE_TYPES}
            colorMode="dark"
            defaultViewport={{ x: 20, y: 30, zoom }}
            minZoom={0.2}
            nodesDraggable={false}
            elementsSelectable={false}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={20} color="#21262d" />
          </ReactFlow>
        </ReactFlowProvider>
      </div>
    </div>
  );
};

// ---- real: the run canvas itself, one per tone, its second card selected ----

const node = (id: string, dependsOn: string[] = []): PraxisNode => ({ id, kind: "TASK", dependsOn, config: { executionKind: "AGENT" } });

function realCanvas(tone: string, phase: string | null) {
  const graph: PraxisGraph = { id: `g-${tone}`, revision: "1", nodes: [node("unselected"), node("selected", ["unselected"])] };
  const revisions: RevisionCache = { read: () => Promise.resolve({ kind: "graph", graph }) };
  const runNode = (nodeId: string): GraphRunNode => ({ nodeId, kind: "TASK", phase: phase ?? "", counter: "Attempts: 1 of 2", holdId: null, facts: [] });
  const nodes = phase === null ? [] : [runNode("unselected"), runNode("selected")];
  return { tone, revisions, nodes };
}
const REAL = TONES.map(([tone, phase]) => realCanvas(tone, phase));

const Real: FC<{ focus: string | null }> = ({ focus }) => {
  const [selected, setSelected] = useState<Record<string, string | null>>(() => Object.fromEntries(REAL.map((c) => [c.tone, "selected"])));
  useEffect(() => {
    if (focus === null) return;
    const [tone, nodeId] = focus.split(":");
    const timer = setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-tone-canvas="${tone}"] .react-flow__node[data-id="${nodeId}"]`);
      el?.focus();
      document.title = el ? `focused ${focus}` : `no ${focus}`;
    }, 1500);
    return () => clearTimeout(timer);
  }, [focus]);
  return (
    <div className="flex gap-3 p-3">
      {REAL.map((c) => (
        <div key={c.tone} data-tone-canvas={c.tone} className="w-[300px] shrink-0">
          <RunCanvas
            projectPath="C:/demo"
            workflow="demo"
            revision={1}
            runName={c.tone}
            nodes={c.nodes}
            revisions={c.revisions}
            onUnreadable={() => {}}
            selected={selected[c.tone]}
            onSelect={(id) => setSelected((now) => ({ ...now, [c.tone]: id }))}
          />
        </div>
      ))}
    </div>
  );
};

const mode = params.get("mode") ?? "real";
createRoot(document.getElementById("root") as HTMLElement).render(
  mode === "explore" ? <Explore variant={params.get("variant") ?? "V1"} zoom={Number(params.get("zoom") ?? "1")} /> : <Real focus={params.get("focus")} />
);
