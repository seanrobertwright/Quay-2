import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface PtyOutputPayload {
  terminal_id: string;
  data: string;
}

export function useTerminal(terminalId: string, isVisible: boolean) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

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
    term.loadAddon(fitAddon);
    term.open(containerRef.current);

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // Send user keystrokes to Rust ConPTY
    const onDataDispose = term.onData((data) => {
      invoke("write_pty", { terminalId, data }).catch((err) => {
        console.error("Failed to write to PTY:", err);
      });
    });

    // Listen for PTY output events from Rust
    const unlistenPromise = listen<PtyOutputPayload>("pty-output", (event) => {
      if (event.payload.terminal_id === terminalId) {
        term.write(event.payload.data);
      }
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
      unlistenPromise.then((unlisten) => unlisten());
      term.dispose();
    };
  }, [terminalId]);

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

  return { containerRef, term: termRef.current };
}
