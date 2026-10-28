// The Praxis Builder (#221): a modal of its own that lists the active project's `.praxis/`
// definitions and shows a graph on the canvas, with its validation problems, where it can
// be edited, undone and saved. The list creates, renames and deletes definitions (#222).
// Closing only hides it, so each project's session, drafts and undo histories included,
// survives until Quay quits. Quitting with unsaved drafts asks first.
// The canvas works from the keyboard alone (#264): Tab reaches the nodes, then the edges, and
// a polite live region announces undo, redo, paste, delete and save.
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
  type ReactNode,
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
  GitCompareArrows,
  PanelLeftClose,
  Keyboard,
  PanelLeftOpen,
  Pencil,
  Plus,
  Redo2,
  RefreshCw,
  Save,
  Trash2,
  TriangleAlert,
  Undo2,
  Workflow,
  X,
} from "lucide-react";
import { normalizePath } from "../../utils/paths.ts";
import { MAX_NODES, parseGraph, type JsonObject, type XYPosition } from "./model.ts";
import { RECORD_KINDS, type RecordKindEntry } from "./kinds.ts";
import { definitionIdProblem, nextDefinitionId } from "./lifecycle.ts";
import { GraphView, UndrawnGraphProblems, type BuilderCanvas } from "./GraphView.tsx";
import { GoToNode, type GoToEntry } from "./GoToNode.tsx";
import { ArrangeMenuButton } from "./ArrangeMenu.tsx";
import { arrangedPositions, arrangeLabel, type ArrangeAction } from "./arrange.ts";
import { NODE_HEIGHT, NODE_WIDTH } from "./flow/layout.ts";
import { ContractForm, type TriggersStatus } from "./ContractForm.tsx";
import { contractStepFor, type ContractEdit } from "./contract.ts";
import { GrantForm } from "./GrantForm.tsx";
import { grantStepFor, type GrantEdit } from "./grant.ts";
import { TemplateForm } from "./TemplateForm.tsx";
import { templateStepFor, type TemplateEdit } from "./template.ts";
import { TriggerForm } from "./TriggerForm.tsx";
import { CrossRecordSection, RunContextPanel, RunsUnder } from "./RunContextPanel.tsx";
import { graphRunContext, issuesOn, recordsWithErrors, type GraphRunContext } from "./runContext.ts";
import { useRunContexts } from "./useRunContexts.ts";
import { triggerStepFor, type TriggerEdit } from "./trigger.ts";
import {
  createNewDraft,
  editContractDraft,
  editGrantDraft,
  editTemplateDraft,
  editTriggerDraft,
  hasDrafts,
  isDirty,
  layoutForSave,
  markDeletedOnDisk,
  markSaved,
  moveNodes,
  type Draft,
} from "./drafts.ts";
import { editDraft, nodeIdsOf, nodesOf, stepFor, type GraphEdit } from "./editor.ts";
import { copySelection, duplicateSelection, getClipboard, pasteDelta, pasteIntoDraft, setClipboard } from "./clipboard.ts";
import { canRedo, canUndo } from "./history.ts";
import { ariaKeyShortcuts, commandFor, focusRegion, shortcutLabel, type BuilderCommand } from "./keymap.ts";
import { focusedElement, nudgeOffset, nudgeStep, tabTarget } from "./keyboard.ts";
import { ShortcutsHelp } from "./ShortcutsHelp.tsx";
import { DiffView } from "./DiffView.tsx";
import { deletedSinceCommit } from "./changes.ts";
import { isTextField } from "../workspace/ctrlBPrefix.ts";
import {
  addNewDraft,
  applyDiskRead,
  applyRename,
  bindingsPath,
  changeDraft,
  definitionKey,
  definitionPath,
  dirtyDrafts,
  dirtyProjectKeys,
  dropDraft,
  endDraftMerge,
  forgetHistories,
  redoDraft,
  removeDefinition,
  renameUnsavedDraft,
  sessionFor,
  undoDraft,
  updateSession,
  type DirtyDraft,
  type Sessions,
} from "./session.ts";
import type {
  BindingsInput,
  ChangedFiles,
  ChangeStatus,
  ContractTriggers,
  DefinitionEntry,
  DefinitionFile,
  DefinitionList,
  DefinitionRef,
  DeleteOutcome,
  DraftContent,
  FileProblem,
  PraxisKind,
  RenameOutcome,
  SaveOutcome,
} from "./types.ts";

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

/** A graph waiting to be added to a contract's Graphs once the contract's draft is read. */
interface QueuedBinding {
  projectKey: string;
  contractId: string;
  graphId: string;
}

/** A save that found the file changed or deleted under its draft, waiting for the user. */
interface Conflict {
  projectPath: string;
  ref: DefinitionRef;
  reason: "changed" | "deleted";
}

/** The inline name field in the list: naming a new definition, or renaming one. */
type Naming = { mode: "new"; kind: PraxisKind; value: string } | { mode: "rename"; ref: DefinitionRef; value: string };

/** A rename or delete the backend has planned, waiting for the user to confirm it. */
type Pending =
  | { type: "rename"; projectPath: string; ref: DefinitionRef; newId: string; plan: RenameOutcome }
  | { type: "delete"; projectPath: string; ref: DefinitionRef; plan: DeleteOutcome | null };

const IS_WINDOWS = typeof navigator !== "undefined" && /Windows/.test(navigator.userAgent);
const TRASH_NAME = IS_WINDOWS ? "the Recycle Bin" : "the Trash";

/** How the live region tells of a step that added or removed nodes. */
const PAST: Record<"Paste" | "Duplicate" | "Delete" | "Cut", string> = {
  Paste: "Pasted",
  Duplicate: "Duplicated",
  Delete: "Deleted",
  Cut: "Cut",
};

const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex="0"]';

/** The tab stops inside `root` that are shown, in document order. */
const tabStops = (root: HTMLElement) =>
  Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);

/** Keeps Tab and Shift+Tab cycling inside `root`. Returns true when it moved focus. */
function trapTab(root: HTMLElement, e: { shiftKey: boolean; preventDefault: () => void }): boolean {
  const focusable = tabStops(root);
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
  const goToRef = useRef<HTMLDivElement | null>(null);
  const [sessions, setSessions] = useState<Sessions>(new Map());
  const [listing, setListing] = useState<Listing | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [contractTriggers, setContractTriggers] = useState<{ key: string; status: TriggersStatus } | null>(null);
  const [listShown, setListShown] = useState(true);
  const [runContextShown, setRunContextShown] = useState(true);
  const toggleRunContext = useCallback(() => setRunContextShown((v) => !v), []);
  const [queuedBinding, setQueuedBinding] = useState<QueuedBinding | null>(null);
  const [problemsShown, setProblemsShown] = useState(true);
  const toggleProblems = useCallback(() => setProblemsShown((v) => !v), []);
  // Whether each graph validated so far is invalid, keyed by project and definition, for
  // the list's error badge.
  const [invalid, setInvalid] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [revealError, setRevealError] = useState<string | null>(null);
  const [refreshCount, setRefreshCount] = useState(0);
  const [saving, setSaving] = useState(false);
  // A line under the header: a save's error or warning, or what a rename or delete did.
  const [notice, setNotice] = useState<{ tone: "error" | "warning" | "info"; text: string } | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [quitPrompt, setQuitPrompt] = useState<{ failures: string[]; busy: boolean } | null>(null);
  const [helpShown, setHelpShown] = useState(false);
  const [goToShown, setGoToShown] = useState(false);
  // The contracts, grants and templates changed since the last commit (#223, #224), for the list's badge, and
  // the one whose diff is shown.
  const [changes, setChanges] = useState<
    { projectKey: string; byKey: ReadonlyMap<string, ChangeStatus> } | { projectKey: string; error: string } | null
  >(null);
  const [diffShown, setDiffShown] = useState<DefinitionRef | null>(null);
  const diffRef = useRef<HTMLDivElement | null>(null);
  // What the live region says. `n` counts announcements, so saying the same thing twice in a
  // row still changes the region's text, and it is read again.
  const [announcement, setAnnouncement] = useState({ text: "", n: 0 });
  const announce = useCallback((text: string) => setAnnouncement((a) => ({ text, n: a.n + 1 })), []);
  const [selection, setSelection] = useState<Selection>({ key: "", ids: NO_IDS, chosen: 0 });
  const [naming, setNaming] = useState<Naming | null>(null);
  const [newMenuShown, setNewMenuShown] = useState(false);
  const newMenuId = useId();
  const [pending, setPending] = useState<Pending | null>(null);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const pendingRef = useRef<HTMLDivElement | null>(null);
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
  // The cross-record checks (#269): a full check when the builder is shown and on a reload, rename
  // or delete; opening or saving a record re-checks the contracts it affects.
  const runChecks = useRunContexts(isOpen, projectPath, openKind, openId);
  const checkContext = runChecks.check;
  const openNodeIds = useMemo(() => (openContent ? nodeIdsOf(openContent) : []), [openContent]);
  // Only nodes the graph still has, since an undo or a rename can take a selected node away.
  const selected = useMemo(() => {
    if (selection.key !== viewKey || selection.ids.size === 0) return NO_IDS;
    return new Set(openNodeIds.filter((id) => selection.ids.has(id)));
  }, [selection, viewKey, openNodeIds]);

  // A name being typed and a prompt waiting belong to the project shown, so they go when
  // another project becomes active.
  useEffect(() => {
    setNaming(null);
    setPending(null);
    setNewMenuShown(false);
    setDiffShown(null);
  }, [projectKey]);

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

  // What has changed since the last commit, read with the list, so a save or an agent's edit
  // shows. A project that isn't a git repository has no changes, and no error.
  useEffect(() => {
    if (!isOpen || !projectPath) return;
    let stale = false;
    const key = normalizePath(projectPath);
    invoke<ChangedFiles>("praxis_changes", { projectPath }).then(
      ({ files }) => {
        if (!stale) setChanges({ projectKey: key, byKey: new Map(files.map((f) => [definitionKey(f), f.status])) });
      },
      (e) => {
        if (!stale) setChanges({ projectKey: key, error: String(e) });
      }
    );
    return () => {
      stale = true;
    };
  }, [isOpen, projectPath, refreshCount]);

  // Read the open definition each time it, or the builder, is shown. A graph's or a
  // contract's draft is then kept, reloaded or marked deleted on disk, as `applyDiskRead`
  // decides.
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
        if (hasDrafts(ref.kind)) {
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

  // The triggers that name the open contract, read with it, so a trigger saved meanwhile shows.
  useEffect(() => {
    if (!isOpen || !projectPath || openKind !== "contracts" || openId === undefined) return;
    let stale = false;
    const key = `${normalizePath(projectPath)}|contracts/${openId}`;
    setContractTriggers({ key, status: { state: "loading" } });
    invoke<ContractTriggers>("praxis_contract_triggers", { projectPath, contractId: openId }).then(
      (found) => {
        if (!stale) setContractTriggers({ key, status: { state: "done", found } });
      },
      (e) => {
        if (!stale) setContractTriggers({ key, status: { state: "failed", error: String(e) } });
      }
    );
    return () => {
      stale = true;
    };
  }, [isOpen, projectPath, openKind, openId, refreshCount]);

  // Focus moves into the builder when it opens and back to where it was when it hides.
  useEffect(() => {
    if (!isOpen) return;
    const previous = focusedElement();
    dialogRef.current?.focus();
    return () => previous?.focus();
  }, [isOpen]);

  // The conflict prompt takes focus on Cancel, the choice that changes nothing, and gives
  // it back when it closes, to the builder if what had it is gone, so keys such as
  // Ctrl+S keep reaching the builder.
  const hasConflict = conflict !== null;
  useEffect(() => {
    if (!hasConflict) return;
    const previous = focusedElement();
    const dialog = dialogRef.current;
    conflictRef.current?.querySelector<HTMLElement>("[data-cancel]")?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
      else dialog?.focus();
    };
  }, [hasConflict]);

  // The rename and delete prompt takes focus the same way.
  const hasPending = pending !== null;
  useEffect(() => {
    if (!hasPending) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    pendingRef.current?.querySelector<HTMLElement>("[data-cancel]")?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
      else dialog?.focus();
    };
  }, [hasPending]);

  /**
   * Saves one draft through `praxis_save`, with a graph's layout or a contract's bindings,
   * expecting the file (and a contract's bindings file) to still have the hash the draft
   * loaded unless `force` is set. The draft records the result: a save makes the written
   * content its new base, and a deleted file marks it.
   */
  const saveDraft = useCallback(async (path: string, ref: DefinitionRef, force: boolean): Promise<SaveOutcome> => {
    const key = definitionKey(ref);
    const current = sessionFor(sessionsRef.current, path);
    const draft = current.drafts[key];
    if (!draft) throw new Error(`${definitionPath(ref)} has nothing to save.`);
    const shown = shownCanvas.current;
    const viewport =
      shown && shown.key === `${normalizePath(path)}|${key}` ? shown.canvas.readViewport() : current.viewports[key];
    const layout = ref.kind === "graphs" ? layoutForSave(draft, viewport) : null;
    const bindings: BindingsInput | null = draft.bindings;
    const outcome = await invoke<SaveOutcome>("praxis_save", {
      projectPath: path,
      kind: ref.kind,
      id: ref.id,
      content: draft.content,
      layout,
      bindings,
      expectedHash: draft.baseHash,
      expectedBindingsHash: draft.baseBindingsHash,
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
                { content: outcome.content as JsonObject, contentHash: outcome.contentHash, bindingsHash: outcome.bindingsHash },
                { content: draft.content, layout, bindings }
              )
            : outcome.reason === "deleted"
              ? markDeletedOnDisk(d)
              : d;
        return next === d ? cur : { ...cur, drafts: { ...cur.drafts, [key]: next } };
      })
    );
    // Re-list, so the saved file and any badge show, and re-check the contracts it affects.
    if (outcome.status === "saved") {
      setRefreshCount((n) => n + 1);
      checkContext(path, ref);
    }
    return outcome;
  }, [changeSessions, checkContext]);

  /** Saves one draft from the builder, asking about a conflict instead of overwriting. */
  const saveFromBuilder = useCallback(
    async (path: string, ref: DefinitionRef, force: boolean) => {
      setSaving(true);
      setNotice(null);
      try {
        const outcome = await saveDraft(path, ref, force);
        if (outcome.status === "conflict") {
          setConflict({ projectPath: path, ref, reason: outcome.reason });
          return;
        }
        setConflict(null);
        if (outcome.layoutError) {
          // The message is a status of its own, which is read out.
          setNotice({ tone: "warning", text: `Saved, but the layout file wasn't written: ${outcome.layoutError}` });
        } else if (outcome.bindingsError) {
          setNotice({
            tone: "warning",
            text: `Saved the contract, but its bindings file wasn't written, so it stays unsaved: ${outcome.bindingsError}`,
          });
        } else {
          announce(`Saved ${definitionPath(ref)}`);
        }
      } catch (e) {
        setNotice({ tone: "error", text: String(e) });
      } finally {
        setSaving(false);
      }
    },
    [saveDraft, announce]
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
    setNotice(null);
    changeSessions((s) => updateSession(s, project.path, (cur) => ({ ...cur, name: project.name, open: ref })));
  };

  /** Adds a graph to a contract's Graphs in the contract's draft, as one step of its history. */
  const bindGraph = useCallback(
    (path: string, contractId: string, graphId: string) => {
      const ref: DefinitionRef = { kind: "contracts", id: contractId };
      const edit: ContractEdit = { type: "add-binding", list: "graphs", id: graphId };
      const now = Date.now();
      changeSessions((s) =>
        updateSession(s, path, (cur) => changeDraft(cur, ref, (d) => editContractDraft(d, edit), contractStepFor(edit), now))
      );
      setNotice({ tone: "info", text: `Bound graph ${graphId} to contract ${contractId}. Save the contract to keep it.` });
    },
    [changeSessions]
  );

  /**
   * The Run context's shortcut for a graph no contract binds (#223): opens the contract with the
   * graph added to its Graphs, at once when its draft is already read, or once it is.
   */
  const addGraphToContract = (graphId: string, contractId: string) => {
    if (!project) return;
    const ref: DefinitionRef = { kind: "contracts", id: contractId };
    const hasDraft = sessionFor(sessionsRef.current, project.path).drafts[definitionKey(ref)] !== undefined;
    openDefinition(ref);
    if (hasDraft) bindGraph(project.path, contractId, graphId);
    else setQueuedBinding({ projectKey: normalizePath(project.path), contractId, graphId });
  };

  // A queued binding waits for its contract's draft, and is dropped if another definition opens first.
  useEffect(() => {
    if (!queuedBinding || !projectPath) return;
    if (queuedBinding.projectKey !== projectKey || openKind !== "contracts" || openId !== queuedBinding.contractId) {
      setQueuedBinding(null);
    } else if (openDraft) {
      bindGraph(projectPath, queuedBinding.contractId, queuedBinding.graphId);
      setQueuedBinding(null);
    }
  }, [queuedBinding, projectPath, projectKey, openKind, openId, openDraft, bindGraph]);

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
    (moved: [string, XYPosition][], label = moved.length === 1 ? `Move ${moved[0][0]}` : `Move ${moved.length} nodes`) => {
      if (!projectPath || !open) return;
      const now = Date.now();
      changeSessions((s) => updateSession(s, projectPath, (cur) => changeDraft(cur, open, (d) => moveNodes(d, moved), { label }, now)));
    },
    [projectPath, open, changeSessions]
  );

  const editOpen = useCallback(
    (edit: GraphEdit) => {
      if (!projectPath || !open) return;
      const now = Date.now();
      changeSessions((s) => updateSession(s, projectPath, (cur) => changeDraft(cur, open, (d) => editDraft(d, edit), stepFor(edit), now)));
    },
    [projectPath, open, changeSessions]
  );

  // A contract form's changes go through the same history (#223).
  const editOpenContract = useCallback(
    (edit: ContractEdit) => {
      if (!projectPath || !open) return;
      const now = Date.now();
      changeSessions((s) =>
        updateSession(s, projectPath, (cur) => changeDraft(cur, open, (d) => editContractDraft(d, edit), contractStepFor(edit), now))
      );
    },
    [projectPath, open, changeSessions]
  );

  // So do a grant form's (#223).
  const editOpenGrant = useCallback(
    (edit: GrantEdit) => {
      if (!projectPath || !open) return;
      const now = Date.now();
      changeSessions((s) =>
        updateSession(s, projectPath, (cur) => changeDraft(cur, open, (d) => editGrantDraft(d, edit), grantStepFor(edit), now))
      );
    },
    [projectPath, open, changeSessions]
  );

  // And a trigger form's (#223).
  const editOpenTrigger = useCallback(
    (edit: TriggerEdit) => {
      if (!projectPath || !open) return;
      const now = Date.now();
      changeSessions((s) =>
        updateSession(s, projectPath, (cur) => changeDraft(cur, open, (d) => editTriggerDraft(d, edit), triggerStepFor(edit), now))
      );
    },
    [projectPath, open, changeSessions]
  );

  // And a workflow template form's (#224).
  const editOpenTemplate = useCallback(
    (edit: TemplateEdit) => {
      if (!projectPath || !open) return;
      const now = Date.now();
      changeSessions((s) =>
        updateSession(s, projectPath, (cur) => changeDraft(cur, open, (d) => editTemplateDraft(d, edit), templateStepFor(edit), now))
      );
    },
    [projectPath, open, changeSessions]
  );

  /** Ends any typing step of the open draft, so the next keystroke starts a new one. */
  const endTyping = useCallback(() => {
    if (!projectPath || !open) return;
    changeSessions((s) => updateSession(s, projectPath, (cur) => endDraftMerge(cur, open)));
  }, [projectPath, open, changeSessions]);

  /** A step's history label: `verb` and the one node's id, or how many nodes. */
  const stepLabel = (verb: string, ids: readonly string[]) =>
    ids.length === 1 ? `${verb} ${ids[0]}` : `${verb} ${ids.length} nodes`;

  /** Copies the selected nodes of the open graph to the in-memory clipboard. */
  const copySelected = () => {
    if (!openDraft || selected.size === 0) return;
    const envelope = copySelection(nodesOf(openDraft.content), selected, openDraft.positions, viewKey);
    if (envelope) setClipboard(envelope);
  };

  /** Cuts the selected nodes: copies them, then deletes them as one step. */
  const cutSelected = () => {
    copySelected();
    removeSelected("Cut");
  };

  /** Records nodes a paste or duplicate added to the open graph as one step, and selects them. */
  const addFragment = (verb: "Paste" | "Duplicate", result: { draft: Draft; pastedIds: string[] } | null) => {
    if (!projectPath || !open || !result) return;
    const label = stepLabel(verb, result.pastedIds);
    const now = Date.now();
    changeSessions((s) => updateSession(s, projectPath, (cur) => changeDraft(cur, open, () => result.draft, { label }, now)));
    selectNodes(result.pastedIds);
    announce(stepLabel(PAST[verb], result.pastedIds));
  };

  /**
   * Pastes the in-memory clipboard's nodes into the open graph: at `at`, a point on the
   * canvas, when given, or where `pasteDelta` puts them.
   */
  const pasteFromClipboard = (at?: XYPosition) => {
    const envelope = getClipboard();
    if (!openDraft) return;
    if (!envelope) return announce("Nothing to paste");
    const canvas = canvasFor(viewKey);
    const viewport = canvas?.readViewport() ?? session?.viewports[openKey] ?? { x: 0, y: 0, zoom: 1 };
    const box = canvas?.getCanvasRect() ?? { width: 1000, height: 800 };
    const delta = pasteDelta(envelope, openDraft, viewKey, viewport, box, at);
    const pasted = pasteIntoDraft(openDraft, envelope, delta);
    if (!pasted) return announce(`Not pasted: a graph holds at most ${MAX_NODES} nodes`);
    addFragment("Paste", pasted);
  };

  /** Duplicates the selected nodes as one step without touching the clipboard. */
  const duplicateSelected = () => {
    if (!openDraft || selected.size === 0) return;
    addFragment("Duplicate", duplicateSelection(openDraft, selected));
  };

  /** Deletes the selected nodes of the open graph as one step, named `verb` in the history. */
  const removeSelected = (verb: "Delete" | "Cut") => removeNodes([...selected], verb);

  /** Deletes nodes of the open graph as one step, named `verb` in the history. */
  const removeNodes = (ids: readonly string[], verb: "Delete" | "Cut") => {
    if (!projectPath || !open || ids.length === 0) return;
    const label = stepLabel(verb, ids);
    const now = Date.now();
    const remove = (d: Draft) => ids.reduce((acc, id) => editDraft(acc, { type: "delete-node", id }), d);
    changeSessions((s) => updateSession(s, projectPath, (cur) => changeDraft(cur, open, remove, { label }, now)));
    selectNodes([]);
    announce(stepLabel(PAST[verb], ids));
    // The focused card may be gone; focus stays in the canvas, so its keys still work.
    canvasFor(viewKey)?.focus();
  };

  /**
   * Delete (#248): the focused edge is disconnected, and a focused node outside the selection
   * is deleted alone; otherwise the selected nodes go.
   */
  const deleteFocused = (target: EventTarget | null) => {
    const canvas = canvasFor(viewKey);
    const item = canvas?.itemAt(target) ?? null;
    if (item?.type === "edge") {
      editOpen({ type: "disconnect", source: item.source, target: item.target });
      announce(`Disconnected ${item.source} from ${item.target}`);
      canvas?.focus();
      return;
    }
    if (item?.type === "node" && !selected.has(item.id)) return removeNodes([item.id], "Delete");
    removeSelected("Delete");
  };

  /** Moves the selected nodes by an arrow key's step; quick nudges of one selection are one step. */
  const nudgeSelected = (e: KeyboardEvent) => {
    const offset = nudgeOffset(e.key, e.shiftKey);
    if (!offset || !projectPath || !open || !openDraft || selected.size === 0) return;
    const canvas = canvasFor(viewKey);
    const ids = [...selected];
    const moved: [string, XYPosition][] = [];
    for (const id of ids) {
      const at = openDraft.positions.get(id) ?? canvas?.nodePosition(id);
      if (at) moved.push([id, { x: at.x + offset.x, y: at.y + offset.y }]);
    }
    const now = Date.now();
    changeSessions((s) => updateSession(s, projectPath, (cur) => changeDraft(cur, open, (d) => moveNodes(d, moved), nudgeStep(ids), now)));
  };

  /** Runs a layout command on the open graph as one step. Auto-arrange then fits the view. */
  const arrangeOpen = (action: ArrangeAction) => {
    if (!openDraft) return;
    const graph = parseGraph(openDraft.content);
    if (!graph.ok) return;
    const canvas = canvasFor(viewKey);
    const sizeOf = (id: string) => canvas?.nodeSize(id) ?? { width: NODE_WIDTH, height: NODE_HEIGHT };
    const moved = arrangedPositions(action, graph.value, openDraft.positions, selected, sizeOf);
    const changes = moved.some(([id, p]) => {
      const was = openDraft.positions.get(id);
      return !was || was.x !== Math.round(p.x) || was.y !== Math.round(p.y);
    });
    if (!changes) {
      if (action.type === "auto") canvas?.fitView();
      return;
    }
    if (action.type === "auto") canvas?.fitViewWhenMoved();
    moveOpenNodes(moved, arrangeLabel(action));
  };

  /** Undoes or redoes a step of the open graph, and selects the nodes it changed. */
  const moveInHistory = (direction: "undo" | "redo") => {
    if (!projectPath || !open) return;
    const moved = (direction === "undo" ? undoDraft : redoDraft)(sessionFor(sessionsRef.current, projectPath), open);
    if (!moved) return announce(direction === "undo" ? "Nothing to undo" : "Nothing to redo");
    changeSessions((s) => updateSession(s, projectPath, () => moved.session));
    selectNodes(moved.changed);
    announce(`${direction === "undo" ? "Undid" : "Redid"} ${moved.label}`);
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

  /**
   * Escape (#221): the first of help, a diff, Go to node, a prompt, a dragged connection, a
   * focused field, the selection, then the builder.
   */
  const escape = (target: EventTarget | null) => {
    if (helpShown) return setHelpShown(false);
    if (diffShown) return setDiffShown(null);
    if (goToShown) return setGoToShown(false);
    if (conflict) return setConflict(null);
    if (pending) return lifecycleBusy ? undefined : setPending(null);
    if (newMenuShown) return setNewMenuShown(false);
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

  const runCommand = (command: BuilderCommand, e: KeyboardEvent, target: EventTarget | null) => {
    const canvas = canvasFor(viewKey);
    const item = canvas?.itemAt(target) ?? null;
    const focusedNode = item?.type === "node" ? item.id : null;
    switch (command) {
      case "save":
        // Blur and refocus the field, so a field that applies on blur applies before the save.
        if (isTextField(target) && target instanceof HTMLElement) {
          target.blur();
          target.focus();
        }
        if (!conflict && !pending) setSaveRequest((n) => n + 1);
        return;
      case "escape":
        return escape(target);
      case "undo":
      case "redo":
        return moveInHistory(command);
      case "copy":
        return copySelected();
      case "cut":
        return cutSelected();
      case "paste":
        return pasteFromClipboard();
      case "duplicate":
        return duplicateSelected();
      case "delete":
        return deleteFocused(target);
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
      case "auto-arrange":
        return arrangeOpen({ type: "auto" });
      case "help":
        return setHelpShown(true);
      case "go-to-node":
        // Only with the graph drawn: there are no cards to go to otherwise.
        if (canvas) setGoToShown(true);
        return;
      case "nudge":
        return nudgeSelected(e);
      case "select":
        if (focusedNode !== null) selectNodes([focusedNode]);
        return;
      case "add-to-selection":
        if (focusedNode !== null && !selected.has(focusedNode)) selectNodes([...selected, focusedNode]);
        return;
      case "context-menu":
        if (focusedNode !== null) canvas?.openNodeMenu(focusedNode);
        return;
    }
  };

  /** Picks a node in Go to node: it is selected, zoomed to and focused. */
  const goToNode = (nodeId: string) => {
    setGoToShown(false);
    canvasFor(viewKey)?.goToNode(nodeId);
  };

  // The builder's keys, on its root in the bubble phase (#248): Quay's capture-phase keys
  // have been seen already, and a control that handles a key itself, such as a field putting
  // its text back on Escape, prevents its default to keep it. While a prompt or the help is
  // shown only Escape and Mod+S apply, and Tab cycles inside it.
  const handleKey = (e: KeyboardEvent, target: EventTarget | null) => {
    const dialog = dialogRef.current;
    if (e.defaultPrevented || !dialog || !(target instanceof Node) || !dialog.contains(target)) return;
    const overlay = helpShown
      ? helpRef.current
      : diffShown
        ? diffRef.current
        : goToShown
        ? goToRef.current
        : conflict
          ? conflictRef.current
          : pending
            ? pendingRef.current
            : null;
    if (e.key === "Tab") {
      // The edges follow the last node in the tab order (#248), though the canvas puts them
      // first. Only a Tab that may reach or leave an edge reads the tab stops.
      const order = overlay ? null : canvasFor(viewKey)?.tabOrder();
      const current = focusedElement();
      const nearEdges =
        order?.lastNode != null &&
        current !== null &&
        (order.edges.includes(current as SVGElement) ||
          (!e.shiftKey && current === order.lastNode) ||
          (e.shiftKey && (order.lastNode.compareDocumentPosition(current) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0));
      const next =
        nearEdges && order && current
          ? tabTarget<HTMLElement | SVGElement>(tabStops(dialog), order.lastNode, order.edges, current, e.shiftKey)
          : null;
      if (next) {
        e.preventDefault();
        // The canvas pans to what takes focus; scrolling React Flow's wrapper would only fight it.
        next.focus({ preventScroll: true });
        return;
      }
      trapTab(overlay ?? dialog, e);
      return;
    }
    const region = focusRegion(target, canvasFor(viewKey));
    if (region === "text" && e.key === "Enter") endTyping();
    const command = commandFor(e, region);
    if (!command || (overlay && command !== "escape" && command !== "save")) return;
    e.preventDefault();
    runCommand(command, e, target);
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
  const shownChanges = changes && changes.projectKey === projectKey ? changes : null;
  const currentChanges = shownChanges && "byKey" in shownChanges ? shownChanges : null;
  const changesError = shownChanges && "error" in shownChanges ? shownChanges.error : null;
  const current = loaded && loaded.projectKey === projectKey && loaded.defKey === openKey ? loaded : null;
  const isEmpty =
    currentListing !== null &&
    RECORD_KINDS.every(({ kind }) => currentListing.byKind[kind].list?.entries.length === 0);
  const openDirty = openDraft ? isDirty(openDraft) : false;
  const undoable = openHistory ? canUndo(openHistory) : false;
  const redoable = openHistory ? canRedo(openHistory) : false;

  const listedEntries = (kind: PraxisKind): DefinitionEntry[] => currentListing?.byKind[kind].list?.entries ?? [];
  const openEntry = open ? listedEntries(open.kind).find((e) => e.id === open.id) : undefined;
  /** The ids a new or renamed definition of `kind` can't take: the listed ones and the drafts'. */
  const takenIds = (kind: PraxisKind): string[] => [
    ...listedEntries(kind).map((e) => e.id),
    ...Object.values(session?.drafts ?? {})
      .filter((d) => d.ref.kind === kind)
      .map((d) => d.ref.id),
  ];
  const projectContexts = runChecks.forProject(projectKey);
  const contexts = projectContexts.contexts;
  const crossErrors = useMemo(() => recordsWithErrors(contexts), [contexts]);
  const openRun = graphRunContext(contexts, open?.kind === "graphs" ? open.id : "");
  const crossRecord = open && open.kind !== "graphs" && (
    <CrossRecordSection issues={issuesOn(contexts, open)} checked={contexts.checked} error={projectContexts.error} onOpen={openDefinition} />
  );
  const namingProblem =
    naming === null
      ? null
      : naming.mode === "new"
        ? definitionIdProblem(naming.value, takenIds(naming.kind))
        : definitionIdProblem(naming.value, takenIds(naming.ref.kind), naming.ref.id);

  /** "+ New" and the empty project's New graph (#222): an inline name field in the kind's list. */
  const startNew = (entry: RecordKindEntry) => {
    setNewMenuShown(false);
    setListShown(true);
    setNotice(null);
    setNaming({ mode: "new", kind: entry.kind, value: nextDefinitionId(entry.singular, takenIds(entry.kind)) });
  };

  const startRename = (ref: DefinitionRef) => {
    setNotice(null);
    setNaming({ mode: "rename", ref, value: ref.id });
  };

  /**
   * The content of `path`'s unsaved drafts other than `except`, for a rename to rewrite. A
   * clean draft is left out: the rename rewrites its file, and `applyRename` drops the draft
   * so it reads the file again.
   */
  const draftContents = (path: string, except: DefinitionRef): DraftContent[] =>
    Object.values(sessionFor(sessionsRef.current, path).drafts)
      .filter((d) => definitionKey(d.ref) !== definitionKey(except) && isDirty(d))
      .map((d) => ({ kind: d.ref.kind, id: d.ref.id, content: d.content }));

  /** Why `ref` can't be renamed now: its draft has changes a rename would have to carry. */
  const unsavedChangesProblem = (path: string, ref: DefinitionRef) => {
    const draft = sessionFor(sessionsRef.current, path).drafts[definitionKey(ref)];
    return draft && draft.baseHash !== null && isDirty(draft)
      ? `Save or undo the changes to ${definitionPath(ref)} first.`
      : null;
  };

  /**
   * Enter in the name field. A new name makes an unsaved draft, and so does renaming one,
   * since neither has a file. Renaming a saved definition asks the backend for its plan,
   * which the user confirms.
   */
  const submitName = async () => {
    if (!project || !naming || namingProblem || lifecycleBusy) return;
    const path = project.path;
    if (naming.mode === "new") {
      const ref = { kind: naming.kind, id: naming.value };
      const newRecord = RECORD_KINDS.find((k) => k.kind === ref.kind)?.newRecord;
      const created = newRecord ? createNewDraft(ref, newRecord(ref.id)) : null;
      if (!created?.ok) return;
      setNaming(null);
      setNotice(null);
      changeSessions((s) => updateSession(s, path, (cur) => addNewDraft({ ...cur, name: project.name }, ref, created.value)));
      return;
    }
    const { ref, value: newId } = naming;
    if (newId === ref.id) return setNaming(null);
    if (session?.drafts[definitionKey(ref)]?.baseHash === null) {
      setNaming(null);
      changeSessions((s) => updateSession(s, path, (cur) => renameUnsavedDraft(cur, ref, newId)));
      return;
    }
    const problem = unsavedChangesProblem(path, ref);
    if (problem) return setNotice({ tone: "error", text: `${definitionPath(ref)} can't be renamed yet. ${problem}` });
    setLifecycleBusy(true);
    try {
      const plan = await invoke<RenameOutcome>("praxis_rename", {
        projectPath: path,
        kind: ref.kind,
        id: ref.id,
        newId,
        drafts: draftContents(path, ref),
        dryRun: true,
      });
      setNaming(null);
      setPending({ type: "rename", projectPath: path, ref, newId, plan });
    } catch (e) {
      setNotice({ tone: "error", text: String(e) });
    } finally {
      setLifecycleBusy(false);
    }
  };

  /**
   * Asks to delete `ref`. A draft with no file listed, because it was never saved or its
   * file was deleted on disk, has nothing to trash, so its prompt only discards it.
   */
  const startDelete = async (ref: DefinitionRef) => {
    if (!project || lifecycleBusy) return;
    const path = project.path;
    setNotice(null);
    setNaming(null);
    const listed = listedEntries(ref.kind).some((e) => e.id === ref.id);
    if (!listed && session?.drafts[definitionKey(ref)]) {
      setPending({ type: "delete", projectPath: path, ref, plan: null });
      return;
    }
    setLifecycleBusy(true);
    try {
      const plan = await invoke<DeleteOutcome>("praxis_delete", { projectPath: path, kind: ref.kind, id: ref.id, dryRun: true });
      setPending({ type: "delete", projectPath: path, ref, plan });
    } catch (e) {
      setNotice({ tone: "error", text: String(e) });
    } finally {
      setLifecycleBusy(false);
    }
  };

  /** What a rename or delete did, as the notice says it. */
  const report = (verb: string, outcome: { done: string[]; error?: string }) =>
    outcome.error === undefined
      ? { tone: "info" as const, text: `${verb}. ${outcome.done.join(". ")}.` }
      : {
          tone: "error" as const,
          text: `${outcome.error}. ${
            outcome.done.length > 0 ? `Done before it stopped: ${outcome.done.join(". ")}.` : "Nothing was changed."
          }`,
        };

  /** Drops the list's invalid badge for a definition that was renamed or deleted, so its old id starts afresh. */
  const forgetValidity = (p: Pending) => {
    const key = `${normalizePath(p.projectPath)}|${definitionKey(p.ref)}`;
    setInvalid((m) => {
      if (!m.has(key)) return m;
      const next = new Map(m);
      next.delete(key);
      return next;
    });
  };

  /**
   * Runs the confirmed rename or delete. Both sit outside undo: a rename clears the
   * histories it touches, and a delete drops the definition's draft. The session follows
   * only once the backend has written the new file or trashed the old one.
   */
  const runPending = async (p: Pending) => {
    setLifecycleBusy(true);
    try {
      if (p.type === "rename") {
        const problem = unsavedChangesProblem(p.projectPath, p.ref);
        if (problem) throw new Error(`${definitionPath(p.ref)} changed while the rename waited. ${problem}`);
        const outcome = await invoke<RenameOutcome>("praxis_rename", {
          projectPath: p.projectPath,
          kind: p.ref.kind,
          id: p.ref.id,
          newId: p.newId,
          drafts: draftContents(p.projectPath, p.ref),
          dryRun: false,
        });
        if (outcome.done.length > 0) {
          changeSessions((s) => updateSession(s, p.projectPath, (cur) => applyRename(cur, p.ref, p.newId, outcome)));
          forgetValidity(p);
        }
        setNotice(report(`Renamed ${definitionPath(p.ref)} to ${p.newId}`, outcome));
      } else if (p.plan === null) {
        changeSessions((s) => updateSession(s, p.projectPath, (cur) => removeDefinition(cur, p.ref)));
        forgetValidity(p);
        setNotice({ tone: "info", text: `Discarded the draft of ${definitionPath(p.ref)}.` });
      } else {
        const outcome = await invoke<DeleteOutcome>("praxis_delete", {
          projectPath: p.projectPath,
          kind: p.ref.kind,
          id: p.ref.id,
          dryRun: false,
        });
        if (outcome.done.length > 0) {
          changeSessions((s) => updateSession(s, p.projectPath, (cur) => removeDefinition(cur, p.ref)));
          forgetValidity(p);
        }
        setNotice(report(`Deleted ${definitionPath(p.ref)}`, outcome));
      }
    } catch (e) {
      setNotice({ tone: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setPending(null);
      setLifecycleBusy(false);
      setRefreshCount((n) => n + 1);
      runChecks.recheckAll();
    }
  };

  /** The fix for a file whose id isn't its name: write it with its name as the id inside. */
  const fixId = async (ref: DefinitionRef) => {
    if (!project || lifecycleBusy) return;
    const path = project.path;
    const problem = unsavedChangesProblem(path, ref);
    if (problem) return setNotice({ tone: "error", text: problem });
    setLifecycleBusy(true);
    try {
      const outcome = await invoke<RenameOutcome>("praxis_rename", {
        projectPath: path,
        kind: ref.kind,
        id: ref.id,
        newId: ref.id,
        drafts: [],
        dryRun: false,
      });
      // Any draft was clean, so reading the file again makes a fresh one with the new id.
      if (outcome.done.length > 0) changeSessions((s) => updateSession(s, path, (cur) => dropDraft(cur, ref)));
      setNotice(report(`Set the id inside ${definitionPath(ref)} to ${ref.id}`, outcome));
    } catch (e) {
      setNotice({ tone: "error", text: String(e) });
    } finally {
      setLifecycleBusy(false);
      setRefreshCount((n) => n + 1);
      runChecks.recheckAll();
    }
  };

  const creatableKinds = RECORD_KINDS.filter((k) => k.newRecord);
  const graphsEntry = RECORD_KINDS.find((k) => k.kind === "graphs")!;
  // Where a new graph is saved, written the way the project's path is.
  const separator = project?.path.includes("\\") ? "\\" : "/";
  const graphsFolder = project
    ? [project.path.replace(/[\\/]+$/, ""), ".praxis", "graphs", ""].join(separator)
    : "";

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
                {openDraft && open?.kind === "graphs" && <ArrangeMenuButton selectedCount={selected.size} onChoose={arrangeOpen} />}
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
                  onClick={() => {
                    setRefreshCount((n) => n + 1);
                    runChecks.recheckAll();
                  }}
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

        {notice && (
          <p
            role={notice.tone === "error" ? "alert" : "status"}
            className={`shrink-0 px-4 py-1.5 text-[11px] break-words border-b border-[#30363d] bg-[#161b22] ${
              notice.tone === "error" ? "text-[#ff7b72]" : notice.tone === "warning" ? "text-[#e3b341]" : "text-[#8b949e]"
            }`}
          >
            {notice.text}
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
              <div
                className="relative px-1.5 pb-2"
                onBlur={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setNewMenuShown(false);
                }}
              >
                <button
                  type="button"
                  aria-expanded={newMenuShown}
                  aria-controls={newMenuId}
                  onClick={() => setNewMenuShown((v) => !v)}
                  className="w-full inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-xs font-semibold"
                >
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  New
                </button>
                <div
                  id={newMenuId}
                  role="group"
                  aria-label="Kind of definition to create"
                  hidden={!newMenuShown}
                  className="absolute left-1.5 right-1.5 top-full -mt-1 z-10 rounded-md border border-[#30363d] bg-[#161b22] p-1 shadow-xl"
                >
                  {creatableKinds.map((k) => (
                    <button
                      key={k.kind}
                      type="button"
                      onClick={() => startNew(k)}
                      className="w-full flex items-center gap-1.5 px-2 py-1 rounded text-left text-xs hover:bg-[#21262d]"
                    >
                      <k.icon className="w-3.5 h-3.5" aria-hidden="true" />
                      New {k.singular}
                    </button>
                  ))}
                </div>
              </div>
              {!currentListing && <p className="px-3 py-1 text-xs text-[#6e7681]">Loading…</p>}
              {currentListing &&
                RECORD_KINDS.map(({ kind, label, singular, icon: Icon }) => {
                  const entry = currentListing.byKind[kind];
                  const listed = new Set(entry.list?.entries.map((e) => e.id));
                  // Drafts whose file is gone, or that were never saved, stay in the list, so
                  // their changes can be saved.
                  const orphans = Object.values(session?.drafts ?? {}).filter(
                    (d) => d.ref.kind === kind && !listed.has(d.ref.id)
                  );
                  const rows: { id: string; problem?: FileProblem; idMismatch?: DefinitionEntry["idMismatch"] }[] = [
                    ...(entry.list?.entries ?? []),
                    ...orphans.map((d) => ({ id: d.ref.id })),
                  ];
                  // Files deleted since the last commit have no file to list, but keep a row so
                  // their badge still opens the diff.
                  const deleted = currentChanges
                    ? deletedSinceCommit(currentChanges.byKey, kind, new Set(rows.map((r) => r.id)))
                    : [];
                  const namingNew = naming?.mode === "new" && naming.kind === kind;
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
                      {(rows.length > 0 || deleted.length > 0 || namingNew) && (
                        <ul>
                          {namingNew && (
                            <li>
                              <NameField
                                label={`Name of the new ${singular}`}
                                value={naming.value}
                                problem={namingProblem}
                                busy={lifecycleBusy}
                                onChange={(value) => setNaming({ ...naming, value })}
                                onSubmit={() => void submitName()}
                                onCancel={() => setNaming(null)}
                              />
                            </li>
                          )}
                          {rows.map((def) => {
                            const ref = { kind, id: def.id };
                            const key = definitionKey(ref);
                            const isOpenDef = openKey === key;
                            const draft = session?.drafts[key];
                            const changed = currentChanges?.byKey.get(key);
                            if (naming?.mode === "rename" && definitionKey(naming.ref) === key) {
                              return (
                                <li key={def.id}>
                                  <NameField
                                    label={`New id for ${def.id}`}
                                    value={naming.value}
                                    problem={namingProblem}
                                    busy={lifecycleBusy}
                                    onChange={(value) => setNaming({ ...naming, value })}
                                    onSubmit={() => void submitName()}
                                    onCancel={() => setNaming(null)}
                                  />
                                </li>
                              );
                            }
                            return (
                              <li key={def.id} className="group flex items-center pr-1.5">
                                <ListRow
                                  id={def.id}
                                  problem={def.problem}
                                  idMismatch={def.idMismatch}
                                  invalid={invalid.get(`${projectKey}|${key}`) === true}
                                  crossIssues={crossErrors.has(key)}
                                  draft={draft}
                                  current={isOpenDef}
                                  onOpen={() => openDefinition(ref)}
                                />
                                {changed && (
                                  <ChangedBadge id={def.id} status={changed} onClick={() => setDiffShown(ref)} />
                                )}
                                <RowAction label={`Rename ${def.id}`} shown={isOpenDef} onClick={() => startRename(ref)}>
                                  <Pencil className="w-3 h-3" aria-hidden="true" />
                                </RowAction>
                                <RowAction label={`Delete ${def.id}`} shown={isOpenDef} onClick={() => void startDelete(ref)}>
                                  <Trash2 className="w-3 h-3" aria-hidden="true" />
                                </RowAction>
                              </li>
                            );
                          })}
                          {deleted.map((id) => (
                            <li key={`deleted:${id}`} className="group flex items-center pr-1.5">
                              <span className="flex-1 min-w-0 ml-1.5 px-2 py-1 text-xs font-mono text-[#8b949e] line-through truncate">
                                {id}
                              </span>
                              <ChangedBadge id={id} status="deleted" onClick={() => setDiffShown({ kind, id })} />
                            </li>
                          ))}
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
              {changesError !== null && (
                <p role="alert" className="mx-3 text-[11px] text-[#ff7b72] break-words">
                  Changes since the last commit can't be shown: {changesError}
                </p>
              )}
            </nav>

            <main className="flex-1 min-w-0 relative flex flex-col">
              {open && openEntry?.idMismatch && (
                <div
                  role="status"
                  className="shrink-0 px-4 py-1.5 flex items-center gap-2 text-[11px] text-[#e3b341] border-b border-[#30363d] bg-[#161b22]"
                >
                  <TriangleAlert className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span className="break-words min-w-0">
                    {openEntry.idMismatch.found !== undefined
                      ? `The id inside ${definitionPath(open)} is '${openEntry.idMismatch.found}', not its file name.`
                      : `${definitionPath(open)} has no id inside to match its file name.`}
                  </span>
                  <button
                    type="button"
                    onClick={() => void fixId(open)}
                    aria-disabled={lifecycleBusy}
                    className="ml-auto shrink-0 px-2 py-0.5 rounded-md bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-[#c9d1d9] font-semibold aria-disabled:opacity-50"
                  >
                    Set the id to {open.id}
                  </button>
                </div>
              )}
              {!open ? (
                <div className="flex-1 flex items-center justify-center p-6 text-center text-sm text-[#8b949e]">
                  {isEmpty ? (
                    <div className="space-y-3">
                      <p>
                        This project has no Praxis definitions yet. A new graph is saved to{" "}
                        <span className="font-mono text-[#c9d1d9] break-all">{graphsFolder}</span> the first time you
                        save it.
                      </p>
                      <button
                        type="button"
                        onClick={() => startNew(graphsEntry)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#238636] hover:bg-[#2ea043] text-white text-xs font-semibold"
                      >
                        <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                        New graph
                      </button>
                    </div>
                  ) : (
                    <p>Choose a definition from the list.</p>
                  )}
                </div>
              ) : openDraft && open.kind === "contracts" ? (
                <>
                  {openDraft.deletedOnDisk && <DeletedOnDiskNotice path={definitionPath(open)} />}
                  <ContractForm
                    key={`${projectKey}|${openKey}`}
                    draft={openDraft}
                    bindingsProblem={current?.file?.bindingsProblem}
                    known={{ graphs: [...new Set(takenIds("graphs"))], grants: [...new Set(takenIds("grants"))] }}
                    triggers={contractTriggers?.key === viewKey ? contractTriggers.status : { state: "loading" }}
                    crossRecord={crossRecord}
                    onEdit={editOpenContract}
                    onOpen={openDefinition}
                    onValidated={recordValidity}
                  />
                </>
              ) : openDraft && projectPath && open.kind === "grants" ? (
                <>
                  {openDraft.deletedOnDisk && <DeletedOnDiskNotice path={definitionPath(open)} />}
                  <GrantForm
                    key={`${projectKey}|${openKey}`}
                    projectPath={projectPath}
                    draft={openDraft}
                    known={[...new Set(takenIds("grants"))]}
                    saved={listedEntries("grants").map((e) => e.id)}
                    refresh={refreshCount}
                    crossRecord={crossRecord}
                    onEdit={editOpenGrant}
                    onOpen={openDefinition}
                    onValidated={recordValidity}
                  />
                </>
              ) : openDraft && open.kind === "triggers" ? (
                <>
                  {openDraft.deletedOnDisk && <DeletedOnDiskNotice path={definitionPath(open)} />}
                  <TriggerForm
                    key={`${projectKey}|${openKey}`}
                    draft={openDraft}
                    contracts={[...new Set(takenIds("contracts"))]}
                    crossRecord={crossRecord}
                    onEdit={editOpenTrigger}
                    onOpen={openDefinition}
                    onValidated={recordValidity}
                  />
                </>
              ) : openDraft && open.kind === "templates" ? (
                <>
                  {openDraft.deletedOnDisk && <DeletedOnDiskNotice path={definitionPath(open)} />}
                  <TemplateForm key={`${projectKey}|${openKey}`} draft={openDraft} onEdit={editOpenTemplate} onValidated={recordValidity} />
                </>
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
                  onArrange={arrangeOpen}
                  onPaste={pasteFromClipboard}
                  selected={selected}
                  selectionKey={selection.chosen}
                  onSelect={selectNodes}
                  onReady={canvasReady}
                  onValidated={recordValidity}
                  problemsShown={problemsShown}
                  onToggleProblems={toggleProblems}
                  run={openRun}
                  runContext={
                    <RunContextPanel
                      graphId={open.id}
                      run={openRun}
                      checked={contexts.checked}
                      error={projectContexts.error}
                      unchecked={contexts.unchecked}
                      contracts={listedEntries("contracts").map((e) => e.id)}
                      expanded={runContextShown}
                      onToggle={toggleRunContext}
                      onOpen={openDefinition}
                      onAddToContract={(contractId) => addGraphToContract(open.id, contractId)}
                    />
                  }
                  onOpen={openDefinition}
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

        {diffShown && projectPath && (
          <DiffView rootRef={diffRef} projectPath={projectPath} target={diffShown} onClose={() => setDiffShown(null)} />
        )}

        {pending && (
          <PendingPrompt
            rootRef={pendingRef}
            pending={pending}
            busy={lifecycleBusy}
            onConfirm={() => void runPending(pending)}
            onCancel={() => setPending(null)}
          />
        )}

        {goToShown && openContent && canvasFor(viewKey) && (
          <GoToNode rootRef={goToRef} nodes={goToEntries(openContent)} onPick={goToNode} />
        )}

        <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
          {announcement.text}
          {/* A no-break space every other time, so a repeated message is a change. */}
          {announcement.n % 2 === 1 ? "\u00a0" : ""}
        </div>

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

/** The open graph's nodes for Go to node, in file order. */
const goToEntries = (content: JsonObject): GoToEntry[] =>
  nodesOf(content).flatMap((n) => (typeof n.id === "string" ? [{ id: n.id, kind: typeof n.kind === "string" ? n.kind : "" }] : []));

const draftLabel = (d: DirtyDraft) =>
  `${d.projectName || d.projectPath} · ${definitionPath(d.draft.ref)}`;

const ListRow: FC<{
  id: string;
  problem: FileProblem | undefined;
  idMismatch: DefinitionEntry["idMismatch"];
  /** The definition was validated and the SDK refuses it. */
  invalid: boolean;
  /** A contract's scratch mission refuses the saved definition, or a reference in it names nothing (#269). */
  crossIssues: boolean;
  draft: Draft | undefined;
  current: boolean;
  onOpen: () => void;
}> = ({ id, problem, idMismatch, invalid, crossIssues, draft, current, onOpen }) => {
  const dirty = draft ? isDirty(draft) : false;
  const deleted = draft?.deletedOnDisk ?? false;
  const unsaved = draft?.baseHash === null;
  const mismatchNote =
    idMismatch && (idMismatch.found !== undefined ? `the id inside is '${idMismatch.found}'` : "no id inside");
  const notes = [
    problem && problem.message,
    !problem && invalid && "invalid, see Problems",
    mismatchNote,
    crossIssues && "issues across records",
    deleted && "deleted on disk",
    unsaved ? "never saved" : dirty && "unsaved changes",
  ].filter(Boolean);
  return (
    <button
      type="button"
      aria-current={current ? "page" : undefined}
      onClick={onOpen}
      title={notes.length > 0 ? `${id}: ${notes.join("; ")}` : id}
      className={`flex-1 min-w-0 ml-1.5 px-2 py-1 rounded-md flex items-center gap-1.5 text-left text-xs font-mono ${
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
      {problem || invalid ? (
        <span className="ml-auto inline-flex items-center text-[#ff7b72] shrink-0">
          <CircleAlert className="w-3.5 h-3.5" aria-hidden="true" />
          <span className="sr-only">{problem ? "(can't be opened)" : "(invalid)"}</span>
        </span>
      ) : (
        (mismatchNote || crossIssues) && (
          <span className="ml-auto inline-flex items-center text-[#e3b341] shrink-0">
            <TriangleAlert className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="sr-only">
              {[mismatchNote && "(its id doesn't match its file name)", crossIssues && "(issues across records)"].filter(Boolean).join(" ")}
            </span>
          </span>
        )
      )}
    </button>
  );
};

/**
 * The "changed since last commit" badge (#223) on a contract, grant or template whose file differs from
 * the last commit, which opens its diff. It says nothing about approval: a grant file is
 * never approved by being committed or not.
 */
const ChangedBadge: FC<{ id: string; status: ChangeStatus; onClick: () => void }> = ({ id, status, onClick }) => {
  const label = `${id}: ${status === "added" ? "new" : status === "deleted" ? "deleted" : "changed"} since last commit. Show the diff`;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="p-1 shrink-0 rounded text-[#d29922] hover:text-white hover:bg-[#21262d]"
    >
      <GitCompareArrows className="w-3.5 h-3.5" aria-hidden="true" />
    </button>
  );
};

/** A small action beside a list row, shown for the open definition, on hover and on focus. */
const RowAction: FC<{ label: string; shown: boolean; onClick: () => void; children: ReactNode }> = ({
  label,
  shown,
  onClick,
  children,
}) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    onClick={onClick}
    className={`p-1 shrink-0 rounded text-[#8b949e] hover:text-white hover:bg-[#21262d] focus:opacity-100 group-hover:opacity-100 ${
      shown ? "" : "opacity-0"
    }`}
  >
    {children}
  </button>
);

/**
 * The inline field that names a new definition or renames one, checked as the user types
 * (#222). Enter confirms when the name is acceptable, and Escape cancels.
 */
const NameField: FC<{
  label: string;
  value: string;
  problem: string | null;
  busy: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}> = ({ label, value, problem, busy, onChange, onSubmit, onCancel }) => {
  const hintId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  return (
    <div className="mx-1.5 px-1 py-1">
      <input
        ref={inputRef}
        type="text"
        value={value}
        aria-label={label}
        aria-invalid={problem !== null}
        aria-describedby={hintId}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          // Handled here, so the builder's own Enter and Escape don't run too.
          if (e.key === "Enter") {
            e.preventDefault();
            if (!busy && problem === null) onSubmit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        className={`w-full px-1.5 py-0.5 rounded bg-[#0d1117] border text-xs font-mono text-white outline-none ${
          problem ? "border-[#da3633]" : "border-[#1f6feb]"
        }`}
      />
      <p id={hintId} aria-live="polite" className={`mt-0.5 text-[10px] break-words ${problem ? "text-[#ff7b72]" : "text-[#6e7681]"}`}>
        {problem ?? (busy ? "Checking…" : "Enter to confirm, Esc to cancel.")}
      </p>
    </div>
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

const DeletedOnDiskNotice: FC<{ path: string }> = ({ path }) => (
  <p role="status" className="shrink-0 px-4 py-1.5 flex items-center gap-1.5 text-[11px] text-[#ff7b72] border-b border-[#30363d] bg-[#161b22]">
    <TriangleAlert className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
    <span className="break-words">{path} was deleted on disk. Saving writes this draft back.</span>
  </p>
);

const GraphDraftView: FC<{
  draft: Draft;
  layoutProblem: FileProblem | undefined;
  viewport: Viewport | undefined;
  onViewportChange: (viewport: Viewport) => void;
  onMoveNodes: (moved: [string, XYPosition][]) => void;
  onEdit: (edit: GraphEdit) => void;
  onArrange: (action: ArrangeAction) => void;
  onPaste: (at: XYPosition) => void;
  selected: ReadonlySet<string>;
  selectionKey: number;
  onSelect: (ids: readonly string[], keepInspector?: boolean) => void;
  onReady: (canvas: BuilderCanvas) => void;
  onValidated: (verdict: string | null) => void;
  problemsShown: boolean;
  onToggleProblems: () => void;
  run: GraphRunContext;
  runContext: ReactNode;
  onOpen: (ref: DefinitionRef) => void;
}> = ({
  draft,
  layoutProblem,
  viewport,
  onViewportChange,
  onMoveNodes,
  onEdit,
  onArrange,
  onPaste,
  selected,
  selectionKey,
  onSelect,
  onReady,
  onValidated,
  problemsShown,
  onToggleProblems,
  run,
  runContext,
  onOpen,
}) => {
  // Drafts are made only from graphs the canvas can draw, and no edit makes one it can't,
  // so this always parses.
  const graph = useMemo(() => parseGraph(draft.content), [draft.content]);
  if (!graph.ok) return null;
  return (
    <>
      {draft.deletedOnDisk && <DeletedOnDiskNotice path={definitionPath(draft.ref)} />}
      <RunsUnder run={run} onOpen={onOpen} />
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
        onArrange={onArrange}
        onPaste={onPaste}
        selected={selected}
        selectionKey={selectionKey}
        onSelect={onSelect}
        onReady={onReady}
        onValidated={onValidated}
        problemsShown={problemsShown}
        onToggleProblems={onToggleProblems}
        runContext={runContext}
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
  // A contract's save also expects its bindings file unchanged, so either may be the one.
  const path =
    conflict.ref.kind === "contracts" && conflict.reason === "changed"
      ? `${definitionPath(conflict.ref)} or ${bindingsPath(conflict.ref.id)}`
      : definitionPath(conflict.ref);
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

/** A titled list of paths in a prompt, left out when there are none. */
const PathList: FC<{ title: string; paths: string[] }> = ({ title, paths }) =>
  paths.length === 0 ? null : (
    <div className="space-y-1">
      <p className="text-xs text-[#c9d1d9]">{title}</p>
      <ul className="max-h-32 overflow-y-auto text-[11px] font-mono text-[#8b949e] space-y-0.5">
        {paths.map((path) => (
          <li key={path} className="break-words">
            {path}
          </li>
        ))}
      </ul>
    </div>
  );

/**
 * Confirms a rename or delete the backend has planned (#222), listing every file it
 * touches. Neither can be undone in the builder; a deleted file can be restored from the
 * OS trash.
 */
const PendingPrompt: FC<{
  rootRef: Ref<HTMLDivElement>;
  pending: Pending;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ rootRef, pending, busy, onConfirm, onCancel }) => {
  const titleId = useId();
  const path = definitionPath(pending.ref);
  let title: string;
  let body: ReactNode;
  let action: string;
  if (pending.type === "rename") {
    const { plan } = pending;
    title = `Rename ${path} to ${pending.newId}?`;
    action = "Rename";
    body = (
      <>
        <PathList
          title="These files change:"
          paths={plan.changes.map((c) => (c.newPath ? `${c.path} → ${c.newPath}` : `${c.path} (references rewritten)`))}
        />
        <PathList
          title="These unsaved drafts refer to it, and are rewritten too:"
          paths={plan.drafts.map((d) => definitionPath(d))}
        />
        <PathList title="These files couldn't be read, so any reference in them stays as it is:" paths={plan.unchecked} />
        <p className="text-xs text-[#8b949e]">
          New files are written before the old ones are removed. A rename can't be undone, and it clears the undo
          history of every draft it changes.
        </p>
      </>
    );
  } else if (pending.plan === null) {
    title = `Discard the draft of ${path}?`;
    action = "Discard";
    body = <p className="text-xs text-[#c9d1d9]">It has no file on disk, so its draft is all there is of it.</p>;
  } else {
    const { plan } = pending;
    title = `Delete ${path}?`;
    action = "Delete";
    body = (
      <>
        <PathList title={`These files move to ${TRASH_NAME}:`} paths={plan.files} />
        <PathList
          title="These definitions refer to it, and will refer to a missing one afterwards:"
          paths={plan.referrers}
        />
        <PathList title="These files couldn't be read to look for references:" paths={plan.unchecked} />
        <p className="text-xs text-[#8b949e]">Its draft and undo history are dropped.</p>
      </>
    );
  }
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/60 p-6">
      <div
        ref={rootRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-w-lg w-full rounded-lg border border-[#30363d] bg-[#161b22] p-4 space-y-3 shadow-2xl"
      >
        <h3 id={titleId} className="text-sm font-semibold text-white break-words">
          {title}
        </h3>
        {body}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={`${promptButton} bg-[#da3633] hover:bg-[#f85149] text-white`}
          >
            {busy ? `${action}…` : action}
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
    const previous = focusedElement();
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
