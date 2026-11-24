import type { LucideIcon } from "lucide-react";

/** How a settled surface says what its answer is. */
export interface SettledWords {
  /** In a word. */
  word: string;
  Icon: LucideIcon;
  /** The colour, as a class. */
  tone: string;
}
