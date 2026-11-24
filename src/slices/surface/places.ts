// A terminal's surfaces by where they are drawn. What is worked out of a list is kept with it, so the
// same list gives the same result.
import { surfacesByTerminal, useSurfacesOf } from "./surfaceHost.ts";
import type { Place, SurfaceKey, SurfaceRecord } from "./surfaceTypes.ts";

const byPlace = new WeakMap<readonly SurfaceRecord[], Map<Place, readonly SurfaceRecord[]>>();

/** Those of `surfaces`, one terminal's, that are drawn in `place`, in the order of `surfaces`. */
export function surfacesIn(place: Place, surfaces: readonly SurfaceRecord[]): readonly SurfaceRecord[] {
  const places = byPlace.get(surfaces) ?? new Map<Place, readonly SurfaceRecord[]>();
  byPlace.set(surfaces, places);
  const kept = places.get(place);
  if (kept) return kept;
  const inPlace = surfaces.filter((record) => record.place === place);
  const found = inPlace.length === surfaces.length ? surfaces : inPlace;
  places.set(place, found);
  return found;
}

/** `terminalId`'s surfaces that are drawn in `place`, oldest first. */
export const useSurfacesIn = (place: Place, terminalId: string | null): readonly SurfaceRecord[] => surfacesIn(place, useSurfacesOf(terminalId));

/** The surface `key` as it is kept now, or null when it is not. */
export const keptSurface = ({ terminal_id, id }: SurfaceKey): SurfaceRecord | null =>
  surfacesByTerminal()
    .get(terminal_id)
    ?.find((record) => record.id === id) ?? null;
