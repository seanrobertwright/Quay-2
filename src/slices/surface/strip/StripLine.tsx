import type { ReactNode } from "react";
import { ChevronDown, ChevronUp, type LucideIcon } from "lucide-react";

interface StripLineProps {
  Icon: LucideIcon;
  /** The colour of the icon, as a class. */
  tone: string;
  /** What kind of surface it is, for a screen reader. */
  kind: string;
  title: string;
  open: boolean;
  /** The id of what it opens. */
  opens: string;
  onToggle: () => void;
  /** What follows the title. */
  children: ReactNode;
}

/** A line of a terminal's strip, which opens its surface over the terminal and folds it again. */
export const StripLine = ({ Icon, tone, kind, title, open, opens, onToggle, children }: StripLineProps) => {
  const Chevron = open ? ChevronUp : ChevronDown;
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={open ? opens : undefined}
      title={title}
      onClick={onToggle}
      className="relative flex h-7 w-full items-center gap-2 border-b border-[#30363d] bg-[#161b22] px-2.5 text-left text-xs hover:bg-[#21262d]"
    >
      <Icon aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 ${tone}`} />
      <span className="min-w-0 truncate text-[#c9d1d9]">
        <span className="sr-only">{kind}: </span>
        {title}
      </span>
      {children}
      <Chevron aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[#8b949e]" />
    </button>
  );
};
