// The engine, with Quay's catalog, in strict mode.
import type { ReactCatalogComponent } from "@a2ui/react";
import { mapErrorToRendererMessage, MessageProcessor, STRICT_VALIDATION, type ActionListener, type SurfaceModel } from "@a2ui/web_core/v1_0";
import type { CreateSurface, EngineError } from "../surfaceTypes.ts";
import { catalog } from "./catalog.ts";

export type EngineSurface = SurfaceModel<ReactCatalogComponent>;

/** An engine that holds the surface `state` creates. It throws what the engine finds wrong with it. */
export function engineFor(state: CreateSurface, onAction?: ActionListener) {
  const processor = new MessageProcessor<ReactCatalogComponent>([catalog], onAction, { validationConfig: STRICT_VALIDATION, version: "1.0" });
  processor.processMessages([structuredClone(state)]);
  const surface: EngineSurface | undefined = processor.model.getSurface(state.createSurface.surfaceId);
  if (!surface) throw new Error(`The engine made no surface "${state.createSurface.surfaceId}".`);
  return { surface, dispose: () => processor.dispose() };
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
export function engineError(error: unknown, surfaceId: string): EngineError {
  const { code, message, path } = mapErrorToRendererMessage(error, { surfaceId, version: "1.0" }).error;
  return { code, message, ...(typeof path === "string" ? { path } : {}) };
}
