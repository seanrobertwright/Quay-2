// The Praxis Builder (#221): a modal of its own that lists the active project's `.praxis/`
// definitions and shows a graph read-only on the canvas, with its validation problems.
// Closing only hides it, so each project's session survives until Quay quits.
import { useCallback, useEffect, useId, useMemo, useRef, useState, type FC } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Viewport } from "@xyflow/react";
import {
  CircleAlert,
  FolderOpen,
  FolderPlus,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  TriangleAlert,
  Workflow,
  X,
} from "lucide-react";
import { normalizePath } from "../../utils/paths.ts";
import { parseGraph, parseLayoutPositions } from "./model.ts";
import { RECORD_KINDS } from "./kinds.ts";
import { GraphView, UndrawnGraphProblems } from "./GraphView.tsx";
import { definitionKey, sessionFor, updateSession, type Sessions } from "./session.ts";
import type { DefinitionFile, DefinitionList, DefinitionRef, FileProblem, PraxisKind } from "./types.ts";

export interface BuilderProject {
  path: string;
  name: string;
}

interface PraxisBuilderModalProps {
  isOpen: boolean;
  /** The active project, or null when no registered project (or its worktree) is active. */
  project: BuilderProject | null;
  onClose: () => void;
  onAddProject: () => void;
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

const definitionPath = (ref: DefinitionRef) => `.praxis/${ref.kind}/${ref.id}.json`;

export const PraxisBuilderModal: FC<PraxisBuilderModalProps> = ({ isOpen, project, onClose, onAddProject }) => {
  const titleId = useId();
  const listId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [sessions, setSessions] = useState<Sessions>(new Map());
  const [listing, setListing] = useState<Listing | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [listShown, setListShown] = useState(true);
  const [problemsShown, setProblemsShown] = useState(true);
  const toggleProblems = useCallback(() => setProblemsShown((v) => !v), []);
  const [revealError, setRevealError] = useState<string | null>(null);
  const [refreshCount, setRefreshCount] = useState(0);

  const projectPath = project?.path ?? null;
  const projectKey = projectPath ? normalizePath(projectPath) : "";
  const session = projectPath ? sessionFor(sessions, projectPath) : null;
  const open = session?.open ?? null;
  const openKind = open?.kind;
  const openId = open?.id;
  const openKey = open ? definitionKey(open) : "";

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

  // Read the open definition each time it, or the builder, is shown.
  useEffect(() => {
    if (!isOpen || !projectPath || !openKind || openId === undefined) return;
    let stale = false;
    const key = normalizePath(projectPath);
    const defKey = definitionKey({ kind: openKind, id: openId });
    setRevealError(null);
    invoke<DefinitionFile>("praxis_read", { projectPath, kind: openKind, id: openId }).then(
      (file) => {
        if (!stale) setLoaded({ projectKey: key, defKey, file });
      },
      (e) => {
        if (!stale) setLoaded({ projectKey: key, defKey, error: String(e) });
      }
    );
    return () => {
      stale = true;
    };
  }, [isOpen, projectPath, openKind, openId, refreshCount]);

  // Focus moves into the builder when it opens and back to where it was when it hides.
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    return () => previous?.focus();
  }, [isOpen]);

  // Keys pressed inside the builder: Escape hides it (it is read-only for now, so there is
  // nothing smaller to cancel first), and Tab cycles through its controls instead of
  // leaving for the app behind it. Keys from elsewhere, such as the command palette or
  // another modal open over it, are left alone.
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const dialog = dialogRef.current;
      if (e.defaultPrevented || !dialog || !(e.target instanceof Node) || !dialog.contains(e.target)) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Tab") {
        const focusable = Array.from(
          dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input, select, textarea, [tabindex="0"]')
        ).filter((el) => el.offsetParent !== null);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || active === dialog)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  const openDefinition = (ref: DefinitionRef) => {
    if (!projectPath) return;
    setSessions((s) => updateSession(s, projectPath, (cur) => ({ ...cur, open: ref })));
  };

  const saveViewport = useCallback(
    (viewport: Viewport) => {
      if (!projectPath || !openKey) return;
      setSessions((s) =>
        updateSession(s, projectPath, (cur) => ({ ...cur, viewports: { ...cur.viewports, [openKey]: viewport } }))
      );
    },
    [projectPath, openKey]
  );

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

  return (
    <div className={isOpen ? "fixed inset-0 z-40 flex bg-black/75 backdrop-blur-xs p-3" : "hidden"}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="flex flex-col w-full h-full bg-[#0d1117] border border-[#30363d] rounded-xl shadow-2xl overflow-hidden text-[#c9d1d9] outline-none"
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
              {open && <span className="font-mono text-[#c9d1d9]"> · {definitionPath(open)}</span>}
            </span>
          )}
          <div className="ml-auto flex items-center gap-1.5 shrink-0">
            {project && (
              <>
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
                      {entry.list && (
                        <ul>
                          {entry.list.entries.map((def) => {
                            const ref = { kind, id: def.id };
                            const isOpenDef = openKey === definitionKey(ref);
                            return (
                              <li key={def.id}>
                                <button
                                  type="button"
                                  aria-current={isOpenDef ? "page" : undefined}
                                  onClick={() => openDefinition(ref)}
                                  title={def.problem ? `${def.id}: ${def.problem.message}` : def.id}
                                  className={`w-[calc(100%-0.75rem)] mx-1.5 px-2 py-1 rounded-md flex items-center gap-1.5 text-left text-xs font-mono ${
                                    isOpenDef ? "bg-[#1f6feb]/25 text-white" : "text-[#c9d1d9] hover:bg-[#21262d]"
                                  }`}
                                >
                                  <span className="truncate">{def.id}</span>
                                  {def.problem && (
                                    <span className="ml-auto inline-flex items-center text-[#ff7b72] shrink-0">
                                      <CircleAlert className="w-3.5 h-3.5" aria-hidden="true" />
                                      <span className="sr-only">(can't be opened)</span>
                                    </span>
                                  )}
                                </button>
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
              ) : !current ? (
                <p className="p-6 text-sm text-[#6e7681]">Loading {definitionPath(open)}…</p>
              ) : current.error !== undefined ? (
                <p role="alert" className="p-6 text-sm text-[#ff7b72] break-words">
                  {current.error}
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
                  // Remount per definition, so the canvas fits or restores its viewport.
                  key={`${projectKey}|${openKey}`}
                  open={open}
                  file={current.file!}
                  viewport={session?.viewports[openKey]}
                  onViewportChange={saveViewport}
                  onReveal={() => void reveal(open)}
                  revealError={revealError}
                  problemsShown={problemsShown}
                  onToggleProblems={toggleProblems}
                />
              )}
            </main>
          </div>
        )}
      </div>
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

const DefinitionView: FC<{
  open: DefinitionRef;
  file: DefinitionFile;
  viewport: Viewport | undefined;
  onViewportChange: (viewport: Viewport) => void;
  onReveal: () => void;
  revealError: string | null;
  problemsShown: boolean;
  onToggleProblems: () => void;
}> = ({ open, file, viewport, onViewportChange, onReveal, revealError, problemsShown, onToggleProblems }) => {
  const graph = useMemo(() => (open.kind === "graphs" ? parseGraph(file.content) : null), [open.kind, file.content]);
  const positions = useMemo(() => parseLayoutPositions(file.layout), [file.layout]);

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
  return (
    <>
      {file.layoutProblem && (
        <p role="status" className="shrink-0 px-4 py-1.5 flex items-center gap-1.5 text-[11px] text-[#e3b341] border-b border-[#30363d] bg-[#161b22]">
          <TriangleAlert className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span className="break-words">
            .praxis/layout/{open.id}.json was ignored, so the graph is laid out automatically: {file.layoutProblem.message}
          </span>
        </p>
      )}
      <GraphView
        graph={graph.value}
        content={file.content}
        positions={positions}
        viewport={viewport}
        onViewportChange={onViewportChange}
        problemsShown={problemsShown}
        onToggleProblems={onToggleProblems}
      />
    </>
  );
};
