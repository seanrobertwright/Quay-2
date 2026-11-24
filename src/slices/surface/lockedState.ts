// How a surface that is over says so: in words, with an icon of its own, and by colour.
import { Check, CircleSlash, type LucideIcon } from "lucide-react";
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

/** How `record`, a locked surface, says that it is over. */
export function lockedState({ asks, answered_at, ended_at }: SurfaceRecord): LockedState {
  if (ended_at === null) {
    return { word: "Answered", reason: "Answered and sent to the agent.", Icon: Check, tone: "text-[#3fb950]", at: answered_at };
  }
  const words = asks
    ? { word: "Ended", reason: "The terminal exited before this was answered." }
    : { word: "Stopped", reason: "Stopped: the terminal exited." };
  return { ...words, Icon: CircleSlash, tone: "text-[#8b949e]", at: ended_at };
}
