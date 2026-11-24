// What a verdict says of a surface that nothing is wrong with.
import { hasOwn, isObject } from "../json.ts";
import type { Accepted, CreateSurface, SurfaceComponent } from "../surfaceTypes.ts";
import { CATALOG_ID } from "./catalog.ts";
import type { EngineSurface } from "./engine.ts";
import { namedImages } from "./images.ts";

/** `surface`'s whole state as one `createSurface`. */
export function compact(surface: EngineSurface): CreateSurface {
  const components = [...surface.componentsModel.values].map(
    ({ id, type, properties }): SurfaceComponent => ({ id, component: type, ...properties }),
  );
  return structuredClone({
    version: "1.0",
    createSurface: { surfaceId: surface.id, catalogId: CATALOG_ID, components, dataModel: surface.dataModel.get("/") },
  } as const);
}

/** Whether a component has an action to its surface's agent. */
export const hasEvent = ({ action }: Record<string, unknown>): boolean => isObject(action) && hasOwn(action, "event");

/** `surface` as it is accepted, whose whole state is `state`. */
export function acceptedSurface(surface: EngineSurface, state: CreateSurface): Accepted {
  const { components } = state.createSurface;
  return { state, asks: components.some(hasEvent), components: components.length, ...namedImages(surface) };
}
