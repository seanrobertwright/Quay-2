// The side-picker cards (#352, #391): which card a conflicted file the three-pane resolver can't
// edit as text gets, the choices it offers, what each does to the index and the worktree, and which
// confirm first because they drop work. File names come from git and are untrusted text; the card
// renders them only as text.

import type { ResolverConfirm } from "./conflicts.ts";
import type { ConflictFile, ConflictSide, NotEditable } from "./useConflictResolver.ts";
import type { Conflict } from "./operation.ts";

/** What a card's choice runs. */
export type CardAction =
  /** Stage the file as the worktree holds it, through Mark resolved (`git add`). */
  | { kind: "stage" }
  /** Keep one side whole (`git checkout --ours|--theirs`, then `git add`). */
  | { kind: "takeSide"; side: ConflictSide }
  /** Take the file out of the index and the worktree (`git rm`). */
  | { kind: "remove" }
  | { kind: "openTerminal" }
  | { kind: "handToAgent" };

export interface CardChoice {
  label: string;
  action: CardAction;
  /** What the choice does to the index and the worktree, in words. */
  effect: string;
  /** The confirm a choice that drops work asks first, or null. */
  confirm: ResolverConfirm | null;
}

export interface ConflictCard {
  title: string;
  /** Why the file gets a card, in words. */
  reason: string;
  /** Facts the choice depends on, such as both commits of a submodule. */
  details: string[];
  choices: CardChoice[];
}

/** The two sides' labels, role and real ref, as the resolver names them. */
export interface SideNames {
  left: string;
  right: string;
}

/** Why a file the three-pane resolver can't edit as text gets a card, in words. */
export const REASON_WORDS: Record<NotEditable, string> = {
  oneSideMissing: "One side deleted this file or only one side added it, so there are no two texts to merge.",
  noWorktreeFile: "The conflict left no file in the worktree.",
  submodule: "This is a submodule; resolve it inside the submodule.",
  symlink: "This is a symbolic link, which Topos doesn't edit as text.",
  binary: "This file holds binary data, which Topos doesn't edit as text.",
  tooLarge: "This file is larger than 1 MiB, too large to edit here.",
  notUtf8: "This file isn't UTF-8 text, so editing it here could change its bytes.",
  mixedLineEndings: "This file mixes CRLF and LF line endings, so saving it here couldn't keep them.",
};

const BACKED_UP = "What the worktree holds now is backed up first, and Recently discarded can restore it.";

/** The other side. */
function other(side: ConflictSide): ConflictSide {
  return side === "left" ? "right" : "left";
}

/** Keeping the file the present `side` has: stage what is on disk, or write that side back first. */
function keep(f: ConflictFile, names: SideNames, side: ConflictSide, label: string): CardChoice {
  if (f.onDisk) {
    return {
      label,
      action: { kind: "stage" },
      effect: `Stages ${f.path} as the worktree holds it (git add). The worktree file stays as it is.`,
      confirm: null,
    };
  }
  return {
    label,
    action: { kind: "takeSide", side },
    effect: `Writes ${names[side]}'s version of ${f.path} to the worktree (git checkout) and stages it (git add).`,
    confirm: null,
  };
}

/** Taking `side` whole, which drops the other side, so it confirms. */
function takeSide(f: ConflictFile, names: SideNames, side: ConflictSide): CardChoice {
  const label = `Take ${names[side]}`;
  const flag = side === "left" ? "--ours" : "--theirs";
  const dropped = names[other(side)];
  return {
    label,
    action: { kind: "takeSide", side },
    effect: `Writes ${names[side]}'s version of ${f.path} to the worktree (git checkout ${flag}) and stages it (git add). This drops ${dropped}'s version. ${BACKED_UP}`,
    confirm: {
      title: `Take ${names[side]} for ${f.path}?`,
      detail: `This replaces ${f.path} with ${names[side]}'s version and stages it as resolved, dropping ${dropped}'s version. The file is backed up first, and Recently discarded can restore it.`,
      confirmLabel: label,
    },
  };
}

/** Removing the file, confirmed when the worktree holds a file it deletes. */
function remove(f: ConflictFile, label: string): CardChoice {
  if (!f.onDisk) {
    return {
      label,
      action: { kind: "remove" },
      effect: `Removes ${f.path} from the index (git rm). The worktree has no file there to delete.`,
      confirm: null,
    };
  }
  return {
    label,
    action: { kind: "remove" },
    effect: `Removes ${f.path} from the index and deletes it from the worktree (git rm). ${BACKED_UP}`,
    confirm: {
      title: `${label}: delete ${f.path}?`,
      detail: `This removes ${f.path} from the index and deletes it from the worktree (git rm). The file is backed up first, and Recently discarded can restore it.`,
      confirmLabel: label,
    },
  };
}

/** The most of a rename's possible new names a card lists; a line counts the rest. */
const RENAME_ROWS = 5;

/**
 * The conflicts only one side added, where a file both sides renamed may have gone: git leaves the
 * old name deleted on both sides and each new name added on one. At most `RENAME_ROWS`, then a count.
 */
function renameTargets(conflicts: Conflict[], names: SideNames): string[] {
  const added = conflicts.filter((c) => c.kind === "addedByUs" || c.kind === "addedByThem");
  const lines = added.slice(0, RENAME_ROWS).map((c) => `${c.path}, added only by ${c.kind === "addedByUs" ? names.left : names.right}`);
  const more = added.length - RENAME_ROWS;
  if (more > 0) lines.push(`and ${more.toLocaleString()} more ${more === 1 ? "file" : "files"} one side added`);
  return lines;
}

/**
 * The card for `f`, or null when the three-pane resolver edits it as text. `names` labels the two
 * sides; `conflicts` are every conflict listed, from which a rename's new names are found.
 */
export function conflictCard(f: ConflictFile, names: SideNames, conflicts: Conflict[]): ConflictCard | null {
  if (f.editable) return null;
  if (f.reason === "submodule") {
    const commit = (oid: string | null) => (oid !== null ? `commit ${oid}` : "deleted");
    const untouched = "Topos itself changes nothing in the index or the worktree; the conflict is resolved inside the submodule.";
    return {
      title: `${f.path} is a submodule with a conflict`,
      reason: `Both sides point ${f.path} at different commits. ${REASON_WORDS.submodule}`,
      details: [`${names.left}: ${commit(f.leftOid)}`, `${names.right}: ${commit(f.rightOid)}`],
      choices: [
        { label: "Open terminal", action: { kind: "openTerminal" }, effect: `Opens a terminal in this worktree. ${untouched}`, confirm: null },
        { label: "Hand to agent", action: { kind: "handToAgent" }, effect: `Asks an agent terminal in this worktree to resolve it. ${untouched}`, confirm: null },
      ],
    };
  }
  if (f.xy === "DD") {
    return {
      title: `${f.path} was deleted on both sides`,
      reason: `Both sides deleted ${f.path}, or renamed it to different names.`,
      details: renameTargets(conflicts, names),
      choices: [remove(f, "Remove")],
    };
  }
  if (f.xy === "UD" || f.xy === "DU") {
    const changed: ConflictSide = f.xy === "UD" ? "left" : "right";
    return {
      title: `${f.path} was changed on one side and deleted on the other`,
      reason: `${names[changed]} changed ${f.path} and ${names[other(changed)]} deleted it.`,
      details: [],
      choices: [keep(f, names, changed, "Keep modified"), remove(f, "Accept deletion")],
    };
  }
  if (f.xy === "AU" || f.xy === "UA") {
    const adder: ConflictSide = f.xy === "AU" ? "left" : "right";
    return {
      title: `${f.path} was added on one side only`,
      reason: `Only ${names[adder]} added ${f.path}.`,
      details: [],
      choices: [keep(f, names, adder, "Keep"), remove(f, "Remove")],
    };
  }
  const why = f.reason !== null ? REASON_WORDS[f.reason] : "Topos can't read it as text.";
  return {
    title: `${f.path} can't be edited as text`,
    reason: `${why} Take one side whole instead.`,
    details: [],
    choices: [takeSide(f, names, "left"), takeSide(f, names, "right")],
  };
}
