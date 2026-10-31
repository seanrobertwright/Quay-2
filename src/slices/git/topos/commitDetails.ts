// Details mode's pure parts (#368, #397): the shapes the details commands return, and how a
// commit's body is shown.

import type { GraphAgent } from "./graphPage.ts";

/**
 * A piece of a commit body: plain text, or an http(s) URL shown as a link. `start` is the piece's
 * offset in the body, unique among the parts, so it serves as the piece's React key.
 */
export type BodyPart = { kind: "text"; text: string; start: number } | { kind: "link"; text: string; href: string; start: number };

/**
 * An http or https URL: the scheme at a word start, then everything up to whitespace, a quote or
 * an angle bracket. No other scheme is ever matched, so `javascript:`, `data:`, `mailto:` and
 * `file:` stay text.
 */
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`]+/gi;

/** Characters that end a sentence more often than a URL. */
const TRAILING = new Set([".", ",", ";", ":", "!", "?", ")", "]", "}"]);

function count(text: string, ch: string): number {
  return text.split(ch).length - 1;
}

/** `url` less the punctuation after it, keeping a `)` the URL itself opened. */
function trimUrl(url: string): string {
  let end = url.length;
  while (end > 0 && TRAILING.has(url[end - 1])) {
    const ch = url[end - 1];
    const head = url.slice(0, end);
    if (ch === ")" && count(head, "(") >= count(head, ")")) break;
    end--;
  }
  return url.slice(0, end);
}

/**
 * A commit body split into text and links (#368): only `http` and `https` URLs become links. The
 * parts are rendered as React text, so no commit text is ever parsed as HTML.
 */
export function linkify(text: string): BodyPart[] {
  const parts: BodyPart[] = [];
  let at = 0;
  const pushText = (end: number) => {
    if (end <= at) return;
    const last = parts[parts.length - 1];
    const piece = text.slice(at, end);
    if (last?.kind === "text") last.text += piece;
    else parts.push({ kind: "text", text: piece, start: at });
    at = end;
  };
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index;
    const url = trimUrl(match[0]);
    // A bare scheme names no host.
    if (url.replace(/^https?:\/\//i, "") === "") continue;
    pushText(start);
    parts.push({ kind: "link", text: url, href: url, start });
    at = start + url.length;
  }
  pushText(text.length);
  return parts;
}

/** A commit's author or committer; `timeMs` is epoch ms, shown through the project's date helper. */
export interface Person {
  name: string;
  email: string;
  timeMs: number;
}

/**
 * Whether details mode shows the committer: only when it is someone other than the author, by
 * name or by email (compared case-insensitively). A rebase or amend by the author changes only
 * the commit time, which isn't a different committer.
 */
export function committerShown(author: Person, committer: Person): boolean {
  return author.name !== committer.name || author.email.toLowerCase() !== committer.email.toLowerCase();
}

/** A trailer from the message's trailer block, unfolded. */
export interface Trailer {
  key: string;
  value: string;
}

/**
 * Each trailer with a React key made from its key and value, with a count for a word-for-word
 * repeat (a message may hold the same trailer twice), so no key depends on the list index.
 */
export function keyedTrailers(trailers: readonly Trailer[]): { id: string; trailer: Trailer }[] {
  const seen = new Map<string, number>();
  return trailers.map((trailer) => {
    const content = `${trailer.key}${trailer.value}`;
    const n = (seen.get(content) ?? 0) + 1;
    seen.set(content, n);
    return { id: `${content}${n}`, trailer };
  });
}

/** `git_commit_details`: every string in it is untrusted text, rendered only as text. */
export interface CommitDetails {
  oid: string;
  parents: string[];
  subject: string;
  body: string;
  author: Person;
  committer: Person;
  trailers: Trailer[];
  hasSignature: boolean;
  /** The agent that made the commit by #381's rules, or null for a human commit. */
  provenance: GraphAgent | null;
}

/** `FileStatus` from `src-tauri/src/slices/git/details.rs`: git's status letter for a commit's file. */
export type FileStatus = "A" | "M" | "D" | "R" | "C" | "T";

/** One file of `git_commit_files`; the counts are null for a binary file. */
export interface CommitFile {
  status: FileStatus;
  path: string;
  oldPath: string | null;
  additions: number | null;
  deletions: number | null;
}

export interface CommitFiles {
  files: CommitFile[];
  total: number;
  truncated: boolean;
}

/**
 * `git_compare_files` (#398): the files that differ from one commit to another, with the number of
 * commits between them when one is an ancestor of the other, or null when neither is.
 */
export interface CompareFiles extends CommitFiles {
  ahead: number | null;
}

/** `git_verify_commit`. */
export interface Verification {
  status: "good" | "bad" | "unknownKey" | "none";
  signer: string | null;
}

/** The note under a capped file list, or null when every file is listed. */
export function filesNote(files: { total: number; truncated: boolean; files: unknown[] }): string | null {
  const more = files.total - files.files.length;
  if (!files.truncated || more <= 0) return null;
  return `${more.toLocaleString("en-US")} more ${more === 1 ? "file" : "files"} not listed`;
}
