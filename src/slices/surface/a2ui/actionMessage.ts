import type { A2uiClientAction } from "./engine.ts";

/** The A2UI 1.0 message of an action, as the standard defines it. */
export function actionMessage({ name, surfaceId, sourceComponentId, timestamp, context, userMessage, catalogId, metadata }: A2uiClientAction): Record<string, unknown> {
  const left = Object.entries({ userMessage, catalogId, metadata }).filter(([, value]) => value !== undefined);
  return { version: "1.0", action: { name, surfaceId, sourceComponentId, timestamp, context, ...Object.fromEntries(left) } };
}
