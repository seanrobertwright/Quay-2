// How a node phase is drawn (#569): the one home of the mapping from a graph run's node phase,
// the `phase` of a node in `aiws-graph-operator-view/1`, to its tone. The node table, the run
// canvas and the node panel draw their chips from it, and the run canvas its cards' borders too.
// The phase is always drawn as its own text, so its tone is never the only sign of it.
// A graph run's follow also asks it which phases are active (#570).
import { hasOwn } from "./model.ts";

/** The tones a node phase is drawn in: `active` for a node the host is working on or waiting out. */
export type NodePhaseTone = "ok" | "error" | "amber" | "active" | "neutral";

/** Each node phase and its tone, in the order of GRAPH-WORKFLOWS.md's "Node phase" table. */
const PHASE_TONES: Readonly<Record<string, NodePhaseTone>> = {
  COMPLETED: "ok",
  SKIPPED: "neutral",
  FAILED: "error",
  HELD: "amber",
  BLOCKED_BY_HOLD: "amber",
  RUNNING: "active",
  PARKED: "active",
  WAITING: "active",
  AWAITING_HUMAN: "amber",
  READY: "neutral",
  NOT_READY: "neutral",
};

/** How `phase` is drawn: its tone, neutral for a phase Quay doesn't know, and whether it is dimmed, as SKIPPED is. */
export function nodePhaseLook(phase: string): { tone: NodePhaseTone; dimmed: boolean } {
  return { tone: hasOwn(PHASE_TONES, phase) ? PHASE_TONES[phase] : "neutral", dimmed: phase === "SKIPPED" };
}

/**
 * True for a phase drawn in the active tone, RUNNING, PARKED or WAITING: the node changes with no
 * one deciding, as the host works on it or it waits out a timer or an outside event. A phase Quay
 * doesn't know isn't active.
 */
export function isActiveNodePhase(phase: string): boolean {
  return nodePhaseLook(phase).tone === "active";
}
