import type { LinkRef } from "../terminal/types.ts";
import type { LinkSignal } from "./terminalLink.ts";

/** One finished tool call as the bridge keeps it: the command the agent ran and what it printed. */
export interface ToolCall {
  command: string;
  result: string;
  /** Whether the call ran and succeeded; a denied or failed call says nothing about the terminal. */
  ok: boolean;
}

/** What one tool call says about the terminal's link. */
export interface ToolCallActivity {
  signals: LinkSignal[];
  /** A folder the agent moved into or created a worktree at, whose branch is re-derived; null when none. */
  folder: string | null;
  /** The branch a created worktree checks out, when the command names it; null when it doesn't. */
  branch: string | null;
}

/** A GitHub repository's `owner/name`, as a regular expression fragment with no groups. */
export const OWNER_NAME_PATTERN = String.raw`[\w.-]+\/[\w.-]+`;

/** A GitHub pull request URL, with its repository and number. */
const PULL_URL = new RegExp(String.raw`https:\/\/github\.com\/(${OWNER_NAME_PATTERN})\/pull\/(\d+)`, "g");

/**
 * The link signals one tool call gives, read only from the commands the terminal link names:
 * `gh pr create` and the URL in its result. Any other output is never scanned.
 */
export function toolCallActivity(call: ToolCall, at: number): ToolCallActivity {
  const signals: LinkSignal[] = [];
  const activity: ToolCallActivity = { signals, folder: null, branch: null };
  if (!call.ok) return activity;
  for (const words of commands(call.command)) {
    if (isGh(words, "pr", "create")) {
      const created = lastPullUrl(call.result);
      if (created) signals.push({ slot: "pull_request", source: "activity", options: [created], at });
    } else if (isGh(words, "pr", "checkout")) {
      const ref = ghTarget(words, CHECKOUT_SWITCHES);
      if (ref) signals.push({ slot: "pull_request", source: "activity", options: [ref], at });
    } else if (isGh(words, "issue", "edit") && words.some((w) => w === "--add-assignee" || w.startsWith("--add-assignee="))) {
      const ref = ghTarget(words, ISSUE_EDIT_SWITCHES);
      if (ref) signals.push({ slot: "ticket", source: "activity", options: [ref], at });
    } else if (words[0] === "cd") {
      if (words[1] !== undefined) activity.folder = words[1];
    } else if (words[0] === "git") {
      const added = worktreeAdd(words);
      if (added) {
        activity.folder = added.folder;
        activity.branch = added.branch;
      }
    } else if (words[0] === "archon" && words[1] === "workflow" && words[2] === "run") {
      const ticket = archonTicket(words);
      if (ticket !== null) signals.push({ slot: "ticket", source: "activity", options: [{ repo: null, number: ticket }], at });
      const working = workingPath(call.result);
      if (working) activity.folder = working;
    }
  }
  return activity;
}

/** git's options before the subcommand that take a value. */
const GIT_VALUE_OPTIONS = new Set(["-C", "-c"]);
/** `git worktree add`'s options that take a value. */
const WORKTREE_ADD_VALUE_OPTIONS = new Set(["-b", "-B", "--reason"]);

/** The folder and created branch of a `git worktree add`, or null when `words` is another git command. */
function worktreeAdd(words: readonly string[]): { folder: string; branch: string | null } | null {
  let i = 1;
  while (i < words.length && words[i].startsWith("-")) i += GIT_VALUE_OPTIONS.has(words[i]) ? 2 : 1;
  if (words[i] !== "worktree" || words[i + 1] !== "add") return null;
  let branch: string | null = null;
  let folder: string | null = null;
  for (i += 2; i < words.length; i++) {
    const w = words[i];
    if (w.startsWith("-")) {
      if (WORKTREE_ADD_VALUE_OPTIONS.has(w)) {
        const value = words[++i];
        if ((w === "-b" || w === "-B") && value !== undefined) branch = value;
      }
    } else if (folder === null) {
      folder = w;
    }
  }
  return folder === null ? null : { folder, branch };
}

/** The `ticket` input of an `archon workflow run`, from `--input ticket=N`; null when it has none. */
export function archonTicket(words: readonly string[]): number | null {
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const input = w === "--input" ? words[i + 1] : w.startsWith("--input=") ? w.slice("--input=".length) : undefined;
    if (input?.startsWith("ticket=")) return positiveNumber(input.slice("ticket=".length).replace(/^#/, ""));
  }
  return null;
}

/** The `working_path` an Archon run reports in its output, or null. */
function workingPath(result: string): string | null {
  const m = /"?working_path"?\s*[:=]\s*(?:"((?:[^"\\]|\\.)*)"|([^\s",}]+))/.exec(result);
  if (!m) return null;
  return m[1] !== undefined ? m[1].replace(/\\(.)/g, "$1") : m[2];
}

/** Whether `words` run `gh <noun> <verb>`. */
function isGh(words: readonly string[], noun: string, verb: string): boolean {
  return words[0] === "gh" && words[1] === noun && words[2] === verb;
}

/** `gh pr checkout`'s flags that take no value. */
const CHECKOUT_SWITCHES = new Set(["--detach", "-f", "--force", "--recurse-submodules"]);
/** `gh issue edit`'s flags that take no value. */
const ISSUE_EDIT_SWITCHES = new Set(["--remove-milestone"]);

/**
 * The ticket or pull request a `gh <noun> <verb>` call targets: its first argument that is neither
 * a flag nor a flag's value, as a number or a GitHub URL, in the repository `-R` or `--repo` names.
 * Null when there is none, or it is not a positive whole number.
 */
function ghTarget(words: readonly string[], switches: ReadonlySet<string>): LinkRef | null {
  let repo: string | null = null;
  let target: string | null = null;
  for (let i = 3; i < words.length; i++) {
    const w = words[i];
    if (w.startsWith("-")) {
      const [flag, inline] = w.split("=", 2);
      const value = inline ?? (switches.has(flag) ? undefined : words[++i]);
      if ((flag === "-R" || flag === "--repo") && value !== undefined) repo = value;
    } else if (target === null) {
      target = w;
    }
  }
  if (target === null) return null;
  const url = pullOrIssueUrl(target);
  if (url) return url;
  const number = positiveNumber(target.replace(/^#/, ""));
  return number === null ? null : { repo: repo && OWNER_NAME.test(repo) ? repo : null, number };
}

/** `owner/name`, as `-R` takes it. */
const OWNER_NAME = new RegExp(`^${OWNER_NAME_PATTERN}$`);

/** `text` as a positive whole number, or null when it is anything else. */
export function positiveNumber(text: string): number | null {
  if (!/^\d{1,9}$/.test(text)) return null;
  const n = Number(text);
  return n > 0 ? n : null;
}

/** A GitHub pull request or issue URL, whole. */
const PULL_OR_ISSUE_URL = new RegExp(String.raw`^https:\/\/github\.com\/(${OWNER_NAME_PATTERN})\/(?:pull|issues)\/(\d+)\/?$`);

/** The ref a whole GitHub pull request or issue URL names, or null. */
function pullOrIssueUrl(text: string): LinkRef | null {
  const m = PULL_OR_ISSUE_URL.exec(text);
  const number = m ? positiveNumber(m[2]) : null;
  return m && number !== null ? { repo: m[1], number } : null;
}

/** The last pull request URL in `text`. */
function lastPullUrl(text: string): LinkRef | null {
  let found: LinkRef | null = null;
  for (const m of text.matchAll(PULL_URL)) {
    const number = positiveNumber(m[2]);
    if (number !== null) found = { repo: m[1], number };
  }
  return found;
}

/**
 * The simple commands in a shell command line, each as its words: split on `&&`, `||`, `;`, `|`
 * and line breaks, with single and double quotes removed. Enough to read `gh` and `git` calls.
 */
export function commands(line: string): string[][] {
  const out: string[][] = [];
  let words: string[] = [];
  let word = "";
  let inWord = false;
  let quote: '"' | "'" | null = null;
  const endWord = () => {
    if (inWord) words.push(word);
    word = "";
    inWord = false;
  };
  const endCommand = () => {
    endWord();
    if (words.length) out.push(words);
    words = [];
  };
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = null;
      else word += c;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      inWord = true;
    } else if (c === "&" || c === "|" || c === ";" || c === "\n") {
      endCommand();
    } else if (c === " " || c === "\t" || c === "\r") {
      endWord();
    } else {
      word += c;
      inWord = true;
    }
  }
  endCommand();
  return out;
}

/** The ticket a branch is named for: `ticket-N` or `feat/issue-N`. Null for any other branch. */
export function branchTicket(branch: string): number | null {
  const m = /^(?:ticket-|feat\/issue-)(\d+)$/.exec(branch);
  return m ? positiveNumber(m[1]) : null;
}

/**
 * The signals a working folder's branch gives, at `source`'s strength: the ticket it is named for,
 * and every open pull request in `openPullRequests` whose head branch it is. Two or more pull
 * requests tie; none gives a pull request signal with no options, which changes nothing.
 */
export function branchSignals(
  branch: string,
  openPullRequests: readonly { number: number; headRefName: string }[],
  source: "activity" | "branch",
  at: number,
): LinkSignal[] {
  const signals: LinkSignal[] = [];
  const ticket = branchTicket(branch);
  if (ticket !== null) signals.push({ slot: "ticket", source, options: [{ repo: null, number: ticket }], at });
  const options = openPullRequests.filter((pr) => pr.headRefName === branch).map((pr) => ({ repo: null, number: pr.number }));
  signals.push({ slot: "pull_request", source, options, at });
  return signals;
}

/**
 * The launch facts of a new terminal: the `ticket` input of the Archon run it was launched with,
 * and the ticket it was launched from, when it was launched from an issue or in a worktree created
 * from one.
 */
export function launchSignals(launch: { command_text?: string | null; ticket?: number | null }, at: number): LinkSignal[] {
  const fromRun = commands(launch.command_text ?? "")
    .filter((words) => words[0] === "archon")
    .map(archonTicket)
    .find((n) => n !== null);
  const ticket = launch.ticket ?? fromRun ?? null;
  return ticket === null ? [] : [{ slot: "ticket", source: "launch", options: [{ repo: null, number: ticket }], at }];
}
