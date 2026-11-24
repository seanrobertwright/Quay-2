// Draws a surface that is sent often a few times a second, and ends on the last it was sent.
import type { SurfaceKey, SurfaceRecord } from "./surfaceTypes.ts";

/** The least time between two draws of one surface, in milliseconds. */
const REDRAW_MS = 250;

/** A surface that was drawn within the last `REDRAW_MS`. */
interface Drawn {
  timer: ReturnType<typeof setTimeout>;
  /** The latest it was sent since, if it was. */
  held: SurfaceRecord | null;
}

export interface Paced {
  /** Draws `record` now, or, when its surface has just been drawn, as soon as that may be drawn again. */
  take: (record: SurfaceRecord) => void;
  /** Forgets what is held of a surface that has left. */
  forget: (key: SurfaceKey) => void;
  stop: () => void;
}

const keyOf = ({ terminal_id, id }: SurfaceKey) => JSON.stringify([terminal_id, id]);

/** Draws with `draw`, each surface at its own pace. */
export function paced(draw: (record: SurfaceRecord) => void): Paced {
  const drawn = new Map<string, Drawn>();
  const drawNow = (key: string, record: SurfaceRecord) => {
    drawn.set(key, { held: null, timer: setTimeout(() => due(key), REDRAW_MS) });
    draw(record);
  };
  const due = (key: string) => {
    const held = drawn.get(key)?.held;
    if (held) drawNow(key, held);
    else drawn.delete(key);
  };
  return {
    take: (record) => {
      const key = keyOf(record);
      const recent = drawn.get(key);
      if (!recent) drawNow(key, record);
      else if (!recent.held || recent.held.change < record.change) recent.held = record;
    },
    forget: (key) => {
      clearTimeout(drawn.get(keyOf(key))?.timer);
      drawn.delete(keyOf(key));
    },
    stop: () => {
      for (const { timer } of drawn.values()) clearTimeout(timer);
      drawn.clear();
    },
  };
}
