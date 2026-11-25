/** Container dimensions and xterm fit target needed to sync a terminal's PTY size. */
export interface TerminalSizeTarget {
  container: { clientWidth: number; clientHeight: number } | null;
  term: { rows: number; cols: number } | null;
  fitAddon: { fit: () => void } | null;
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
 * Fits xterm to its container and notifies the PTY backend when `(rows, cols)` changed.
 * Never injects Ctrl+L (`\x0c`); `resize_pty` already signals the PTY to reflow/redraw.
 */
export function syncTerminalSize(
  target: TerminalSizeTarget,
  lastPtySize: PtySizeState,
  callbacks: SyncPtyCallbacks
): boolean {
  const { container, term, fitAddon, isVisible } = target;
  if (!container || !term || !fitAddon || !isVisible) return false;
  if (container.clientWidth <= 0 || container.clientHeight <= 0) return false;

  fitAddon.fit();
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
