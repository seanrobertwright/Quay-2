// How a board's state is drawn on its line and in its head.
import { lockedState } from "../lockedState.ts";
import { isLive } from "../surfaceTypes.ts";
import type { BoardRecord, BoardReading } from "./boardReading.ts";

export interface BoardState {
  /** How far it is while it runs, and how it ended after. Null when it runs and does not say how far it is. */
  words: string | null;
  /** The colour of the words, as a class. */
  tone: string;
  /** The colour of the bar, as a class. */
  bar: string;
}

export function boardState(record: BoardRecord, { count }: BoardReading): BoardState {
  if (isLive(record)) return { words: count, tone: "text-[#58a6ff]", bar: "bg-[#58a6ff]" };
  const { word, reason, tone } = lockedState(record);
  if (record.ended_at !== null) return { words: reason, tone, bar: "bg-[#8b949e]" };
  return { words: word, tone, bar: record.board.status === "failed" ? "bg-[#f85149]" : "bg-[#3fb950]" };
}
