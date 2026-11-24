import { useEffect, useMemo, useState } from "react";
import { A2uiSurface } from "@a2ui/react";
import { LayoutContext, type Layout, type SurfaceData } from "../layout.ts";
import type { SurfaceAction, SurfaceRecord } from "../surfaceTypes.ts";
import { engineFor, type EngineSurface } from "./engine.ts";

type OnAction = (action: SurfaceAction) => Promise<void>;

/** The engine that draws a record, with what the operator has put in it so far. */
interface Live {
  surface: EngineSurface;
  data: SurfaceData;
  onAction: OnAction;
}

/** Kept while their records are, so what was typed survives a surface leaving the screen. */
const lives = new WeakMap<SurfaceRecord, Live>();

function liveOf(record: SurfaceRecord): Live {
  const kept = lives.get(record);
  if (kept) return kept;
  const { surface } = engineFor(record.state, (action) => live.onAction({ name: action.name, context: action.context }));
  const { dataModel } = surface;
  const live: Live = {
    surface,
    data: {
      get: (path) => dataModel.get<unknown>(path),
      set: (path, value) => void dataModel.set(path, value),
      subscribe: (changed) => {
        const subscription = dataModel.subscribe("/", changed);
        return () => subscription.unsubscribe();
      },
    },
    onAction: async () => {},
  };
  lives.set(record, live);
  return live;
}

interface SurfaceContentProps {
  /** The surface to draw. Another record needs a `key` of its own. */
  record: SurfaceRecord;
  /** The frame's layout of a typed surface's parts, or null to draw the surface as it is. */
  layout: Layout | null;
  /** The operator's action. Until it settles, the button that sent it takes no second click. */
  onAction: OnAction;
}

/** What an agent's surface holds, drawn by Quay's components. */
export const SurfaceContent = ({ record, layout, onAction }: SurfaceContentProps) => {
  const [live] = useState(() => liveOf(record));
  useEffect(() => {
    live.onAction = onAction;
  }, [live, onAction]);
  const { components } = record.state.createSurface;
  const value = useMemo(() => (layout ? { Layout: layout, components, data: live.data } : null), [layout, components, live]);
  return (
    <LayoutContext.Provider value={value}>
      <A2uiSurface surface={live.surface} />
    </LayoutContext.Provider>
  );
};
