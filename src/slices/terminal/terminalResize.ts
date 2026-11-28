import type { Terminal } from "@xterm/xterm";

/** Container dimensions and xterm fit target needed to sync a terminal's PTY size. */
export interface TerminalSizeTarget {
  container: { clientWidth: number; clientHeight: number } | null;
  term: (Pick<Terminal, "rows" | "cols"> & Partial<Pick<Terminal, "options" | "buffer">>) | null;
  fitAddon: { fit: () => void; proposeDimensions?: () => { cols: number; rows: number } | undefined } | null;
  isVisible: boolean;
}

/** Mutable size state tracked across fits for a terminal pane. */
export interface PtySizeState {
  rows: number;
  cols: number;
}

/** Side effects performed when syncing a terminal's PTY size. */
export interface SyncPtyCallbacks {
  onSizeChanged: (rows: number, cols: number) => void;
  resizePty: (rows: number, cols: number) => Promise<unknown>;
}

/**
 * Preserves normal-screen viewport lines across ConPTY column-count resizes on Windows.
 * When column count changes, ConPTY repaints its own truncated/reflowed viewport at `\x1b[H`
 * and drops scrolled-off lines; this guard disables xterm reflow during the fit and reconciles
 * the pre-resize viewport with ConPTY's repaint so no lines are lost or duplicated.
 */
export interface ColumnResizeGuard {
  fit: (
    term: NonNullable<TerminalSizeTarget["term"]>,
    fitAddon: NonNullable<TerminalSizeTarget["fitAddon"]>,
    lastCols: number
  ) => void;
  write: (term: Pick<Terminal, "rows" | "write">, data: string, callback?: () => void) => void;
}

function extractViewportLines(term: Pick<Terminal, "rows"> & { buffer: Terminal["buffer"] }): string[] {
  const buf = term.buffer.active;
  const lines: string[] = [];
  for (let i = buf.baseY; i < buf.baseY + term.rows; i++) {
    const line = buf.getLine(i);
    if (!line) continue;
    if (line.isWrapped && lines.length > 0) lines[lines.length - 1] += line.translateToString(true);
    else lines.push(line.translateToString(true));
  }
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
  return lines;
}

function repaintLines(chunk: string): string[] {
  const clean = chunk.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
  const lines = clean.split(/\r?\n/).map((s) => s.trimEnd());
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function overlapPrefix(before: string[], after: string[]): string[] {
  const nonEmptyAfter = after.filter((l) => l.trim() !== "");
  if (nonEmptyAfter.length === 0) return before;
  let bestIndex = before.length;
  let bestScore = 0;
  for (let i = 0; i < before.length; i++) {
    let score = 0;
    while (
      i + score < before.length &&
      score < nonEmptyAfter.length &&
      before[i + score].trimEnd() === nonEmptyAfter[score].trimEnd()
    ) {
      score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  return bestScore > 0 ? before.slice(0, bestIndex) : before;
}

/** Creates a per-terminal guard that keeps scrollback and viewport aligned across ConPTY column resizes. */
export function createColumnResizeGuard(): ColumnResizeGuard {
  let pendingBefore: string[] | null = null;

  return {
    fit(term, fitAddon, lastCols) {
      const windowsPty = term.options?.windowsPty;
      const isNormalConpty = windowsPty?.backend === "conpty" && term.buffer?.active?.type === "normal";
      const proposed = isNormalConpty && lastCols > 0 ? fitAddon.proposeDimensions?.() : undefined;
      if (proposed && proposed.cols !== lastCols && term.options && term.buffer) {
        // Temporarily suppress xterm reflow during the resize so lines stay in scrollback rather than
        // being pulled back into the viewport or re-wrapped before ConPTY's repaint arrives.
        term.options.windowsPty = { backend: "conpty", buildNumber: 1 };
        try {
          fitAddon.fit();
        } finally {
          term.options.windowsPty = windowsPty;
        }
        pendingBefore = extractViewportLines({ rows: term.rows, buffer: term.buffer });
        return;
      }
      fitAddon.fit();
    },
    write(term, data, callback) {
      if (pendingBefore !== null && (data.includes("\x1b[H") || data.includes("\x1b[1;1H"))) {
        const prefix = overlapPrefix(pendingBefore, repaintLines(data));
        pendingBefore = null;
        const preface =
          prefix.length > 0
            ? `\x1b[2J\x1b[H${prefix.join("\r\n")}${"\r\n".repeat(term.rows)}\x1b[H`
            : "\x1b[2J\x1b[H";
        term.write(preface);
      }
      term.write(data, callback);
    },
  };
}

/**
 * Fits xterm to its container and notifies the PTY backend when `(rows, cols)` changed.
 * Never injects Ctrl+L (`\x0c`); `resize_pty` already signals the PTY to reflow/redraw.
 */
export function syncTerminalSize(
  target: TerminalSizeTarget,
  lastPtySize: PtySizeState,
  callbacks: SyncPtyCallbacks,
  columnGuard?: ColumnResizeGuard
): boolean {
  const { container, term, fitAddon, isVisible } = target;
  if (!container || !term || !fitAddon || !isVisible) return false;
  if (container.clientWidth <= 0 || container.clientHeight <= 0) return false;

  if (columnGuard) columnGuard.fit(term, fitAddon, lastPtySize.cols);
  else fitAddon.fit();
  const rows = term.rows;
  const cols = term.cols;
  if (rows <= 0 || cols <= 0) return false;

  if (rows === lastPtySize.rows && cols === lastPtySize.cols) return false;

  lastPtySize.rows = rows;
  lastPtySize.cols = cols;
  callbacks.onSizeChanged(rows, cols);
  callbacks.resizePty(rows, cols).catch(console.error);
  return true;
}

/**
 * Explicitly clears the xterm buffer and sends Ctrl+L (`\x0c`) to the PTY so the user
 * can manually request a redraw from the pane button or terminal menu.
 */
export function repaintTerminalScreen(
  term: { clear: () => void } | null,
  writePty: (data: string) => Promise<unknown>
): void {
  if (!term) return;
  try {
    term.clear();
    writePty("\x0c").catch(console.error);
  } catch (_) {}
}
