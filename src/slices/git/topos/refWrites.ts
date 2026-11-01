// Rename, set upstream, delete with Restore, and local tags (#367, #394): what each dialog asks,
// what a refusal leads to, and the Restore toast. Every name in these strings is untrusted, so
// they are only ever rendered as text.

import { errorMessage, parseGitError } from "./gitVersion.ts";
import type { GitRefs } from "./graphRefs.ts";
import { shortOid } from "./graphStore.ts";
import { RESTORE_MS } from "./toasts.ts";

/** The words of a confirm dialog with no field. */
export interface Prompt {
  title: string;
  detail: string;
  confirmLabel: string;
  /** Drops or overwrites work, so the confirm button takes the danger style (#421). */
  destructive?: boolean;
}

/** The first confirm of every branch delete. */
export function deleteBranchPrompt(name: string): Prompt {
  return { title: "Delete branch", detail: `Deletes the local branch ${name}. Its remote branch, if any, stays.`, confirmLabel: "Delete", destructive: true };
}

/** The second confirm, after `git branch -d` refused `name`: what deleting it anyway (`-D`) loses. */
export function notMergedPrompt(name: string, ahead: number, tip: string): Prompt {
  const commits = ahead === 1 ? "1 commit" : `${ahead} commits`;
  return {
    title: `${name} isn't fully merged`,
    detail: `${commits} up to ${shortOid(tip)} are on no other branch, tag or HEAD. Deleting anyway leaves them only in the Restore toast and the reflog.`,
    confirmLabel: "Delete anyway",
    destructive: true,
  };
}

/** The `NotFullyMerged` refusal in `e`, or null when `e` is anything else. */
export function notFullyMergedOf(e: unknown): { ahead: number; tip: string } | null {
  const error = parseGitError(e);
  return error?.kind === "notFullyMerged" ? { ahead: error.ahead, tip: error.tip } : null;
}

/** The toast after deleting `name` at `tip`: its words, its Restore button and how long it stays. */
export function deletedToast(name: string, tip: string): { text: string; actionLabel: string; ttlMs: number } {
  return { text: `Deleted ${name} (was ${shortOid(tip)})`, actionLabel: "Restore", ttlMs: RESTORE_MS };
}

/** What a toast says when Restore of `name` fails with `e`. */
export function restoreFailure(name: string, e: unknown): string {
  if (parseGitError(e)?.kind === "refExists") return `A branch named ${name} exists again, so Restore left it alone`;
  return `Couldn't restore ${name}: ${errorMessage(e)}`;
}

/**
 * The confirm of a tag delete. When `onRemotes`, the remotes that have the tag, isn't empty it
 * offers "Also delete from ‹remote›", unticked (#367); null means they couldn't be checked, and the
 * delete stays local.
 */
export function deleteTagPrompt(name: string, onRemotes: readonly string[] | null = []): Prompt & { checkbox?: { label: string; initial: boolean } } {
  const prompt = { title: "Delete tag", confirmLabel: "Delete tag", destructive: true };
  if (onRemotes === null) {
    return { ...prompt, detail: `Deletes the local tag ${name}. Topos couldn't check the remotes for it, so a tag of that name on one stays.` };
  }
  if (onRemotes.length === 0) return { ...prompt, detail: `Deletes the local tag ${name}. A tag of that name on a remote stays.` };
  const remotes = onRemotes.length === 1 ? onRemotes[0] : `${onRemotes.slice(0, -1).join(", ")} and ${onRemotes[onRemotes.length - 1]}`;
  const has = onRemotes.length === 1 ? "has" : "have";
  return {
    ...prompt,
    detail: `Deletes the local tag ${name}. ${remotes} ${has} it too; deleting it there has no undo.`,
    checkbox: { label: `Also delete from ${remotes}`, initial: false },
  };
}

/**
 * The tag the New tag dialog asks for, or why it can't: it needs a name, and a message with more
 * than whitespace makes it annotated, none lightweight.
 */
export function tagRequest(name: string, message: string): { name: string; message: string | null } | { refused: string } {
  const trimmed = name.trim();
  if (trimmed === "") return { refused: "Name the tag" };
  return { name: trimmed, message: message.trim() === "" ? null : message };
}

/** Why `next` can't be the new name of the branch `name`, or null when it can. */
export function renameRefusal(name: string, next: string): string | null {
  const trimmed = next.trim();
  if (trimmed === "") return "Name the branch";
  if (trimmed === name) return "That is its name already";
  return null;
}

/** An option of the Set upstream dialog, and the upstream it sets (null unsets it). */
export interface UpstreamChoice {
  value: string;
  label: string;
  upstream: string | null;
}

/**
 * What Set upstream offers the local branch `name`: every remote-tracking branch, then every other
 * local branch, in `refs` order, then No upstream, which unsets it.
 */
export function upstreamChoices(refs: GitRefs, name: string): UpstreamChoice[] {
  const remotes = refs.refs.filter((r) => r.kind === "remote").map((r) => ({ label: r.name, upstream: r.name }));
  const locals = refs.refs
    .filter((r) => r.kind === "local" && r.name !== name)
    .map((r) => ({ label: `${r.name} (local)`, upstream: r.name }));
  const none: { label: string; upstream: string | null } = { label: "No upstream", upstream: null };
  return [...remotes, ...locals, none].map((c, i) => ({ ...c, value: String(i) }));
}
