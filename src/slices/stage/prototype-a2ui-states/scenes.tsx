// PROTOTYPE (#702), throwaway. The scenes: locked surfaces, the queue, locked tabs and strips, the
// limits, reopening, the waiting flag and unsent answers.
import { useState, type ReactNode } from "react";
import { Bot, ChevronDown, ChevronLeft, ChevronRight, FolderGit2, GitBranch, LayoutList, Loader2, Settings, Workflow } from "lucide-react";
import { AgentIcon } from "../../terminal/AgentIcons.tsx";
import { AskCard, said, type Draft } from "../prototype-a2ui-look/ask.tsx";
import { BoardBody, StepColumns, StripLine } from "../prototype-a2ui-look/board.tsx";
import { ASKS, BOARDS, RAW, REVIEWS, type Ask, type Board } from "../prototype-a2ui-look/content.ts";
import { Frame, KIND, type Key } from "../prototype-a2ui-look/frame.tsx";
import { CompanionMock, Pane, TERMS } from "../prototype-a2ui-look/LookPrototype.tsx";
import { Md } from "../prototype-a2ui-look/md.tsx";
import { RawSurface } from "../prototype-a2ui-look/raw.tsx";
import { ReviewSurface } from "../prototype-a2ui-look/review.tsx";
import { AskedPlain, LockedCard, LockedRow, StateMark, sentence, type Locked, type LockState } from "./locked.tsx";

export interface Ctx {
  pick: (id: string) => Key;
  view: (id: string) => string;
  say: (t: string) => void;
  log: string[];
}
export const t1 = TERMS[0];

// ---------------------------------------------------------------------------------------------
// Content

const q = (question: string, ...labels: string[]): Ask => ({ questions: [{ question, options: labels.map((label, i) => ({ label, recommended: i === 0 })) }] });
export interface Waiting {
  id: string;
  ask: Ask;
  wait: string;
}
export const WAITING: Waiting[] = [
  { id: "w1", ask: ASKS.one, wait: "12 min" },
  { id: "w2", ask: ASKS.three, wait: "4 min" },
  { id: "w3", ask: q("Keep the two failing benchmarks in this pull request?", "Skip them here", "Fix them here", "Raise the budget"), wait: "1 min" },
  { id: "w4", ask: q("Open the pull request as a draft?", "Draft", "Ready for review"), wait: "just now" },
];
const answered = (id: string, at: string, question: string, answer: string, ask?: Ask): Locked => ({
  id,
  kind: "ask",
  title: question,
  state: "settled",
  at,
  lines: [[question, answer]],
  full: <AskedPlain ask={ask ?? q(question, answer, "Something else")} />,
});
export const EARLIER: Locked[] = [
  answered("e1", "7:42 PM", "Delete the old pairing module?", "Delete it"),
  { id: "e2", kind: "ask", title: "Which suite should I run first?", state: "withdrawn", at: "7:31 PM", lines: [], draft: "Only cargo, the rest is", full: <AskedPlain ask={q("Which suite should I run first?", "Unit tests", "Cargo tests")} /> },
  answered("e3", "7:20 PM", "May I rewrite the event reader?", "Yes · keep the old name"),
  answered("e4", "7:02 PM", "Two callers disagree. Which is right?", "The companion"),
  { id: "e5", kind: "raw", title: "Worktree clean-up", state: "settled", at: "6:55 PM", lines: [["Action", "clear: keep 5, list first"]], full: <p className="text-xs text-[#8b949e]">Sliders and fields as sent.</p> },
  answered("e6", "6:40 PM", "Split this into two commits?", "Two commits"),
  answered("e7", "6:31 PM", "Use the shared helper?", "Yes"),
  answered("e8", "6:12 PM", "Pin the version?", "Pin it"),
  { id: "e9", kind: "ask", title: "Should the log keep the turn id?", state: "withdrawn", at: "6:05 PM", lines: [], full: <AskedPlain ask={q("Should the log keep the turn id?", "Yes", "No")} /> },
  answered("e10", "5:58 PM", "Start from master or from fix/74?", "master"),
];

const reviewFull = <Md text={REVIEWS.plan.body} className="text-xs leading-[18px]" />;
const DRAFT = "Rebase, but leave the drawer file to me. I have a change in";
export const lockedOf = (kind: string, state: LockState): Locked => {
  const at = "7:42 PM";
  if (kind === "review")
    return {
      id: "lr",
      kind: "review",
      title: REVIEWS.plan.title,
      state,
      at,
      verdict: "Approved",
      lines: state === "settled" ? [["Verdict", "Approved without 1 item"], ["Dropped", "Drop answers whose turn has gone"], ["Comment", "Log it instead."]] : [],
      draft: state === "settled" ? undefined : "Step 2 worries me: Codex terminals emit this event as well, so",
      full: reviewFull,
    };
  if (kind === "board") {
    const b = state === "settled" ? BOARDS.done : BOARDS.running;
    return { id: "lb", kind: "board", title: b.title, state, at, lines: [["Steps", state === "settled" ? "7 of 7 in 10:27" : "3 of 7 in 04:12"]], full: <StepColumns steps={b.steps} /> };
  }
  if (kind === "raw")
    return {
      id: "lw",
      kind: "raw",
      title: "Worktree clean-up before the release",
      state,
      at,
      lines: state === "settled" ? [["Action", "Clear worktrees"], ["Sent", "keep 5 · list first · leave alone: fix-74"]] : [],
      full: (
        <div inert>
          <RawSurface messages={RAW.companion} onAction={() => {}} />
        </div>
      ),
    };
  return {
    id: "la",
    kind: "ask",
    title: ASKS.one.questions[0].question,
    state,
    at,
    lines: state === "settled" ? [[ASKS.one.questions[0].question, "Rebase onto master · skip the suite"]] : [],
    draft: state === "settled" ? undefined : DRAFT,
    full: <AskedPlain ask={ASKS.one} />,
  };
};

// ---------------------------------------------------------------------------------------------
// Step 1: one locked surface, in its place

export const LockedScene = ({ pick, view, log }: Ctx) => {
  const [gone, setGone] = useState(false);
  const kind = view("surface");
  const rowStatus = view("state") === "ended" ? "exited" : "working";
  const l = lockedOf(kind, view("state") as LockState);
  const card = gone ? <p className="p-3 text-xs text-[#8b949e]">Dismissed.</p> : <LockedCard l={l} look={pick("lock")} body={pick("body")} draft={pick("draft")} onDismiss={() => setGone(true)} />;
  if (kind === "review")
    return (
      <Shell
        rowStatus={rowStatus}
        tabs={[{ id: "r", kind: "review", title: l.title, locked: l }]}
        front="r"
        stage={
          <div className="absolute inset-0 overflow-y-auto p-4">
            <div className="max-w-3xl mx-auto">{card}</div>
          </div>
        }
        companion={<PrView />}
      />
    );
  if (kind === "board")
    return (
      <Shell
        rowStatus={rowStatus}
        stage={<Pane term={t1} log={log} strip={<LockedStrip l={l} open onToggle={() => {}} />} over={<div className="absolute top-0 inset-x-0 max-h-[60%] overflow-y-auto p-2 bg-[#0d1117]/95 border-b border-[#30363d]">{card}</div>} />}
        companion={<PrView />}
      />
    );
  return <Shell rowStatus={rowStatus} stage={<Pane term={t1} log={log} />} companion={<CompanionMock width={340}>{card}</CompanionMock>} />;
};
const PrView = () => (
  <CompanionMock width={340} view="Pull request">
    <p className="text-xs text-[#8b949e]">#142 Pair each answer with the turn it belongs to</p>
  </CompanionMock>
);

// ---------------------------------------------------------------------------------------------
// Step 2: the companion's queue

export const Queue = ({ pick, say, start, earlier, width, capped }: Ctx & { start: Waiting[]; earlier: Locked[]; width: number; capped: boolean }) => {
  const look = pick("queue");
  const [live, setLive] = useState(start);
  const [locked, setLocked] = useState(earlier);
  const [at, setAt] = useState(start[0]?.id ?? "");
  const [showEarlier, setShowEarlier] = useState(false);
  const [openLocked, setOpenLocked] = useState<string | null>(null);
  const [drafts] = useState(() => new Map<string, Draft>());
  const settle = (w: Waiting, dismissed: boolean) => {
    const d = drafts.get(w.id);
    if (!dismissed)
      setLocked((all) => [
        {
          id: `${w.id}x`,
          kind: "ask",
          title: w.ask.questions[0].question,
          state: "settled",
          at: "just now",
          lines: w.ask.questions.map((x, i) => [x.question, d ? said(d.answers[i]) : ""]),
          full: <AskedPlain ask={w.ask} />,
        },
        ...all,
      ]);
    const rest = live.filter((x) => x.id !== w.id);
    setLive(rest);
    if (at === w.id) setAt(rest[0]?.id ?? "");
    say(dismissed ? "dismissed a question" : "answered a question");
  };
  const cardOf = (w: Waiting) => <AskCard key={w.id} ask={w.ask} layout="C" draft={drafts.get(w.id)} onDraft={(d) => drafts.set(w.id, d)} onSend={() => settle(w, false)} onDismiss={() => settle(w, true)} />;
  const lockedCard = (l: Locked) => <LockedCard key={l.id} l={l} look={pick("lock")} body={pick("body")} draft={pick("draft")} onDismiss={() => setLocked(locked.filter((x) => x.id !== l.id))} />;
  const full = capped && live.length === 4;
  const note =
    full && pick("full") === "B" ? (
      <p className="px-1 text-[11px] text-[#8b949e]">4 questions waiting, the most one terminal may have.</p>
    ) : full && pick("full") === "C" ? (
      <p role="status" className="px-2.5 py-1.5 rounded-md text-[11px] text-[#e3b341] bg-[#d29922]/10 border border-[#d29922]/40">
        fix-75 has 4 questions open and cannot ask another until you answer or dismiss one.
      </p>
    ) : null;
  const rows = locked.map((l) => (
    <LockedRow key={l.id} l={l} open={openLocked === l.id} onToggle={() => setOpenLocked(openLocked === l.id ? null : l.id)} onDismiss={() => setLocked(locked.filter((x) => x.id !== l.id))} card={lockedCard(l)} />
  ));
  const earlierFold = locked.length > 0 && (
    <div className="pt-1 border-t border-[#30363d]">
      <div className="flex items-center">
        <button type="button" aria-expanded={showEarlier} onClick={() => setShowEarlier(!showEarlier)} className="flex-1 h-7 flex items-center gap-1 px-1 text-[11px] text-[#8b949e] hover:text-white">
          <ChevronRight className={`w-3 h-3 ${showEarlier ? "rotate-90" : ""}`} aria-hidden />
          Earlier ({locked.length})
        </button>
        {showEarlier && (
          <button type="button" onClick={() => setLocked([])} className="px-1 text-[11px] text-[#58a6ff] hover:underline">
            Dismiss all
          </button>
        )}
      </div>
      {showEarlier && <div className="flex flex-col">{rows}</div>}
    </div>
  );
  const nothing = live.length === 0 && <p className="p-2 text-xs text-[#8b949e]">Nothing waiting. The companion goes back to the view it had before.</p>;

  let body: ReactNode;
  if (look === "A")
    body = (
      <>
        {note}
        {live.map((w) =>
          w.id === at ? (
            cardOf(w)
          ) : (
            <button key={w.id} type="button" aria-expanded={false} onClick={() => setAt(w.id)} className="h-9 px-3 flex items-center gap-2 rounded-lg border border-[#30363d] bg-[#161b22] hover:bg-[#21262d] text-xs text-left">
              <KIND.ask.Icon className="w-3.5 h-3.5 shrink-0" style={{ color: KIND.ask.tone }} aria-hidden />
              <span className="min-w-0 flex-1 truncate text-[#c9d1d9]">{w.ask.questions[0].question}</span>
              <span className="shrink-0 text-[10px] text-[#8b949e]">{w.wait}</span>
            </button>
          ),
        )}
        {nothing}
        {earlierFold}
      </>
    );
  else if (look === "B") {
    const all: (Waiting | Locked)[] = [...live, ...locked];
    const i = Math.max(0, all.findIndex((x) => x.id === at));
    const now = all[i];
    const step = (by: number) => setAt(all[(i + by + all.length) % all.length].id);
    body = (
      <>
        {note}
        {all.length > 1 && (
          <div className="flex items-center gap-1 text-[11px] text-[#8b949e]">
            <button type="button" aria-label="Previous" onClick={() => step(-1)} className="p-1 rounded hover:bg-[#30363d]">
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="flex-1 text-center">
              {i + 1} of {all.length}, {live.length} waiting
            </span>
            <button type="button" aria-label="Next" onClick={() => step(1)} className="p-1 rounded hover:bg-[#30363d]">
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        {now && ("ask" in now ? cardOf(now) : lockedCard(now))}
        {nothing}
      </>
    );
  } else
    body = (
      <>
        {note}
        {live.map(cardOf)}
        {nothing}
        {locked.map(lockedCard)}
      </>
    );
  return (
    <CompanionMock width={width}>
      <div className="flex flex-col gap-2">{body}</div>
    </CompanionMock>
  );
};

// ---------------------------------------------------------------------------------------------
// Step 3: locked tabs and strips

export interface TabInfo {
  id: string;
  kind: "review" | "raw";
  title: string;
  locked?: Locked;
}
const tab = (id: string, title: string, state?: LockState, verdict?: string): TabInfo => ({
  id,
  kind: "review",
  title,
  locked: state && { id, kind: "review", title, state, at: "7:42 PM", lines: state === "settled" ? [["Verdict", verdict ?? "Approved"]] : [], verdict, full: reviewFull },
});
export const LIVE_TABS = [tab("l1", "Plan: pair each answer with its turn"), tab("l2", "Results: full suite on fix/75"), tab("l3", "Findings in the event bridge"), tab("l4", "Plan: split the orchestrator")];
export const DONE_TABS = [tab("d1", "Plan: give every turn an id", "settled", "Approved"), tab("d2", "Findings: stale worktrees", "withdrawn"), tab("d3", "Results: cargo suite", "settled", "Changes asked"), tab("d4", "Plan: retire the old drawer", "settled", "Rejected"), tab("d5", "Plan: the spend ticker", "settled", "Approved")];

export const LockedStrip = ({ l, open, onToggle, half = false }: { l: Locked; open: boolean; onToggle: () => void; half?: boolean }) => (
  <button type="button" aria-expanded={open} title={sentence(l)} onClick={onToggle} className={`${half ? "min-w-0" : ""} w-full h-7 px-2.5 flex items-center gap-2 bg-[#0d1117] border-b border-[#30363d] text-xs hover:bg-[#161b22] text-left`}>
    <StateMark l={l} />
    <span className="truncate text-[#8b949e]">{l.title}</span>
    <span className="flex-1" />
    <span className="shrink-0 text-[10px] text-[#6e7681]">{l.at}</span>
    <ChevronDown className={`w-3.5 h-3.5 shrink-0 text-[#8b949e] ${open ? "rotate-180" : ""}`} aria-hidden />
  </button>
);
const strip = (id: string, title: string, state: LockState, verdict?: string): Locked => ({ ...lockedOf("board", state), id, title, verdict });
export const DONE_STRIPS = [strip("s1", "Migrating call sites", "settled"), strip("s2", "Release checks", "settled", "Failed"), strip("s3", "Regenerating tables", "settled"), strip("s4", "Sweeping docs", "ended"), strip("s5", "Warming the cache", "settled")];
export const LIVE_STRIPS: Board[] = [
  BOARDS.running,
  { ...BOARDS.quiet, title: "Reading the old bridge" },
  { ...BOARDS.running, title: "Tutorial checks", elapsed: "00:48" },
  { ...BOARDS.running, title: "Benchmarks", elapsed: "02:20" },
];

export const Strips = ({ pick, live, done }: Ctx & { live: Board[]; done: Locked[] }) => {
  const [open, setOpen] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [gone, setGone] = useState<string[]>([]);
  const kept = done.filter((d) => !gone.includes(d.id));
  const look = pick("liveStrips");
  const foldDone = pick("doneStrips");
  const toggle = (id: string) => setOpen(open === id ? null : id);
  const liveLines = live.map((b) => (
    <div key={b.title} className="min-w-0">
      <StripLine board={b} look="A" open={open === b.title} onToggle={() => toggle(b.title)} />
    </div>
  ));
  const shown = foldDone === "A" ? kept : foldDone === "B" ? kept.slice(0, 1) : [];
  const rest = kept.slice(shown.length);
  const doneLines = (list: Locked[]) => list.map((l) => <LockedStrip key={l.id} l={l} open={open === l.id} onToggle={() => toggle(l.id)} />);
  const board = live.find((b) => b.title === open);
  const lock = kept.find((l) => l.id === open);
  return {
    strip: (
      <div className="shrink-0 @container">
        {look === "A" && liveLines}
        {look === "B" && <div className={live.length > 1 ? "grid @2xl:grid-cols-2" : ""}>{liveLines}</div>}
        {look === "C" && live.length > 0 && (
          <div className="flex">
            <div className="flex-1 min-w-0">
              <StripLine board={live[0]} look="A" open={open === live[0].title} onToggle={() => toggle(live[0].title)} />
            </div>
            {live.length > 1 && (
              <button type="button" aria-expanded={more} onClick={() => setMore(!more)} className="h-7 px-3 border-b border-l border-[#30363d] bg-[#161b22] text-xs text-[#58a6ff]">
                +{live.length - 1}
              </button>
            )}
          </div>
        )}
        {look === "C" && more && liveLines.slice(1)}
        {doneLines(shown)}
        {rest.length > 0 && (
          <details className="text-xs">
            <summary className="h-6 px-2.5 flex items-center gap-1 text-[11px] text-[#8b949e] cursor-pointer border-b border-[#30363d] hover:text-white list-none">
              <LayoutList className="w-3 h-3" aria-hidden /> {rest.length} finished earlier
            </summary>
            {doneLines(rest)}
          </details>
        )}
      </div>
    ),
    over:
      board || lock ? (
        <div className="absolute top-0 inset-x-0 max-h-[60%] overflow-y-auto p-2 bg-[#0d1117]/95 border-b border-[#30363d]">
          {board ? (
            <BoardBody board={board} onDismiss={() => setOpen(null)} />
          ) : (
            lock && (
              <LockedCard
                l={lock}
                look={pick("lock")}
                body={pick("body")}
                draft={pick("draft")}
                onDismiss={() => {
                  setGone([...gone, lock.id]);
                  setOpen(null);
                }}
              />
            )
          )}
        </div>
      ) : undefined,
  };
};

const StripsPane = (p: Ctx & { live: Board[]; done: Locked[] }) => {
  const { strip: s, over } = Strips(p);
  return <Pane term={t1} log={p.log} strip={s} over={over} />;
};

export const TabsAndStrips = (p: Ctx & { liveTabs: TabInfo[]; doneTabs: TabInfo[]; live: Board[]; done: Locked[]; companion: ReactNode; narrow?: boolean; chips?: number }) => {
  const [front, setFront] = useState("terminal");
  const all = [...p.liveTabs, ...p.doneTabs];
  const now = all.find((t) => t.id === front);
  return (
    <Shell
      rowChips={Array.from({ length: p.chips ?? 0 }, () => "Asks")}
      tabs={all}
      front={front}
      onFront={setFront}
      foldLook={p.pick("doneTabs")}
      stage={
        now ? (
          <div className="absolute inset-0 overflow-y-auto">
            {now.locked ? (
              <div className="p-4 max-w-3xl mx-auto">
                <LockedCard l={now.locked} look={p.pick("lock")} body={p.pick("body")} draft={p.pick("draft")} onDismiss={() => setFront("terminal")} />
              </div>
            ) : (
              <ReviewSurface key={now.id} review={{ ...REVIEWS.plan, title: now.title }} layout="A" onVerdict={p.say} onDismiss={() => setFront("terminal")} />
            )}
          </div>
        ) : (
          <div className={p.narrow ? "absolute inset-y-0 left-0 w-[480px]" : "absolute inset-0"}>
            <StripsPane {...p} />
          </div>
        )
      }
      companion={p.companion}
    />
  );
};

// ---------------------------------------------------------------------------------------------
// Step 5: an answered surface its agent updates

const REOPENED = [
  {
    version: "1.0",
    createSurface: {
      ...(RAW.companion[0] as { createSurface: { components: { id: string }[]; dataModel: object } }).createSurface,
      surfaceId: "raw-re",
      components: (RAW.companion[0] as { createSurface: { components: { id: string; text?: string }[] } }).createSurface.components.map((c) =>
        c.id === "intro" ? { ...c, text: "Two of the worktrees you chose hold **uncommitted work**: `fix-74` and `docs-sweep`. Send again to clear them as well, or keep more." } : c.id === "v3" ? { ...c, text: "**1.1 GB**" } : c,
      ),
      dataModel: { keep: 5, dry: false, note: "fix-74" },
    },
  },
];
export const ReopenScene = (p: Ctx) => {
  const { pick, view, say, log } = p;
  const look = pick("reopen");
  const after = view("when") === "after";
  const [open, setOpen] = useState("re");
  const second: Waiting = { ...WAITING[2], wait: "2 min" };
  const band = (
    <>
      {look === "A" && (
        <div className="px-3 py-1.5 text-[11px] border-b border-[#30363d] bg-[#d29922]/10">
          <span className="text-[#e3b341]">Reopened by the agent, 7:58 PM.</span>{" "}
          <span className="text-[#8b949e]">You sent at 7:42 PM: Clear worktrees, keep 5, leave alone fix-74.</span>
        </div>
      )}
      {look === "C" && (
        <div className="px-3 py-1.5 text-[11px] border-b border-[#30363d] bg-[#58a6ff]/10 text-[#8b949e]">
          <span className="text-[#58a6ff]">Changed since you answered:</span> the first text; “2.3 GB” is now “1.1 GB”; “List them first” is now off.
        </div>
      )}
    </>
  );
  const rawCard = (
    <Frame terminal="fix-75" cli="claude" kind="raw" title="Worktree clean-up before the release" onDismiss={() => say("dismissed the surface")} band={band}>
      <RawSurface messages={REOPENED} onAction={say} />
    </Frame>
  );
  const rawLocked = <LockedCard l={lockedOf("raw", "settled")} look={pick("lock")} body={pick("body")} draft="A" onDismiss={() => {}} />;
  const askCard = <AskCard ask={second.ask} layout="C" onSend={say} onDismiss={() => say("dismissed the question")} />;
  const fold = (id: string, kind: "ask" | "raw", title: string, wait: string) => (
    <button key={id} type="button" aria-expanded={false} onClick={() => setOpen(id)} className="h-9 px-3 flex items-center gap-2 rounded-lg border border-[#30363d] bg-[#161b22] hover:bg-[#21262d] text-xs text-left">
      {(() => {
        const { Icon, tone } = KIND[kind];
        return <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: tone }} aria-hidden />;
      })()}
      <span className="min-w-0 flex-1 truncate text-[#c9d1d9]">{title}</span>
      <span className="shrink-0 text-[10px] text-[#8b949e]">{wait}</span>
    </button>
  );
  const asks = open === "ask" || (!after && open === "re") ? <div key="ask">{askCard}</div> : fold("ask", "ask", second.ask.questions[0].question, second.wait);
  const raw = open === "re" ? <div key="re">{rawCard}</div> : fold("re", "raw", "Worktree clean-up before the release", "reopened now");
  return (
    <Shell
      rowChips={after ? ["Asks", "Asks"] : ["Asks"]}
      stage={<Pane term={t1} log={log} />}
      companion={
        <CompanionMock width={340}>
          <div className="flex flex-col gap-2">
            {after ? (pick("place") === "A" ? [asks, raw] : [raw, asks]) : [asks, <div key="locked" className="pt-1 border-t border-[#30363d]"><div className="px-1 pb-1 text-[11px] text-[#8b949e]">Earlier (1)</div>{rawLocked}</div>]}
          </div>
        </CompanionMock>
      }
    />
  );
};

// ---------------------------------------------------------------------------------------------
// Step 6: the waiting flag

export const StatusText = ({ status }: { status: string }) =>
  status === "idle" ? (
    <span className="flex items-center gap-1 text-[10px] text-[#3fb950]">
      <span className="w-1.5 h-1.5 rounded-full bg-[#3fb950]" /> Ready
    </span>
  ) : status === "exited" ? (
    <span className="flex items-center gap-1 text-[10px] text-[#8b949e]">
      <span className="w-1.5 h-1.5 rounded-full bg-[#ff7b72]" /> <span className="font-mono">exited 0</span>
    </span>
  ) : status === "unknown" ? (
    <span className="flex items-center gap-1 text-[10px] text-[#8b949e]">
      <span className="w-1.5 h-1.5 rounded-full bg-[#8b949e]" /> Unknown
    </span>
  ) : (
    <span className="flex items-center gap-1 text-[10px] text-[#58a6ff] whitespace-nowrap">
      <Loader2 className="w-2.5 h-2.5 animate-spin" /> Working: Bash
    </span>
  );
const AMBER = "rounded-full text-[#d29922] bg-current shadow-[0_0_0_3px_rgba(210,153,34,0.35)]";

export const WaitingScene = ({ pick, view, say, log }: Ctx) => {
  const status = view("status");
  const pane = pick("paneFlag");
  const [shown, setShown] = useState(false);
  return (
    <Shell
      rowChips={["Asks"]}
      rowStatus={status}
      rowLook={pick("rowFlag")}
      stage={
        <Pane
          term={t1}
          log={log}
          titleExtra={
            <span className="flex items-center gap-2">
              <StatusText status={status} />
              {pane === "A" && (
                <button type="button" onClick={() => setShown(true)} className="inline-flex items-center gap-1 px-1.5 h-[18px] rounded text-[10px] font-medium text-[#d29922] bg-[#d29922]/15 border border-[#d29922]/40 hover:brightness-125">
                  <KIND.ask.Icon className="w-2.5 h-2.5" aria-hidden /> 1 question for you
                </button>
              )}
              {pane === "B" && <span role="img" aria-label="Waiting on you" title="Waiting on you" className={`w-1.5 h-1.5 ml-1 ${AMBER}`} />}
            </span>
          }
        />
      }
      companion={
        shown ? (
          <CompanionMock width={340}>
            <AskCard ask={ASKS.one} layout="C" onSend={say} onDismiss={() => setShown(false)} />
          </CompanionMock>
        ) : (
          <PrView />
        )
      }
    />
  );
};

// ---------------------------------------------------------------------------------------------
// Step 7: unsent answers. `drafts` and the kept raw surface live outside the scene.

export const DraftScene = ({ say, log, drafts, away, moved, onMove }: Ctx & { drafts: Map<string, Draft>; away: boolean; moved: boolean; onMove: () => void }) => {
  if (away)
    return (
      <Shell
        active="t2"
        stage={<Pane term={TERMS[1]} log={[]} />}
        companion={
          <CompanionMock width={340} view="Activity">
            <p className="text-xs text-[#8b949e]">docs-sweep is selected. Go back to fix-75 from the bar below.</p>
          </CompanionMock>
        }
      />
    );
  const raw = (
    <Frame terminal="fix-75" cli="claude" kind="raw" title="Worktree clean-up before the release" onDismiss={() => say("dismissed the surface")} move={{ at: moved ? "tab" : "companion", go: onMove }}>
      <RawSurface keep="draft" messages={RAW.companion} onAction={say} />
    </Frame>
  );
  return (
    <Shell
      rowChips={["Asks", "Asks"]}
      tabs={moved ? [{ id: "m", kind: "raw", title: "Worktree clean-up before the release" }] : []}
      front={moved ? "m" : "terminal"}
      stage={
        moved ? (
          <div className="absolute inset-0 overflow-y-auto p-4">
            <div className="max-w-3xl mx-auto">{raw}</div>
          </div>
        ) : (
          <Pane term={t1} log={log} />
        )
      }
      companion={
        <CompanionMock width={340}>
          <div className="flex flex-col gap-2">
            <AskCard ask={ASKS.three} layout="C" draft={drafts.get("a")} onDraft={(d) => drafts.set("a", d)} onSend={say} onDismiss={() => say("dismissed the question")} />
            {!moved && raw}
          </div>
        </CompanionMock>
      }
    />
  );
};

// ---------------------------------------------------------------------------------------------
// The mock shell, with the waiting dot the module bar and rows really have

interface ShellProps {
  tabs?: TabInfo[];
  front?: string;
  onFront?: (id: string) => void;
  foldLook?: Key;
  stage: ReactNode;
  companion: ReactNode;
  rowChips?: string[];
  rowStatus?: string;
  rowLook?: Key;
  active?: string;
}
const ChipAsk = ({ children }: { children: ReactNode }) => (
  <span className="inline-flex items-center gap-1 px-1.5 h-[18px] rounded text-[10px] font-medium border shrink-0 text-[#d29922] border-[#d29922]/40 bg-[#d29922]/15">
    <KIND.ask.Icon className="w-2.5 h-2.5" aria-hidden /> {children}
  </span>
);

export const Shell = ({ tabs = [], front = "terminal", onFront, foldLook = "A", stage, companion, rowChips = [], rowStatus = "working", rowLook = "A", active = "t1" }: ShellProps) => {
  const [menu, setMenu] = useState(false);
  const asking = rowChips.length > 0;
  const tabLook = (t: TabInfo) => t.locked !== undefined;
  const folded = foldLook === "A" ? [] : tabs.filter((t) => tabLook(t) && (foldLook === "C" || t.id !== front));
  const inBar = tabs.filter((t) => !folded.includes(t));
  const go = (id: string) => {
    setMenu(false);
    onFront?.(id);
  };
  return (
    <>
      <div className="shrink-0 w-12 flex flex-col items-center bg-[#161b22] border-r border-[#30363d] text-[#8b949e]">
        {[FolderGit2, GitBranch, Bot, Workflow, Settings].map((Icon, i) => (
          <div key={["p", "g", "a", "w", "s"][i]} className="relative w-12">
            <div className="w-12 h-12 grid place-items-center" data-neon={i === 0 ? "module" : undefined}>
              <Icon size={22} aria-hidden />
            </div>
            {i === 2 && asking && <span className="absolute top-1 right-1 min-w-4 h-4 px-1 rounded-full text-[10px] leading-4 font-semibold text-center bg-[#d29922] text-[#0d1117]">{rowChips.length}</span>}
            {i === 0 && (
              <ul aria-label="Terminals" className="list-none m-0 p-0">
                {TERMS.slice(0, 3).map((t) => (
                  <li key={t.id} className="h-6 grid place-items-center" title={t.name}>
                    <span
                      data-neon="dot"
                      className={`w-2 h-2 ${t.id === "t1" && asking ? AMBER : t.id === "t1" && rowStatus === "idle" ? "rounded-full border-[1.5px] border-[#8b949e]" : t.id === "t1" && rowStatus === "exited" ? "bg-[#f85149] text-[#f85149]" : "rounded-full bg-[#3fb950] text-[#3fb950] motion-safe:animate-pulse"}`}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
      <div className="shrink-0 w-[250px] flex flex-col border-r border-[#30363d]">
        <div className="h-12 px-4 border-b border-[#30363d] flex items-center gap-2 bg-[#161b22] font-bold text-white text-sm">
          QUAY <span className="text-[10px] text-[#58a6ff] font-mono font-normal">mock</span>
        </div>
        <div className="p-2 flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5 px-2 py-1.5 text-xs">
            <ChevronDown className="w-3.5 h-3.5" aria-hidden />
            <FolderGit2 className="w-3.5 h-3.5 text-[#58a6ff]" aria-hidden /> Quay-2
          </div>
          {TERMS.slice(0, 3).map((t) => {
            const me = t.id === "t1";
            return (
              <div key={t.id} data-neon={t.id === active ? "row" : undefined} className={`flex flex-col gap-1 px-2.5 py-1.5 text-xs rounded-md border ${t.id === active ? "bg-[#21262d] text-white" : "border-transparent text-[#8b949e]"}`}>
                <div className="flex items-center gap-1.5">
                  <span className="relative">
                    <AgentIcon kind={t.kind} className="w-3.5 h-3.5 shrink-0" />
                    {me && asking && rowLook === "A" && <span role="img" aria-label="Waiting on you" className="absolute -top-0.5 -right-1 w-1.5 h-1.5 rounded-full bg-[#d29922] ring-2 ring-[#21262d]" />}
                  </span>
                  <span className="truncate font-medium text-[#c9d1d9]">{t.name}</span>
                </div>
                <div className="pl-5 flex items-center gap-1.5 min-h-[18px]">
                  {me && asking && rowLook === "B" ? (
                    <span className="inline-flex items-center gap-1 px-1.5 rounded text-[10px] font-medium bg-[#d29922]/20 text-[#d29922] border border-[#d29922]/40">◆ Waiting on you</span>
                  ) : (
                    <StatusText status={me ? rowStatus : t.id === "t3" ? "idle" : "working"} />
                  )}
                  {me && rowChips.slice(0, 2).map((c, i) => <ChipAsk key={`${c}${"ab"[i]}`}>{c}</ChipAsk>)}
                  {me && rowChips.length > 2 && <span className="px-1 text-[10px] text-[#8b949e]">+{rowChips.length - 2}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <main className="flex-1 min-w-0 flex flex-col">
        <div className="relative shrink-0 h-[34px] flex items-stretch bg-[#161b22] border-b border-[#30363d] text-xs">
          <div className="flex min-w-0 items-stretch overflow-hidden">
            {[{ id: "terminal", kind: "review" as const, title: "fix-75", locked: undefined }, ...inBar].map((t) => {
              const on = t.id === front;
              const { Icon, tone } = KIND[t.kind];
              return (
                <button
                  key={t.id}
                  type="button"
                  aria-current={on ? "page" : undefined}
                  title={t.locked ? `${t.title}. ${sentence(t.locked)}` : t.title}
                  onClick={() => go(t.id)}
                  className={`relative min-w-[3.5rem] max-w-[13rem] px-3 flex items-center gap-1.5 border-r border-[#30363d] ${on ? "bg-[#0d1117] text-white" : t.locked ? "text-[#6e7681]" : "text-[#8b949e]"}`}
                >
                  {on && <span data-neon="edge" className="absolute left-0 right-0 bottom-0 h-[2px]" />}
                  {t.id !== "terminal" && !t.locked && <Icon className={`w-3.5 h-3.5 shrink-0 ${on ? "" : "animate-pulse"}`} style={{ color: tone }} aria-hidden />}
                  {t.locked && <StateMark l={t.locked} className="[&]:gap-0.5" />}
                  <span className="truncate">{t.title}</span>
                </button>
              );
            })}
          </div>
          {folded.length > 0 && (
            <div className="relative shrink-0 flex">
              <button type="button" aria-expanded={menu} onClick={() => setMenu(!menu)} className="px-3 flex items-center gap-1 text-[#8b949e] hover:text-white">
                Earlier {folded.length} <ChevronDown className="w-3 h-3" aria-hidden />
              </button>
              {menu && (
                <div className="absolute right-0 top-full z-30 w-72 p-1 rounded-md border border-[#30363d] bg-[#161b22] shadow-xl flex flex-col">
                  {folded.map((t) => (
                    <button key={t.id} type="button" onClick={() => go(t.id)} className="h-7 px-2 flex items-center gap-2 text-left rounded hover:bg-[#30363d]">
                      {t.locked && <StateMark l={t.locked} className="w-24" />}
                      <span className="truncate text-[#c9d1d9]">{t.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex-1 min-h-0 relative">{stage}</div>
      </main>
      {companion}
    </>
  );
};
