import { useEffect, useId, useMemo } from "react";
import type { LayoutProps } from "../layout.ts";
import { APPROVE_LABEL, approveLabel, BODY_PART, COMMENT_PART, COMMENTED, itemsIn, titleIn, VERDICT_PARTS } from "../typed/review.ts";
import { ReviewItemRow } from "./ReviewItemRow.tsx";
import { droppedOf, readReview, useReview } from "./reviewState.ts";

/** Reject's tint. A red button proper is for Quay's own cards alone. */
const REJECT =
  "[&_button]:border-[#da3633]/50 [&_button]:bg-[#da3633]/10 [&_button]:text-[#ff7b72] [&_button:enabled:hover]:bg-[#da3633]/25";

/**
 * A review: what is reviewed, and the rail that decides it. Beside each other the rail stays in view
 * while the text scrolls; on a narrow stage it is under the text. The items scroll in their own box.
 */
export const ReviewLayout = ({ part, components, data }: LayoutProps) => {
  const itemsId = useId();
  const items = useMemo(() => itemsIn(components), [components]);
  const { kept } = useReview(items, data);
  useEffect(() => {
    const work = () => {
      const state = readReview(items, data);
      const label = approveLabel(droppedOf(state));
      if (data.get(APPROVE_LABEL) !== label) data.set(APPROVE_LABEL, label);
      if (data.get(COMMENTED) !== state.commented) data.set(COMMENTED, state.commented);
    };
    work();
    return data.subscribe(work);
  }, [items, data]);
  return (
    <div className="grid min-w-0 gap-x-6 gap-y-4 @3xl:grid-cols-[minmax(0,1fr)_340px]">
      <div data-review-text className="max-w-[72ch] min-w-0 text-[13px] leading-[21px]">
        {/* Drawn here and not by its Text part, because a title is plain text */}
        <h3 className="mb-2 text-base font-semibold wrap-anywhere whitespace-pre-wrap text-white">{titleIn(components)}</h3>
        {part(BODY_PART)}
      </div>
      <div
        data-review-rail
        role="group"
        aria-label="Your decision"
        className="flex min-w-0 flex-col gap-3 @3xl:sticky @3xl:top-0 @3xl:max-h-[100cqh] @3xl:self-start @3xl:overflow-y-auto"
      >
        {items.length > 0 && (
          // A few items always show, and where the rail has no room for more it scrolls
          <div className={`flex flex-col ${items.length > 2 ? "min-h-36" : "shrink-0"}`}>
            <div className="mb-1.5 flex shrink-0 items-baseline gap-2">
              <h4 id={itemsId} className="font-semibold text-white">
                Keep or drop
              </h4>
              <span role="status" className="text-[11px] text-[#8b949e]">
                {kept.filter(Boolean).length} of {kept.length} kept
              </span>
            </div>
            <ul
              data-review-items
              aria-labelledby={itemsId}
              className="flex max-h-80 min-h-0 flex-col divide-y divide-[#30363d] overflow-y-auto rounded-md border border-[#30363d] @3xl:max-h-none"
            >
              {items.map((item, i) => (
                <ReviewItemRow key={item.parts.keep} item={item} kept={kept[i]} part={part} />
              ))}
            </ul>
          </div>
        )}
        <div className="shrink-0">{part(COMMENT_PART)}</div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {part(VERDICT_PARTS.approve)}
          {part(VERDICT_PARTS.requestChanges)}
          <div className={REJECT}>{part(VERDICT_PARTS.reject)}</div>
        </div>
      </div>
    </div>
  );
};
