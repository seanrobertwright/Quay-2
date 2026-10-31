import React, { useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Filter, Highlighter, RotateCcw, X } from "lucide-react";
import { usePopupLayer } from "../../overlay/useOverlay";
import type { HighlightKind } from "./agentHighlight";
import {
  branchLabel,
  branchRef,
  filterChips,
  isRemoteRef,
  RESET,
  toggleAgent,
  toggleBranch,
  type FilterState,
} from "./graphFilters";
import type { RefBadge } from "./graphRefs";

/** Branches the dropdown lists at once; the search box narrows a longer list. */
const SHOWN_BRANCHES = 200;

export interface GraphFilterBarProps {
  state: FilterState;
  onChange: (next: FilterState) => void;
  /** The repo's refs; the dropdown lists its local branches and, while remotes show, its remote ones. */
  refs: readonly RefBadge[];
  /** The agent kinds the loaded rows hold, which the highlight offers. */
  kinds: readonly HighlightKind[];
}

const TOGGLE = "inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs";
const toggleClass = (on: boolean) =>
  `${TOGGLE} ${on ? "border-[#06B6D4]/60 bg-[#06B6D4]/10 text-white" : "border-[#30363d] text-[#8b949e] hover:text-white hover:bg-[#21262d]"}`;

/** "Human", or an agent's run kind as Quay names it. */
function kindLabel(kind: HighlightKind): string {
  if (kind === "human") return "Human";
  if (kind === "unknown") return "Unknown agent";
  return kind;
}

/**
 * The Branches dropdown (#368): a search box over checkboxes, one per branch, each adding it to or
 * taking it out of the branch filter. Branch names are untrusted and only ever rendered as text.
 */
const BranchesDropdown: React.FC<{ state: FilterState; onChange: (next: FilterState) => void; refs: readonly RefBadge[] }> = ({
  state,
  onChange,
  refs,
}) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popupId = useId();
  const searchId = useId();
  const close = (refocus: boolean) => {
    setOpen(false);
    setSearch("");
    if (refocus) buttonRef.current?.focus();
  };
  usePopupLayer(open, () => close(true), boxRef);

  const { filters } = state;
  const selected = useMemo(() => new Set(filters.branches), [filters.branches]);
  const branches = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const out: string[] = [];
    for (const r of refs) {
      const ref = branchRef(r);
      if (ref === null || (r.kind === "remote" && !filters.remotes && !selected.has(ref))) continue;
      if (needle !== "" && !r.name.toLowerCase().includes(needle)) continue;
      out.push(ref);
    }
    // Filtered branches first, then local before remote, each by name.
    return out.sort(
      (a, b) =>
        Number(selected.has(b)) - Number(selected.has(a)) ||
        Number(isRemoteRef(a)) - Number(isRemoteRef(b)) ||
        a.localeCompare(b)
    );
  }, [refs, search, filters.remotes, selected]);
  const shown = branches.slice(0, SHOWN_BRANCHES);

  return (
    <div
      ref={boxRef}
      className="relative"
      onBlur={(e) => {
        if (open && !e.currentTarget.contains(e.relatedTarget as Node | null)) close(false);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? popupId : undefined}
        aria-haspopup="dialog"
        onClick={() => (open ? close(false) : setOpen(true))}
        className={toggleClass(filters.branches.length > 0)}
      >
        <Filter className="w-3.5 h-3.5" aria-hidden="true" />
        Branches
        {filters.branches.length > 0 && <span className="tabular-nums">({filters.branches.length})</span>}
        <ChevronDown className="w-3 h-3" aria-hidden="true" />
      </button>
      {open && (
        <div
          id={popupId}
          role="dialog"
          aria-label="Show only these branches"
          className="absolute z-30 left-0 top-full mt-1 w-72 p-2 flex flex-col gap-2 rounded border border-[#30363d] bg-[#161b22] shadow-lg"
        >
          <label htmlFor={searchId} className="text-[11px] text-[#8b949e]">
            Search branches
          </label>
          <input
            id={searchId}
            type="search"
            // eslint-disable-next-line jsx-a11y/no-autofocus -- the dropdown opens to type into its search box
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="px-2 py-1 rounded border border-[#30363d] bg-[#0d1117] text-xs text-[#c9d1d9] outline-none focus:border-[#06B6D4]/60"
          />
          <ul className="max-h-72 overflow-y-auto flex flex-col" aria-label="Branches">
            {shown.map((ref) => (
              <li key={ref}>
                <label className="flex items-center gap-2 px-1 py-0.5 rounded text-xs text-[#c9d1d9] hover:bg-[#0d1117] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selected.has(ref)}
                    onChange={() => onChange({ ...state, filters: toggleBranch(filters, ref) })}
                  />
                  <span className="truncate" title={branchLabel(ref)}>
                    {branchLabel(ref)}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {branches.length === 0 && <p className="text-xs text-[#8b949e]">No branch matches.</p>}
          {branches.length > shown.length && (
            <p className="text-[11px] text-[#8b949e]">
              {(branches.length - shown.length).toLocaleString()} more; search to narrow the list.
            </p>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * Topos's filter bar (#368, #401): the Branches dropdown and the Remotes and Tags toggles change
 * the graph's ref set; the agent kinds highlight their commits and dim the rest. Every active one
 * shows as a removable chip, with Reset filters.
 */
export const GraphFilterBar: React.FC<GraphFilterBarProps> = ({ state, onChange, refs, kinds }) => {
  const { filters, agents } = state;
  const chips = filterChips(state);
  return (
    <div className="px-4 py-1.5 bg-[#0d1117] border-b border-[#30363d] flex flex-wrap items-center gap-2 shrink-0">
      <BranchesDropdown state={state} onChange={onChange} refs={refs} />
      <button
        type="button"
        aria-pressed={filters.remotes}
        title="Walk remote-tracking branches"
        onClick={() => onChange({ ...state, filters: { ...filters, remotes: !filters.remotes } })}
        className={toggleClass(filters.remotes)}
      >
        Remotes
      </button>
      <button
        type="button"
        aria-pressed={filters.tags}
        title="Walk every tag, including commits only a tag reaches"
        onClick={() => onChange({ ...state, filters: { ...filters, tags: !filters.tags } })}
        className={toggleClass(filters.tags)}
      >
        Tags
      </button>
      <div role="group" aria-label="Highlight commits by" className="flex items-center gap-1">
        <Highlighter className="w-3.5 h-3.5 text-[#8b949e]" aria-hidden="true" />
        {kinds.map((kind) => (
          <button
            key={kind}
            type="button"
            aria-pressed={agents.includes(kind)}
            title={`Highlight ${kindLabel(kind)} commits and dim the rest`}
            onClick={() => onChange({ ...state, agents: toggleAgent(agents, kind) })}
            className={toggleClass(agents.includes(kind))}
          >
            {kindLabel(kind)}
          </button>
        ))}
      </div>
      {chips.length > 0 && (
        <ul aria-label="Active filters" className="flex flex-wrap items-center gap-1.5">
          {chips.map((chip) => (
            <li
              key={chip.key}
              className="inline-flex items-center gap-1 pl-2 pr-0.5 py-0.5 rounded-full border border-[#06B6D4]/50 bg-[#06B6D4]/10 text-[11px] text-white max-w-56"
            >
              <span className="truncate" title={chip.label}>
                {chip.label}
              </span>
              <button
                type="button"
                aria-label={chip.name}
                title={chip.name}
                onClick={() => onChange(chip.remove(state))}
                className="p-0.5 rounded-full text-[#8b949e] hover:text-white hover:bg-[#21262d]"
              >
                <X className="w-3 h-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {chips.length > 0 && (
        <button
          type="button"
          onClick={() => onChange(RESET)}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-[#8b949e] hover:text-white hover:bg-[#21262d]"
        >
          <RotateCcw className="w-3 h-3" aria-hidden="true" />
          Reset filters
        </button>
      )}
    </div>
  );
};
