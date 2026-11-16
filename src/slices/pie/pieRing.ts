// What the pie menu's first ring holds over each surface: fixed axes, family diagonals. N, E, S
// and W keep one command everywhere and act on the selected terminal; SE (look closer), SW
// (write) and NW (inspect) act on the thing under the pointer. A command that does not apply
// leaves its wedge empty, and the others never shift. NE is Merge, and the companion's pull
// request diagonals (Diff lens, Comment, Checks) need a pull request; both come with the Merge
// stroke, so their wedges stay empty for now.
import { WEDGES, type Wedge } from "./pieRecognizer.ts";

/** What a stroke can do. */
export type PieAction =
  | "next-wait"
  | "split"
  | "palette"
  | "new-term"
  | "zoom"
  | "rename"
  | "find"
  | "show-in-pane"
  | "open-folder"
  | "agents-panel";

/** One wedge's command: what it does, its label and the letter that chooses it. */
export interface PieCommand {
  action: PieAction;
  label: string;
  letter: string;
}

/** A Projects panel or module bar row the pie opened over. */
export type PieRow = { kind: "terminal"; terminalId: string; folder: string } | { kind: "folder"; folder: string };

/** What the pie opened over. "panel" is the module bar or a panel; "other" is any other surface. */
export type PieTarget =
  /** A terminal's pane; `zoomable` is false for a lone pane that is not zoomed, which has nothing to zoom. */
  | { surface: "terminal"; terminalId: string; zoomable: boolean }
  | { surface: "panel"; row: PieRow | null }
  | { surface: "empty-stage" }
  | { surface: "companion" }
  | { surface: "other" };

/** A ring: each wedge's command, or null where none applies. Keys are in `WEDGES` order. */
export type PieRing = Record<Wedge, PieCommand | null>;

const command = (action: PieAction, label: string, letter: string): PieCommand => ({ action, label, letter });

const NEXT_WAIT = command("next-wait", "Next wait", "q");
const SPLIT = command("split", "Split", "s");
const PALETTE = command("palette", "Palette", "p");
const NEW_TERM = command("new-term", "New term", "n");
const ZOOM = command("zoom", "Zoom", "z");
const RENAME = command("rename", "Rename", "r");
const FIND = command("find", "Find", "f");
const SHOW_IN_PANE = command("show-in-pane", "Show in pane", "o");
const OPEN_FOLDER = command("open-folder", "Open folder", "e");
const AGENTS_PANEL = command("agents-panel", "Agents panel", "a");

type Diagonals = Pick<PieRing, "SE" | "SW" | "NW">;

const NONE: Diagonals = { SE: null, SW: null, NW: null };

function diagonals(target: PieTarget): Diagonals {
  switch (target.surface) {
    case "terminal":
      return { SE: target.zoomable ? ZOOM : null, SW: RENAME, NW: FIND };
    case "panel":
      if (target.row?.kind === "terminal") return { SE: SHOW_IN_PANE, SW: RENAME, NW: OPEN_FOLDER };
      return target.row ? { ...NONE, NW: OPEN_FOLDER } : NONE;
    case "empty-stage":
      return { ...NONE, NW: AGENTS_PANEL };
    case "companion":
    case "other":
      return NONE;
  }
}

/** The first ring over `target`. */
export function pieRing(target: PieTarget): PieRing {
  const slots: Omit<PieRing, "NE"> = { N: NEXT_WAIT, E: SPLIT, S: PALETTE, W: NEW_TERM, ...diagonals(target) };
  return Object.fromEntries(WEDGES.map((wedge) => [wedge, wedge === "NE" ? null : slots[wedge]])) as PieRing;
}

/** The terminal a stroke acts on: the pane's, or a terminal row's; null elsewhere. */
export function pieTerminalId(target: PieTarget): string | null {
  if (target.surface === "terminal") return target.terminalId;
  return target.surface === "panel" && target.row?.kind === "terminal" ? target.row.terminalId : null;
}

/** The folder a stroke acts on: a Projects panel or module bar row's; null off a row. */
export function pieFolder(target: PieTarget): string | null {
  return target.surface === "panel" && target.row ? target.row.folder : null;
}
