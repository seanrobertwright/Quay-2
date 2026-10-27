// The builder's in-memory session for each project: which definition is open, the canvas
// viewport of every definition shown so far, a draft of every graph touched, and each
// graph workspace's undo history (#248). Sessions live only while Quay runs, and the
// active project picks which one the builder shows.
import { normalizePath } from "../../utils/paths.ts";
import {
  changedNodeIds,
  createGraphDraft,
  isDirty,
  reconcileWithDisk,
  restoreSnapshot,
  snapshotOf,
  type GraphDraft,
  type GraphSnapshot,
} from "./drafts.ts";
import { createHistory, endMerge, record, redo, undo, type History, type Step } from "./history.ts";
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
  /**
   * The undo history of each graph workspace with steps to undo or redo, keyed by
   * `definitionKey`. Selection, viewport and panel state are never in it.
   */
  histories: Readonly<Record<string, History<GraphSnapshot>>>;
}

/** Sessions keyed by normalized project path. */
export type Sessions = ReadonlyMap<string, BuilderSession>;

export const EMPTY_SESSION: BuilderSession = { name: "", open: null, viewports: {}, drafts: {}, histories: {} };

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
  // A reload from disk replaces the draft, so the steps that led to the old one go too.
  const { [key]: _dropped, ...others } = session.drafts;
  const histories = withoutKey(session.histories, key);
  const created = file.missing ? null : createGraphDraft(ref, file);
  if (!created?.ok) return existing ? { ...session, drafts: others, histories } : session;
  const viewport = session.viewports[key] ?? parseLayoutViewport(file.layout);
  return {
    ...session,
    drafts: { ...others, [key]: created.value },
    histories,
    viewports: viewport ? { ...session.viewports, [key]: viewport } : session.viewports,
  };
}

/** The session without `ref`'s draft and history, as when the user discards it or reloads it from disk. */
export function dropDraft(session: BuilderSession, ref: DefinitionRef): BuilderSession {
  const key = definitionKey(ref);
  if (!Object.prototype.hasOwnProperty.call(session.drafts, key)) return session;
  const { [key]: _dropped, ...others } = session.drafts;
  return { ...session, drafts: others, histories: withoutKey(session.histories, key) };
}

function withoutKey<T>(record: Readonly<Record<string, T>>, key: string): Readonly<Record<string, T>> {
  if (!Object.prototype.hasOwnProperty.call(record, key)) return record;
  const { [key]: _dropped, ...others } = record;
  return others;
}

/**
 * The session after `change` to `ref`'s draft, recorded in its history as `step` at `now`.
 * A change that returns the same draft, such as a drag dropped where it began, records
 * nothing.
 */
export function changeGraph(
  session: BuilderSession,
  ref: DefinitionRef,
  change: (draft: GraphDraft) => GraphDraft,
  step: Step,
  now: number
): BuilderSession {
  const key = definitionKey(ref);
  const draft = session.drafts[key];
  if (!draft) return session;
  const next = change(draft);
  if (next === draft) return session;
  const history = record(session.histories[key] ?? createHistory<GraphSnapshot>(), step, snapshotOf(draft), now);
  return { ...session, drafts: { ...session.drafts, [key]: next }, histories: { ...session.histories, [key]: history } };
}

/** Ends any merging step in `ref`'s history, as a text field's blur or Enter does. */
export function endGraphMerge(session: BuilderSession, ref: DefinitionRef): BuilderSession {
  const key = definitionKey(ref);
  const history = session.histories[key];
  const ended = history && endMerge(history);
  return ended === history ? session : { ...session, histories: { ...session.histories, [key]: ended } };
}

/** What an undo or redo did: the session after it, the step's label, and the nodes it changed. */
export interface HistoryMove {
  session: BuilderSession;
  label: string;
  /** The nodes the step changed that exist afterwards, for the selection. */
  changed: string[];
}

function moveInHistory(session: BuilderSession, ref: DefinitionRef, direction: typeof undo): HistoryMove | null {
  const key = definitionKey(ref);
  const draft = session.drafts[key];
  const history = session.histories[key];
  if (!draft || !history) return null;
  const current = snapshotOf(draft);
  const moved = direction(history, current);
  if (!moved) return null;
  return {
    session: {
      ...session,
      drafts: { ...session.drafts, [key]: restoreSnapshot(draft, moved.snapshot) },
      histories: { ...session.histories, [key]: moved.history },
    },
    label: moved.label,
    changed: changedNodeIds(current, moved.snapshot),
  };
}

/** Undoes the last step of `ref`'s history, or returns null when there is none. */
export const undoGraph = (session: BuilderSession, ref: DefinitionRef) => moveInHistory(session, ref, undo);

/** Redoes the last step undone in `ref`'s history, or returns null when there is none. */
export const redoGraph = (session: BuilderSession, ref: DefinitionRef) => moveInHistory(session, ref, redo);

/** `sessions` without the histories of these projects, as when they are removed from Quay. Drafts stay. */
export function forgetHistories(sessions: Sessions, projectPaths: readonly string[]): Sessions {
  let next: Map<string, BuilderSession> | null = null;
  for (const path of projectPaths) {
    const key = normalizePath(path);
    const session = sessions.get(key);
    if (!session || Object.keys(session.histories).length === 0) continue;
    next ??= new Map(sessions);
    next.set(key, { ...session, histories: {} });
  }
  return next ?? sessions;
}
