import type { ReactNode } from "react";
import { X } from "lucide-react";

/** Why something the operator did was not done, or what was done that Quay's window does not show. */
export type NoticeKind = "refusal" | "information";

/** How each kind of notice looks: a refusal in red, information in blue. */
const LOOK: Record<NoticeKind, { box: string; dismiss: string }> = {
  refusal: {
    box: "border-[#da3633]/40 bg-[#da3633]/10 text-[#ff7b72]",
    dismiss: "text-[#ff7b72] hover:bg-[#da3633]/20",
  },
  information: {
    box: "border-[#388bfd]/40 bg-[#388bfd]/10 text-[#79c0ff]",
    dismiss: "text-[#79c0ff] hover:bg-[#388bfd]/20",
  },
};

interface FrameNoticeProps {
  /** What the notice tells of. A refusal when not given. */
  kind?: NoticeKind;
  /** Takes the notice away, and gives the focus that was on its × a place that stays. What it told of is left as it is. */
  onDismiss: () => void;
  children: ReactNode;
}

/** A notice at a frame's foot of what the operator did, announced as it shows, with a × that takes it away. */
export const FrameNotice = ({ kind = "refusal", onDismiss, children }: FrameNoticeProps) => (
  <div role="alert" data-notice={kind} className={`flex items-start gap-2 border-t py-0.5 pr-1 pl-3 text-[11px] ${LOOK[kind].box}`}>
    <p className="min-w-0 flex-1 py-1 wrap-anywhere">{children}</p>
    <button
      type="button"
      aria-label="Dismiss this notice"
      title="Dismiss this notice"
      onClick={onDismiss}
      className={`grid h-6 w-6 shrink-0 place-items-center rounded hover:text-white ${LOOK[kind].dismiss}`}
    >
      <X aria-hidden="true" className="h-3 w-3" />
    </button>
  </div>
);
