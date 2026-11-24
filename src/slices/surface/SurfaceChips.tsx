import type { ReactNode } from "react";
import { WAITING_ON_YOU } from "../../lib/waiting.ts";
import { lookOf } from "./looks/index.ts";
import { useAskingSurfacesOf, useLiveSurfacesOf } from "./surfaceAttention.ts";
import type { SurfaceKey, SurfaceRecord } from "./surfaceTypes.ts";

/** How many of a terminal's surfaces have a chip of their own. The rest fold into one. */
const CHIPS_SHOWN = 3;

interface ChipProps {
  surface: SurfaceRecord;
  label: string;
  onOpen: (key: SurfaceKey) => void;
  children: ReactNode;
}

const Chip = ({ surface, label, onOpen, children }: ChipProps) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    onClick={(e) => {
      e.stopPropagation();
      onOpen({ terminal_id: surface.terminal_id, id: surface.id });
    }}
    className="flex min-h-6 items-center gap-1 rounded-full border border-[#30363d] bg-[#0d1117] px-1.5 text-[10px] text-[#c9d1d9] hover:border-[#8b949e] hover:text-white"
  >
    {children}
  </button>
);

interface SurfaceChipsProps {
  terminalId: string;
  terminalName: string;
  onOpen: (key: SurfaceKey) => void;
}

/** A terminal row's chips: one for each live surface, oldest first, which a click opens. The chip of one that asks has a dot. */
export const SurfaceChips = ({ terminalId, terminalName, onOpen }: SurfaceChipsProps) => {
  const live = useLiveSurfacesOf(terminalId);
  const asking = useAskingSurfacesOf(terminalId);
  if (live.length === 0) return null;
  const folded = live.slice(CHIPS_SHOWN);
  return (
    <div data-surface-chips className="flex flex-wrap gap-1 pl-4.5">
      {live.slice(0, CHIPS_SHOWN).map((surface, i) => {
        const { kind, KindIcon } = lookOf(surface.tool);
        const asks = asking.includes(surface);
        const label = `${kind}, surface ${i + 1} of ${live.length} from ${terminalName}`;
        return (
          <Chip key={surface.id} surface={surface} label={asks ? `${label}, ${WAITING_ON_YOU}` : label} onOpen={onOpen}>
            <KindIcon aria-hidden="true" className="h-3 w-3 shrink-0 text-[#8b949e]" />
            {kind}
            {asks && <span aria-hidden="true" data-waiting-dot className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#d29922]" />}
          </Chip>
        );
      })}
      {folded.length > 0 && (
        <Chip surface={folded[0]} label={`+${folded.length} more ${folded.length === 1 ? "surface" : "surfaces"} from ${terminalName}`} onOpen={onOpen}>
          +{folded.length}
        </Chip>
      )}
    </div>
  );
};

/** The amber dot on a terminal's CLI icon while one of its surfaces asks. Its parent is the box it sits in the corner of. */
export const SurfaceDot = ({ terminalId }: { terminalId: string }) =>
  useAskingSurfacesOf(terminalId).length > 0 ? (
    <span data-surface-dot className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full border border-[#0d1117] bg-[#d29922]">
      <span className="sr-only">{WAITING_ON_YOU}</span>
    </span>
  ) : null;
