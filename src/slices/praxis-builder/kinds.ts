// How each node kind and each record kind looks in the builder. Each node kind has one
// registry entry (#219) with its palette metadata, a new node's config and the card's
// summary. Its inspector form sits in `ConfigForms.tsx`, keyed by the same kinds, because
// the unit tests run this file under Node, which can't load JSX.
import {
  BadgeCheck,
  CircleHelp,
  Cpu,
  Diamond,
  FileText,
  Flag,
  GitFork,
  Hourglass,
  KeyRound,
  Merge,
  Repeat,
  Scale,
  ShieldCheck,
  Timer,
  Undo2,
  UserCheck,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { isNodeKind, type JsonObject, type NodeKind, type PraxisNode } from "./model.ts";
import type { PraxisKind } from "./types.ts";

export interface NodeKindMeta {
  label: string;
  icon: LucideIcon;
  /** Hex colour for the card's strip and kind label. */
  color: string;
}

/** The palette strip's groups, in order. */
export const PALETTE_GROUPS = ["Work", "Flow", "Gates", "Finish"] as const;
export type PaletteGroup = (typeof PALETTE_GROUPS)[number];

export interface NodeKindEntry extends NodeKindMeta {
  group: PaletteGroup;
  /** One line on what the kind does, for the palette's tooltip and the inspector. */
  blurb: string;
  /** The config keys the SDK requires for the kind; every other kind's config is `{}`. */
  configKeys: readonly string[];
  /** A new node's config, as a fresh object. */
  defaultConfig: () => JsonObject;
  /** The one-line config summary a card shows under the node id, or "" for none. */
  summary: (config: JsonObject) => string;
}

/** The values the SDK accepts for a TASK's `executionKind`. */
export const EXECUTION_KINDS = ["AGENT", "FUNCTION", "TOOL", "HUMAN"] as const;
/** The values the SDK accepts for a JOIN's `mode`. */
export const JOIN_MODES = ["ALL", "ANY"] as const;

const noConfig = { configKeys: [], defaultConfig: () => ({}), summary: () => "" };

export const NODE_KINDS_REGISTRY: Record<NodeKind, NodeKindEntry> = {
  TASK: {
    label: "Task",
    icon: Cpu,
    color: "#58a6ff",
    group: "Work",
    blurb: "Does a unit of work by an agent, a function, a tool or a person.",
    configKeys: ["executionKind"],
    defaultConfig: () => ({ executionKind: "AGENT" }),
    summary: (c) => (typeof c.executionKind === "string" && c.executionKind ? c.executionKind : "no execution kind"),
  },
  SUBWORKFLOW: {
    label: "Subworkflow",
    icon: Workflow,
    color: "#79c0ff",
    group: "Work",
    blurb: "Runs another graph as one step.",
    ...noConfig,
  },
  LOOP: {
    label: "Loop",
    icon: Repeat,
    color: "#d2a8ff",
    group: "Work",
    blurb: "Repeats until done, up to a limit.",
    configKeys: ["maxIterations"],
    defaultConfig: () => ({ maxIterations: "3" }),
    // The SDK stores a decimal string; a hand-edited number still shows what it says.
    summary: (c) =>
      (typeof c.maxIterations === "string" && c.maxIterations) || typeof c.maxIterations === "number"
        ? `≤ ${c.maxIterations} iterations`
        : "no iteration limit",
  },
  DECISION: {
    label: "Decision",
    icon: Diamond,
    color: "#e3b341",
    group: "Flow",
    blurb: "Goes to then or else, by a field of its result.",
    configKeys: ["field", "equals", "then", "else"],
    defaultConfig: () => ({ field: "", equals: true, then: "", else: "" }),
    summary: (c) => (typeof c.field === "string" && c.field ? `${c.field} == ${JSON.stringify(c.equals ?? null)}` : "no field"),
  },
  FORK: { label: "Fork", icon: GitFork, color: "#a5d6ff", group: "Flow", blurb: "Starts parallel branches.", ...noConfig },
  JOIN: {
    label: "Join",
    icon: Merge,
    color: "#a5d6ff",
    group: "Flow",
    blurb: "Waits for all or any of the nodes it depends on.",
    configKeys: ["mode"],
    defaultConfig: () => ({ mode: "ALL" }),
    summary: (c) => `wait for ${c.mode === "ANY" ? "any" : "all"}`,
  },
  WAIT: {
    label: "Wait",
    icon: Hourglass,
    color: "#8b949e",
    group: "Flow",
    blurb: "Pauses until an outside event happens.",
    ...noConfig,
  },
  APPROVAL: {
    label: "Approval",
    icon: UserCheck,
    color: "#f0883e",
    group: "Gates",
    blurb: "Stops for a person to approve.",
    ...noConfig,
  },
  VERIFICATION: {
    label: "Verification",
    icon: ShieldCheck,
    color: "#3fb950",
    group: "Gates",
    blurb: "Checks the work against evidence.",
    ...noConfig,
  },
  ACCEPTANCE: {
    label: "Acceptance",
    icon: BadgeCheck,
    color: "#3fb950",
    group: "Gates",
    blurb: "Records that the criteria are met.",
    ...noConfig,
  },
  RECONCILIATION: {
    label: "Reconciliation",
    icon: Scale,
    color: "#56d4dd",
    group: "Finish",
    blurb: "Brings records back in step.",
    ...noConfig,
  },
  COMPENSATION: {
    label: "Compensation",
    icon: Undo2,
    color: "#ff7b72",
    group: "Finish",
    blurb: "Undoes earlier effects.",
    ...noConfig,
  },
  END: { label: "End", icon: Flag, color: "#c9d1d9", group: "Finish", blurb: "The graph finishes here.", ...noConfig },
};

/** How a node whose kind isn't one of the SDK's thirteen is drawn. */
export const UNKNOWN_KIND_META: NodeKindMeta = { label: "Unknown kind", icon: CircleHelp, color: "#6e7681" };

export function nodeKindMeta(kind: string): NodeKindMeta {
  return isNodeKind(kind) ? NODE_KINDS_REGISTRY[kind] : UNKNOWN_KIND_META;
}

/** The one-line config summary a card shows under the node id, or "" for none. */
export function configSummary(node: PraxisNode): string {
  return isNodeKind(node.kind) ? NODE_KINDS_REGISTRY[node.kind].summary(node.config) : "";
}

/** The left list's groups, in order. */
export const RECORD_KINDS: { kind: PraxisKind; label: string; icon: LucideIcon }[] = [
  { kind: "graphs", label: "Graphs", icon: Workflow },
  { kind: "contracts", label: "Contracts", icon: FileText },
  { kind: "grants", label: "Grants", icon: KeyRound },
  { kind: "triggers", label: "Triggers", icon: Timer },
];
