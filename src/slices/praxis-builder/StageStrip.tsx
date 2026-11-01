// The coding profile's fixed stages, read-only (#224). The template form draws them for a
// template, where a stage scrolls to its fields when chosen. A run's detail (#453) draws the same
// strip live: the stage the run is at lit, the stages it finished checked, its correction rounds
// counted, and where a held run stopped. Each mark is in words as well as colour. Nothing here
// can be dragged, connected or exported.
import type { FC } from "react";
import { Check, CircleDot, Pause, Repeat, UserCheck, type LucideIcon } from "lucide-react";
import type { JsonObject } from "./model.ts";
import { templateStages, type StageKey } from "./template.ts";

/** Where a run is on the strip. */
export interface StageProgress {
  /** The run's name, for the strip's label. */
  runId: string;
  /** The stage the run is at, or stopped at when held; null once it ended. */
  current: StageKey | null;
  finished: readonly StageKey[];
  /** True when the run is held at `current`. */
  held: boolean;
  /** The correction rounds the run started; null when unknown. */
  corrections: number | null;
}

interface StageStripProps {
  content: JsonObject;
  /** For a template: the id of a stage's fields, which choosing the stage scrolls to. */
  anchor?: (key: StageKey) => string;
  /** For a run: where it is. The stages are then marks, not buttons. */
  progress?: StageProgress;
}

type Mark = "held" | "current" | "finished";

const PLAIN_TONE = "border-[#30363d] bg-[#161b22] text-[#c9d1d9]";
const MUTED_TONE = "border-dashed border-[#30363d] text-[#6e7681]";

/** How the strip draws a stage a run marks: its box, the mark's colour, icon and word. */
const MARKS: Readonly<Record<Mark, { tone: string; text: string; Icon: LucideIcon; word: string }>> = {
  held: { tone: "border-[#f0883e] bg-[#161b22] text-[#c9d1d9]", text: "text-[#f0883e]", Icon: Pause, word: "Held here" },
  current: { tone: "border-[#58a6ff] bg-[#0d2240] text-white", text: "text-[#58a6ff]", Icon: CircleDot, word: "Current" },
  finished: { tone: PLAIN_TONE, text: "text-[#3fb950]", Icon: Check, word: "Finished" },
};

/** The run's mark on stage `key`, or null when the run hasn't reached it. */
function markOf(progress: StageProgress | undefined, key: StageKey): Mark | null {
  if (!progress) return null;
  if (progress.current === key) return progress.held ? "held" : "current";
  return progress.finished.includes(key) ? "finished" : null;
}

const rounds = (n: number) => `${n} correction round${n === 1 ? "" : "s"}`;

export const StageStrip: FC<StageStripProps> = ({ content, anchor, progress }) => {
  const stages = templateStages(content);
  const go = (key: StageKey) => {
    if (!anchor) return;
    const target = document.getElementById(anchor(key));
    target?.scrollIntoView({ block: "start" });
    const field = target?.querySelector<HTMLElement>("input, textarea") ?? target?.querySelector<HTMLElement>("button");
    field?.focus({ preventScroll: true });
  };
  return (
    <nav aria-label={progress ? `Stages of run ${progress.runId}` : "Stages of the coding profile"}>
      <ol className="flex flex-wrap items-stretch gap-1.5 text-xs">
        {stages.map((s, i) => {
          const isCurrent = progress?.current === s.key;
          const mark = markOf(progress, s.key);
          const shown = mark === null ? null : MARKS[mark];
          const body = (
            <>
              <span className="flex items-center gap-1 font-medium">
                <span data-stage-label="">{s.label}</span>
                {s.loop && (
                  <span className="inline-flex items-center gap-0.5 text-[#d2a8ff]">
                    <Repeat className="w-3 h-3" aria-hidden="true" />
                    Validation
                  </span>
                )}
                {s.reapprove && (
                  <span className="inline-flex items-center gap-0.5 text-[#f0883e]">
                    <UserCheck className="w-3 h-3" aria-hidden="true" />
                    re-approve
                  </span>
                )}
              </span>
              {s.detail && <span className="text-[10px] text-[#8b949e]">{s.detail}</span>}
              {shown && (
                <span className={`inline-flex items-center gap-0.5 text-[10px] ${shown.text}`}>
                  <shown.Icon className="w-3 h-3" aria-hidden="true" />
                  {shown.word}
                </span>
              )}
              {progress && s.key === "correction" && progress.corrections !== null && progress.corrections > 0 && (
                <span className="text-[10px] text-[#d2a8ff]">{rounds(progress.corrections)}</span>
              )}
            </>
          );
          const tone = s.muted ? MUTED_TONE : (shown?.tone ?? PLAIN_TONE);
          return (
            <li key={s.key} className="flex items-center gap-1.5" aria-current={isCurrent ? "step" : undefined}>
              {i > 0 && (
                <span aria-hidden="true" className="text-[#6e7681]">
                  →
                </span>
              )}
              {progress ? (
                <div className={`flex flex-col items-start px-2 py-1 rounded-md border text-left ${tone}`}>{body}</div>
              ) : (
                <button
                  type="button"
                  onClick={() => go(s.key)}
                  title={`Go to the ${s.label.toLowerCase()} fields`}
                  className={`flex flex-col items-start px-2 py-1 rounded-md border text-left ${s.muted ? tone : `${tone} hover:border-[#58a6ff]`}`}
                >
                  {body}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
};
