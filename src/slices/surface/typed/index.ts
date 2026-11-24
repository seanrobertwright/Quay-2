// The typed tools, each with its pure functions.
import type { CreateSurface, SurfaceAction } from "../surfaceTypes.ts";
import * as ask from "./ask.ts";
import * as board from "./board.ts";

export interface TypedTool {
  /** The surface a call's arguments make. They are as Rust checked them, and are not checked again. */
  expand: (args: unknown, surfaceId: string) => CreateSurface;
  /** The result the agent gets for an action. Left out by a tool whose surfaces have none. */
  collapse?: (action: SurfaceAction) => unknown;
  /** The data paths the frame works out of what the operator has put in, and can work out again. Left out where there are none. */
  workedOut?: readonly string[];
}

const TYPED: ReadonlyMap<string, TypedTool> = new Map([
  ["quay_ask", { expand: (args, surfaceId) => ask.expand(args as ask.AskArguments, surfaceId), collapse: ask.collapse, workedOut: [ask.READY] }],
  ["quay_board", { expand: (args, surfaceId) => board.expand(args as board.BoardArguments, surfaceId) }],
]);

/** The typed tool `name`, or null when Quay has none of that name. */
export const typedTool = (name: string): TypedTool | null => TYPED.get(name) ?? null;
