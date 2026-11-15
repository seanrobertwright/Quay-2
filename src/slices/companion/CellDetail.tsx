import { useId, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  CheckLog,
  PullRequestCheck,
  PullRequestCommit,
  PullRequestFile,
  PullRequestReadiness,
  PullRequestTimeline,
  TimelineItem,
} from "../github/types.ts";
import { formatDateTime, formatRelative, parseUtcTimestamp } from "../../lib/dates.ts";
import type { ReadinessCellId } from "./readiness.ts";
import { COMMENT_FILTERS, commentsByPath, filterTimeline, groupChecks, type CommentFilter } from "./cellDetails.ts";
import { errorText, type PullRequestLocation } from "./usePullRequestReadiness.ts";
import { useGithubRead, type GithubRead } from "./useGithubRead.ts";
import { FileDiff } from "./FileDiff.tsx";

const BUTTON = "h-7 px-3 rounded-md border text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed";
const PRIMARY = `${BUTTON} border-[#2ea043] bg-[#238636] text-white enabled:hover:bg-[#2ea043]`;
const SECONDARY = `${BUTTON} border-[#30363d] bg-[#21262d] text-[#c9d1d9] enabled:hover:bg-[#30363d]`;
const MUTED = "text-[#8b949e]";

const LABELS: Record<ReadinessCellId, string> = { checks: "Checks", comments: "Comments", files: "Files", commits: "Commits" };

/** The props every cell's detail takes. */
interface DetailProps {
  pr: PullRequestReadiness;
  location: PullRequestLocation;
  /** Reads the pull request again, after a comment or a close changes it. */
  onChanged: () => void;
}

/**
 * The open cell's detail, under the readiness card. `id` is what the cell's `aria-controls`
 * names. `arrived` is set when the view opened the cell itself on arrival, so Comments starts on
 * the unresolved threads that brought it there.
 */
export const CellDetail = ({ cell, id, arrived, ...props }: DetailProps & { cell: ReadinessCellId; id: string; arrived: boolean }) => (
  <section id={id} data-cell-detail aria-label={LABELS[cell]} className="space-y-2">
    {cell === "checks" && <ChecksDetail {...props} />}
    {cell === "comments" && <CommentsDetail {...props} initialFilter={arrived ? "unresolved" : "all"} />}
    {cell === "files" && <FilesDetail {...props} />}
    {cell === "commits" && <CommitsDetail {...props} />}
  </section>
);

const target = (location: PullRequestLocation) => ({ repoPath: location.repoPath, repo: location.repo, number: location.number });

/** A read's loading and error lines, shown until its first answer and on a failed refresh. */
const ReadState = ({ read, what }: { read: GithubRead<unknown>; what: string }) =>
  read.error ? (
    <p role="alert" className="text-[#f85149] break-words">
      Could not read the {what}: {read.error}
    </p>
  ) : read.data === null && read.loading ? (
    <p className={MUTED}>Reading the {what}…</p>
  ) : null;

/** A GitHub timestamp as "3h ago", with the local date and time in its tooltip. */
const When = ({ at }: { at: string }) => {
  const ms = parseUtcTimestamp(at);
  if (ms === null) return null;
  return (
    <time dateTime={at} title={formatDateTime(ms)} className={MUTED}>
      {formatRelative(ms)}
    </time>
  );
};

// ---- Checks ----

const OUTCOME_MARK: Record<PullRequestCheck["outcome"], { mark: string; className: string }> = {
  failing: { mark: "✕", className: "text-[#f85149]" },
  pending: { mark: "●", className: "text-[#d29922]" },
  skipped: { mark: "⊘", className: "text-[#8b949e]" },
  passing: { mark: "✓", className: "text-[#3fb950]" },
};

/** The head commit's checks grouped failing, pending, skipped and successful; a failing check's log is open. */
const ChecksDetail = ({ location }: DetailProps) => {
  const read = useGithubRead<PullRequestCheck[]>("get_github_pr_checks", target(location));
  const groups = groupChecks(read.data ?? []);
  return (
    <>
      <ReadState read={read} what="checks" />
      {read.data?.length === 0 && <p className={MUTED}>No checks ran on the head commit.</p>}
      {groups.map((group) => (
        <section key={group.outcome} data-check-group={group.outcome} aria-label={`${group.label} checks`} className="space-y-1">
          <h4 className="font-semibold text-[#c9d1d9]">
            {group.label} <span className={MUTED}>{group.checks.length}</span>
          </h4>
          <ul className="space-y-1">
            {group.checks.map((check) => (
              <CheckRow key={`${check.checkRunId ?? "status"}:${check.workflow ?? ""}/${check.name}`} check={check} location={location} />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
};

const CheckRow = ({ check, location }: { check: PullRequestCheck; location: PullRequestLocation }) => {
  const mark = OUTCOME_MARK[check.outcome];
  const name = check.workflow ? `${check.workflow} / ${check.name}` : check.name;
  /** The check run whose log the row shows: a failing check run's, and none for a commit status. */
  const logRunId = check.outcome === "failing" ? check.checkRunId : null;
  const [logOpen, setLogOpen] = useState(logRunId !== null);
  const logId = useId();
  return (
    <li data-check={check.name} className="rounded-md border border-[#30363d] bg-[#0d1117] p-2 space-y-1">
      <div className="flex items-start gap-2">
        <span aria-hidden="true" className={mark.className}>
          {mark.mark}
        </span>
        <div className="min-w-0 flex-1">
          <p className="break-words text-[#c9d1d9]">{name}</p>
          {check.description && <p className={`${MUTED} break-words`}>{check.description}</p>}
        </div>
        {logRunId !== null && (
          <button
            type="button"
            aria-expanded={logOpen}
            aria-controls={logOpen ? logId : undefined}
            onClick={() => setLogOpen((open) => !open)}
            className={`${SECONDARY} h-6 px-2`}
          >
            {logOpen ? "Hide log" : "Show log"}
          </button>
        )}
      </div>
      {logRunId !== null && logOpen && <CheckLogView id={logId} checkRunId={logRunId} location={location} />}
    </li>
  );
};

const CheckLogView = ({ id, checkRunId, location }: { id: string; checkRunId: number; location: PullRequestLocation }) => {
  const read = useGithubRead<CheckLog>("get_github_check_log", { repoPath: location.repoPath, repo: location.repo, checkRunId });
  return (
    <div id={id} data-check-log className="space-y-1">
      <ReadState read={read} what="log" />
      {read.data && (
        <>
          {read.data.truncated && <p className={MUTED}>The end of the log:</p>}
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-[#010409] p-2 font-mono text-[11px] text-[#c9d1d9]">
            {read.data.text}
          </pre>
        </>
      )}
    </div>
  );
};

// ---- Comments ----

const REVIEW_VERDICT: Record<string, string> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "requested changes",
  COMMENTED: "reviewed",
  DISMISSED: "review dismissed",
};

/**
 * The comment timeline with its All, Unresolved and Mine filters and Newest first, under a
 * comment box whose Comment posts a conversation comment and whose Close pull request closes it,
 * posting what is typed first.
 */
const CommentsDetail = ({ pr, location, onChanged, initialFilter }: DetailProps & { initialFilter: CommentFilter }) => {
  const read = useGithubRead<PullRequestTimeline>("get_github_pr_timeline", target(location));
  const [filter, setFilter] = useState<CommentFilter>(initialFilter);
  const [newestFirst, setNewestFirst] = useState(false);
  const filterName = useId();
  const items = read.data ? filterTimeline(read.data, filter, newestFirst) : [];
  return (
    <>
      <CommentBox
        pr={pr}
        location={location}
        onPosted={() => {
          read.reload();
          onChanged();
        }}
      />
      <div className="flex flex-wrap items-center gap-3">
        <fieldset className="flex gap-2">
          <legend className="sr-only">Show</legend>
          {COMMENT_FILTERS.map((f) => (
            <label key={f.filter} className="flex items-center gap-1 text-[#c9d1d9]">
              <input type="radio" name={filterName} checked={filter === f.filter} onChange={() => setFilter(f.filter)} />
              {f.label}
            </label>
          ))}
        </fieldset>
        <label className="flex items-center gap-1 text-[#c9d1d9]">
          <input type="checkbox" checked={newestFirst} onChange={(e) => setNewestFirst(e.target.checked)} />
          Newest first
        </label>
      </div>
      <ReadState read={read} what="comments" />
      {read.data && items.length === 0 && (
        <p className={MUTED}>{COMMENT_FILTERS.find((f) => f.filter === filter)?.empty}</p>
      )}
      <ol className="space-y-2">
        {items.map((item) => (
          <TimelineEntry key={item.id} item={item} />
        ))}
      </ol>
      {read.data?.truncated && <p className={MUTED}>Only the most recent comments are shown; see the rest on GitHub.</p>}
    </>
  );
};

const TimelineEntry = ({ item }: { item: TimelineItem }) => (
  <li data-timeline-item={item.id} className="rounded-md border border-[#30363d] bg-[#0d1117] p-2 space-y-1">
    <p className="flex flex-wrap items-baseline gap-1">
      <span className="font-semibold text-[#c9d1d9]">{item.author}</span>
      {item.kind === "review" && item.reviewState && <span className={MUTED}>{REVIEW_VERDICT[item.reviewState] ?? "reviewed"}</span>}
      {item.kind === "thread" && (
        <>
          <span className={MUTED}>on</span>
          <code className="break-all text-[#58a6ff]">{item.path}</code>
          <span data-resolved className={item.resolved ? MUTED : "text-[#d29922]"}>
            {item.resolved ? "Resolved" : "Unresolved"}
          </span>
        </>
      )}
      <When at={item.createdAt} />
    </p>
    {item.body.trim() !== "" && <p className="whitespace-pre-wrap break-words text-[#c9d1d9]">{item.body}</p>}
    {item.replies.length > 0 && (
      <ol className="space-y-1 border-l border-[#30363d] pl-2">
        {item.replies.map((reply) => (
          <li key={reply.id}>
            <p className="flex flex-wrap items-baseline gap-1">
              <span className="font-semibold text-[#c9d1d9]">{reply.author}</span>
              <When at={reply.createdAt} />
            </p>
            <p className="whitespace-pre-wrap break-words text-[#c9d1d9]">{reply.body}</p>
          </li>
        ))}
      </ol>
    )}
  </li>
);

/** The comment box above the timeline: Comment, and Close pull request beside it while it is open. */
const CommentBox = ({ pr, location, onPosted }: { pr: PullRequestReadiness; location: PullRequestLocation; onPosted: () => void }) => {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const typed = body.trim() !== "";
  const act = async (what: string, run: () => Promise<unknown>) => {
    setBusy(true);
    setFailure(null);
    try {
      await run();
    } catch (e) {
      setFailure(`${what} failed: ${errorText(e)}`);
    } finally {
      setBusy(false);
      onPosted();
    }
  };
  return (
    <form
      aria-label="Add a comment"
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (typed)
          void act("Comment", async () => {
            await invoke("comment_on_github_pr", { ...target(location), body });
            setBody("");
          });
      }}
    >
      <textarea
        aria-label="Comment"
        value={body}
        rows={3}
        placeholder="Leave a comment"
        onChange={(e) => setBody(e.target.value)}
        className="w-full resize-y rounded-md border border-[#30363d] bg-[#0d1117] px-2 py-1 text-xs text-[#c9d1d9]"
      />
      <div className="flex justify-end gap-2">
        {pr.state === "OPEN" && (
          <button type="button" disabled={busy} onClick={() => void act("Close", () => invoke("close_github_pr", target(location)))} className={SECONDARY}>
            Close pull request
          </button>
        )}
        <button type="submit" disabled={busy || !typed} className={PRIMARY}>
          Comment
        </button>
      </div>
      {failure && (
        <p role="alert" className="text-[#f85149] break-words">
          {failure}
        </p>
      )}
    </form>
  );
};

// ---- Files ----

/** One changed file at a time, with a picker that marks files with comments, and previous and next. */
const FilesDetail = ({ pr, location }: DetailProps) => {
  const files = useGithubRead<PullRequestFile[]>("get_github_pr_files", target(location));
  const timeline = useGithubRead<PullRequestTimeline>("get_github_pr_timeline", target(location));
  const [index, setIndex] = useState(0);
  const list = files.data ?? [];
  const commented = commentsByPath(timeline.data);
  const at = Math.min(index, Math.max(list.length - 1, 0));
  const file = list[at];
  return (
    <>
      <ReadState read={files} what="files" />
      {files.data?.length === 0 && <p className={MUTED}>This pull request changes no files.</p>}
      {file && (
        <>
          <div className="flex items-center gap-2">
            <button type="button" disabled={at === 0} onClick={() => setIndex(at - 1)} className={SECONDARY}>
              Previous
            </button>
            <select
              aria-label="File"
              value={at}
              onChange={(e) => setIndex(Number(e.target.value))}
              className="min-w-0 flex-1 rounded-md border border-[#30363d] bg-[#0d1117] px-1 py-1 text-xs text-[#c9d1d9]"
            >
              {list.map((f, i) => {
                const comments = commented.get(f.path) ?? 0;
                return (
                  <option key={f.path} value={i}>
                    {comments > 0 ? `💬 ${f.path} (${comments} ${comments === 1 ? "comment" : "comments"})` : f.path}
                  </option>
                );
              })}
            </select>
            <button type="button" disabled={at === list.length - 1} onClick={() => setIndex(at + 1)} className={SECONDARY}>
              Next
            </button>
          </div>
          <p className={MUTED}>
            File {at + 1} of {list.length}
            {list.length < pr.changedFiles && `; GitHub lists the first ${list.length} of ${pr.changedFiles} here`}
          </p>
          <FileDiff file={file} />
        </>
      )}
    </>
  );
};

// ---- Commits ----

/** The pull request's commits, oldest first. */
const CommitsDetail = ({ pr, location }: DetailProps) => {
  const read = useGithubRead<PullRequestCommit[]>("get_github_pr_commits", target(location));
  const commits = read.data ?? [];
  return (
    <>
      <ReadState read={read} what="commits" />
      <ol className="space-y-1">
        {commits.map((commit) => (
          <li key={commit.sha} data-commit={commit.sha} className="flex items-baseline gap-2 rounded-md border border-[#30363d] bg-[#0d1117] p-2">
            <code className="text-[#58a6ff]">{commit.sha.slice(0, 7)}</code>
            <span className="min-w-0 flex-1 break-words text-[#c9d1d9]">{commit.headline}</span>
            <span className={MUTED}>{commit.author}</span>
            <When at={commit.authoredAt} />
          </li>
        ))}
      </ol>
      {read.data && commits.length < pr.commits && (
        <p className={MUTED}>
          GitHub lists the first {commits.length} of {pr.commits} commits here.
        </p>
      )}
    </>
  );
};
