import { RAW_TOOL } from "./rawTool.ts";
import type { SurfaceRecord } from "./surfaceTypes.ts";

/** A raw surface's title, the first line of its content. A typed one's is its layout's or has none. */
export const SurfaceTitle = ({ record }: { record: SurfaceRecord }) =>
  record.tool === RAW_TOOL && record.title !== "" ? <p className="mb-2 font-semibold wrap-anywhere whitespace-pre-wrap text-white">{record.title}</p> : null;
