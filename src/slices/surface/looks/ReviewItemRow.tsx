import type { LayoutProps } from "../layout.ts";
import type { ReviewItem } from "../typed/review.ts";
import { Fold } from "./Fold.tsx";

/** How high an item's folded detail is, in pixels: two of its lines. */
const DETAIL_HEIGHT = 32;

interface ReviewItemRowProps {
  item: ReviewItem;
  kept: boolean;
  part: LayoutProps["part"];
}

/** One item of a review, to keep or drop. A dropped one is struck through. */
export const ReviewItemRow = ({ item: { parts, title, detail, file }, kept, part }: ReviewItemRowProps) => (
  <li data-dropped={kept ? undefined : true} className="flex min-w-0 flex-col gap-0.5 px-2.5 py-2">
    <div className={kept ? "" : "opacity-70 [&_label]:line-through [&_label]:decoration-2"}>{part(parts.keep)}</div>
    {detail !== null && (
      <div className="pl-5 leading-4">
        <Fold height={DETAIL_HEIGHT} more="More" less="Less" of={title}>
          {part(parts.detail)}
        </Fold>
      </div>
    )}
    {file !== null && <div className="min-w-0 pl-5 font-mono text-[11px]">{part(parts.file)}</div>}
  </li>
);
