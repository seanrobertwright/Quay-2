import { MessageCircleQuestion } from "lucide-react";
import { useAskingSurfacesOf } from "./surfaceAttention.ts";
import type { SurfaceKey } from "./surfaceTypes.ts";

interface AskingButtonProps {
  terminalId: string;
  onOpen: (key: SurfaceKey) => void;
}

/**
 * The pane title's button while the terminal's surfaces ask: how many do, and a click opens the oldest.
 * In a narrow pane it shows the icon and the count, and its name stays whole.
 */
export const AskingButton = ({ terminalId, onOpen }: AskingButtonProps) => {
  const asking = useAskingSurfacesOf(terminalId);
  if (asking.length === 0) return null;
  const { terminal_id, id } = asking[0];
  const words = asking.length === 1 ? " question for you" : " questions for you";
  return (
    <button
      type="button"
      data-no-terminal-focus
      title={`${asking.length}${words}. Open the oldest`}
      aria-label={`${asking.length}${words}`}
      onClick={(e) => {
        e.stopPropagation();
        onOpen({ terminal_id, id });
      }}
      className="flex shrink-0 items-center gap-1 rounded-full border border-[#d29922]/40 bg-[#d29922]/15 px-1.5 text-[10px] font-medium text-[#d29922] hover:bg-[#d29922]/25"
    >
      <MessageCircleQuestion className="size-2.5 shrink-0" aria-hidden="true" />
      <span className="whitespace-pre">
        {asking.length}
        <span className="hidden @sm/pane:inline">{words}</span>
      </span>
    </button>
  );
};
