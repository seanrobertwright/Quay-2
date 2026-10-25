// PROTOTYPE (#226) — throwaway. Floating bar that flips ?variant= between designs.
import { useEffect, type FC } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export interface VariantInfo {
  key: string;
  name: string;
}

export const Switcher: FC<{ variants: VariantInfo[]; current: string; onChange: (key: string) => void }> = ({ variants, current, onChange }) => {
  const i = Math.max(0, variants.findIndex((v) => v.key === current));
  const go = (d: number) => onChange(variants[(i + d + variants.length) % variants.length].key);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.closest("input, textarea, select, [contenteditable], .react-flow__node") || e.altKey || e.ctrlKey || e.metaKey)) return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!import.meta.env.DEV) return null;
  const v = variants[i];
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-1 px-1.5 py-1 rounded-full bg-[#f0f6fc] text-[#0d1117] shadow-[0_8px_30px_rgba(0,0,0,0.6)] ring-2 ring-[#d2a8ff]">
      <button type="button" aria-label="Previous variant" onClick={() => go(-1)} className="p-1 rounded-full hover:bg-black/10">
        <ChevronLeft className="w-4 h-4" />
      </button>
      <span className="px-2 text-xs font-semibold whitespace-nowrap" aria-live="polite">
        {v.key} — {v.name}
      </span>
      <button type="button" aria-label="Next variant" onClick={() => go(1)} className="p-1 rounded-full hover:bg-black/10">
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
};
