import React, { useId, useState } from "react";
import { ChevronDown, ChevronUp, History, X } from "lucide-react";
import { findParts } from "./graphFind";
import type { DeepSearchState, SearchKind } from "./deepSearch";
import type { GraphStore } from "./graphStore";
import { formatDateTime } from "../../../lib/dates";

/**
 * `text` with the runs `query` finds marked (#399). The parts are text children, so React escapes
 * a commit's or a ref's untrusted text; nothing is injected as markup.
 */
export const FindText: React.FC<{ text: string; query: string }> = ({ text, query }) => {
  const parts = findParts(text, query);
  if (parts.length === 1 && !parts[0].hit) return <>{text}</>;
  // Each part is keyed by where it starts in the text, which no two parts share.
  let offset = 0;
  const nodes = parts.map((part) => {
    const key = offset;
    offset += part.text.length;
    return part.hit ? (
      <mark key={key} className="bg-[#d29922]/40 text-inherit rounded-sm">
        {part.text}
      </mark>
    ) : (
      <React.Fragment key={key}>{part.text}</React.Fragment>
    );
  });
  return <>{nodes}</>;
};

export interface GraphFindBarProps {
  text: string;
  onText: (text: string) => void;
  /** "3 of 41", "No matches" and the like; empty while the field is. */
  counter: string;
  canStep: boolean;
  onStep: (direction: 1 | -1) => void;
  onClose: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  barRef: React.RefObject<HTMLDivElement | null>;
  /** "Search all history" (#400): text without a prefix runs a message search over all history. */
  allHistory: boolean;
  onAllHistory: (on: boolean) => void;
  /** The deep search the text asks for, or null while it is a plain find. */
  deep: DeepSearchBarProps | null;
}

/** The deep search (#400) as the find bar shows it. */
export interface DeepSearchBarProps {
  kind: SearchKind;
  status: DeepSearchState["status"];
  error: string | null;
  /** The results' oids, newest first. */
  oids: readonly string[];
  /** The loaded row of a result, or -1 when it isn't loaded. */
  rowOf: (oid: string) => number;
  /** The graph's rows, which hold the loaded results' text. */
  store: GraphStore | null;
  /** The result the graph is loading down to, or null. */
  loading: string | null;
  onOpen: (oid: string) => void;
  onLoadMore: () => void;
}

const KIND_LABELS: Record<SearchKind, string> = {
  message: "Messages",
  author: "Authors",
  path: "Path",
  code: "Code (slow)",
};

/** Height of one result in px, and how many show before the list scrolls. */
const RESULT_HEIGHT = 24;
const RESULTS_SHOWN = 8;
/** Results drawn beyond the visible ones at each end. */
const RESULT_OVERSCAN = 4;

/**
 * The deep search's results under the find bar (#400): each a commit found in all history. Only
 * the visible results are in the DOM. A loaded result shows its subject, author and date from the
 * graph's rows; one further down shows its short SHA until the graph loads down to it. Commit text
 * goes in as text children, never as markup.
 */
const DeepResults: React.FC<DeepSearchBarProps> = ({ status, error, oids, rowOf, store, loading, onOpen, onLoadMore }) => {
  const [top, setTop] = useState(0);
  const first = Math.max(0, Math.floor(top / RESULT_HEIGHT) - RESULT_OVERSCAN);
  const last = Math.min(oids.length, Math.ceil(top / RESULT_HEIGHT) + RESULTS_SHOWN + RESULT_OVERSCAN);
  const items: React.ReactNode[] = [];
  for (let i = first; i < last; i++) {
    const oid = oids[i];
    const row = store === null ? -1 : rowOf(oid);
    const short = oid.slice(0, 8);
    items.push(
      <li key={oid} aria-posinset={i + 1} aria-setsize={oids.length} className="absolute inset-x-0" style={{ top: i * RESULT_HEIGHT, height: RESULT_HEIGHT }}>
        <button
          type="button"
          onClick={() => onOpen(oid)}
          className="w-full h-full flex items-center gap-2 px-2 text-left text-[11px] hover:bg-[#21262d] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#06B6D4]/60"
        >
          <span className="font-mono text-[#8b949e] shrink-0">{short}</span>
          {row !== -1 && store !== null ? (
            <>
              <span className="flex-1 min-w-0 truncate text-[#c9d1d9]">{store.subject(row)}</span>
              <span className="w-32 shrink-0 truncate text-[#8b949e]">{store.author(row).name}</span>
              <span className="w-36 shrink-0 truncate text-right text-[#8b949e] tabular-nums">{formatDateTime(store.authorTimeMs(row))}</span>
            </>
          ) : (
            <span className="flex-1 min-w-0 truncate text-[#6e7681]">
              {loading === oid ? "Loading the graph down to it…" : "Below the loaded rows: open to load the graph down to it"}
            </span>
          )}
        </button>
      </li>
    );
  }
  if (oids.length === 0 && status !== "failed") return null;
  return (
    <div className="border-b border-[#30363d] bg-[#0d1117]">
      {error !== null && (
        <p role="alert" className="px-2 py-1 text-[11px] text-[#f85149] break-words">
          {error}
        </p>
      )}
      {oids.length > 0 && (
        <ul
          aria-label="Commits found in all history"
          className="relative overflow-y-auto"
          style={{ height: Math.min(oids.length, RESULTS_SHOWN) * RESULT_HEIGHT }}
          onScroll={(e) => setTop(e.currentTarget.scrollTop)}
        >
          <li aria-hidden="true" style={{ height: oids.length * RESULT_HEIGHT }} />
          {items}
        </ul>
      )}
      {status === "capped" && (
        <div className="px-2 py-1">
          <button type="button" onClick={onLoadMore} className="text-[11px] text-[#06B6D4] hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#06B6D4]/60 rounded">
            Load more
          </button>
        </div>
      )}
    </div>
  );
};

const buttonClass =
  "p-1 rounded text-[#8b949e] hover:text-white hover:bg-[#21262d] disabled:opacity-40 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#06B6D4]/60";

/**
 * The find field over the commit list (#368, #399): `Ctrl+F` opens it, Enter and Shift+Enter or F3
 * and Shift+F3 step through the matches, and Escape clears and closes it before Topos closes.
 */
export const GraphFindBar: React.FC<GraphFindBarProps> = ({
  text,
  onText,
  counter,
  canStep,
  onStep,
  onClose,
  inputRef,
  barRef,
  allHistory,
  onAllHistory,
  deep,
}) => {
  const hintId = useId();
  return (
    <div ref={barRef} role="search" aria-label="Find commits" className="shrink-0 flex flex-col">
    <div className="h-8 shrink-0 flex items-center gap-2 px-2 border-b border-[#30363d] bg-[#161b22]">
      <input
        ref={inputRef}
        type="search"
        value={text}
        onChange={(e) => onText(e.target.value)}
        aria-label="Find commits by subject, author, SHA or ref, or search all history with msg:, author:, path: or code:"
        aria-describedby={hintId}
        placeholder={allHistory ? "Search all history: messages, or msg:, author:, path:, code:" : "Find by subject, author, SHA or ref; msg:, author:, path:, code: search all history"}
        spellCheck={false}
        autoComplete="off"
        className="flex-1 min-w-0 max-w-md h-6 px-2 rounded border border-[#30363d] bg-[#0d1117] text-xs text-[#c9d1d9] placeholder:text-[#6e7681] outline-none focus:border-[#06B6D4]/60"
      />
      <span id={hintId} className="sr-only">
        Enter or F3 goes to the next match, Shift+Enter or Shift+F3 to the previous one, and Escape clears the find.
      </span>
      <button
        type="button"
        onClick={() => onAllHistory(!allHistory)}
        aria-pressed={allHistory}
        title="Search all history"
        className={`${buttonClass} flex items-center gap-1 text-[11px] ${allHistory ? "text-[#06B6D4] bg-[#21262d]" : ""}`}
      >
        <History className="w-3.5 h-3.5" aria-hidden="true" />
        Search all history
      </button>
      {deep && (
        <span className={`shrink-0 text-[11px] ${deep.kind === "code" ? "text-[#d29922]" : "text-[#8b949e]"}`}>
          {KIND_LABELS[deep.kind]}
        </span>
      )}
      <span role="status" aria-live="polite" className="min-w-24 text-[11px] text-[#8b949e] tabular-nums">
        {counter}
      </span>
      <button type="button" onClick={() => onStep(-1)} disabled={!canStep} aria-label="Previous match" title="Previous match (Shift+Enter, Shift+F3)" className={buttonClass}>
        <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
      <button type="button" onClick={() => onStep(1)} disabled={!canStep} aria-label="Next match" title="Next match (Enter, F3)" className={buttonClass}>
        <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
      <button type="button" onClick={onClose} aria-label="Close find" title="Close find (Esc)" className={buttonClass}>
        <X className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
    </div>
    {deep && <DeepResults {...deep} />}
    </div>
  );
};
