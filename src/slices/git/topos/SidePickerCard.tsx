import React, { useId } from "react";
import { AlertTriangle } from "lucide-react";
import type { CardChoice, ConflictCard } from "./conflictCards";

export interface SidePickerCardProps {
  card: ConflictCard;
  /** Whether a staging operation is running, which disables the choices that write. */
  busy: boolean;
  /** Why a choice can't run now, by action kind, or absent when it can. */
  unavailable: Partial<Record<CardChoice["action"]["kind"], string>>;
  onChoose: (choice: CardChoice) => void;
}

/**
 * A side-picker card (#352, #391) for a conflict the three-pane resolver can't edit as text: why,
 * the facts the choice depends on, and each choice with what it does to the index and the worktree.
 * File names and commit ids are untrusted and rendered only as text.
 */
export const SidePickerCard: React.FC<SidePickerCardProps> = ({ card, busy, unavailable, onChoose }) => {
  const titleId = useId();
  const effectId = useId();
  return (
    <section aria-labelledby={titleId} className="flex-1 overflow-y-auto min-h-0 flex justify-center p-6">
      <div className="w-full max-w-lg h-fit flex flex-col gap-3 p-4 rounded-lg border border-[#30363d] bg-[#161b22]">
        <h4 id={titleId} className="flex items-start gap-2 text-sm font-semibold text-white break-words">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-[#d29922]" aria-hidden="true" />
          <span className="min-w-0">{card.title}</span>
        </h4>
        <p className="text-xs text-[#c9d1d9] break-words">{card.reason}</p>
        {card.details.length > 0 && (
          <ul className="flex flex-col gap-0.5 text-xs font-mono text-[#8b949e] break-all">
            {card.details.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
        <ul className="flex flex-col gap-2">
          {card.choices.map((choice, n) => {
            const why = unavailable[choice.action.kind];
            const writes = choice.action.kind !== "openTerminal" && choice.action.kind !== "handToAgent";
            // Labels hold branch names, so neither the id nor the key is built from them.
            const id = `${effectId}-${n}`;
            return (
              <li key={JSON.stringify(choice.action)} className="flex items-start gap-3">
                <button
                  type="button"
                  onClick={() => onChoose(choice)}
                  disabled={why !== undefined || (writes && busy)}
                  title={why}
                  aria-describedby={id}
                  className="shrink-0 min-w-32 px-2.5 py-1 rounded text-xs border border-[#30363d] text-[#c9d1d9] hover:bg-[#21262d] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {choice.label}
                </button>
                <p id={id} className="text-[11px] text-[#8b949e] break-words">
                  {choice.effect}
                  {why !== undefined && <span className="block text-[#d29922]">{why}</span>}
                </p>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
};
