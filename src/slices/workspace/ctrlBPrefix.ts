/** How long the `Ctrl+Shift+B` prefix waits for its second key before it lapses. */
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
 * The pending half of a `Ctrl+Shift+B` chord (tmux/psmux style). The workspace hook owns one for its
 * whole life, so a re-render between the two keys, which tears down and rebuilds the keydown
 * listener, does not drop the prefix.
 */
export interface CtrlBPrefix {
  /** Whether `Ctrl+Shift+B` was pressed and no later key has ended it, nor has it timed out. */
  readonly pending: boolean;
  /** Starts, or restarts, the prefix window. */
  arm(): void;
  /** Ends the prefix: a chord used it, or a key that is not a chord ended it. */
  end(): void;
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
    end() {
      pending = false;
    },
    dispose() {
      pending = false;
      clearTimer();
    },
  };
}

/** What each `Ctrl+Shift+B` chord does. */
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
  togglePraxisBuilder(): void;
  toggleUpdateModal(): void;
  openA2A(): void;
  focusNextPane(): void;
  toggleZoom(): void;
  unsplit(): void;
  /** `Ctrl+Shift+B 1`..`9`: the zero-based index of the visible terminal to select. */
  selectTerminalAt(index: number): void;
}

/** The parts of a `KeyboardEvent` the chord handler reads and calls. */
export interface ChordKeyEvent {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  /** True for the auto-repeat keydowns the OS sends while a key is held. */
  repeat: boolean;
  target: EventTarget | null;
  preventDefault(): void;
  stopPropagation(): void;
}

/** The action each lower-cased `Ctrl+Shift+B` chord key runs. `1`..`9` are handled apart from this. */
const CHORD_ACTIONS = new Map<string, Exclude<keyof CtrlBActions, "selectTerminalAt">>([
  ["n", "openNewTerminal"],
  ["%", "splitHorizontal"],
  ['"', "splitVertical"],
  ["'", "splitVertical"],
  ["g", "splitGrid"],
  ["s", "openSwarmModal"],
  ["d", "openDiffInspector"],
  ["w", "openNewWorktreeModal"],
  ["i", "toggleGithubDrawer"],
  ["a", "openAuditModal"],
  ["h", "toggleSessionHistory"],
  ["t", "toggleTokenSpend"],
  ["$", "toggleTokenSpend"],
  ["r", "toggleArchonGraph"],
  ["f", "toggleFactoryStation"],
  ["p", "togglePraxisBuilder"],
  ["u", "toggleUpdateModal"],
  ["m", "openA2A"],
  ["o", "focusNextPane"],
  ["z", "toggleZoom"],
  ["x", "unsplit"],
]);

/**
 * Keys that only change the next key, such as `Shift` for `%`, so they leave the prefix pending.
 * `Dead` is a dead key on layouts such as US-International, where `"` starts as one.
 */
const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "AltGraph", "Meta", "CapsLock", "NumLock", "Fn", "Dead"]);

/** The class of the hidden textarea xterm.js focuses to take a pane's keystrokes. */
const XTERM_TEXTAREA_CLASS = "xterm-helper-textarea";

/** `<input>` types that take no typed text, so chords still work while one has focus. */
const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

/**
 * Whether a keydown came from a field the user types into, such as a modal's branch-name input,
 * rather than from a terminal pane. Duck-typed so the handler runs without a DOM in tests. The
 * Praxis Builder's key handler uses it too, so both agree on what a text field is.
 */
export function isTextField(target: EventTarget | null): boolean {
  const el = target as Partial<
    Pick<HTMLElement, "tagName" | "isContentEditable" | "classList"> & Pick<HTMLInputElement, "type">
  > | null;
  if (!el || typeof el.tagName !== "string") return false;
  if (el.classList?.contains(XTERM_TEXTAREA_CLASS)) return false;
  switch (el.tagName.toLowerCase()) {
    case "input":
      return !NON_TEXT_INPUT_TYPES.has((el.type ?? "text").toLowerCase());
    case "textarea":
    case "select":
      return true;
    default:
      return el.isContentEditable === true;
  }
}

/** `Ctrl+Shift+B`, the chord prefix. With Shift held the browser reports `B`. */
function isPrefixKey(e: ChordKeyEvent): boolean {
  return e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === "b";
}

function chordFor(key: string, actions: CtrlBActions): (() => void) | null {
  const action = CHORD_ACTIONS.get(key.toLowerCase());
  if (action) return actions[action];
  const num = parseInt(key, 10);
  if (!isNaN(num) && num >= 1 && num <= 9) return () => actions.selectTerminalAt(num - 1);
  return null;
}

/**
 * Builds the keydown handler for `Ctrl+Shift+B` chords, tmux style. Returns true when it handled,
 * and swallowed, the key; on false the key is left for the terminal or the focused field.
 *
 * - `Ctrl+Shift+B` is swallowed and arms the prefix. Pressing or holding it again restarts the
 *   window. A plain `Ctrl+B` is not the prefix: it goes to the terminal's shell.
 * - A chord key runs its action and ends the prefix. The chord key is pressed without `Ctrl`, so a
 *   `Ctrl` key, such as `Ctrl+A` for the shell, ends the prefix and goes to the terminal instead of
 *   running the `a` chord. A modifier-only key leaves the prefix pending. Any other key ends it and
 *   is left for the terminal.
 * - A key from a text field outside the terminal is always left alone and ends any pending prefix.
 */
export function createCtrlBKeyHandler(
  prefix: CtrlBPrefix,
  actions: CtrlBActions
): (e: ChordKeyEvent) => boolean {
  const swallow = (e: ChordKeyEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  return (e) => {
    if (isTextField(e.target)) {
      prefix.end();
      return false;
    }

    if (isPrefixKey(e)) {
      swallow(e);
      prefix.arm();
      return true;
    }

    if (!prefix.pending || MODIFIER_KEYS.has(e.key)) return false;

    // AltGr on Windows reports Ctrl+Alt and still types a chord key, so only Ctrl without Alt ends it.
    const chord = (e.ctrlKey && !e.altKey) || e.metaKey ? null : chordFor(e.key, actions);
    prefix.end();
    if (!chord) return false;

    swallow(e);
    chord();
    return true;
  };
}
