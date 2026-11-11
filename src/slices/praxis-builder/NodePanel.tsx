// A graph run's node panel (#572): the read-only panel beside the run canvas for the node selected
// on the run canvas or in the node table, headed with the node's id and a close button (#577),
// which clears the selection, as Escape in the panel does (GraphRunDetail.tsx). It draws only
// what the view's `nodes[]` gives of the node (graphRunDetail.ts): its kind and node phase, then
// each fact of its attempt, scope, loop, wait and human task that it has, and leaves out each it
// hasn't. A node held, or blocked by a hold, links to that hold's panel in the detail, and the
// link moves focus there. The host gives a hold card, and so a panel, only for a hold on a node's
// own scope: a hold on a grant, a branch or the run is named by its `holdId`, with no link. It
// edits nothing and offers no decision or control but its close button: approvals, acceptances,
// hold decisions and human tasks are taken in the host's browser page. It isn't the graph
// canvas's inspector. It doesn't draw a loop's history of iterations, or a human task's own
// record, which would need a second read of the host.
import { Fragment, useId, type FC, type MouseEvent, type Ref } from "react";
import { X } from "lucide-react";
import type { GraphRunNode } from "./graphRunDetail.ts";
import { NodePhaseChip } from "./NodePhaseChip.tsx";

/** A hold panel in the run's detail, which the node panel links to: its element's id, and its name. */
export interface HoldPanelLink {
  id: string;
  name: string;
}

interface NodePanelProps {
  /** The selected node's id. */
  nodeId: string;
  /** The node as the view's `nodes[]` gives it, or null when the host reports no node phase for it. */
  node: GraphRunNode | null;
  /** The hold panel of the node's hold, or null when the node has no hold, or the detail no panel for it. */
  hold: HoldPanelLink | null;
  /** Closes the panel, which clears the selection: its close button calls it. */
  onClose: () => void;
  /** The panel's element, so the detail can tell when focus is in it. */
  rootRef: Ref<HTMLElement>;
}

/** Moves focus to the hold panel `link` goes to, which scrolls it into view, in place of following the link. */
function goToHold(e: MouseEvent<HTMLAnchorElement>, link: HoldPanelLink): void {
  const panel = document.getElementById(link.id);
  if (panel === null) return;
  e.preventDefault();
  panel.focus();
}

/** The node panel of the selected node, with a heading that names it and its close button beside it. */
export const NodePanel: FC<NodePanelProps> = ({ nodeId, node, hold, onClose, rootRef }) => {
  const headingId = useId();
  return (
    <section ref={rootRef} aria-labelledby={headingId} className="w-64 shrink-0 space-y-1.5 rounded-md border border-[#30363d] p-2 text-[11px] text-[#c9d1d9]">
      <div className="flex items-start gap-2">
        <h4 id={headingId} className="min-w-0 break-words font-semibold">
          Node panel: <span className="font-mono">{nodeId}</span>
        </h4>
        <button
          type="button"
          aria-label="Close node panel"
          onClick={onClose}
          className="ml-auto shrink-0 rounded-md p-0.5 text-[#8b949e] hover:bg-[#21262d] hover:text-white"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
      {node === null ? (
        <p className="text-[#8b949e]">The host reports no node phase for this node.</p>
      ) : (
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-0.5">
          {node.kind && (
            <>
              <dt className="text-[#8b949e]">Kind</dt>
              <dd>{node.kind}</dd>
            </>
          )}
          <dt className="text-[#8b949e]">Phase</dt>
          <dd>
            <NodePhaseChip phase={node.phase} />
          </dd>
          {node.facts.map((fact) => (
            <Fragment key={fact.term}>
              <dt className="text-[#8b949e]">{fact.term}</dt>
              <dd className="break-words">{fact.value}</dd>
            </Fragment>
          ))}
          {node.holdId !== null && (
            <>
              <dt className="text-[#8b949e]">Hold</dt>
              <dd className="break-words">
                {hold === null ? (
                  <span className="font-mono">{node.holdId}</span>
                ) : (
                  <a href={`#${hold.id}`} onClick={(e) => goToHold(e, hold)} className="text-[#58a6ff] underline underline-offset-2 hover:text-[#79c0ff]">
                    {hold.name}
                  </a>
                )}
              </dd>
            </>
          )}
        </dl>
      )}
    </section>
  );
};
