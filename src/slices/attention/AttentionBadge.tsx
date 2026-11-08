import { BellRing } from "lucide-react";

interface AttentionBadgeProps {
  /** How many items wait in the attention queue, across every project. */
  waitingCount: number;
  onOpen: () => void;
}

/**
 * The attention queue's count badge: a labelled button that announces how many sessions wait on
 * the user. It renders nothing when none wait. Its label collapses to the icon and count when the
 * enclosing size container is narrower than 56rem.
 */
export const AttentionBadge: React.FC<AttentionBadgeProps> = ({ waitingCount, onOpen }) => {
  if (waitingCount <= 0) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex shrink-0 items-center gap-1 px-2 py-0.5 rounded-full bg-[#1f6feb]/20 text-[#58a6ff] border border-[#1f6feb]/40 font-semibold text-[11px] cursor-pointer hover:bg-[#1f6feb]/30 transition-colors"
      title={`${waitingCount} waiting on you. Click to go to the one that has waited longest`}
      aria-label={`Waiting on you (${waitingCount})`}
    >
      <BellRing className="w-3.5 h-3.5 shrink-0" />
      <span className="@max-[56rem]:hidden">Waiting</span>
      <span className="shrink-0">({waitingCount})</span>
    </button>
  );
};
