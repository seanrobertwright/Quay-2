// PROTOTYPE (#226) — throwaway. The Praxis Builder modal as decided in #221 (near
// full-bleed, left list of definitions by kind). Only the graph entry is live; the
// variants render into the work area.
import { useState, type FC, type ReactNode } from "react";
import { Braces, FileText, KeyRound, RotateCcw, Timer, Workflow, X } from "lucide-react";
import type { PGraph } from "./model";

const DEFINITIONS = [
  { kind: "Graphs", icon: Workflow, items: ["ship-feature", "nightly-triage", "release-train"] },
  { kind: "Contracts", icon: FileText, items: ["ship-it"] },
  { kind: "Grants", icon: KeyRound, items: ["ci-budget"] },
  { kind: "Triggers", icon: Timer, items: ["on-ready-label"] },
];

export const Shell: FC<{ graph: PGraph; dirty: boolean; onReset: () => void; children: ReactNode }> = ({ graph, dirty, onReset, children }) => {
  const [showJson, setShowJson] = useState(false);
  return (
    <div className="fixed inset-0 bg-[#010409] flex items-center justify-center">
      <div className="flex flex-col w-[98vw] h-[96vh] bg-[#0d1117] border border-[#30363d] rounded-xl shadow-2xl overflow-hidden text-[#c9d1d9]">
        <header className="h-12 px-4 border-b border-[#30363d] bg-[#161b22] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-[#58a6ff]/15 border border-[#58a6ff]/30 flex items-center justify-center">
              <Workflow className="w-4 h-4 text-[#58a6ff]" />
            </div>
            <h1 className="text-sm font-semibold text-white">Praxis Builder</h1>
            <span className="text-xs text-[#8b949e] font-mono">.praxis/graph/{graph.id}.json</span>
            {dirty && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-[#e3b341]/15 border border-[#e3b341]/30 text-[#e3b341]">unsaved draft</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-pressed={showJson}
              onClick={() => setShowJson((s) => !s)}
              className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs ${showJson ? "border-[#58a6ff] text-white bg-[#1f6feb]/20" : "border-[#30363d] text-[#8b949e] hover:text-white"}`}
            >
              <Braces className="w-3.5 h-3.5" /> Graph JSON
            </button>
            <button type="button" onClick={onReset} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-[#30363d] text-xs text-[#8b949e] hover:text-white">
              <RotateCcw className="w-3.5 h-3.5" /> Reset sample
            </button>
            <button type="button" aria-label="Close builder (prototype: does nothing)" className="p-1.5 rounded-md text-[#8b949e] hover:bg-[#21262d] hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>
        <div className="flex-1 flex min-h-0">
          <nav aria-label="Definitions" className="w-48 shrink-0 border-r border-[#30363d] bg-[#0d1117] overflow-y-auto py-2">
            {DEFINITIONS.map((d) => (
              <div key={d.kind} className="mb-3">
                <div className="px-3 py-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#6e7681]">
                  <d.icon className="w-3 h-3" /> {d.kind}
                </div>
                {d.items.map((item) => {
                  const live = item === graph.id;
                  return (
                    <div
                      key={item}
                      aria-current={live ? "page" : undefined}
                      className={`mx-1.5 px-2 py-1 rounded-md text-xs font-mono truncate ${live ? "bg-[#1f6feb]/20 text-white" : "text-[#6e7681]"}`}
                      title={live ? undefined : "Not wired in the prototype"}
                    >
                      {item}
                    </div>
                  );
                })}
              </div>
            ))}
          </nav>
          <main className="flex-1 min-w-0 relative">{children}</main>
          {showJson && (
            <aside aria-label="Graph JSON" className="w-80 shrink-0 border-l border-[#30363d] bg-[#010409] overflow-auto">
              <pre className="p-3 text-[10px] leading-snug font-mono text-[#8b949e] select-text">{JSON.stringify(graph, null, 2)}</pre>
            </aside>
          )}
        </div>
      </div>
    </div>
  );
};
