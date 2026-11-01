// What the Workflow templates list shows of the Praxis host (#363, #450): each row's badges, the
// group header and the On host only subsection. It renders the host catalog's model (#449) and
// the host condition's view (#448), and adds no host state of its own.
import type { HostOnlyTemplate, KnownHostState, TemplateHostState, TemplateHostView } from "./hostCatalog.ts";
import { hostConditionView, type HostAction, type HostTone } from "./hostCondition.ts";
import type { HostCondition } from "./praxisHost.ts";
import type { ChangeStatus } from "./types.ts";

/** A host badge's colour. It never carries the state alone: `text` does. */
export type HostBadgeTone = "error" | "attention" | "muted" | "neutral";

/** One template's host badge. */
export interface HostBadge {
  /** The state it shows, or `failed` when the last read failed. */
  state: KnownHostState | "failed";
  /** The badge's text equivalent for screen readers. */
  text: string;
  /** The tooltip: the state and the host's reason, when there is one. */
  title: string;
  tone: HostBadgeTone;
  /** True when the reading is old enough that the state may be out of date. */
  muted: boolean;
}

/** Each host state's text label, which carries the state without its colour. */
export const HOST_STATE_LABELS: Record<KnownHostState | "failed", string> = {
  nameRefused: "Name the host refuses",
  notInstalled: "Not installed",
  invalidOnHost: "Invalid on host",
  differs: "Differs from host",
  notReady: "Installed, not ready",
  installed: "Installed",
  failed: "Couldn't check",
};

/** Each host state's colour: states that need attention are coloured, Installed is muted. */
export const HOST_STATE_TONES: Record<KnownHostState | "failed", HostBadgeTone> = {
  nameRefused: "error",
  invalidOnHost: "error",
  notInstalled: "attention",
  differs: "attention",
  notReady: "attention",
  installed: "muted",
  failed: "neutral",
};

/** What the host or the read said about a state, or null when it said nothing. */
export function hostStateReason(state: TemplateHostState): string | null {
  switch (state.kind) {
    case "nameRefused":
      return state.rule;
    case "invalidOnHost":
      return state.diagnostics.length > 0 ? state.diagnostics.join(" ") : null;
    case "notReady":
      return state.reason;
    case "unknown":
      return state.message ?? null;
    default:
      return null;
  }
}

/** Whole minutes from a reading's stamp to `now`, both in ms since the epoch; never negative. */
export function minutesSince(checkedAt: number, now: number): number {
  return Math.max(0, Math.floor((now - checkedAt) / 60_000));
}

/** One template's host badge, or null when its host state is unknown and not shown. */
export function hostBadge(id: string, view: TemplateHostView, now: number): HostBadge | null {
  const { state } = view;
  if (state.kind === "unknown" && state.why !== "failed") return null;
  const kind = state.kind === "unknown" ? "failed" : state.kind;
  const label = HOST_STATE_LABELS[kind];
  const reason = hostStateReason(state);
  const title = reason ? `${label}. ${reason}` : label;
  if (!view.muted) return { state: kind, text: `${id} on the host: ${label}`, title, tone: HOST_STATE_TONES[kind], muted: false };
  const minutes = view.checkedAt === null ? null : minutesSince(view.checkedAt, now);
  const stale = minutes === null ? "May be out of date." : `May be out of date: checked ${minutes} min ago.`;
  return {
    state: kind,
    text: `${id} on the host: ${label}, may be out of date`,
    title: `${title}${title.endsWith(".") ? "" : "."} ${stale}`,
    tone: HOST_STATE_TONES[kind],
    muted: true,
  };
}

/** A row's badges, in the order they are drawn: git state first, host state second. */
export type RowBadge = { kind: "git"; status: ChangeStatus } | { kind: "host"; badge: HostBadge };

/** The badges of template `id`'s row: its change since the last commit, then its host state. */
export function rowBadges(id: string, changed: ChangeStatus | undefined, host: TemplateHostView, now: number): RowBadge[] {
  const badges: RowBadge[] = [];
  if (changed) badges.push({ kind: "git", status: changed });
  const badge = hostBadge(id, host, now);
  if (badge) badges.push({ kind: "host", badge });
  return badges;
}

/** The Workflow templates group header's host part. */
export interface HostGroupHeader {
  /** The host-level condition's text label. */
  condition: string;
  tone: HostTone;
  /** The button that rereads everything. */
  checkHostLabel: "Check host";
  /** Sign in, the host chip's action, when the condition is Not signed in; null otherwise. */
  action: HostAction | null;
  /** How to link the praxis CLI, when it can't be run; null otherwise. */
  linkCli: { text: string; reason: string } | null;
}

/** The group header for `condition`, drawn from the same view as the host chip. */
export function hostGroupHeader(condition: HostCondition): HostGroupHeader {
  const view = hostConditionView(condition);
  const { panel } = view;
  return {
    condition: view.label,
    tone: view.tone,
    checkHostLabel: "Check host",
    // #363 asks the header for Sign in only. The chip keeps its other actions, such as Start host.
    action: condition.state === "notSignedIn" && panel?.kind === "terminal" ? panel.action : null,
    linkCli: panel?.kind === "linkCli" ? { text: panel.text, reason: panel.reason } : null,
  };
}

/** A read-only row of the On host only subsection. */
export interface HostOnlyRow {
  name: string;
  /** The invalid badge, when `list` reports the host's copy as invalid; null otherwise. */
  invalid: HostBadge | null;
  template: HostOnlyTemplate;
}

/** The most On host only rows the subsection draws. */
export const HOST_ONLY_LIMIT = 100;

/** The On host only subsection: its title with the count, and its first rows by name. */
export interface HostOnlySection {
  /** Counts every host-only template, including the ones not drawn. */
  title: string;
  /** At most `HOST_ONLY_LIMIT` rows, by name. */
  rows: HostOnlyRow[];
  /** How many host-only templates are past the limit and not drawn. */
  omitted: number;
}

const invalidBadge = (name: string): HostBadge => ({
  state: "invalidOnHost",
  text: `${name} is invalid on the host`,
  title: HOST_STATE_LABELS.invalidOnHost,
  tone: HOST_STATE_TONES.invalidOnHost,
  muted: false,
});

/**
 * The collapsed subsection that ends the Workflow templates group, or null when the latest
 * reading found no host template without a local file.
 */
export function hostOnlySection(templates: readonly HostOnlyTemplate[]): HostOnlySection | null {
  if (templates.length === 0) return null;
  const rows = [...templates]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .slice(0, HOST_ONLY_LIMIT)
    .map((t) => ({ name: t.name, invalid: t.valid ? null : invalidBadge(t.name), template: t }));
  return { title: `On host only (${templates.length})`, rows, omitted: templates.length - rows.length };
}

/**
 * The read-only panel of a host-only template: what the latest `list` said of it. It has no
 * readiness: #363 shows readiness only once a `show` has run, and the catalog (#449) runs `show`
 * for local templates only, so none has run for a host-only one. This list adds no reads.
 */
export function hostOnlyDetails(template: HostOnlyTemplate): { label: string; value: string }[] {
  const validity = template.valid
    ? "Valid"
    : template.diagnostics.length > 0
      ? `Invalid. ${template.diagnostics.join(" ")}`
      : "Invalid";
  return [
    { label: "Description", value: template.description ?? "None given" },
    { label: "Revision", value: template.revision === null ? "Not given" : String(template.revision) },
    { label: "Validity", value: validity },
  ];
}
