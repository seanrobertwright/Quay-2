import type { ReactNode, Ref } from "react";

/** The box's greatest height: about four, six or ten lines of its text. */
const HEIGHT = { short: "max-h-20", medium: "max-h-28", tall: "max-h-44" } as const;

/** What names the box for a screen reader: a name of its own, or the id of a label on screen. */
type Named = { label: string; labelledBy?: undefined } | { label?: undefined; labelledBy: string };

type ScrollBoxProps = Named & {
  height: keyof typeof HEIGHT;
  /** Classes for the text in it, such as its font. */
  className?: string;
  ref?: Ref<HTMLDivElement>;
  children: ReactNode;
};

/**
 * The box a Quay card sets text Quay did not write apart in. Long text scrolls inside it, so that it
 * does not push the card's answers away; in a short window every box is at most about four lines.
 */
export const ScrollBox = ({ label, labelledBy, height, className = "", ref, children }: ScrollBoxProps) => (
  <div
    ref={ref}
    role="group"
    aria-label={label}
    aria-labelledby={labelledBy}
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrollable region must be reachable by keyboard
    tabIndex={0}
    className={`${HEIGHT[height]} [@media(max-height:700px)]:max-h-20 overflow-auto rounded border border-[#30363d] bg-[#0d1117] p-2 text-[11px] leading-4 text-[#c9d1d9] outline-none focus-visible:ring-1 focus-visible:ring-(--quay-accent) ${className}`}
  >
    {children}
  </div>
);
