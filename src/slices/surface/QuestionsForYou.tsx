import { useAskingSurfacesOf } from "./surfaceAttention.ts";
import type { SurfaceKey } from "./surfaceTypes.ts";

interface QuestionsForYouProps {
  terminalId: string;
  onOpen: (key: SurfaceKey) => void;
}

/** The pane title's button while the terminal's surfaces ask: how many do, and a click opens the oldest. */
export const QuestionsForYou = ({ terminalId, onOpen }: QuestionsForYouProps) => {
  const asking = useAskingSurfacesOf(terminalId);
  if (asking.length === 0) return null;
  const { terminal_id, id } = asking[0];
  return (
    <button
      type="button"
      data-no-terminal-focus
      title="Open the oldest in the companion"
      onClick={(e) => {
        e.stopPropagation();
        onOpen({ terminal_id, id });
      }}
      className="shrink-0 rounded-full border border-[#d29922]/40 bg-[#d29922]/15 px-1.5 text-[10px] font-medium text-[#d29922] hover:bg-[#d29922]/25"
    >
      {asking.length === 1 ? "1 question for you" : `${asking.length} questions for you`}
    </button>
  );
};
