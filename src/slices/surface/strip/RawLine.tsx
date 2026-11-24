import { formatTimeAgo } from "../../../lib/dates.ts";
import { lockedState } from "../lockedState.ts";
import { lookOf } from "../looks/index.ts";
import { isLive, type SurfaceRecord } from "../surfaceTypes.ts";
import { useTick } from "../useTick.ts";
import { StripLine } from "./StripLine.tsx";

interface RawLineProps {
  record: SurfaceRecord;
  open: boolean;
  /** The id of what it opens. */
  opens: string;
  onToggle: () => void;
}

/** A raw strip surface in a line: its title and when it was updated, or how it ended. Quay reads no more out of it. */
export const RawLine = ({ record, open, opens, onToggle }: RawLineProps) => {
  const live = isLive(record);
  useTick(live);
  const { kind, KindIcon } = lookOf(record.tool);
  const { reason, Icon, tone } = lockedState(record);
  return (
    <StripLine Icon={live ? KindIcon : Icon} tone={live ? "text-[#d29922]" : tone} kind={kind} title={record.title} open={open} opens={opens} onToggle={onToggle}>
      <span className="flex-1" />
      <span className={`min-w-0 truncate text-[11px] ${live ? "text-[#8b949e]" : tone}`}>{live ? `updated ${formatTimeAgo(record.updated_at)}` : reason}</span>
    </StripLine>
  );
};
