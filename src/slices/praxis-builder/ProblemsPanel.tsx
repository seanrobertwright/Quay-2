// The collapsible Problems list under the canvas (#226): every validation issue with its node,
// field, message and code. Choosing an issue on a node selects that node and zooms to it.
import { useId, type FC, type ReactNode } from "react";
import { ChevronDown, ChevronRight, LoaderCircle } from "lucide-react";
import { SeverityIcon } from "./ConfigForms.tsx";
import { issueField, problemCounts, withKeys } from "./issues.ts";
import type { Diagnostic, ValidationStatus } from "./types.ts";

interface ProblemsPanelProps {
  status: ValidationStatus;
  expanded: boolean;
  onToggle: () => void;
  /** Ids of the nodes drawn on the canvas; issues on other nodes can't be zoomed to. */
  nodeIds: ReadonlySet<string>;
  onSelectNode: (nodeId: string) => void;
  /** A panel shown beside the list, such as a graph's Run context (#223). */
  beside?: ReactNode;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function summary(status: ValidationStatus): string {
  if (status.state === "checking") return "Checking…";
  if (status.state === "failed") return "Couldn't check this graph";
  const { errors, warnings, info } = problemCounts(status.validation);
  if (errors === 0 && warnings === 0 && info === 0) return "No problems";
  const parts = [];
  if (errors > 0) parts.push(plural(errors, "error", "errors"));
  if (warnings > 0) parts.push(plural(warnings, "warning", "warnings"));
  if (info > 0) parts.push(`${info} info`);
  return parts.join(", ");
}

const rowGrid = "grid grid-cols-[minmax(6rem,1fr)_minmax(6rem,1fr)_minmax(12rem,4fr)_minmax(8rem,1fr)] gap-3";

export const ProblemsPanel: FC<ProblemsPanelProps> = ({ status, expanded, onToggle, nodeIds, onSelectNode, beside }) => {
  const listId = useId();
  const validation = status.state === "done" ? status.validation : null;
  const diagnostics = validation?.diagnostics ?? [];
  const omitted = validation ? validation.omitted.errors + validation.omitted.warnings + validation.omitted.info : 0;
  const counts = validation ? problemCounts(validation) : null;
  const tone =
    status.state === "failed" || (counts?.errors ?? 0) > 0 ? "text-[#ff7b72]" : (counts?.warnings ?? 0) > 0 ? "text-[#e3b341]" : "text-[#8b949e]";

  return (
    // A sibling of the canvas box, never an overlay, so nothing drawn on the canvas (such as
    // the palette strip) can cover it. Capped at 40% of the height so the canvas keeps the rest.
    <div className="shrink-0 max-h-[40%] flex border-t border-[#30363d] bg-[#0d1117]">
      <section aria-label="Problems" className="flex-1 min-w-0 min-h-0 flex flex-col">
        <div className="shrink-0 h-7 flex items-center text-[11px]">
          <h3 className="h-full">
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={listId}
              onClick={onToggle}
              className="h-full pl-3 pr-1.5 flex items-center gap-1.5 hover:bg-[#161b22] font-semibold uppercase tracking-wider text-[10px] text-[#8b949e]"
            >
              {expanded ? (
                <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              Problems
            </button>
          </h3>
          <p
            role="status"
            className={`ml-1 inline-flex items-center gap-1 ${tone}`}
          >
            {status.state === "checking" && (
              <LoaderCircle className="w-3 h-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            )}
            {summary(status)}
          </p>
        </div>
        <div id={listId} hidden={!expanded} className="min-h-0 overflow-y-auto">
          {status.state === "failed" && (
            <p role="alert" className="px-3 pb-2 text-[11px] text-[#ff7b72] break-words">
              {status.error}
            </p>
          )}
          {diagnostics.length > 0 && (
            <>
              <div aria-hidden="true" className={`${rowGrid} px-3 py-1 text-[10px] uppercase tracking-wider text-[#6e7681] border-b border-[#21262d]`}>
                <span>Node</span>
                <span>Field</span>
                <span>Message</span>
                <span>Code</span>
              </div>
              <ul>
                {withKeys(diagnostics).map(([key, d]) => (
                  <li key={key}>
                    <ProblemRow diagnostic={d} canSelect={d.nodeId !== undefined && nodeIds.has(d.nodeId)} onSelectNode={onSelectNode} />
                  </li>
                ))}
              </ul>
              {omitted > 0 && (
                <p className="px-3 py-1 text-[10px] text-[#e3b341]">
                  Showing the first {diagnostics.length} of {diagnostics.length + omitted} problems.
                </p>
              )}
            </>
          )}
        </div>
      </section>
      {beside}
    </div>
  );
};

const ProblemRow: FC<{ diagnostic: Diagnostic; canSelect: boolean; onSelectNode: (nodeId: string) => void }> = ({
  diagnostic: d,
  canSelect,
  onSelectNode,
}) => {
  const cells = (
    <>
      <span className="flex items-center gap-1.5 min-w-0">
        <SeverityIcon severity={d.severity} className="w-3.5 h-3.5 shrink-0" />
        <span className={`truncate font-mono ${d.nodeId === undefined ? "text-[#8b949e] italic" : ""}`}>
          {d.nodeId ?? "graph"}
        </span>
      </span>
      <span className="truncate font-mono text-[#8b949e]" title={issueField(d)}>
        {issueField(d)}
      </span>
      <span className="break-words text-[#c9d1d9]">{d.message}</span>
      <span className="truncate font-mono text-[#8b949e]" title={d.code}>
        {d.code}
      </span>
    </>
  );
  const className = `${rowGrid} w-full px-3 py-1 text-left text-[11px] items-start`;
  if (!canSelect || d.nodeId === undefined) return <div className={className}>{cells}</div>;
  const nodeId = d.nodeId;
  return (
    <button
      type="button"
      onClick={() => onSelectNode(nodeId)}
      title={`Select and zoom to ${nodeId}`}
      className={`${className} hover:bg-[#161b22] focus-visible:bg-[#161b22] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#58a6ff] focus-visible:-outline-offset-2`}
    >
      {cells}
    </button>
  );
};
