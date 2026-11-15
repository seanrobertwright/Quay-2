import type { TerminalLink } from "../terminal/types.ts";

/** What the diff lens shows: a terminal's pull request, opened on one of its files. */
export interface DiffLensTarget {
  /** The terminal whose pull request it is, which takes focus back when the lens closes. */
  terminalId: string;
  /** The terminal's repository, where `gh` runs. */
  repoPath: string;
  /** `owner/name`, or null for the repository at `repoPath`. */
  repo: string | null;
  number: number;
  /** The file the lens opens on, or null for the first. */
  file: string | null;
}

/** The diff lens for the pull request in `link`, opened on `file`; null when the terminal has none. */
export function diffLensFor(
  terminalId: string,
  repoPath: string,
  link: TerminalLink | null,
  file: string | null = null,
): DiffLensTarget | null {
  const slot = link?.pull_request;
  return slot ? { terminalId, repoPath, repo: slot.repo ?? null, number: slot.number, file } : null;
}
