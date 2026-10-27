// The Praxis Builder (#221): a modal of its own that lists the active project's `.praxis/`
// definitions and shows a graph on the canvas, with its validation problems, where it can
// be edited, undone and saved. Closing only hides it, so each project's session, drafts and
// undo histories included, survives until Quay quits. Quitting with unsaved drafts asks first.
import {
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type FC,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Viewport } from "@xyflow/react";
import {
  CircleAlert,
  FolderOpen,
  FolderPlus,
  PanelLeftClose,
  Keyboard,
  PanelLeftOpen,
  Redo2,
  RefreshCw,
  Save,
  TriangleAlert,
  Undo2,
  Workflow,
  X,
} from "lucide-react";
import { normalizePath } from "../../utils/paths.ts";
import { parseGraph, type JsonObject, type XYPosition } from "./model.ts";
import { RECORD_KINDS } from "./kinds.ts";
import { GraphView, UndrawnGraphProblems, type BuilderCanvas } from "./GraphView.tsx";
import { isDirty, layoutForSave, markDeletedOnDisk, markSaved, moveNodes, type GraphDraft } from "./drafts.ts";
import { editDraft, nodeIdsOf, stepFor, type GraphEdit } from "./editor.ts";
import { canRedo, canUndo } from "./history.ts";
import { ariaKeyShortcuts, commandFor, focusRegion, shortcutLabel, type BuilderCommand } from "./keymap.ts";
import { ShortcutsHelp } from "./ShortcutsHelp.tsx";
import { isTextField } from "../workspace/ctrlBPrefix.ts";
import {
  applyDiskRead,
  changeGraph,
  definitionKey,
  dirtyDrafts,
  dirtyProjectKeys,
  dropDraft,
  endGraphMerge,
  forgetHistories,
  redoGraph,
  sessionFor,
  undoGraph,
  updateSession,
  type DirtyDraft,
  type Sessions,
} from "./session.ts";
import type { DefinitionFile, DefinitionList, DefinitionRef, FileProblem, PraxisKind, SaveOutcome } from "./types.ts";

export interface BuilderProject {
  path: string;
  name: string;
}

/** What Quay can ask of the builder from outside. */
export interface PraxisBuilderHandle {
  /** Drops the undo histories of these projects, as when they are removed from Quay. */
  forgetProjects: (projectPaths: readonly string[]) => void;
}

/** The selected nodes of one shown graph, keyed by project and definition. */
interface Selection {
  key: string;
  ids: ReadonlySet<string>;
  /** Counts the times nodes were chosen, so the inspector starts afresh for each. */
  chosen: number;
}

const NO_IDS: ReadonlySet<string> = new Set();

interface PraxisBuilderModalProps {
  isOpen: boolean;
  /** The active project, or null when no registered project (or its worktree) is active. */
  project: BuilderProject | null;
  onClose: () => void;
  onAddProject: () => void;
  /** Called with the normalized paths of the projects that have unsaved drafts, whenever they change. */
  onUnsavedProjectsChange?: (projectKeys: string[]) => void;
  ref?: Ref<PraxisBuilderHandle>;
}

type KindListing = { list: DefinitionList; error?: undefined } | { list?: undefined; error: string };

interface Listing {
  projectKey: string;
  byKind: Record<PraxisKind, KindListing>;
}

interface Loaded {
  projectKey: string;
  defKey: string;
  file?: DefinitionFile;
  error?: string;
}

/** A save that found the file changed or deleted under its draft, waiting for the user. */
interface Conflict {
  projectPath: string;
  ref: DefinitionRef;
  reason: "changed" | "deleted";
}

const definitionPath = (ref: DefinitionRef) => `.praxis/${ref.kind}/${ref.id}.json`;

const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex="0"]';

/** Keeps Tab and Shift+Tab cycling inside `root`. Returns true when it moved focus. */
function trapTab(root: HTMLElement, e: { shiftKey: boolean; preventDefault: () => void }): boolean {
  const focusable = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
  if (focusable.length === 0) return false;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;
  if (e.shiftKey && (active === first || active === root || !root.contains(active))) {
    e.preventDefault();
    last.focus();
    return true;
  }
  if (!e.shiftKey && (active === last || !root.contains(active))) {
    e.preventDefault();
    first.focus();
    return true;
  }
  return false;
}

export const PraxisBuilderModal: FC<PraxisBuilderModalProps> = ({
  isOpen,
  project,
  onClose,
  onAddProject,
  onUnsavedProjectsChange,
  ref,
}) => {
  const titleId = useId();
  const listId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const conflictRef = useRef<HTMLDivElement | null>(null);
  const helpRef = useRef<HTMLDivElement | null>(null);
  const [sessions, setSessions] = useState<Sessions>(new Map());
  const [listing, setListing] = useState<Listing | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [listShown, setListShown] = useState(true);
  const [problemsShown, setProblemsShown] = useState(true);
  const toggleProblems = useCallback(() => setProblemsShown((v) => !v), []);
  // Whether each graph validated so far is invalid, keyed by project and definition, for
  // the list's error badge.
  const [invalid, setInvalid] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [revealError, setRevealError] = useState<string | null>(null);
  const [refreshCount, setRefreshCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ tone: "error" | "warning"; text: string } | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [quitPrompt, setQuitPrompt] = useState<{ failures: string[]; busy: boolean } | null>(null);
  const [helpShown, setHelpShown] = useState(false);
  const [selection, setSelection] = useState<Selection>({ key: "", ids: NO_IDS, chosen: 0 });
  // Mod+S asks for a save here, so it runs after the render that applies a field it committed.
  const [saveRequest, setSaveRequest] = useState(0);
  const handledSaveRequest = useRef(0);

  // The latest sessions, ahead of any render. Every change goes through `changeSessions`,
  // which applies it here at once, so saves, the quit check and undo's selection never see
  // a session older than the last change.
  const sessionsRef = useRef(sessions);
  const changeSessions = useCallback((update: (s: Sessions) => Sessions) => {
    const next = update(sessionsRef.current);
    if (next === sessionsRef.current) return;
    sessionsRef.current = next;
    setSessions(next);
  }, []);
  // The shown canvas, for its viewport at save time and for the canvas keys. Keyed by project
  // and definition, so a canvas that is no longer shown is never asked.
  const shownCanvas = useRef<{ key: string; canvas: BuilderCanvas } | null>(null);
  const canvasFor = (key: string) => (shownCanvas.current?.key === key ? shownCanvas.current.canvas : null);

  useImperativeHandle(ref, () => ({ forgetProjects: (paths) => changeSessions((s) => forgetHistories(s, paths)) }), [changeSessions]);

  const projectPath = project?.path ?? null;
  const projectKey = projectPath ? normalizePath(projectPath) : "";
  const session = projectPath ? sessionFor(sessions, projectPath) : null;
  const open = session?.open ?? null;
  const openKind = open?.kind;
  const openId = open?.id;
  const openKey = open ? definitionKey(open) : "";
  const openDraft = session && openKey ? session.drafts[openKey] : undefined;
  const openHistory = session && openKey ? session.histories[openKey] : undefined;
  const viewKey = `${projectKey}|${openKey}`;
  const openContent = openDraft?.content;
  const openNodeIds = useMemo(() => (openContent ? nodeIdsOf(openContent) : []), [openContent]);
  // Only nodes the graph still has, since an undo or a rename can take a selected node away.
  const selected = useMemo(() => {
    if (selection.key !== viewKey || selection.ids.size === 0) return NO_IDS;
    return new Set(openNodeIds.filter((id) => selection.ids.has(id)));
  }, [selection, viewKey, openNodeIds]);

  const unsavedKey = useMemo(() => dirtyProjectKeys(sessions).join("\n"), [sessions]);
  useEffect(() => {
    onUnsavedProjectsChange?.(unsavedKey ? unsavedKey.split("\n") : []);
  }, [unsavedKey, onUnsavedProjectsChange]);

  // List the project's definitions each time the builder is shown, so files changed on
  // disk while it was hidden appear. A response that arrives after a newer request, or
  // after the builder hid, is dropped.
  useEffect(() => {
    if (!isOpen || !projectPath) return;
    let stale = false;
    const key = normalizePath(projectPath);
    void Promise.allSettled(
      RECORD_KINDS.map(({ kind }) => invoke<DefinitionList>("praxis_list", { projectPath, kind }))
    ).then((results) => {
      if (stale) return;
      const byKind = {} as Record<PraxisKind, KindListing>;
      RECORD_KINDS.forEach(({ kind }, i) => {
        const r = results[i];
        byKind[kind] = r.status === "fulfilled" ? { list: r.value } : { error: String(r.reason) };
      });
      setListing({ projectKey: key, byKind });
    });
    return () => {
      stale = true;
    };
  }, [isOpen, projectPath, refreshCount]);

  // Read the open definition each time it, or the builder, is shown. A graph's draft is
  // then kept, reloaded or marked deleted on disk, as `applyDiskRead` decides.
  useEffect(() => {
    if (!isOpen || !projectPath || !openKind || openId === undefined) return;
    let stale = false;
    const key = normalizePath(projectPath);
    const ref = { kind: openKind, id: openId };
    const defKey = definitionKey(ref);
    setRevealError(null);
    invoke<DefinitionFile>("praxis_read", { projectPath, kind: openKind, id: openId }).then(
      (file) => {
        if (stale) return;
        setLoaded({ projectKey: key, defKey, file });
        if (ref.kind === "graphs") {
          changeSessions((s) => updateSession(s, projectPath, (cur) => applyDiskRead(cur, ref, file)));
        }
      },
      (e) => {
        if (!stale) setLoaded({ projectKey: key, defKey, error: String(e) });
      }
    );
    return () => {
      stale = true;
    };
  }, [isOpen, projectPath, openKind, openId, refreshCount, changeSessions]);

  // Focus moves into the builder when it opens and back to where it was when it hides.
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    return () => previous?.focus();
  }, [isOpen]);

  // The conflict prompt takes focus on Cancel, the choice that changes nothing, and gives
  // it back when it closes, to the builder if what had it is gone, so keys such as
  // Ctrl+S keep reaching the builder.
  const hasConflict = conflict !== null;
  useEffect(() => {
    if (!hasConflict) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    conflictRef.current?.querySelector<HTMLElement>("[data-cancel]")?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
      else dialog?.focus();
    };
  }, [hasConflict]);

  /**
   * Saves one draft through `praxis_save`, expecting the file to still have the hash the
   * draft loaded unless `force` is set. The draft records the result: a save makes the
   * written content its new base, and a deleted file marks it.
   */
  const saveDraft = useCallback(async (path: string, ref: DefinitionRef, force: boolean): Promise<SaveOutcome> => {
    const key = definitionKey(ref);
    const current = sessionFor(sessionsRef.current, path);
    const draft = current.drafts[key];
    if (!draft) throw new Error(`${definitionPath(ref)} has nothing to save.`);
    const shown = shownCanvas.current;
    const viewport =
      shown && shown.key === `${normalizePath(path)}|${key}` ? shown.canvas.readViewport() : current.viewports[key];
    const layout = layoutForSave(draft, viewport);
    const outcome = await invoke<SaveOutcome>("praxis_save", {
      projectPath: path,
      kind: ref.kind,
      id: ref.id,
      content: draft.content,
      layout,
      expectedHash: draft.baseHash,
      force,
    });
    changeSessions((s) =>
      updateSession(s, path, (cur) => {
        const d = cur.drafts[key];
        if (!d) return cur;
        const next =
          outcome.status === "saved"
            ? markSaved(
                d,
                { content: outcome.content as JsonObject, contentHash: outcome.contentHash },
                { content: draft.content, layout }
              )
            : outcome.reason === "deleted"
              ? markDeletedOnDisk(d)
              : d;
        return next === d ? cur : { ...cur, drafts: { ...cur.drafts, [key]: next } };
      })
    );
    // Re-list, so the saved file and any badge show.
    if (outcome.status === "saved") setRefreshCount((n) => n + 1);
    return outcome;
  }, [changeSessions]);

  /** Saves one draft from the builder, asking about a conflict instead of overwriting. */
  const saveFromBuilder = useCallback(
    async (path: string, ref: DefinitionRef, force: boolean) => {
      setSaving(true);
      setSaveMessage(null);
      try {
        const outcome = await saveDraft(path, ref, force);
        if (outcome.status === "conflict") {
          setConflict({ projectPath: path, ref, reason: outcome.reason });
          return;
        }
        setConflict(null);
        if (outcome.layoutError) {
          setSaveMessage({ tone: "warning", text: `Saved, but the layout file wasn't written: ${outcome.layoutError}` });
        }
      } catch (e) {
        setSaveMessage({ tone: "error", text: String(e) });
      } finally {
        setSaving(false);
      }
    },
    [saveDraft]
  );

  const saveOpen = useCallback(() => {
    if (!projectPath || !open || !openDraft || saving) return;
    void saveFromBuilder(projectPath, open, false);
  }, [projectPath, open, openDraft, saving, saveFromBuilder]);

  useEffect(() => {
    if (saveRequest === handledSaveRequest.current) return;
    handledSaveRequest.current = saveRequest;
    saveOpen();
  }, [saveRequest, saveOpen]);

  /** Drops the conflicting draft and reads the file again, which makes a fresh one. */
  const reloadConflict = (c: Conflict) => {
    setConflict(null);
    changeSessions((s) => updateSession(s, c.projectPath, (cur) => dropDraft(cur, c.ref)));
    setRefreshCount((n) => n + 1);
  };

  // Closing Quay with unsaved drafts asks first (#221). The listener stays for the
  // builder's lifetime, which is Quay's, since closing the builder only hides it.
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    getCurrentWindow()
      .onCloseRequested((event) => {
        if (dirtyDrafts(sessionsRef.current).length === 0) return;
        event.preventDefault();
        setQuitPrompt({ failures: [], busy: false });
      })
      .then(
        (fn) => {
          if (disposed) fn();
          else unlisten = fn;
        },
        (e) => console.error("[praxis-builder] can't watch for the window closing:", e)
      );
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const saveAllAndQuit = async () => {
    setQuitPrompt({ failures: [], busy: true });
    const failures: string[] = [];
    for (const d of dirtyDrafts(sessionsRef.current)) {
      try {
        const outcome = await saveDraft(d.projectPath, d.draft.ref, false);
        if (outcome.status === "conflict") {
          failures.push(`${draftLabel(d)}: the file was ${outcome.reason} on disk.`);
        }
      } catch (e) {
        failures.push(`${draftLabel(d)}: ${String(e)}`);
      }
    }
    if (failures.length === 0) {
      await getCurrentWindow().destroy();
    } else {
      setQuitPrompt({ failures, busy: false });
    }
  };

  const openDefinition = (ref: DefinitionRef) => {
    if (!project) return;
    setSaveMessage(null);
    changeSessions((s) => updateSession(s, project.path, (cur) => ({ ...cur, name: project.name, open: ref })));
  };

  const selectNodes = useCallback(
    (ids: readonly string[], keepInspector = false) =>
      setSelection((s) => ({ key: viewKey, ids: new Set(ids), chosen: keepInspector ? s.chosen : s.chosen + 1 })),
    [viewKey]
  );

  const saveViewport = useCallback(
    (viewport: Viewport) => {
      if (!projectPath || !openKey) return;
      changeSessions((s) =>
        updateSession(s, projectPath, (cur) => ({ ...cur, viewports: { ...cur.viewports, [openKey]: viewport } }))
      );
    },
    [projectPath, openKey, changeSessions]
  );

  // Every change to the open graph goes through its history, one step per gesture (#248).
  const moveOpenNodes = useCallback(
    (moved: [string, XYPosition][]) => {
      if (!projectPath || !open) return;
      const label = moved.length === 1 ? `Move ${moved[0][0]}` : `Move ${moved.length} nodes`;
      const now = Date.now();
      changeSessions((s) => updateSession(s, projectPath, (cur) => changeGraph(cur, open, (d) => moveNodes(d, moved), { label }, now)));
    },
    [projectPath, open, changeSessions]
  );

  const editOpen = useCallback(
    (edit: GraphEdit) => {
      if (!projectPath || !open) return;
      const now = Date.now();
      changeSessions((s) => updateSession(s, projectPath, (cur) => changeGraph(cur, open, (d) => editDraft(d, edit), stepFor(edit), now)));
    },
    [projectPath, open, changeSessions]
  );

  /** Ends any typing step of the open graph, so the next keystroke starts a new one. */
  const endTyping = useCallback(() => {
    if (!projectPath || !open) return;
    changeSessions((s) => updateSession(s, projectPath, (cur) => endGraphMerge(cur, open)));
  }, [projectPath, open, changeSessions]);

  /** Deletes the selected nodes of the open graph as one step. */
  const deleteSelected = () => {
    if (!projectPath || !open || selected.size === 0) return;
    const ids = [...selected];
    const label = ids.length === 1 ? `Delete ${ids[0]}` : `Delete ${ids.length} nodes`;
    const now = Date.now();
    const remove = (d: GraphDraft) => ids.reduce((acc, id) => editDraft(acc, { type: "delete-node", id }), d);
    changeSessions((s) => updateSession(s, projectPath, (cur) => changeGraph(cur, open, remove, { label }, now)));
    selectNodes([]);
    // The focused card may be gone; focus stays in the canvas, so its keys still work.
    canvasFor(viewKey)?.focus();
  };

  /** Undoes or redoes a step of the open graph, and selects the nodes it changed. */
  const moveInHistory = (direction: "undo" | "redo") => {
    if (!projectPath || !open) return;
    const moved = (direction === "undo" ? undoGraph : redoGraph)(sessionFor(sessionsRef.current, projectPath), open);
    if (!moved) return;
    changeSessions((s) => updateSession(s, projectPath, () => moved.session));
    selectNodes(moved.changed);
    // The step may take away the focused card; focus stays in the builder, so its keys still work.
    requestAnimationFrame(() => {
      if (!dialogRef.current?.contains(document.activeElement)) (canvasFor(viewKey) ?? dialogRef.current)?.focus();
    });
  };

  const recordValidity = useCallback(
    (verdict: string | null) => {
      if (!projectKey || !openKey) return;
      const key = `${projectKey}|${openKey}`;
      const isInvalid = verdict !== null;
      setInvalid((m) => (m.get(key) === isInvalid ? m : new Map(m).set(key, isInvalid)));
    },
    [projectKey, openKey]
  );

  const canvasReady = useCallback(
    (canvas: BuilderCanvas) => {
      shownCanvas.current = { key: viewKey, canvas };
    },
    [viewKey]
  );

  /** Escape (#221): the first of help, a prompt, a dragged connection, a focused field, the selection, then the builder. */
  const escape = (target: EventTarget | null) => {
    if (helpShown) return setHelpShown(false);
    if (conflict) return setConflict(null);
    const canvas = canvasFor(viewKey);
    if (canvas?.cancelConnection()) return;
    if (isTextField(target) && target instanceof HTMLElement) {
      target.blur();
      if (canvas) canvas.focus();
      else dialogRef.current?.focus();
      return;
    }
    if (selected.size > 0) return selectNodes([]);
    onClose();
  };

  const runCommand = (command: BuilderCommand, target: EventTarget | null) => {
    const canvas = canvasFor(viewKey);
    switch (command) {
      case "save":
        // Blur and refocus the field, so a field that applies on blur applies before the save.
        if (isTextField(target) && target instanceof HTMLElement) {
          target.blur();
          target.focus();
        }
        if (!conflict) setSaveRequest((n) => n + 1);
        return;
      case "escape":
        return escape(target);
      case "undo":
      case "redo":
        return moveInHistory(command);
      case "delete":
        return deleteSelected();
      case "select-all":
        return selectNodes(openNodeIds);
      case "fit-view":
        return canvas?.fitView();
      case "zoom-in":
        return canvas?.zoomIn();
      case "zoom-out":
        return canvas?.zoomOut();
      case "zoom-reset":
        return canvas?.zoomReset();
      case "help":
        return setHelpShown(true);
    }
  };

  // The builder's keys, on its root in the bubble phase (#248): Quay's capture-phase keys
  // have been seen already, and a control that handles a key itself, such as a field putting
  // its text back on Escape, prevents its default to keep it. While a prompt or the help is
  // shown only Escape and Mod+S apply, and Tab cycles inside it.
  const handleKey = (e: KeyboardEvent, target: EventTarget | null) => {
    const dialog = dialogRef.current;
    if (e.defaultPrevented || !dialog || !(target instanceof Node) || !dialog.contains(target)) return;
    const overlay = helpShown ? helpRef.current : conflict ? conflictRef.current : null;
    if (e.key === "Tab") {
      trapTab(overlay ?? dialog, e);
      return;
    }
    const region = focusRegion(target, canvasFor(viewKey));
    if (region === "text" && e.key === "Enter") endTyping();
    const command = commandFor(e, region);
    if (!command || (overlay && command !== "escape" && command !== "save")) return;
    e.preventDefault();
    runCommand(command, target);
  };
  const onDialogKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => handleKey(e.nativeEvent, e.target);

  // A key that lands on the page itself, because the element that had focus went away, is
  // the builder's while it is shown: focus comes back to it and the key is handled there.
  // Keys aimed anywhere else, such as a modal open over the builder, are left alone.
  const strayKeyRef = useRef(handleKey);
  strayKeyRef.current = handleKey;
  useEffect(() => {
    if (!isOpen || quitPrompt) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const dialog = dialogRef.current;
      if (!dialog || (e.target !== document.body && e.target !== document.documentElement)) return;
      dialog.focus();
      strayKeyRef.current(e, dialog);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, quitPrompt]);

  // A text field losing focus ends its typing step.
  const onDialogBlur = (e: ReactFocusEvent<HTMLDivElement>) => {
    if (isTextField(e.target)) endTyping();
  };

  const reveal = async (ref: DefinitionRef) => {
    if (!projectPath) return;
    setRevealError(null);
    try {
      await invoke("praxis_reveal", { projectPath, kind: ref.kind, id: ref.id });
    } catch (e) {
      setRevealError(String(e));
    }
  };

  const currentListing = listing && listing.projectKey === projectKey ? listing : null;
  const current = loaded && loaded.projectKey === projectKey && loaded.defKey === openKey ? loaded : null;
  const isEmpty =
    currentListing !== null &&
    RECORD_KINDS.every(({ kind }) => currentListing.byKind[kind].list?.entries.length === 0);
  const openDirty = openDraft ? isDirty(openDraft) : false;
  const undoable = openHistory ? canUndo(openHistory) : false;
  const redoable = openHistory ? canRedo(openHistory) : false;

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- the backdrop only keeps focus in the builder; it does nothing a user acts on
    <div
      className={isOpen ? "fixed inset-0 z-40 flex bg-black/75 backdrop-blur-xs p-3" : "hidden"}
      // A press on the backdrop would drop focus to the page, out of reach of the builder's keys.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) e.preventDefault();
      }}
    >
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- a modal dialog owns its keyboard shortcuts (#248); every control inside it is native */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onDialogKeyDown}
        onBlur={onDialogBlur}
        className="relative flex flex-col w-full h-full bg-[#0d1117] border border-[#30363d] rounded-xl shadow-2xl overflow-hidden text-[#c9d1d9] outline-none"
      >
        <header className="h-12 px-4 bg-[#161b22] border-b border-[#30363d] flex items-center gap-3 shrink-0">
          <div className="w-7 h-7 rounded-lg bg-[#58a6ff]/15 border border-[#58a6ff]/40 flex items-center justify-center shrink-0">
            <Workflow className="w-4 h-4 text-[#58a6ff]" aria-hidden="true" />
          </div>
          <h2 id={titleId} className="text-sm font-bold text-white shrink-0">
            Praxis Builder
          </h2>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#21262d] text-[#bc8cff] font-mono border border-[#30363d] shrink-0">
            Ctrl+Shift+B P
          </span>
          {project && (
            <span className="text-xs text-[#8b949e] truncate min-w-0" title={project.path}>
              {project.name}
              {open && (
                <span className="font-mono text-[#c9d1d9]">
                  {" "}
                  · {definitionPath(open)}
                  {openDirty && (
                    <span className="text-[#e3b341]">
                      <span aria-hidden="true"> *</span>
                      <span className="sr-only"> (unsaved changes)</span>
                    </span>
                  )}
                </span>
              )}
            </span>
          )}
          <div className="ml-auto flex items-center gap-1.5 shrink-0">
            {project && (
              <>
                {openDraft && (
                  <>
                    <button
                      type="button"
                      onClick={() => moveInHistory("undo")}
                      // Not `disabled`, which would drop focus; with nothing to undo it does nothing.
                      aria-disabled={!undoable}
                      aria-label="Undo"
                      aria-keyshortcuts={ariaKeyShortcuts("undo")}
                      title={`Undo (${shortcutLabel("undo")})`}
                      className="p-1.5 text-[#8b949e] hover:text-white hover:bg-[#21262d] rounded-md aria-disabled:opacity-40 aria-disabled:hover:bg-transparent"
                    >
                      <Undo2 className="w-4 h-4" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveInHistory("redo")}
                      aria-disabled={!redoable}
                      aria-label="Redo"
                      aria-keyshortcuts={ariaKeyShortcuts("redo")}
                      title={`Redo (${shortcutLabel("redo")})`}
                      className="p-1.5 text-[#8b949e] hover:text-white hover:bg-[#21262d] rounded-md aria-disabled:opacity-40 aria-disabled:hover:bg-transparent"
                    >
                      <Redo2 className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </>
                )}
                {openDraft && (
                  <button
                    type="button"
                    onClick={saveOpen}
                    // Not `disabled`: that would blur the focused button and send keys to
                    // the app behind the builder. `saveOpen` ignores presses while saving.
                    aria-disabled={saving}
                    aria-keyshortcuts={ariaKeyShortcuts("save")}
                    title={`Save (${shortcutLabel("save")})`}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#238636] hover:bg-[#2ea043] aria-disabled:opacity-50 text-white text-xs font-semibold"
                  >
                    <Save className="w-3.5 h-3.5" aria-hidden="true" />
                    {saving ? "Saving…" : "Save"}
                  </button>
                )}
                <button
                  type="button"
                  aria-expanded={listShown}
                  aria-controls={listId}
                  aria-label={listShown ? "Hide the definitions list" : "Show the definitions list"}
                  title={listShown ? "Hide the definitions list" : "Show the definitions list"}
                  onClick={() => setListShown((v) => !v)}
                  className="p-1.5 text-[#8b949e] hover:text-white hover:bg-[#21262d] rounded-md"
                >
                  {listShown ? (
                    <PanelLeftClose className="w-4 h-4" aria-hidden="true" />
                  ) : (
                    <PanelLeftOpen className="w-4 h-4" aria-hidden="true" />
                  )}
                </button>
                <button
                  type="button"
                  aria-label="Keyboard shortcuts"
                  title={`Keyboard shortcuts (${shortcutLabel("help")} in the canvas)`}
                  onClick={() => setHelpShown(true)}
                  className="p-1.5 text-[#8b949e] hover:text-white hover:bg-[#21262d] rounded-md"
                >
                  <Keyboard className="w-4 h-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label="Reload from disk"
                  title="Reload from disk"
                  onClick={() => setRefreshCount((n) => n + 1)}
                  className="p-1.5 text-[#8b949e] hover:text-white hover:bg-[#21262d] rounded-md"
                >
                  <RefreshCw className="w-4 h-4" aria-hidden="true" />
                </button>
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Praxis Builder"
              className="p-1.5 text-[#8b949e] hover:text-white hover:bg-[#21262d] rounded-md"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </header>

        {saveMessage && (
          <p
            role={saveMessage.tone === "error" ? "alert" : "status"}
            className={`shrink-0 px-4 py-1.5 text-[11px] break-words border-b border-[#30363d] bg-[#161b22] ${
              saveMessage.tone === "error" ? "text-[#ff7b72]" : "text-[#e3b341]"
            }`}
          >
            {saveMessage.text}
          </p>
        )}

        {!project ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-6">
            <p className="text-sm text-[#c9d1d9]">Open a project to author Praxis definitions</p>
            <button
              type="button"
              onClick={onAddProject}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#238636] hover:bg-[#2ea043] text-white text-xs font-semibold"
            >
              <FolderPlus className="w-3.5 h-3.5" aria-hidden="true" />
              Add project
            </button>
          </div>
        ) : (
          <div className="flex-1 flex min-h-0">
            <nav
              id={listId}
              aria-label="Definitions"
              hidden={!listShown}
              className="w-56 shrink-0 border-r border-[#30363d] overflow-y-auto py-2"
            >
              {!currentListing && <p className="px-3 py-1 text-xs text-[#6e7681]">Loading…</p>}
              {currentListing &&
                RECORD_KINDS.map(({ kind, label, icon: Icon }) => {
                  const entry = currentListing.byKind[kind];
                  const listed = new Set(entry.list?.entries.map((e) => e.id));
                  // Drafts whose file is gone stay in the list, so their changes can be saved.
                  const orphans = Object.values(session?.drafts ?? {}).filter(
                    (d) => d.ref.kind === kind && !listed.has(d.ref.id)
                  );
                  const rows = [
                    ...(entry.list?.entries ?? []).map((def) => ({ id: def.id, problem: def.problem })),
                    ...orphans.map((d) => ({ id: d.ref.id, problem: undefined })),
                  ];
                  return (
                    <section key={kind} aria-label={label} className="mb-3">
                      <h3 className="px-3 py-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#6e7681]">
                        <Icon className="w-3 h-3" aria-hidden="true" /> {label}
                      </h3>
                      {entry.error !== undefined && (
                        <p role="alert" className="mx-3 text-[11px] text-[#ff7b72] break-words">
                          {entry.error}
                        </p>
                      )}
                      {rows.length > 0 && (
                        <ul>
                          {rows.map((def) => {
                            const ref = { kind, id: def.id };
                            const key = definitionKey(ref);
                            const isOpenDef = openKey === key;
                            const draft = session?.drafts[key];
                            return (
                              <li key={def.id}>
                                <ListRow
                                  id={def.id}
                                  problem={def.problem}
                                  invalid={invalid.get(`${projectKey}|${key}`) === true}
                                  draft={draft}
                                  current={isOpenDef}
                                  onOpen={() => openDefinition(ref)}
                                />
                              </li>
                            );
                          })}
                        </ul>
                      )}
                      {entry.list?.truncated && (
                        <p className="mx-3 mt-1 text-[10px] text-[#e3b341]">
                          Showing the first {entry.list.entries.length}. The folder holds more.
                        </p>
                      )}
                    </section>
                  );
                })}
            </nav>

            <main className="flex-1 min-w-0 relative flex flex-col">
              {!open ? (
                <div className="flex-1 flex items-center justify-center p-6 text-center text-sm text-[#8b949e]">
                  {isEmpty ? (
                    <p>
                      This project has no Praxis definitions yet. They live in{" "}
                      <span className="font-mono text-[#c9d1d9]">.praxis/</span> at the repository root.
                    </p>
                  ) : (
                    <p>Choose a definition from the list.</p>
                  )}
                </div>
              ) : openDraft ? (
                <GraphDraftView
                  // Remount per definition, so the canvas fits or restores its viewport.
                  key={`${projectKey}|${openKey}`}
                  draft={openDraft}
                  layoutProblem={current?.file?.layoutProblem}
                  viewport={session?.viewports[openKey]}
                  onViewportChange={saveViewport}
                  onMoveNodes={moveOpenNodes}
                  onEdit={editOpen}
                  selected={selected}
                  selectionKey={selection.chosen}
                  onSelect={selectNodes}
                  onReady={canvasReady}
                  onValidated={recordValidity}
                  problemsShown={problemsShown}
                  onToggleProblems={toggleProblems}
                />
              ) : !current ? (
                <p className="p-6 text-sm text-[#6e7681]">Loading {definitionPath(open)}…</p>
              ) : current.error !== undefined ? (
                <p role="alert" className="p-6 text-sm text-[#ff7b72] break-words">
                  {current.error}
                </p>
              ) : current.file?.missing ? (
                <p role="status" className="p-6 text-sm text-[#8b949e]">
                  {definitionPath(open)} doesn't exist on disk.
                </p>
              ) : current.file?.problem ? (
                <ProblemView
                  title={`${definitionPath(open)} can't be opened`}
                  problem={current.file.problem}
                  onReveal={() => void reveal(open)}
                  revealError={revealError}
                />
              ) : (
                <DefinitionView
                  open={open}
                  file={current.file!}
                  onReveal={() => void reveal(open)}
                  revealError={revealError}
                  problemsShown={problemsShown}
                  onToggleProblems={toggleProblems}
                />
              )}
            </main>
          </div>
        )}

        {helpShown && <ShortcutsHelp rootRef={helpRef} onClose={() => setHelpShown(false)} />}

        {conflict && (
          <ConflictPrompt
            rootRef={conflictRef}
            conflict={conflict}
            busy={saving}
            onOverwrite={() => void saveFromBuilder(conflict.projectPath, conflict.ref, true)}
            onReload={() => reloadConflict(conflict)}
            onCancel={() => setConflict(null)}
          />
        )}
      </div>
      {/* Portalled, so it shows while the builder itself is hidden. */}
      {quitPrompt &&
        createPortal(
          <QuitPrompt
            drafts={dirtyDrafts(sessions)}
            failures={quitPrompt.failures}
            busy={quitPrompt.busy}
            onSaveAll={() => void saveAllAndQuit()}
            onDiscard={() => void getCurrentWindow().destroy()}
            onCancel={() => setQuitPrompt(null)}
          />,
          document.body
        )}
    </div>
  );
};

const draftLabel = (d: DirtyDraft) =>
  `${d.projectName || d.projectPath} · ${definitionPath(d.draft.ref)}`;

const ListRow: FC<{
  id: string;
  problem: FileProblem | undefined;
  /** The definition was validated and the SDK refuses it. */
  invalid: boolean;
  draft: GraphDraft | undefined;
  current: boolean;
  onOpen: () => void;
}> = ({ id, problem, invalid, draft, current, onOpen }) => {
  const dirty = draft ? isDirty(draft) : false;
  const deleted = draft?.deletedOnDisk ?? false;
  const notes = [
    problem && problem.message,
    !problem && invalid && "invalid, see Problems",
    deleted && "deleted on disk",
    dirty && "unsaved changes",
  ].filter(Boolean);
  return (
    <button
      type="button"
      aria-current={current ? "page" : undefined}
      onClick={onOpen}
      title={notes.length > 0 ? `${id}: ${notes.join("; ")}` : id}
      className={`w-[calc(100%-0.75rem)] mx-1.5 px-2 py-1 rounded-md flex items-center gap-1.5 text-left text-xs font-mono ${
        current ? "bg-[#1f6feb]/25 text-white" : "text-[#c9d1d9] hover:bg-[#21262d]"
      }`}
    >
      <span className={`truncate ${deleted ? "line-through text-[#8b949e]" : ""}`}>{id}</span>
      {dirty && (
        <span className="text-[#e3b341] shrink-0">
          <span aria-hidden="true">*</span>
          <span className="sr-only">(unsaved changes)</span>
        </span>
      )}
      {deleted && <span className="sr-only">(deleted on disk)</span>}
      {(problem || invalid) && (
        <span className="ml-auto inline-flex items-center text-[#ff7b72] shrink-0">
          <CircleAlert className="w-3.5 h-3.5" aria-hidden="true" />
          <span className="sr-only">{problem ? "(can't be opened)" : "(invalid)"}</span>
        </span>
      )}
    </button>
  );
};

const ProblemView: FC<{
  title: string;
  problem: FileProblem;
  onReveal: () => void;
  revealError: string | null;
}> = ({ title, problem, onReveal, revealError }) => (
  <div className="p-6 max-w-2xl space-y-3">
    <h3 className="flex items-center gap-2 text-sm font-semibold text-[#ff7b72]">
      <CircleAlert className="w-4 h-4" aria-hidden="true" />
      {title}
    </h3>
    <p className="text-sm text-[#c9d1d9] break-words">{problem.message}</p>
    {problem.line !== undefined && (
      <p className="text-xs font-mono text-[#8b949e]">
        Line {problem.line}, column {problem.column ?? "?"}
      </p>
    )}
    <button
      type="button"
      onClick={onReveal}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-xs font-semibold"
    >
      <FolderOpen className="w-3.5 h-3.5" aria-hidden="true" />
      Reveal in folder
    </button>
    {revealError && (
      <p role="alert" className="text-xs text-[#ff7b72] break-words">
        {revealError}
      </p>
    )}
  </div>
);

/** A definition without a draft: a graph the canvas can't draw, or another kind's preview. */
const DefinitionView: FC<{
  open: DefinitionRef;
  file: DefinitionFile;
  onReveal: () => void;
  revealError: string | null;
  problemsShown: boolean;
  onToggleProblems: () => void;
}> = ({ open, file, onReveal, revealError, problemsShown, onToggleProblems }) => {
  const graph = useMemo(() => (open.kind === "graphs" ? parseGraph(file.content) : null), [open.kind, file.content]);
  if (!graph) {
    return (
      <div className="flex-1 overflow-auto">
        <p className="px-4 pt-3 text-[11px] text-[#6e7681]">Read-only preview</p>
        <pre className="px-4 py-2 text-xs leading-snug font-mono text-[#c9d1d9] select-text">
          {JSON.stringify(file.content, null, 2)}
        </pre>
      </div>
    );
  }
  if (!graph.ok) {
    return (
      <>
        <div className="flex-1 min-h-0 overflow-auto">
          <ProblemView
            title={`${definitionPath(open)} can't be shown as a graph`}
            problem={{ message: graph.message }}
            onReveal={onReveal}
            revealError={revealError}
          />
        </div>
        <UndrawnGraphProblems content={file.content} problemsShown={problemsShown} onToggleProblems={onToggleProblems} />
      </>
    );
  }
  return <p className="p-6 text-sm text-[#6e7681]">Loading {definitionPath(open)}…</p>;
};

const GraphDraftView: FC<{
  draft: GraphDraft;
  layoutProblem: FileProblem | undefined;
  viewport: Viewport | undefined;
  onViewportChange: (viewport: Viewport) => void;
  onMoveNodes: (moved: [string, XYPosition][]) => void;
  onEdit: (edit: GraphEdit) => void;
  selected: ReadonlySet<string>;
  selectionKey: number;
  onSelect: (ids: readonly string[], keepInspector?: boolean) => void;
  onReady: (canvas: BuilderCanvas) => void;
  onValidated: (verdict: string | null) => void;
  problemsShown: boolean;
  onToggleProblems: () => void;
}> = ({
  draft,
  layoutProblem,
  viewport,
  onViewportChange,
  onMoveNodes,
  onEdit,
  selected,
  selectionKey,
  onSelect,
  onReady,
  onValidated,
  problemsShown,
  onToggleProblems,
}) => {
  // Drafts are made only from graphs the canvas can draw, and no edit makes one it can't,
  // so this always parses.
  const graph = useMemo(() => parseGraph(draft.content), [draft.content]);
  if (!graph.ok) return null;
  const path = definitionPath(draft.ref);
  return (
    <>
      {draft.deletedOnDisk && (
        <p role="status" className="shrink-0 px-4 py-1.5 flex items-center gap-1.5 text-[11px] text-[#ff7b72] border-b border-[#30363d] bg-[#161b22]">
          <TriangleAlert className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span className="break-words">{path} was deleted on disk. Saving writes this draft back.</span>
        </p>
      )}
      {layoutProblem && (
        <p role="status" className="shrink-0 px-4 py-1.5 flex items-center gap-1.5 text-[11px] text-[#e3b341] border-b border-[#30363d] bg-[#161b22]">
          <TriangleAlert className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span className="break-words">
            .praxis/layout/{draft.ref.id}.json was ignored, so the graph is laid out automatically: {layoutProblem.message}
          </span>
        </p>
      )}
      <GraphView
        graph={graph.value}
        content={draft.content}
        positions={draft.positions}
        viewport={viewport}
        onViewportChange={onViewportChange}
        onMoveNodes={onMoveNodes}
        onEdit={onEdit}
        selected={selected}
        selectionKey={selectionKey}
        onSelect={onSelect}
        onReady={onReady}
        onValidated={onValidated}
        problemsShown={problemsShown}
        onToggleProblems={onToggleProblems}
      />
    </>
  );
};

const promptButton =
  "px-3 py-1.5 rounded-md text-xs font-semibold border border-[#30363d] disabled:opacity-50";

/** Asks what to do when a save finds the file changed or deleted under its draft. */
const ConflictPrompt: FC<{
  rootRef: Ref<HTMLDivElement>;
  conflict: Conflict;
  busy: boolean;
  onOverwrite: () => void;
  onReload: () => void;
  onCancel: () => void;
}> = ({ rootRef, conflict, busy, onOverwrite, onReload, onCancel }) => {
  const titleId = useId();
  const path = definitionPath(conflict.ref);
  const changed = conflict.reason === "changed";
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/60 p-6">
      <div
        ref={rootRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-w-md w-full rounded-lg border border-[#30363d] bg-[#161b22] p-4 space-y-3 shadow-2xl"
      >
        <h3 id={titleId} className="text-sm font-semibold text-white break-words">
          {changed ? `${path} changed on disk` : `${path} was deleted on disk`}
        </h3>
        <p className="text-xs text-[#c9d1d9]">
          {changed
            ? "The file changed after the builder loaded it. Overwrite replaces it with this draft. Reload drops this draft's changes and loads the file."
            : "The file was deleted after the builder loaded it. Save anyway writes this draft back to it."}
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onOverwrite}
            className={`${promptButton} bg-[#da3633] hover:bg-[#f85149] text-white`}
          >
            {changed ? "Overwrite" : "Save anyway"}
          </button>
          {changed && (
            <button type="button" disabled={busy} onClick={onReload} className={`${promptButton} bg-[#21262d] hover:bg-[#30363d]`}>
              Reload
            </button>
          )}
          <button
            type="button"
            data-cancel
            onClick={onCancel}
            className={`${promptButton} bg-[#21262d] hover:bg-[#30363d]`}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

/** Lists the unsaved drafts when Quay is closing, with Save all / Discard / Cancel (#221). */
const QuitPrompt: FC<{
  drafts: DirtyDraft[];
  failures: string[];
  busy: boolean;
  onSaveAll: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}> = ({ drafts, failures, busy, onSaveAll, onDiscard, onCancel }) => {
  const titleId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    rootRef.current?.querySelector<HTMLElement>("[data-cancel]")?.focus();
    return () => previous?.focus();
  }, []);
  // Escape cancels, and Tab stays inside the prompt, wherever focus is.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const root = rootRef.current;
      if (e.defaultPrevented || !root) return;
      if (e.key === "Escape") {
        e.preventDefault();
        if (!busy) onCancel();
      } else if (e.key === "Tab") {
        trapTab(root, e);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onCancel]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-6">
      <div
        ref={rootRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-w-lg w-full rounded-lg border border-[#30363d] bg-[#161b22] p-4 space-y-3 shadow-2xl text-[#c9d1d9]"
      >
        <h2 id={titleId} className="text-sm font-semibold text-white">
          Save changes to these Praxis definitions before quitting?
        </h2>
        <ul className="max-h-48 overflow-y-auto text-xs font-mono space-y-0.5">
          {drafts.map((d) => (
            <li key={`${d.projectPath}|${definitionKey(d.draft.ref)}`} className="break-words">
              {draftLabel(d)}
            </li>
          ))}
        </ul>
        {failures.length > 0 && (
          <div role="alert" className="text-xs text-[#ff7b72] space-y-0.5">
            <p>These weren't saved, so Quay is still open:</p>
            <ul className="list-disc pl-4">
              {failures.map((f) => (
                <li key={f} className="break-words">
                  {f}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onSaveAll}
            className={`${promptButton} bg-[#238636] hover:bg-[#2ea043] text-white`}
          >
            {busy ? "Saving…" : "Save all"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onDiscard}
            className={`${promptButton} bg-[#21262d] hover:bg-[#30363d]`}
          >
            Discard
          </button>
          <button
            type="button"
            data-cancel
            disabled={busy}
            onClick={onCancel}
            className={`${promptButton} bg-[#21262d] hover:bg-[#30363d]`}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
