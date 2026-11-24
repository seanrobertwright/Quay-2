// PROTOTYPE (#702), throwaway. How a surface's later states look, in seven guided steps. Each offers
// different takes with one recommended. Picks stay in this browser. Run `pnpm proto:a2ui-states`.
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { PRIMARY } from "../../companion/buttonStyles.ts";
import type { Draft } from "../prototype-a2ui-look/ask.tsx";
import type { Key } from "../prototype-a2ui-look/frame.tsx";
import { KEPT } from "../prototype-a2ui-look/raw.tsx";
import { CompanionMock } from "../prototype-a2ui-look/LookPrototype.tsx";
import { DONE_STRIPS, DONE_TABS, DraftScene, EARLIER, LIVE_STRIPS, LIVE_TABS, LockedScene, Queue, ReopenScene, Shell, TabsAndStrips, WAITING, WaitingScene, t1, type Ctx } from "./scenes.tsx";
import { Pane } from "../prototype-a2ui-look/LookPrototype.tsx";

interface Group {
  id: string;
  label: string;
  options: { key: string; name: string; why?: string }[];
  recommended: string;
}
interface Step {
  id: string;
  name: string;
  todo: string;
  groups: Group[];
  views: { id: string; label: string; options: [string, string][] }[];
}
const abc = (...names: [string, string?][]) => names.map(([name, why], i) => ({ key: "ABC"[i], name, why }));
const STEPS: Step[] = [
  {
    id: "locked",
    name: "A surface that can't be answered any more",
    todo: "Go through the three states for each kind of surface. Open what was asked.",
    groups: [
      {
        id: "lock",
        label: "How it says so",
        recommended: "B",
        options: abc(["Word in the header bar", "Smallest; the reason is only in the tooltip."], ["Band under the header", "The full reason and the time, in Quay's own ground."], ["Dimmed, reason at the foot", "Plainly over, but your answer is dimmed with it."]),
      },
      { id: "body", label: "What it keeps showing", recommended: "A", options: abc(["Your answer, the rest folded", "Short; a click brings back what was asked."], ["Everything, greyed", "Complete, and as tall as it was."]) },
      { id: "draft", label: "Text typed but not sent", recommended: "A", options: abc(["Kept, with Copy", "A half-written review comment is not lost."], ["Dropped", "Simplest."]) },
    ],
    views: [
      { id: "state", label: "State", options: [["settled", "Answered or done"], ["ended", "Terminal exited"], ["withdrawn", "Withdrawn"]] },
      { id: "surface", label: "Surface", options: [["ask", "Question"], ["review", "Review"], ["board", "Board"], ["raw", "Raw"]] },
    ],
  },
  {
    id: "queue",
    name: "Several questions in the companion",
    todo: "Answer one and see what happens next. Start typing in one, open another, come back. Then try four waiting with ten done, at both widths.",
    groups: [
      {
        id: "queue",
        label: "Queue",
        recommended: "A",
        options: abc(["Oldest open, rest as lines", "All of them in view; done ones fold into Earlier."], ["One at a time, with arrows", "Quietest, but you can't see what else waits."], ["Everything in one scroll", "Nothing hidden; four cards is a very long scroll."]),
      },
      { id: "full", label: "At four waiting", recommended: "B", options: abc(["Say nothing", "The agent is told anyway."], ["One quiet line", "Explains why the agent has stopped asking."], ["Amber notice", "Hard to miss, for something that needs no action."]) },
    ],
    views: [
      { id: "content", label: "Waiting", options: [["three", "Three, two done"], ["limit", "Four, ten done"], ["one", "One"]] },
      { id: "width", label: "Companion", options: [["340", "340 px"], ["560", "560 px"]] },
    ],
  },
  {
    id: "places",
    name: "Finished tabs and boards",
    todo: "Open a live review tab, then a finished one, then go back to fix-75. Open a finished board on the pane.",
    groups: [
      {
        id: "doneTabs",
        label: "Finished tabs",
        recommended: "B",
        options: abc(["Stay in the bar, dimmed", "Nothing moves; the bar fills up."], ["Fold into Earlier once you leave", "Stays while you read it, then makes room."], ["Fold into Earlier at once", "Cleanest bar, but it leaves as you answer."]),
      },
      {
        id: "doneStrips",
        label: "Finished boards",
        recommended: "B",
        options: abc(["Every one keeps its line", "Ten finished boards take 280 px of the terminal."], ["Newest keeps its line", "You see the result; older ones fold under one line."], ["All folded", "Smallest, but a result can pass unseen."]),
      },
    ],
    views: [{ id: "content", label: "Finished", options: [["few", "Two of each"], ["ten", "Five of each"]] }],
  },
  {
    id: "limits",
    name: "Four live, ten finished",
    todo: "Everything at its limit for one terminal: four questions, four tabs, four boards, ten finished. Pick how four boards sit on the pane, and whether the numbers are right.",
    groups: [
      {
        id: "liveStrips",
        label: "Four boards",
        recommended: "B",
        options: abc(["One under another", "112 px of the terminal."], ["Two to a row where there is room", "56 px; one to a row in a narrow pane."], ["One line and +3", "28 px, but three boards are out of sight."]),
      },
      {
        id: "liveLimit",
        label: "Live, in each place",
        recommended: "4",
        options: [
          { key: "4", name: "Four", why: "All four questions fit in view as lines, and four tabs still show their titles." },
          { key: "3", name: "Three" },
        ],
      },
      {
        id: "keptLimit",
        label: "Finished, kept per terminal",
        recommended: "10",
        options: [
          { key: "10", name: "Ten", why: "Ten lines under Earlier take under 300 px, and only when you open it." },
          { key: "5", name: "Five" },
        ],
      },
    ],
    views: [{ id: "pane", label: "Pane", options: [["wide", "Wide"], ["narrow", "Narrow"]] }],
  },
  {
    id: "reopen",
    name: "The agent reopens an answered surface",
    todo: "You answered this at 7:42 PM. Switch Before and After: the agent has updated it and wants another answer, while a question is also waiting.",
    groups: [
      {
        id: "reopen",
        label: "What says so",
        recommended: "A",
        options: abc(["Line with your earlier answer", "Why it is back, and what you said."], ["Nothing, it is just open again", "Easy to take for a repeat."], ["Line listing what changed", "Most help on a long surface; a long list when much changed."]),
      },
      { id: "place", label: "Place in the queue", recommended: "A", options: abc(["At the end", "Does not move the one you are on."], ["Its old place, first", "Jumps ahead of what you were answering."]) },
    ],
    views: [{ id: "when", label: "Show", options: [["after", "After the update"], ["before", "Before it"]] }],
  },
  {
    id: "waiting",
    name: "Waiting on you, while it reads Working or Ready",
    todo: "fix-75 has a question for you. Its own status says something else. Look at its row on the left and the pane's title. The module bar's amber dot and badge are as Quay has them today.",
    groups: [
      {
        id: "rowFlag",
        label: "Terminal row",
        recommended: "A",
        options: abc(["Amber dot on the icon", "Both are true at once, and both show."], ["Amber words replace the status", "Loud, but hides whether it is still working."], ["The chip alone", "Nothing new; a raw surface's chip is not amber."]),
      },
      { id: "paneFlag", label: "Pane title", recommended: "A", options: abc(["Button: 1 question for you", "Takes you to it when the companion shows something else."], ["Amber dot", "Quiet, does nothing."], ["Nothing", "The row and the module bar are enough."]) },
    ],
    views: [{ id: "status", label: "Status", options: [["working", "Working"], ["idle", "Ready"], ["unknown", "Unknown"]] }],
  },
  {
    id: "unsent",
    name: "An answer you have started",
    todo: "Tick something and type in the question, and move the sliders below it. Then use the three buttons here and see what is left.",
    groups: [
      {
        id: "unsent",
        label: "It survives",
        recommended: "A",
        options: abc(
          ["Switching, moving and a reload", "Nothing typed is lost. Quay's Rust side holds it, in memory only."],
          ["Switching and moving", "Cheaper; a reload of Quay's window loses it, which is rare."],
          ["Neither", "Looking at another terminal loses it."],
        ),
      },
    ],
    views: [],
  },
];

const STORE = "a2ui-states-702";
interface Saved {
  picks: Record<string, string>;
  notes: Record<string, string>;
}
const load = (): Saved => {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) ?? "null") as Saved | null;
    if (raw?.picks && raw.notes) return raw;
  } catch {
    // No storage here; start empty.
  }
  return { picks: {}, notes: {} };
};

export function StatesPrototype() {
  const [saved, setSaved] = useState<Saved>(load);
  const [at, setAt] = useState(() => {
    const { picks } = load();
    const first = STEPS.findIndex((s) => s.groups.some((g) => !picks[g.id]));
    return first < 0 ? STEPS.length : first;
  });
  const [trying, setTrying] = useState<Record<string, string>>({});
  const [views, setViews] = useState<Record<string, string>>({});
  const [log, setLog] = useState<string[]>([]);
  const [round, setRound] = useState(0);
  const [copied, setCopied] = useState("");
  const [drafts] = useState(() => new Map<string, Draft>());
  const [away, setAway] = useState(false);
  const [moved, setMoved] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify(saved));
    } catch {
      // No storage here; picks last until the page closes.
    }
  }, [saved]);

  const done = at >= STEPS.length;
  const step = STEPS[Math.min(at, STEPS.length - 1)];
  const pick = (id: string) => trying[id] ?? saved.picks[id] ?? STEPS.flatMap((s) => s.groups).find((g) => g.id === id)!.recommended;
  const view = (id: string) => views[`${step.id}.${id}`] ?? step.views.find((v) => v.id === id)?.options[0][0] ?? "";
  const say = (t: string) => setLog((l) => [...l.slice(-5), `  ⎿ operator: ${t}`]);
  const lose = () => {
    drafts.clear();
    KEPT.clear();
  };
  const reset = () => setRound((r) => r + 1);
  const goTo = (i: number) => {
    setAt(Math.max(0, Math.min(STEPS.length, i)));
    setLog([]);
    lose();
    setAway(false);
    setMoved(false);
    reset();
  };
  const choose = () => {
    const picks = Object.fromEntries(step.groups.map((g) => [g.id, pick(g.id)]));
    setSaved((s) => ({ ...s, picks: { ...s.picks, ...picks } }));
    setTrying({});
    goTo(at + 1);
  };
  const survives = pick("unsent");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select, [contenteditable]") || done) return;
      const by = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!by) return;
      const g = step.groups[0];
      const i = g.options.findIndex((o) => o.key === pick(g.id));
      setTrying((t) => ({ ...t, [g.id]: g.options[(i + by + g.options.length) % g.options.length].key }));
      reset();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const ctx: Ctx = { pick: (id) => pick(id) as Key, view, say, log };
  const key = `${step.id} ${step.groups.map((g) => pick(g.id)).join()} ${step.views.map((v) => view(v.id)).join()} ${round}`;
  const width = view("width") === "560" ? 560 : 340;
  let scene: ReactNode;
  if (step.id === "locked") scene = <LockedScene key={key} {...ctx} />;
  else if (step.id === "queue") {
    const c = view("content");
    const start = c === "limit" ? WAITING : c === "one" ? WAITING.slice(0, 1) : WAITING.slice(0, 3);
    scene = (
      <Shell
        rowChips={start.map(() => "Asks")}
        stage={<Pane term={t1} log={log} />}
        companion={<Queue key={key} {...ctx} start={start} earlier={c === "limit" ? EARLIER : c === "one" ? [] : EARLIER.slice(0, 2)} width={width} capped />}
      />
    );
  } else if (step.id === "places") {
    const n = view("content") === "ten" ? 5 : 2;
    scene = (
      <TabsAndStrips
        key={key}
        {...ctx}
        chips={1}
        liveTabs={LIVE_TABS.slice(0, 1)}
        doneTabs={DONE_TABS.slice(0, n)}
        live={LIVE_STRIPS.slice(0, 1)}
        done={DONE_STRIPS.slice(0, n)}
        companion={
          <CompanionMock width={340} view="Pull request">
            <p className="text-xs text-[#8b949e]">#142 Pair each answer with the turn it belongs to</p>
          </CompanionMock>
        }
      />
    );
  } else if (step.id === "limits") {
    const n = Number(pick("liveLimit"));
    const kept = Number(pick("keptLimit"));
    scene = (
      <TabsAndStrips
        key={key}
        {...ctx}
        chips={n * 2}
        liveTabs={LIVE_TABS.slice(0, n)}
        doneTabs={DONE_TABS.slice(0, kept === 10 ? 3 : 2)}
        live={LIVE_STRIPS.slice(0, n)}
        done={DONE_STRIPS.slice(0, kept === 10 ? 3 : 1)}
        companion={<Queue key={key} {...ctx} start={WAITING.slice(0, n)} earlier={EARLIER.slice(0, kept === 10 ? 4 : 2)} width={340} capped={n === 4} />}
        narrow={view("pane") === "narrow"}
      />
    );
  } else if (step.id === "reopen") scene = <ReopenScene key={key} {...ctx} />;
  else if (step.id === "waiting") scene = <WaitingScene key={key} {...ctx} />;
  else
    scene = (
      <DraftScene
        key={`${round} ${away}`}
        {...ctx}
        drafts={drafts}
        away={away}
        moved={moved}
        onMove={() => {
          if (survives === "C") KEPT.clear();
          setMoved(!moved);
          if (survives === "C") reset();
        }}
      />
    );

  const summary = STEPS.map((s) => {
    const lines = s.groups.map((g) => {
      const k = saved.picks[g.id];
      const o = g.options.find((x) => x.key === k);
      return `  ${g.label}: ${k ? `${k}${o && o.name !== k ? ` (${o.name})` : ""}${k === g.recommended ? "" : "   [recommended was " + g.recommended + "]"}` : "not picked"}`;
    });
    const note = saved.notes[s.id]?.trim();
    return [s.name, ...lines, ...(note ? [`  Note: ${note}`] : [])].join("\n");
  }).join("\n");
  const report = `#702 picks\n\n${summary}`;
  const accent = { "--quay-accent": "#7df9ff", "--quay-accent-line": "#7df9ff8c", "--quay-accent-haze": "#7df9ff38" } as CSSProperties;
  const bar = "px-2 py-1 rounded border border-[#8c959f] bg-white hover:bg-[#eaeef2]";

  return (
    <div style={accent} className="h-full flex flex-col bg-[#0d1117] text-[#c9d1d9] overflow-hidden">
      <div className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden">
        <div className="h-full min-w-[1100px] flex">{scene}</div>
      </div>

      {/* The guide: the prototype's own controls, not part of any design. */}
      <div className="shrink-0 max-h-[46vh] overflow-y-auto bg-[#f0f6fc] text-[#1f2328] border-t-2 border-black px-4 py-2.5 text-xs" aria-label="Guide">
        {done ? (
          <div className="flex flex-col gap-2 max-w-4xl mx-auto">
            <strong className="text-sm">All steps done. Copy this and paste it back to me.</strong>
            <textarea id="picks" readOnly aria-label="Your picks" value={report} rows={12} className="w-full p-2 font-mono text-[11px] border border-[#8c959f] rounded bg-white" onFocus={(e) => e.target.select()} />
            <div className="flex gap-2 items-center">
              <button
                type="button"
                className={PRIMARY}
                onClick={() => {
                  const fail = () => setCopied("Select the text above and press Ctrl+C.");
                  if (navigator.clipboard) navigator.clipboard.writeText(report).then(() => setCopied("Copied."), fail);
                  else fail();
                }}
              >
                Copy
              </button>
              <button type="button" className="underline" onClick={() => goTo(0)}>
                Go through again
              </button>
              <span role="status">{copied}</span>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-start gap-3">
              <span className="shrink-0 font-semibold text-sm">
                {at + 1} of {STEPS.length}: {step.name}
              </span>
              <span className="flex-1 min-w-64 text-[#424a53] leading-[18px]">{step.todo}</span>
              {step.views.map((v) => (
                <label key={v.id} className="shrink-0 flex items-center gap-1">
                  {v.label}
                  <select
                    value={view(v.id)}
                    onChange={(e) => {
                      setViews((all) => ({ ...all, [`${step.id}.${v.id}`]: e.target.value }));
                      reset();
                    }}
                    className="h-6 px-1 border border-[#8c959f] rounded bg-white"
                  >
                    {v.options.map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              {step.id === "unsent" && (
                <span className="flex gap-1">
                  <button
                    type="button"
                    className={bar}
                    onClick={() => {
                      if (!away && survives === "C") lose();
                      setAway(!away);
                    }}
                  >
                    {away ? "Back to fix-75" : "Select docs-sweep"}
                  </button>
                  <button
                    type="button"
                    className={bar}
                    disabled={away}
                    onClick={() => {
                      if (survives === "C") KEPT.clear();
                      setMoved(!moved);
                      if (survives === "C") reset();
                    }}
                  >
                    {moved ? "Bring the raw surface back" : "Open the raw surface as a tab"}
                  </button>
                  <button
                    type="button"
                    className={bar}
                    onClick={() => {
                      if (survives !== "A") lose();
                      setAway(false);
                      setMoved(false);
                      reset();
                    }}
                  >
                    Reload Quay's window
                  </button>
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {step.groups.map((g) => (
                <fieldset key={g.id} className="min-w-0">
                  <legend className="font-semibold mb-0.5">{g.label}</legend>
                  <div className="flex flex-wrap gap-1">
                    {g.options.map((o) => {
                      const on = pick(g.id) === o.key;
                      return (
                        <button
                          key={o.key}
                          type="button"
                          aria-pressed={on}
                          title={o.why}
                          onClick={() => {
                            setTrying((t) => ({ ...t, [g.id]: o.key }));
                            if (g.id === "unsent") lose();
                            reset();
                          }}
                          className={`px-2 py-1 rounded border text-left ${on ? "bg-[#1f2328] text-white border-[#1f2328]" : "bg-white border-[#8c959f] hover:bg-[#eaeef2]"}`}
                        >
                          {o.key.length === 1 && /[A-C]/.test(o.key) && <b>{o.key} </b>}
                          {o.name}
                          {g.recommended === o.key && <span className={on ? "text-[#7ee787]" : "text-[#1a7f37]"}> ★ recommended</span>}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-0.5 text-[11px] text-[#59636e]">{g.options.find((o) => o.key === pick(g.id))?.why}</p>
                </fieldset>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={bar} disabled={at === 0} onClick={() => goTo(at - 1)}>
                Back
              </button>
              <button type="button" className={PRIMARY} onClick={choose}>
                Pick {step.groups.map((g) => pick(g.id)).join(" + ")} and go on
              </button>
              <label htmlFor={`note-${step.id}`}>Note</label>
              <input
                id={`note-${step.id}`}
                value={saved.notes[step.id] ?? ""}
                onChange={(e) => setSaved((s) => ({ ...s, notes: { ...s.notes, [step.id]: e.target.value } }))}
                className="flex-1 min-w-40 h-7 px-2 border border-[#8c959f] rounded bg-white"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
