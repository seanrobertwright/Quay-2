// PROTOTYPE (#285) — throwaway. Three structurally different Open Project
// dialogs, judged against a fake filesystem. Not production code.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronRight, Clock, FolderGit2, Folder, HardDrive, Home, Search, X, CornerDownLeft, Star,
} from "lucide-react";
import {
  ROOTS, RECENTS, type FakeDir, complete, findDir, joinPath, splitPath, validate, type Verdict,
} from "./fakeFs";

export interface VariantProps {
  onClose: () => void;
  onOpen: (path: string) => void;
}

function VerdictChip({ v }: { v: Verdict }) {
  const map: Record<Verdict["kind"], [string, string]> = {
    empty: ["", ""],
    missing: ["Folder not found", "text-[#f85149] border-[#f85149]/40"],
    added: ["Already in Quay — will switch to it", "text-[#d29922] border-[#d29922]/40"],
    git: ["Git repo", "text-[#3fb950] border-[#3fb950]/40"],
    plain: ["Not a git repo — terminals work, diffs/worktrees won't", "text-[#8b949e] border-[#30363d]"],
  };
  if (v.kind === "empty") return null;
  const [label, cls] = map[v.kind];
  return (
    <span className={`text-[11px] px-2 py-0.5 rounded-full border ${cls}`}>
      {label}
      {v.kind === "git" && v.branch ? ` · ${v.branch}` : ""}
    </span>
  );
}

const canOpen = (v: Verdict) => v.kind === "git" || v.kind === "plain" || v.kind === "added";

/* ------------------------------------------------------------------ */
/* A — Launcher: one keyboard-first input, palette style               */
/* ------------------------------------------------------------------ */
export function VariantA({ onClose, onOpen }: VariantProps) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const looksLikePath = /^[a-z]:|\\|\//i.test(q);

  const rows = useMemo(() => {
    if (looksLikePath) {
      return complete(q).map((p) => ({ path: p, title: splitPath(p).pop() ?? p, sub: p, kind: "dir" as const }));
    }
    const needle = q.toLowerCase();
    return RECENTS.filter((r) => !needle || r.name.toLowerCase().includes(needle) || r.path.toLowerCase().includes(needle))
      .map((r) => ({ path: r.path, title: r.name, sub: `${r.path} · ${r.branch} · ${r.lastOpened}`, kind: "recent" as const }));
  }, [q, looksLikePath]);

  useEffect(() => setSel(0), [q]);
  const verdict = validate(looksLikePath ? q : rows[sel]?.path ?? "");

  const key = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, rows.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === "Tab" && rows[sel]) { e.preventDefault(); setQ(rows[sel].path + "\\"); }
    else if (e.key === "Enter") {
      const target = looksLikePath && !rows.length ? q : rows[sel]?.path ?? q;
      if (canOpen(validate(target))) onOpen(target.replace(/\\$/, ""));
    } else if (e.key === "Escape") onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-center pt-[12vh] bg-black/50" onMouseDown={onClose}>
      <div className="w-[640px] h-fit bg-[#161b22] border border-[#30363d] rounded-xl shadow-2xl overflow-hidden" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[#30363d]">
          <Search className="w-4 h-4 text-[#8b949e]" />
          <input
            autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={key}
            placeholder="Search recent projects, or type a path (E:\…)"
            className="flex-1 bg-transparent text-[15px] text-white placeholder-[#6e7681] outline-none font-mono"
          />
          <VerdictChip v={verdict} />
        </div>
        <div className="px-2 py-1 text-[11px] uppercase tracking-wide text-[#6e7681]">
          {looksLikePath ? "Folders" : "Recent projects"}
        </div>
        <ul className="max-h-[360px] overflow-auto pb-2">
          {rows.length === 0 && <li className="px-4 py-6 text-sm text-[#6e7681]">No matches. Press Enter to open the typed path.</li>}
          {rows.map((r, i) => (
            <li
              key={r.path}
              onMouseEnter={() => setSel(i)}
              onClick={() => (r.kind === "dir" ? setQ(r.path + "\\") : onOpen(r.path))}
              className={`mx-2 px-3 py-2 rounded-md flex items-center gap-3 cursor-pointer ${i === sel ? "bg-[#1f6feb]/25" : ""}`}
            >
              {r.kind === "recent" ? <Clock className="w-4 h-4 text-[#8b949e]" /> : findDir(r.path)?.isGit ? <FolderGit2 className="w-4 h-4 text-[#3fb950]" /> : <Folder className="w-4 h-4 text-[#8b949e]" />}
              <div className="min-w-0 flex-1">
                <div className="text-sm text-white truncate">{r.title}</div>
                <div className="text-xs text-[#8b949e] truncate font-mono">{r.sub}</div>
              </div>
              {i === sel && <CornerDownLeft className="w-3.5 h-3.5 text-[#8b949e]" />}
            </li>
          ))}
        </ul>
        <div className="flex gap-4 px-4 py-2 border-t border-[#30363d] text-[11px] text-[#6e7681]">
          <span>↑↓ select</span><span>Tab complete folder</span><span>Enter open</span><span>Esc close</span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* B — Two-pane browser: places sidebar + folder list + path bar      */
/* ------------------------------------------------------------------ */
export function VariantB({ onClose, onOpen }: VariantProps) {
  const [cwd, setCwd] = useState<string[]>(["E:", "Projects"]);
  const [picked, setPicked] = useState<string | null>(null);
  const [pathText, setPathText] = useState("");
  const dir = findDir(joinPath(cwd));
  const target = pathText || picked || joinPath(cwd);
  const verdict = validate(target);

  const go = (parts: string[]) => { setCwd(parts); setPicked(null); setPathText(""); };
  const places: { label: string; icon: React.ReactNode; parts: string[] }[] = [
    { label: "Home", icon: <Home className="w-4 h-4" />, parts: ["C:", "Users", "swright"] },
    { label: "Projects", icon: <Star className="w-4 h-4" />, parts: ["E:", "Projects"] },
    { label: "repos", icon: <Star className="w-4 h-4" />, parts: ["C:", "repos"] },
    ...ROOTS.map((r) => ({ label: `${r.name} drive`, icon: <HardDrive className="w-4 h-4" />, parts: [r.name] })),
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onMouseDown={onClose}>
      <div className="w-[860px] h-[560px] flex flex-col bg-[#161b22] border border-[#30363d] rounded-lg shadow-2xl overflow-hidden" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#30363d]">
          <h2 className="text-white font-semibold flex items-center gap-2"><FolderGit2 className="w-5 h-5 text-[#58a6ff]" />Open Project</h2>
          <button onClick={onClose} className="text-[#8b949e] hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex flex-1 min-h-0">
          <aside className="w-56 border-r border-[#30363d] p-2 overflow-auto text-sm">
            <div className="px-2 pt-1 pb-1 text-[11px] uppercase text-[#6e7681]">Recent</div>
            {RECENTS.slice(0, 4).map((r) => (
              <button key={r.path} onClick={() => { go(splitPath(r.path).slice(0, -1)); setPicked(r.path); }}
                className="w-full text-left px-2 py-1 rounded hover:bg-[#21262d] flex items-center gap-2 text-[#c9d1d9]">
                <Clock className="w-4 h-4 text-[#8b949e]" /><span className="truncate">{r.name}</span>
              </button>
            ))}
            <div className="px-2 pt-3 pb-1 text-[11px] uppercase text-[#6e7681]">Places</div>
            {places.map((p) => (
              <button key={p.label} onClick={() => go(p.parts)}
                className={`w-full text-left px-2 py-1 rounded hover:bg-[#21262d] flex items-center gap-2 ${joinPath(cwd) === joinPath(p.parts) ? "text-white bg-[#21262d]" : "text-[#c9d1d9]"}`}>
                <span className="text-[#8b949e]">{p.icon}</span>{p.label}
              </button>
            ))}
          </aside>
          <section className="flex-1 flex flex-col min-w-0">
            <nav className="flex items-center gap-1 px-3 py-2 border-b border-[#30363d] text-sm">
              {cwd.map((part, i) => (
                <span key={i} className="flex items-center gap-1">
                  {i > 0 && <ChevronRight className="w-3.5 h-3.5 text-[#6e7681]" />}
                  <button onClick={() => go(cwd.slice(0, i + 1))} className="px-1.5 py-0.5 rounded hover:bg-[#21262d] text-[#c9d1d9]">{part}</button>
                </span>
              ))}
            </nav>
            <ul className="flex-1 overflow-auto p-2">
              {(dir?.children ?? []).map((c: FakeDir) => {
                const full = `${joinPath(cwd).replace(/\\$/, "")}\\${c.name}`;
                return (
                  <li key={c.name}
                    onClick={() => { setPicked(full); setPathText(""); }}
                    onDoubleClick={() => (c.isGit ? onOpen(full) : go([...cwd, c.name]))}
                    className={`px-3 py-1.5 rounded flex items-center gap-3 cursor-default ${picked === full ? "bg-[#1f6feb]/25" : "hover:bg-[#21262d]"}`}>
                    {c.isGit ? <FolderGit2 className="w-4 h-4 text-[#3fb950]" /> : <Folder className="w-4 h-4 text-[#8b949e]" />}
                    <span className="text-sm text-white flex-1">{c.name}</span>
                    {c.isGit && <span className="text-[11px] text-[#8b949e] font-mono">{c.branch}</span>}
                    {c.children && !c.isGit && <ChevronRight className="w-4 h-4 text-[#6e7681]" />}
                  </li>
                );
              })}
            </ul>
            <div className="text-[11px] text-[#6e7681] px-3 pb-1">Click to select · double-click a folder to enter (a repo to open)</div>
          </section>
        </div>
        <div className="flex items-center gap-3 px-4 py-3 border-t border-[#30363d]">
          <input value={pathText || target} onChange={(e) => setPathText(e.target.value)}
            className="flex-1 px-3 py-1.5 bg-[#0d1117] border border-[#30363d] rounded text-sm font-mono text-white outline-none focus:border-[#58a6ff]" />
          <VerdictChip v={verdict} />
          <button onClick={onClose} className="px-3 py-1.5 text-sm rounded border border-[#30363d] text-[#c9d1d9] hover:bg-[#21262d]">Cancel</button>
          <button disabled={!canOpen(verdict)} onClick={() => onOpen(target.replace(/\\$/, ""))}
            className="px-3 py-1.5 text-sm rounded bg-[#238636] text-white disabled:opacity-40">Open</button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* C — Recent-first, with an inline column (Miller) browser on demand  */
/* ------------------------------------------------------------------ */
export function VariantC({ onClose, onOpen }: VariantProps) {
  const [browsing, setBrowsing] = useState(false);
  const [cols, setCols] = useState<string[]>(["E:"]);
  const [path, setPath] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const verdict = validate(path);

  useEffect(() => { scroller.current?.scrollTo({ left: 9999, behavior: "smooth" }); }, [cols]);

  const columns = cols.map((_, i) => findDir(joinPath(cols.slice(0, i + 1)))).filter(Boolean) as FakeDir[];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onMouseDown={onClose}>
      <div className={`${browsing ? "w-[900px]" : "w-[560px]"} transition-all bg-[#161b22] border border-[#30363d] rounded-lg shadow-2xl overflow-hidden`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-4">
          <h2 className="text-white font-semibold">Open a project</h2>
          <button onClick={onClose} className="text-[#8b949e] hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        {!browsing && (
          <div className="p-5 pt-3 space-y-2">
            {RECENTS.map((r) => (
              <button key={r.path} onClick={() => onOpen(r.path)}
                className="w-full text-left p-3 rounded-lg border border-[#30363d] hover:border-[#58a6ff] hover:bg-[#0d1117] flex items-center gap-3 group">
                <div className="w-9 h-9 rounded-md bg-[#21262d] flex items-center justify-center text-sm font-semibold text-[#58a6ff]">
                  {r.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white flex items-center gap-2">{r.name}
                    {r.added && <span className="text-[10px] px-1.5 rounded bg-[#21262d] text-[#8b949e]">in rail</span>}
                  </div>
                  <div className="text-xs text-[#8b949e] font-mono truncate">{r.path}</div>
                </div>
                <div className="text-right text-[11px] text-[#8b949e]">
                  <div className="font-mono">{r.branch}</div><div>{r.lastOpened}</div>
                </div>
              </button>
            ))}
            <button onClick={() => setBrowsing(true)}
              className="w-full mt-2 p-3 rounded-lg border border-dashed border-[#30363d] text-sm text-[#8b949e] hover:text-white hover:border-[#8b949e] flex items-center justify-center gap-2">
              <Folder className="w-4 h-4" /> Browse for another folder…
            </button>
          </div>
        )}

        {browsing && (
          <div className="p-5 pt-3">
            <div className="flex gap-2 mb-2">
              {ROOTS.map((r) => (
                <button key={r.name} onClick={() => { setCols([r.name]); setPath(""); }}
                  className={`px-2 py-1 rounded text-xs flex items-center gap-1 border ${cols[0] === r.name ? "border-[#58a6ff] text-white" : "border-[#30363d] text-[#8b949e]"}`}>
                  <HardDrive className="w-3.5 h-3.5" />{r.name}
                </button>
              ))}
              <button onClick={() => setBrowsing(false)} className="ml-auto text-xs text-[#58a6ff] hover:underline">← Back to recent</button>
            </div>
            <div ref={scroller} className="flex h-[320px] border border-[#30363d] rounded overflow-x-auto">
              {columns.map((col, i) => (
                <ul key={i} className="w-52 shrink-0 border-r border-[#30363d] overflow-auto py-1">
                  {(col.children ?? []).map((c) => {
                    const parts = [...cols.slice(0, i + 1), c.name];
                    const active = cols[i + 1] === c.name;
                    return (
                      <li key={c.name}
                        onClick={() => { setCols(parts); setPath(joinPath(parts)); }}
                        onDoubleClick={() => canOpen(validate(joinPath(parts))) && onOpen(joinPath(parts))}
                        className={`px-2 py-1 mx-1 rounded flex items-center gap-2 text-sm cursor-default ${active ? "bg-[#1f6feb]/30 text-white" : "text-[#c9d1d9] hover:bg-[#21262d]"}`}>
                        {c.isGit ? <FolderGit2 className="w-4 h-4 text-[#3fb950]" /> : <Folder className="w-4 h-4 text-[#8b949e]" />}
                        <span className="truncate flex-1">{c.name}</span>
                        {c.children && <ChevronRight className="w-3.5 h-3.5 text-[#6e7681]" />}
                      </li>
                    );
                  })}
                </ul>
              ))}
            </div>
            <div className="flex items-center gap-3 mt-3">
              <span className="text-xs font-mono text-[#8b949e] truncate flex-1">{path || "Pick a folder"}</span>
              <VerdictChip v={verdict} />
              <button disabled={!canOpen(verdict)} onClick={() => onOpen(path)}
                className="px-3 py-1.5 text-sm rounded bg-[#238636] text-white disabled:opacity-40">Open</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export const VARIANTS = [
  { key: "A", name: "Launcher (palette-style input)", C: VariantA },
  { key: "B", name: "Two-pane browser", C: VariantB },
  { key: "C", name: "Recent-first + column browser", C: VariantC },
];
