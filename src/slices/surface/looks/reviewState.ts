// What the operator has put in a review so far, as its data model holds it.
import { useCallback, useSyncExternalStore } from "react";
import type { SurfaceData } from "../layout.ts";
import { COMMENT, commentOf, keptPath, type ReviewItem } from "../typed/review.ts";

export interface ReviewState {
  /** By item, whether it is kept. */
  kept: boolean[];
  /** Whether there is a comment. Spaces are none. */
  commented: boolean;
}

export function readReview(items: readonly ReviewItem[], data: SurfaceData): ReviewState {
  return {
    kept: items.map((_, i) => data.get(keptPath(i)) === true),
    commented: commentOf(data.get(COMMENT)) !== null,
  };
}

/** How many items are dropped. */
export const droppedOf = ({ kept }: ReviewState): number => kept.filter((isKept) => !isKept).length;

/** `readReview`, drawn again as it changes. `items` is the same list on every draw. */
export function useReview(items: readonly ReviewItem[], data: SurfaceData): ReviewState {
  // As text, because it is compared by value
  const read = useCallback(() => JSON.stringify(readReview(items, data)), [items, data]);
  return JSON.parse(useSyncExternalStore(data.subscribe, read)) as ReviewState;
}
