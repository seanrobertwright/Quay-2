// What a board's line and its head say of it, read from the state its agent sent.
import { amountOf } from "../../parts/amount.ts";
import { stepsIn } from "../../parts/steps.ts";
import type { BoardRun, SurfaceRecord } from "../surfaceTypes.ts";
import { PROGRESS_PART, STEPS_PART } from "../typed/board.ts";

/** A surface that is a board. */
export type BoardRecord = SurfaceRecord & { board: BoardRun };

export const isBoard = (record: SurfaceRecord): record is BoardRecord => record.board !== null;

export interface BoardReading {
  /** The step under way, or the one that failed. Null when there is none, or the board is done. */
  current: string | null;
  /** How many steps are done, or how much is, in words. Null when neither is known. */
  count: string | null;
  /** How much of the bar is filled, from 0 to 1: what is counted, and the steps otherwise. Null for no bar. */
  share: number | null;
}

export function readBoard({ board, state }: BoardRecord): BoardReading {
  const part = (id: string) => state.createSurface.components.find((component) => component.id === id);
  const steps = stepsIn(part(STEPS_PART)?.steps);
  const progress = part(PROGRESS_PART);
  const counted = amountOf(progress?.done, progress?.total);
  const ofSteps = amountOf(steps.filter(({ state }) => state === "done").length, steps.length);
  const active = steps.find(({ state }) => state === "active");
  const failed = steps.find(({ state }) => state === "failed");
  const current = board.status === "failed" ? (failed ?? active) : (active ?? failed);
  return {
    current: board.status === "done" ? null : (current?.label ?? null),
    count: (ofSteps ?? counted)?.words ?? null,
    share: (counted ?? ofSteps)?.share ?? null,
  };
}
