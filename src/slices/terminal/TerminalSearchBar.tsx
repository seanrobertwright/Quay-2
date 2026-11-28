import { useState, useEffect, useRef, type Dispatch, type FC, type KeyboardEvent, type ReactNode, type SetStateAction } from "react";
import {
  ArrowUp,
  ArrowDown,
  CaseSensitive,
  Regex,
  Copy,
  Download,
  X,
  Check,
  Search,
} from "lucide-react";

interface TerminalSearchBarProps {
  isOpen: boolean;
  searchResult?: { index: number; count: number };
  terminalName?: string;
  onFindNext: (
    query: string,
    options: { caseSensitive: boolean; regex: boolean; wholeWord: boolean }
  ) => void;
  onFindPrevious: (
    query: string,
    options: { caseSensitive: boolean; regex: boolean; wholeWord: boolean }
  ) => void;
  onClear: () => void;
  onClose: () => void;
  onGetScrollback: () => string;
}

/** What a screen reader hears for the counter badge: "3 of 12 matches", "1 of 1 match" or "No matches". */
function matchCountLabel(index: number, count: number): string {
  if (count === 0) return "No matches";
  return `${index} of ${count} ${count === 1 ? "match" : "matches"}`;
}

const TOGGLE_ACTIVE = "bg-[#58a6ff]/20 text-[#58a6ff] border border-[#58a6ff]/40";
const TOGGLE_INACTIVE = "text-[#8b949e] hover:text-white hover:bg-[#21262d]";

/** One search-option toggle: its button and its Alt shortcut both come from this entry. */
interface SearchToggle {
  /** The letter that toggles it with Alt, lowercase. */
  key: string;
  label: string;
  title: string;
  pressed: boolean;
  setPressed: Dispatch<SetStateAction<boolean>>;
  className: string;
  content: ReactNode;
}

export const TerminalSearchBar: FC<TerminalSearchBarProps> = ({
  isOpen,
  searchResult,
  terminalName = "terminal",
  onFindNext,
  onFindPrevious,
  onClear,
  onClose,
  onGetScrollback,
}) => {
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regex, setRegex] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);
    } else {
      setQuery("");
      onClear();
    }
  }, [isOpen, onClear]);

  // Incremental search as user types
  useEffect(() => {
    if (!query) {
      onClear();
      return;
    }
    onFindNext(query, { caseSensitive, regex, wholeWord });
  }, [query, caseSensitive, regex, wholeWord, onClear, onFindNext]);

  if (!isOpen) return null;

  const toggles: SearchToggle[] = [
    {
      key: "c",
      label: "Match case",
      title: "Match Case (Alt+C)",
      pressed: caseSensitive,
      setPressed: setCaseSensitive,
      className: "p-1",
      content: <CaseSensitive className="w-3.5 h-3.5" />,
    },
    {
      key: "r",
      label: "Use regular expression",
      title: "Use Regular Expression (Alt+R)",
      pressed: regex,
      setPressed: setRegex,
      className: "p-1",
      content: <Regex className="w-3.5 h-3.5" />,
    },
    {
      key: "w",
      label: "Match whole word",
      title: "Match Whole Word (Alt+W)",
      pressed: wholeWord,
      setPressed: setWholeWord,
      className: "px-1 py-0.5 text-[10px] font-mono font-bold",
      content: <span aria-hidden="true">\b</span>,
    },
  ];

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) {
        onFindPrevious(query, { caseSensitive, regex, wholeWord });
      } else {
        onFindNext(query, { caseSensitive, regex, wholeWord });
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  // Alt+C, Alt+R and Alt+W, which the toggles' titles name, from anywhere in the bar.
  const handleToggleKeys = (e: KeyboardEvent<HTMLElement>) => {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    const toggle = toggles.find((t) => t.key === e.key.toLowerCase());
    if (!toggle) return;
    e.preventDefault();
    toggle.setPressed((prev) => !prev);
  };

  const handleCopy = () => {
    const text = onGetScrollback();
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const text = onGetScrollback();
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safeName = terminalName.replace(/[^a-zA-Z0-9_-]/g, "_");
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `${safeName}-${date}.log`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const resultCount = searchResult?.count ?? 0;
  const resultIndex = (searchResult?.index ?? -1) + 1;

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- Alt+C, Alt+R and Alt+W toggle from any control in the bar; every control inside is native
    <div
      data-no-terminal-focus
      onKeyDown={handleToggleKeys}
      className="absolute top-2 right-3 z-30 flex items-center gap-1.5 bg-[#161b22] border border-[#30363d] rounded-lg shadow-2xl px-2.5 py-1.5 text-xs text-[#c9d1d9] animate-in fade-in slide-in-from-top-1 select-none"
    >
      <Search className="w-3.5 h-3.5 text-[#8b949e] shrink-0" />

      {/* Search Input */}
      <div className="relative flex items-center">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="Find in terminal"
          placeholder="Find in terminal..."
          className="w-44 px-2 py-1 bg-[#0d1117] border border-[#30363d] rounded text-xs text-white placeholder:text-[#6e7681] focus:outline-hidden focus:border-(--quay-accent)"
        />

        {/* Counter Badge. The live region stays mounted while the field is empty so the first count
            is announced; the "3/12" shorthand is hidden from screen readers, which hear the phrase. */}
        <span role="status" aria-live="polite" aria-atomic="true" className="absolute right-2 text-[10px] font-mono text-[#8b949e]">
          {query && (
            <>
              <span aria-hidden="true">{resultCount > 0 ? `${resultIndex}/${resultCount}` : "0/0"}</span>
              <span className="sr-only">{matchCountLabel(resultIndex, resultCount)}</span>
            </>
          )}
        </span>
      </div>

      {/* Match Case, Regex and Whole Word toggles */}
      {toggles.map((toggle) => (
        <button
          key={toggle.key}
          type="button"
          onClick={() => toggle.setPressed((prev) => !prev)}
          className={`${toggle.className} rounded transition-colors cursor-pointer ${toggle.pressed ? TOGGLE_ACTIVE : TOGGLE_INACTIVE}`}
          aria-label={toggle.label}
          aria-pressed={toggle.pressed}
          title={toggle.title}
        >
          {toggle.content}
        </button>
      ))}

      {/* Previous Match */}
      <button
        type="button"
        disabled={!query || resultCount === 0}
        onClick={() => onFindPrevious(query, { caseSensitive, regex, wholeWord })}
        className="p-1 text-[#8b949e] hover:text-white hover:bg-[#21262d] disabled:opacity-30 rounded transition-colors cursor-pointer"
        aria-label="Previous match"
        title="Previous Match (Shift+Enter)"
      >
        <ArrowUp className="w-3.5 h-3.5" />
      </button>

      {/* Next Match */}
      <button
        type="button"
        disabled={!query || resultCount === 0}
        onClick={() => onFindNext(query, { caseSensitive, regex, wholeWord })}
        className="p-1 text-[#8b949e] hover:text-white hover:bg-[#21262d] disabled:opacity-30 rounded transition-colors cursor-pointer"
        aria-label="Next match"
        title="Next Match (Enter)"
      >
        <ArrowDown className="w-3.5 h-3.5" />
      </button>

      <div className="w-[1px] h-3.5 bg-[#30363d] mx-0.5" />

      {/* Copy Scrollback */}
      <button
        type="button"
        onClick={handleCopy}
        className="p-1 text-[#8b949e] hover:text-white hover:bg-[#21262d] rounded transition-colors cursor-pointer"
        aria-label="Copy scrollback"
        title="Copy full terminal scrollback to clipboard"
      >
        {copied ? (
          <Check className="w-3.5 h-3.5 text-[#3fb950]" />
        ) : (
          <Copy className="w-3.5 h-3.5" />
        )}
      </button>

      {/* Download Log File */}
      <button
        type="button"
        onClick={handleDownload}
        className="p-1 text-[#8b949e] hover:text-white hover:bg-[#21262d] rounded transition-colors cursor-pointer"
        aria-label="Export scrollback as a log file"
        title="Export scrollback as .log file"
      >
        <Download className="w-3.5 h-3.5" />
      </button>

      {/* Close Search */}
      <button
        type="button"
        onClick={onClose}
        className="p-1 text-[#8b949e] hover:text-[#ff7b72] hover:bg-[#21262d] rounded transition-colors cursor-pointer"
        aria-label="Close search"
        title="Close (Esc)"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
