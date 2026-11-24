import type { Ref } from "react";
import { keyed } from "./keyed.ts";

interface SegmentsProps {
  titles: readonly string[];
  /** The index of the one that is pressed. */
  pressed: number;
  onPress: (index: number) => void;
  ref?: Ref<HTMLDivElement>;
}

/** Toggle buttons side by side, one of which is pressed, in a box that scrolls where there is no room. */
export const Segments = ({ titles, pressed, onPress, ref }: SegmentsProps) => (
  <div ref={ref} role="group" className="flex max-w-full gap-0.5 overflow-x-auto rounded-md border border-[#30363d] bg-[#010409] p-0.5">
    {keyed(titles, (title) => title).map(({ key, item }, index) => (
      <button
        key={key}
        type="button"
        aria-pressed={index === pressed}
        onClick={() => onPress(index)}
        className={`min-h-6 shrink-0 grow rounded px-2.5 text-xs focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--quay-accent) ${index === pressed ? "bg-[#30363d] text-white" : "text-[#8b949e] hover:text-white"}`}
      >
        {item}
      </button>
    ))}
  </div>
);
