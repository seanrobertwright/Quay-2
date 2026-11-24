import type { ReactNode } from "react";

interface ShareProps {
  /** How much of the room it takes, against the weights of what is beside it. */
  weight: number;
  children: ReactNode;
}

/** A share of a stack's room, which what is in it fills. It is never narrower than a few words, or than a date with its time, so a row of them wraps. */
export const Share = ({ weight, children }: ShareProps) => (
  <div data-weight className="grid min-w-[min(5.5rem,100%)] basis-0 has-[[type=datetime-local]]:min-w-[min(12rem,100%)] grid-cols-[minmax(0,1fr)]" style={{ flexGrow: weight }}>
    {children}
  </div>
);
