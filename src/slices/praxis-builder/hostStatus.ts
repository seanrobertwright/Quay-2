// What the template form and the Install on host… dialog show of one workflow template's state on
// the Praxis host (#363, #451). It renders the host catalog's model (#449) and adds no state of
// its own: Check again asks the catalog, whose reads go through the Praxis CLI runner (#446).
import type { TemplateHostState, TemplateHostView } from "./hostCatalog.ts";
import { HOST_STATE_LABELS, HOST_STATE_TONES, hostStateReason, minutesSince, type HostBadgeTone, type ShownHostState } from "./hostList.ts";
import { hostConditionView } from "./hostCondition.ts";
import type { HostCondition } from "./praxisHost.ts";

/** The status line beside Install on host…. */
export interface TemplateStatusLine {
  /** The state shown, as the list's badge has it; `unknown` while the host can't be used. */
  state: ShownHostState;
  /** Its colour, which never carries the state alone: `label` does. */
  tone: HostBadgeTone;
  /** The state's text label, which carries it without colour. */
  label: string;
  /** The host's reason, or what the failed read said; null when there is none. */
  reason: string | null;
  /** "checked N min ago", from the reading's stamp; null when nothing was read. */
  checked: string | null;
  /** True when Check again is offered. */
  checkAgain: boolean;
  /** True while a read that will update this template is in flight. */
  checking: boolean;
  /** True once the reading is old enough that the state may be out of date. */
  muted: boolean;
}

/** Template `view`'s status line, under the project's host `condition`, at `now`. */
export function templateStatusLine(view: TemplateHostView, condition: HostCondition, now: number): TemplateStatusLine {
  const { state } = view;
  // While the host condition holds, the header's Check host is what rereads.
  if (state.kind === "unknown" && state.why === "host") {
    return { state: "unknown", tone: "neutral", label: `Host state unknown: ${hostConditionView(condition).label}`, reason: null, checked: null, checkAgain: false, checking: false, muted: false };
  }
  const shown = state.kind === "unknown" ? (state.why === "notChecked" ? "unknown" : "failed") : state.kind;
  return {
    state: shown,
    tone: HOST_STATE_TONES[shown],
    label: HOST_STATE_LABELS[shown],
    reason: hostStateReason(state),
    checked:
      view.checkedAt === null
        ? null
        : `checked ${minutesSince(view.checkedAt, now)} min ago${view.muted ? ", may be out of date" : ""}`,
    // The catalog never reads a name the host refuses, so there is nothing to check again.
    checkAgain: state.kind !== "nameRefused",
    checking: view.checking,
    muted: view.muted,
  };
}

/** What the Install on host… dialog opens on. */
export type InstallOpening =
  /** The copy steps; `replaces` warns that the host's own copy will be replaced. */
  | { kind: "steps"; replaces: string | null }
  /** The host has the saved file already: no steps. */
  | { kind: "nothingToDo"; message: string }
  /** The host refuses the name: the steps are withheld and `rule` explains why. */
  | { kind: "refused"; message: string; rule: string };

/** The opening of template `name`'s Install dialog in host state `state`. */
export function installOpening(name: string, state: TemplateHostState): InstallOpening {
  switch (state.kind) {
    case "nameRefused":
      return {
        kind: "refused",
        message: `The host refuses the name ${name}, so this file can't be installed. Rename it from the list first.`,
        rule: state.rule,
      };
    case "differs":
      return { kind: "steps", replaces: `The host has a different copy of ${name}. Installing replaces the host's copy with this saved file.` };
    case "invalidOnHost":
      return { kind: "steps", replaces: `The host's copy of ${name} is invalid. Installing replaces it with this saved file.` };
    case "notReady":
      return {
        kind: "nothingToDo",
        message: `The host already has this saved file, so copying it again won't help. The host says it can't run: ${state.reason}`,
      };
    case "installed":
      return { kind: "nothingToDo", message: "The host already has this saved file and can run it. There's nothing to do." };
    case "notInstalled":
    case "unknown":
      return { kind: "steps", replaces: null };
  }
}

/** What the Install dialog notes after Check again, unless the host refuses the name. */
export const INSTALL_HOST_NOTES: readonly string[] = [
  "The host reads its template directory when it starts, so its catalog changes only after a restart.",
  "Quay can say that the host's copy differs from this file, never how: it doesn't read the host's template.",
];
