import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import type { TerminalInfo } from "../terminal/types.ts";
import { lookOf } from "./looks/index.ts";
import { SurfaceBoundary } from "./SurfaceBoundary.tsx";
import { SurfaceFrame } from "./SurfaceFrame.tsx";
import { isLive } from "./surfaceAttention.ts";
import { answerSurface, loadA2ui } from "./surfaceHost.ts";
import type { SurfaceAction, SurfaceRecord } from "./surfaceTypes.ts";
import { typedTool } from "./typed/index.ts";

const SurfaceContent = lazy(async () => ({ default: (await loadA2ui()).SurfaceContent }));

interface SurfaceProps {
  record: SurfaceRecord;
  terminal: TerminalInfo;
}

/** A surface the operator can act on. */
const LiveSurface = ({ record, terminal }: SurfaceProps) => {
  const { kind, KindIcon, layout } = lookOf(record.tool);
  const [refusal, setRefusal] = useState<string | null>(null);
  const onAction = useCallback(
    async (action: SurfaceAction) => {
      const typed = typedTool(record.tool);
      if (!typed) {
        setRefusal("Not sent: Quay cannot send an answer to this kind of surface.");
        return;
      }
      setRefusal(null);
      try {
        await answerSurface(record, typed.collapse(action));
      } catch (error) {
        setRefusal(String(error));
      }
    },
    [record],
  );
  return (
    <SurfaceFrame id={record.id} terminal={terminal} kind={kind} KindIcon={KindIcon} refusal={refusal}>
      <SurfaceBoundary>
        <Suspense fallback={<p className="text-[#8b949e]">Loading…</p>}>
          <SurfaceContent record={record} layout={layout} onAction={onAction} />
        </Suspense>
      </SurfaceBoundary>
    </SurfaceFrame>
  );
};

/** A surface whose one answer has been given. */
const SettledSurface = ({ record, terminal }: SurfaceProps) => {
  const { kind, KindIcon, Settled } = lookOf(record.tool);
  const band = (
    <p role="status" className="flex items-center gap-1.5 border-b border-[#30363d] px-3 py-1.5 text-[11px] text-[#3fb950]">
      <Check aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      Answered and sent to the agent.
    </p>
  );
  return (
    <SurfaceFrame id={record.id} terminal={terminal} kind={kind} KindIcon={KindIcon} band={band}>
      <SurfaceBoundary>{Settled && <Settled answer={record.answer} />}</SurfaceBoundary>
    </SurfaceFrame>
  );
};

/** The surface a request asked to show. Each request has a `seq` of its own. */
export interface SurfaceFocus {
  surfaceId: string;
  seq: number;
}

interface SurfaceViewProps {
  terminal: TerminalInfo;
  surfaces: readonly SurfaceRecord[];
  focus?: SurfaceFocus | null;
}

/** The Surface view: a terminal's companion surfaces, oldest first. The one `focus` names is brought into view. */
export const SurfaceView = ({ terminal, surfaces, focus = null }: SurfaceViewProps) => {
  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!focus) return;
    const regions = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-surface]") ?? [])];
    regions.find((region) => region.dataset.surface === focus.surfaceId)?.scrollIntoView?.({ block: "start" });
  }, [focus]);
  return (
    <div ref={listRef} className="flex flex-col gap-2 p-2">
      {surfaces.map((record) => {
        const key = `${record.terminal_id} ${record.id} ${record.revision}`;
        return isLive(record) ? (
          <LiveSurface key={key} record={record} terminal={terminal} />
        ) : (
          <SettledSurface key={key} record={record} terminal={terminal} />
        );
      })}
    </div>
  );
};
