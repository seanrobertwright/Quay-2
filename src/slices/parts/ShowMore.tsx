import { useRef, type KeyboardEvent } from "react";

interface ShowMoreProps {
  /** How many of the list are drawn, of how many it has. */
  shown: number;
  total: number;
  /** How many more a press shows, at the most. */
  step: number;
  onMore: () => void;
}

/**
 * How much of a long list is drawn, and what shows more of it until all is. It is no native button, so a
 * locked surface, whose form controls are disabled, can still be read to its end.
 */
export const ShowMore = ({ shown, total, step, onMore }: ShowMoreProps) => {
  const told = useRef<HTMLParagraphElement>(null);
  const next = Math.min(step, total - shown);
  const more = () => {
    // The button goes once all is shown, and the focus would go with it
    if (shown + next === total) told.current?.focus();
    onMore();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    more();
  };
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 text-[11px] text-[#8b949e]">
      <p ref={told} role="status" tabIndex={-1} className="focus:outline-hidden">
        {shown} of {total} shown
      </p>
      {next > 0 && (
        <span
          role="button"
          tabIndex={0}
          onClick={more}
          onKeyDown={onKeyDown}
          className="cursor-pointer rounded-sm text-[#58a6ff] underline hover:text-[#79c0ff] focus-visible:outline-2 focus-visible:outline-(--quay-accent)"
        >
          Show {next} more
        </span>
      )}
    </div>
  );
};
