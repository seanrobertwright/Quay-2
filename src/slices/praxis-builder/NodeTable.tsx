// A graph run's node table (#569): a row for each node of the run's view, with its id, kind, node
// phase and counter line, behind a Nodes toggle that states the node count, and a problem line for
// each node entry the table can't show. A view with no `nodes[]` list gets one line saying the
// host doesn't report node phases instead; an empty list gets an empty table. It is fed by the
// detail's own read of the run, so it updates on the detail's poll and never reads the host
// itself. Each phase chip is NodePhaseChip.tsx's, and always shows the phase's text. The detail
// holds whether it is open, so it can open it when the run canvas's revision can't be read, or is
// read but can't be drawn (#571), or Quay can't tell which revision the run runs (#579).
//
// Each row's node id is a button that selects the node (#572), which the detail shares with the
// run canvas and shows in the node panel, so Tab and Enter or Space select a node from the
// keyboard. The selected row is marked by its fill and its id's weight and underline, and its
// button is the current one to a screen reader.
import { useId, type FC } from "react";
import { ChevronDown, ChevronRight, TriangleAlert } from "lucide-react";
import type { GraphRunNodes } from "./graphRunDetail.ts";
import { NodePhaseChip } from "./NodePhaseChip.tsx";
import { BUTTON } from "./RunDetail.tsx";

interface NodeTableProps {
  nodes: GraphRunNodes;
  /** Whether the table is open: it is collapsed behind its toggle until the toggle or the detail opens it. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The id of the selected node, or null when none is. */
  selected: string | null;
  /** Selects node `nodeId`, when its row is chosen. */
  onSelect: (nodeId: string) => void;
}

/** The button in node `nodeId`'s row in `root`, which selects the node; null when no node table there shows a row for it. */
export const rowOf = (root: ParentNode, nodeId: string): HTMLElement | null =>
  [...root.querySelectorAll<HTMLElement>("button[data-node-id]")].find((b) => b.dataset.nodeId === nodeId) ?? null;

/** The node table's Nodes toggle in `root`, or null when there is none, as for a host that doesn't report node phases. */
export const nodesToggleOf = (root: ParentNode): HTMLElement | null => root.querySelector<HTMLElement>("button[data-nodes-toggle]");

/** The node table of a graph run. */
export const NodeTable: FC<NodeTableProps> = ({ nodes, open, onOpenChange, selected, onSelect }) => {
  const tableId = useId();
  if (!nodes.reported) return <p className="text-[11px] text-[#8b949e]">This host doesn&apos;t report node phases.</p>;
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div className="space-y-1.5 text-[11px] text-[#c9d1d9]">
      <button type="button" data-nodes-toggle aria-expanded={open} aria-controls={open ? tableId : undefined} onClick={() => onOpenChange(!open)} className={BUTTON}>
        <Chevron className="w-3.5 h-3.5" aria-hidden="true" />
        Nodes ({nodes.rows.length})
      </button>
      {nodes.problems.length > 0 && (
        <ul aria-label="Node problems" className="space-y-0.5 text-[#f85149]">
          {nodes.problems.map((problem, n) => (
            <li key={n} className="flex items-start gap-1.5">
              <TriangleAlert className="w-3.5 h-3.5 mt-px shrink-0" aria-hidden="true" />
              {problem}
            </li>
          ))}
        </ul>
      )}
      {open && (
        <table id={tableId} aria-label="Nodes" className="w-full text-left">
          <thead className="text-[10px] uppercase tracking-wider text-[#6e7681]">
            <tr>
              <th scope="col" className="py-1 pr-3 font-semibold">
                Node
              </th>
              <th scope="col" className="py-1 pr-3 font-semibold">
                Kind
              </th>
              <th scope="col" className="py-1 pr-3 font-semibold">
                Phase
              </th>
              <th scope="col" className="py-1 font-semibold">
                Counter
              </th>
            </tr>
          </thead>
          <tbody>
            {nodes.rows.map((node, n) => {
              const isSelected = node.nodeId === selected;
              return (
                <tr key={`${n}:${node.nodeId}`} className={`border-t border-[#21262d] ${isSelected ? "bg-[#58a6ff]/10" : ""}`}>
                  <th scope="row" className="py-1 pr-3 font-mono font-normal">
                    <button
                      type="button"
                      data-node-id={node.nodeId}
                      aria-current={isSelected ? "true" : undefined}
                      onClick={() => onSelect(node.nodeId)}
                      className={`underline-offset-2 hover:underline ${isSelected ? "font-semibold text-white underline" : ""}`}
                    >
                      {node.nodeId}
                    </button>
                  </th>
                  <td className="py-1 pr-3">{node.kind}</td>
                  <td className="py-1 pr-3">
                    <NodePhaseChip phase={node.phase} />
                  </td>
                  <td className="py-1 text-[#8b949e]">{node.counter}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
};
