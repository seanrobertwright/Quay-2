import { lookOf } from "./looks/index.ts";
import { RAW_TOOL } from "./rawTool.ts";
import type { SurfaceRecord } from "./surfaceTypes.ts";

/** What a surface asks or shows, in a line: a raw one's title, or what a typed one's parts say. */
export const wordsOf = ({ tool, title, state }: SurfaceRecord): string => (tool === RAW_TOOL ? title : lookOf(tool).asksFor(state.createSurface.components));
