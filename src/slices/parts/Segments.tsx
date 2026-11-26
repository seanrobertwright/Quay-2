import type { KeyboardEvent, Ref } from "react";
import { keyed } from "./keyed.ts";

interface SegmentsProps {
  titles: readonly string[];
  /** The index of the one that is pressed. */
  pressed: number;
  onPress: (index: number) => void;
  ref?: Ref<HTMLDivElement>;
}

/**
 * Toggle buttons side by side, one of which is pressed, in a box that scrolls where there is no room. They are
 * no native buttons, so a locked surface, whose form controls are disabled, still has each to read.
 */
export const Segments = ({ titles, pressed, onPress, ref }: SegmentsProps) => {
  const onKeyDown = (e: KeyboardEvent, index: number) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    onPress(index);
  };
  return (
    <div ref={ref} role="group" className="flex max-w-full gap-0.5 overflow-x-auto rounded-md border border-[#30363d] bg-[#010409] p-0.5">
      {keyed(titles, (title) => title).map(({ key, item }, index) => (
        <span
          key={key}
          role="button"
          tabIndex={0}
          aria-pressed={index === pressed}
          onClick={() => onPress(index)}
          onKeyDown={(e) => onKeyDown(e, index)}
          className={`flex min-h-6 shrink-0 grow cursor-pointer items-center justify-center rounded px-2.5 text-xs select-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--quay-accent) ${index === pressed ? "bg-[#30363d] text-white" : "text-[#8b949e] hover:text-white"}`}
        >
          {item}
        </span>
      ))}
    </div>
  );
};
