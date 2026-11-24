// PROTOTYPE (#696), throwaway. The content the surfaces show: real fields as #698 fixed them, once
// at an ordinary size and once at every limit.

export interface Option {
  label: string;
  description?: string;
  recommended?: boolean;
}
export interface Question {
  question: string;
  options?: Option[];
  multiple?: boolean;
}
export interface Ask {
  context?: string;
  questions: Question[];
}
export interface Item {
  title: string;
  detail?: string;
  file?: string;
}
export interface Review {
  title: string;
  body: string;
  items?: Item[];
}
export type StepState = "pending" | "active" | "done" | "failed";
export interface Board {
  title: string;
  steps: { label: string; state: StepState; note?: string }[];
  stats: { label: string; value: string }[];
  status: "running" | "done" | "failed";
  elapsed: string;
  quiet?: string;
}

const FILLER =
  " The drawer keeps its own copy of the link, so both sides have to agree before the next turn starts. Nothing is written until the operator sends an answer. The worktree is left as it is, and a second run picks up from the same commit. Every caller in the bridge reads the same record, which is why the order matters here and not only in the panel.";
/** Stretches `text` with plausible prose to at most `n` characters, ending on a whole word. */
export const pad = (text: string, n: number) => {
  let out = text;
  while (out.length < n) out += FILLER;
  return `${out.slice(0, n - 1).replace(/[\s,.]*\s\S*$/, "")}.`;
};

const one: Ask = {
  context: "`master` moved **14 commits** since this branch was cut. Two of them touch `GithubCompanionDrawer.tsx`, which I am editing.",
  questions: [
    {
      question: "Which base should this branch take?",
      options: [
        { label: "Rebase onto master", description: "Replay 3 commits. I resolve the drawer conflict.", recommended: true },
        { label: "Merge master in", description: "One merge commit; history keeps both lines." },
        { label: "Leave it for now", description: "Finish the fix, deal with master at pull request time." },
      ],
    },
  ],
};

const three: Ask = {
  context: "The fix works. Three things are yours to decide before I open the pull request.",
  questions: [
    {
      question: "Delete the old pairing module?",
      options: [{ label: "Delete it", description: "Nothing imports it now.", recommended: true }, { label: "Keep it" }],
    },
    {
      question: "Which suites should I run first?",
      multiple: true,
      options: [{ label: "Unit tests", recommended: true }, { label: "Cargo tests" }, { label: "Tutorial checks" }, { label: "Benchmarks" }],
    },
    { question: "What should the pull request be called?" },
  ],
};

const limitQuestion = (n: number, multiple: boolean): Question => ({
  question: pad(`Question ${n}: how should the bridge treat an answer whose turn has already ended when it arrives?`, 200),
  multiple,
  options: [
    "Attach it to the turn that asked",
    "Drop it and write a line to the log",
    "Hold it for the next turn",
    "Ask me each time it happens",
    "Show it as its own entry",
    "Stop the terminal",
  ].map((label, i) => ({
    label: i === 0 ? pad(`${label} and mark it as late`, 60) : label,
    description: pad("The answer keeps its own id and waits in the store until something reads it.", 200),
    recommended: i === 0,
  })),
});
const limits: Ask = {
  context: pad(
    "Four answers shape the rest of this work. **Read the second one first**: it decides whether the store needs a new column.\n\n- `useTurns.ts` gives every turn an id\n- `pairAnswers.ts` matches by that id\n\n",
    1500,
  ),
  questions: [limitQuestion(1, false), limitQuestion(2, true), limitQuestion(3, false), { question: pad("Question 4: what should the operator see when an answer is dropped?", 200) }],
};
export const ASKS = { one, three, limits };

const plan: Review = {
  title: "Plan: pair each answer with its turn",
  body: `Answers are matched to turns **by arrival order**, so a late answer lands on the next turn. Five steps, about 200 lines, no schema change.

## What changes

Every turn gets an id when it starts. Each answer event carries that id, and \`pairAnswers\` matches on it. An answer with no matching turn is dropped.

| Case | Today | After |
|---|---|---|
| Answer in time | Paired | Paired |
| Late answer | Next turn | Its own turn |
| Duplicate | Paired twice | First wins |

## Two things to know

1. Step 2 changes an event that Codex terminals also emit.
2. Step 4 drops data silently. Say if you would rather log it.

\`\`\`ts
export function pairAnswers(turns: Turn[], answers: Answer[]) {
  const byId = new Map(turns.map((t) => [t.id, t]));
  return answers.filter((a) => byId.has(a.turnId));
}
\`\`\`

Background: [the original report](https://github.com/example/quay/issues/75).`,
  items: [
    { title: "Give every turn an id when it starts", detail: "The id is made on the turn-started event.", file: "src/slices/bridge/useTurns.ts" },
    { title: "Carry the turn id on each answer event", detail: "Codex terminals emit this event too, so their reader changes with it.", file: "src-tauri/src/slices/bridge/events.rs" },
    { title: "Pair answers by id, not by arrival order", file: "src/slices/companion/pairAnswers.ts" },
    { title: "Drop answers whose turn has gone", detail: "Silent today. A log line is the other choice.", file: "src/slices/companion/pairAnswers.ts" },
    { title: "Cover late and duplicate answers", file: "src/slices/companion/pairAnswers.test.ts" },
  ],
};

const section = (n: number) => `## Part ${n}: what moves and why

${pad("The bridge reads every event once and the companion reads it again.", 420)}

| File | Lines | Risk |
|---|---|---|
| \`useTurns.ts\` | +18 −2 | Low |
| \`pairAnswers.ts\` | +44 −29 | Medium |

- ${pad("The reader keeps the last event id it saw.", 160)}
- ${pad("The writer never waits for the reader.", 160)}

${pad("A second pass was considered and left out, because it needs the store to hold both forms for as long as any terminal is open.", 380)}
`;
export const REVIEWS: Record<"plan" | "limits" | "noItems", Review> = {
  plan,
  limits: {
    title: "Findings: every place the companion or the bridge pairs an answer with its turn",
    body: Array.from({ length: 18 }, (_, i) => section(i + 1)).join("\n").slice(0, 20000),
    items: Array.from({ length: 30 }, (_, i) => ({
      title: i % 4 === 0 ? pad(`${i + 1}. Change how the reader in this file treats an event it has already seen`, 120) : `${i + 1}. Pair by id in the reader`,
      detail: i % 3 === 0 ? pad("This one is worth a look.", 500) : i % 3 === 1 ? "A small change with a test beside it." : undefined,
      file: `src/slices/companion/reader${i + 1}.ts`,
    })),
  },
  noItems: { title: "Results: full suite on fix/75", body: plan.body.split("## Two things")[0] },
};

const LABELS = ["Give every turn an id", "Carry it on answer events", "Pair answers by id", "Drop stale answers", "Update ActivityView", "Update AgentsPanel", "Run the suite"];
const steps = (done: number, failed = false): Board["steps"] =>
  LABELS.map((label, i) => ({
    label,
    state: i < done ? "done" : i === done ? (failed ? "failed" : "active") : "pending",
    note: i === done ? (failed ? "2 tests failed in pairAnswers.test.ts" : "6 call sites left") : undefined,
  }));
const stats = (n: number, failed = 0) => [
  { label: "passed", value: String(n) },
  { label: "failed", value: String(failed) },
  { label: "files", value: "9" },
];
export const BOARDS: Record<"running" | "quiet" | "failed" | "done" | "limits", Board> = {
  running: { title: "Migrating call sites", steps: steps(3), stats: stats(186), status: "running", elapsed: "04:12" },
  quiet: { title: "Migrating call sites", steps: steps(3), stats: stats(186), status: "running", elapsed: "11:40", quiet: "updated 6 min ago" },
  failed: { title: "Release checks", steps: steps(6, true), stats: stats(184, 2), status: "failed", elapsed: "09:03" },
  done: { title: "Migrating call sites", steps: steps(7), stats: stats(188), status: "done", elapsed: "10:27" },
  limits: {
    title: "Migrating every call site in the bridge, the companion and the orchestrator too",
    steps: Array.from({ length: 30 }, (_, i) => ({
      label: i % 5 === 0 ? pad(`${i + 1}. Rewrite the reader and the writer in this slice together`, 80) : `${i + 1}. Rewrite the reader`,
      state: i === 4 ? "failed" : i < 11 ? "done" : i === 11 ? "active" : "pending",
      note: i === 11 ? pad("Waiting for the type checker.", 120) : i === 2 ? pad("Took a second try.", 120) : undefined,
    })),
    stats: ["tests passed", "tests failed", "files changed", "warnings left", "call sites remaining", "benchmark median"].map((label, i) => ({
      label,
      value: i === 5 ? "1,573 ms (max 1,500)" : String(186 - i * 31),
    })),
    status: "running",
    elapsed: "1:04:12",
  },
};

// Raw A2UI 1.0 messages, drawn by the official engine over Quay's components.
const text = (id: string, t: string, variant?: string) => ({ id, component: "Text", text: t, ...(variant ? { variant } : {}) });
const path = (p: string) => ({ "@path": p });
const surface = (surfaceId: string, components: object[], dataModel: object = {}) => [{ version: "1.0", createSurface: { surfaceId, components, dataModel } }];
export const RAW = {
  companion: surface(
    "raw-c",
    [
      { id: "root", component: "Column", children: ["intro", "cols", "keep", "dry", "note", "send"] },
      text("intro", "Pick how many **old worktrees** to clear. Nothing is removed until you send."),
      { id: "cols", component: "Row", children: ["c1", "c2", "c3"] },
      ...[
        ["1", "14", "merged"],
        ["2", "6", "closed, not merged"],
        ["3", "2.3 GB", "on disk"],
      ].flatMap(([n, v, l]) => [
        { id: `c${n}`, component: "Card", child: `cc${n}`, weight: 1 },
        { id: `cc${n}`, component: "Column", children: [`v${n}`, `l${n}`] },
        text(`v${n}`, `**${v}**`),
        text(`l${n}`, l, "caption"),
      ]),
      { id: "keep", component: "Slider", label: "Keep the newest", min: 0, max: 20, value: path("/keep") },
      { id: "dry", component: "CheckBox", label: "List them first, remove nothing", value: path("/dry") },
      { id: "note", component: "TextField", label: "Anything to leave alone?", value: path("/note") },
      {
        id: "send",
        component: "Button",
        variant: "primary",
        child: "sendt",
        action: { event: { name: "clear", context: { keep: path("/keep"), dry: path("/dry"), note: path("/note") } } },
      },
      text("sendt", "Clear worktrees"),
    ],
    { keep: 5, dry: true, note: "" },
  ),
  strip: surface("raw-s", [
    { id: "root", component: "Row", children: ["a", "b", "c"] },
    ...[
      ["a", "Queue", "12 waiting"],
      ["b", "Workers", "3 busy"],
      ["c", "Slowest", "graphFind, 1.57 s"],
    ].flatMap(([id, l, v]) => [
      { id, component: "Card", child: `${id}c`, weight: 1 },
      { id: `${id}c`, component: "Column", children: [`${id}l`, `${id}v`] },
      text(`${id}l`, l, "caption"),
      text(`${id}v`, `**${v}**`),
    ]),
  ]),
  lookalike: surface("raw-l", [
    { id: "root", component: "Column", children: ["t", "m", "row"] },
    text("t", "**QUAY · Permission needed**"),
    text("m", "Claude wants to run `git push --force`. Allow this command? Details: [github.com/quay/policy](https://github.com@policy.example.net/quay)"),
    { id: "row", component: "Row", children: ["ok", "no"] },
    { id: "ok", component: "Button", variant: "primary", child: "okt", action: { event: { name: "ok", context: {} } } },
    text("okt", "Allow once"),
    { id: "no", component: "Button", child: "not", action: { event: { name: "no", context: {} } } },
    text("not", "Deny"),
  ]),
};

export const TITLES: Record<"60" | "80" | "120", string> = {
  "60": "Worktree clean-up before the 0.9.0 release branch is cut now",
  "80": "Worktree clean-up before the 0.9.0 release branch is cut, oldest merged first",
  "120": "Worktree clean-up before the 0.9.0 release branch is cut, oldest merged first, skipping any with an open pull request",
};
