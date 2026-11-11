// The card a graph's node is drawn as, #226's variant A: its kind, its id and its config summary,
// with a handle at the top for what it depends on and one at the bottom for what depends on it, or
// for a DECISION its then and else branches and its other dependents. The graph canvas
// (GraphCanvas.tsx) draws it with its problem count and binding mark, and the run canvas
// (RunCanvas.tsx) with its node phase and counter line. Both draw it at the same size, the layout's
// width (flow/layout.ts) and one height, so a saved layout places the cards of either: what each
// adds is drawn over the card's edges, or as its footer, in the place of its bottom padding. Each
// canvas reads the node a card is for, such as one a key was pressed on, with `cardNodeId`.
import type { FC, ReactNode } from "react";
import { Handle, Position } from "@xyflow/react";
import { EDGE_COLOR } from "./flow/to-flow.ts";
import { NODE_WIDTH } from "./flow/layout.ts";
import { configSummary, nodeKindMeta, UNKNOWN_KIND_META } from "./kinds.ts";
import type { PraxisNode } from "./model.ts";

const HANDLE = "!w-2.5 !h-2.5 !border-2 !border-[#0d1117]";

/** The ring a card shows while it has keyboard focus. */
export const NODE_FOCUS_CLASS = "rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#f0f6fc]";

/** The node id of `target` when it is a card, which React Flow draws with its node's id as `data-id`; else null. */
export const cardNodeId = (target: unknown): string | null =>
  target instanceof Element && target.classList.contains("react-flow__node") ? target.getAttribute("data-id") : null;

interface NodeCardProps {
  node: PraxisNode;
  /** The classes of the card's border on its sides and bottom, and any ring: its top is the kind's colour. */
  frame: string;
  /**
   * Whether a drag from a handle connects nodes. Its bottom handles then show a crosshair; on a
   * card that connects nothing, every handle is hidden, and only anchors the edges.
   */
  connectable: boolean;
  /** A last line, of the bottom padding's height, which it replaces; none keeps the padding. */
  footer?: ReactNode;
  /** What a canvas draws over the card's edges. */
  children?: ReactNode;
}

export const NodeCard: FC<NodeCardProps> = ({ node, frame, connectable, footer, children }) => {
  const meta = nodeKindMeta(node.kind);
  const summary = configSummary(node);
  const label = meta === UNKNOWN_KIND_META ? node.kind || "No kind" : meta.label;
  const target = connectable ? HANDLE : `${HANDLE} !opacity-0`;
  const source = connectable ? `${HANDLE} !cursor-crosshair` : target;
  return (
    <div className={`relative rounded-lg border bg-[#161b22] shadow-md ${frame}`} style={{ width: NODE_WIDTH, borderTop: `3px solid ${meta.color}` }}>
      {children}
      <Handle type="target" position={Position.Top} className={target} style={{ background: EDGE_COLOR.plain }} />
      <div
        className="flex items-center gap-1.5 px-2.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wider"
        style={{ color: meta.color }}
      >
        <meta.icon className="w-3.5 h-3.5" aria-hidden="true" />
        <span className="truncate">{label}</span>
        <span className="ml-auto flex gap-1 normal-case tracking-normal font-normal">
          {node.inputSchema && (
            <span className="px-1 rounded bg-[#21262d] text-[#8b949e]" title="Has an input schema">
              in
            </span>
          )}
          {node.outputSchema && (
            <span className="px-1 rounded bg-[#21262d] text-[#8b949e]" title="Has an output schema">
              out
            </span>
          )}
        </span>
      </div>
      <div className={footer === undefined ? "px-2.5 pb-3 pt-0.5" : "px-2.5 pt-0.5"}>
        <div className="font-mono text-sm text-white truncate" title={node.id}>
          {node.id}
        </div>
        <div className={`text-[11px] truncate ${summary ? "text-[#8b949e]" : "text-[#484f58] italic"}`}>
          {summary || "no settings"}
        </div>
        {footer !== undefined && <div className="h-3 text-[10px] leading-3 truncate">{footer}</div>}
      </div>
      {node.kind === "DECISION" ? (
        <>
          <Handle id="then" type="source" position={Position.Bottom} className={source} style={{ left: "30%", background: EDGE_COLOR.then }} />
          <Handle id="else" type="source" position={Position.Bottom} className={source} style={{ left: "70%", background: EDGE_COLOR.else }} />
          <Handle id="dep" type="source" position={Position.Right} className={source} style={{ background: EDGE_COLOR.plain }} />
          <span className="absolute -bottom-4 text-[9px] font-semibold text-[#3fb950]" style={{ left: "30%", transform: "translateX(-50%)" }}>
            then
          </span>
          <span className="absolute -bottom-4 text-[9px] font-semibold text-[#ff7b72]" style={{ left: "70%", transform: "translateX(-50%)" }}>
            else
          </span>
        </>
      ) : (
        <Handle type="source" position={Position.Bottom} className={source} style={{ background: EDGE_COLOR.plain }} />
      )}
    </div>
  );
};
