// PROTOTYPE (#687) — throwaway. Made-up surfaces for the placement prototype: one per job on the
// map. Hand-written React in Quay's look; no A2UI, no renderer. Each body lays itself out by the
// width of whatever holds it (container queries), so the same surface can sit in a 340 px
// companion, a card over the terminal or a full stage tab.
import { useState, type ReactNode } from "react";
import { Check, CircleDashed, FileText, LayoutList, ListChecks, Loader2, MessageCircleQuestion, ShieldAlert } from "lucide-react";

export type Job = "question" | "review" | "status" | "quay";

export interface Surface {
  id: string;
  terminalId: string;
  job: Job;
  /** The tick the surface arrived on; a status board's progress runs from it. */
  bornTick: number;
}

/** A surface that holds its agent up until the operator acts. A status board does not. */
export const blocks = (job: Job) => job !== "status";

export const JOBS: Record<Job, { label: string; title: string; chip: string; Icon: typeof Check; tone: string }> = {
  question: { label: "Question", title: "Which base should this branch take?", chip: "Asks", Icon: MessageCircleQuestion, tone: "#d29922" },
  review: { label: "Review", title: "Plan: pair each answer with its turn", chip: "Review", Icon: ListChecks, tone: "#a371f7" },
  status: { label: "Status board", title: "Migrating call sites", chip: "Board", Icon: LayoutList, tone: "#58a6ff" },
  quay: { label: "Quay card", title: "Permission: force push", chip: "Permission", Icon: ShieldAlert, tone: "#ff7b72" },
};

const primary = "h-7 px-3 rounded-md text-xs font-medium bg-[#238636] hover:bg-[#2ea043] text-white";
const secondary = "h-7 px-3 rounded-md text-xs border border-[#30363d] bg-[#21262d] text-[#c9d1d9] hover:bg-[#30363d]";
const danger = "h-7 px-3 rounded-md text-xs border border-[#da3633]/50 bg-[#da3633]/10 text-[#ff7b72] hover:bg-[#da3633]/25";

const Actions = ({ children }: { children: ReactNode }) => (
  <div className="mt-3 flex flex-wrap items-center gap-2">{children}</div>
);

const QUESTION_CHOICES = [
  { id: "rebase", label: "Rebase onto master", note: "Replay 3 commits. I resolve the drawer conflict." },
  { id: "merge", label: "Merge master in", note: "One merge commit; history keeps both lines." },
  { id: "leave", label: "Leave it for now", note: "Finish the fix, deal with master at pull request time." },
];

const Question = ({ onAction }: { onAction: (text: string) => void }) => {
  const [choice, setChoice] = useState("rebase");
  const [tests, setTests] = useState(true);
  const [note, setNote] = useState("");
  return (
    <div>
      <p className="text-xs text-[#8b949e] leading-relaxed">
        master moved 14 commits since this branch was cut. Two of them touch{" "}
        <code className="text-[#c9d1d9]">GithubCompanionDrawer.tsx</code>, which I am editing.
      </p>
      <div role="radiogroup" className="mt-3 flex flex-col gap-1.5">
        {QUESTION_CHOICES.map((c) => (
          <label
            key={c.id}
            className={`flex items-start gap-2 px-2.5 py-2 rounded-md border cursor-pointer ${
              choice === c.id ? "border-[#58a6ff] bg-[#1f6feb26]" : "border-[#30363d] hover:bg-[#21262d]"
            }`}
          >
            <input type="radio" name="base" checked={choice === c.id} onChange={() => setChoice(c.id)} className="mt-0.5 accent-[#58a6ff]" />
            <span className="min-w-0">
              <span className="block text-xs text-white">{c.label}</span>
              <span className="block text-[11px] text-[#8b949e]">{c.note}</span>
            </span>
          </label>
        ))}
      </div>
      <label className="mt-3 flex items-center gap-2 text-xs text-[#c9d1d9]">
        <input type="checkbox" checked={tests} onChange={(e) => setTests(e.target.checked)} className="accent-[#58a6ff]" />
        Run the test suite afterwards
      </label>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Anything else? (optional)"
        className="mt-3 w-full h-7 px-2 rounded-md bg-[#0d1117] border border-[#30363d] text-xs text-[#c9d1d9] placeholder:text-[#484f58] outline-none focus:border-[#58a6ff]"
      />
      <Actions>
        <button type="button" className={primary} onClick={() => onAction(`answer {base:"${choice}", tests:${tests}${note ? `, note:"${note}"` : ""}}`)}>
          Send answer
        </button>
        <button type="button" className={secondary} onClick={() => onAction("skipped")}>
          Skip
        </button>
      </Actions>
    </div>
  );
};

const PLAN_STEPS = [
  { text: "Give every turn an id when it starts", file: "useTurns.ts", size: "+18 −2" },
  { text: "Carry the turn id on each answer event", file: "bridge/events.rs", size: "+31 −6" },
  { text: "Pair answers by id, not by arrival order", file: "pairAnswers.ts", size: "+44 −29" },
  { text: "Drop answers whose turn has gone", file: "pairAnswers.ts", size: "+9 −0" },
  { text: "Cover late and duplicate answers", file: "pairAnswers.test.ts", size: "+96 −0" },
];

const Review = ({ onAction }: { onAction: (text: string) => void }) => {
  const [kept, setKept] = useState<boolean[]>(PLAN_STEPS.map(() => true));
  const [comment, setComment] = useState("");
  const dropped = kept.filter((k) => !k).length;
  return (
    <div className="@container">
      <p className="text-xs text-[#8b949e] leading-relaxed">
        Answers are matched to turns by arrival order, so a late answer lands on the next turn. Five steps, about 200 lines, no
        schema change.
      </p>
      <div className="mt-3 grid gap-3 @xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <ol className="flex flex-col gap-1">
          {PLAN_STEPS.map((step, i) => (
            <li key={step.text}>
              <label className={`flex items-start gap-2 px-2.5 py-1.5 rounded-md border border-[#30363d] cursor-pointer hover:bg-[#21262d] ${kept[i] ? "" : "opacity-50"}`}>
                <input
                  type="checkbox"
                  checked={kept[i]}
                  onChange={(e) => setKept((k) => k.map((v, j) => (j === i ? e.target.checked : v)))}
                  className="mt-0.5 accent-[#58a6ff]"
                />
                <span className="min-w-0 flex-1">
                  <span className={`block text-xs text-white ${kept[i] ? "" : "line-through"}`}>
                    {i + 1}. {step.text}
                  </span>
                  <span className="flex items-center gap-1.5 text-[11px] text-[#8b949e] font-mono">
                    <FileText className="w-3 h-3 shrink-0" />
                    <span className="truncate">{step.file}</span>
                    <span className="ml-auto shrink-0">{step.size}</span>
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ol>
        <div className="flex flex-col gap-2">
          <div className="px-2.5 py-2 rounded-md border border-[#d29922]/40 bg-[#d29922]/10 text-[11px] text-[#e3b341] leading-relaxed">
            <strong className="font-medium">2 things to know.</strong> Step 2 changes an event Codex terminals also emit. Step 4 drops
            data silently; say if you would rather log it.
          </div>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Comment for the agent (optional)"
            rows={3}
            className="w-full px-2 py-1.5 rounded-md bg-[#0d1117] border border-[#30363d] text-xs text-[#c9d1d9] placeholder:text-[#484f58] outline-none focus:border-[#58a6ff] resize-none"
          />
        </div>
      </div>
      <Actions>
        <button
          type="button"
          className={primary}
          onClick={() => onAction(`approved {steps:[${kept.map((k, i) => (k ? i + 1 : null)).filter(Boolean).join(",")}]${comment ? `, comment:"${comment}"` : ""}}`)}
        >
          {dropped ? `Approve without ${dropped} step${dropped > 1 ? "s" : ""}` : "Approve plan"}
        </button>
        <button type="button" className={secondary} onClick={() => onAction(`changes requested${comment ? ` {comment:"${comment}"}` : ""}`)}>
          Ask for changes
        </button>
        <button type="button" className={danger} onClick={() => onAction("rejected")}>
          Reject
        </button>
      </Actions>
    </div>
  );
};

const BOARD_STEPS = ["useTurns.ts", "pairAnswers.ts", "ActivityView.tsx", "AgentsPanel.tsx", "useBridgeEvents.ts", "companion/activity.ts", "Run the suite"];

/** How far a status board has got, from the ticks since it arrived. It loops, to stand for a long run. */
export const boardProgress = (age: number) => {
  const done = Math.floor(age / 3) % (BOARD_STEPS.length + 2);
  return { done: Math.min(done, BOARD_STEPS.length), total: BOARD_STEPS.length };
};

const Status = ({ age, onAction }: { age: number; onAction: (text: string) => void }) => {
  const { done, total } = boardProgress(age);
  const finished = done === total;
  return (
    <div className="@container">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-white font-medium">{finished ? "Done" : `${done} of ${total}`}</span>
        <div className="flex-1 h-1.5 rounded-full bg-[#21262d] overflow-hidden">
          <div className="h-full bg-[#58a6ff] transition-all duration-700" style={{ width: `${(done / total) * 100}%` }} />
        </div>
        <span className="font-mono text-[11px] text-[#8b949e]">
          {String(Math.floor(age / 50)).padStart(2, "0")}:{String(Math.floor((age * 1.2) % 60)).padStart(2, "0")}
        </span>
      </div>
      <div className="mt-3 grid gap-x-4 gap-y-1 @xl:grid-cols-2">
        {BOARD_STEPS.map((step, i) => (
          <div key={step} className="flex items-center gap-2 text-xs min-w-0">
            {i < done ? (
              <Check className="w-3 h-3 shrink-0 text-[#3fb950]" />
            ) : i === done ? (
              <Loader2 className="w-3 h-3 shrink-0 text-[#58a6ff] animate-spin" />
            ) : (
              <CircleDashed className="w-3 h-3 shrink-0 text-[#484f58]" />
            )}
            <span className={`truncate font-mono text-[11px] ${i < done ? "text-[#8b949e]" : i === done ? "text-white" : "text-[#6e7681]"}`}>{step}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-2 text-[11px]">
        <span className="px-1.5 py-0.5 rounded bg-[#238636]/20 text-[#3fb950] border border-[#238636]/40 font-mono">{180 + done * 6} passed</span>
        <span className="px-1.5 py-0.5 rounded bg-[#30363d]/60 text-[#8b949e] font-mono">0 failed</span>
        <span className="px-1.5 py-0.5 rounded bg-[#30363d]/60 text-[#8b949e] font-mono">{done * 2} files changed</span>
      </div>
      <Actions>
        <button type="button" className={secondary} onClick={() => onAction("stop requested")}>
          Stop the run
        </button>
      </Actions>
    </div>
  );
};

const QuayCard = ({ onAction }: { onAction: (text: string) => void }) => (
  <div>
    <p className="text-xs text-[#8b949e] leading-relaxed">The agent wants to run a command outside this project's allow list.</p>
    <pre className="mt-2 px-2.5 py-2 rounded-md bg-[#0d1117] border border-[#30363d] text-[11px] text-[#c9d1d9] font-mono whitespace-pre-wrap break-all">
      git push --force-with-lease origin fix/75-pair-answers-with-turns
    </pre>
    <p className="mt-2 text-[11px] text-[#e3b341]">Rewrites the remote branch. 1 open pull request points at it.</p>
    <Actions>
      <button type="button" className={primary} onClick={() => onAction("permission allowed once")}>
        Allow once
      </button>
      <button type="button" className={secondary} onClick={() => onAction("permission always allowed")}>
        Always allow
      </button>
      <button type="button" className={danger} onClick={() => onAction("permission denied")}>
        Deny
      </button>
    </Actions>
  </div>
);

/** The inside of a surface: its content and its actions, without any frame. */
export const SurfaceBody = ({ surface, tick, onAction }: { surface: Surface; tick: number; onAction: (text: string) => void }) => {
  switch (surface.job) {
    case "question":
      return <Question onAction={onAction} />;
    case "review":
      return <Review onAction={onAction} />;
    case "status":
      return <Status age={tick - surface.bornTick} onAction={onAction} />;
    case "quay":
      return <QuayCard onAction={onAction} />;
  }
};

/** A surface's title as one line: the status board's carries its progress. */
export const surfaceTitle = (surface: Surface, tick: number) => {
  if (surface.job !== "status") return JOBS[surface.job].title;
  const { done, total } = boardProgress(tick - surface.bornTick);
  return `${JOBS.status.title} · ${done} of ${total}`;
};
