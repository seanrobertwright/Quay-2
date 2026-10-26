// The builder's in-memory session for each project: which definition is open, the canvas
// viewport of every definition shown so far, and a draft of every graph touched. Sessions
// live only while Quay runs, and the active project picks which one the builder shows.
import { normalizePath } from "../../utils/paths.ts";
import { createGraphDraft, isDirty, reconcileWithDisk, type GraphDraft } from "./drafts.ts";
import { parseLayoutViewport } from "./model.ts";
import type { DefinitionFile, DefinitionRef } from "./types.ts";

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface BuilderSession {
  /** The project's display name when the session was last touched. */
  name: string;
  open: DefinitionRef | null;
  /** Keyed by `definitionKey`. */
  viewports: Readonly<Record<string, Viewport>>;
  /** Keyed by `definitionKey`. */
  drafts: Readonly<Record<string, GraphDraft>>;
}

/** Sessions keyed by normalized project path. */
export type Sessions = ReadonlyMap<string, BuilderSession>;

export const EMPTY_SESSION: BuilderSession = { name: "", open: null, viewports: {}, drafts: {} };

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

/** A dirty draft and the project it belongs to. */
export interface DirtyDraft {
  projectPath: string;
  projectName: string;
  draft: GraphDraft;
}

/** Every dirty draft in every project, in the order the projects were first touched. */
export function dirtyDrafts(sessions: Sessions): DirtyDraft[] {
  const out: DirtyDraft[] = [];
  for (const [projectPath, session] of sessions) {
    for (const draft of Object.values(session.drafts)) {
      if (isDirty(draft)) out.push({ projectPath, projectName: session.name, draft });
    }
  }
  return out;
}

/** The normalized paths of the projects with a dirty draft, sorted. */
export function dirtyProjectKeys(sessions: Sessions): string[] {
  return [...new Set(dirtyDrafts(sessions).map((d) => d.projectPath))].sort();
}

/**
 * The session after the builder read a graph's file. An existing draft is kept, marked or
 * replaced as `reconcileWithDisk` decides. A graph without a draft gets one, and the
 * layout file's viewport when the session has none for it. A file the canvas can't draw,
 * or one that is gone, leaves no draft to replace, so its problem shows instead.
 */
export function applyDiskRead(session: BuilderSession, ref: DefinitionRef, file: DefinitionFile): BuilderSession {
  const key = definitionKey(ref);
  const existing = session.drafts[key];
  if (existing) {
    const decision = reconcileWithDisk(existing, file);
    if (decision.action === "keep") {
      return decision.draft === existing ? session : { ...session, drafts: { ...session.drafts, [key]: decision.draft } };
    }
  }
  const { [key]: _dropped, ...others } = session.drafts;
  const created = file.missing ? null : createGraphDraft(ref, file);
  if (!created?.ok) return existing ? { ...session, drafts: others } : session;
  const viewport = session.viewports[key] ?? parseLayoutViewport(file.layout);
  return {
    ...session,
    drafts: { ...others, [key]: created.value },
    viewports: viewport ? { ...session.viewports, [key]: viewport } : session.viewports,
  };
}

/** The session without `ref`'s draft, as when the user discards it or reloads it from disk. */
export function dropDraft(session: BuilderSession, ref: DefinitionRef): BuilderSession {
  const key = definitionKey(ref);
  if (!(key in session.drafts)) return session;
  const { [key]: _dropped, ...others } = session.drafts;
  return { ...session, drafts: others };
}
