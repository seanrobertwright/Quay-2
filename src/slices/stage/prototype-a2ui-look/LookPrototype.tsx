// PROTOTYPE (#696), throwaway. What each job's surface looks like in its place: eight guided steps,
// each with clearly different takes and one recommended, over a mock of the shell. Picks are kept in
// this browser only and copied out at the end. Run `pnpm proto:a2ui-look`.
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Bot, ChevronDown, FolderGit2, GitBranch, Info, Layers, LayoutList, ListChecks, Loader2, MessageCircleQuestion, Settings, Shapes, Workflow } from "lucide-react";
import { AgentIcon } from "../../terminal/AgentIcons.tsx";
import type { RunKind } from "../../terminal/types.ts";
import { PRIMARY } from "../../companion/buttonStyles.ts";
import { AskCard } from "./ask.tsx";
import { BoardBody, RawStripLine, StripLine } from "./board.tsx";
import { ConnectSettings } from "./connect.tsx";
import { ASKS, BOARDS, RAW, RAW2, REVIEWS, TITLES, plainAsk } from "./content.ts";
import { Frame, KIND, LooksContext, QuayCard, type Key, type Kind } from "./frame.tsx";
import { RawSurface } from "./raw.tsx";
import { ReviewSurface } from "./review.tsx";

// ---------------------------------------------------------------------------------------------
// The guide: what each step asks

interface Group {
  id: string;
  label: string;
  options: { key: string; name: string; why?: string }[];
  recommended: string;
}
interface View {
  id: string;
  label: string;
  options: [string, string][];
}
interface Step {
  id: string;
  name: string;
  todo: string;
  groups: Group[];
  views: View[];
}

const abc = (...names: [string, string?][]) => names.map(([name, why], i) => ({ key: "ABC"[i], name, why }));
const STEPS: Step[] = [
  {
    id: "frame",
    name: "Frame, Quay's mark, links",
    todo: "Three cards side by side: an agent's question, an agent imitating Quay, and Quay's own card. Pick the frame around agent surfaces, the mark on Quay's card, and how a link shows its address. The imitation's link claims to be GitHub; hover it.",
    groups: [
      {
        id: "frame",
        label: "Frame",
        recommended: "A",
        options: abc(
          ["Header bar", "Quay's words sit in a bar the agent cannot draw in, so content cannot pass as Quay's."],
          ["Coloured edge", "Lightest, but provenance reads like content."],
          ["Title first", "The agent's title leads; who sent it is a small second line."],
        ),
      },
      {
        id: "mark",
        label: "Quay's mark",
        recommended: "B",
        options: abc(
          ["Solid band", "Loudest."],
          ["Accent glow + badge", "Uses the shell's own neon, which no agent component can draw."],
          ["Badge only", "An agent could type something close to it."],
        ),
      },
      {
        id: "link",
        label: "Link address",
        recommended: "B",
        options: abc(
          ["Full address under it", "Safest, but breaks up prose."],
          ["Real host beside it, full on hover", "The host gives a fake away at a glance; the rest shows at the frame's foot."],
          ["On hover only", "Cleanest; nothing shows until you hover."],
        ),
      },
    ],
    views: [],
  },
  {
    id: "ask",
    name: "Question card",
    todo: "In the companion. Answer the one-question card, then try three questions, then the limits, at both widths. Send one to see how it looks once answered.",
    groups: [
      {
        id: "ask",
        label: "Layout",
        recommended: "C",
        options: abc(
          ["All in one scroll", "Nothing hidden; four questions at the limits is a very long scroll."],
          ["One at a time", "Short, but you cannot see what is coming."],
          ["Listed, one open", "All questions visible, one open, answers shown on the closed ones."],
        ),
      },
      {
        id: "askLimits",
        label: "Limits",
        recommended: "Lower",
        options: [
          { key: "Keep", name: "Keep: context 1,500, description 200" },
          { key: "Lower", name: "Lower: context 600, description 120", why: "At 340 px a 200-character description is 5 lines, times 6 options." },
        ],
      },
    ],
    views: [
      { id: "content", label: "Content", options: [["one", "One question"], ["three", "Three"], ["limits", "At the limits"]] },
      { id: "width", label: "Companion", options: [["340", "340 px"], ["560", "560 px"]] },
    ],
  },
  {
    id: "review",
    name: "Review on a stage tab",
    todo: "Read the plan, drop an item, try Request changes with no comment, then approve. Look at it at the limits (20,000 characters, 30 items) and with no items. Narrow the stage.",
    groups: [
      {
        id: "review",
        label: "Layout",
        recommended: "A",
        options: abc(
          ["Document + decision rail", "Items and verdict stay beside the text; on a narrow stage they go under it."],
          ["One column + docked bar", "Verdict always in reach; items come after all the text."],
          ["Three pages", "Calm, but you cannot see the text while dropping items."],
        ),
      },
      {
        id: "reviewLimits",
        label: "Limits",
        recommended: "Lower",
        options: [
          { key: "Keep", name: "Keep: 30 items, detail 500, body 20,000" },
          { key: "Lower", name: "Lower detail to 300, keep the rest", why: "Detail folds to two lines; at 500 one More pushes the next item off the rail." },
        ],
      },
    ],
    views: [
      { id: "content", label: "Content", options: [["plan", "Plan"], ["noItems", "No items"], ["limits", "At the limits"]] },
      { id: "stage", label: "Stage", options: [["full", "Full"], ["narrow", "Narrow"]] },
    ],
  },
  {
    id: "board",
    name: "Status board strip",
    todo: "On top of the terminal's pane. It arrives folded. Click it open in each state. Then look at the limits, and at two boards plus a raw strip at once.",
    groups: [
      {
        id: "strip",
        label: "Folded strip",
        recommended: "A",
        options: abc(
          ["Live line", "Title, current step, 3 of 7, clock, thin bar."],
          ["A tick per step", "Shows where the failure is; unreadable at 30 steps."],
          ["Title only", "Quietest; you open it to learn anything."],
        ),
      },
      {
        id: "open",
        label: "Opened board",
        recommended: "A",
        options: abc(
          ["Drops over the terminal", "The terminal keeps its size, so nothing in it reflows."],
          ["Pushes the terminal down", "Covers nothing, but the terminal resizes each time."],
          ["Card at the right", "Covers least width; one narrow column."],
        ),
      },
      {
        id: "boardLimits",
        label: "Limits",
        recommended: "Keep",
        options: [
          { key: "Keep", name: "Keep: 30 steps, note 120, 6 stats", why: "Two columns hold 30 steps; it scrolls past half the pane." },
          { key: "Lower", name: "Lower: 20 steps, note 80" },
        ],
      },
    ],
    views: [{ id: "content", label: "State", options: [["running", "Running"], ["quiet", "Quiet"], ["failed", "Failed"], ["done", "Done"], ["limits", "At the limits"], ["many", "Three strips"]] }],
  },
  {
    id: "chips",
    name: "Chips on terminal rows",
    todo: "In the Projects panel on the left. fix-75 has five surfaces, docs-sweep one question, pr-review a failed board.",
    groups: [
      {
        id: "chips",
        label: "Chip",
        recommended: "A",
        options: abc(
          ["Icon + word", "Reads without learning icons; past three, the rest fold into +2."],
          ["Icon only", "Fits any number; you must know the icons."],
          ["Icon + word + waiting time", "Shows who has waited longest, but fits only two."],
        ),
      },
    ],
    views: [],
  },
  {
    id: "raw",
    name: "Raw surfaces",
    todo: "A raw surface drawn by the real A2UI engine with Quay's components. See it in each place. In the companion, move it to a tab and back. Use the sliders and fields; the button's action shows below.",
    groups: [
      {
        id: "move",
        label: "Move control",
        recommended: "A",
        options: abc(["Icon in the frame", "One click, next to dismiss."], ["In a ⋯ menu", "Two clicks, room for more later."], ["Text at the foot", "Explains itself, takes a line."]),
      },
      {
        id: "title",
        label: "Title limit",
        recommended: "80",
        options: [
          { key: "60", name: "60" },
          { key: "80", name: "80", why: "Two lines in the frame at 340 px, and the same as review and board." },
          { key: "120", name: "120" },
        ],
      },
    ],
    views: [
      { id: "place", label: "Place", options: [["companion", "companion"], ["tab", "tab"], ["strip", "strip"]] },
      { id: "width", label: "Companion", options: [["340", "340 px"], ["560", "560 px"]] },
    ],
  },
  {
    id: "quiet",
    name: "A terminal that cannot show surfaces",
    todo: "Look for the mark on the tidy terminal, hover it or click it. Switch between the three reasons.",
    groups: [
      {
        id: "quiet",
        label: "Where",
        recommended: "B",
        options: abc(
          ["Tooltip on the row's icon", "Invisible until hovered; cannot hold a link to the fix."],
          ["Info button on the pane title", "Quiet, beside the CLI, and its popover can link to Settings."],
          ["A line in the Repository view", "Never in the way, rarely seen."],
        ),
      },
    ],
    views: [{ id: "reason", label: "Reason", options: [["none", "No tool channel"], ["version", "Needs a newer CLI"], ["connect", "Not connected yet"]] }],
  },
  {
    id: "connect",
    name: "Connect control in Settings",
    todo: "Connect Antigravity, then remove it. Check that you can see what Quay will write before it writes.",
    groups: [
      {
        id: "connect",
        label: "Control",
        recommended: "A",
        options: abc(["Opens in the row", "The path and the exact entry, in place."], ["Dialog", "Same content, over the settings."], ["Before and after", "The whole file twice; heavy for a big file."]),
      },
    ],
    views: [],
  },
  {
    id: "parts",
    name: "Tabs, date and the new components",
    todo: "Round two, drawn with the catalog as decided. Look at all three tabs: a choice with descriptions, a date and a time, and Progress, Steps, Stat and FileLink.",
    groups: [
      {
        id: "tabs",
        label: "Tabs inside a surface",
        recommended: "B",
        options: abc(["Underlined", "Looks like the companion's own views just above it."], ["Segmented", "Cannot be taken for the companion's views."], ["Drop-down", "Fits any number; hides the choices."]),
      },
    ],
    views: [{ id: "width", label: "Companion", options: [["340", "340 px"], ["560", "560 px"]] }],
  },
  {
    id: "text",
    name: "Diff block and tables",
    todo: "A diff, a five-column table and a plain code block in the companion. Check both widths.",
    groups: [
      {
        id: "diff",
        label: "Diff block",
        recommended: "A",
        options: abc(["Tinted lines", "Like Quay's diff view, with the signs kept."], ["Coloured text", "Quieter; weak for small changes."], ["Edge bar, no signs", "Cleanest; a copied line loses its sign."]),
      },
      {
        id: "table",
        label: "Table at 340 px",
        recommended: "A",
        options: abc(["Scrolls in its own box", "Columns stay readable and comparable."], ["Squeezed to fit", "Nothing hidden; five columns break words."], ["Stacked rows", "Reads well, but loses comparison down a column."]),
      },
    ],
    views: [{ id: "width", label: "Companion", options: [["340", "340 px"], ["560", "560 px"]] }],
  },
  {
    id: "refused",
    name: "Images and files that cannot be shown",
    todo: "A web image and a missing one, then click the two file links at the bottom: one is missing, one is on the network.",
    groups: [
      {
        id: "image",
        label: "Image placeholder",
        recommended: "A",
        options: abc(["Small box with the reason", "Says what, why and where."], ["One line", "Smallest; no reason."], ["Full-size box", "Keeps the image's space, which is mostly empty."]),
      },
      {
        id: "notice",
        label: "Missing-file notice",
        recommended: "A",
        options: abc(["Foot of the frame", "Where link addresses already show; Quay's own ground."], ["Under the header bar", "Seen first, but pushes the content down."], ["Under the link", "Closest, but inside the agent's content."]),
      },
    ],
    views: [],
  },
  {
    id: "approve",
    name: "The Approve button's count",
    todo: "Drop two items and read the button. If Quay's frame lays out the review (the next step), the count costs nothing. If not, it needs one small function in the catalog.",
    groups: [
      {
        id: "approve",
        label: "Label",
        recommended: "A",
        options: abc(
          ["Approve without 2 items", "You see what you are agreeing to; also gives \"3 of 5 kept\"."],
          ["Approve kept items", "Always true, says nothing about how many."],
          ["Approve", "Plainest; only the struck-out items show what was dropped."],
        ),
      },
    ],
    views: [],
  },
  {
    id: "typed",
    name: "Who lays out the typed surfaces",
    todo: "Your picks for the question card (one open at a time) and the review (a rail) need layouts the 19 components lack. Left: quay_ask. Right: the same questions sent raw.",
    groups: [
      {
        id: "typed",
        label: "Layout",
        recommended: "A",
        options: abc(
          ["Quay's frame lays out typed surfaces", "Your picks stay, and the catalog stays at 19. Raw gets the same content, plainer."],
          ["Add a fold and a rail to the catalog", "Raw can match, at the cost of two more components to build and teach."],
          ["Typed looks like raw", "One look everywhere; undoes two of your picks."],
        ),
      },
    ],
    views: [{ id: "content", label: "Questions", options: [["lowered", "At the picked limits"], ["three", "Three"]] }],
  },
];

// ---------------------------------------------------------------------------------------------
// Kept in this browser only. The raw messages are made once, so a redraw keeps the engine's state.
const PLAIN = { lowered: plainAsk(ASKS.lowered), three: plainAsk(ASKS.three) };

const STORE = "a2ui-look-696";
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

// ---------------------------------------------------------------------------------------------
// The mock shell

export interface Term {
  id: string;
  name: string;
  kind: RunKind;
  lines: string[];
}
export const TERMS: Term[] = [
  {
    id: "t1",
    name: "fix-75",
    kind: "claude",
    lines: ["> pair each answer with the turn it belongs to", "● Read(src/slices/bridge/useBridgeEvents.ts)", "  ⎿ 135 lines", '● Grep("turn.completed")', "  ⎿ 6 matches in 4 files", "● Edit(src/slices/companion/activity.ts)", "  ⎿ +12 −3", "● git fetch origin", "  ⎿ master moved 14 commits"],
  },
  { id: "t2", name: "docs-sweep", kind: "codex", lines: [] },
  { id: "t3", name: "pr-review", kind: "antigravity", lines: [] },
  { id: "t4", name: "tidy", kind: "aider", lines: ["> /add src/slices/rail/ProjectsPanel.tsx", "Added src/slices/rail/ProjectsPanel.tsx to the chat", "> tidy the imports", "Applied edit to src/slices/rail/ProjectsPanel.tsx"] },
];

interface Chip {
  kind: Kind;
  word: string;
  wait?: string;
  tone?: string;
  title: string;
}
const CHIPS: Record<string, Chip[]> = {
  t1: [
    { kind: "ask", word: "Asks", wait: "4m", title: "Which base should this branch take?" },
    { kind: "review", word: "Review", wait: "12m", title: "Plan: pair each answer with its turn" },
    { kind: "board", word: "3/7", title: "Migrating call sites" },
    { kind: "raw", word: "Asks", wait: "1m", title: "Worktree clean-up" },
    { kind: "raw", word: "Shows", title: "Queue and workers" },
  ],
  t2: [{ kind: "ask", word: "Asks", wait: "26m", title: "Which tables should be regenerated?" }],
  t3: [{ kind: "board", word: "failed", tone: "#f85149", title: "Reviewing pull request 142" }],
};

const ChipPill = ({ chip, look }: { chip: Chip; look: Key }) => {
  const { Icon, tone } = KIND[chip.kind];
  const colour = chip.tone ?? tone;
  return (
    <button
      type="button"
      aria-label={`Show: ${chip.title}`}
      title={`${chip.title}${chip.wait ? `, waiting ${chip.wait}` : ""}`}
      style={{ color: colour, borderColor: `${colour}66`, backgroundColor: `${colour}26` }}
      className={`inline-flex items-center gap-1 px-1.5 h-[18px] rounded text-[10px] font-medium border shrink-0 hover:brightness-125 ${chip.wait ? "animate-pulse" : ""}`}
    >
      <Icon className="w-2.5 h-2.5" aria-hidden />
      {look !== "B" && <span>{chip.word}</span>}
      {look === "C" && chip.wait && <span className="font-mono opacity-80">{chip.wait}</span>}
    </button>
  );
};

const Row = ({ term, active, chips, look, quietTip }: { term: Term; active: boolean; chips: Chip[]; look: Key; quietTip?: string }) => {
  const max = look === "A" ? 3 : look === "C" ? 2 : 9;
  const rest = chips.slice(max);
  return (
    <div data-neon={active ? "row" : undefined} className={`flex flex-col gap-1 px-2.5 py-1.5 text-xs rounded-md border ${active ? "bg-[#21262d] text-white" : "border-transparent text-[#8b949e]"}`}>
      <div className="flex items-center gap-1.5">
        <span className={quietTip ? "relative opacity-70" : "relative"} title={quietTip}>
          <AgentIcon kind={term.kind} className="w-3.5 h-3.5 shrink-0" />
        </span>
        <span className="truncate font-medium text-[#c9d1d9]">{term.name}</span>
      </div>
      <div className="pl-5 flex items-center gap-1 min-h-[18px]">
        {chips.length ? (
          <>
            {chips.slice(0, max).map((c) => (
              <ChipPill key={c.title} chip={c} look={look} />
            ))}
            {rest.length > 0 && (
              <button type="button" title={rest.map((c) => c.title).join("\n")} className="px-1.5 h-[18px] rounded text-[10px] border border-[#30363d] text-[#8b949e] hover:text-white">
                +{rest.length}
              </button>
            )}
          </>
        ) : (
          <span className="flex items-center gap-1 text-[10px] text-[#58a6ff]">
            <Loader2 className="w-2.5 h-2.5 animate-spin" /> Working...
          </span>
        )}
      </div>
    </div>
  );
};

const ModuleBar = () => (
  <div className="shrink-0 w-12 flex flex-col items-center bg-[#161b22] border-r border-[#30363d] text-[#8b949e]" aria-hidden>
    {[FolderGit2, GitBranch, Bot, Workflow, Settings].map((Icon, i) => (
      <div key={["p", "g", "a", "w", "s"][i]} className="w-12 h-12 grid place-items-center" data-neon={i === 0 ? "module" : undefined}>
        <Icon size={22} />
      </div>
    ))}
  </div>
);

const TabBar = ({ tab, front }: { tab?: { kind: Kind; title: string }; front: "terminal" | "tab" }) => (
  <div className="shrink-0 h-[34px] flex items-stretch bg-[#161b22] border-b border-[#30363d] text-xs overflow-hidden">
    <div className={`relative px-3 flex items-center gap-1.5 border-r border-[#30363d] ${front === "terminal" ? "bg-[#0d1117] text-white" : "text-[#8b949e]"}`}>
      {front === "terminal" && <span data-neon="edge" className="absolute left-0 right-0 bottom-0 h-[2px]" />}
      fix-75 <span className="text-[10px] font-mono text-[#8b949e]">claude</span>
    </div>
    {tab && (
      <div title={tab.title} className={`relative max-w-[15rem] px-3 flex items-center gap-1.5 border-r border-[#30363d] ${front === "tab" ? "bg-[#0d1117] text-white" : "text-[#8b949e]"}`}>
        {front === "tab" && <span data-neon="edge" className="absolute left-0 right-0 bottom-0 h-[2px]" />}
        {(() => {
          const { Icon, tone } = KIND[tab.kind];
          return <Icon className={`w-3.5 h-3.5 shrink-0 ${front === "tab" ? "" : "animate-pulse"}`} style={{ color: tone }} />;
        })()}
        <span className="truncate">{tab.title}</span>
        <span className="shrink-0 text-[10px] font-mono text-[#8b949e]">fix-75</span>
      </div>
    )}
  </div>
);

export const Pane = ({ term, log, strip, over, titleExtra }: { term: Term; log: string[]; strip?: ReactNode; over?: ReactNode; titleExtra?: ReactNode }) => (
  <div className="absolute inset-1.5 flex flex-col rounded-md border border-[#30363d] overflow-hidden bg-[#0d1117]">
    <div className="relative h-7 px-2.5 border-b border-[#30363d]/60 flex items-center gap-2 text-xs shrink-0 bg-[#161b22]">
      <AgentIcon kind={term.kind} className="w-3.5 h-3.5" />
      <span data-neon="title" className="font-medium">
        {term.name}
      </span>
      {titleExtra}
    </div>
    {strip}
    <div className="flex-1 min-h-0 relative overflow-hidden">
      <div className="absolute inset-0 p-3 flex flex-col justify-end font-mono text-[12px] leading-5 whitespace-pre overflow-hidden">
        {[...term.lines, ...log].map((line, i) => (
          <div key={`${i} ${line}`} className={line.includes("operator:") ? "text-[#3fb950] whitespace-pre-wrap" : line.startsWith("  ") ? "text-[#6e7681]" : "text-[#c9d1d9]"}>
            {line}
          </div>
        ))}
        <div>▌</div>
      </div>
      {over}
    </div>
  </div>
);

export const CompanionMock = ({ width, view = "Surface", children }: { width: number; view?: string; children: ReactNode }) => (
  <aside style={{ width }} className="shrink-0 min-h-0 flex flex-col bg-[#0d1117] border-l border-[#30363d]" aria-label="Companion">
    <div className="shrink-0 h-12 px-3 flex items-stretch gap-1 border-b border-[#30363d] bg-[#161b22] overflow-hidden">
      {["Surface", "Pull request", "Activity", "Repository"].map((v) => (
        <span key={v} data-neon={v === view ? "underline" : undefined} className={`shrink-0 px-2.5 grid place-items-center text-xs border-b-2 ${v === view ? "text-white" : "border-transparent text-[#8b949e]"}`}>
          {v}
        </span>
      ))}
    </div>
    <div className="flex-1 min-h-0 overflow-y-auto p-2.5">{children}</div>
  </aside>
);

const Gone = ({ what, onAgain }: { what: string; onAgain: () => void }) => (
  <div className="p-3 text-xs text-[#8b949e]">
    {what} <button type="button" onClick={onAgain} className="text-[#58a6ff] hover:underline">Show it again</button>
  </div>
);

const REASONS: Record<string, { text: string; fix?: string }> = {
  none: { text: "Aider has no tool channel, so it cannot show surfaces." },
  version: { text: "Pi 0.99.0 or later is needed. This one is 0.98.2." },
  connect: { text: "Antigravity is not connected.", fix: "Connect it in Settings" },
};

const QuietInfo = ({ reason }: { reason: { text: string; fix?: string } }) => {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative ml-auto">
      <button type="button" aria-label="This terminal cannot show surfaces" aria-expanded={open} onClick={() => setOpen(!open)} className="p-1 rounded text-[#6e7681] hover:text-[#c9d1d9] hover:bg-[#30363d]">
        <Info className="w-3.5 h-3.5" />
      </button>
      {open && (
        <span className="absolute right-0 top-7 z-30 w-64 p-2.5 rounded-md border border-[#30363d] bg-[#161b22] shadow-xl text-xs text-[#c9d1d9] flex flex-col gap-1">
          <span className="font-medium text-[#f0f6fc]">No surfaces here</span>
          <span className="text-[#8b949e]">{reason.text}</span>
          {reason.fix && <span className="text-[#58a6ff]">{reason.fix}</span>}
        </span>
      )}
    </span>
  );
};

// ---------------------------------------------------------------------------------------------
// Scenes

const SceneFrame = ({ pick, say }: { pick: (id: string) => string; say: (t: string) => void }) => (
  <div className="absolute inset-0 overflow-auto p-5">
    <div className="flex flex-wrap gap-5 items-start justify-center">
      {(
        [
          ["An agent's question", <AskCard key="a" ask={ASKS.one} layout="C" onSend={say} onDismiss={() => say("dismissed")} />],
          [
            "An agent imitating Quay",
            <Frame key="b" terminal="docs-sweep" cli="codex" kind="raw" title="Permission needed" onDismiss={() => say("dismissed")}>
              <RawSurface messages={RAW.lookalike} onAction={say} />
            </Frame>,
          ],
          ["Quay's own card", <QuayCard key="c" />],
        ] as [string, ReactNode][]
      ).map(([name, card]) => (
        <div key={name} className="w-[320px]">
          <div className="text-[11px] text-[#8b949e] mb-1.5">{name}</div>
          {card}
        </div>
      ))}
    </div>
    <p className="mt-5 text-center text-[11px] text-[#8b949e]">
      Frame {pick("frame")} · mark {pick("mark")} · link {pick("link")}. Later steps use the frame and link you pick here.
    </p>
  </div>
);

export function LookPrototype() {
  const [saved, setSaved] = useState<Saved>(load);
  // Opens at the first step with nothing picked, so a second round starts where the first ended.
  const [at, setAt] = useState(() => {
    const { picks } = load();
    const first = STEPS.findIndex((s) => s.groups.some((g) => !picks[g.id]));
    return first < 0 ? STEPS.length : first;
  });
  const [trying, setTrying] = useState<Record<string, string>>({});
  const [views, setViews] = useState<Record<string, string>>({});
  const [log, setLog] = useState<string[]>([]);
  const [round, setRound] = useState(0);
  const [gone, setGone] = useState(false);
  const [openStrip, setOpenStrip] = useState<string | null>(null);
  const [moved, setMoved] = useState(false);
  const [copied, setCopied] = useState("");

  useEffect(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify(saved));
    } catch {
      // No storage here; picks last until the page closes.
    }
  }, [saved]);

  const done = at >= STEPS.length;
  const step = STEPS[Math.min(at, STEPS.length - 1)];
  const groupOf = (id: string) => STEPS.flatMap((s) => s.groups).find((g) => g.id === id)!;
  const pick = (id: string) => trying[id] ?? saved.picks[id] ?? groupOf(id).recommended;
  const view = (id: string) => views[`${step.id}.${id}`] ?? step.views.find((v) => v.id === id)?.options[0][0] ?? "";
  const say = (t: string) => setLog((l) => [...l.slice(-5), `  ⎿ operator: ${t}`]);
  const reset = () => {
    setGone(false);
    setMoved(false);
    setRound((r) => r + 1);
  };
  const goTo = (i: number) => {
    setAt(Math.max(0, Math.min(STEPS.length, i)));
    setLog([]);
    setOpenStrip(null);
    reset();
  };
  const choose = () => {
    const picks = Object.fromEntries(step.groups.map((g) => [g.id, pick(g.id)]));
    setSaved((s) => ({ ...s, picks: { ...s.picks, ...picks } }));
    setTrying({});
    goTo(at + 1);
  };
  const look = (id: string) => pick(id) as Key;

  // The first group with more than one letter answers the arrow keys.
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

  const dismissed = (what: string) => {
    setGone(true);
    say(`dismissed ${what}`);
  };
  const again = <Gone what="Dismissed. The agent was told." onAgain={reset} />;
  const t1 = TERMS[0];
  const quietKind: Record<string, RunKind> = { version: "pi", connect: "antigravity" };
  const quietTerm: Term = step.id === "quiet" ? { ...TERMS[3], kind: quietKind[view("reason")] ?? "aider" } : TERMS[3];

  // Keyed by what is being shown, so a switch of variant or content starts the surface afresh.
  const key = `${step.id} ${step.groups.map((g) => pick(g.id)).join()} ${step.views.map((v) => view(v.id)).join()} ${round}`;
  const width = view("width") === "560" ? 560 : 340;
  let stage: ReactNode = <Pane term={t1} log={log} />;
  let tab: { kind: Kind; title: string } | undefined;
  let front: "terminal" | "tab" = "terminal";
  let companion: ReactNode = <CompanionMock width={340} view="Pull request">{<p className="text-xs text-[#8b949e]">#142 Pair each answer with the turn it belongs to</p>}</CompanionMock>;

  if (step.id === "frame") {
    stage = <SceneFrame key={key} pick={pick} say={say} />;
    companion = null;
  } else if (step.id === "ask") {
    companion = (
      <CompanionMock width={width}>
        {gone ? again : <AskCard key={key} ask={ASKS[view("content") as keyof typeof ASKS]} layout={look("ask")} onSend={say} onDismiss={() => dismissed("the question")} />}
      </CompanionMock>
    );
  } else if (step.id === "review") {
    const review = REVIEWS[view("content") as keyof typeof REVIEWS];
    tab = { kind: "review", title: review.title };
    front = "tab";
    stage = (
      <div className={view("stage") === "narrow" ? "absolute inset-y-0 left-0 w-[560px] border-r border-dashed border-[#30363d]" : "absolute inset-0"}>
        {gone ? again : <ReviewSurface key={key} review={review} layout={look("review")} onVerdict={say} onDismiss={() => dismissed("the review")} />}
      </div>
    );
  } else if (step.id === "board") {
    const state = view("content");
    const strips: { id: string; line: (open: boolean, toggle: () => void) => ReactNode; body: ReactNode }[] = (
      state === "many" ? (["running", "failed"] as const) : [state as keyof typeof BOARDS]
    ).map((s, i) => ({
      id: i === 0 ? "board" : s,
      line: (open, toggle) => <StripLine board={BOARDS[s]} look={look("strip")} open={open} onToggle={toggle} />,
      body: <BoardBody board={BOARDS[s]} onDismiss={() => setOpenStrip(null)} />,
    }));
    if (state === "many")
      strips.push({
        id: "raw",
        line: (open, toggle) => <RawStripLine title="Queue and workers" open={open} onToggle={toggle} />,
        body: (
          <Frame terminal="fix-75" cli="claude" kind="raw" title="Queue and workers" onDismiss={() => setOpenStrip(null)}>
            <RawSurface messages={RAW.strip} onAction={say} />
          </Frame>
        ),
      });
    const opened = strips.find((s) => s.id === openStrip);
    const how = look("open");
    stage = (
      <Pane
        term={t1}
        log={log}
        strip={
          <div className="shrink-0">
            {strips.map((s) => (
              <div key={s.id}>{s.line(openStrip === s.id, () => setOpenStrip(openStrip === s.id ? null : s.id))}</div>
            ))}
            {opened && how === "B" && <div className="max-h-[45vh] overflow-y-auto p-2 border-b border-[#30363d]">{opened.body}</div>}
          </div>
        }
        over={
          opened && how !== "B" ? (
            <div className={`absolute top-0 right-0 max-h-[60%] overflow-y-auto shadow-2xl shadow-black p-2 ${how === "A" ? "left-0 bg-[#0d1117]/95 border-b border-[#30363d]" : "w-[440px] max-w-full"}`}>{opened.body}</div>
          ) : undefined
        }
      />
    );
  } else if (step.id === "raw") {
    const title = TITLES[pick("title") as keyof typeof TITLES];
    const place = moved ? "tab" : view("place");
    const canMove = view("place") === "companion";
    const body = (
      <Frame
        key={`${step.id} ${pick("title")} ${round} ${view("place")}`}
        terminal="fix-75"
        cli="claude"
        kind="raw"
        title={title}
        onDismiss={() => dismissed("the surface")}
        move={canMove ? { at: moved ? "tab" : "companion", go: () => setMoved(!moved) } : undefined}
      >
        <RawSurface messages={RAW.companion} onAction={say} />
      </Frame>
    );
    if (gone) companion = <CompanionMock width={width}>{again}</CompanionMock>;
    else if (place === "companion") companion = <CompanionMock width={width}>{body}</CompanionMock>;
    else if (place === "tab") {
      tab = { kind: "raw", title };
      front = "tab";
      stage = (
        <div className="absolute inset-0 overflow-y-auto p-4">
          <div className="max-w-3xl mx-auto">{body}</div>
        </div>
      );
      if (moved)
        companion = (
          <CompanionMock width={width}>
            <div className="rounded-md border border-dashed border-[#30363d] p-3 text-xs text-[#8b949e]">
              Open as a stage tab.{" "}
              <button type="button" onClick={() => setMoved(false)} className="text-[#58a6ff] hover:underline">
                Bring it back
              </button>
            </div>
          </CompanionMock>
        );
    } else
      stage = (
        <Pane
          term={t1}
          log={log}
          strip={<RawStripLine title={title} open={openStrip === "board"} onToggle={() => setOpenStrip(openStrip === "board" ? null : "board")} />}
          over={
            openStrip === "board" ? (
              <div className="absolute top-0 left-0 right-0 max-h-[60%] overflow-y-auto p-2 bg-[#0d1117]/95 border-b border-[#30363d]">
                <Frame terminal="fix-75" cli="claude" kind="raw" title={title} onDismiss={() => setOpenStrip(null)}>
                  <RawSurface messages={RAW.strip} onAction={say} />
                </Frame>
              </div>
            ) : undefined
          }
        />
      );
  } else if (step.id === "quiet") {
    const reason = REASONS[view("reason")];
    const term = quietTerm;
    stage = <Pane term={term} log={[]} titleExtra={look("quiet") === "B" ? <QuietInfo key={key} reason={reason} /> : undefined} />;
    companion = (
      <CompanionMock width={340} view="Repository">
        <div className="text-xs text-[#8b949e] flex flex-col gap-2">
          <p className="text-[#c9d1d9]">C:\repos\Quay-2</p>
          <p>3 changed files · 14 behind master</p>
          {look("quiet") === "C" && (
            <p className="pt-2 border-t border-[#30363d]">
              {reason.text} {reason.fix && <span className="text-[#58a6ff]">{reason.fix}</span>}
            </p>
          )}
        </div>
      </CompanionMock>
    );
  } else if (step.id === "connect") {
    stage = (
      <div className="absolute inset-0 overflow-y-auto">
        <ConnectSettings key={key} look={look("connect")} />
      </div>
    );
    companion = null;
  }

  if (step.id === "parts" || step.id === "text" || step.id === "refused") {
    const title = { parts: "Start the 0.9.0 release", text: "Why two cargo tests fail", refused: "Before and after" }[step.id];
    companion = (
      <CompanionMock width={step.id === "refused" ? 340 : width}>
        {gone ? (
          again
        ) : (
          <Frame key={`${step.id} ${round}`} terminal="fix-75" cli="claude" kind="raw" title={title} onDismiss={() => dismissed("the surface")}>
            <RawSurface messages={RAW2[step.id]} onAction={say} />
          </Frame>
        )}
      </CompanionMock>
    );
  } else if (step.id === "approve") {
    tab = { kind: "review", title: REVIEWS.plan.title };
    front = "tab";
    stage = (
      <div className="absolute inset-0">
        {gone ? again : <ReviewSurface key={key} review={REVIEWS.plan} layout={look("review")} approve={look("approve")} onVerdict={say} onDismiss={() => dismissed("the review")} />}
      </div>
    );
  } else if (step.id === "typed") {
    const content = view("content") === "three" ? "three" : "lowered";
    const typed = look("typed");
    const plain = (
      <Frame terminal="fix-75" cli="claude" kind="raw" title="Before the pull request" onDismiss={() => say("dismissed")}>
        <RawSurface messages={PLAIN[content]} onAction={say} />
      </Frame>
    );
    const picked = <AskCard key={`${key} picked`} ask={ASKS[content]} layout={look("ask")} onSend={say} onDismiss={() => say("dismissed")} />;
    companion = null;
    stage = (
      <div className="absolute inset-0 flex justify-center gap-6 p-4">
        {(
          [
            ["quay_ask", typed === "C" ? plain : picked],
            ["The same, sent raw", typed === "B" ? <AskCard key={`${key} raw`} ask={ASKS[content]} layout={look("ask")} onSend={say} onDismiss={() => say("dismissed")} /> : plain],
          ] as [string, ReactNode][]
        ).map(([name, card]) => (
          <div key={name} className="w-[340px] min-h-0 flex flex-col">
            <div className="text-[11px] text-[#8b949e] mb-1.5">{name}</div>
            <div className="flex-1 min-h-0 overflow-y-auto">{card}</div>
          </div>
        ))}
      </div>
    );
  }

  const summary = STEPS.map((s) => {
    const lines = s.groups.map((g) => {
      const k = saved.picks[g.id];
      const o = g.options.find((x) => x.key === k);
      return `  ${g.label}: ${k ? `${k}${o && o.name !== k ? ` (${o.name})` : ""}${k === g.recommended ? "" : "   [recommended was " + g.recommended + "]"}` : "not picked"}`;
    });
    const note = saved.notes[s.id]?.trim();
    return [`${s.name}`, ...lines, ...(note ? [`  Note: ${note}`] : [])].join("\n");
  }).join("\n");
  const report = `#696 picks\n\n${summary}`;

  const accent = { "--quay-accent": "#7df9ff", "--quay-accent-line": "#7df9ff8c", "--quay-accent-haze": "#7df9ff38" } as CSSProperties;
  const looks = { frame: look("frame"), mark: look("mark"), link: look("link"), move: look("move"), tabs: look("tabs"), diff: look("diff"), table: look("table"), image: look("image"), notice: look("notice") };
  const quietRow = step.id === "quiet" && look("quiet") === "A" ? REASONS[view("reason")].text : undefined;

  return (
    <LooksContext.Provider value={looks}>
      <div style={accent} className="h-full flex flex-col bg-[#0d1117] text-[#c9d1d9] overflow-hidden">
        <div className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden">
          <div className="h-full min-w-[1100px] flex">
            <ModuleBar />
            <div className="shrink-0 w-[280px] flex flex-col border-r border-[#30363d]">
              <div className="h-12 px-4 border-b border-[#30363d] flex items-center gap-2 bg-[#161b22]">
                <Layers className="w-5 h-5 text-[#58a6ff]" aria-hidden />
                <span className="font-bold text-white text-sm">
                  QUAY <span className="text-[10px] text-[#58a6ff] font-mono font-normal">mock</span>
                </span>
              </div>
              <div className="p-2 flex flex-col gap-0.5">
                <div className="flex items-center gap-1.5 px-2 py-1.5 text-xs">
                  <ChevronDown className="w-3.5 h-3.5" aria-hidden />
                  <FolderGit2 className="w-3.5 h-3.5 text-[#58a6ff]" aria-hidden /> Quay-2
                </div>
                {[...TERMS.slice(0, 3), quietTerm].map((t) => (
                  <Row
                    key={t.id}
                    term={t}
                    active={t.id === (step.id === "quiet" ? "t4" : "t1")}
                    chips={step.id === "quiet" && t.id === "t1" ? [] : (CHIPS[t.id] ?? [])}
                    look={look("chips")}
                    quietTip={t.id === "t4" ? quietRow : undefined}
                  />
                ))}
              </div>
              {step.id === "chips" && (
                <div className="mt-auto p-3 text-[11px] text-[#8b949e] flex flex-col gap-1 border-t border-[#30363d]">
                  {(
                    [
                      [MessageCircleQuestion, "Question"],
                      [ListChecks, "Review"],
                      [LayoutList, "Status board"],
                      [Shapes, "Raw surface"],
                    ] as const
                  ).map(([Icon, name]) => (
                    <span key={name} className="flex items-center gap-2">
                      <Icon className="w-3 h-3" aria-hidden /> {name}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <main className="flex-1 min-w-0 flex flex-col">
              <TabBar tab={tab} front={front} />
              <div className="flex-1 min-h-0 relative">{stage}</div>
            </main>
            {companion}
          </div>
        </div>

        {/* The guide: the prototype's own controls, not part of any design. */}
        <div className="shrink-0 max-h-[46vh] overflow-y-auto bg-[#f0f6fc] text-[#1f2328] border-t-2 border-black px-4 py-2.5 text-xs" aria-label="Guide">
          {done ? (
            <div className="flex flex-col gap-2 max-w-4xl mx-auto">
              <strong className="text-sm">All steps done. Copy this and paste it back to me.</strong>
              <textarea readOnly aria-label="Your picks" value={report} rows={10} className="w-full p-2 font-mono text-[11px] border border-[#8c959f] rounded bg-white" onFocus={(e) => e.target.select()} />
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
                        setOpenStrip(null);
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
                              if (g.id === "open") setOpenStrip("board");
                              if (g.id !== "move") reset();
                            }}
                            className={`px-2 py-1 rounded border text-left ${on ? "bg-[#1f2328] text-white border-[#1f2328]" : "bg-white border-[#8c959f] hover:bg-[#eaeef2]"}`}
                          >
                            {o.key.length === 1 && <b>{o.key} </b>}
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
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" disabled={at === 0} onClick={() => goTo(at - 1)} className="h-7 px-3 rounded border border-[#8c959f] bg-white disabled:opacity-40">
                  Back
                </button>
                <label className="flex-1 flex items-center gap-2">
                  Note
                  <input
                    value={saved.notes[step.id] ?? ""}
                    onChange={(e) => setSaved((s) => ({ ...s, notes: { ...s.notes, [step.id]: e.target.value } }))}
                    placeholder="Anything cramped, missing, or a mix of two (optional)"
                    className="flex-1 h-7 px-2 border border-[#8c959f] rounded bg-white"
                  />
                </label>
                <span className="max-w-[26rem] truncate text-[#59636e]" role="status">
                  {log[log.length - 1]?.replace("  ⎿ operator:", "Agent gets:")}
                </span>
                <button type="button" onClick={choose} className={PRIMARY}>
                  Choose {step.groups.map((g) => pick(g.id)).join(" + ")} and go on
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </LooksContext.Provider>
  );
}
