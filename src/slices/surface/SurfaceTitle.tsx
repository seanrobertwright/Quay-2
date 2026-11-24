import { lookOf } from "./looks/index.ts";
import type { SurfaceRecord } from "./surfaceTypes.ts";

/** The title of a surface whose frame draws it, as `Look.titled` says. */
export const SurfaceTitle = ({ record }: { record: SurfaceRecord }) =>
  lookOf(record.tool).titled && record.title !== "" ? <p className="mb-2 font-semibold wrap-anywhere whitespace-pre-wrap text-white">{record.title}</p> : null;
