import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { neonPart } from "../../lib/neon.ts";
import { QuayBadge } from "./QuayBadge.tsx";

interface QuayCardProps {
  /** What Quay asks for, in Quay's words: the card's heading and its accessible name. */
  title: string;
  /** The icon before the title, which draws no meaning the title does not say. */
  icon: LucideIcon;
  children: ReactNode;
}

/**
 * The shell of Quay's own decision cards, which carries the Quay mark: the accent edge and glow and
 * the QUAY badge, on Quay's plain ground. Only a Quay card may use it, never anything an agent
 * describes; the lint boundary keeps the A2UI module from importing this folder. It takes no border
 * colour class, since a Tailwind utility would win over the mark's edge.
 */
export const QuayCard = ({ title, icon: Icon, children }: QuayCardProps) => (
  <section
    aria-label={title}
    data-neon={neonPart("quay-card", true)}
    className="rounded-lg border bg-[#161b22] p-3 space-y-2 text-xs text-[#c9d1d9]"
  >
    <div className="flex items-center gap-2">
      <Icon aria-hidden="true" className="w-4 h-4 shrink-0 text-[#e3b341]" />
      <h3 className="min-w-0 flex-1 text-[13px] font-semibold text-[#e3b341]">{title}</h3>
      <QuayBadge />
    </div>
    {children}
  </section>
);
