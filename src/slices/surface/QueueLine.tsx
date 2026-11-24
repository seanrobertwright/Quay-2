import { useEffect, useState } from "react";
import { formatWait } from "../../lib/dates.ts";
import type { TerminalInfo } from "../terminal/types.ts";
import { lookOf } from "./looks/index.ts";
import type { SurfaceRecord } from "./surfaceTypes.ts";

/** How often a line reads its wait again, in milliseconds. */
const TICK_MS = 30_000;

/** How long something has waited since `ms`, kept true while it is drawn. */
const Waited = ({ since }: { since: number }) => {
  const [, setTicks] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTicks((ticks) => ticks + 1), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return (
    <span className="shrink-0 text-[10px] text-[#8b949e]">
      <span className="sr-only">Waiting: </span>
      {formatWait(since)}
    </span>
  );
};

interface QueueLineProps {
  record: SurfaceRecord;
  terminal: TerminalInfo;
  onOpen: () => void;
}

/** An asking surface that is not the open one: what it asks and how long it has waited, in a line that opens it. */
export const QueueLine = ({ record, terminal, onOpen }: QueueLineProps) => {
  const { kind, KindIcon, asksFor } = lookOf(record.tool);
  const asked = asksFor(record.state.createSurface.components);
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
        <Waited since={record.shown_at} />
      </button>
    </section>
  );
};
