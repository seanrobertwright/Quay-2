// quay_board's two pure functions, and the names of its parts. A board's title, its status and its clock
// are the frame's, and no part of it.
import type { Step } from "../../parts/steps.ts";
import type { CreateSurface, SurfaceComponent } from "../surfaceTypes.ts";

/** A checked `quay_board` call. Mirrors `Board`. */
export interface BoardArguments {
  title: string;
  steps: Step[];
  progress?: { done: number; total: number };
  stats: { label: string; value: string }[];
  status: "running" | "done" | "failed";
}

/** The part that holds the steps, when there are any. */
export const STEPS_PART = "steps";

/** The part that says how much is done, when the agent counts. */
export const PROGRESS_PART = "progress";

const STAT_PART = /^stat_\d+$/;

/** The parts that hold the stats of a surface `expand` made, in order. */
export const statParts = (components: readonly SurfaceComponent[]): string[] => components.map(({ id }) => id).filter((id) => STAT_PART.test(id));

export function expand({ steps, progress, stats }: BoardArguments, surfaceId: string): CreateSurface {
  const parts: SurfaceComponent[] = [
    ...(steps.length > 0 ? [{ id: STEPS_PART, component: "Steps", steps }] : []),
    ...(progress ? [{ id: PROGRESS_PART, component: "Progress", ...progress }] : []),
    ...stats.map((stat, i) => ({ id: `stat_${i}`, component: "Stat", ...stat })),
  ];
  const root = { id: "root", component: "Column", children: parts.map(({ id }) => id) };
  return { version: "1.0", createSurface: { surfaceId, components: [root, ...parts], dataModel: {} } };
}

/** A board has no action, so there is none to make a result of. */
export function collapse(): never {
  throw new Error("Not sent: a board sends nothing back.");
}
