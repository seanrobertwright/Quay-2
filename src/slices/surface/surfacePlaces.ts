// A terminal's surfaces by the place each is drawn in.
import { useSyncExternalStore } from "react";
import { subscribeToSurfaces, surfacesByTerminal } from "./surfaceHost.ts";
import type { SurfacePlace, SurfaceRecord } from "./surfaceTypes.ts";

const NONE: readonly SurfaceRecord[] = [];

/** What was last given, by terminal and place, with the list it was taken from. */
const lastGiven = new Map<string, { of: readonly SurfaceRecord[]; given: readonly SurfaceRecord[] }>();

/** `terminalId`'s surfaces in `place`, oldest first. The result is the same one until one of them changes. */
function surfacesIn(terminalId: string, place: SurfacePlace): readonly SurfaceRecord[] {
  const key = JSON.stringify([terminalId, place]);
  const of = surfacesByTerminal().get(terminalId);
  if (!of) {
    lastGiven.delete(key);
    return NONE;
  }
  const last = lastGiven.get(key);
  if (last?.of === of) return last.given;
  const now = of.filter((record) => record.place === place);
  const before = last?.given ?? NONE;
  const same = now.length === before.length && now.every((record, i) => record === before[i]);
  const given = same ? before : now;
  lastGiven.set(key, { of, given });
  return given;
}

/** `terminalId`'s surfaces in `place`, oldest first. A change of a surface elsewhere renders nothing again. */
export const useSurfacesIn = (terminalId: string | null, place: SurfacePlace): readonly SurfaceRecord[] =>
  useSyncExternalStore(subscribeToSurfaces, () => (terminalId === null ? NONE : surfacesIn(terminalId, place)));
