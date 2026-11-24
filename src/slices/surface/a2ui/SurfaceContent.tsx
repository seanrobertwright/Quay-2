import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { A2uiSurface } from "@a2ui/react";
import { LayoutContext, type Layout, type SurfaceData } from "../layout.ts";
import { ImagesContext, surfaceImages } from "../surfaceImages.ts";
import { sameSurface } from "../surfaceAttention.ts";
import type { CreateSurface, SentAction, SurfaceRecord } from "../surfaceTypes.ts";
import { followUnsent, unsentIn } from "../unsent.ts";
import { actionMessage } from "./actionMessage.ts";
import { engineFor, type EngineSurface } from "./engine.ts";

type OnAction = (action: SentAction) => Promise<void>;

const noAction: OnAction = async () => {};

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
}

/** Kept while their records are, so a surface that comes back to the screen is as it was left. */
const lives = new WeakMap<SurfaceRecord, Live>();

/** Puts what is unsent in `record` in `surface`. */
function putIn({ dataModel }: EngineSurface, record: SurfaceRecord): void {
  for (const [path, value] of Object.entries(unsentIn(record))) dataModel.set(path, value, true);
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
  };
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
}

/** What an agent's surface holds, drawn by Quay's components. */
export const SurfaceContent = ({ record, layout, onAction = noAction }: SurfaceContentProps) => {
  const [live, setLive] = useState(() => liveOf(record));
  if (live.record !== record && !goesOn(live.record, record)) setLive(liveOf(record));
  useLayoutEffect(() => {
    if (live.record !== record && goesOn(live.record, record)) bring(live, record);
  }, [live, record]);
  useEffect(() => {
    live.onAction = onAction;
  }, [live, onAction]);
  const [images] = useState(() => surfaceImages(record));
  useEffect(() => followUnsent(record, live.data), [record, live]);
  const { components } = record.state.createSurface;
  const value = useMemo(() => (layout ? { Layout: layout, components, data: live.data } : null), [layout, components, live]);
  return (
    <LayoutContext.Provider value={value}>
      <ImagesContext.Provider value={images}>
        <A2uiSurface key={live.from} surface={live.surface} />
      </ImagesContext.Provider>
    </LayoutContext.Provider>
  );
};
