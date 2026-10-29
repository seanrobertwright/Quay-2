// Where the cross-record checks show (#223, #269): a section on each record form, and on a
// graph the "Runs under:" chips and the collapsible Run context panel beside the Problems list.
// The checks read saved records, so they change when a record is opened or saved, not as the
// user types; they are advisory, and saving still works.
import { useId, useState, type FC } from "react";
import { ChevronDown, ChevronRight, FileText, Plus } from "lucide-react";
import { inputClass, SeverityIcon } from "./ConfigForms.tsx";
import { hintClass, Section } from "./RecordFields.tsx";
import { issuePlace, type GraphRunContext } from "./runContext.ts";
import type { DefinitionRef, PraxisKind, RecordIssue } from "./types.ts";

const linkClass = "font-mono text-[#58a6ff] hover:underline";

/** One cross-record issue: its severity, the contract whose mission found it, where it is, and what it says. */
const IssueLine: FC<{ issue: RecordIssue; onOpen: (ref: DefinitionRef) => void }> = ({ issue, onOpen }) => {
  const place = issuePlace(issue);
  return (
    <li className="flex items-start gap-1.5 text-[11px]">
      <SeverityIcon severity={issue.severity} className="w-3.5 h-3.5 mt-px shrink-0" />
      <span className="break-words min-w-0 text-[#c9d1d9]">
        {issue.contract !== "" && (
          <>
            <button type="button" onClick={() => onOpen({ kind: "contracts", id: issue.contract })} className={linkClass}>
              {issue.contract}
            </button>
            {": "}
          </>
        )}
        {place && <span className="font-mono text-[#8b949e]">{place}: </span>}
        {issue.message} <span className="font-mono text-[#6e7681]">{issue.code}</span>
      </span>
    </li>
  );
};

/** What a form shows of its record's cross-record issues, as a section of its own. */
export const CrossRecordSection: FC<{
  issues: readonly RecordIssue[];
  /** Whether a check across the project's records has come back. */
  checked: boolean;
  error: string | null;
  onOpen: (ref: DefinitionRef) => void;
}> = ({ issues, checked, error, onOpen }) => (
  <Section title="Across records">
    {error !== null ? (
      <p role="alert" className="text-xs text-[#ff7b72] break-words">
        Couldn&apos;t check across records: {error}
      </p>
    ) : !checked ? (
      <p className="text-xs text-[#6e7681]">Checking across records…</p>
    ) : issues.length === 0 ? (
      <p className="text-xs text-[#6e7681]">No issues on the missions of the contracts this record belongs to.</p>
    ) : (
      <ul className="space-y-1">
        {issues.map((i) => (
          <IssueLine key={`${i.contract}|${i.path}|${i.code}|${i.message}`} issue={i} onOpen={onOpen} />
        ))}
      </ul>
    )}
    <p className={hintClass}>
      Each contract&apos;s mission is opened from the saved records, so this changes when a record is opened or saved. It doesn&apos;t stop a save.
    </p>
  </Section>
);

/** A graph's "Runs under:" chips, one per contract whose bindings list it, each opening that contract. */
export const RunsUnder: FC<{ run: GraphRunContext; onOpen: (ref: DefinitionRef) => void }> = ({ run, onOpen }) => {
  if (run.contracts.length === 0) return null;
  return (
    <div className="shrink-0 px-4 py-1 flex flex-wrap items-center gap-1.5 text-[11px] border-b border-[#30363d] bg-[#161b22]">
      <span className="text-[#8b949e]">Runs under:</span>
      {run.contracts.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onOpen({ kind: "contracts", id: c.id })}
          title={`Open contract ${c.id}`}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border border-[#30363d] bg-[#21262d] hover:bg-[#30363d] font-mono text-[#c9d1d9]"
        >
          <FileText className="w-3 h-3 text-[#8b949e]" aria-hidden="true" />
          {c.id}
        </button>
      ))}
    </div>
  );
};

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/** A run of record links under a label, or "none". */
const Links: FC<{ label: string; kind: PraxisKind; ids: readonly string[]; onOpen: (ref: DefinitionRef) => void }> = ({
  label,
  kind,
  ids,
  onOpen,
}) => (
  <p className="text-[11px] text-[#8b949e] break-words">
    {label}:{" "}
    {ids.length === 0
      ? "none"
      : ids.map((id, i) => (
          <span key={id}>
            {i > 0 && ", "}
            <button type="button" onClick={() => onOpen({ kind, id })} className={linkClass}>
              {id}
            </button>
          </span>
        ))}
  </p>
);

/**
 * The Run context panel beside the Problems list (#223): each contract the graph runs under,
 * with its grants and triggers as links, and the graph's cross-record issues. A graph no
 * contract binds gets a shortcut that adds it to one.
 */
export const RunContextPanel: FC<{
  graphId: string;
  run: GraphRunContext;
  checked: boolean;
  error: string | null;
  unchecked: readonly string[];
  /** The ids of the project's contracts, for the shortcut that binds the graph to one. */
  contracts: readonly string[];
  expanded: boolean;
  onToggle: () => void;
  onOpen: (ref: DefinitionRef) => void;
  onAddToContract: (contractId: string) => void;
}> = ({ graphId, run, checked, error, unchecked, contracts, expanded, onToggle, onOpen, onAddToContract }) => {
  const bodyId = useId();
  const pickerId = useId();
  const errors = run.issues.filter((i) => i.severity === "error").length;
  const summary =
    error !== null
      ? "Couldn't check"
      : !checked
        ? "Checking…"
        : run.contracts.length === 0
          ? "No contract"
          : `${plural(run.contracts.length, "contract")}${errors > 0 ? `, ${plural(errors, "issue")}` : ""}`;
  const unbound = checked && run.contracts.length === 0;
  return (
    <section
      aria-label="Run context"
      className={`${expanded ? "w-[30%] min-w-56 max-w-80" : ""} shrink-0 min-h-0 flex flex-col border-l border-[#30363d] bg-[#0d1117]`}
    >
      <div className="shrink-0 h-7 flex items-center text-[11px]">
        <h3 className="h-full">
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={bodyId}
            onClick={onToggle}
            className="h-full pl-3 pr-1.5 flex items-center gap-1.5 hover:bg-[#161b22] font-semibold uppercase tracking-wider text-[10px] text-[#8b949e]"
          >
            {expanded ? <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" /> : <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />}
            Run context
          </button>
        </h3>
        <p role="status" className={`ml-1 pr-3 truncate ${error !== null || errors > 0 ? "text-[#ff7b72]" : "text-[#8b949e]"}`}>
          {summary}
        </p>
      </div>
      <div id={bodyId} hidden={!expanded} className="min-h-0 overflow-y-auto px-3 pb-2 space-y-3">
        {error !== null && (
          <p role="alert" className="text-[11px] text-[#ff7b72] break-words">
            {error}
          </p>
        )}
        {run.contracts.map((c) => (
          <div key={c.id} className="space-y-0.5">
            <button type="button" onClick={() => onOpen({ kind: "contracts", id: c.id })} className={`${linkClass} text-xs`}>
              {c.id}
            </button>
            <Links label="Grants" kind="grants" ids={c.grants} onOpen={onOpen} />
            <Links label="Triggers" kind="triggers" ids={c.triggers} onOpen={onOpen} />
          </div>
        ))}
        {run.issues.length > 0 && (
          <ul aria-label={`Cross-record issues of ${graphId}`} className="space-y-1">
            {run.issues.map((i) => (
              <IssueLine key={`${i.contract}|${i.path}|${i.code}|${i.message}`} issue={i} onOpen={onOpen} />
            ))}
          </ul>
        )}
        {unbound && <AddToContract pickerId={pickerId} contracts={contracts} onAdd={onAddToContract} />}
        {unchecked.length > 0 && (
          <ul className="space-y-0.5">
            {/* Each line names a different file, so it is its own key. */}
            {unchecked.map((line) => (
              <li key={line} className="text-[11px] text-[#e3b341] break-words">
                Not checked: {line}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
};

/** The shortcut for a graph no contract binds: pick a contract, which opens with the graph added to its Graphs. */
const AddToContract: FC<{ pickerId: string; contracts: readonly string[]; onAdd: (contractId: string) => void }> = ({
  pickerId,
  contracts,
  onAdd,
}) => {
  const [chosen, setChosen] = useState("");
  const value = contracts.includes(chosen) ? chosen : (contracts[0] ?? "");
  if (contracts.length === 0) {
    return <p className={hintClass}>The project has no contracts yet. Make one from New, then bind this graph from its Graphs section.</p>;
  }
  return (
    <div>
      <label htmlFor={pickerId} className="block text-[11px] text-[#8b949e] mb-1">
        Add this graph to a contract
      </label>
      <div className="flex gap-2">
        <select id={pickerId} value={value} onChange={(e) => setChosen(e.target.value)} className={`${inputClass} font-mono`}>
          {contracts.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => onAdd(value)}
          className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-xs"
        >
          <Plus className="w-3 h-3" aria-hidden="true" />
          Add
        </button>
      </div>
      <p className={hintClass}>The contract opens with this graph added to its Graphs. Save the contract to keep it.</p>
    </div>
  );
};
