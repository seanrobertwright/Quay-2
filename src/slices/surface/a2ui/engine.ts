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

/** What the engine threw, as it would tell the agent. */
export function engineError(error: unknown, surfaceId: string): EngineError {
  const { code, message, path } = mapErrorToRendererMessage(error, { surfaceId, version: "1.0" }).error;
  return { code, message, ...(typeof path === "string" ? { path } : {}) };
}
