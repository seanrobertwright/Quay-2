// The check Rust asks for before it commits a call: run on a scratch engine, applied nowhere.
import type { CheckRequest, CreateSurface, SurfaceComponent, Verdict } from "../surfaceTypes.ts";
import { typedTool } from "../typed/index.ts";
import { CATALOG_ID } from "./catalog.ts";
import { engineError, engineFor, type EngineSurface } from "./engine.ts";

/** `surface`'s whole state as one `createSurface`. */
function compact(surface: EngineSurface): CreateSurface {
  const components = [...surface.componentsModel.values].map(
    ({ id, type, properties }): SurfaceComponent => ({ id, component: type, ...properties }),
  );
  return {
    version: "1.0",
    createSurface: { surfaceId: surface.id, catalogId: CATALOG_ID, components, dataModel: surface.dataModel.get("/") },
  };
}

/** Whether a component has an action to the surface's agent. */
const asks = ({ action }: SurfaceComponent) => typeof action === "object" && action !== null && "event" in action;

/** The verdict on a call. Whatever is wrong with it is in the verdict, so a check always has one. */
export function check({ tool, surface_id, arguments: args }: CheckRequest): Verdict {
  try {
    const typed = typedTool(tool);
    if (!typed) throw new Error(`Quay has no tool "${tool}".`);
    const { version, createSurface } = typed.expand(args, surface_id);
    const scratch = engineFor({ version, createSurface: { ...createSurface, catalogId: CATALOG_ID } });
    try {
      const state = structuredClone(compact(scratch.surface));
      const { components } = state.createSurface;
      return {
        state,
        asks: components.some(asks),
        components: components.length,
        images: components.filter(({ component }) => component === "Image").length,
      };
    } finally {
      scratch.dispose();
    }
  } catch (error) {
    return { errors: [engineError(error, surface_id)] };
  }
}
