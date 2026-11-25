// Holds a surface that is drawn to what it may have drawn, as the check holds the call that makes it. The
// engine resolves whatever is written to the data model at once, so what would be too much is not written.
import { DataModel } from "@a2ui/web_core/v1_0";
import type { DataValues } from "../differences.ts";
import type { CreateSurface, SurfaceComponent } from "../surfaceTypes.ts";
import { drawnSize, isPast } from "./drawnSize.ts";
import type { EngineSurface } from "./engine.ts";

/** Whether what is drawn of `components` over `data` is within the limit. */
export const fits = (components: readonly SurfaceComponent[], data: DataModel): boolean => !isPast(drawnSize(components, data));

/** A surface's data with `values` put in, or null where that would be past the limit. */
function within({ createSurface: { components, dataModel } }: CreateSurface, values: DataValues): unknown {
  const data = new DataModel(dataModel);
  for (const [path, value] of Object.entries(values)) data.set(path, value, true);
  return fits(components, data) ? data.get<unknown>("/") : null;
}

/** The data of a surface accepted as `state` with `values` put in: all of them, or else those that are no list or object, or else none. */
export function dataWith(state: CreateSurface, values: DataValues): unknown {
  const plain = () => Object.fromEntries(Object.entries(values).filter(([, value]) => typeof value !== "object"));
  return within(state, values) ?? within(state, plain()) ?? state.createSurface.dataModel;
}

/**
 * Writes nothing to `surface`, whose components are `components`, that would take it past the limit. `told` is
 * given true each time something is not written, and false when something is written after that.
 */
export function holdToLimit({ dataModel }: EngineSurface, components: () => readonly SurfaceComponent[], told: (refused: boolean) => void): void {
  const write = dataModel.set.bind(dataModel);
  let refused = false;
  dataModel.set = (path, value, preserveNull) => {
    const after = new DataModel(dataModel.get("/"));
    after.set(path, value, preserveNull);
    const refuses = !fits(components(), after);
    if (refuses || refused) told(refuses);
    refused = refuses;
    return refuses ? dataModel : write(path, value, preserveNull);
  };
}
