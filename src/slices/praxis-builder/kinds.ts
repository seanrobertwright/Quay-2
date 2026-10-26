// How each node kind and each record kind looks in the builder.
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
import type { NodeKind } from "./model.ts";
import type { PraxisKind } from "./types.ts";

export interface NodeKindMeta {
  label: string;
  icon: LucideIcon;
  /** Hex colour for the card's strip and kind label. */
  color: string;
}

export const NODE_KIND_META: Record<NodeKind, NodeKindMeta> = {
  TASK: { label: "Task", icon: Cpu, color: "#58a6ff" },
  SUBWORKFLOW: { label: "Subworkflow", icon: Workflow, color: "#79c0ff" },
  LOOP: { label: "Loop", icon: Repeat, color: "#d2a8ff" },
  DECISION: { label: "Decision", icon: Diamond, color: "#e3b341" },
  FORK: { label: "Fork", icon: GitFork, color: "#a5d6ff" },
  JOIN: { label: "Join", icon: Merge, color: "#a5d6ff" },
  WAIT: { label: "Wait", icon: Hourglass, color: "#8b949e" },
  APPROVAL: { label: "Approval", icon: UserCheck, color: "#f0883e" },
  VERIFICATION: { label: "Verification", icon: ShieldCheck, color: "#3fb950" },
  ACCEPTANCE: { label: "Acceptance", icon: BadgeCheck, color: "#3fb950" },
  RECONCILIATION: { label: "Reconciliation", icon: Scale, color: "#56d4dd" },
  COMPENSATION: { label: "Compensation", icon: Undo2, color: "#ff7b72" },
  END: { label: "End", icon: Flag, color: "#c9d1d9" },
};

/** How a node whose kind isn't one of the SDK's thirteen is drawn. */
export const UNKNOWN_KIND_META: NodeKindMeta = { label: "Unknown kind", icon: CircleHelp, color: "#6e7681" };

export function nodeKindMeta(kind: string): NodeKindMeta {
  return Object.prototype.hasOwnProperty.call(NODE_KIND_META, kind)
    ? NODE_KIND_META[kind as NodeKind]
    : UNKNOWN_KIND_META;
}

/** The left list's groups, in order. */
export const RECORD_KINDS: { kind: PraxisKind; label: string; icon: LucideIcon }[] = [
  { kind: "graphs", label: "Graphs", icon: Workflow },
  { kind: "contracts", label: "Contracts", icon: FileText },
  { kind: "grants", label: "Grants", icon: KeyRound },
  { kind: "triggers", label: "Triggers", icon: Timer },
];
