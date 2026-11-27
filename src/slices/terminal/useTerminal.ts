import { useEffect, useRef, useState, useCallback } from "react";
import { Terminal, type IWindowsPty } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon, ISearchOptions } from "@xterm/addon-search";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { PtyOutputPayload, TerminalOutputPayload } from "./types";
import { attachTerminalKeys } from "./terminalBody";
import { focusXterm, isTypingOutside, paneOf } from "./terminalFocus";
import { isMouseReport, isTerminalReport, splitPendingQueries } from "./terminalReports";
import { reportUserInput } from "./userInput";
import { registerClaudeUnicodeProvider } from "./terminalUnicode";
import { isOverlayOpen } from "../overlay/useOverlay";
import { repaintTerminalScreen, syncTerminalSize } from "./terminalResize";
import { paneTerminalOptions, parseWindowsBuildNumber, windowsPtyFor } from "./terminalOptions";

let globalTerminalCols = 160;
let globalTerminalRows = 40;
const fittedTerminalDimensions = new Map<string, { cols: number; rows: number }>();

let windowsPty: IWindowsPty | undefined;
let windowsPtyLoad: Promise<IWindowsPty | undefined> | null = null;

/** The `windowsPty` option as far as it is known: without the build number until it is read. */
function knownWindowsPty(): IWindowsPty | undefined {
  return windowsPty ?? windowsPtyFor(navigator.userAgent, null);
}

/**
 * Reads the Windows build number once for every pane. A build number that can't be read leaves
 * the option naming only the ConPTY backend (terminalOptions.ts `windowsPtyFor`).
 */
function loadWindowsPty(): Promise<IWindowsPty | undefined> {
  windowsPtyLoad ??= invoke<unknown>("windows_build_number")
    .catch((err) => {
      console.error("Failed to read the Windows build number:", err);
      return null;
    })
    .then((build) => (windowsPty = windowsPtyFor(navigator.userAgent, parseWindowsBuildNumber(build))));
  return windowsPtyLoad;
}

/**
 * Returns the most recent fitted terminal dimensions across active panes so newly
 * spawned terminals start with the exact right ConPTY size from frame 0.
 */
export function getGlobalTerminalDimensions(): { cols: number; rows: number } {
  return { cols: globalTerminalCols, rows: globalTerminalRows };
}

/**
 * Returns the size this terminal's xterm pane was last fitted to, falling back to the
 * global dimensions. A relaunched PTY must start at this size: the pane stays mounted,
 * so its own fit sees no change and never re-sends the size.
 */
export function getTerminalDimensions(terminalId: string): { cols: number; rows: number } {
  return fittedTerminalDimensions.get(terminalId) ?? getGlobalTerminalDimensions();
}

/** What a terminal's keys ask of the pane that shows it. */
export interface TerminalKeyCallbacks {
  /** Opens or closes the pane's scrollback search, from Ctrl+F. */
  onToggleSearch?: () => void;
  /** Opens the terminal body menu, from Shift+F10 or the Menu key; gets the terminal body's element. */
  onOpenMenu?: (body: HTMLElement) => void;
}

export function useTerminal(
  terminalId: string,
  isVisible: boolean,
  isFocused: boolean = false,
  { onToggleSearch, onOpenMenu }: TerminalKeyCallbacks = {}
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const lastPtySizeRef = useRef<{ rows: number; cols: number }>({
    rows: 0,
    cols: 0,
  });

  // Keep latest props in refs so the main Terminal instance is never disposed on React re-renders
  const onToggleSearchRef = useRef(onToggleSearch);
  onToggleSearchRef.current = onToggleSearch;
  const onOpenMenuRef = useRef(onOpenMenu);
  onOpenMenuRef.current = onOpenMenu;
  const isVisibleRef = useRef(isVisible);
  isVisibleRef.current = isVisible;
  const isFocusedRef = useRef(isFocused);
  isFocusedRef.current = isFocused;

  const [searchResult, setSearchResult] = useState<
    { index: number; count: number } | undefined
  >(undefined);

  // Fit xterm to its container and only notify Rust ConPTY when (rows, cols) actually changed
  const syncPtySize = useCallback(() => {
    try {
      syncTerminalSize(
        {
          container: containerRef.current,
          term: termRef.current,
          fitAddon: fitAddonRef.current,
          isVisible: isVisibleRef.current,
        },
        lastPtySizeRef.current,
        {
          onSizeChanged: (rows, cols) => {
            fittedTerminalDimensions.set(terminalId, { rows, cols });
            globalTerminalCols = cols;
            globalTerminalRows = rows;
          },
          resizePty: (rows, cols) => invoke("resize_pty", { terminalId, rows, cols }),
        }
      );
    } catch (err) {
      console.error("Error syncing PTY size:", err);
    }
  }, [terminalId]);

  useEffect(() => {
    if (!containerRef.current) return;
    lastPtySizeRef.current = { rows: 0, cols: 0 };

    // A pane that mounts before the build number is read gets it before the replay is written
    const term = new Terminal(paneTerminalOptions(knownWindowsPty()));

    // Register custom Unicode width provider so "⚙️" (U+2699 U+FE0F) and emojis match ConPTY
    registerClaudeUnicodeProvider(term);

    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(searchAddon);
    term.open(containerRef.current);

    termRef.current = term;
    fitAddonRef.current = fitAddon;
    searchAddonRef.current = searchAddon;

    // Fit immediately BEFORE writing initial output so buffer replay uses real dimensions
    syncPtySize();

    // Immediately request focus if active on mount
    if (isVisibleRef.current && isFocusedRef.current) {
      requestAnimationFrame(() => focusXterm(term));
      setTimeout(() => focusXterm(term), 50);
    }

    const onResultsDispose = searchAddon.onDidChangeResults((e) => {
      setSearchResult({ index: e.resultIndex, count: e.resultCount });
    });

    // Copy, paste, search and menu keys (terminalBody.ts).
    attachTerminalKeys(term, {
      search: () => onToggleSearchRef.current?.(),
      menu: () => {
        if (containerRef.current) onOpenMenuRef.current?.(containerRef.current);
      },
    });

    // Send user keystrokes to Rust ConPTY
    const onDataDispose = term.onData((data) => {
      if (!initialLoaded) return;
      // The replay holds old queries, and xterm answers them as it parses. Those replies would
      // reach the live program as typed input, so drop them; the user's own keys still go through.
      if (replaying && isTerminalReport(data)) return;
      // Keys and paste are the user acting on the terminal; xterm's own replies, such as the
      // focus-in report, and mouse reports from a click that focuses the pane are not.
      if (!isTerminalReport(data) && !isMouseReport(data)) reportUserInput(terminalId);
      invoke("write_pty", { terminalId, data }).catch((err) => {
        console.error("Failed to write to PTY:", err);
      });
    });

    // Tracking sequence numbers for clean deduplication
    let highestSeq = -1;
    let disposed = false;
    let initialLoaded = false;
    let replaying = false;
    let firstPtyOutputFocused = false;
    const queuedEvents: PtyOutputPayload[] = [];

    // Listen for streaming PTY output events from Rust
    const unlistenPromise = listen<PtyOutputPayload>("pty-output", (event) => {
      if (event.payload.terminal_id !== terminalId) return;

      // When first output packet arrives from newly spawned agent, ensure focus is locked on terminal
      if (!firstPtyOutputFocused && isVisibleRef.current && isFocusedRef.current) {
        firstPtyOutputFocused = true;
        requestAnimationFrame(() => focusXterm(term));
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

    // Fetch initial buffer once on mount. The build number is read alongside it, so the replay
    // after a window reload is written with the same windowsPty option as live output.
    Promise.all([invoke<TerminalOutputPayload>("get_terminal_output", { terminalId }), loadWindowsPty()])
      .then(([res, readWindowsPty]) => {
        // The pane unmounted before the snapshot came back; the next mount fetches its own
        if (disposed) return;
        if (readWindowsPty) term.options.windowsPty = readWindowsPty;
        syncPtySize();
        // A pane that mounts hidden can't be fitted, so xterm would stay at its default 80x24
        // and lay out the replay and every live chunk for the wrong size. Give it the PTY's
        // size; when the pane shows, its fit then sees any real change and asks for a redraw.
        if (lastPtySizeRef.current.cols === 0 && res?.rows && res?.cols) {
          term.resize(res.cols, res.rows);
          lastPtySizeRef.current = { rows: res.rows, cols: res.cols };
          fittedTerminalDimensions.set(terminalId, { rows: res.rows, cols: res.cols });
        }
        if (res && res.data) {
          // xterm parses the write later. Its callback runs once this chunk is parsed and before
          // any live chunk queued after it, whose queries the live program is waiting on.
          // A cursor position query at the very end of the snapshot is still waiting too, such as
          // ConPTY's ESC[6n before a new shell starts, so it is written after the callback and
          // answered.
          const { replayed, pending } = splitPendingQueries(res.data);
          replaying = true;
          term.write(replayed, () => {
            replaying = false;
          });
          if (pending) term.write(pending);
          highestSeq = res.last_seq;
        }
        initialLoaded = true;

        if (isVisibleRef.current && isFocusedRef.current) {
          focusXterm(term);
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

    // Settle fit shortly after mount (only resizes PTY if dimensions changed)
    const fitTimer = setTimeout(() => {
      syncPtySize();
    }, 20);

    // Watch resize of container (debounced via rAF and guarded by lastPtySizeRef)
    let resizeRaf: number | null = null;
    const resizeObserver = new ResizeObserver(() => {
      if (resizeRaf !== null) {
        cancelAnimationFrame(resizeRaf);
      }
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = null;
        syncPtySize();
      });
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      disposed = true;
      clearTimeout(fitTimer);
      if (resizeRaf !== null) {
        cancelAnimationFrame(resizeRaf);
      }
      resizeObserver.disconnect();
      onDataDispose.dispose();
      onResultsDispose.dispose();
      unlistenPromise.then((unlisten) => unlisten());
      fittedTerminalDimensions.delete(terminalId);
      term.dispose();
    };
  }, [terminalId, syncPtySize]);

  // Robust focus method that targets both xterm core and helper textarea
  const focusTerminal = useCallback(() => {
    // An open overlay keeps focus; it hands focus back itself when it closes.
    if (!termRef.current || isOverlayOpen()) return;
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

  // A timed focus leaves focus in a field outside the pane, such as an agent's question, and in
  // one of the pane's own controls, such as its search box or rename box: the terminal menu's Find
  // opens the search just as selecting the terminal schedules these focus calls.
  const focusUnlessInControl = useCallback(() => {
    const active = document.activeElement;
    const pane = paneOf(containerRef.current);
    if (isTypingOutside(pane)) return;
    if (active && pane?.contains(active) && active.closest("[data-no-terminal-focus]")) return;
    focusTerminal();
  }, [focusTerminal]);

  // Multi-stage staggered focus scheduler to overcome modal unmount blurs and DOM layouts
  const scheduleFocus = useCallback(() => {
    const rafId = requestAnimationFrame(() => {
      focusUnlessInControl();
    });
    const t1 = setTimeout(focusUnlessInControl, 30);
    const t2 = setTimeout(focusUnlessInControl, 100);
    const t3 = setTimeout(focusUnlessInControl, 250);
    const t4 = setTimeout(focusUnlessInControl, 500);

    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
    };
  }, [focusUnlessInControl]);

  // Refit when terminal becomes visible; only resize PTY if dimensions changed
  useEffect(() => {
    if (isVisible && termRef.current && fitAddonRef.current) {
      const fitTimer = setTimeout(() => {
        syncPtySize();
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
  }, [isVisible, isFocused, syncPtySize, scheduleFocus]);

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

  /** The xterm terminal, once the pane has mounted. */
  const getTerminal = useCallback(() => termRef.current, []);

  const repaintTerminal = useCallback(() => {
    repaintTerminalScreen(termRef.current, (data) =>
      invoke("write_pty", { terminalId, data })
    );
  }, [terminalId]);

  return {
    containerRef,
    term: termRef.current,
    findNext,
    findPrevious,
    clearSearch,
    exportScrollback,
    searchResult,
    focusTerminal,
    repaintTerminal,
    getTerminal,
  };
}
