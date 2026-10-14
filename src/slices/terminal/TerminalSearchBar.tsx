import { FC, useState, useEffect, useRef, KeyboardEvent } from "react";
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
  }, [isOpen]);

  // Incremental search as user types
  useEffect(() => {
    if (!query) {
      onClear();
      return;
    }
    onFindNext(query, { caseSensitive, regex, wholeWord });
  }, [query, caseSensitive, regex, wholeWord]);

  if (!isOpen) return null;

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
    <div
      onClick={(e) => e.stopPropagation()}
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
          placeholder="Find in terminal..."
          className="w-44 px-2 py-1 bg-[#0d1117] border border-[#30363d] rounded text-xs text-white placeholder:text-[#6e7681] focus:outline-hidden focus:border-[#58a6ff]"
        />

        {/* Counter Badge */}
        {query && (
          <span className="absolute right-2 text-[10px] font-mono text-[#8b949e]">
            {resultCount > 0 ? `${resultIndex}/${resultCount}` : "0/0"}
          </span>
        )}
      </div>

      {/* Match Case Toggle */}
      <button
        type="button"
        onClick={() => setCaseSensitive((prev) => !prev)}
        className={`p-1 rounded transition-colors cursor-pointer ${
          caseSensitive
            ? "bg-[#58a6ff]/20 text-[#58a6ff] border border-[#58a6ff]/40"
            : "text-[#8b949e] hover:text-white hover:bg-[#21262d]"
        }`}
        title="Match Case (Alt+C)"
      >
        <CaseSensitive className="w-3.5 h-3.5" />
      </button>

      {/* Regex Toggle */}
      <button
        type="button"
        onClick={() => setRegex((prev) => !prev)}
        className={`p-1 rounded transition-colors cursor-pointer ${
          regex
            ? "bg-[#58a6ff]/20 text-[#58a6ff] border border-[#58a6ff]/40"
            : "text-[#8b949e] hover:text-white hover:bg-[#21262d]"
        }`}
        title="Use Regular Expression (Alt+R)"
      >
        <Regex className="w-3.5 h-3.5" />
      </button>

      {/* Whole Word Toggle */}
      <button
        type="button"
        onClick={() => setWholeWord((prev) => !prev)}
        className={`px-1 py-0.5 rounded transition-colors text-[10px] font-mono font-bold cursor-pointer ${
          wholeWord
            ? "bg-[#58a6ff]/20 text-[#58a6ff] border border-[#58a6ff]/40"
            : "text-[#8b949e] hover:text-white hover:bg-[#21262d]"
        }`}
        title="Match Whole Word (Alt+W)"
      >
        \b
      </button>

      {/* Previous Match */}
      <button
        type="button"
        disabled={!query || resultCount === 0}
        onClick={() => onFindPrevious(query, { caseSensitive, regex, wholeWord })}
        className="p-1 text-[#8b949e] hover:text-white hover:bg-[#21262d] disabled:opacity-30 rounded transition-colors cursor-pointer"
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
        title="Export scrollback as .log file"
      >
        <Download className="w-3.5 h-3.5" />
      </button>

      {/* Close Search */}
      <button
        type="button"
        onClick={onClose}
        className="p-1 text-[#8b949e] hover:text-[#ff7b72] hover:bg-[#21262d] rounded transition-colors cursor-pointer"
        title="Close (Esc)"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
