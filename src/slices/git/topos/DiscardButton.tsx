import React from "react";
import { Loader2, Undo2 } from "lucide-react";

/** A red Discard button, with a spinner in place of its icon while its discard runs. */
export function DiscardButton({
  busy,
  disabled,
  onClick,
  title,
  className,
  children,
}: {
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
  title: string;
  /** Size and layout, which differ between the places it sits. */
  className: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-busy={busy || undefined}
      onClick={onClick}
      title={title}
      className={`inline-flex items-center gap-1 py-0.5 rounded border border-[#f85149]/40 text-[#ff7b72] hover:bg-[#f85149]/10 disabled:opacity-50 ${className}`}
    >
      {busy ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" /> : <Undo2 className="w-3 h-3" aria-hidden="true" />}
      {children}
    </button>
  );
}
