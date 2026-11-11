// How a node phase is drawn (#569, #571, #572), in the tone nodePhase.ts gives it: as a chip with
// the phase's own text, which the node table's rows, the run canvas's cards and the node panel
// draw, and as the border of a run canvas's card. The text always carries the phase, so its tone
// is never the only sign of it. A dimmed phase's chip, SKIPPED's, is dimmed by a dashed outline,
// never by its text, which keeps its tone's full contrast (WCAG 1.4.3).
import type { FC } from "react";
import { TONE_CLASSES } from "./HostChip.tsx";
import { nodePhaseLook, type NodePhaseTone } from "./nodePhase.ts";

/** Each tone's colours: a chip's border, text and fill, the host chip's in each tone they share, and a card's border. */
const TONES: Readonly<Record<NodePhaseTone, { chip: string; frame: string }>> = {
  neutral: { chip: TONE_CLASSES.neutral.chip, frame: "border-[#30363d]" },
  ok: { chip: TONE_CLASSES.ok.chip, frame: "border-[#238636]" },
  error: { chip: TONE_CLASSES.error.chip, frame: "border-[#f85149]/70" },
  amber: { chip: TONE_CLASSES.amber.chip, frame: "border-[#d29922]/80" },
  active: { chip: "border-[#58a6ff]/60 text-[#58a6ff] bg-[#58a6ff]/10", frame: "border-[#58a6ff]/70" },
};

/** A node's phase, verbatim, in its tone. */
export const NodePhaseChip: FC<{ phase: string }> = ({ phase }) => {
  const { tone, dimmed } = nodePhaseLook(phase);
  return (
    <span data-chip="phase" data-tone={tone} className={`px-1.5 py-px rounded-full border text-[10px] ${TONES[tone].chip} ${dimmed ? "border-dashed" : ""}`}>
      {phase}
    </span>
  );
};

/** The border of a run canvas's card for a node in `phase`, in the phase's tone. */
export const phaseFrame = (phase: string) => TONES[nodePhaseLook(phase).tone].frame;
