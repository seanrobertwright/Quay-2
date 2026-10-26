// The builder's in-memory session for each project: which definition is open, and the
// canvas viewport of every definition shown so far. Sessions live only while Quay runs,
// and the active project picks which one the builder shows.
import { normalizePath } from "../../utils/paths.ts";
import type { DefinitionRef } from "./types.ts";

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface BuilderSession {
  open: DefinitionRef | null;
  /** Keyed by `definitionKey`. */
  viewports: Readonly<Record<string, Viewport>>;
}

/** Sessions keyed by normalized project path. */
export type Sessions = ReadonlyMap<string, BuilderSession>;

export const EMPTY_SESSION: BuilderSession = { open: null, viewports: {} };

/** One key per definition. Ids are filename-safe, so they never hold a `/`. */
export function definitionKey(ref: DefinitionRef): string {
  return `${ref.kind}/${ref.id}`;
}

export function sessionFor(sessions: Sessions, projectPath: string): BuilderSession {
  return sessions.get(normalizePath(projectPath)) ?? EMPTY_SESSION;
}

/** A copy of `sessions` with `projectPath`'s session replaced by `update` of it. */
export function updateSession(
  sessions: Sessions,
  projectPath: string,
  update: (session: BuilderSession) => BuilderSession
): Sessions {
  const key = normalizePath(projectPath);
  const next = new Map(sessions);
  next.set(key, update(sessions.get(key) ?? EMPTY_SESSION));
  return next;
}
