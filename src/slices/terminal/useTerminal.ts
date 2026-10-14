import { useEffect, useRef, useState, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon, ISearchOptions } from "@xterm/addon-search";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { PtyOutputPayload, TerminalOutputPayload } from "./types";

export function useTerminal(
  terminalId: string,
  isVisible: boolean,
  isFocused: boolean = false,
  onToggleSearch?: () => void
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const [searchResult, setSearchResult] = useState<
    { index: number; count: number } | undefined
  >(undefined);

  useEffect(() => {
    if (!containerRef.current) return;

    // Initialize xterm.js instance with Quay dark palette
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "'Cascadia Code', 'JetBrains Mono', 'Fira Code', Consolas, monospace",
      fontSize: 14,
      lineHeight: 1.2,
      theme: {
        background: "#0d1117",
        foreground: "#c9d1d9",
        cursor: "#58a6ff",
        cursorAccent: "#0d1117",
        selectionBackground: "#1f6feb40",
        black: "#484f58",
        red: "#ff7b72",
        green: "#3fb950",
        yellow: "#d29922",
        blue: "#58a6ff",
        magenta: "#bc8cff",
        cyan: "#39c5cf",
        white: "#b1bac4",
        brightBlack: "#6e7681",
        brightRed: "#ffa198",
        brightGreen: "#56d364",
        brightYellow: "#e3b341",
        brightBlue: "#79c0ff",
        brightMagenta: "#d2a8ff",
        brightCyan: "#56d4dd",
        brightWhite: "#f0f6fc",
      },
      allowTransparency: true,
      scrollback: 5000,
    });

    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(searchAddon);
    term.open(containerRef.current);

    termRef.current = term;
    fitAddonRef.current = fitAddon;
    searchAddonRef.current = searchAddon;

    const onResultsDispose = searchAddon.onDidChangeResults((e) => {
      setSearchResult({ index: e.resultIndex, count: e.resultCount });
    });

    // Intercept Ctrl+F while typing in xterm canvas
    term.attachCustomKeyEventHandler((e) => {
      if (e.ctrlKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        if (onToggleSearch) {
          onToggleSearch();
        }
        return false;
      }
      return true;
    });

    // Send user keystrokes to Rust ConPTY
    const onDataDispose = term.onData((data) => {
      invoke("write_pty", { terminalId, data }).catch((err) => {
        console.error("Failed to write to PTY:", err);
      });
    });

    // Tracking sequence numbers for clean deduplication
    let highestSeq = -1;
    let initialLoaded = false;
    const queuedEvents: PtyOutputPayload[] = [];

    // Listen for streaming PTY output events from Rust
    const unlistenPromise = listen<PtyOutputPayload>("pty-output", (event) => {
      if (event.payload.terminal_id !== terminalId) return;

      if (!initialLoaded) {
        queuedEvents.push(event.payload);
      } else {
        if (event.payload.seq > highestSeq) {
          highestSeq = event.payload.seq;
          term.write(event.payload.data);
        }
      }
    });

    // Fetch initial buffer
    invoke<TerminalOutputPayload>("get_terminal_output", { terminalId })
      .then((res) => {
        if (res && res.data) {
          term.write(res.data);
          highestSeq = res.last_seq;
        }
        initialLoaded = true;

        // Drain any queued events that arrived after the snapshot
        for (const item of queuedEvents) {
          if (item.seq > highestSeq) {
            highestSeq = item.seq;
            term.write(item.data);
          }
        }
        queuedEvents.length = 0;
      })
      .catch((err) => {
        console.error("Failed to get initial output:", err);
        initialLoaded = true;
      });

    // Fit on mount
    setTimeout(() => {
      try {
        fitAddon.fit();
        invoke("resize_pty", {
          terminalId,
          rows: term.rows,
          cols: term.cols,
        }).catch(console.error);
      } catch (err) {
        console.error("Error initial fit:", err);
      }
    }, 50);

    // Watch resize of container
    const resizeObserver = new ResizeObserver(() => {
      if (containerRef.current?.clientWidth && containerRef.current?.clientHeight) {
        try {
          fitAddon.fit();
          invoke("resize_pty", {
            terminalId,
            rows: term.rows,
            cols: term.cols,
          }).catch(console.error);
        } catch (err) {
          console.error("Error on resize fit:", err);
        }
      }
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      onDataDispose.dispose();
      onResultsDispose.dispose();
      unlistenPromise.then((unlisten) => unlisten());
      term.dispose();
    };
  }, [terminalId, onToggleSearch]);

  // Focus and refit when becomes visible
  useEffect(() => {
    if (isVisible && termRef.current && fitAddonRef.current) {
      setTimeout(() => {
        try {
          fitAddonRef.current?.fit();
          termRef.current?.focus();
          if (termRef.current) {
            invoke("resize_pty", {
              terminalId,
              rows: termRef.current.rows,
              cols: termRef.current.cols,
            }).catch(console.error);
          }
        } catch (err) {
          console.error("Fit on visibility error:", err);
        }
      }, 50);
    }
  }, [isVisible, terminalId]);

  // Refocus when pane gains focus
  useEffect(() => {
    if (isVisible && isFocused && termRef.current) {
      termRef.current.focus();
    }
  }, [isFocused, isVisible]);

  const findNext = useCallback((query: string, options?: ISearchOptions) => {
    if (!searchAddonRef.current || !query) return false;
    return searchAddonRef.current.findNext(query, {
      decorations: {
        matchBackground: "#58a6ff33",
        matchBorder: "#58a6ff",
        matchOverviewRuler: "#58a6ff",
        activeMatchBackground: "#f0883e66",
        activeMatchBorder: "#f0883e",
        activeMatchColorOverviewRuler: "#f0883e",
      },
      ...options,
    });
  }, []);

  const findPrevious = useCallback((query: string, options?: ISearchOptions) => {
    if (!searchAddonRef.current || !query) return false;
    return searchAddonRef.current.findPrevious(query, {
      decorations: {
        matchBackground: "#58a6ff33",
        matchBorder: "#58a6ff",
        matchOverviewRuler: "#58a6ff",
        activeMatchBackground: "#f0883e66",
        activeMatchBorder: "#f0883e",
        activeMatchColorOverviewRuler: "#f0883e",
      },
      ...options,
    });
  }, []);

  const clearSearch = useCallback(() => {
    if (searchAddonRef.current) {
      searchAddonRef.current.clearDecorations();
      setSearchResult(undefined);
    }
  }, []);

  const exportScrollback = useCallback((): string => {
    if (!termRef.current) return "";
    const buf = termRef.current.buffer.active;
    const lines: string[] = [];
    for (let i = 0; i < buf.length; i++) {
      const line = buf.getLine(i);
      if (line) {
        lines.push(line.translateToString(true));
      }
    }
    while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
      lines.pop();
    }
    return lines.join("\n");
  }, []);

  return {
    containerRef,
    term: termRef.current,
    findNext,
    findPrevious,
    clearSearch,
    exportScrollback,
    searchResult,
  };
}
