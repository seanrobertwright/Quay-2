// Holds a surface that is drawn to what it may have drawn, as the check holds the call that makes it. The
// engine resolves whatever is written to the data model at once, so what would be too much is not written.
import { DataModel } from "@a2ui/web_core/v1_0";
import type { DataValues } from "../differences.ts";
import type { CreateSurface, SurfaceComponent } from "../surfaceTypes.ts";
import { drawnSize, isPast } from "./drawnSize.ts";
import type { EngineSurface } from "./engine.ts";

/** Whether what is drawn of `components` over `data` is within the limit. */
export const fits = (components: readonly SurfaceComponent[], data: DataModel): boolean => !isPast(drawnSize(components, data));

/** The most times `dataWith` counts what would be drawn. What it has not put in by then is left out. */
const MOST_COUNTS = 32;

type Entry = readonly [path: string, value: unknown];

const isPlain = ([, value]: Entry): boolean => typeof value !== "object";

/**
 * The data of a surface accepted as `state` with as much of `values` put in as there is room for, what is no list
 * or object first, and what is left out.
 */
export function dataWith({ createSurface: { components, dataModel } }: CreateSurface, values: DataValues): { data: unknown; leftOut: DataValues } {
  const entries = Object.entries(values);
  const left: Entry[] = [];
  let data = new DataModel(dataModel);
  let counts = 0;
  const put = (some: readonly Entry[]): void => {
    if (some.length === 0) return;
    counts += 1;
    if (counts <= MOST_COUNTS) {
      const after = new DataModel(data.get("/"));
      for (const [path, value] of some) after.set(path, value, true);
      if (fits(components, after)) {
        data = after;
        return;
      }
    }
    if (some.length === 1 || counts >= MOST_COUNTS) {
      left.push(...some);
      return;
    }
    const half = Math.ceil(some.length / 2);
    put(some.slice(0, half));
    put(some.slice(half));
  };
  put([...entries.filter(isPlain), ...entries.filter((entry) => !isPlain(entry))]);
  return { data: data.get("/"), leftOut: Object.fromEntries(left) };
}

/**
 * Writes nothing to `surface`, whose components are `components`, that would take it past the limit, whoever writes
 * it: an input, what is put back of what is unsent, or an update. The engine makes the data model itself and asks
 * nobody before it writes, so its `set` is replaced. `told` is given, of each write, whether it was refused.
 */
export function holdToLimit({ dataModel }: EngineSurface, components: () => readonly SurfaceComponent[], told: (refused: boolean) => void): void {
  const write = dataModel.set.bind(dataModel);
  dataModel.set = (path, value, preserveNull) => {
    const after = new DataModel(dataModel.get("/"));
    after.set(path, value, preserveNull);
    const refused = !fits(components(), after);
    told(refused);
    return refused ? dataModel : write(path, value, preserveNull);
  };
}
