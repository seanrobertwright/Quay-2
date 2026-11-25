// What an update leaves of the unsent answer: all of it but what is at a data path that the update sets,
// under one, or holds one. Rust drops the same from what it holds.
import type { DataValues } from "./differences.ts";
import type { Carried } from "./surfaceTypes.ts";

/** Whether one of two data paths is the other, is under it, or holds it. The whole is `/`. */
export const touches = (a: string, b: string) => a === "/" || b === "/" || `${a}/`.startsWith(`${b}/`) || `${b}/`.startsWith(`${a}/`);

/** What of `values`, read at `revision`, the revision that `carried` is of keeps. */
export function carriedOn({ from, set }: Carried, revision: number, values: DataValues): DataValues {
  if (revision < from) return {};
  const setSince = Object.keys(set).filter((path) => set[path] > revision);
  return Object.fromEntries(Object.entries(values).filter(([path]) => !setSince.some((its) => touches(its, path))));
}
