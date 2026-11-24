import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

interface FoldButtonProps {
  /** The id of what it folds. */
  folds: string;
  /** Whether that is shown. */
  shown: boolean;
  onToggle: () => void;
  className: string;
  children: ReactNode;
}

/** The button that shows and folds something beneath it. What is folded is not drawn. */
export const FoldButton = ({ folds, shown, onToggle, className, children }: FoldButtonProps) => (
  <button type="button" aria-expanded={shown} aria-controls={shown ? folds : undefined} onClick={onToggle} className={`flex items-center gap-1 text-[11px] ${className}`}>
    <ChevronRight aria-hidden="true" className={`h-3 w-3 shrink-0 ${shown ? "rotate-90" : ""}`} />
    {children}
  </button>
);
