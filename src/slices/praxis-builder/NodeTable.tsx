// A graph run's node table (#569): a row for each node of the run's view, with its id, kind, node
// phase and counter line, behind a Nodes toggle that states the node count, and a problem line for
// each node entry the table can't show. A view without nodes gets one line saying so instead. It is
// fed by the detail's own read of the run, so it updates on the detail's poll and never reads the
// host itself. Each phase chip takes its tone from nodePhase.ts, and always shows the phase's text.
import { useId, useState, type FC } from "react";
import { ChevronDown, ChevronRight, TriangleAlert } from "lucide-react";
import type { GraphRunNodes } from "./graphRunDetail.ts";
import { nodePhaseLook, type NodePhaseTone } from "./nodePhase.ts";

const BUTTON = "inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-[#30363d] bg-[#21262d] hover:bg-[#30363d] text-[11px] text-white";

/** A node phase chip's colours in each tone. */
const TONE_CLASSES: Record<NodePhaseTone, string> = {
  neutral: "border-[#30363d] text-[#8b949e]",
  ok: "border-[#238636]/60 text-[#3fb950]",
  error: "border-[#f85149]/60 text-[#ff7b72]",
  amber: "border-[#d29922]/70 text-[#e3b341] bg-[#d29922]/10",
  active: "border-[#58a6ff]/60 text-[#58a6ff] bg-[#58a6ff]/10",
};

/** A node's phase, verbatim, in its tone. */
export const NodePhaseChip: FC<{ phase: string }> = ({ phase }) => {
  const { tone, dimmed } = nodePhaseLook(phase);
  return (
    <span data-chip="phase" data-tone={tone} className={`px-1.5 py-px rounded-full border text-[10px] ${TONE_CLASSES[tone]} ${dimmed ? "opacity-60" : ""}`}>
      {phase}
    </span>
  );
};

/** The node table of a graph run, collapsed until its toggle opens it. */
export const NodeTable: FC<{ nodes: GraphRunNodes }> = ({ nodes }) => {
  const tableId = useId();
  const [open, setOpen] = useState(false);
  if (!nodes.reported) return <p className="text-[11px] text-[#8b949e]">This host doesn&apos;t report node phases.</p>;
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div className="space-y-1.5 text-[11px] text-[#c9d1d9]">
      <button type="button" aria-expanded={open} aria-controls={open ? tableId : undefined} onClick={() => setOpen((o) => !o)} className={BUTTON}>
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
            {nodes.rows.map((node, n) => (
              <tr key={`${n}:${node.nodeId}`} className="border-t border-[#21262d]">
                <th scope="row" className="py-1 pr-3 font-mono font-normal">
                  {node.nodeId}
                </th>
                <td className="py-1 pr-3">{node.kind}</td>
                <td className="py-1 pr-3">
                  <NodePhaseChip phase={node.phase} />
                </td>
                <td className="py-1 text-[#8b949e]">{node.counter}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};
