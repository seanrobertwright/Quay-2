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
  /** The state's short name. */
  label: string;
  /** The badge's text equivalent for screen readers. */
  text: string;
  /** The tooltip: the state and the host's reason, when there is one. */
  title: string;
  tone: HostBadgeTone;
  /** True when the reading is old enough that the state may be out of date. */
  muted: boolean;
}

const LABELS: Record<KnownHostState | "failed", string> = {
  nameRefused: "Name the host refuses",
  notInstalled: "Not installed",
  invalidOnHost: "Invalid on host",
  differs: "Differs from host",
  notReady: "Installed, not ready",
  installed: "Installed",
  failed: "Couldn't check",
};

const TONES: Record<KnownHostState | "failed", HostBadgeTone> = {
  nameRefused: "error",
  invalidOnHost: "error",
  notInstalled: "attention",
  differs: "attention",
  notReady: "attention",
  installed: "muted",
  failed: "neutral",
};

/** What the host or the read said about a state, for the tooltip. */
function reasonOf(state: TemplateHostState): string | null {
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

/** One template's host badge, or null when its host state is unknown and not shown. */
export function hostBadge(id: string, view: TemplateHostView, now: number): HostBadge | null {
  const { state } = view;
  if (state.kind === "unknown" && state.why !== "failed") return null;
  const kind = state.kind === "unknown" ? "failed" : state.kind;
  const label = LABELS[kind];
  const reason = reasonOf(state);
  const title = reason ? `${label}. ${reason}` : label;
  if (!view.muted) return { state: kind, label, text: `${id} on the host: ${label}`, title, tone: TONES[kind], muted: false };
  const minutes = view.checkedAt === null ? null : Math.max(0, Math.floor((now - view.checkedAt) / 60_000));
  const stale = minutes === null ? "May be out of date." : `May be out of date: checked ${minutes} min ago.`;
  return {
    state: kind,
    label,
    text: `${id} on the host: ${label}, may be out of date`,
    title: `${title}${title.endsWith(".") ? "" : "."} ${stale}`,
    tone: TONES[kind],
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
  /** The host chip's terminal action for the condition, such as Sign in; null for none. */
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
    action: panel?.kind === "terminal" ? panel.action : null,
    linkCli: panel?.kind === "linkCli" ? { text: panel.text, reason: panel.reason } : null,
  };
}

/** A read-only row of the On host only subsection. */
export interface HostOnlyRow {
  name: string;
  /** True when `list` reports the host's copy as invalid. */
  invalid: boolean;
  /** The invalid badge's text equivalent. */
  invalidText: string;
  template: HostOnlyTemplate;
}

/** The On host only subsection: its title with the count, and its rows by name. */
export interface HostOnlySection {
  title: string;
  rows: HostOnlyRow[];
}

/**
 * The collapsed subsection that ends the Workflow templates group, or null when the latest
 * reading found no host template without a local file.
 */
export function hostOnlySection(templates: readonly HostOnlyTemplate[]): HostOnlySection | null {
  if (templates.length === 0) return null;
  const rows = [...templates]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((t) => ({ name: t.name, invalid: !t.valid, invalidText: `${t.name} is invalid on the host`, template: t }));
  return { title: `On host only (${rows.length})`, rows };
}

/** The read-only panel of a host-only template: what the latest `list` said of it. */
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
