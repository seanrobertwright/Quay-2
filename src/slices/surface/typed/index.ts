// The typed tools, each with its two pure functions.
import type { CreateSurface, SurfaceAction } from "../surfaceTypes.ts";
import * as ask from "./ask.ts";

export interface TypedTool {
  /** The surface a call's arguments make. They are as Rust checked them, and are not checked again. */
  expand: (args: unknown, surfaceId: string) => CreateSurface;
  /** The result the agent gets for an action. */
  collapse: (action: SurfaceAction) => unknown;
}

const TYPED: ReadonlyMap<string, TypedTool> = new Map([
  ["quay_ask", { expand: (args, surfaceId) => ask.expand(args as ask.AskArguments, surfaceId), collapse: ask.collapse }],
]);

/** The typed tool `name`, or null when Quay has none of that name. */
export const typedTool = (name: string): TypedTool | null => TYPED.get(name) ?? null;
