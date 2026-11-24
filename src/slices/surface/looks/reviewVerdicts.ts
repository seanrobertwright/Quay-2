// How each verdict of a review says so: in words, with an icon of its own, and by colour.
import { Check, MessageSquareWarning, X } from "lucide-react";
import type { ReviewVerdict } from "../typed/review.ts";
import type { SettledWords } from "./settledWords.ts";

const VERDICTS: ReadonlyMap<string, SettledWords> = new Map<ReviewVerdict, SettledWords>([
  ["approved", { word: "Approved", Icon: Check, tone: "text-[#3fb950]" }],
  ["changes_requested", { word: "Changes requested", Icon: MessageSquareWarning, tone: "text-[#e3b341]" }],
  ["rejected", { word: "Rejected", Icon: X, tone: "text-[#ff7b72]" }],
]);

/** How a review with this answer says what was decided, or null when the answer is none of a review's. */
export function verdictWords(answer: unknown): SettledWords | null {
  const verdict = typeof answer === "object" && answer !== null && "verdict" in answer ? answer.verdict : null;
  return VERDICTS.get(String(verdict)) ?? null;
}
