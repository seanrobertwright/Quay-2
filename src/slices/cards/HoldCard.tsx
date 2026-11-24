import { CirclePause } from "lucide-react";
import type { HoldCard as Hold, HoldOption } from "../machina/types.ts";
import { AttributedText } from "./AttributedText.tsx";
import { QuayCard } from "./QuayCard.tsx";

const OPTION_LOOK: Record<HoldOption["variant"], string> = {
  danger: "border-[#f85149]/50 hover:bg-[#f85149]/15",
  primary: "border-[#3fb950]/50 hover:bg-[#3fb950]/15",
  secondary: "border-[#30363d] hover:bg-[#21262d]",
};

interface HoldCardProps {
  hold: Hold;
  /** True while an answer is on its way. */
  busy: boolean;
  onChoose: (option: HoldOption) => void;
}

/**
 * A work order's hold, a Quay card: why Machina stopped it, which can name an agent or quote a
 * project's own text, and the hold's own options.
 */
export const HoldCard = ({ hold, busy, onChoose }: HoldCardProps) => (
  <QuayCard title="On hold" icon={CirclePause}>
    <AttributedText label="Machina says" text={hold.summary} />
    <div className="space-y-1.5">
      {hold.options.map((option) => (
        <button
          key={option.id}
          type="button"
          disabled={busy}
          onClick={() => onChoose(option)}
          className={`w-full text-left p-2 rounded-md border disabled:opacity-50 ${OPTION_LOOK[option.variant]}`}
        >
          <span className="block font-semibold text-white">{option.label}</span>
          <span className="block text-[11px] text-[#8b949e]">{option.description}</span>
        </button>
      ))}
    </div>
  </QuayCard>
);
