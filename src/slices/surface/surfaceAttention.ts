// Which surfaces ask for the operator's attention. What is worked out of a terminal's surfaces is kept
// with the list it was worked out of, so a render reads no surface again until one of its terminal's
// changes.
import { useSyncExternalStore } from "react";
import { subscribeToSurfaces, surfacesByTerminal, useSurfacesOf } from "./surfaceHost.ts";
import { isLive, type SurfaceRecord } from "./surfaceTypes.ts";

interface Attention {
  live: readonly SurfaceRecord[];
  asking: readonly SurfaceRecord[];
}

const NONE: Attention = { live: [], asking: [] };
const attentionByList = new WeakMap<readonly SurfaceRecord[], Attention>();

/** The live ones of `surfaces`, one terminal's, and which of those ask, each in the order of `surfaces`. */
function attentionOf(surfaces: readonly SurfaceRecord[]): Attention {
  const kept = attentionByList.get(surfaces);
  if (kept) return kept;
  const live = surfaces.filter(isLive);
  const asking = live.filter(({ asks }) => asks);
  const attention = { live: live.length > 0 ? live : NONE.live, asking: asking.length > 0 ? asking : NONE.asking };
  attentionByList.set(surfaces, attention);
  return attention;
}

/** The asking ones of `surfaces`, one terminal's. The same list gives the same result. */
export const askingOf = (surfaces: readonly SurfaceRecord[]): readonly SurfaceRecord[] => attentionOf(surfaces).asking;

/** `terminalId`'s live surfaces, oldest first. */
export const useLiveSurfacesOf = (terminalId: string): readonly SurfaceRecord[] => attentionOf(useSurfacesOf(terminalId)).live;

/** `terminalId`'s asking surfaces, oldest first. */
export const useAskingSurfacesOf = (terminalId: string): readonly SurfaceRecord[] => askingOf(useSurfacesOf(terminalId));

/** What of an asking surface an update of its content leaves as it is. */
export type AskingRecord = Readonly<Pick<SurfaceRecord, "terminal_id" | "id" | "order" | "tool">>;

/** A key of `record` among every asking of every surface. */
export const surfaceKey = ({ terminal_id, id, order }: AskingRecord): string => JSON.stringify([terminal_id, id, order]);

let lastRead: ReturnType<typeof surfacesByTerminal> | null = null;
let lastAsking: readonly AskingRecord[] = [];

/** Whether `a` and `b` are the same asking of a surface: a terminal may use an id again, for a surface of another order. */
export const sameSurface = (a: AskingRecord, b: AskingRecord): boolean => a.terminal_id === b.terminal_id && a.id === b.id && a.order === b.order;

/** Every terminal's asking surfaces. The result is the same one until a surface starts or stops asking. */
function askingSurfaces(): readonly AskingRecord[] {
  const byTerminal = surfacesByTerminal();
  if (byTerminal === lastRead) return lastAsking;
  lastRead = byTerminal;
  const asking = [...byTerminal.values()].flatMap(askingOf);
  const same = asking.length === lastAsking.length && asking.every((record, i) => sameSurface(record, lastAsking[i]));
  if (!same) lastAsking = asking;
  return lastAsking;
}

/** Every terminal's asking surfaces, grouped by terminal. It renders again only when a surface starts or stops asking. */
export const useAskingSurfaces = (): readonly AskingRecord[] => useSyncExternalStore(subscribeToSurfaces, askingSurfaces);
