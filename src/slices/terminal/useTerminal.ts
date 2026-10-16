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

    // Immediately request focus if active on mount
    if (isVisible && isFocused) {
      requestAnimationFrame(() => {
        try {
          term.focus();
          term.textarea?.focus({ preventScroll: true });
        } catch (_) {}
      });
      setTimeout(() => {
        try {
          term.focus();
          term.textarea?.focus({ preventScroll: true });
        } catch (_) {}
      }, 50);
    }

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
      if (!initialLoaded) return;
      invoke("write_pty", { terminalId, data }).catch((err) => {
        console.error("Failed to write to PTY:", err);
      });
    });

    // Tracking sequence numbers for clean deduplication
    let highestSeq = -1;
    let initialLoaded = false;
    let firstPtyOutputFocused = false;
    const queuedEvents: PtyOutputPayload[] = [];

    // Listen for streaming PTY output events from Rust
    const unlistenPromise = listen<PtyOutputPayload>("pty-output", (event) => {
      if (event.payload.terminal_id !== terminalId) return;

      // When first output packet arrives from newly spawned agent, ensure focus is locked on terminal
      if (!firstPtyOutputFocused && isVisible && isFocused) {
        firstPtyOutputFocused = true;
        requestAnimationFrame(() => {
          try {
            term.focus();
            term.textarea?.focus({ preventScroll: true });
          } catch (_) {}
        });
      }

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

        if (isVisible && isFocused) {
          try {
            term.focus();
            term.textarea?.focus({ preventScroll: true });
          } catch (_) {}
        }

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

    // Immediate fit on mount if container is already sized
    try {
      if (containerRef.current?.clientWidth && containerRef.current?.clientHeight) {
        fitAddon.fit();
        invoke("resize_pty", {
          terminalId,
          rows: term.rows,
          cols: term.cols,
        }).catch(console.error);
      }
    } catch (_) {}

    // Settle fit shortly after mount
    const fitTimer = setTimeout(() => {
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
    }, 20);

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
      clearTimeout(fitTimer);
      resizeObserver.disconnect();
      onDataDispose.dispose();
      onResultsDispose.dispose();
      unlistenPromise.then((unlisten) => unlisten());
      term.dispose();
    };
  }, [terminalId, onToggleSearch]);

  // Robust focus method that targets both xterm core and helper textarea
  const focusTerminal = useCallback(() => {
    if (!termRef.current) return;
    try {
      termRef.current.focus();
      const textarea =
        termRef.current.textarea ||
        containerRef.current?.querySelector<HTMLTextAreaElement>("textarea.xterm-helper-textarea");
      if (textarea && document.activeElement !== textarea) {
        textarea.focus({ preventScroll: true });
      }
    } catch (_) {}
  }, []);

  // Multi-stage staggered focus scheduler to overcome modal unmount blurs and DOM layouts
  const scheduleFocus = useCallback(() => {
    const rafId = requestAnimationFrame(() => {
      focusTerminal();
    });
    const t1 = setTimeout(focusTerminal, 30);
    const t2 = setTimeout(focusTerminal, 100);
    const t3 = setTimeout(focusTerminal, 250);
    const t4 = setTimeout(focusTerminal, 500);

    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
    };
  }, [focusTerminal]);

  // Focus and refit when becomes visible or gains active pane focus
  useEffect(() => {
    if (isVisible && termRef.current && fitAddonRef.current) {
      const fitTimer = setTimeout(() => {
        try {
          fitAddonRef.current?.fit();
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
      }, 30);

      let cancelFocus: (() => void) | undefined;
      if (isFocused) {
        cancelFocus = scheduleFocus();
      }

      return () => {
        clearTimeout(fitTimer);
        cancelFocus?.();
      };
    }
  }, [isVisible, isFocused, terminalId, scheduleFocus]);

  // Global event listener for custom "quay:focus-terminal" triggers
  useEffect(() => {
    const handleFocusEvent = (e: Event) => {
      const ce = e as CustomEvent<{ terminalId?: string }>;
      if (!ce.detail?.terminalId || ce.detail.terminalId === terminalId) {
        if (isVisible) {
          scheduleFocus();
        }
      }
    };

    window.addEventListener("quay:focus-terminal", handleFocusEvent);
    return () => {
      window.removeEventListener("quay:focus-terminal", handleFocusEvent);
    };
  }, [terminalId, isVisible, scheduleFocus]);

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
    focusTerminal,
  };
}
