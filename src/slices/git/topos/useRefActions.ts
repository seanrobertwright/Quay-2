import { useCallback, useRef, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import type { ConfirmRequest } from "./ConfirmDialog";
import type { GitRefs } from "./graphRefs";
import { shortOid } from "./graphStore";
import {
  branchAt,
  checkoutChoices,
  checkoutDone,
  newBranchRefusal,
  refFailure,
  SHOW_WORKTREE,
  type CheckoutTarget,
  type PrimaryAction,
  type RefAction,
} from "./refActions";
import {
  deleteBranchPrompt,
  deletedToast,
  deleteTagPrompt,
  notFullyMergedOf,
  notMergedPrompt,
  renameRefusal,
  restoreFailure,
  tagRequest,
  upstreamChoices,
} from "./refWrites";
import type { OpEvent } from "./speedup";
import { dismissToast, pushToast, type Toast } from "./toasts";
import type { GraphRefsReader } from "./useGraphRefs";
import type { Staging } from "./useStaging";

/** `RefsOutcome` from `src-tauri/src/slices/git/checkout.rs`. */
interface RefsOutcome {
  head: string | null;
  refs: GitRefs;
}

/** `BranchDeleted` from `src-tauri/src/slices/git/ref_ops.rs`. */
interface BranchDeleted extends RefsOutcome {
  tip: string;
}

/** A ref command to run in the staging slot, and how its result reads. */
interface RefCommand<T extends RefsOutcome> {
  command: string;
  args: Record<string, unknown>;
  /** The ref it acts on, for its refusal's toast. */
  what: string;
  /** Its success toast: the words, or the whole toast. */
  done: (outcome: T, worktree: string) => string | Omit<Toast, "id">;
  /** From a dialog, a refusal with nothing to act on comes back to show in it; see `failed`. */
  inline?: boolean;
  /** Handles a refusal itself, returning true, before the usual toast. */
  refused?: (e: unknown) => boolean;
}

export interface RefActions {
  toasts: readonly Toast[];
  dismiss: (id: number) => void;
  /** Adds a toast to Topos's one queue, for the network operations too (#395). */
  toast: (toast: Omit<Toast, "id">) => void;
  /** Opens Topos's one dialog, for the network operations too (#395). */
  openDialog: (request: ConfirmRequest) => void;
  /** The open ref dialog (New branch, Checkout, New tag, Rename, Set upstream, a delete), or null. */
  dialog: ConfirmRequest | null;
  closeDialog: () => void;
  /** Runs a menu item's, a key's or a double-click's action. */
  run: (action: RefAction) => void;
  /** Runs a double-click's or Enter's action, or says why it can't. */
  runPrimary: (primary: PrimaryAction) => void;
  /** Opens the New branch dialog for a branch at `at`, a commit or `HEAD`. */
  newBranch: (at: string) => void;
  /** Opens the branch picker for "Topos: Checkout…". */
  pickCheckout: () => void;
  /**
   * Deletes the local tag `name` with no confirm of its own, for the tag delete confirm that also
   * offers its remotes (#396). Resolves to whether it was deleted; a refusal shows in a toast.
   */
  deleteTagNow: (name: string) => Promise<boolean>;
}

interface Options {
  /** The selected worktree, which a checkout switches; null with no repo open. */
  worktreePath: string | null;
  /** The repo whose refs the graph shows. */
  repoPath: string | null;
  /** Why no checkout can run in the selected worktree now (see `checkoutBlockedBy`), or null. */
  busy: string | null;
  staging: Staging;
  refs: GraphRefsReader;
  /** Hands a new HEAD to the refresh table, as a commit does. */
  onLanded: (head: string) => void;
  /** Retargets the Rail selection to another worktree; false when the Rail doesn't list it. */
  onShowWorktree: (path: string) => boolean;
  /** Opens the staging inspector, where local changes in the way of a checkout are dealt with. */
  onOpenInspector: () => void;
}

/** The toast of a checkout of `target`, naming the branch the worktree landed on. */
const checkedOut = (target: CheckoutTarget) => (outcome: RefsOutcome, worktree: string) => checkoutDone(target, branchAt(outcome.refs, worktree));

/**
 * Checkout, create, rename, upstream and delete of branches, and local tags, for Topos's badges,
 * rows, keys and palette (#367, #393, #394). Each runs as the selected worktree's one staging
 * operation, takes the HEAD and refs it returns at once, and reports in a toast.
 */
export function useRefActions({ worktreePath, repoPath, busy, staging, refs, onLanded, onShowWorktree, onOpenInspector }: Options): RefActions {
  const [toasts, setToasts] = useState<Toast[]>([]);
  // An open dialog reads the busy reason as it stands when it is confirmed, not when it opened.
  const busyNow = useRef(busy);
  busyNow.current = busy;
  const [dialog, setDialog] = useState<ConfirmRequest | null>(null);
  const nextId = useRef(0);
  const { exclusive, reload } = staging;
  const { accept } = refs;

  const toast = useCallback((t: Omit<Toast, "id">) => setToasts((q) => pushToast(q, { ...t, id: ++nextId.current })), []);
  const dismiss = useCallback((id: number) => setToasts((q) => dismissToast(q, id)), []);
  const showWorktree = useCallback(
    (path: string) => {
      if (!onShowWorktree(path)) toast({ tone: "failed", text: "That worktree isn't in the Rail" });
    },
    [onShowWorktree, toast]
  );
  const showAction = useCallback((path: string) => ({ label: SHOW_WORKTREE, run: () => showWorktree(path) }), [showWorktree]);

  /**
   * Reports `e`, a refused operation on `what`. From a dialog (`inline`), a refusal with nothing to
   * act on, such as a bad name, comes back to show in the dialog; one with an action, such as the
   * files in the way, goes to a toast and the dialog closes. Resolves to what the dialog shows.
   */
  const failed = useCallback(
    (what: string, e: unknown, inline: boolean): string | null => {
      const failure = refFailure(what, e);
      const worktree = failure.worktree;
      if (inline && worktree === null && !failure.openInspector) return failure.text;
      const action =
        worktree !== null
          ? showAction(worktree)
          : failure.openInspector
            ? { label: "Open the inspector", run: onOpenInspector }
            : undefined;
      toast({ tone: "failed", text: failure.text, lines: failure.lines, action });
      return null;
    },
    [toast, showAction, onOpenInspector]
  );

  /**
   * Runs a ref command in the staging slot and takes what it returns. Resolves to null, or from a
   * dialog (`inline`) to the refusal it shows; see `failed`.
   */
  const runRefCommand = useCallback(
    <T extends RefsOutcome>({ command, args, what, done, inline = false, refused }: RefCommand<T>): Promise<string | null> => {
      const ran = exclusive({ action: "refs", target: { kind: "all" } }, (worktree) => {
        const onEvent = new Channel<OpEvent>();
        return invoke<T>(command, { worktreePath: worktree, opId: crypto.randomUUID(), onEvent, ...args }).then(
          (outcome) => {
            if (repoPath !== null) accept(repoPath, outcome.refs);
            if (outcome.head !== null) onLanded(outcome.head);
            void reload();
            const said = done(outcome, worktree);
            toast(typeof said === "string" ? { tone: "done", text: said } : said);
            return null;
          },
          (e: unknown) => (refused?.(e) ? null : failed(what, e, inline))
        );
      });
      if (ran === null) return Promise.resolve(failed(what, { kind: "stagingBusy" }, inline));
      return ran;
    },
    [exclusive, repoPath, accept, onLanded, reload, toast, failed]
  );

  const checkout = useCallback(
    (target: CheckoutTarget) => {
      const what = target.kind === "detached" ? shortOid(target.at) : target.name;
      void runRefCommand({ command: "git_checkout", args: { target }, what, done: checkedOut(target) });
    },
    [runRefCommand]
  );

  const newBranch = useCallback(
    (at: string) => {
      if (worktreePath === null) return;
      const where = at === "HEAD" ? "the selected worktree's HEAD" : shortOid(at);
      setDialog({
        title: "New branch",
        detail: `Creates a branch at ${where}.`,
        confirmLabel: "Create branch",
        field: { label: "Branch name", initial: "" },
        checkbox: { label: "Check it out here", initial: busyNow.current === null },
        onSubmit: ({ text, checked }) => {
          const name = text.trim();
          const refused = newBranchRefusal(name, checked, busyNow.current);
          if (refused !== null) return Promise.resolve(refused);
          return runRefCommand({
            command: "git_branch_create",
            args: { name, at, checkout: checked },
            what: name,
            done: () => (checked ? `Created and checked out ${name}` : `Created branch ${name}`),
            inline: true,
          });
        },
      });
    },
    [worktreePath, runRefCommand]
  );

  const pickCheckout = useCallback(() => {
    if (worktreePath === null || refs.refs.state !== "done") return;
    if (busyNow.current !== null) {
      toast({ tone: "failed", text: busyNow.current });
      return;
    }
    const choices = checkoutChoices(refs.refs.refs, worktreePath);
    if (choices.length === 0) {
      toast({ tone: "failed", text: "There is no other branch to check out" });
      return;
    }
    setDialog({
      title: "Checkout",
      detail: "Switches the selected worktree to a branch. A remote branch checks out the branch tracking it, made if there is none.",
      confirmLabel: "Checkout",
      choice: { label: "Branch", options: choices.map(({ value, label }) => ({ value, label })) },
      onSubmit: ({ choice }) => {
        const picked = choices.find((c) => c.value === choice);
        if (picked === undefined) return Promise.resolve("Pick a branch");
        if (busyNow.current !== null) return Promise.resolve(busyNow.current);
        const { target } = picked;
        return runRefCommand({ command: "git_checkout", args: { target }, what: target.name, done: checkedOut(target), inline: true });
      },
    });
  }, [worktreePath, refs.refs, runRefCommand, toast]);

  const newTag = useCallback(
    (at: string) => {
      if (worktreePath === null) return;
      setDialog({
        title: "New tag",
        detail: `Creates a tag at ${shortOid(at)}. A message makes it annotated; without one it is lightweight. Topos never pushes it.`,
        confirmLabel: "Create tag",
        field: { label: "Tag name", initial: "" },
        message: { label: "Message (optional)" },
        onSubmit: ({ text, message }) => {
          const tag = tagRequest(text, message);
          if ("refused" in tag) return Promise.resolve(tag.refused);
          const { name } = tag;
          return runRefCommand({
            command: "git_tag_create",
            args: { name, at, message: tag.message },
            what: name,
            done: () => (tag.message === null ? `Created tag ${name}` : `Created annotated tag ${name}`),
            inline: true,
          });
        },
      });
    },
    [worktreePath, runRefCommand]
  );

  const renameBranch = useCallback(
    (name: string) => {
      setDialog({
        title: "Rename branch",
        detail: `Renames the local branch ${name}. A worktree that has it checked out stays on it.`,
        confirmLabel: "Rename",
        field: { label: "New name", initial: name },
        onSubmit: ({ text }) => {
          const refused = renameRefusal(name, text);
          if (refused !== null) return Promise.resolve(refused);
          const newName = text.trim();
          return runRefCommand({
            command: "git_branch_rename",
            args: { name, newName },
            what: newName,
            done: () => `Renamed ${name} to ${newName}`,
            inline: true,
          });
        },
      });
    },
    [runRefCommand]
  );

  const setUpstream = useCallback(
    (name: string) => {
      if (refs.refs.state !== "done") return;
      const choices = upstreamChoices(refs.refs.refs, name);
      setDialog({
        title: "Set upstream",
        detail: `Sets the branch ${name} tracks, or with No upstream stops it tracking one.`,
        confirmLabel: "Set upstream",
        choice: { label: "Upstream", options: choices.map(({ value, label }) => ({ value, label })) },
        onSubmit: ({ choice }) => {
          const picked = choices.find((c) => c.value === choice);
          if (picked === undefined) return Promise.resolve("Pick an upstream");
          const { upstream } = picked;
          return runRefCommand({
            command: "git_branch_set_upstream",
            args: { name, upstream },
            what: name,
            done: () => (upstream === null ? `${name} tracks no upstream` : `${name} tracks ${upstream}`),
            inline: true,
          });
        },
      });
    },
    [refs.refs, runRefCommand]
  );

  /** Restore, from the toast after a delete: the branch made again at the tip it was deleted at. */
  const restoreBranch = useCallback(
    (name: string, tip: string) => {
      void runRefCommand({
        command: "git_branch_create",
        args: { name, at: tip, checkout: false },
        what: name,
        done: () => `Restored ${name} at ${shortOid(tip)}`,
        refused: (e) => {
          toast({ tone: "failed", text: restoreFailure(name, e) });
          return true;
        },
      });
    },
    [runRefCommand, toast]
  );

  /** Deletes `name`, with `-D` when `force`; `-d` refusing an unmerged branch asks again. */
  const deleteBranchNow = useCallback(
    function deleteNow(name: string, force: boolean) {
      void runRefCommand<BranchDeleted>({
        command: "git_branch_delete",
        args: { name, force },
        what: name,
        done: ({ tip }) => {
          const { text, actionLabel, ttlMs } = deletedToast(name, tip);
          return { tone: "done", text, ttlMs, action: { label: actionLabel, run: () => restoreBranch(name, tip) } };
        },
        refused: (e) => {
          const unmerged = force ? null : notFullyMergedOf(e);
          if (unmerged === null) return false;
          setDialog({ ...notMergedPrompt(name, unmerged.ahead, unmerged.tip), onConfirm: () => deleteNow(name, true) });
          return true;
        },
      });
    },
    [runRefCommand, restoreBranch]
  );

  const deleteBranch = useCallback(
    (name: string) => setDialog({ ...deleteBranchPrompt(name), onConfirm: () => deleteBranchNow(name, false) }),
    [deleteBranchNow]
  );

  const deleteTagNow = useCallback(
    (name: string) => {
      let deleted = false;
      const done = () => {
        deleted = true;
        return `Deleted tag ${name}`;
      };
      return runRefCommand({ command: "git_tag_delete", args: { name }, what: name, done }).then(() => deleted);
    },
    [runRefCommand]
  );

  const deleteTag = useCallback(
    (name: string) => setDialog({ ...deleteTagPrompt(name), onConfirm: () => void deleteTagNow(name) }),
    [deleteTagNow]
  );

  const run = useCallback(
    (action: RefAction) => {
      switch (action.kind) {
        case "checkout":
          return checkout(action.target);
        case "showWorktree":
          return showWorktree(action.path);
        case "createBranch":
          return newBranch(action.at);
        case "createTag":
          return newTag(action.at);
        case "renameBranch":
          return renameBranch(action.name);
        case "setUpstream":
          return setUpstream(action.name);
        case "deleteBranch":
          return deleteBranch(action.name);
        case "deleteTag":
          return deleteTag(action.name);
        case "pushTag":
        case "deleteRemoteBranch":
          // Network operations, which Topos's toolbar runs; see ToposOverlay.
          return;
        case "copySha":
          navigator.clipboard.writeText(action.oid).then(
            () => toast({ tone: "done", text: `Copied ${shortOid(action.oid)}` }),
            (e: unknown) => toast({ tone: "failed", text: `Couldn't copy the SHA: ${String(e)}` })
          );
      }
    },
    [checkout, showWorktree, newBranch, newTag, renameBranch, setUpstream, deleteBranch, deleteTag, toast]
  );

  const runPrimary = useCallback(
    (primary: PrimaryAction) => {
      if (primary === null) return;
      if (primary.kind === "run") return run(primary.action);
      const worktree = primary.worktree;
      toast({
        tone: "failed",
        text: primary.reason,
        action: worktree === null ? undefined : showAction(worktree),
      });
    },
    [run, toast, showAction]
  );

  const closeDialog = useCallback(() => setDialog(null), []);

  return { toasts, dismiss, toast, openDialog: setDialog, dialog, closeDialog, run, runPrimary, newBranch, pickCheckout, deleteTagNow };
}
