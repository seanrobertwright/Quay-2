import type { ReactNode } from "react";

/** A plain box around something. It has no mark: that is a Quay card's alone. */
export const Panel = ({ children }: { children: ReactNode }) => <div className="min-w-0 rounded-md border border-[#30363d] bg-[#161b22] px-2.5 py-2">{children}</div>;
