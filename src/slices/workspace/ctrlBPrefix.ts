/** How long a `Ctrl+B` prefix waits for its second key before it lapses. */
export const CTRL_B_PREFIX_TIMEOUT_MS = 1500;

/** The timer functions the prefix uses, so tests can drive the timeout by hand. */
export interface PrefixClock {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const windowClock: PrefixClock = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * The pending half of a `Ctrl+B` chord (tmux/psmux style). The workspace hook owns one for its
 * whole life, so a re-render between the two keys, which tears down and rebuilds the keydown
 * listener, does not drop the prefix.
 */
export interface CtrlBPrefix {
  /** Whether `Ctrl+B` was pressed and no chord has used it or timed it out yet. */
  readonly pending: boolean;
  /** Starts, or restarts, the prefix window. */
  arm(): void;
  /** Ends the prefix because a chord used it. */
  consume(): void;
  /** Ends the prefix and cancels its timer. Called when the hook unmounts. */
  dispose(): void;
}

export function createCtrlBPrefix(clock: PrefixClock = windowClock): CtrlBPrefix {
  let pending = false;
  let timer: unknown = null;

  const clearTimer = () => {
    if (timer !== null) {
      clock.clearTimeout(timer);
      timer = null;
    }
  };

  return {
    get pending() {
      return pending;
    },
    arm() {
      pending = true;
      clearTimer();
      timer = clock.setTimeout(() => {
        pending = false;
        timer = null;
      }, CTRL_B_PREFIX_TIMEOUT_MS);
    },
    consume() {
      pending = false;
    },
    dispose() {
      pending = false;
      clearTimer();
    },
  };
}

/** What each `Ctrl+B` chord does. */
export interface CtrlBActions {
  openNewTerminal(): void;
  splitHorizontal(): void;
  splitVertical(): void;
  splitGrid(): void;
  openSwarmModal(): void;
  openDiffInspector(): void;
  openNewWorktreeModal(): void;
  toggleGithubDrawer(): void;
  openAuditModal(): void;
  toggleSessionHistory(): void;
  toggleTokenSpend(): void;
  toggleArchonGraph(): void;
  toggleFactoryStation(): void;
  toggleUpdateModal(): void;
  openA2A(): void;
  focusNextPane(): void;
  toggleZoom(): void;
  unsplit(): void;
  /** `Ctrl+B 1`..`9`: the zero-based index of the visible terminal to select. */
  selectTerminalAt(index: number): void;
}

/** The parts of a `KeyboardEvent` the chord handler reads and calls. */
export interface ChordKeyEvent {
  key: string;
  ctrlKey: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}

function chordFor(key: string, actions: CtrlBActions): (() => void) | null {
  const lower = key.toLowerCase();
  if (lower === "n") return actions.openNewTerminal;
  if (key === "%") return actions.splitHorizontal;
  if (key === '"' || key === "'") return actions.splitVertical;
  if (lower === "g") return actions.splitGrid;
  if (lower === "s") return actions.openSwarmModal;
  if (lower === "d") return actions.openDiffInspector;
  if (lower === "w") return actions.openNewWorktreeModal;
  if (lower === "i") return actions.toggleGithubDrawer;
  if (lower === "a") return actions.openAuditModal;
  if (lower === "h") return actions.toggleSessionHistory;
  if (lower === "t" || key === "$") return actions.toggleTokenSpend;
  if (lower === "r") return actions.toggleArchonGraph;
  if (lower === "f") return actions.toggleFactoryStation;
  if (lower === "u") return actions.toggleUpdateModal;
  if (lower === "m") return actions.openA2A;
  if (lower === "o") return actions.focusNextPane;
  if (lower === "z") return actions.toggleZoom;
  if (lower === "x") return actions.unsplit;
  const num = parseInt(key, 10);
  if (!isNaN(num) && num >= 1 && num <= 9) return () => actions.selectTerminalAt(num - 1);
  return null;
}

/**
 * Builds the keydown handler for `Ctrl+B` chords. `Ctrl+B` itself is swallowed so xterm never
 * forwards it to the focused pane, where Claude Code would read it as "background the running
 * task". Returns true when it handled the key; any other key, including one pressed while the
 * prefix is pending that is not a chord, is left for the terminal and leaves the prefix pending.
 */
export function createCtrlBKeyHandler(
  prefix: CtrlBPrefix,
  actions: CtrlBActions
): (e: ChordKeyEvent) => boolean {
  return (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === "b") {
      e.preventDefault();
      e.stopPropagation();
      prefix.arm();
      return true;
    }

    if (!prefix.pending) return false;

    const chord = chordFor(e.key, actions);
    if (!chord) return false;

    e.preventDefault();
    e.stopPropagation();
    chord();
    prefix.consume();
    return true;
  };
}
