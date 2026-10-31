import React, { useId } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { findParts } from "./graphFind";

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
}

const buttonClass =
  "p-1 rounded text-[#8b949e] hover:text-white hover:bg-[#21262d] disabled:opacity-40 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#06B6D4]/60";

/**
 * The find field over the commit list (#368, #399): `Ctrl+F` opens it, Enter and Shift+Enter or F3
 * and Shift+F3 step through the matches, and Escape clears and closes it before Topos closes.
 */
export const GraphFindBar: React.FC<GraphFindBarProps> = ({ text, onText, counter, canStep, onStep, onClose, inputRef, barRef }) => {
  const hintId = useId();
  return (
    <div
      ref={barRef}
      role="search"
      aria-label="Find in loaded commits"
      className="h-8 shrink-0 flex items-center gap-2 px-2 border-b border-[#30363d] bg-[#161b22]"
    >
      <input
        ref={inputRef}
        type="search"
        value={text}
        onChange={(e) => onText(e.target.value)}
        aria-label="Find commits by subject, author, SHA or ref"
        aria-describedby={hintId}
        placeholder="Find by subject, author, SHA or ref"
        spellCheck={false}
        autoComplete="off"
        className="flex-1 min-w-0 max-w-md h-6 px-2 rounded border border-[#30363d] bg-[#0d1117] text-xs text-[#c9d1d9] placeholder:text-[#6e7681] outline-none focus:border-[#06B6D4]/60"
      />
      <span id={hintId} className="sr-only">
        Enter or F3 goes to the next match, Shift+Enter or Shift+F3 to the previous one, and Escape clears the find.
      </span>
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
  );
};
