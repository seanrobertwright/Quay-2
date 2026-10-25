// PROTOTYPE (#226) — throwaway. Per-kind palette metadata, the shape #219 recommends
// (one registry entry per kind) with only what the canvas needs.
import {
  BadgeCheck,
  Cpu,
  Diamond,
  Flag,
  GitFork,
  Hourglass,
  Merge,
  Repeat,
  Scale,
  ShieldCheck,
  Undo2,
  UserCheck,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { Kind } from "./model";

export interface KindMeta {
  label: string;
  icon: LucideIcon;
  color: string; // hex, used for accents
  blurb: string;
  group: "Work" | "Flow" | "Gates" | "Finish";
}

export const KIND_META: Record<Kind, KindMeta> = {
  TASK: { label: "Task", icon: Cpu, color: "#58a6ff", blurb: "Do a unit of work by an agent, function, tool or human.", group: "Work" },
  SUBWORKFLOW: { label: "Subworkflow", icon: Workflow, color: "#79c0ff", blurb: "Run another graph as one step.", group: "Work" },
  LOOP: { label: "Loop", icon: Repeat, color: "#d2a8ff", blurb: "Repeat until done, up to a limit.", group: "Work" },
  DECISION: { label: "Decision", icon: Diamond, color: "#e3b341", blurb: "Pick then or else from a result field.", group: "Flow" },
  FORK: { label: "Fork", icon: GitFork, color: "#a5d6ff", blurb: "Start parallel branches.", group: "Flow" },
  JOIN: { label: "Join", icon: Merge, color: "#a5d6ff", blurb: "Wait for all or any incoming nodes.", group: "Flow" },
  WAIT: { label: "Wait", icon: Hourglass, color: "#8b949e", blurb: "Pause until an outside event is satisfied.", group: "Flow" },
  APPROVAL: { label: "Approval", icon: UserCheck, color: "#f0883e", blurb: "Stop for a human approval.", group: "Gates" },
  VERIFICATION: { label: "Verification", icon: ShieldCheck, color: "#3fb950", blurb: "Check the work against evidence.", group: "Gates" },
  ACCEPTANCE: { label: "Acceptance", icon: BadgeCheck, color: "#3fb950", blurb: "Record that the criteria are met.", group: "Gates" },
  RECONCILIATION: { label: "Reconciliation", icon: Scale, color: "#56d4dd", blurb: "Bring records back in step.", group: "Finish" },
  COMPENSATION: { label: "Compensation", icon: Undo2, color: "#ff7b72", blurb: "Undo earlier effects.", group: "Finish" },
  END: { label: "End", icon: Flag, color: "#c9d1d9", blurb: "The graph finishes here.", group: "Finish" },
};

export const KIND_GROUPS: KindMeta["group"][] = ["Work", "Flow", "Gates", "Finish"];
