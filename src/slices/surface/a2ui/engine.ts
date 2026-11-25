// The engine, with Quay's catalog, in strict mode.
import type { ReactCatalogComponent } from "@a2ui/react";
import { mapErrorToRendererMessage, MessageProcessor, STRICT_VALIDATION, type ActionListener, type SurfaceModel } from "@a2ui/web_core/v1_0";
import type { CreateSurface, CheckError } from "../surfaceTypes.ts";
import { catalog } from "./catalog.ts";
import { fits } from "./heldToLimit.ts";

/** What an action listener is given. */
export type A2uiClientAction = Parameters<ActionListener>[0];

export type EngineSurface = SurfaceModel<ReactCatalogComponent>;

/**
 * An engine that holds the surface `state` creates. It throws what the engine finds wrong with it. `update`
 * makes it the surface of a later state, which has all of its components; those that stay are not drawn anew.
 */
export function engineFor(state: CreateSurface, onAction?: ActionListener) {
  const processor = new MessageProcessor<ReactCatalogComponent>([catalog], onAction, { validationConfig: STRICT_VALIDATION, version: "1.0" });
  processor.processMessages([structuredClone(state)]);
  const surface: EngineSurface | undefined = processor.model.getSurface(state.createSurface.surfaceId);
  if (!surface) throw new Error(`The engine made no surface "${state.createSurface.surfaceId}".`);
  let { components: earlier } = state.createSurface;
  const update = ({ version, createSurface: { surfaceId, components, dataModel } }: CreateSurface) => {
    // The engine resolves each component as it replaces it, among earlier ones that are still there and over the
    // earlier data. Where that may be too much to draw, it has no root to resolve until it has replaced the rest.
    const before = new Set(earlier.map((component) => JSON.stringify(component)));
    const inSteps = fits([...earlier, ...components.filter((component) => !before.has(JSON.stringify(component)))], surface.dataModel);
    if (!inSteps) {
      surface.componentsModel.removeComponent("root");
      surface.dataModel.set("/", dataModel);
    }
    const ordered = inSteps ? components : [...components].sort((a, b) => Number(a.id === "root") - Number(b.id === "root"));
    processor.processMessages(structuredClone([{ version, updateComponents: { surfaceId, components: ordered } }, { version, updateDataModel: { surfaceId, value: dataModel } }]));
    earlier = components;
  };
  return { surface, update, dispose: () => processor.dispose() };
}

/** The engine's strict checks of each message, without those that need all of a call's messages: a root, every child, no orphan. */
const PART_OF_A_CALL = { ...STRICT_VALIDATION, allowMissingRoot: true, allowDanglingReferences: true, allowOrphanComponents: true };

/** An engine that a call's messages are tried on, one at a time. */
export function scratchEngine() {
  const processor = new MessageProcessor<ReactCatalogComponent>([catalog], undefined, { validationConfig: PART_OF_A_CALL, version: "1.0" });
  return {
    /** Runs a message. It throws the first thing the engine finds wrong with it. */
    run: (message: object) => processor.processMessages([structuredClone(message)]),
    surface: (id: string): EngineSurface | undefined => processor.model.getSurface(id),
    dispose: () => processor.dispose(),
  };
}

/** What the engine threw, as it would tell the agent. */
export function engineError(error: unknown, surfaceId: string): CheckError {
  const { code, message, path } = mapErrorToRendererMessage(error, { surfaceId, version: "1.0" }).error;
  return { code, message, ...(typeof path === "string" ? { path } : {}) };
}
