import type { ReactNode } from "react";

/** Why something the operator did was not done, at a frame's foot. */
export const FrameNotice = ({ children }: { children: ReactNode }) => (
  <p role="alert" className="border-t border-[#da3633]/40 bg-[#da3633]/10 px-3 py-1.5 text-[11px] wrap-anywhere text-[#ff7b72]">
    {children}
  </p>
);
