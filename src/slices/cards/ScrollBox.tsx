import { useId, type ReactNode, type Ref } from "react";

const SHORT_WINDOW = "[@media(max-height:700px)]:max-h-20";
const INSET = "rounded border border-[#30363d] bg-[#0d1117] p-2 text-[11px] leading-4 text-[#c9d1d9]";

/** Each kind's look and its greatest height: an inset of about four, six or ten lines, or a plain line of text that may run to three. */
const KIND = {
  line: "max-h-12",
  short: `max-h-20 ${INSET}`,
  medium: `max-h-28 ${SHORT_WINDOW} ${INSET}`,
  tall: `max-h-44 ${SHORT_WINDOW} ${INSET}`,
} as const;

interface ScrollBoxProps {
  kind: keyof typeof KIND;
  /** What names the box for a screen reader. */
  label: string;
  /** Draws the label on screen too, above the box, in two lines at most. */
  labelShown?: boolean;
  /** Classes for the text in it, such as its font. */
  className?: string;
  ref?: Ref<HTMLDivElement>;
  children: ReactNode;
}

/**
 * A box on a Quay card for text Quay did not write. Long text scrolls inside it, so that it does not
 * push the card's answers away; in a short window every box is at most about four lines.
 */
export const ScrollBox = ({ kind, label, labelShown = false, className = "", ref, children }: ScrollBoxProps) => {
  const labelId = useId();
  const box = (
    <div
      ref={ref}
      role="group"
      aria-label={labelShown ? undefined : label}
      aria-labelledby={labelShown ? labelId : undefined}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrollable region must be reachable by keyboard
      tabIndex={0}
      className={`${KIND[kind]} overflow-auto outline-none focus-visible:ring-1 focus-visible:ring-(--quay-accent) ${className}`}
    >
      {children}
    </div>
  );
  if (!labelShown) return box;
  return (
    <div className="space-y-1">
      <p id={labelId} className="line-clamp-2 wrap-anywhere text-[11px] text-[#8b949e]">
        {label}
      </p>
      {box}
    </div>
  );
};
