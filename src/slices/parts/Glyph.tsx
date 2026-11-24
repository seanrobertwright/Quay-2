import type { Ref } from "react";
import type { LucideIcon } from "lucide-react";

interface GlyphProps {
  /** One of Quay's icons, or the path of a shape in a 24 by 24 box, filled with the colour of the text. */
  shape: LucideIcon | string;
  /** Whether a label names it, which its `ref` gives it. One that is not named only decorates. */
  named?: boolean;
  ref?: Ref<SVGSVGElement>;
}

/** An icon the size of the text's line. */
export const Glyph = ({ shape: Shape, named = false, ref }: GlyphProps) => {
  const look = { ref, role: named ? "img" : undefined, "aria-hidden": named ? undefined : true, className: "inline-block h-4 w-4 shrink-0 align-text-bottom" } as const;
  if (typeof Shape !== "string") return <Shape {...look} />;
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...look}>
      <path d={Shape} />
    </svg>
  );
};
