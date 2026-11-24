import { formatTimeWaited } from "../../lib/dates.ts";
import type { TerminalInfo } from "../terminal/types.ts";
import { lookOf } from "./looks/index.ts";
import type { SurfaceRecord } from "./surfaceTypes.ts";
import { useTick } from "./useTick.ts";

/** How long something has waited since `ms`, kept true while it is drawn. */
const Waited = ({ since }: { since: number }) => {
  useTick(true);
  return (
    <span className="shrink-0 text-[10px] text-[#8b949e]">
      <span className="sr-only">Waiting: </span>
      {formatTimeWaited(since)}
    </span>
  );
};

interface QueueLineProps {
  record: SurfaceRecord;
  terminal: TerminalInfo;
  onOpen: () => void;
}

/** An asking surface that is not the open one: what it asks and how long it has waited, since it was opened again if it was, in a line that opens it. */
export const QueueLine = ({ record, terminal, onOpen }: QueueLineProps) => {
  const { kind, KindIcon, asksFor } = lookOf(record.tool);
  const asked = asksFor(record);
  return (
    <section aria-label={`${kind} from ${terminal.name}`} data-surface={record.id}>
      <button
        type="button"
        aria-expanded={false}
        title={asked}
        onClick={onOpen}
        className="flex min-h-9 w-full items-center gap-2 rounded-lg border border-[#30363d] bg-[#161b22] px-3 text-left text-xs hover:bg-[#21262d]"
      >
        <KindIcon aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[#d29922]" />
        <span className="min-w-0 flex-1 truncate text-[#c9d1d9]">{asked}</span>
        <Waited since={record.reopened?.at ?? record.shown_at} />
      </button>
    </section>
  );
};
