import { useEffect, useId, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { MergeMethod, PullRequestReadiness, PullRequestState } from "../github/types.ts";
import {
  arrivalCell,
  commitMessageDefaults,
  DEFAULT_MERGE_METHOD,
  MERGE_METHODS,
  mergeMethodLabel,
  readiness,
  readinessCells,
  type ReadinessCell,
  type ReadinessCellId,
  type ReadinessTone,
  type SegmentTone,
} from "./readiness.ts";
import { CellDetail } from "./CellDetail.tsx";
import { errorText, usePullRequestReadiness, type PullRequestLocation } from "./usePullRequestReadiness.ts";

/** What `merge_github_pr` reports once the pull request has merged. */
interface MergeOutcome {
  branchDeleted: boolean;
  branchError: string | null;
}

const PILL: Record<PullRequestState | "DRAFT", { label: string; className: string }> = {
  OPEN: { label: "Open", className: "bg-[#238636]" },
  DRAFT: { label: "Draft", className: "bg-[#6e7681]" },
  MERGED: { label: "Merged", className: "bg-[#8957e5]" },
  CLOSED: { label: "Closed", className: "bg-[#da3633]" },
};

const HEADLINE_TONE: Record<ReadinessTone, string> = {
  ready: "text-[#3fb950]",
  failing: "text-[#f85149]",
  blocked: "text-[#d29922]",
  pending: "text-[#d29922]",
  merged: "text-[#a371f7]",
  closed: "text-[#f85149]",
};

const SEGMENT_TONE: Record<SegmentTone, string> = {
  failing: "bg-[#f85149]",
  pending: "bg-[#d29922]",
  skipped: "bg-[#6e7681]",
  passing: "bg-[#3fb950]",
  neutral: "bg-[#58a6ff]",
};

/**
 * The companion's pull request view: GitHub's header, then the readiness card, then the open
 * cell's detail, or the description while no cell is open.
 */
export const PullRequestView = (location: PullRequestLocation) => {
  const { pr, loading, error, reload } = usePullRequestReadiness(location);
  if (!pr) {
    return (
      <p role={error ? "alert" : undefined} className="p-4 text-xs text-[#8b949e]">
        {error ? `Could not read pull request #${location.number}: ${error}` : loading ? `Reading pull request #${location.number}…` : null}
      </p>
    );
  }
  return <PullRequestBody pr={pr} error={error} location={location} onChanged={reload} />;
};

/**
 * The view once the pull request is read. It mounts on the first answer, so the cell it opens on
 * arrival comes from that answer and a later refresh leaves the operator's choice alone.
 */
const PullRequestBody = ({
  pr,
  error,
  location,
  onChanged,
}: {
  pr: PullRequestReadiness;
  error: string | null;
  location: PullRequestLocation;
  onChanged: () => void;
}) => {
  const [arrival] = useState(() => arrivalCell(pr));
  const [open, setOpen] = useState<ReadinessCellId | null>(arrival);
  const detailId = useId();
  return (
    <div className="p-3 space-y-3 text-xs">
      <PullRequestHeader pr={pr} />
      {error && (
        <p role="alert" className="text-[#f85149]">
          Could not refresh: {error}
        </p>
      )}
      <ReadinessCard
        pr={pr}
        location={location}
        onChanged={onChanged}
        open={open}
        detailId={detailId}
        onToggle={(cell) => setOpen((current) => (current === cell ? null : cell))}
      />
      {open ? (
        <CellDetail
          key={open}
          cell={open}
          id={detailId}
          arrived={open === arrival}
          pr={pr}
          location={location}
          onChanged={onChanged}
        />
      ) : (
        pr.body.trim() !== "" && (
          <section aria-label="Description" className="whitespace-pre-wrap break-words text-[#c9d1d9]">
            {pr.body}
          </section>
        )
      )}
    </div>
  );
};

/** GitHub's pull request header: title and number, state pill, base and head branch chips, diffstat. */
const PullRequestHeader = ({ pr }: { pr: PullRequestReadiness }) => {
  // A response missing its state still renders, under a grey pill.
  const pill = PILL[pr.state === "OPEN" && pr.isDraft ? "DRAFT" : pr.state] ?? { label: pr.state, className: "bg-[#6e7681]" };
  return (
    <header data-pr-header className="space-y-2">
      <h2 className="text-sm font-semibold text-white break-words">
        {pr.title} <span className="font-normal text-[#8b949e]">#{pr.number}</span>
      </h2>
      <div className="flex flex-wrap items-center gap-1.5 text-[#8b949e]">
        <span data-state-pill className={`rounded-full px-2 py-0.5 font-medium text-white ${pill.className}`}>
          {pill.label}
        </span>
        <BranchChip title="Base branch" name={pr.baseRefName} />
        <span aria-hidden="true">←</span>
        <BranchChip title="Head branch" name={pr.headRefName} />
        <span
          data-diffstat
          role="img"
          aria-label={`${pr.additions} lines added, ${pr.deletions} deleted, in ${pr.changedFiles} ${pr.changedFiles === 1 ? "file" : "files"}`}
          className="ml-auto font-mono"
        >
          <span className="text-[#3fb950]">+{pr.additions}</span> <span className="text-[#f85149]">−{pr.deletions}</span>
        </span>
      </div>
    </header>
  );
};

const BranchChip = ({ title, name }: { title: string; name: string }) => (
  <code data-branch-chip title={title} className="max-w-[10rem] truncate rounded bg-[#1f6feb26] px-1.5 py-0.5 text-[#58a6ff]">
    {name}
  </code>
);

/** The readiness card: headline, its reason, the control, and the four cells, which open their detail. */
const ReadinessCard = ({
  pr,
  location,
  onChanged,
  open,
  detailId,
  onToggle,
}: {
  pr: PullRequestReadiness;
  location: PullRequestLocation;
  onChanged: () => void;
  open: ReadinessCellId | null;
  detailId: string;
  onToggle: (cell: ReadinessCellId) => void;
}) => {
  const verdict = readiness(pr);
  return (
    <section aria-label="Readiness" className="rounded-md border border-[#30363d] bg-[#161b22]">
      <div className="p-3 space-y-2">
        <h3 className={`text-sm font-semibold ${HEADLINE_TONE[verdict.tone]}`}>{verdict.headline}</h3>
        <p className="text-[#8b949e]">{verdict.reason}</p>
        {verdict.control.kind === "merge" ? (
          <MergeControl pr={pr} location={location} enabled={verdict.control.enabled} onChanged={onChanged} />
        ) : (
          <AfterControls
            pr={pr}
            location={location}
            branch={verdict.control.branch}
            reopen={verdict.control.reopen}
            onChanged={onChanged}
          />
        )}
      </div>
      <ul className="grid grid-cols-4 border-t border-[#30363d]">
        {readinessCells(pr).map((cell) => (
          <Cell
            key={cell.id}
            cell={cell}
            open={open === cell.id}
            detailId={detailId}
            onToggle={() => onToggle(cell.id)}
          />
        ))}
      </ul>
    </section>
  );
};

/** One of the card's cells: name, count and segmented bar, on a button that opens and closes its detail. */
const Cell = ({ cell, open, detailId, onToggle }: { cell: ReadinessCell; open: boolean; detailId: string; onToggle: () => void }) => (
  <li data-cell={cell.id} className="border-r last:border-r-0 border-[#30363d]">
    <button
      type="button"
      aria-expanded={open}
      aria-controls={open ? detailId : undefined}
      onClick={onToggle}
      className={`block w-full p-2 space-y-1 text-left hover:bg-[#1c2128] ${open ? "bg-[#1f6feb1a] shadow-[inset_0_-2px_0_#58a6ff]" : ""}`}
    >
      <span className="flex items-baseline justify-between gap-1">
        <span className="text-[#8b949e]">{cell.label}</span>
        <span data-count className="font-semibold text-white">
          {cell.count}
        </span>
      </span>
      <span
        role="img"
        aria-label={cell.segments.length ? `${cell.label}: ${cell.segments.map((s) => s.label).join(", ")}` : `${cell.label}: none`}
        className="flex h-1.5 gap-px overflow-hidden rounded-full bg-[#30363d]"
      >
        {cell.segments.map((segment) => (
          <span
            key={segment.tone + segment.label}
            data-segment
            title={segment.label}
            style={{ flexGrow: segment.value }}
            className={SEGMENT_TONE[segment.tone]}
          />
        ))}
      </span>
    </button>
  </li>
);

/** A GitHub action under way, so the card's buttons wait, and what came of the last one. */
function useAction(onChanged: () => void) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  /** Runs `act`, which returns a warning or null; true when it succeeded. */
  const run = async (what: string, act: () => Promise<string | null>): Promise<boolean> => {
    setBusy(true);
    setFailure(null);
    try {
      const warning = await act();
      if (alive.current) setFailure(warning);
      onChanged();
      return true;
    } catch (e) {
      if (alive.current) setFailure(`${what} failed: ${errorText(e)}`);
      return false;
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  return { busy, failure, run };
}

const Failure = ({ text }: { text: string | null }) =>
  text ? (
    <p role="alert" className="text-[#f85149] break-words">
      {text}
    </p>
  ) : null;

const BUTTON = "h-7 px-3 rounded-md border text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed";
const PRIMARY = `${BUTTON} border-[#2ea043] bg-[#238636] text-white enabled:hover:bg-[#2ea043]`;
const SECONDARY = `${BUTTON} border-[#30363d] bg-[#21262d] text-[#c9d1d9] enabled:hover:bg-[#30363d]`;

/**
 * The merge split button. The main button starts the confirm step for the picked method; the
 * arrow beside it opens a menu of merge commit, squash and rebase, on squash at first. The confirm
 * step shows the commit title and message and Delete branch after merge, ticked, then merges
 * through `merge_github_pr`.
 */
const MergeControl = ({
  pr,
  location,
  enabled,
  onChanged,
}: {
  pr: PullRequestReadiness;
  location: PullRequestLocation;
  enabled: boolean;
  onChanged: () => void;
}) => {
  const [method, setMethod] = useState<MergeMethod>(DEFAULT_MERGE_METHOD);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const { busy, failure, run } = useAction(onChanged);
  const menuId = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  const label = mergeMethodLabel(method);
  const closeMenu = () => {
    setMenuOpen(false);
    toggle.current?.focus();
  };
  const merge = (title: string, message: string, deleteBranch: boolean) =>
    run("Merge", async () => {
      const outcome = await invoke<MergeOutcome>("merge_github_pr", {
        repoPath: location.repoPath,
        repo: location.repo,
        number: location.number,
        method,
        commitTitle: method === "rebase" ? null : title,
        commitMessage: method === "rebase" ? null : message,
        headSha: pr.headRefOid,
        headBranch: pr.headRefName,
        deleteBranch,
      });
      return outcome.branchError ? `Merged, but Delete branch failed: ${outcome.branchError}` : null;
    });
  return (
    <div className="space-y-2">
      <div className="relative inline-flex">
        <button
          type="button"
          disabled={!enabled || busy || confirming}
          onClick={() => setConfirming(true)}
          className={`${PRIMARY} rounded-r-none`}
        >
          {label}
        </button>
        <button
          ref={toggle}
          type="button"
          aria-label="Choose a merge method"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? menuId : undefined}
          disabled={!enabled || busy || confirming}
          onClick={() => setMenuOpen((open) => !open)}
          className={`${PRIMARY} rounded-l-none border-l-[#0d1117] px-2`}
        >
          <span aria-hidden="true">▾</span>
        </button>
        {menuOpen && (
          <MethodMenu
            id={menuId}
            method={method}
            onPick={(picked) => {
              setMethod(picked);
              closeMenu();
            }}
            onClose={closeMenu}
          />
        )}
      </div>
      {confirming && (
        <ConfirmMerge
          pr={pr}
          method={method}
          busy={busy}
          onCancel={() => setConfirming(false)}
          onConfirm={async (title, message, deleteBranch) => {
            // A failed merge keeps the confirm step, and what was typed in it, open.
            if (await merge(title, message, deleteBranch)) setConfirming(false);
          }}
        />
      )}
      <Failure text={failure} />
    </div>
  );
};

/** The merge method menu: one radio item per method, moved through with the arrow keys. */
const MethodMenu = ({
  id,
  method,
  onPick,
  onClose,
}: {
  id: string;
  method: MergeMethod;
  onPick: (method: MergeMethod) => void;
  onClose: () => void;
}) => {
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    items.current[MERGE_METHODS.findIndex((m) => m.method === method)]?.focus();
    // Focus lands on the picked method once, when the menu opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const move = (from: number, by: number) => items.current[(from + by + MERGE_METHODS.length) % MERGE_METHODS.length]?.focus();
  return (
    <div
      id={id}
      role="menu"
      aria-label="Merge method"
      className="absolute left-0 top-full z-10 mt-1 w-52 rounded-md border border-[#30363d] bg-[#161b22] py-1 shadow-lg"
    >
      {MERGE_METHODS.map((m, index) => (
        <button
          key={m.method}
          ref={(el) => {
            items.current[index] = el;
          }}
          type="button"
          role="menuitemradio"
          aria-checked={m.method === method}
          tabIndex={-1}
          onClick={() => onPick(m.method)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              move(index, 1);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              move(index, -1);
            } else if (e.key === "Escape" || e.key === "Tab") {
              e.preventDefault();
              onClose();
            }
          }}
          className="block w-full px-3 py-1.5 text-left text-xs text-[#c9d1d9] hover:bg-[#30363d] focus:bg-[#30363d] outline-none aria-checked:font-semibold aria-checked:text-white"
        >
          {m.label}
        </button>
      ))}
    </div>
  );
};

/** The confirm step: commit title and message (none for rebase) and Delete branch after merge. */
const ConfirmMerge = ({
  pr,
  method,
  busy,
  onCancel,
  onConfirm,
}: {
  pr: PullRequestReadiness;
  method: MergeMethod;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (title: string, message: string, deleteBranch: boolean) => Promise<unknown>;
}) => {
  const defaults = commitMessageDefaults(pr, method);
  const [title, setTitle] = useState(defaults?.title ?? "");
  const [message, setMessage] = useState(defaults?.message ?? "");
  // A fork's branch is not Quay's to delete.
  const [deleteBranch, setDeleteBranch] = useState(!pr.isCrossRepository);
  const label = mergeMethodLabel(method);
  const field = "w-full rounded-md border border-[#30363d] bg-[#0d1117] px-2 py-1 text-xs text-[#c9d1d9]";
  return (
    <form
      aria-label="Confirm merge"
      className="space-y-2 rounded-md border border-[#30363d] p-2"
      onSubmit={(e) => {
        e.preventDefault();
        void onConfirm(title, message, deleteBranch);
      }}
    >
      {defaults ? (
        <>
          <input aria-label="Commit title" value={title} onChange={(e) => setTitle(e.target.value)} className={field} />
          <textarea
            aria-label="Commit message"
            value={message}
            rows={4}
            onChange={(e) => setMessage(e.target.value)}
            className={`${field} resize-y`}
          />
        </>
      ) : (
        <p className="text-[#8b949e]">
          Each commit on {pr.headRefName} is added to {pr.baseRefName} with its own message.
        </p>
      )}
      {!pr.isCrossRepository && (
        <label className="flex items-center gap-2 text-[#c9d1d9]">
          <input type="checkbox" checked={deleteBranch} onChange={(e) => setDeleteBranch(e.target.checked)} />
          Delete branch after merge
        </label>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className={PRIMARY}>
          {busy ? "Merging…" : `Confirm ${label.toLowerCase()}`}
        </button>
        <button type="button" disabled={busy} onClick={onCancel} className={SECONDARY}>
          Cancel
        </button>
      </div>
    </form>
  );
};

/** After a merge or close: Delete branch or Restore branch, plus Reopen after a close. */
const AfterControls = ({
  pr,
  location,
  branch,
  reopen,
  onChanged,
}: {
  pr: PullRequestReadiness;
  location: PullRequestLocation;
  branch: "delete" | "restore" | null;
  reopen: boolean;
  onChanged: () => void;
}) => {
  const { busy, failure, run } = useAction(onChanged);
  const target = { repoPath: location.repoPath, repo: location.repo };
  /** A button that runs `command` on the pull request's repository with `args`, named `what`. */
  const action = (what: string, command: string, args: Record<string, unknown>) => (
    <button
      type="button"
      disabled={busy}
      onClick={() =>
        void run(what, async () => {
          await invoke(command, { ...target, ...args });
          return null;
        })
      }
      className={SECONDARY}
    >
      {what}
    </button>
  );
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        {branch === "delete" && action("Delete branch", "delete_github_branch", { branch: pr.headRefName })}
        {branch === "restore" && action("Restore branch", "restore_github_branch", { branch: pr.headRefName, sha: pr.headRefOid })}
        {reopen && action("Reopen", "reopen_github_pr", { number: location.number })}
      </div>
      <Failure text={failure} />
    </div>
  );
};
