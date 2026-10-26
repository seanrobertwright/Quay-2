import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  AlertCircle,
  ArrowUp,
  ChevronRight,
  Clock,
  Folder,
  FolderGit2,
  FolderOpen,
  HardDrive,
  Home,
  Loader2,
  Star,
  X,
} from "lucide-react";
import { useOverlay } from "../overlay/useOverlay";
import {
  applyCompletion,
  baseName,
  canOpen,
  cleanOpenPath,
  completionTarget,
  filterCompletions,
  joinPath,
  parentPath,
  pinnedRoots,
  sameFolder,
  splitPath,
  verdictFor,
  type FolderInfo,
  type Verdict,
} from "./openProjectPaths";

interface FolderEntry {
  name: string;
  path: string;
  is_git: boolean;
  branch: string | null;
}

interface FolderListing {
  path: string;
  entries: FolderEntry[];
  truncated: boolean;
}

interface RecentProject {
  path: string;
  name: string;
  last_opened: number;
  exists: boolean;
  is_git: boolean;
  branch: string | null;
}

interface Places {
  home: string | null;
  drives: string[];
}

interface OpenProjectDialogProps {
  isOpen: boolean;
  onClose: () => void;
  projects: { path: string }[];
  /** Adds a folder as a new project and switches to it. */
  onAddProject: (path: string) => Promise<void>;
  /** Switches to a project already in Quay. */
  onSelectProject: (path: string) => void;
}

/** How long the path bar waits after a keystroke before asking the backend about the folder. */
const LOOKUP_DELAY_MS = 120;

function VerdictChip({ verdict }: { verdict: Verdict }) {
  const base = "shrink-0 text-[11px] px-2 py-0.5 rounded-full border whitespace-nowrap";
  switch (verdict.kind) {
    case "empty":
      return null;
    case "checking":
      return (
        <span className={`${base} text-[#8b949e] border-[#30363d] flex items-center gap-1`}>
          <Loader2 className="w-3 h-3 animate-spin" /> Checking
        </span>
      );
    case "missing":
      return <span className={`${base} text-[#f85149] border-[#f85149]/40`}>Folder not found</span>;
    case "added":
      return (
        <span className={`${base} text-[#d29922] border-[#d29922]/40`}>Already in Quay, Open switches to it</span>
      );
    case "git":
      return (
        <span className={`${base} text-[#3fb950] border-[#3fb950]/40`}>
          Git repo{verdict.branch ? ` · ${verdict.branch}` : ""}
        </span>
      );
    case "plain":
      return (
        <span
          className={`${base} text-[#8b949e] border-[#30363d]`}
          title="Terminals work in any folder. Diffs and worktrees need a git repo."
        >
          Not a git repo: terminals work, diffs and worktrees won't
        </span>
      );
  }
}

function SidebarHeading({ children }: { children: React.ReactNode }) {
  return <div className="px-2 pt-3 pb-1 text-[11px] uppercase tracking-wide text-[#6e7681]">{children}</div>;
}

/**
 * The Open Project dialog: a sidebar of recent projects, places and drives; a folder browser
 * with breadcrumbs and git badges; and a path bar with Tab completion and a verdict chip.
 */
export const OpenProjectDialog: React.FC<OpenProjectDialogProps> = ({
  isOpen,
  onClose,
  projects,
  onAddProject,
  onSelectProject,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { backdropProps, panelProps } = useOverlay({ isOpen, onClose, initialFocusRef: inputRef });

  const [places, setPlaces] = useState<Places>({ home: null, drives: [] });
  const [recents, setRecents] = useState<RecentProject[]>([]);
  const [cwd, setCwd] = useState<string | null>(null);
  const [listing, setListing] = useState<FolderListing | null>(null);
  const [listingError, setListingError] = useState("");
  const [isListing, setIsListing] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [pathText, setPathText] = useState("");
  const [info, setInfo] = useState<FolderInfo | null>(null);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestionNames, setSuggestionNames] = useState<string[]>([]);
  const [highlight, setHighlight] = useState(-1);
  const [isOpening, setIsOpening] = useState(false);
  const [openError, setOpenError] = useState("");

  /** Subfolder names per folder, so Tab and the suggestion list don't re-read a folder. */
  const namesCache = useRef(new Map<string, string[]>());

  const listNames = useCallback(async (folder: string): Promise<string[]> => {
    const key = folder.toLowerCase();
    const cached = namesCache.current.get(key);
    if (cached) return cached;
    try {
      const result = await invoke<FolderListing>("list_folder", { path: folder });
      const names = result.entries.map((e) => e.name);
      namesCache.current.set(key, names);
      return names;
    } catch {
      return [];
    }
  }, []);

  // Navigates the browser; the path bar follows unless the caller says otherwise.
  const goTo = useCallback((folder: string, syncPath = true) => {
    setCwd(folder);
    setSelected(null);
    if (syncPath) {
      setPathText(folder);
      setSuggestionsOpen(false);
    }
  }, []);

  // Fresh state and sidebar data each time the dialog opens.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    namesCache.current.clear();
    setListing(null);
    setListingError("");
    setSelected(null);
    setOpenError("");
    setIsOpening(false);
    setSuggestionsOpen(false);
    setPathText("");
    setCwd(null);

    Promise.all([
      invoke<Places>("open_project_places").catch(() => ({ home: null, drives: [] }) as Places),
      invoke<RecentProject[]>("list_recent_projects").catch(() => [] as RecentProject[]),
    ]).then(([loadedPlaces, loadedRecents]) => {
      if (cancelled) return;
      setPlaces(loadedPlaces);
      setRecents(loadedRecents);
      const firstRecent = loadedRecents.find((r) => r.exists);
      const start =
        (firstRecent && parentPath(firstRecent.path)) || loadedPlaces.home || loadedPlaces.drives[0] || null;
      if (start) goTo(start);
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen, goTo]);

  // List the folder being browsed.
  useEffect(() => {
    if (!isOpen || !cwd) return;
    let cancelled = false;
    setIsListing(true);
    setListingError("");
    invoke<FolderListing>("list_folder", { path: cwd })
      .then((result) => {
        if (cancelled) return;
        setListing(result);
        namesCache.current.set(cwd.toLowerCase(), result.entries.map((e) => e.name));
      })
      .catch((err) => {
        if (cancelled) return;
        setListing(null);
        setListingError(typeof err === "string" ? err : "Can't read this folder.");
      })
      .finally(() => {
        if (!cancelled) setIsListing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, cwd]);

  // Look up the typed folder for the verdict chip.
  useEffect(() => {
    if (!isOpen) return;
    setInfo(null);
    const typed = pathText.trim();
    if (!typed) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      invoke<FolderInfo>("inspect_folder", { path: cleanOpenPath(typed) })
        .then((result) => !cancelled && setInfo(result))
        .catch(() => !cancelled && setInfo({ exists: false, is_git: false, branch: null }));
    }, LOOKUP_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [isOpen, pathText]);

  // Suggestions for the folder being typed.
  useEffect(() => {
    if (!isOpen || !suggestionsOpen) return;
    let cancelled = false;
    const { parent, leaf } = completionTarget(pathText);
    const load = parent === null ? Promise.resolve(places.drives) : listNames(parent);
    load.then((names) => {
      if (cancelled) return;
      setSuggestionNames(filterCompletions(names, leaf).slice(0, 50));
      setHighlight(-1);
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen, suggestionsOpen, pathText, places.drives, listNames]);

  // Long paths show their end: the current folder in the breadcrumbs, the leaf in the path bar
  // unless the caret is somewhere in the middle because the user is editing there.
  const crumbsRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const crumbsEl = crumbsRef.current;
    if (crumbsEl) crumbsEl.scrollLeft = crumbsEl.scrollWidth;
  }, [cwd]);
  useEffect(() => {
    // After layout, since the verdict chip beside the input changes its width.
    const frame = requestAnimationFrame(() => {
      const input = inputRef.current;
      if (input && input.selectionStart === input.value.length) input.scrollLeft = input.scrollWidth;
    });
    return () => cancelAnimationFrame(frame);
  }, [pathText, info]);

  const verdict = verdictFor(pathText, info, projects);
  const pinned = useMemo(
    () => pinnedRoots(projects.map((p) => p.path), places.home),
    [projects, places.home]
  );
  const crumbs = cwd ? splitPath(cwd) : [];

  const openPath = useCallback(
    async (path: string, knownVerdict?: Verdict) => {
      const target = cleanOpenPath(path);
      if (!target || isOpening) return;
      const existing =
        knownVerdict?.kind === "added"
          ? knownVerdict.projectPath
          : projects.find((p) => sameFolder(p.path, target))?.path;
      if (existing) {
        onSelectProject(existing);
        onClose();
        return;
      }
      try {
        setIsOpening(true);
        setOpenError("");
        await onAddProject(target);
        onClose();
      } catch (err) {
        console.error("Failed to open project:", err);
        setOpenError(typeof err === "string" ? err : "Failed to open project.");
      } finally {
        setIsOpening(false);
      }
    },
    [isOpening, projects, onSelectProject, onAddProject, onClose]
  );

  const completeInput = async (picked?: string) => {
    const { parent } = completionTarget(pathText);
    const candidates = parent === null ? places.drives : await listNames(parent);
    const next = applyCompletion(pathText, candidates, picked);
    if (next === pathText) return;
    setPathText(next);
    setSuggestionsOpen(true);
    // A completed folder also shows in the browser, so the list and the bar agree.
    if (next.endsWith("\\")) goTo(cleanOpenPath(next), false);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const showing = suggestionsOpen && suggestionNames.length > 0;
    if (e.key === "Tab" && !e.shiftKey && pathText.trim()) {
      e.preventDefault();
      void completeInput(showing && highlight >= 0 ? suggestionNames[highlight] : undefined);
    } else if (e.key === "ArrowDown" && showing) {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, suggestionNames.length - 1));
    } else if (e.key === "ArrowUp" && showing) {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (showing && highlight >= 0) {
        void completeInput(suggestionNames[highlight]);
      } else if (canOpen(verdict)) {
        void openPath(pathText, verdict);
      }
    }
  };

  if (!isOpen) return null;

  const sidebarButton = (active: boolean) =>
    `w-full text-left px-2 py-1 rounded flex items-center gap-2 text-sm transition-colors ${
      active ? "bg-[#21262d] text-white" : "text-[#c9d1d9] hover:bg-[#21262d]"
    }`;

  return (
    <div
      {...backdropProps}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
    >
      <div
        {...panelProps}
        aria-label="Open project"
        className="focus:outline-hidden w-[900px] max-w-full h-[600px] max-h-full flex flex-col bg-[#161b22] border border-[#30363d] rounded-lg shadow-2xl overflow-hidden text-[#c9d1d9] animate-in fade-in zoom-in-95 duration-100"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#30363d]">
          <h2 className="text-white font-semibold flex items-center gap-2">
            <FolderGit2 className="w-5 h-5 text-[#58a6ff]" />
            Open Project
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-[#8b949e] hover:text-white p-1 rounded transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Sidebar: recent projects, places, drives */}
          <aside className="w-60 shrink-0 border-r border-[#30363d] px-2 pb-2 overflow-y-auto">
            {recents.length > 0 && (
              <>
                <SidebarHeading>Recent</SidebarHeading>
                {recents.map((r) => {
                  const inQuay = projects.some((p) => sameFolder(p.path, r.path));
                  return (
                    <button
                      key={r.path}
                      type="button"
                      disabled={!r.exists}
                      title={r.exists ? r.path : `${r.path} (folder not found)`}
                      onClick={() => {
                        const parent = parentPath(r.path);
                        if (parent) goTo(parent, false);
                        setSelected(r.path);
                        setPathText(r.path);
                        setSuggestionsOpen(false);
                      }}
                      onDoubleClick={() => void openPath(r.path)}
                      className={`${sidebarButton(selected !== null && sameFolder(selected, r.path))} disabled:opacity-40`}
                    >
                      {r.is_git ? (
                        <FolderGit2 className="w-4 h-4 shrink-0 text-[#3fb950]" />
                      ) : (
                        <Clock className="w-4 h-4 shrink-0 text-[#8b949e]" />
                      )}
                      <span className="truncate flex-1">{r.name}</span>
                      {inQuay && <span className="w-1.5 h-1.5 rounded-full bg-[#58a6ff] shrink-0" title="In Quay" />}
                    </button>
                  );
                })}
              </>
            )}

            <SidebarHeading>Places</SidebarHeading>
            {places.home && (
              <button
                type="button"
                onClick={() => goTo(places.home!)}
                className={sidebarButton(!!cwd && sameFolder(cwd, places.home))}
              >
                <Home className="w-4 h-4 shrink-0 text-[#8b949e]" />
                <span className="truncate">Home</span>
              </button>
            )}
            {pinned.map((root) => (
              <button
                key={root}
                type="button"
                title={root}
                onClick={() => goTo(root)}
                className={sidebarButton(!!cwd && sameFolder(cwd, root))}
              >
                <Star className="w-4 h-4 shrink-0 text-[#8b949e]" />
                <span className="truncate">{baseName(root)}</span>
              </button>
            ))}

            {places.drives.length > 0 && <SidebarHeading>Drives</SidebarHeading>}
            {places.drives.map((drive) => (
              <button
                key={drive}
                type="button"
                onClick={() => goTo(drive)}
                className={sidebarButton(!!cwd && sameFolder(cwd, drive))}
              >
                <HardDrive className="w-4 h-4 shrink-0 text-[#8b949e]" />
                <span className="truncate">{drive.replace(/\\$/, "")}</span>
              </button>
            ))}
          </aside>

          {/* Folder browser */}
          <section className="flex-1 flex flex-col min-w-0">
            <nav className="flex items-center gap-1 px-3 py-2 border-b border-[#30363d] text-sm min-h-[41px]">
              <button
                type="button"
                onClick={() => cwd && parentPath(cwd) && goTo(parentPath(cwd)!)}
                disabled={!cwd || !parentPath(cwd)}
                title="Up one folder"
                aria-label="Up one folder"
                className="p-1 mr-1 rounded text-[#8b949e] hover:text-white hover:bg-[#21262d] disabled:opacity-30 disabled:pointer-events-none"
              >
                <ArrowUp className="w-4 h-4" />
              </button>
              <div ref={crumbsRef} className="flex items-center gap-1 min-w-0 overflow-x-auto [scrollbar-width:none]">
                {crumbs.map((part, i) => (
                  <span key={i} className="flex items-center gap-1 shrink-0">
                    {i > 0 && <ChevronRight className="w-3.5 h-3.5 text-[#6e7681]" />}
                    <button
                      type="button"
                      onClick={() => goTo(joinPath(crumbs.slice(0, i + 1)))}
                      className={`px-1.5 py-0.5 rounded hover:bg-[#21262d] ${
                        i === crumbs.length - 1 ? "text-white" : "text-[#c9d1d9]"
                      }`}
                    >
                      {part}
                    </button>
                  </span>
                ))}
              </div>
              {isListing && <Loader2 className="w-3.5 h-3.5 ml-auto shrink-0 animate-spin text-[#8b949e]" />}
            </nav>

            <ul className="flex-1 overflow-y-auto p-2" aria-label="Folders">
              {listingError && (
                <li className="px-3 py-6 text-sm text-[#f85149] flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" /> {listingError}
                </li>
              )}
              {!listingError && listing && listing.entries.length === 0 && !isListing && (
                <li className="px-3 py-6 text-sm text-[#6e7681]">No folders here.</li>
              )}
              {!listingError &&
                listing?.entries.map((entry) => {
                  const isSelected = selected !== null && sameFolder(selected, entry.path);
                  const inQuay = projects.some((p) => sameFolder(p.path, entry.path));
                  return (
                    <li key={entry.path}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelected(entry.path);
                          setPathText(entry.path);
                          setSuggestionsOpen(false);
                        }}
                        onDoubleClick={() => (entry.is_git ? void openPath(entry.path) : goTo(entry.path))}
                        className={`w-full text-left px-3 py-1.5 rounded flex items-center gap-3 cursor-default ${
                          isSelected ? "bg-[#1f6feb]/25" : "hover:bg-[#21262d]"
                        }`}
                      >
                        {entry.is_git ? (
                          <FolderGit2 className="w-4 h-4 shrink-0 text-[#3fb950]" />
                        ) : (
                          <Folder className="w-4 h-4 shrink-0 text-[#8b949e]" />
                        )}
                        <span className="text-sm text-white flex-1 truncate">{entry.name}</span>
                        {inQuay && (
                          <span className="text-[10px] px-1.5 rounded bg-[#21262d] text-[#8b949e] shrink-0">in Quay</span>
                        )}
                        {entry.is_git && entry.branch && (
                          <span className="text-[11px] text-[#8b949e] font-mono truncate max-w-[40%]">{entry.branch}</span>
                        )}
                        {!entry.is_git && <ChevronRight className="w-4 h-4 shrink-0 text-[#6e7681]" />}
                      </button>
                    </li>
                  );
                })}
              {listing?.truncated && (
                <li className="px-3 py-2 text-xs text-[#6e7681]">
                  Showing the first {listing.entries.length} folders. Type a path to reach the rest.
                </li>
              )}
            </ul>
            <div className="text-[11px] text-[#6e7681] px-3 pb-1.5">
              Click to select · double-click to enter a folder or open a repo
            </div>
          </section>
        </div>

        {/* Path bar */}
        <div className="border-t border-[#30363d] px-4 py-3">
          {openError && (
            <p className="text-xs text-[#ff7b72] mb-2 flex items-center gap-1 font-mono">
              <AlertCircle className="w-3.5 h-3.5" />
              {openError}
            </p>
          )}
          <div className="flex items-center gap-3">
            <div className="relative flex-1 min-w-0">
              {suggestionsOpen && suggestionNames.length > 0 && (
                <ul
                  className="absolute bottom-full mb-1 left-0 right-0 max-h-48 overflow-y-auto bg-[#0d1117] border border-[#30363d] rounded shadow-xl py-1 z-10"
                  aria-label="Folder suggestions"
                >
                  {suggestionNames.map((name, i) => (
                    <li key={name}>
                      <button
                        type="button"
                        tabIndex={-1}
                        onMouseDown={(e) => e.preventDefault()}
                        onMouseEnter={() => setHighlight(i)}
                        onClick={() => void completeInput(name)}
                        className={`w-full text-left px-3 py-1 text-sm font-mono flex items-center gap-2 ${
                          i === highlight ? "bg-[#1f6feb]/25 text-white" : "text-[#c9d1d9]"
                        }`}
                      >
                        <FolderOpen className="w-3.5 h-3.5 text-[#8b949e] shrink-0" />
                        <span className="truncate">{name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <input
                ref={inputRef}
                type="text"
                value={pathText}
                spellCheck={false}
                aria-label="Folder path"
                placeholder="Type a path, Tab to complete (E:\Projects\…)"
                onChange={(e) => {
                  setPathText(e.target.value);
                  setSelected(null);
                  setSuggestionsOpen(true);
                  setOpenError("");
                }}
                onBlur={() => setSuggestionsOpen(false)}
                onKeyDown={handleInputKeyDown}
                className="w-full px-3 py-1.5 bg-[#0d1117] border border-[#30363d] rounded text-sm font-mono text-white placeholder-[#484f58] outline-none focus:border-[#58a6ff]"
              />
            </div>
            <VerdictChip verdict={verdict} />
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-sm rounded border border-[#30363d] text-[#c9d1d9] hover:bg-[#21262d] transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!canOpen(verdict) || isOpening}
              onClick={() => void openPath(pathText, verdict)}
              className="px-4 py-1.5 text-sm rounded bg-[#238636] hover:bg-[#2ea043] text-white font-medium disabled:opacity-40 disabled:pointer-events-none transition-colors"
            >
              {isOpening ? "Opening..." : "Open"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
