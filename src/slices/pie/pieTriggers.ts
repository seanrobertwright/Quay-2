// Which presses open the pie menu, and over what. Surfaces say what they are with data
// attributes, so the one document listener that opens the pie reads the page rather than each
// surface wiring its own handler:
//
// - `data-pie-surface`: the opening rules, "pie" (companion, empty stage, module bar: plain
//   right-click opens the pie), "list" (Projects rows, pane headers, Topos: right-click keeps the
//   list menu) or "praxis-canvas" (middle-click keeps pan). The terminal body is found by xterm's
//   own root, and a text field by the native menu's own rule.
// - `data-pie-target`: what a region is, "companion", "companion-pr" (the companion's pull
//   request view), "empty-stage" or "panel" (the module bar and the panel beside it).
// - `data-pie-terminal` and `data-pie-folder`: the terminal and the folder a pane or row is for;
//   `data-pie-row` marks a Projects panel or module bar row, and `data-pie-zoomable` a pane that
//   can zoom.
import { TERMINAL_BODY, TEXT_FIELD } from "../overlay/contextMenuPolicy.ts";
import type { PieTarget } from "./pieRing.ts";

/** How a surface opens the pie. "elsewhere" is any surface that names none. */
export type PieRules = "pie" | "terminal" | "list" | "praxis-canvas" | "text-input" | "elsewhere";

/** The parts of a mouse press the rules read. `button` is the DOM's: 0 left, 1 middle, 2 right. */
export interface PiePress {
  button: number;
  altKey: boolean;
  shiftKey: boolean;
}

/**
 * Whether `press` opens the pie on a surface with `rules`; `mouseReporting` is whether the
 * terminal's program has turned on mouse reporting. Shift+Right-click never opens it: it is the
 * terminal body's list menu, and outside the terminal a dev build's Inspect.
 */
export function opensPie(press: PiePress, rules: PieRules, mouseReporting: boolean): boolean {
  if (rules === "text-input") return false;
  if (press.button === 2) {
    if (press.shiftKey) return false;
    return press.altKey || rules === "pie";
  }
  if (press.button === 1) {
    if (rules === "praxis-canvas") return false;
    return rules !== "terminal" || !mouseReporting || press.shiftKey;
  }
  return false;
}

/** Where a press landed: the rules that apply there, the terminal's mouse reporting, and what the pie acts on. */
export interface PiePlace {
  rules: PieRules;
  mouseReporting: boolean;
  target: PieTarget;
}

const RULES = new Set<string>(["pie", "list", "praxis-canvas"]);

function rulesAt(el: Element): PieRules {
  if (el.closest(TERMINAL_BODY)) return "terminal";
  if (el.closest(TEXT_FIELD)) return "text-input";
  const surface = el.closest("[data-pie-surface]")?.getAttribute("data-pie-surface") ?? "";
  return RULES.has(surface) ? (surface as PieRules) : "elsewhere";
}

function targetAt(el: Element): PieTarget {
  const row = el.closest("[data-pie-row]");
  if (row) {
    const folder = row.getAttribute("data-pie-folder") ?? "";
    const terminalId = row.getAttribute("data-pie-terminal");
    return { surface: "panel", row: terminalId ? { kind: "terminal", terminalId, folder } : { kind: "folder", folder } };
  }
  const pane = el.closest("[data-pie-terminal]");
  const terminalId = pane?.getAttribute("data-pie-terminal");
  if (terminalId) return { surface: "terminal", terminalId, zoomable: pane?.hasAttribute("data-pie-zoomable") === true };
  switch (el.closest("[data-pie-target]")?.getAttribute("data-pie-target")) {
    case "companion":
      return { surface: "companion" };
    case "companion-pr":
      return { surface: "companion-pr" };
    case "empty-stage":
      return { surface: "empty-stage" };
    case "panel":
      return { surface: "panel", row: null };
    default:
      return { surface: "other" };
  }
}

/** What a press on `el` would open the pie over, and under which rules. */
export function piePlaceAt(el: Element): PiePlace {
  const rules = rulesAt(el);
  const mouseReporting = rules === "terminal" && el.closest(TERMINAL_BODY)?.classList.contains("enable-mouse-events") === true;
  return { rules, mouseReporting, target: targetAt(el) };
}
