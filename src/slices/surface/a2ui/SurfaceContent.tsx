import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { A2uiSurface } from "@a2ui/react";
import { LayoutContext, type Layout, type SurfaceData } from "../layout.ts";
import { ImagesContext, surfaceImages } from "../surfaceImages.ts";
import { RAW_TOOL } from "../rawTool.ts";
import { sameSurface } from "../surfaceAttention.ts";
import type { CreateSurface, SentAction, SurfaceRecord } from "../surfaceTypes.ts";
import { followUnsent, unsentIn } from "../unsent.ts";
import { actionMessage } from "./actionMessage.ts";
import { engineFor, type EngineSurface } from "./engine.ts";
import { dataWith, holdToLimit } from "./heldToLimit.ts";
import { UntypedContext, untypedIn, type Untyped } from "./untyped.ts";

type OnAction = (action: SentAction) => Promise<void>;

const noAction: OnAction = async () => {};

type OnRefused = (why: string | null) => void;

const noRefusal: OnRefused = () => {};

const NOT_PUT_IN = "Not put in: the surface would have more components than Quay draws.";

/** The engine that draws a surface, with what the operator has put in it so far. */
interface Live {
  /** The record it is at. */
  record: SurfaceRecord;
  /** The revision its content was made new at. */
  from: number;
  surface: EngineSurface;
  update: (state: CreateSurface) => void;
  data: SurfaceData;
  onAction: OnAction;
  onRefused: OnRefused;
}

/** Kept while their records are, so a surface that comes back to the screen is as it was left. */
const lives = new WeakMap<SurfaceRecord, Live>();

/** Puts what is unsent in `record` in `surface`. */
function putIn({ dataModel }: EngineSurface, record: SurfaceRecord): void {
  const values = unsentIn(record);
  if (record.tool === RAW_TOOL && Object.keys(values).length > 0) dataModel.set("/", dataWith(record.state, values));
  else for (const [path, value] of Object.entries(values)) dataModel.set(path, value, true);
}

/** Whether `record` is the surface of `before` with no content made new since, so the engine of `before` can be brought to it. */
const goesOn = (before: SurfaceRecord, record: SurfaceRecord) => sameSurface(before, record) && record.carried.from <= before.revision && before.revision <= record.revision;

/** Brings `live` to `record`, which its own goes on to. */
function bring(live: Live, record: SurfaceRecord): void {
  const { revision } = live.record;
  lives.delete(live.record);
  live.record = record;
  lives.set(record, live);
  if (revision === record.revision) return;
  live.update(record.state);
  putIn(live.surface, record);
}

function liveOf(record: SurfaceRecord): Live {
  const kept = lives.get(record);
  if (kept) return kept;
  const { surface, update } = engineFor(record.state, (action) => live.onAction({ name: action.name, context: action.context, message: actionMessage(action) }));
  const { dataModel } = surface;
  putIn(surface, record);
  const live: Live = {
    record,
    from: record.carried.from,
    surface,
    update,
    data: {
      get: (path) => dataModel.get<unknown>(path),
      set: (path, value) => void dataModel.set(path, value),
      subscribe: (changed) => {
        const subscription = dataModel.subscribe("/", changed);
        return () => subscription.unsubscribe();
      },
    },
    onAction: noAction,
    onRefused: noRefusal,
  };
  // The operator can make nothing more of a typed surface than its tool did
  if (record.tool === RAW_TOOL) {
    holdToLimit(
      surface,
      () => live.record.state.createSurface.components,
      (refused) => live.onRefused(refused ? NOT_PUT_IN : null),
    );
  }
  lives.set(record, live);
  return live;
}

interface SurfaceContentProps {
  /** The surface to draw. Another surface needs a `key` of its own. */
  record: SurfaceRecord;
  /** The frame's layout of a typed surface's parts, or null to draw the surface as it is. */
  layout: Layout | null;
  /** The operator's action. Until it settles, the button that sent it takes no second click. Left out for a surface that has none. */
  onAction?: OnAction;
  /** Told why what the operator put in was not taken, and null once something is taken again. */
  onRefused?: OnRefused;
}

/** What an agent's surface holds, drawn by Quay's components. */
export const SurfaceContent = ({ record, layout, onAction = noAction, onRefused = noRefusal }: SurfaceContentProps) => {
  const [live, setLive] = useState(() => liveOf(record));
  if (live.record !== record && !goesOn(live.record, record)) setLive(liveOf(record));
  useLayoutEffect(() => {
    if (live.record !== record && goesOn(live.record, record)) bring(live, record);
  }, [live, record]);
  useEffect(() => {
    live.onAction = onAction;
    live.onRefused = onRefused;
  }, [live, onAction, onRefused]);
  const [images] = useState(() => surfaceImages(record));
  useEffect(() => followUnsent(record, live.data), [record, live]);
  const untyped = useCallback<Untyped>((at, written) => untypedIn(live.record.state, live.data.get("/"), at, written), [live]);
  const { components } = record.state.createSurface;
  const value = useMemo(() => (layout ? { Layout: layout, components, data: live.data } : null), [layout, components, live]);
  return (
    <LayoutContext.Provider value={value}>
      <ImagesContext.Provider value={images}>
        <UntypedContext.Provider value={untyped}>
          <A2uiSurface key={live.from} surface={live.surface} />
        </UntypedContext.Provider>
      </ImagesContext.Provider>
    </LayoutContext.Provider>
  );
};
