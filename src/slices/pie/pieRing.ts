// What the pie menu's rings hold over each surface: fixed axes, family diagonals. N, E, S and W
// keep one command everywhere and act on the selected terminal; SE (look closer), SW (write) and
// NW (inspect) act on the thing under the pointer. A command that does not apply leaves its wedge
// empty, and the others never shift. N, E, S and W are parents: a stroke that goes on past the
// first ring picks one of their three second-ring slices. NE is Merge, a parent too, on the
// selected terminal's pull request: it shows wherever that pull request can merge, except on the
// empty stage. Over the companion's pull request the diagonals are Diff lens, Comment and Checks.
import { SLICE_COUNT, WEDGES, type Wedge } from "./pieRecognizer.ts";

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
  | "agents-panel"
  | "prev-wait"
  | "waiting-list"
  | "split-side"
  | "split-stack"
  | "split-grid"
  | "palette-command"
  | "new-claude"
  | "new-codex"
  | "new-pwsh"
  | "merge"
  | "merge-squash"
  | "merge-commit"
  | "merge-rebase"
  | "diff-lens"
  | "comment"
  | "checks";

/** What a wedge's own command does: any action but running a palette command, which only a slice can. */
export type PieCommandAction = Exclude<PieAction, "palette-command">;

/** What a chosen stroke does: an action, or running palette command `commandId`. */
export type PieChoice = { action: PieCommandAction } | { action: "palette-command"; commandId: string };

/** One second-ring slice: what it does and its label. */
export type PieSlice = PieChoice & { label: string };

/**
 * One wedge's command: what it does, its label and the letter that chooses it. A parent also has
 * three second-ring slices, anticlockwise to clockwise, null where a slice is dim.
 */
export interface PieCommand {
  action: PieCommandAction;
  label: string;
  letter: string;
  slices?: readonly (PieSlice | null)[];
}

/** A command the palette ran, as the pie's Palette slices copy it. */
export interface RecentPaletteCommand {
  id: string;
  title: string;
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
  /** The companion's pull request view. */
  | { surface: "companion-pr" }
  | { surface: "other" };

/** A ring: each wedge's command, or null where none applies. Keys are in `WEDGES` order. */
export type PieRing = Record<Wedge, PieCommand | null>;

const command = (action: PieCommandAction, label: string, letter: string, slices?: readonly (PieSlice | null)[]): PieCommand =>
  slices ? { action, label, letter, slices } : { action, label, letter };
const slice = (action: PieCommandAction, label: string): PieSlice => ({ action, label });

const NEXT_WAIT = command("next-wait", "Next wait", "q", [slice("prev-wait", "Prev"), slice("next-wait", "Next"), slice("waiting-list", "Waiting list")]);
const SPLIT = command("split", "Split", "s", [slice("split-side", "Side"), slice("split-stack", "Stack"), slice("split-grid", "Grid")]);
const NEW_TERM = command("new-term", "New term", "n", [slice("new-claude", "Claude"), slice("new-codex", "Codex"), slice("new-pwsh", "Pwsh")]);

/** Palette, whose slices copy the three most recent palette commands, newest first; dim where there are fewer. */
function palette(recent: readonly RecentPaletteCommand[]): PieCommand {
  const slices = Array.from({ length: SLICE_COUNT }, (_, i): PieSlice | null =>
    recent[i] ? { action: "palette-command", label: recent[i].title, commandId: recent[i].id } : null
  );
  return command("palette", "Palette", "p", slices);
}
const ZOOM = command("zoom", "Zoom", "z");
const RENAME = command("rename", "Rename", "r");
const FIND = command("find", "Find", "f");
const SHOW_IN_PANE = command("show-in-pane", "Show in pane", "o");
const OPEN_FOLDER = command("open-folder", "Open folder", "e");
const AGENTS_PANEL = command("agents-panel", "Agents panel", "a");
const MERGE = command("merge", "Merge", "m", [slice("merge-squash", "Squash"), slice("merge-commit", "Commit"), slice("merge-rebase", "Rebase")]);
const DIFF_LENS = command("diff-lens", "Diff lens", "d");
const COMMENT = command("comment", "Comment", "c");
const CHECKS = command("checks", "Checks", "k");

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
    case "companion-pr":
      return { SE: DIFF_LENS, SW: COMMENT, NW: CHECKS };
    case "companion":
    case "other":
      return NONE;
  }
}

/**
 * The ring over `target`, with Palette's slices copying `recent`, the palette's most recent
 * commands, newest first. `mergeable` is whether the selected terminal's pull request can merge.
 */
export function pieRing(target: PieTarget, recent: readonly RecentPaletteCommand[] = [], mergeable = false): PieRing {
  const slots: PieRing = {
    N: NEXT_WAIT,
    NE: mergeable && target.surface !== "empty-stage" ? MERGE : null,
    E: SPLIT,
    S: palette(recent),
    W: NEW_TERM,
    ...diagonals(target),
  };
  return Object.fromEntries(WEDGES.map((wedge) => [wedge, slots[wedge]])) as PieRing;
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
