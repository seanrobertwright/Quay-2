// What the builder shows for a project's Praxis host condition (#448): the host chip's text label
// and tone, and the panel that says what to do about it. Every view that shows the host condition
// renders it from here, so the chip, the Workflow templates group header and the Runs view agree.
//
// Quay doesn't work around AI-WS-SDK#328: the praxis CLI never refreshes its 5-minute token on
// a real host, so about 5 minutes after `praxis login` the next call says the session expired,
// and the condition reads "Not signed in" with Sign in until the CLI is fixed.
import type { HostCondition, InteractiveCommand } from "./praxisHost.ts";

/** A `praxis` command a person runs in a visible terminal, and the button that opens it. */
export interface HostAction {
  command: InteractiveCommand;
  label: string;
}

/** The host actions, by command. Every view that offers one uses these. */
export const HOST_ACTIONS: Record<InteractiveCommand, HostAction> = {
  setup: { command: "setup", label: "Set up host" },
  serve: { command: "serve", label: "Start host" },
  login: { command: "login", label: "Sign in" },
  trust: { command: "trust", label: "Trust certificate" },
};

/** What a person can do about a condition. */
export type HostPanel =
  | { kind: "linkCli"; text: string; reason: string }
  | { kind: "terminal"; text: string; action: HostAction };

/** The chip's colour. It never carries the condition alone: the label does. */
export type HostTone = "neutral" | "ok" | "error" | "amber";

/** How a host condition is drawn. */
export interface HostConditionView {
  /** The chip's text, which carries the condition without its colour. */
  label: string;
  tone: HostTone;
  /** True while the host can't be used, which is when a view that needs it rechecks. */
  failing: boolean;
  panel: HostPanel | null;
  /** A standing notice shown for as long as the condition holds. */
  banner: string | null;
}

/** The text of the panel shown when the praxis CLI can't be run. */
export const LINK_CLI_TEXT =
  "Quay runs the praxis CLI from an AI-WS-SDK checkout, with Node 24 or later on PATH. " +
  "In the checkout's engine folder, run `npm link`.";

/** The simulated host's standing banner. */
export const SIMULATED_HOST_BANNER =
  "This is a simulated Praxis host: its approvals aren't made by a person. Don't treat its runs as reviewed.";

export function hostConditionView(condition: HostCondition): HostConditionView {
  const view = (label: string, tone: HostTone, panel: HostPanel | null = null): HostConditionView => ({
    label,
    tone,
    failing: tone === "error",
    panel,
    banner: null,
  });
  switch (condition.state) {
    case "notCheckedYet":
      return view("Host not checked yet", "neutral");
    case "cliNotFound":
      return view("praxis CLI not found", "error", { kind: "linkCli", text: LINK_CLI_TEXT, reason: condition.reason });
    case "noHostSetUp":
      return view("No host set up", "error", {
        kind: "terminal",
        text: "This machine has no Praxis host. Set one up in a terminal with `praxis setup`, answering its prompts.",
        action: HOST_ACTIONS.setup,
      });
    case "hostUnreachable":
      return view("Host down", "error", {
        kind: "terminal",
        text: "The Praxis host isn't answering. Start it in a terminal with `praxis serve`, and leave that terminal open.",
        action: HOST_ACTIONS.serve,
      });
    case "notSignedIn":
      return view("Not signed in", "error", {
        kind: "terminal",
        text: "praxis isn't signed in to the host, or its sign-in expired. Sign in in a terminal with `praxis login`.",
        action: HOST_ACTIONS.login,
      });
    case "signedIn":
      return view("Signed in", "ok");
    case "simulatedHost":
      return { ...view("Simulated host", "amber"), banner: SIMULATED_HOST_BANNER };
  }
}
