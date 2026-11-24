import { Check, CircleDashed, LoaderCircle, X, type LucideIcon } from "lucide-react";
import type { Step, StepState } from "./steps.ts";

interface StateLook {
  word: string;
  Icon: LucideIcon;
  tone: string;
}

const LOOKS: Record<StepState, StateLook> = {
  pending: { word: "Not started", Icon: CircleDashed, tone: "text-[#8b949e]" },
  active: { word: "In progress", Icon: LoaderCircle, tone: "text-[#58a6ff]" },
  done: { word: "Done", Icon: Check, tone: "text-[#3fb950]" },
  failed: { word: "Failed", Icon: X, tone: "text-[#f85149]" },
};

const StepItem = ({ label, state, note }: Step) => {
  const { word, Icon, tone } = LOOKS[state];
  const now = state === "active" || state === "failed";
  return (
    <li className="flex min-w-0 items-start gap-1.5 text-xs">
      <Icon aria-hidden="true" className={`mt-0.5 h-3 w-3 shrink-0 ${tone}`} />
      <span className="min-w-0 wrap-anywhere">
        <span className="sr-only">{word}: </span>
        <span className={now ? "text-white" : "text-[#8b949e]"}>{label}</span>
        {note !== undefined && <span className="block text-[11px] text-[#8b949e]">{note}</span>}
      </span>
    </li>
  );
};

/** `steps`, each with a key of its own: its label, and how many before it have the same. */
function keyed(steps: readonly Step[]): { key: string; step: Step }[] {
  const seen = new Map<string, number>();
  return steps.map((step) => {
    const before = seen.get(step.label) ?? 0;
    seen.set(step.label, before + 1);
    return { key: JSON.stringify([step.label, before]), step };
  });
}

/** A run's steps in order, down one column and then the next where there is room for two. */
export const StepList = ({ steps }: { steps: readonly Step[] }) => (
  <div className="@container min-w-0">
    <ol className="-mb-1 gap-x-5 @lg:columns-2 [&>li]:mb-1 [&>li]:break-inside-avoid">
      {keyed(steps).map(({ key, step }) => (
        <StepItem key={key} {...step} />
      ))}
    </ol>
  </div>
);
