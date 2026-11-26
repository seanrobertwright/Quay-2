import type { ReactNode } from "react";
import { X } from "lucide-react";

interface FrameNoticeProps {
  /** Takes the notice away. What it told of is left as it is. */
  onDismiss: () => void;
  children: ReactNode;
}

/**
 * Why something the operator did was not done, at a frame's foot, with a × that takes it away. The focus,
 * which was on that ×, goes to the frame.
 */
export const FrameNotice = ({ onDismiss, children }: FrameNoticeProps) => (
  <div role="alert" className="flex items-start gap-2 border-t border-[#da3633]/40 bg-[#da3633]/10 py-0.5 pr-1 pl-3 text-[11px] text-[#ff7b72]">
    <p className="min-w-0 flex-1 py-1 wrap-anywhere">{children}</p>
    <button
      type="button"
      aria-label="Dismiss this notice"
      title="Dismiss this notice"
      onClick={(event) => {
        event.currentTarget.closest<HTMLElement>("section[data-surface]")?.focus();
        onDismiss();
      }}
      className="grid h-6 w-6 shrink-0 place-items-center rounded text-[#ff7b72] hover:bg-[#da3633]/20 hover:text-white"
    >
      <X aria-hidden="true" className="h-3 w-3" />
    </button>
  </div>
);
