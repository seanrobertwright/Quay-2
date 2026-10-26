// PROTOTYPE (#285) — throwaway. Three variants of the custom Open Project
// dialog, switchable via ?variant=A|B|C, over a mock Quay shell. Runs in a plain
// browser with `pnpm proto:open-project`; no Tauri backend is involved.
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, FolderPlus } from "lucide-react";
import { VARIANTS } from "./variants";

function readVariant() {
  const v = new URLSearchParams(location.search).get("variant") ?? "A";
  return VARIANTS.some((x) => x.key === v) ? v : "A";
}

export function OpenProjectPrototype() {
  const [variant, setVariant] = useState(readVariant);
  const [open, setOpen] = useState(true);
  const [opened, setOpened] = useState<string[]>([]);

  const switchTo = (key: string) => {
    const url = new URL(location.href);
    url.searchParams.set("variant", key);
    history.replaceState(null, "", url);
    setVariant(key);
    setOpen(true);
  };
  const step = (d: number) => {
    const i = VARIANTS.findIndex((x) => x.key === variant);
    switchTo(VARIANTS[(i + d + VARIANTS.length) % VARIANTS.length].key);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, [contenteditable]")) return;
      if (e.key === "ArrowLeft") step(-1);
      if (e.key === "ArrowRight") step(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const current = VARIANTS.find((x) => x.key === variant)!;
  const Variant = current.C;

  return (
    <div className="h-screen flex bg-[#0d1117] text-[#c9d1d9]">
      {/* mock rail */}
      <aside className="w-56 border-r border-[#30363d] bg-[#161b22] p-3 flex flex-col gap-1 text-sm">
        <div className="text-[11px] uppercase text-[#6e7681] mb-1">Projects</div>
        {["Quay-2", "AI-WS-SDK", ...opened.map((p) => p.split("\\").pop()!)].map((n) => (
          <div key={n} className="px-2 py-1 rounded hover:bg-[#21262d]">{n}</div>
        ))}
        <button onClick={() => setOpen(true)} className="mt-2 px-2 py-1 rounded border border-[#30363d] flex items-center gap-2 hover:bg-[#21262d]">
          <FolderPlus className="w-4 h-4" /> Add project
        </button>
      </aside>
      {/* mock stage */}
      <main className="flex-1 p-6 font-mono text-xs text-[#6e7681] leading-relaxed">
        <div>PS C:\repos\Quay-2&gt; claude</div>
        <div>✻ Welcome to Claude Code</div>
        <div className="mt-6 font-sans text-sm text-[#8b949e] max-w-md">
          Prototype state — last opened: <span className="font-mono text-white">{opened[opened.length - 1] ?? "nothing yet"}</span>
          <br />Fake filesystem: C:\repos, C:\Users\swright, E:\Projects. Quay-2 and AI-WS-SDK count as "already added".
        </div>
      </main>

      {open && <Variant onClose={() => setOpen(false)} onOpen={(p) => { setOpened((o) => [...o, p]); setOpen(false); }} />}

      {/* floating switcher — prototype only */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-2 px-2 py-1.5 rounded-full bg-[#f0f6fc] text-black shadow-xl text-sm">
        <button onClick={() => step(-1)} className="p-1 rounded-full hover:bg-black/10"><ChevronLeft className="w-4 h-4" /></button>
        <span className="font-medium px-1">{current.key} ({current.name})</span>
        <button onClick={() => step(1)} className="p-1 rounded-full hover:bg-black/10"><ChevronRight className="w-4 h-4" /></button>
        {!open && <button onClick={() => setOpen(true)} className="ml-1 px-2 py-0.5 rounded-full bg-black text-white text-xs">reopen</button>}
      </div>
    </div>
  );
}
