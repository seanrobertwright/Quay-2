// The collapsible Problems list under the canvas (#226): every validation issue with its node,
// field, message and code. Choosing an issue on a node selects that node and zooms to it.
import { useId, type FC } from "react";
import { ChevronDown, ChevronRight, CircleAlert, Info, LoaderCircle } from "lucide-react";
import { issueField, problemCounts } from "./issues.ts";
import type { Diagnostic, Validation } from "./types.ts";

export type ValidationStatus =
  | { state: "checking" }
  | { state: "failed"; error: string }
  | { state: "done"; validation: Validation };

interface ProblemsPanelProps {
  status: ValidationStatus;
  expanded: boolean;
  onToggle: () => void;
  /** Ids of the nodes drawn on the canvas; issues on other nodes can't be zoomed to. */
  nodeIds: ReadonlySet<string>;
  onSelectNode: (nodeId: string) => void;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function summary(status: ValidationStatus): string {
  if (status.state === "checking") return "Checking…";
  if (status.state === "failed") return "Couldn't check this graph";
  const { errors, info } = problemCounts(status.validation);
  if (errors === 0 && info === 0) return "No problems";
  const parts = [];
  if (errors > 0) parts.push(plural(errors, "error", "errors"));
  if (info > 0) parts.push(`${info} info`);
  return parts.join(", ");
}

/** A stable key per diagnostic from what it says, numbered when two say the same thing. */
function withKeys(diagnostics: readonly Diagnostic[]): [string, Diagnostic][] {
  const seen = new Map<string, number>();
  return diagnostics.map((d) => {
    const base = `${d.code}|${d.path}|${d.message}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return [n === 0 ? base : `${base}|${n}`, d];
  });
}

const rowGrid = "grid grid-cols-[minmax(6rem,1fr)_minmax(6rem,1fr)_minmax(12rem,4fr)_minmax(8rem,1fr)] gap-3";

export const ProblemsPanel: FC<ProblemsPanelProps> = ({ status, expanded, onToggle, nodeIds, onSelectNode }) => {
  const listId = useId();
  const validation = status.state === "done" ? status.validation : null;
  const diagnostics = validation?.diagnostics ?? [];
  const omitted = validation ? validation.omitted.errors + validation.omitted.info : 0;
  const hasErrors = validation !== null && problemCounts(validation).errors > 0;

  return (
    // A sibling of the canvas box, never an overlay, so nothing drawn on the canvas (such as
    // the palette strip) can cover it. Capped at 40% of the height so the canvas keeps the rest.
    <section aria-label="Problems" className="shrink-0 max-h-[40%] flex flex-col border-t border-[#30363d] bg-[#0d1117]">
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
          className={`ml-1 inline-flex items-center gap-1 ${
            status.state === "failed" || hasErrors ? "text-[#ff7b72]" : "text-[#8b949e]"
          }`}
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
  );
};

const ProblemRow: FC<{ diagnostic: Diagnostic; canSelect: boolean; onSelectNode: (nodeId: string) => void }> = ({
  diagnostic: d,
  canSelect,
  onSelectNode,
}) => {
  const Icon = d.severity === "error" ? CircleAlert : Info;
  const cells = (
    <>
      <span className="flex items-center gap-1.5 min-w-0">
        <Icon
          role="img"
          className={`w-3.5 h-3.5 shrink-0 ${d.severity === "error" ? "text-[#ff7b72]" : "text-[#58a6ff]"}`}
          aria-label={d.severity === "error" ? "Error" : "Info"}
        />
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
