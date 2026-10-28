// The builder's in-memory session for each project: which definition is open, the canvas
// viewport of every definition shown so far, a draft of every graph and contract touched,
// and each draft's undo history (#248). Sessions live only while Quay runs, and the
// active project picks which one the builder shows.
import { normalizePath } from "../../utils/paths.ts";
import { renameInBindings } from "./contract.ts";
import {
  changedNodeIds,
  createDraft,
  isDirty,
  reconcileWithDisk,
  restoreSnapshot,
  snapshotOf,
  withChanges,
  withId,
  type Draft,
  type DraftSnapshot,
} from "./drafts.ts";
import { createHistory, endMerge, record, redo, undo, type History, type Step } from "./history.ts";
import { hasOwn, parseLayoutViewport, type JsonObject } from "./model.ts";
import type { DefinitionFile, DefinitionRef, RenameOutcome } from "./types.ts";

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
  drafts: Readonly<Record<string, Draft>>;
  /**
   * The undo history of each draft with steps to undo or redo, keyed by `definitionKey`.
   * Selection, viewport and panel state are never in it.
   */
  histories: Readonly<Record<string, History<DraftSnapshot>>>;
}

/** Sessions keyed by normalized project path. */
export type Sessions = ReadonlyMap<string, BuilderSession>;

export const EMPTY_SESSION: BuilderSession = { name: "", open: null, viewports: {}, drafts: {}, histories: {} };

/** One key per definition. Ids are filename-safe, so they never hold a `/`. */
export function definitionKey(ref: DefinitionRef): string {
  return `${ref.kind}/${ref.id}`;
}

/** A definition's file, relative to the repository, as the backend reports paths. */
export const definitionPath = (ref: DefinitionRef) => `.praxis/${ref.kind}/${ref.id}.json`;

/** A contract's bindings file, relative to the repository, as the backend reports paths. */
export const bindingsPath = (contractId: string) => `.praxis/bindings/${contractId}.json`;

const sameRef = (a: DefinitionRef | null, b: DefinitionRef) => a !== null && a.kind === b.kind && a.id === b.id;

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
  draft: Draft;
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
 * The session after the builder read a graph's or a contract's file. An existing draft is
 * kept, marked or replaced as `reconcileWithDisk` decides. A definition without a draft gets
 * one, and a graph the layout file's viewport when the session has none for it. A file the
 * builder can't edit, or one that is gone, leaves no draft to replace, so its problem shows
 * instead.
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
  const created = file.missing ? null : createDraft(ref, file);
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
  if (!hasOwn(session.drafts, key)) return session;
  const { [key]: _dropped, ...others } = session.drafts;
  return { ...session, drafts: others, histories: withoutKey(session.histories, key) };
}

function withoutKey<T>(record: Readonly<Record<string, T>>, key: string): Readonly<Record<string, T>> {
  if (!hasOwn(record, key)) return record;
  const { [key]: _dropped, ...others } = record;
  return others;
}

/**
 * The session after `change` to `ref`'s draft, recorded in its history as `step` at `now`.
 * A change that returns the same draft, such as a drag dropped where it began, records
 * nothing.
 */
export function changeDraft(
  session: BuilderSession,
  ref: DefinitionRef,
  change: (draft: Draft) => Draft,
  step: Step,
  now: number
): BuilderSession {
  const key = definitionKey(ref);
  const draft = session.drafts[key];
  if (!draft) return session;
  const next = change(draft);
  if (next === draft) return session;
  const history = record(session.histories[key] ?? createHistory<DraftSnapshot>(), step, snapshotOf(draft), now);
  return { ...session, drafts: { ...session.drafts, [key]: next }, histories: { ...session.histories, [key]: history } };
}

/** Ends any merging step in `ref`'s history, as a text field's blur or Enter does. */
export function endDraftMerge(session: BuilderSession, ref: DefinitionRef): BuilderSession {
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
export const undoDraft = (session: BuilderSession, ref: DefinitionRef) => moveInHistory(session, ref, undo);

/** Redoes the last step undone in `ref`'s history, or returns null when there is none. */
export const redoDraft = (session: BuilderSession, ref: DefinitionRef) => moveInHistory(session, ref, redo);

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

/** `record` with `from`'s value, if it has one, under `to` instead. */
function moveKey<T>(record: Readonly<Record<string, T>>, from: string, to: string): Readonly<Record<string, T>> {
  if (!hasOwn(record, from)) return record;
  const { [from]: value, ...others } = record;
  return { ...others, [to]: value };
}

/** The session with `draft`, a definition not yet saved, added under `ref` and opened (#222). */
export function addNewDraft(session: BuilderSession, ref: DefinitionRef, draft: Draft): BuilderSession {
  const key = definitionKey(ref);
  return {
    ...session,
    open: ref,
    drafts: { ...session.drafts, [key]: draft },
    histories: withoutKey(session.histories, key),
  };
}

/**
 * The session after renaming `from`, a draft never saved, to `toId`. It has no file, so
 * the rename happens only here: the draft moves to the new id with that id inside. Like
 * every rename, it sits outside undo and clears the draft's history.
 */
export function renameUnsavedDraft(session: BuilderSession, from: DefinitionRef, toId: string): BuilderSession {
  const to = { kind: from.kind, id: toId };
  const fromKey = definitionKey(from);
  const draft = session.drafts[fromKey];
  if (!draft) return session;
  const { [fromKey]: _dropped, ...others } = session.drafts;
  return {
    ...session,
    open: sameRef(session.open, from) ? to : session.open,
    drafts: { ...others, [definitionKey(to)]: withId(draft, to) },
    histories: withoutKey(session.histories, fromKey),
    viewports: moveKey(session.viewports, fromKey, definitionKey(to)),
  };
}

/**
 * The session after the backend renamed `from` to `toId` (#222). The renamed definition's
 * draft, which was clean, is dropped, so the builder reads the moved file afresh; its
 * viewport and its place as the open definition move to the new id. Every other draft the
 * rename touched loses its history: one whose references the rename rewrote, and a
 * contract that binds the renamed graph or grant (#223). A clean one whose file, or bindings
 * file, the rename rewrote is dropped, so it reads the rewritten file. Any other takes the
 * rewritten references and, for each file the rename rewrote from the bytes the draft
 * loaded, expects the new bytes on its next save.
 */
export function applyRename(
  session: BuilderSession,
  from: DefinitionRef,
  toId: string,
  outcome: RenameOutcome
): BuilderSession {
  const to = { kind: from.kind, id: toId };
  const fromKey = definitionKey(from);
  const hashesByPath = new Map(outcome.changes.flatMap((c) => (c.hashes ? [[c.path, c.hashes] as const] : [])));
  const rewritten = new Map(outcome.drafts.map((d) => [definitionKey(d), d.content as JsonObject]));
  const drafts: Record<string, Draft> = {};
  let histories = withoutKey(session.histories, fromKey);
  for (const [key, draft] of Object.entries(session.drafts)) {
    if (key === fromKey) continue;
    const hashes = hashesByPath.get(definitionPath(draft.ref));
    const bindingsHashes = draft.bindings ? hashesByPath.get(bindingsPath(draft.ref.id)) : undefined;
    const content = rewritten.get(key);
    const bindings = draft.bindings && renameInBindings(draft.bindings, from.kind, from.id, toId);
    if (!hashes && !bindingsHashes && !content && bindings === draft.bindings) {
      drafts[key] = draft;
      continue;
    }
    histories = withoutKey(histories, key);
    if (!isDirty(draft) && (hashes || bindingsHashes)) continue;
    const next = withChanges(draft, content ?? draft.content, draft.positions, bindings);
    drafts[key] = {
      ...next,
      baseHash: hashes && draft.baseHash === hashes.previous ? hashes.next : next.baseHash,
      baseBindingsHash:
        bindingsHashes && draft.baseBindingsHash === bindingsHashes.previous ? bindingsHashes.next : next.baseBindingsHash,
    };
  }
  return {
    ...session,
    open: sameRef(session.open, from) ? to : session.open,
    drafts,
    histories,
    viewports: moveKey(session.viewports, fromKey, definitionKey(to)),
  };
}

/** The session after `ref` was deleted (#222): its draft, history and viewport are dropped, and it closes. */
export function removeDefinition(session: BuilderSession, ref: DefinitionRef): BuilderSession {
  const key = definitionKey(ref);
  const { [key]: _dropped, ...drafts } = session.drafts;
  return {
    ...session,
    open: sameRef(session.open, ref) ? null : session.open,
    drafts,
    histories: withoutKey(session.histories, key),
    viewports: withoutKey(session.viewports, key),
  };
}
