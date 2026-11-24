interface BarProps {
  /** How much of it is filled, from 0 to 1. */
  share: number;
  /** The colour of what is filled, as a class. */
  tone: string;
}

/** A bar. It says nothing by itself: what it stands for is in words beside it. */
export const Bar = ({ share, tone }: BarProps) => (
  <span aria-hidden="true" className="block h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[#21262d]">
    <span data-bar className={`block h-full ${tone}`} style={{ width: `${share * 100}%` }} />
  </span>
);
