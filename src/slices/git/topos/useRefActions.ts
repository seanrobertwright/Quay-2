import { useCallback, useRef, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { isSamePath } from "../../../utils/paths";
import type { ConfirmRequest } from "./ConfirmDialog";
import type { GitRefs } from "./graphRefs";
import { shortOid } from "./graphStore";
import { checkoutDone, refFailure, type CheckoutTarget, type PrimaryAction, type RefAction } from "./refActions";
import type { OpEvent } from "./speedup";
import { dismissToast, pushToast, type Toast } from "./toasts";
import type { GraphRefsReader } from "./useGraphRefs";
import type { Staging } from "./useStaging";

/** `RefsOutcome` from `src-tauri/src/slices/git/checkout.rs`. */
interface RefsOutcome {
  head: string | null;
  refs: GitRefs;
}

export interface RefActions {
  toasts: readonly Toast[];
  dismiss: (id: number) => void;
  /** The New branch or Checkout dialog, or null. */
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
}

interface Options {
  /** The selected worktree, which a checkout switches; null with no repo open. */
  worktreePath: string | null;
  /** The repo whose refs the graph shows. */
  repoPath: string | null;
  staging: Staging;
  refs: GraphRefsReader;
  /** Hands a new HEAD to the refresh table, as a commit does. */
  onLanded: (head: string) => void;
  /** Retargets the Rail selection to another worktree; false when the Rail doesn't list it. */
  onShowWorktree: (path: string) => boolean;
  /** Opens the staging inspector, where local changes in the way of a checkout are dealt with. */
  onOpenInspector: () => void;
}

/** The branch the worktree at `path` has checked out in `refs`, or null when detached. */
function branchAt(refs: GitRefs, path: string): string | null {
  return refs.worktrees.find((w) => isSamePath(w.path, path))?.branch ?? null;
}

/**
 * Checkout and create branch for Topos's badges, rows, keys and palette (#367, #393). Each runs as
 * the selected worktree's one staging operation, takes the HEAD and refs it returns at once, and
 * reports in a toast.
 */
export function useRefActions({ worktreePath, repoPath, staging, refs, onLanded, onShowWorktree, onOpenInspector }: Options): RefActions {
  const [toasts, setToasts] = useState<Toast[]>([]);
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
          ? { label: "Show that worktree", run: () => showWorktree(worktree) }
          : failure.openInspector
            ? { label: "Open the inspector", run: onOpenInspector }
            : undefined;
      toast({ tone: "failed", text: failure.text, lines: failure.lines, action });
      return null;
    },
    [toast, showWorktree, onOpenInspector]
  );

  /**
   * Runs `command` in the staging slot and takes what it returns. Resolves to null, or from a
   * dialog (`inline`) to the refusal it shows; see `failed`.
   */
  const runRefCommand = useCallback(
    (
      command: string,
      args: Record<string, unknown>,
      what: string,
      done: (outcome: RefsOutcome, worktree: string) => string,
      inline = false
    ): Promise<string | null> => {
      const ran = exclusive({ action: "refs", target: { kind: "all" } }, (worktree) => {
        const onEvent = new Channel<OpEvent>();
        return invoke<RefsOutcome>(command, { worktreePath: worktree, opId: crypto.randomUUID(), onEvent, ...args }).then(
          (outcome) => {
            if (repoPath !== null) accept(repoPath, outcome.refs);
            if (outcome.head !== null) onLanded(outcome.head);
            void reload();
            toast({ tone: "done", text: done(outcome, worktree) });
            return null;
          },
          (e: unknown) => failed(what, e, inline)
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
      void runRefCommand("git_checkout", { target }, what, (outcome, worktree) => checkoutDone(target, branchAt(outcome.refs, worktree)));
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
        checkbox: { label: "Check it out here", initial: true },
        onSubmit: ({ text, checked }) => {
          const name = text.trim();
          if (name === "") return Promise.resolve("Name the branch");
          return runRefCommand(
            "git_branch_create",
            { name, at, checkout: checked },
            name,
            () => (checked ? `Created and checked out ${name}` : `Created branch ${name}`),
            true
          );
        },
      });
    },
    [worktreePath, runRefCommand]
  );

  const pickCheckout = useCallback(() => {
    if (worktreePath === null || refs.refs.state !== "done") return;
    const known = refs.refs.refs;
    const here = branchAt(known, worktreePath);
    const options = known.refs
      .filter((r) => r.kind === "local" || r.kind === "remote")
      .filter((r) => !(r.kind === "local" && r.name === here))
      .map((r) => ({ value: `${r.kind}:${r.name}`, label: r.kind === "remote" ? `${r.name} (remote)` : r.name }));
    if (options.length === 0) {
      toast({ tone: "failed", text: "There is no other branch to check out" });
      return;
    }
    setDialog({
      title: "Checkout",
      detail: "Switches the selected worktree to a branch. A remote branch checks out the branch tracking it, made if there is none.",
      confirmLabel: "Checkout",
      choice: { label: "Branch", options },
      onSubmit: ({ choice }) => {
        const [kind, ...rest] = choice.split(":");
        const name = rest.join(":");
        const target: CheckoutTarget = kind === "remote" ? { kind: "remote", name } : { kind: "branch", name };
        return runRefCommand("git_checkout", { target }, name, (outcome, worktree) => checkoutDone(target, branchAt(outcome.refs, worktree)), true);
      },
    });
  }, [worktreePath, refs.refs, runRefCommand, toast]);

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
          return;
        case "copySha":
          navigator.clipboard.writeText(action.oid).then(
            () => toast({ tone: "done", text: `Copied ${shortOid(action.oid)}` }),
            (e: unknown) => toast({ tone: "failed", text: `Couldn't copy the SHA: ${String(e)}` })
          );
      }
    },
    [checkout, showWorktree, newBranch, toast]
  );

  const runPrimary = useCallback(
    (primary: PrimaryAction) => {
      if (primary === null) return;
      if (primary.kind === "run") return run(primary.action);
      const worktree = primary.worktree;
      toast({
        tone: "failed",
        text: primary.reason,
        action: worktree === null ? undefined : { label: "Show that worktree", run: () => showWorktree(worktree) },
      });
    },
    [run, toast, showWorktree]
  );

  const closeDialog = useCallback(() => setDialog(null), []);

  return { toasts, dismiss, dialog, closeDialog, run, runPrimary, newBranch, pickCheckout };
}
