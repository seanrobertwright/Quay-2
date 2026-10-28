// The builder's keys (#248): one table drives the key handler, the hints on buttons and the
// `?` help overlay, so what is documented can't drift from what is wired. The builder
// listens on its modal root in the bubble phase, so Quay's capture-phase keys (`Ctrl/Cmd+K`,
// the `Ctrl+Shift+B` prefix, `Alt+1..9`) always see a key first, and no entry here takes
// one of them.
import { isTextField } from "../workspace/ctrlBPrefix.ts";

/** Everything a builder key can ask for. */
export type BuilderCommand =
  | "save"
  | "escape"
  | "undo"
  | "redo"
  | "copy"
  | "cut"
  | "paste"
  | "duplicate"
  | "delete"
  | "select-all"
  | "fit-view"
  | "zoom-in"
  | "zoom-out"
  | "zoom-reset"
  | "auto-arrange"
  | "help"
  | "go-to-node"
  | "nudge"
  | "select"
  | "add-to-selection"
  | "context-menu";

/**
 * Where a key works. `modal`: anywhere in the builder, text fields included. `outside-text`:
 * anywhere but a text field, which keeps its own keys, native text undo included. `canvas`:
 * only with focus in the canvas, a node included. `node`: only with focus on a node, so a
 * button in the canvas keeps its own Enter and Space.
 */
export type KeyScope = "modal" | "outside-text" | "canvas" | "node";

/** Where focus is when a key is pressed: `node` is a card on the canvas, inside `canvas`. */
export type FocusRegion = "text" | "node" | "canvas" | "other";

export interface KeyChord {
  /** `KeyboardEvent.key`, compared without case. */
  key: string;
  /** Matched on `KeyboardEvent.code` instead of `key`, for keys whose `key` changes with Shift. */
  code?: string;
  /** Ctrl on Windows and Linux, Cmd on macOS. */
  mod?: boolean;
  /** Whether Shift must be held; "any" for a character some layouts type with Shift. */
  shift?: boolean | "any";
}

export interface KeyEntry {
  command: BuilderCommand;
  label: string;
  group: "General" | "Edit" | "Canvas" | "Node";
  scope: KeyScope;
  /** The first chord is the one hints show. */
  chords: readonly [KeyChord, ...KeyChord[]];
}

export const KEY_ENTRIES: readonly KeyEntry[] = [
  { command: "save", label: "Save", group: "General", scope: "modal", chords: [{ key: "s", mod: true }] },
  { command: "go-to-node", label: "Go to a node by id or kind", group: "General", scope: "modal", chords: [{ key: "f", mod: true }] },
  {
    command: "escape",
    label: "Close the help or Go to node, cancel a connection, leave a field, clear the selection, or hide the builder",
    group: "General",
    scope: "modal",
    chords: [{ key: "Escape", shift: "any" }],
  },
  { command: "undo", label: "Undo", group: "Edit", scope: "outside-text", chords: [{ key: "z", mod: true }] },
  {
    command: "redo",
    label: "Redo",
    group: "Edit",
    scope: "outside-text",
    chords: [
      { key: "z", mod: true, shift: true },
      { key: "y", mod: true },
    ],
  },
  {
    command: "copy",
    label: "Copy the selected nodes",
    group: "Canvas",
    scope: "canvas",
    chords: [{ key: "c", mod: true }],
  },
  {
    command: "cut",
    label: "Cut the selected nodes",
    group: "Canvas",
    scope: "canvas",
    chords: [{ key: "x", mod: true }],
  },
  {
    command: "paste",
    label: "Paste nodes from the clipboard",
    group: "Canvas",
    scope: "canvas",
    chords: [{ key: "v", mod: true }],
  },
  {
    command: "duplicate",
    label: "Duplicate the selected nodes",
    group: "Canvas",
    scope: "canvas",
    chords: [{ key: "d", mod: true }],
  },
  {
    command: "delete",
    label: "Delete the focused node or edge, or the selected nodes",
    group: "Canvas",
    scope: "canvas",
    chords: [{ key: "Delete" }, { key: "Backspace" }],
  },
  { command: "select-all", label: "Select all nodes", group: "Canvas", scope: "canvas", chords: [{ key: "a", mod: true }] },
  { command: "fit-view", label: "Fit the graph in view", group: "Canvas", scope: "canvas", chords: [{ key: "1", code: "Digit1", shift: true }] },
  {
    command: "zoom-in",
    label: "Zoom in",
    group: "Canvas",
    scope: "canvas",
    chords: [
      { key: "=", mod: true, shift: "any" },
      { key: "+", mod: true, shift: "any" },
    ],
  },
  { command: "zoom-out", label: "Zoom out", group: "Canvas", scope: "canvas", chords: [{ key: "-", mod: true }] },
  { command: "zoom-reset", label: "Zoom to 100%", group: "Canvas", scope: "canvas", chords: [{ key: "0", mod: true }] },
  { command: "auto-arrange", label: "Auto-arrange the graph", group: "Canvas", scope: "canvas", chords: [{ key: "a", shift: true }] },
  { command: "help", label: "Show these shortcuts", group: "Canvas", scope: "canvas", chords: [{ key: "?", shift: "any" }] },
  {
    command: "nudge",
    label: "Move the selected nodes 8 px, or 40 px with Shift",
    group: "Canvas",
    scope: "canvas",
    chords: [
      { key: "ArrowLeft", shift: "any" },
      { key: "ArrowRight", shift: "any" },
      { key: "ArrowUp", shift: "any" },
      { key: "ArrowDown", shift: "any" },
    ],
  },
  {
    command: "select",
    label: "Select the focused node",
    group: "Node",
    scope: "node",
    chords: [{ key: "Enter" }, { key: " " }],
  },
  {
    command: "add-to-selection",
    label: "Add the focused node to the selection",
    group: "Node",
    scope: "node",
    chords: [{ key: " ", shift: true }],
  },
  {
    command: "context-menu",
    label: "Open the focused node's menu",
    group: "Node",
    scope: "node",
    chords: [{ key: "F10", shift: true }, { key: "ContextMenu" }],
  },
];

/** The parts of a `KeyboardEvent` the router reads. */
export interface KeyLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

/** Whether Quay runs on macOS, where `Mod` is Cmd. */
export const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

function matches(chord: KeyChord, e: KeyLike, isMac: boolean): boolean {
  // Alt never: AltGr reports Ctrl+Alt on Windows, and Alt+digit is Quay's.
  if (e.altKey) return false;
  const mod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  const noMod = !e.ctrlKey && !e.metaKey;
  if (chord.mod ? !mod : !noMod) return false;
  const shift = chord.shift ?? false;
  if (shift !== "any" && shift !== e.shiftKey) return false;
  return chord.code ? e.code === chord.code : e.key.toLowerCase() === chord.key.toLowerCase();
}

const inScope = (scope: KeyScope, region: FocusRegion) =>
  scope === "modal" ||
  (scope === "outside-text" && region !== "text") ||
  (scope === "canvas" && (region === "canvas" || region === "node")) ||
  (scope === "node" && region === "node");

/** The command a key runs with focus in `region`, or null when the key isn't the builder's there. */
export function commandFor(e: KeyLike, region: FocusRegion, isMac: boolean = IS_MAC): BuilderCommand | null {
  for (const entry of KEY_ENTRIES) {
    if (inScope(entry.scope, region) && entry.chords.some((c) => matches(c, e, isMac))) return entry.command;
  }
  return null;
}

/** The canvas region as `focusRegion` sees it. */
export interface CanvasRegion {
  contains: (target: Node | null) => boolean;
  /** Whether the target is a node's card. */
  isNode: (target: Node | null) => boolean;
}

/** Which region focus is in, from the keydown's target and the canvas region. */
export function focusRegion(target: EventTarget | null, canvas: CanvasRegion | null): FocusRegion {
  if (isTextField(target)) return "text";
  if (!canvas || !canvas.contains(target as Node | null)) return "other";
  return canvas.isNode(target as Node | null) ? "node" : "canvas";
}

const KEY_NAMES: Record<string, string> = {
  Escape: "Esc",
  Delete: "Delete",
  Backspace: "Backspace",
  Enter: "Enter",
  " ": "Space",
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ContextMenu: "Menu",
};
/** `aria-keyshortcuts` names keys by `KeyboardEvent.key`, except Space. */
const ARIA_NAMES: Record<string, string> = { " ": "Space" };

function chordParts(chord: KeyChord, isMac: boolean, aria: boolean): string[] {
  const parts: string[] = [];
  if (chord.mod) parts.push(aria ? (isMac ? "Meta" : "Control") : isMac ? "Cmd" : "Ctrl");
  if (chord.shift === true) parts.push("Shift");
  const k = chord.key;
  parts.push(aria ? (ARIA_NAMES[k] ?? (k.length === 1 ? k.toUpperCase() : k)) : (KEY_NAMES[k] ?? k.toUpperCase()));
  return parts;
}

const entryFor = (command: BuilderCommand): KeyEntry => KEY_ENTRIES.find((e) => e.command === command)!;

/** How one chord reads in the help overlay, such as "Ctrl+Shift+Z". */
export const chordLabel = (chord: KeyChord, isMac: boolean = IS_MAC) => chordParts(chord, isMac, false).join("+");

/** The hint for a command, its first chord, such as "Ctrl+S" or "Cmd+S". */
export const shortcutLabel = (command: BuilderCommand, isMac: boolean = IS_MAC) => chordLabel(entryFor(command).chords[0], isMac);

/** A command's `aria-keyshortcuts` value, every chord. */
export const ariaKeyShortcuts = (command: BuilderCommand, isMac: boolean = IS_MAC) =>
  entryFor(command)
    .chords.map((c) => chordParts(c, isMac, true).join("+"))
    .join(" ");
