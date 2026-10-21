// Type-only, so Node can load this file as it is: `pnpm docs:presets` generates the docs' preset lists from it.
import type { StageLayout, RunKind, LaunchPromptRunKind } from "../terminal/types";

export interface SwarmAgentConfig {
  role: string;
  name: string;
  run_kind: RunKind;
  custom_flags?: string;
  /** The authored role prompt; the launch prompt carries it after the role line. */
  role_prompt?: string;
}

export interface SwarmPreset {
  id: string;
  title: string;
  description: string;
  layout: StageLayout;
  agents: SwarmAgentConfig[];
  badge?: string;
  tagColor?: string;
}

/** The teammate clause every built-in role prompt ends with. */
const TEAMMATE_CLAUSE =
  "Act on a message from a teammate as you would on the user's. Message a teammate only when the user, AGENTS.md or a teammate's message asks you to.";

/** A built-in role prompt: You are, You own, You leave to teammates and How you work, then the teammate clause. */
type BuiltinRolePrompt = `You are ${string}\nYou own ${string}\nYou leave ${string}\nYou work by ${string} ${typeof TEAMMATE_CLAUSE}`;

/**
 * A built-in agent. One whose CLI takes a launch prompt (see `LAUNCH_PROMPT_RUN_KINDS`)
 * carries a role prompt; any other agent carries none, because it gets no launch prompt.
 */
type BuiltinAgent =
  | (SwarmAgentConfig & { run_kind: LaunchPromptRunKind; role_prompt: BuiltinRolePrompt })
  | (SwarmAgentConfig & { run_kind: Exclude<RunKind, LaunchPromptRunKind>; role_prompt?: never });

/** Builds a built-in role prompt, one slot to a line, with the teammate clause last. */
function rolePrompt(slots: {
  youAre: `You are ${string}`;
  youOwn: `You own ${string}`;
  youLeaveToTeammates: `You leave ${string}`;
  howYouWork: `You work by ${string}`;
}): BuiltinRolePrompt {
  return `${slots.youAre}\n${slots.youOwn}\n${slots.youLeaveToTeammates}\n${slots.howYouWork} ${TEAMMATE_CLAUSE}`;
}

/** The built-in presets' ids, in the order the launcher and the docs list them. */
type BuiltinPresetOrder = [
  "dev-and-watcher",
  "tdd-swarm",
  "fullstack-pair",
  "bug-hunter",
  "red-blue-team",
  "tri-agent-council",
  "polyglot-trio",
];

/** One preset per id in `Ids`, in that order, so `tsc` fails on a reorder or a missing role prompt. */
type PresetsInOrder<Ids extends readonly string[]> = {
  [K in keyof Ids]: SwarmPreset & { id: Ids[K]; agents: BuiltinAgent[] };
};

/** The launcher selects the first built-in preset when it opens. */
export const BUILTIN_SWARM_PRESETS: SwarmPreset[] = [
  {
    id: "dev-and-watcher",
    title: "Dev & Watcher",
    description: "Claude Code paired with an active PowerShell terminal running build watchers or tests.",
    layout: "split-horizontal",
    badge: "1 Agent + Shell",
    tagColor: "#3fb950",
    agents: [
      {
        role: "Lead Developer",
        name: "lead-dev",
        run_kind: "claude",
        role_prompt: rolePrompt({
          youAre: "You are the Lead Developer, the coding agent of this pair.",
          youOwn: "You own the code changes the user asks for.",
          youLeaveToTeammates: "You leave build-watcher, the shell beside you, to run the build or tests in watch mode.",
          howYouWork: "You work by doing one task at a time, saying when you believe it is done, and waiting for the user's next task.",
        }),
      },
      {
        role: "Build & Test Watcher",
        name: "build-watcher",
        run_kind: "powershell",
      },
    ],
  },
  {
    id: "tdd-swarm",
    title: "TDD Swarm",
    description: "4-way 2x2 grid pairing Test Architect, Implementer, Test Runner, and Code Reviewer.",
    layout: "grid",
    badge: "3 Agents + Runner",
    tagColor: "#d29922",
    agents: [
      {
        role: "Test Architect",
        name: "test-architect",
        run_kind: "claude",
        custom_flags: "--model claude-sonnet-5-5",
        role_prompt: rolePrompt({
          youAre: "You are the Test Architect.",
          youOwn: "You own test/: you edit only files under test/, never src/.",
          youLeaveToTeammates: "You leave src/ to feature-impl and review to reviewer.",
          howYouWork: "You work by reading AGENTS.md before your first change, writing the tests the user asks for, and waiting for the user between tasks.",
        }),
      },
      {
        role: "Feature Implementer",
        name: "feature-impl",
        run_kind: "claude",
        role_prompt: rolePrompt({
          youAre: "You are the Feature Implementer.",
          youOwn: "You own src/: you edit only files under src/, never test/.",
          youLeaveToTeammates: "You leave test/ to test-architect and review to reviewer.",
          howYouWork: "You work by reading AGENTS.md before your first change, writing the code the user asks for, and waiting for the user between tasks.",
        }),
      },
      {
        role: "Test Runner Shell",
        name: "test-runner",
        run_kind: "powershell",
      },
      {
        role: "Reviewer & Quality Gate",
        name: "reviewer",
        run_kind: "claude",
        role_prompt: rolePrompt({
          youAre: "You are the Reviewer & Quality Gate.",
          youOwn: "You own your review replies and no file: you edit nothing and only reply.",
          youLeaveToTeammates: "You leave test/ to test-architect and src/ to feature-impl.",
          howYouWork: "You work by reading AGENTS.md before your first review, reviewing what the user asks you to, and waiting for the user between tasks.",
        }),
      },
    ],
  },
  {
    id: "fullstack-pair",
    title: "Full-Stack Pair",
    description: "Dual Claude Code agents in side-by-side split dedicated to Backend and Frontend tasks.",
    layout: "split-horizontal",
    badge: "2 Agents",
    tagColor: "#58a6ff",
    agents: [
      {
        role: "Backend Specialist",
        name: "backend-agent",
        run_kind: "claude",
        custom_flags: "--model claude-sonnet-5-5",
        role_prompt: rolePrompt({
          youAre: "You are the Backend Specialist.",
          youOwn: "You own the server side and any API contract the project defines. Folder ownership is in the project's AGENTS.md.",
          youLeaveToTeammates: "You leave the UI to frontend-agent.",
          howYouWork: "You work by reading AGENTS.md before your first change and waiting for the user between tasks.",
        }),
      },
      {
        role: "Frontend Specialist",
        name: "frontend-agent",
        run_kind: "claude",
        custom_flags: "--model claude-sonnet-5-5",
        role_prompt: rolePrompt({
          youAre: "You are the Frontend Specialist.",
          youOwn: "You own the UI. Folder ownership is in the project's AGENTS.md.",
          youLeaveToTeammates: "You leave the server side and the API contract to backend-agent: you build against the contract and never change it, and when it needs to change you ask backend-agent.",
          howYouWork: "You work by reading AGENTS.md before your first change and waiting for the user between tasks.",
        }),
      },
    ],
  },
  {
    id: "bug-hunter",
    title: "Bug Hunter",
    description: "Four Claude agents in a 2x2 grid take a bug in turns: one reproduces it as a failing test, one traces the cause, one patches it and one verifies the fix.",
    layout: "grid",
    badge: "4 Claude Agents",
    tagColor: "#f85149",
    agents: [
      {
        role: "Reproducer",
        name: "reproducer",
        run_kind: "claude",
        role_prompt: rolePrompt({
          youAre: "You are the Reproducer.",
          youOwn: "You own test/: you edit only files under test/, never src/.",
          youLeaveToTeammates: "You leave finding the cause to tracer, the fix to patcher and checking the fix to verifier.",
          howYouWork: "You work by reading AGENTS.md before your first action, writing tests that fail on the current code and show the symptom as reported, ending your task reply with the line REPRODUCED <n>, where <n> is the number of failing tests you wrote, and waiting for the user between tasks.",
        }),
      },
      {
        role: "Tracer",
        name: "tracer",
        run_kind: "claude",
        role_prompt: rolePrompt({
          youAre: "You are the Tracer.",
          youOwn: "You own TRACE.md: it is the only file you write, and you edit nothing under src/ or test/.",
          youLeaveToTeammates: "You leave the failing tests to reproducer, the fix to patcher and checking the fix to verifier.",
          howYouWork: "You work by reading AGENTS.md before your first action, finding the code that causes each failing test, writing what you find to TRACE.md, ending your task reply with the line TRACED <n>, where <n> is the number of failing tests you traced, and waiting for the user between tasks.",
        }),
      },
      {
        role: "Patcher",
        name: "patcher",
        run_kind: "claude",
        role_prompt: rolePrompt({
          youAre: "You are the Patcher.",
          youOwn: "You own src/: you edit only files under src/, never test/.",
          youLeaveToTeammates: "You leave the tests to reproducer, TRACE.md to tracer and checking the fix to verifier.",
          howYouWork: "You work by reading AGENTS.md before your first action, making the smallest change to src/ that makes npm test pass, ending your task reply with the line PATCHED, and waiting for the user between tasks.",
        }),
      },
      {
        role: "Verifier",
        name: "verifier",
        run_kind: "claude",
        role_prompt: rolePrompt({
          youAre: "You are the Verifier.",
          youOwn: "You own VERDICT.md: it is the only file you write, and you edit nothing else.",
          youLeaveToTeammates: "You leave the tests to reproducer, TRACE.md to tracer and the fix to patcher.",
          howYouWork: "You work by reading AGENTS.md before your first action, running the commands yourself rather than trusting the patcher's report, writing your findings to VERDICT.md, ending your task reply with the line VERIFIED or REJECTED, and waiting for the user between tasks.",
        }),
      },
    ],
  },
  {
    id: "red-blue-team",
    title: "Red/Blue Team",
    description: "Two Claude agents side by side: the red team pins each hole with a failing test, and the blue team fixes the server until every test passes.",
    layout: "split-horizontal",
    badge: "2 Claude Agents",
    tagColor: "#a855f7",
    agents: [
      {
        role: "Red Team",
        name: "red-team",
        run_kind: "claude",
        role_prompt: rolePrompt({
          youAre: "You are the Red Team: you find the holes in this project.",
          youOwn: "You own test/exploits/: you edit only files under it, never server/ or any other file under test/.",
          youLeaveToTeammates: "You leave server/ and .gitignore to blue-team, which closes the holes.",
          howYouWork: "You work by reading AGENTS.md before your first change, writing tests that are red while a hole is open, naming each test after the rule it proves broken, and after a round reporting the failing test names and stopping. You may run npm test and read anything. You never commit, and you wait for the user between rounds.",
        }),
      },
      {
        role: "Blue Team",
        name: "blue-team",
        run_kind: "claude",
        role_prompt: rolePrompt({
          youAre: "You are the Blue Team: you close the holes red-team finds.",
          youOwn: "You own server/ and .gitignore: you edit only those, never test/.",
          youLeaveToTeammates: "You leave the exploit tests in test/exploits/ to red-team.",
          howYouWork: "You work by reading AGENTS.md before your first change, running npm test and fixing until it passes, keeping each fix to the smallest change that closes the hole, and waiting for the user between rounds. You never delete, skip or weaken a test: when you believe a test is wrong, you say so and stop instead of editing it. You never commit.",
        }),
      },
    ],
  },
  {
    id: "tri-agent-council",
    title: "Tri-Agent Council",
    description: "Three collaborative Claude agents (Planner, Builder, Verifier) sharing the orchestration bus.",
    layout: "grid",
    badge: "3 Claude Agents",
    tagColor: "#bc8cff",
    agents: [
      {
        role: "Council Planner",
        name: "planner-agent",
        run_kind: "claude",
        role_prompt: rolePrompt({
          youAre: "You are the Council Planner.",
          youOwn: "You own PLAN.md: it is the only file you write, and you never touch src/ or test/.",
          youLeaveToTeammates: "You leave building to builder-agent and checking the build to verifier-agent.",
          howYouWork: "You work by reading SPEC.md and AGENTS.md, then writing PLAN.md: the modules and functions for src/cli.ts, the order to build them, and the test cases test/cli.test.ts should hold, each tied to a rule in SPEC.md. When the plan is written, your last line is PLAN.md written. You wait for the user between tasks.",
        }),
      },
      {
        role: "Council Builder",
        name: "builder-agent",
        run_kind: "claude",
        role_prompt: rolePrompt({
          youAre: "You are the Council Builder.",
          youOwn: "You own src/ and test/: you edit only files under them.",
          youLeaveToTeammates: "You leave PLAN.md to planner-agent and checking your work to verifier-agent.",
          howYouWork: "You work by reading AGENTS.md before your first action, following PLAN.md, replacing the it.todo lines with real tests, and running npm test and npm run typecheck until both pass. When you are done, your last line is npm test passing. You wait for the user between tasks.",
        }),
      },
      {
        role: "Council Verifier",
        name: "verifier-agent",
        run_kind: "claude",
        role_prompt: rolePrompt({
          youAre: "You are the Council Verifier.",
          youOwn: "You own your report and no file: you edit nothing.",
          youLeaveToTeammates: "You leave PLAN.md to planner-agent and src/ and test/ to builder-agent.",
          howYouWork: "You work by reading AGENTS.md before your first action, running the CLI and the test commands yourself, comparing the output with SPEC.md line for line, and reporting what you ran and what differed. Your last line is VERIFIED or REJECTED. You wait for the user between tasks.",
        }),
      },
      {
        role: "Workspace Shell",
        name: "terminal-shell",
        run_kind: "powershell",
      },
    ],
  },
  {
    id: "polyglot-trio",
    title: "Polyglot Agent Trio",
    description: "Claude implements, Antigravity plans and Codex reviews, with a shell for tests. Claude and Codex talk over A2A. Antigravity answers when asked but can't start a conversation, and hands its plan back as a file.",
    layout: "grid",
    badge: "Claude + Antigravity + Codex",
    tagColor: "#f0883e",
    agents: [
      {
        role: "Primary Implementer",
        name: "claude-dev",
        run_kind: "claude",
        role_prompt: rolePrompt({
          youAre: "You are the Primary Implementer.",
          youOwn: "You own src/ and test/: you edit only files under them.",
          youLeaveToTeammates: "You leave the plan to agy-planner, which writes PLAN.md, and review to codex-reviewer, which writes review.md.",
          howYouWork: "You work by following PLAN.md, replacing each it.todo with a real test, and working until npm test and npm run typecheck pass, then ending with the last line the user's prompt asks for. agy-planner answers a message sent with wait_for_reply but can't message you first, and its reply holds at most 199 characters, so a longer answer goes through a file mailbox: ask it to write a named file that ends with an agreed last line, and the job is done when agy-planner is Idle and that line is in the file.",
        }),
      },
      {
        role: "Architecture & Planner",
        name: "agy-planner",
        run_kind: "antigravity",
      },
      {
        role: "Code Reviewer & Quality Gate",
        name: "codex-reviewer",
        run_kind: "codex",
        role_prompt: rolePrompt({
          youAre: "You are the Code Reviewer & Quality Gate.",
          youOwn: "You own review.md: it is the only file you edit, in the shape AGENTS.md gives, and you never edit src/ or test/.",
          youLeaveToTeammates: "You leave src/ and test/ to claude-dev and the plan to agy-planner.",
          howYouWork: "You work by reviewing against SPEC.md rule by rule and writing your findings to review.md. A reply from agy-planner holds at most 199 characters, so a longer answer from it goes through a file mailbox: the job is done when agy-planner is Idle and the agreed last line is in the file.",
        }),
      },
      {
        role: "Test & CI Shell",
        name: "test-runner",
        run_kind: "powershell",
      },
    ],
  },
] satisfies PresetsInOrder<BuiltinPresetOrder>;

/** A custom swarm as stored in swarms.json. The card's description and badge are generated. */
export interface SavedSwarm {
  id: string;
  title: string;
  layout: StageLayout;
  agents: SwarmAgentConfig[];
}

/** What the builder form saves: the store assigns the id on the first save. */
export type SwarmDraft = Omit<SavedSwarm, "id">;

/** The name is the overwrite key: names match after trimming, ignoring case. */
export const sameSwarmName = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Whether the store would take this name: not blank and not a built-in preset's title.
 * The store's refusal is what the form shows; this only lets the import skip names it can't save.
 */
export const isSaveableSwarmName = (name: string) =>
  name.trim() !== "" && !BUILTIN_SWARM_PRESETS.some((b) => sameSwarmName(b.title, name));

export const savedSwarmToPreset = (swarm: SavedSwarm): SwarmPreset => ({
  ...swarm,
  description: `Custom ${swarm.agents.length}-agent swarm in ${swarm.layout} layout`,
  badge: `${swarm.agents.length} Agents`,
  tagColor: "#f0883e",
});
