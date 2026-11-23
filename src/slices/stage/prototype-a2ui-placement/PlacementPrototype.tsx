// PROTOTYPE (#687) — throwaway. Where an agent's surface appears in the Quay shell: four
// placements, switchable via ?variant=A|B|C|D, over a mock of the shell as master has it (module
// bar, Projects panel, stage tab bar, pane, companion). Runs in a plain browser with
// `pnpm proto:a2ui-placement`; no Tauri backend, no A2UI, nothing is saved.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  Bot,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Columns2,
  FolderGit2,
  GitBranch,
  Grid2x2,
  Layers,
  Loader2,
  Maximize2,
  Minus,
  Plus,
  Rows2,
  Settings,
  Square,
  Workflow,
  X,
} from "lucide-react";
import { AgentIcon } from "../../terminal/AgentIcons.tsx";
import type { RunKind } from "../../terminal/types.ts";
import "../../shell/shellLook.css";
import { JOBS, SurfaceBody, blocks, boardProgress, surfaceTitle, type Job, type Surface } from "./surfaces.tsx";

// ---------------------------------------------------------------------------------------------
// Made-up shell contents

interface Term {
  id: string;
  name: string;
  kind: RunKind;
  model?: string;
  agent: boolean;
  lines: string[];
}

const TERMS: Term[] = [
  {
    id: "t1",
    name: "fix-75",
    kind: "claude",
    model: "fable-5-2",
    agent: true,
    lines: [
      "> pair each answer with the turn it belongs to",
      "● Read(src/slices/bridge/useBridgeEvents.ts)",
      "  ⎿ 135 lines",
      '● Grep("turn.completed")',
      "  ⎿ 6 matches in 4 files",
      "● Edit(src/slices/companion/activity.ts)",
      "  ⎿ +12 −3",
      "● git fetch origin",
      "  ⎿ master moved 14 commits",
    ],
  },
  {
    id: "t2",
    name: "docs-sweep",
    kind: "codex",
    agent: true,
    lines: ["> bring the tutorials in line with 0.8.0", "• Ran pnpm docs:tutorials --check", "  └ 3 tables out of date", "• Edited docs/tutorials/hello-a2a.md (+9 −9)"],
  },
  {
    id: "t3",
    name: "pr-review",
    kind: "antigravity",
    agent: true,
    lines: ["> review pull request 142", "✓ Read 9 changed files", "✓ Ran the suite: 212 passed"],
  },
  { id: "t4", name: "shell", kind: "powershell", agent: false, lines: ["PS C:\\repos\\Quay-2> pnpm test", "ℹ tests 212", "ℹ pass 212", "PS C:\\repos\\Quay-2>"] },
];

const termOf = (id: string) => TERMS.find((t) => t.id === id)!;

const VARIANTS = [
  { key: "A", name: "Companion view", note: "A view of the companion, for the selected terminal. Other terminals: row, tab dot, and a strip at the companion's foot." },
  { key: "B", name: "Card over the terminal", note: "Docked in the terminal's own pane: questions at the bottom, a board as a strip on top. Other terminals: row and tab dot only." },
  { key: "C", name: "Stage tab", note: "Each surface is a tab beside the terminals and fills the stage when picked. It never takes the stage by itself." },
  { key: "D", name: "Toast, then open", note: "Nothing opens by itself. Every surface arrives as a toast; small ones answer in the toast, and Open takes it to the place picked on the right." },
] as const;
type VariantKey = (typeof VARIANTS)[number]["key"];
type Place = "A" | "B" | "C";

const LOOKS = ["chip", "preview", "edge"] as const;
type Look = (typeof LOOKS)[number];

const SCENES: { key: string; name: string; sends: [Job, string][] }[] = [
  { key: "1", name: "Question", sends: [["question", "t1"]] },
  { key: "2", name: "Question, other terminal", sends: [["question", "t2"]] },
  { key: "3", name: "Review", sends: [["review", "t1"]] },
  { key: "4", name: "Board, then a question", sends: [["status", "t1"], ["question", "t1"]] },
  { key: "5", name: "Quay's permission card", sends: [["quay", "t1"]] },
  { key: "6", name: "Everything at once", sends: [["status", "t1"], ["question", "t2"], ["review", "t3"], ["quay", "t1"]] },
];

const readParam = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
  const value = new URLSearchParams(location.search).get(key) as T | null;
  return value && allowed.includes(value) ? value : fallback;
};
const writeParam = (key: string, value: string) => {
  const url = new URL(location.href);
  url.searchParams.set(key, value);
  history.replaceState(null, "", url);
};

// ---------------------------------------------------------------------------------------------
// A surface in a frame: the title line every placement shares, then the body

const Frame = ({
  surface,
  tick,
  onAction,
  card = true,
  extra,
  bodyClass = "",
}: {
  surface: Surface;
  tick: number;
  onAction: (text: string) => void;
  card?: boolean;
  extra?: ReactNode;
  bodyClass?: string;
}) => {
  const job = JOBS[surface.job];
  const term = termOf(surface.terminalId);
  return (
    <section className={card ? "rounded-lg border border-[#30363d] bg-[#161b22] shadow-2xl shadow-black/60" : ""}>
      <header className="flex items-center gap-2 px-3 pt-3">
        <job.Icon className="w-4 h-4 shrink-0" style={{ color: job.tone }} />
        <h3 className="min-w-0 flex-1 truncate text-[13px] font-medium text-white">{surfaceTitle(surface, tick)}</h3>
        <span className="shrink-0 flex items-center gap-1 text-[10px] text-[#8b949e]">
          {surface.job === "quay" && <span className="px-1 rounded bg-[#30363d] text-[#c9d1d9] font-mono text-[9px]">QUAY</span>}
          <AgentIcon kind={term.kind} className="w-3 h-3" />
          {term.name}
        </span>
        {extra}
      </header>
      <div className={`p-3 ${bodyClass}`}>
        <SurfaceBody key={surface.id} surface={surface} tick={tick} onAction={onAction} />
      </div>
    </section>
  );
};

const toneStyle = (tone: string): CSSProperties => ({ color: tone, borderColor: `${tone}66`, backgroundColor: `${tone}26` });

/** The small labelled pill that stands for one surface on a row. */
const SurfaceChip = ({ surface, tick, onClick }: { surface: Surface; tick: number; onClick: () => void }) => {
  const job = JOBS[surface.job];
  const board = surface.job === "status" ? boardProgress(tick - surface.bornTick) : null;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={`Show: ${surfaceTitle(surface, tick)}`}
      style={toneStyle(job.tone)}
      className={`inline-flex items-center gap-1 px-1.5 rounded text-[10px] font-medium border shrink-0 hover:brightness-125 ${blocks(surface.job) ? "animate-pulse" : ""}`}
    >
      <job.Icon className="w-2.5 h-2.5" />
      <span>{board ? `${board.done}/${board.total}` : job.chip}</span>
    </button>
  );
};

// ---------------------------------------------------------------------------------------------
// The mock shell: module bar, Projects panel, stage tab bar, pane, companion

const ModuleBar = ({ waitingOf, selectedId, onSelect }: { waitingOf: (id: string) => number; selectedId: string; onSelect: (id: string) => void }) => {
  const waitingTerminals = TERMS.filter((t) => waitingOf(t.id) > 0).length;
  const button = (label: string, icon: ReactNode, current = false, badge = 0) => (
    <div title={label} className={`relative w-12 h-12 grid place-items-center ${current ? "text-white" : "text-[#8b949e]"}`}>
      <span data-neon={current ? "module" : undefined}>{icon}</span>
      {badge > 0 && (
        <span className="absolute top-1 right-1 h-4 min-w-4 px-1 rounded-full text-[10px] font-bold grid place-items-center bg-[#d29922] text-[#0d1117]">{badge}</span>
      )}
    </div>
  );
  return (
    <nav className="shrink-0 w-12 h-full flex flex-col bg-[#161b22] shadow-[inset_-1px_0_0_#30363d] select-none">
      {button("Projects", <FolderGit2 size={22} />, true)}
      {TERMS.map((t) => (
        <button key={t.id} type="button" title={t.name} onClick={() => onSelect(t.id)} className="w-12 h-6 grid place-items-center hover:bg-[#21262d]">
          <span
            data-neon={t.id === selectedId ? "dot" : undefined}
            className={`w-2 h-2 rounded-full ${waitingOf(t.id) ? "bg-[#d29922] animate-pulse" : !t.agent ? "bg-[#484f58]" : t.id === "t3" ? "bg-[#3fb950]" : "bg-[#58a6ff]"}`}
          />
        </button>
      ))}
      {button("Source control", <GitBranch size={22} />)}
      {button("Agents: terminals waiting on you", <Bot size={22} />, false, waitingTerminals)}
      {button("Workflows", <Workflow size={22} />)}
      {button("Project", <Settings size={22} />)}
      <div className="flex-1" />
      <div className="h-7 grid place-items-center font-mono text-[10px] text-[#e3b341]">$4.12</div>
    </nav>
  );
};

const Row = ({
  term,
  index,
  active,
  mine,
  look,
  tick,
  onSelect,
  onReveal,
}: {
  term: Term;
  index: number;
  active: boolean;
  mine: Surface[];
  look: Look;
  tick: number;
  onSelect: () => void;
  onReveal: (surface: Surface) => void;
}) => {
  const waiting = mine.filter((s) => blocks(s.job));
  const plainStatus = !term.agent ? null : waiting.length ? (
    <span className="inline-flex items-center gap-1 px-1.5 rounded text-[10px] font-medium bg-[#d29922]/20 text-[#d29922] border border-[#d29922]/40 animate-pulse">
      <span className="text-xs leading-none">◆</span>
      <span>Waiting</span>
    </span>
  ) : term.id === "t3" ? (
    <span className="flex items-center gap-1 text-[10px] text-[#3fb950]">
      <span className="w-1.5 h-1.5 rounded-full bg-[#3fb950]" />
      <span>Ready</span>
    </span>
  ) : (
    <span className="flex items-center gap-1 text-[10px] text-[#58a6ff]">
      <Loader2 className="w-2.5 h-2.5 animate-spin shrink-0" />
      <span>Working...</span>
    </span>
  );
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      data-neon={active ? "row" : undefined}
      className={`relative group flex flex-col gap-1 px-2.5 py-1.5 text-xs rounded-md cursor-pointer transition-colors ${
        active ? "bg-[#21262d] text-white font-medium border" : "text-[#8b949e] hover:bg-[#161b22] hover:text-[#c9d1d9] border border-transparent"
      }`}
    >
      {look === "edge" && mine.length > 0 && (
        <span className={`absolute -left-px top-1 bottom-1 w-[3px] rounded-full ${waiting.length ? "bg-[#d29922] animate-pulse" : "bg-[#58a6ff]"}`} />
      )}
      <div className="flex items-center justify-between min-w-0">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className="font-mono text-[#484f58] w-3 shrink-0 text-right text-[11px]">{index}</span>
          <AgentIcon kind={term.kind} className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate font-medium text-xs text-[#c9d1d9] group-hover:text-white">{term.name}</span>
        </div>
        {look === "edge" && waiting.length > 0 && (
          <button
            type="button"
            title="Show what is waiting"
            onClick={(e) => {
              e.stopPropagation();
              onReveal(waiting[0]);
            }}
            className="shrink-0 h-4 min-w-4 px-1 rounded-full text-[10px] font-bold bg-[#d29922] text-[#0d1117]"
          >
            {waiting.length}
          </button>
        )}
      </div>
      <div className="pl-[18px] flex items-center gap-1.5 min-w-0 overflow-hidden">
        {look === "chip" && mine.length > 0 ? mine.map((s) => <SurfaceChip key={s.id} surface={s} tick={tick} onClick={() => onReveal(s)} />) : plainStatus}
        {term.model && (
          <span className="ml-auto px-1 rounded text-[9px] font-mono bg-[#388bfd]/15 text-[#79c0ff] border border-[#388bfd]/40 shrink-0">{term.model}</span>
        )}
      </div>
      {look === "preview" &&
        mine.map((s) => {
          const job = JOBS[s.job];
          return (
            <button
              key={s.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onReveal(s);
              }}
              className="ml-[18px] flex items-center gap-1.5 min-w-0 px-1.5 py-1 rounded border border-[#30363d] bg-[#0d1117] hover:bg-[#161b22] text-left"
            >
              <job.Icon className={`w-3 h-3 shrink-0 ${blocks(s.job) ? "animate-pulse" : ""}`} style={{ color: job.tone }} />
              <span className="truncate text-[11px] font-normal text-[#c9d1d9]">{surfaceTitle(s, tick)}</span>
            </button>
          );
        })}
    </div>
  );
};

const ProjectsPanel = ({ children }: { children: ReactNode }) => (
  <div className="shrink-0 w-[280px] h-full flex flex-col bg-[#0d1117] border-r border-[#30363d] select-none">
    <div className="h-12 px-4 border-b border-[#30363d] flex items-center gap-2 bg-[#161b22]">
      <Layers className="w-5 h-5 text-[#58a6ff]" />
      <span className="font-bold tracking-wide text-white text-sm">
        QUAY <span className="text-[10px] text-[#58a6ff] font-mono font-normal">mock</span>
      </span>
    </div>
    <div className="px-3 py-2 border-b border-[#30363d] bg-[#161b22]/50 text-[11px] font-semibold text-[#8b949e] uppercase tracking-wider">Projects</div>
    <div className="flex-1 overflow-y-auto p-2">
      <div className="rounded-md overflow-hidden bg-[#161b22]/30 border border-[#30363d]/40">
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs">
          <ChevronDown className="w-3.5 h-3.5 text-[#8b949e]" />
          <FolderGit2 className="w-3.5 h-3.5 text-[#58a6ff] shrink-0" />
          <span className="font-medium">Quay-2</span>
          <span className="ml-auto text-[10px] px-1.5 rounded-full bg-[#30363d] text-[#8b949e] font-mono">{TERMS.length}</span>
        </div>
        <div className="p-1 flex flex-col gap-0.5">{children}</div>
      </div>
    </div>
  </div>
);

const TabBar = ({
  selectedId,
  front,
  waitingOf,
  surfaceTabs,
  tick,
  onSelect,
  onFront,
}: {
  selectedId: string;
  front: string | null;
  waitingOf: (id: string) => number;
  surfaceTabs: Surface[];
  tick: number;
  onSelect: (id: string) => void;
  onFront: (surface: Surface) => void;
}) => (
  <div className="shrink-0 h-[34px] z-10 flex items-stretch bg-[#161b22] border-b border-[#30363d] text-xs select-none">
    <div className="min-w-0 flex items-stretch overflow-x-auto">
      {TERMS.map((term) => {
        const current = front === null && term.id === selectedId;
        return (
          <button
            key={term.id}
            type="button"
            onClick={() => onSelect(term.id)}
            className={`relative shrink-0 max-w-[12rem] px-3 flex items-center gap-1.5 border-r border-[#30363d] transition-colors ${
              current ? "bg-[#0d1117] text-white" : "text-[#8b949e] hover:text-[#c9d1d9] hover:bg-[#21262d]"
            }`}
          >
            {current && <span data-neon="edge" className="absolute left-0 right-0 bottom-0 h-[2px]" />}
            <span className="truncate">{term.name}</span>
            <span className="shrink-0 text-[10px] text-[#8b949e] font-mono">{term.kind}</span>
            {waitingOf(term.id) > 0 && <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-[#d29922] animate-pulse" title="A surface is waiting" />}
          </button>
        );
      })}
      {surfaceTabs.map((surface) => {
        const current = front === surface.id;
        const job = JOBS[surface.job];
        return (
          <button
            key={surface.id}
            type="button"
            onClick={() => onFront(surface)}
            className={`relative shrink-0 max-w-[15rem] px-3 flex items-center gap-1.5 border-r border-[#30363d] transition-colors ${
              current ? "bg-[#0d1117] text-white" : "text-[#8b949e] hover:text-[#c9d1d9] hover:bg-[#21262d]"
            }`}
          >
            {current && <span data-neon="edge" className="absolute left-0 right-0 bottom-0 h-[2px]" />}
            <job.Icon className={`w-3.5 h-3.5 shrink-0 ${blocks(surface.job) && !current ? "animate-pulse" : ""}`} style={{ color: job.tone }} />
            <span className="truncate">{surfaceTitle(surface, tick)}</span>
            <span className="shrink-0 text-[10px] text-[#8b949e] font-mono">{termOf(surface.terminalId).name}</span>
          </button>
        );
      })}
    </div>
    <div className="shrink-0 w-[34px] grid place-items-center text-[#58a6ff]">
      <Plus className="w-4 h-4" />
    </div>
    <div className="flex-1" />
    <div className="shrink-0 flex items-center gap-1.5 px-2 text-[#8b949e]">
      <div className="flex items-center bg-[#0d1117] border border-[#30363d] rounded p-0.5 gap-0.5">
        <span className="w-6 h-6 grid place-items-center rounded bg-[#21262d] text-[#58a6ff]">
          <Square className="w-3.5 h-3.5" />
        </span>
        {[Columns2, Rows2, Grid2x2].map((Icon, i) => (
          <span key={i} className="w-6 h-6 grid place-items-center">
            <Icon className="w-3.5 h-3.5" />
          </span>
        ))}
      </div>
      <Maximize2 className="w-3.5 h-3.5 mx-1" />
    </div>
  </div>
);

const Pane = ({ term, log, waiting, children }: { term: Term; log: string[]; waiting: boolean; children?: ReactNode }) => (
  <div className="absolute inset-1.5 flex flex-col rounded-md border border-[#30363d] overflow-hidden bg-[#0d1117]">
    <div className="h-7 px-2.5 border-b border-[#30363d]/60 flex items-center gap-2 text-xs shrink-0 bg-[#161b22]">
      <AgentIcon kind={term.kind} className="w-3.5 h-3.5 shrink-0" />
      <span data-neon="title" className="font-medium truncate max-w-[140px]">
        {term.name}
      </span>
      {term.agent &&
        (waiting ? (
          <span className="flex items-center gap-1 text-[10px] text-[#d29922] font-semibold animate-pulse">
            <span className="w-1.5 h-1.5 rounded-full bg-[#d29922]" />
            Waiting for decision
          </span>
        ) : (
          <span className="flex items-center gap-1 text-[10px] text-[#58a6ff]">
            <Loader2 className="w-2.5 h-2.5 animate-spin" />
            Working
          </span>
        ))}
    </div>
    <div className="flex-1 min-h-0 relative overflow-hidden">
      <div className="absolute inset-0 p-3 flex flex-col justify-end font-mono text-[12px] leading-5 whitespace-pre overflow-hidden">
        {[...term.lines, ...log].map((line, i) => (
          <div key={i} className={line.includes("operator:") ? "text-[#3fb950]" : line.startsWith("  ") ? "text-[#6e7681]" : "text-[#c9d1d9]"}>
            {line}
          </div>
        ))}
        <div className="text-[#c9d1d9]">
          {waiting ? "" : "▌"}
          &nbsp;
        </div>
      </div>
      {children}
    </div>
  </div>
);

// ---------------------------------------------------------------------------------------------
// Placement B: in the terminal's own pane

const OverTerminal = ({
  mine,
  tick,
  quiet,
  revealed,
  onAction,
}: {
  mine: Surface[];
  tick: number;
  /** Variant D: an arrival stays folded until the operator opens it. */
  quiet: boolean;
  /** The surface the operator last asked to see. */
  revealed: { id: string; seq: number } | null;
  onAction: (surface: Surface, text: string) => void;
}) => {
  const boards = mine.filter((s) => !blocks(s.job));
  const waiting = mine.filter((s) => blocks(s.job));
  const revealedAt = waiting.findIndex((s) => s.id === revealed?.id);
  const [openBoard, setOpenBoard] = useState<string | null>(null);
  const [folded, setFolded] = useState(quiet && revealedAt < 0);
  const [at, setAt] = useState(Math.max(0, revealedAt));
  // A new arrival unfolds the card and comes to the front, except in the quiet variant.
  useEffect(() => {
    if (quiet) return;
    setFolded(false);
    setAt(Math.max(0, waiting.length - 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting.length]);
  // Asked for from a toast, a row or a tab: unfold on that surface.
  useEffect(() => {
    if (revealedAt < 0) return;
    setFolded(false);
    setAt(revealedAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealed?.seq]);
  const shown = waiting[Math.min(at, waiting.length - 1)];
  return (
    <>
      {boards.map((board, i) => {
        const { done, total } = boardProgress(tick - board.bornTick);
        const open = openBoard === board.id;
        return (
          <div key={board.id} style={{ top: i * 28 }} className="absolute left-0 right-0 z-10">
            <button
              type="button"
              onClick={() => setOpenBoard(open ? null : board.id)}
              className="w-full h-7 px-2.5 flex items-center gap-2 bg-[#161b22]/95 border-b border-[#30363d] text-xs text-[#c9d1d9] hover:bg-[#21262d]"
            >
              <JOBS.status.Icon className="w-3.5 h-3.5 text-[#58a6ff]" />
              <span className="truncate">{surfaceTitle(board, tick)}</span>
              <span className="flex-1 max-w-48 h-1 rounded-full bg-[#21262d] overflow-hidden">
                <span className="block h-full bg-[#58a6ff] transition-all duration-700" style={{ width: `${(done / total) * 100}%` }} />
              </span>
              <span className="ml-auto">{open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}</span>
            </button>
            {open && (
              <div className="absolute top-8 right-2 w-[440px] max-w-[calc(100%-16px)]">
                <Frame surface={board} tick={tick} onAction={(text) => onAction(board, text)} />
              </div>
            )}
          </div>
        );
      })}
      {shown && folded && (
        <button
          type="button"
          onClick={() => setFolded(false)}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 h-7 px-3 rounded-full border border-[#d29922]/60 bg-[#161b22] text-xs text-[#d29922] shadow-xl animate-pulse"
        >
          ◆ {waiting.length} waiting on you · Show
        </button>
      )}
      {shown && !folded && (
        <div
          className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20"
          style={{ width: `min(${shown.job === "review" ? 780 : 520}px, calc(100% - 24px))` }}
        >
          <Frame
            surface={shown}
            tick={tick}
            onAction={(text) => onAction(shown, text)}
            bodyClass="max-h-[58vh] overflow-y-auto"
            extra={
              <span className="shrink-0 flex items-center gap-1 text-[10px] text-[#8b949e]">
                {waiting.length > 1 && (
                  <>
                    <button type="button" onClick={() => setAt((at - 1 + waiting.length) % waiting.length)} className="p-0.5 rounded hover:bg-[#30363d]">
                      <ChevronLeft className="w-3 h-3" />
                    </button>
                    {Math.min(at, waiting.length - 1) + 1}/{waiting.length}
                    <button type="button" onClick={() => setAt((at + 1) % waiting.length)} className="p-0.5 rounded hover:bg-[#30363d]">
                      <ChevronRight className="w-3 h-3" />
                    </button>
                  </>
                )}
                <button type="button" title="Fold, to read the terminal" onClick={() => setFolded(true)} className="p-0.5 rounded hover:bg-[#30363d]">
                  <Minus className="w-3 h-3" />
                </button>
              </span>
            }
          />
        </div>
      )}
    </>
  );
};

// ---------------------------------------------------------------------------------------------
// Placement A's home: the companion

const CompanionMock = ({
  width,
  term,
  mine,
  elsewhere,
  surfacesView,
  view,
  tick,
  onView,
  onAction,
  onReveal,
}: {
  width: number;
  term: Term;
  mine: Surface[];
  elsewhere: Surface[];
  surfacesView: boolean;
  view: string;
  tick: number;
  onView: (view: string) => void;
  onAction: (surface: Surface, text: string) => void;
  onReveal: (surface: Surface) => void;
}) => {
  const views = [
    ...(surfacesView && mine.length ? [{ id: "surface", label: mine.length > 1 ? `Surfaces ${mine.length}` : "Surface" }] : []),
    { id: "pull-request", label: "Pull request" },
    { id: "activity", label: "Activity" },
    { id: "repository", label: "Repository" },
  ];
  const shown = views.some((v) => v.id === view) ? view : "pull-request";
  // Waiting surfaces first, boards under them.
  const ordered = [...mine].sort((a, b) => Number(blocks(b.job)) - Number(blocks(a.job)));
  return (
    <aside style={{ width }} className="relative shrink-0 h-full min-h-0 flex flex-col bg-[#0d1117] border-l border-[#30363d]">
      <header className="shrink-0 flex flex-col border-b border-[#30363d] bg-[#161b22]">
        <div className="h-12 px-3 flex items-stretch gap-1">
          {views.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => onView(v.id)}
              data-neon={v.id === shown ? "underline" : undefined}
              className={`shrink-0 px-2.5 text-xs border-b-2 transition-colors ${v.id === shown ? "text-white" : "border-transparent text-[#8b949e] hover:text-white"} ${
                v.id === "surface" && shown !== "surface" ? "text-[#d29922]! animate-pulse" : ""
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <div className="h-7 px-3 flex items-center gap-2 text-[11px] text-[#8b949e] border-t border-[#30363d]/60">
          <AgentIcon kind={term.kind} className="w-3 h-3" />
          <span className="text-[#c9d1d9]">{term.name}</span>
          <span className="truncate">#75 Pair answers with turns · PR #142</span>
        </div>
      </header>
      <section className="flex-1 min-h-0 overflow-y-auto">
        {shown === "surface" &&
          ordered.map((s) => (
            <div key={s.id} className="border-b border-[#30363d]">
              <Frame surface={s} tick={tick} card={false} onAction={(text) => onAction(s, text)} />
            </div>
          ))}
        {shown === "pull-request" && (
          <div className="p-3 text-xs">
            <div className="text-white font-medium">Pair each answer with the turn it belongs to</div>
            <div className="mt-0.5 text-[#8b949e]">#142 · fix/75-pair-answers-with-turns → master</div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {[
                ["Checks", "12 of 12 passed", "#3fb950"],
                ["Review", "1 approval", "#3fb950"],
                ["Conflicts", "None", "#3fb950"],
                ["Behind master", "14 commits", "#d29922"],
              ].map(([label, value, tone]) => (
                <div key={label} className="px-2.5 py-2 rounded-md border border-[#30363d] bg-[#161b22]">
                  <div className="text-[10px] text-[#8b949e]">{label}</div>
                  <div style={{ color: tone }}>{value}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        {shown === "activity" && (
          <div className="p-3 flex flex-col gap-1.5 text-[11px] font-mono text-[#8b949e]">
            {term.lines.filter((l) => !l.startsWith("  ")).map((l) => (
              <div key={l} className="px-2 py-1 rounded border border-[#30363d] bg-[#161b22] truncate">
                {l}
              </div>
            ))}
          </div>
        )}
        {shown === "repository" && <p className="p-3 text-xs text-[#8b949e]">C:\repos\Quay-2 · 3 changed files · 14 behind master</p>}
      </section>
      {elsewhere.slice(0, 3).map((s) => {
        const from = termOf(s.terminalId);
        return (
          <div key={s.id} className="shrink-0 m-2 mt-0 first-of-type:mt-2 rounded-md border border-[#d29922]/50 bg-[#d29922]/10 px-3 py-2 text-xs flex items-center gap-2">
            <AgentIcon kind={from.kind} className="w-3.5 h-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-[#c9d1d9]">
              <span className="text-[#e3b341]">{from.name}</span> · {surfaceTitle(s, tick)}
            </span>
            <button type="button" onClick={() => onReveal(s)} className="shrink-0 h-6 px-2 rounded border border-[#30363d] bg-[#21262d] text-[#c9d1d9] hover:bg-[#30363d]">
              Show
            </button>
          </div>
        );
      })}
    </aside>
  );
};

// ---------------------------------------------------------------------------------------------
// Placement D's arrival: a toast over the stage

const TOAST_QUICK: Partial<Record<Job, [string, string][]>> = {
  question: [
    ["Rebase", 'answer {base:"rebase"} (from the toast)'],
    ["Merge", 'answer {base:"merge"} (from the toast)'],
    ["Leave it", 'answer {base:"leave"} (from the toast)'],
  ],
  quay: [
    ["Allow once", "permission allowed once (from the toast)"],
    ["Deny", "permission denied (from the toast)"],
  ],
};

const Toast = ({
  surface,
  tick,
  onAction,
  onOpen,
  onDismiss,
}: {
  surface: Surface;
  tick: number;
  onAction: (text: string) => void;
  onOpen: () => void;
  onDismiss: () => void;
}) => {
  const job = JOBS[surface.job];
  const term = termOf(surface.terminalId);
  // A board's toast leaves by itself; one that holds an agent up stays until it is dealt with.
  useEffect(() => {
    if (blocks(surface.job)) return;
    const timer = window.setTimeout(onDismiss, 7000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surface.id]);
  return (
    <div className="rounded-md border bg-[#161b22] shadow-2xl shadow-black/60 px-3 py-2.5 text-xs" style={{ borderColor: `${job.tone}99` }}>
      <div className="flex items-center gap-1.5 text-[10px] text-[#8b949e]">
        <AgentIcon kind={term.kind} className="w-3 h-3" />
        <span className="text-[#c9d1d9]">{term.name}</span>
        <span style={{ color: job.tone }}>{job.label}</span>
        <button type="button" onClick={onDismiss} title="Dismiss the toast; the surface stays" className="ml-auto p-0.5 rounded hover:bg-[#30363d]">
          <X className="w-3 h-3" />
        </button>
      </div>
      <div className="mt-1 text-white">{surfaceTitle(surface, tick)}</div>
      {surface.job === "review" && <div className="mt-0.5 text-[#8b949e]">5 steps · 2 things to know</div>}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {TOAST_QUICK[surface.job]?.map(([label, text]) => (
          <button key={label} type="button" onClick={() => onAction(text)} className="h-6 px-2 rounded border border-[#30363d] bg-[#21262d] text-[#c9d1d9] hover:bg-[#30363d]">
            {label}
          </button>
        ))}
        <button type="button" onClick={onOpen} className="h-6 px-2 rounded bg-[#1f6feb] text-white hover:bg-[#388bfd] ml-auto">
          Open
        </button>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------------------------
// The prototype

const Seg = <T extends string>({ options, value, onChange }: { options: readonly (readonly [T, string])[]; value: T; onChange: (value: T) => void }) => (
  <span className="inline-flex rounded-md border border-black/30 overflow-hidden">
    {options.map(([key, label]) => (
      <button
        key={key}
        type="button"
        onClick={() => onChange(key)}
        className={`px-2 py-0.5 border-r border-black/20 last:border-r-0 ${value === key ? "bg-black text-white" : "hover:bg-black/10"}`}
      >
        {label}
      </button>
    ))}
  </span>
);

export function PlacementPrototype() {
  const [variant, setVariant] = useState<VariantKey>(() => readParam("variant", ["A", "B", "C", "D"] as const, "A"));
  const [home, setHome] = useState<Place>(() => readParam("home", ["A", "B", "C"] as const, "B"));
  const [look, setLook] = useState<Look>(() => readParam("row", LOOKS, "chip"));
  const [scene, setScene] = useState(() => readParam("scene", SCENES.map((s) => s.key), "1"));
  const [wide, setWide] = useState(false);
  const [from, setFrom] = useState<"selected" | "other">("selected");
  const [selectedId, setSelectedId] = useState("t1");
  const [surfaces, setSurfaces] = useState<Surface[]>([]);
  const [front, setFront] = useState<string | null>(null);
  const [view, setView] = useState("pull-request");
  const [toasts, setToasts] = useState<string[]>([]);
  const [logs, setLogs] = useState<Record<string, string[]>>({});
  const [tick, setTick] = useState(0);
  const [last, setLast] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<{ id: string; seq: number } | null>(null);

  const place: Place = variant === "D" ? home : variant;
  // What a delivery reads when it lands from a timer.
  const live = useRef({ variant, place, selectedId, tick });
  live.current = { variant, place, selectedId, tick };
  const seq = useRef(0);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const timer = window.setInterval(() => setTick((t) => t + 1), 1200);
    return () => window.clearInterval(timer);
  }, []);

  const say = (terminalId: string, line: string) => setLogs((l) => ({ ...l, [terminalId]: [...(l[terminalId] ?? []), line] }));

  /** An agent hands Quay a surface. */
  const deliver = (job: Job, terminalId: string) => {
    const now = live.current;
    const surface: Surface = { id: `${job}-${++seq.current}`, terminalId, job, bornTick: now.tick };
    setSurfaces((list) => [...list, surface]);
    say(
      terminalId,
      job === "quay"
        ? "● Bash(git push --force-with-lease origin fix/75-…)   held by Quay"
        : `● quay.show_surface(${JOBS[job].label.toLowerCase()})   ${blocks(job) ? "waiting for the operator" : "live"}`,
    );
    // Variant D announces and moves nothing; the others bring the surface into view.
    if (now.variant === "D") setToasts((t) => [...t, surface.id]);
    else if (now.place === "A" && terminalId === now.selectedId) setView("surface");
  };

  /** The operator acts on a surface; the action goes back to its agent and the surface goes. */
  const act = (surface: Surface, text: string) => {
    setSurfaces((list) => list.filter((s) => s.id !== surface.id));
    setToasts((t) => t.filter((id) => id !== surface.id));
    setFront((f) => (f === surface.id ? null : f));
    say(surface.terminalId, `  ⎿ operator: ${text}`);
    setLast(`${termOf(surface.terminalId).name} ← ${text}`);
  };

  const play = (key: string) => {
    timers.current.forEach((t) => window.clearTimeout(t));
    setSurfaces([]);
    setToasts([]);
    setFront(null);
    setLogs({});
    setSelectedId("t1");
    live.current = { ...live.current, selectedId: "t1" };
    setView("pull-request");
    setLast(null);
    const sends = SCENES.find((s) => s.key === key)?.sends ?? [];
    timers.current = sends.map(([job, terminalId], i) => window.setTimeout(() => deliver(job, terminalId), 700 + i * 1700));
  };

  // The scene plays again on every switch of variant or toast target, since how a surface arrives
  // is part of what each one is.
  useEffect(() => {
    play(scene);
    return () => timers.current.forEach((t) => window.clearTimeout(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant, home, scene]);

  const pickVariant = (key: VariantKey) => {
    writeParam("variant", key);
    setVariant(key);
  };
  const step = (by: number) => {
    const i = VARIANTS.findIndex((v) => v.key === variant);
    pickVariant(VARIANTS[(i + by + VARIANTS.length) % VARIANTS.length].key);
  };
  const pickScene = (key: string) => {
    writeParam("scene", key);
    if (key === scene) play(key);
    else setScene(key);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, [contenteditable]")) return;
      if (e.key === "ArrowLeft") step(-1);
      if (e.key === "ArrowRight") step(1);
      if (SCENES.some((s) => s.key === e.key)) pickScene(e.key);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const of = (terminalId: string) => surfaces.filter((s) => s.terminalId === terminalId);
  const waitingOf = (terminalId: string) => of(terminalId).filter((s) => blocks(s.job)).length;
  const selected = termOf(selectedId);
  const mine = of(selectedId);
  const frontSurface = place === "C" ? (surfaces.find((s) => s.id === front) ?? null) : null;

  const selectTerminal = (id: string) => {
    setSelectedId(id);
    setFront(null);
    if (variant !== "D" && place === "A" && of(id).length) setView("surface");
  };
  /** Takes the operator to a surface, wherever this variant keeps it. */
  const reveal = (surface: Surface) => {
    setSelectedId(surface.terminalId);
    setToasts((t) => t.filter((id) => id !== surface.id));
    if (place === "A") setView("surface");
    setFront(place === "C" ? surface.id : null);
    setRevealed((r) => ({ id: surface.id, seq: (r?.seq ?? 0) + 1 }));
  };
  const add = (job: Job) => {
    const others = TERMS.filter((t) => t.agent && t.id !== selectedId);
    deliver(job, from === "selected" ? selectedId : others[seq.current % others.length].id);
  };

  const current = VARIANTS.find((v) => v.key === variant)!;
  const waitingCount = surfaces.filter((s) => blocks(s.job)).length;
  const accent = { "--quay-accent": "#7df9ff", "--quay-accent-line": "#7df9ff8c", "--quay-accent-haze": "#7df9ff38" } as CSSProperties;

  return (
    <div style={accent} className="h-screen w-screen flex flex-col overflow-hidden bg-[#0d1117] text-[#c9d1d9]">
      <div className="flex-1 min-h-0 flex">
        <ModuleBar waitingOf={waitingOf} selectedId={selectedId} onSelect={selectTerminal} />
        <ProjectsPanel>
          {TERMS.map((term, i) => (
            <Row
              key={term.id}
              term={term}
              index={i + 1}
              active={term.id === selectedId}
              mine={of(term.id)}
              look={look}
              tick={tick}
              onSelect={() => selectTerminal(term.id)}
              onReveal={reveal}
            />
          ))}
        </ProjectsPanel>

        <main className="relative flex-1 min-w-0 h-full flex flex-col bg-[#0d1117]">
          <TabBar
            selectedId={selectedId}
            front={frontSurface?.id ?? null}
            waitingOf={waitingOf}
            surfaceTabs={place === "C" ? surfaces : []}
            tick={tick}
            onSelect={selectTerminal}
            onFront={reveal}
          />
          <div className="flex-1 min-h-0 relative">
            {frontSurface ? (
              <div className="absolute inset-0 overflow-y-auto">
                <div className="max-w-3xl mx-auto p-6">
                  <Frame
                    surface={frontSurface}
                    tick={tick}
                    onAction={(text) => act(frontSurface, text)}
                    extra={
                      <button type="button" onClick={() => selectTerminal(frontSurface.terminalId)} className="shrink-0 h-6 px-2 rounded border border-[#30363d] bg-[#21262d] text-[11px] text-[#c9d1d9] hover:bg-[#30363d]">
                        Show terminal
                      </button>
                    }
                  />
                </div>
              </div>
            ) : (
              <Pane term={selected} log={logs[selectedId] ?? []} waiting={waitingOf(selectedId) > 0}>
                {place === "B" && <OverTerminal key={selectedId} mine={mine} tick={tick} quiet={variant === "D"} revealed={revealed} onAction={act} />}
              </Pane>
            )}
            {variant === "D" && (
              <div className="absolute right-3 top-3 z-40 w-80 flex flex-col gap-2">
                {surfaces
                  .filter((s) => toasts.includes(s.id))
                  .map((s) => (
                    <Toast
                      key={s.id}
                      surface={s}
                      tick={tick}
                      onAction={(text) => act(s, text)}
                      onOpen={() => reveal(s)}
                      onDismiss={() => setToasts((t) => t.filter((id) => id !== s.id))}
                    />
                  ))}
              </div>
            )}
          </div>
        </main>

        <CompanionMock
          width={wide ? 560 : 340}
          term={selected}
          mine={mine}
          elsewhere={variant === "A" ? surfaces.filter((s) => s.terminalId !== selectedId && blocks(s.job)) : []}
          surfacesView={place === "A"}
          view={view}
          tick={tick}
          onView={setView}
          onAction={act}
          onReveal={reveal}
        />
      </div>

      {/* The prototype's own controls: not part of any design. */}
      <div className="shrink-0 border-t-2 border-black bg-[#f0f6fc] text-black px-3 py-1.5 flex flex-col gap-1.5 text-[11px] select-none">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="inline-flex items-center gap-1 rounded-full bg-black text-white pl-1 pr-1 py-0.5">
            <button type="button" onClick={() => step(-1)} className="p-0.5 rounded-full hover:bg-white/20">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="font-semibold px-1 text-xs">
              {current.key} ({current.name})
            </span>
            <button type="button" onClick={() => step(1)} className="p-0.5 rounded-full hover:bg-white/20">
              <ChevronRight className="w-4 h-4" />
            </button>
          </span>
          <span className="min-w-0 flex-1 truncate text-black/70" title={current.note}>
            {current.note}
          </span>
          {variant === "D" && (
            <span className="flex items-center gap-1.5">
              Open goes to
              <Seg
                options={[["A", "Companion"], ["B", "Over terminal"], ["C", "Stage tab"]] as const}
                value={home}
                onChange={(v) => {
                  writeParam("home", v);
                  setHome(v);
                }}
              />
            </span>
          )}
          <span className="flex items-center gap-1.5">
            Row shows
            <Seg
              options={[["chip", "Chips"], ["preview", "Title line"], ["edge", "Edge + count"]] as const}
              value={look}
              onChange={(v) => {
                writeParam("row", v);
                setLook(v);
              }}
            />
          </span>
          <span className="flex items-center gap-1.5">
            Companion
            <Seg options={[["340", "340"], ["560", "560"]] as const} value={wide ? "560" : "340"} onChange={(v) => setWide(v === "560")} />
          </span>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="flex items-center gap-1.5">
            Scene
            <Seg options={SCENES.map((s) => [s.key, `${s.key} ${s.name}`] as const)} value={scene} onChange={pickScene} />
          </span>
          <span className="flex items-center gap-1.5">
            Add
            {(Object.keys(JOBS) as Job[]).map((job) => (
              <button key={job} type="button" onClick={() => add(job)} className="px-2 py-0.5 rounded-md border border-black/30 hover:bg-black/10">
                + {JOBS[job].label}
              </button>
            ))}
            from
            <Seg options={[["selected", "selected"], ["other", "another terminal"]] as const} value={from} onChange={setFrom} />
          </span>
          <span className="ml-auto truncate text-black/70">
            {waitingCount} waiting · {surfaces.length - waitingCount} live{last ? ` · returned: ${last}` : ""}
          </span>
        </div>
      </div>
    </div>
  );
}
