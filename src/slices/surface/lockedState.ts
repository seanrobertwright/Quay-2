// How a locked surface says so: in words, with an icon of its own, and by colour.
import { Check, CircleSlash, type LucideIcon } from "lucide-react";
import { lookOf } from "./looks/index.ts";
import type { SurfaceRecord } from "./surfaceTypes.ts";

export interface LockedState {
  /** In a word, for a line. */
  word: string;
  /** In a sentence, for the band under the header. */
  reason: string;
  Icon: LucideIcon;
  /** The colour, as a class. */
  tone: string;
  /** When it locked, in milliseconds since the epoch, or null when that is not known. */
  at: number | null;
}

/** How `record`, a locked surface, says so. */
export function lockedState({ tool, asks, answer, answered_at, ended_at }: SurfaceRecord): LockedState {
  if (ended_at === null) {
    const words = lookOf(tool).settledWords(answer);
    if (words) return { ...words, reason: `${words.word} and sent to the agent.`, at: answered_at };
    return { word: "Answered", reason: "Answered and sent to the agent.", Icon: Check, tone: "text-[#3fb950]", at: answered_at };
  }
  const reason = asks ? "The terminal exited before this was answered." : "Stopped: the terminal exited.";
  return { word: "Ended", reason, Icon: CircleSlash, tone: "text-[#8b949e]", at: ended_at };
}
