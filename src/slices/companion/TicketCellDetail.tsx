import { useId, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { IssueChoices, IssueState, IssueStatus, IssueRef, PullRequestState } from "../github/types.ts";
import { formatDateTime, formatRelative, parseUtcTimestamp } from "../../lib/dates.ts";
import {
  checkStateText,
  CLOSE_REASON_TEXT,
  CLOSE_REASONS,
  closeButtonLabel,
  newComments,
  type CloseReason,
  type TicketCellId,
} from "./ticketStatus.ts";
import { errorText } from "./usePullRequestReadiness.ts";
import { SplitButton } from "./SplitButton.tsx";
import { closeTicket } from "./closeTicket.ts";
import type { Acting, TicketLocation } from "./TicketView.tsx";
import { Failure, useAction } from "./PullRequestView.tsx";
import { useGithubRead, type GithubRead } from "./useGithubRead.ts";
import { MUTED, PRIMARY, SECONDARY } from "./buttonStyles.ts";

const LABELS: Record<TicketCellId, string> = {
  "blocked-by": "Blocked by",
  comments: "Comments",
  "pull-request": "Pull request",
  details: "Details",
};

/** The props every cell's detail takes. */
interface DetailProps {
  issue: IssueStatus;
  acting: Acting;
}

/** The open cell's detail, under the status card. `id` is what the cell's `aria-controls` names. */
export const TicketCellDetail = ({ cell, id, ...props }: DetailProps & { cell: TicketCellId; id: string }) => (
  <section id={id} data-cell-detail aria-label={LABELS[cell]} className="space-y-2">
    {cell === "blocked-by" && <BlockedByDetail {...props} />}
    {cell === "comments" && <CommentsDetail {...props} />}
    {cell === "pull-request" && <PullRequestDetail {...props} />}
    {cell === "details" && <DetailsDetail {...props} />}
  </section>
);

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

// ---- Comments ----

/** The comment box, then the ticket's comments oldest first, with the ones the viewer has not answered marked New. */
const CommentsDetail = ({ issue, acting }: DetailProps) => {
  const fresh = new Set(newComments(issue).map((c) => c.id));
  return (
    <>
      <CommentBox issue={issue} acting={acting} />
      {issue.comments.length === 0 && <p className={MUTED}>No comments yet.</p>}
      <ol className="space-y-2">
        {issue.comments.map((c) => (
          <li key={c.id} data-comment={c.id} className="rounded-md border border-[#30363d] bg-[#0d1117] p-2 space-y-1">
            <p className="flex flex-wrap items-baseline gap-1">
              <span className="font-semibold text-[#c9d1d9]">{c.author}</span>
              <When at={c.createdAt} />
              {fresh.has(c.id) && (
                <span data-new className="rounded-full bg-[#d2992226] px-1.5 text-[#d29922]">
                  New
                </span>
              )}
            </p>
            <p className="whitespace-pre-wrap break-words text-[#c9d1d9]">{c.body}</p>
          </li>
        ))}
      </ol>
      {issue.commentCount > issue.comments.length && (
        <p className={MUTED}>
          Only the most recent {issue.comments.length} of {issue.commentCount} comments are shown; see the rest on GitHub.
        </p>
      )}
    </>
  );
};

const REASON_ITEMS = CLOSE_REASONS.map((reason) => ({
  key: reason,
  label: CLOSE_REASON_TEXT[reason].charAt(0).toUpperCase() + CLOSE_REASON_TEXT[reason].slice(1),
}));

/**
 * The comment box above the timeline: Comment, and beside it, while the ticket is open, the close
 * split button whose menu picks completed, not planned or duplicate. It reads Close with comment
 * once text is typed, and then posts the text before closing.
 */
const CommentBox = ({ issue, acting }: DetailProps) => {
  const [body, setBody] = useState("");
  const [reason, setReason] = useState<CloseReason>("COMPLETED");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const typed = body.trim() !== "";
  const act = async (what: string, run: () => Promise<unknown>) => {
    setBusy(true);
    setFailure(null);
    try {
      await run();
      setBody("");
    } catch (e) {
      setFailure(`${what} failed: ${errorText(e)}`);
    } finally {
      setBusy(false);
      acting.onChanged();
    }
  };
  const close = () =>
    void act("Close", () => closeTicket(acting.location, reason, typed ? body : null));
  return (
    <form
      aria-label="Add a comment"
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (typed) void act("Comment", () => invoke("comment_on_github_issue", { ...acting.location, body }));
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
        {issue.state === "OPEN" && (
          <SplitButton
            label={closeButtonLabel(reason, typed)}
            onMain={close}
            toggleLabel="Choose a close reason"
            menuLabel="Close reason"
            items={REASON_ITEMS}
            checked={reason}
            onPick={setReason}
            disabled={busy}
            tone="secondary"
          />
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

// ---- Details ----

const WEB_LINK = /^https?:\/\//i;

/** A GitHub page, opened in the browser; only web links reach the system opener. */
export const GithubLink = ({ url, children }: { url: string; children: ReactNode }) =>
  WEB_LINK.test(url) ? (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => {
        e.preventDefault();
        openUrl(url).catch(console.error);
      }}
      className="break-words text-[#58a6ff] hover:underline"
    >
      {children}
    </a>
  ) : (
    <span className="break-words text-[#c9d1d9]">{children}</span>
  );

/** Which Edit picker is open. */
type PickerId = "assignees" | "labels" | "type";

/**
 * The ticket's details: Assignees, Labels and Type, each with an Edit picker (and Assign yourself
 * while unassigned), then Milestone, Parent, Blocked by and Development, which are read-only and
 * open on GitHub.
 */
const DetailsDetail = ({ issue, acting }: DetailProps) => {
  const [picker, setPicker] = useState<PickerId | null>(null);
  const { busy, failure, run } = useAction(acting.onChanged);
  /** Runs `command` on the ticket with `args`, named `what` should it fail. */
  const change = (what: string, command: string, args: Record<string, unknown>) =>
    void run(what, async () => {
      await invoke(command, { ...acting.location, ...args });
      return null;
    });
  const edit = (id: PickerId, label: string) => (
    <button
      type="button"
      aria-label={`Edit ${label}`}
      aria-expanded={picker === id}
      onClick={() => setPicker((open) => (open === id ? null : id))}
      className={`${SECONDARY} ml-auto h-6 px-2`}
    >
      Edit
    </button>
  );
  const none = <span className={MUTED}>None</span>;
  return (
    <>
      <DetailRow name="Assignees" edit={edit("assignees", "assignees")}>
        {issue.assignees.length > 0 ? (
          <span className="text-[#c9d1d9]">{issue.assignees.join(", ")}</span>
        ) : (
          <span className="flex items-center gap-2">
            <span className={MUTED}>No one</span>
            {issue.viewer !== "" && (
              <button
                type="button"
                disabled={busy}
                onClick={() => change("Assign", "edit_github_issue_assignees", { add: [issue.viewer], remove: [] })}
                className="text-[#58a6ff] hover:underline disabled:opacity-50"
              >
                Assign yourself
              </button>
            )}
          </span>
        )}
        {picker === "assignees" && (
          <ChoicePicker
            location={acting.location}
            label="Assignees"
            options={(c) => union(c.assignees, issue.assignees)}
            chosen={issue.assignees}
            disabled={busy}
            onToggle={(login, on) =>
              change(on ? "Assign" : "Unassign", "edit_github_issue_assignees", { add: on ? [login] : [], remove: on ? [] : [login] })
            }
          />
        )}
      </DetailRow>
      <DetailRow name="Labels" edit={edit("labels", "labels")}>
        {issue.labels.length > 0 ? (
          <span className="flex flex-wrap gap-1">
            {issue.labels.map((label) => (
              <span key={label.name} className="rounded-full border border-[#30363d] px-2 text-[#c9d1d9]">
                {label.name}
              </span>
            ))}
          </span>
        ) : (
          none
        )}
        {picker === "labels" && (
          <ChoicePicker
            location={acting.location}
            label="Labels"
            options={(c) =>
              union(
                c.labels.map((l) => l.name),
                issue.labels.map((l) => l.name),
              )
            }
            chosen={issue.labels.map((l) => l.name)}
            disabled={busy}
            onToggle={(name, on) => change("Label", "edit_github_issue_labels", { add: on ? [name] : [], remove: on ? [] : [name] })}
          />
        )}
      </DetailRow>
      <DetailRow name="Type" edit={edit("type", "type")}>
        {issue.issueType ? <span className="text-[#c9d1d9]">{issue.issueType}</span> : none}
        {picker === "type" && (
          <TypePicker
            location={acting.location}
            chosen={issue.issueType}
            disabled={busy}
            onPick={(issueType) => change("Set type", "set_github_issue_type", { issueType })}
          />
        )}
      </DetailRow>
      <DetailRow name="Milestone">
        {issue.milestone ? <GithubLink url={issue.milestone.url}>{issue.milestone.title}</GithubLink> : none}
      </DetailRow>
      <DetailRow name="Parent">
        {issue.parent ? (
          <GithubLink url={issue.parent.url}>
            {issue.parent.title} #{issue.parent.number}
          </GithubLink>
        ) : (
          none
        )}
      </DetailRow>
      <DetailRow name="Blocked by">
        {issue.blockedBy.length > 0 ? (
          <ul className="space-y-0.5">
            {issue.blockedBy.map((b) => (
              <li key={`${b.repo}#${b.number}`}>
                <GithubLink url={b.url}>
                  {b.title} #{b.number}
                </GithubLink>
              </li>
            ))}
          </ul>
        ) : (
          none
        )}
      </DetailRow>
      <DetailRow name="Development">
        {issue.pullRequests.length > 0 ? (
          <ul className="space-y-0.5">
            {issue.pullRequests.map((pr) => (
              <li key={`${pr.repo}#${pr.number}`}>
                <GithubLink url={pr.url}>
                  {pr.title} #{pr.number}
                </GithubLink>
              </li>
            ))}
          </ul>
        ) : (
          none
        )}
      </DetailRow>
      <Failure text={failure} />
    </>
  );
};

/** `first`, then the members of `second` it lacks, in order. */
const union = (first: readonly string[], second: readonly string[]) => [...first, ...second.filter((x) => !first.includes(x))];

const DetailRow = ({ name, edit, children }: { name: string; edit?: ReactNode; children: ReactNode }) => (
  <section data-detail-row={name} aria-label={name} className="space-y-1 border-b border-[#30363d] pb-2 last:border-b-0">
    <h4 className="flex items-center font-semibold text-[#8b949e]">
      {name}
      {edit}
    </h4>
    {children}
  </section>
);

/** Reads what the Edit pickers offer in the ticket's repository. */
const useChoices = (location: TicketLocation) =>
  useGithubRead<IssueChoices>("get_github_issue_choices", { repoPath: location.repoPath, repo: location.repo });

/** An Edit picker of checkboxes: each toggle adds or removes one choice at once. */
const ChoicePicker = ({
  location,
  label,
  options,
  chosen,
  disabled,
  onToggle,
}: {
  location: TicketLocation;
  label: string;
  options: (choices: IssueChoices) => string[];
  chosen: readonly string[];
  disabled: boolean;
  onToggle: (option: string, on: boolean) => void;
}) => {
  const read = useChoices(location);
  return (
    <fieldset className="max-h-48 overflow-y-auto rounded-md border border-[#30363d] bg-[#0d1117] p-2 space-y-1">
      <legend className="sr-only">{label}</legend>
      <ChoicesState read={read} />
      {read.data &&
        options(read.data).map((option) => (
          <label key={option} className="flex items-center gap-2 text-[#c9d1d9]">
            <input
              type="checkbox"
              disabled={disabled}
              checked={chosen.includes(option)}
              onChange={(e) => onToggle(option, e.target.checked)}
            />
            {option}
          </label>
        ))}
    </fieldset>
  );
};

/** The Type Edit picker: No type, then one radio per issue type in the repository. */
const TypePicker = ({
  location,
  chosen,
  disabled,
  onPick,
}: {
  location: TicketLocation;
  chosen: string | null;
  disabled: boolean;
  onPick: (type: string | null) => void;
}) => {
  const read = useChoices(location);
  const name = useId();
  const types: (string | null)[] = [null, ...union(read.data?.types ?? [], chosen ? [chosen] : [])];
  return (
    <fieldset className="rounded-md border border-[#30363d] bg-[#0d1117] p-2 space-y-1">
      <legend className="sr-only">Type</legend>
      <ChoicesState read={read} />
      {read.data?.types.length === 0 && <p className={MUTED}>This repository has no issue types.</p>}
      {read.data &&
        types.map((type) => (
          <label key={type ?? ""} className="flex items-center gap-2 text-[#c9d1d9]">
            <input type="radio" name={name} disabled={disabled} checked={type === chosen} onChange={() => onPick(type)} />
            {type ?? "No type"}
          </label>
        ))}
    </fieldset>
  );
};

const ChoicesState = ({ read }: { read: GithubRead<IssueChoices> }) =>
  read.error ? (
    <p role="alert" className="text-[#f85149] break-words">
      Could not read the choices: {read.error}
    </p>
  ) : read.data === null ? (
    <p className={MUTED}>Reading the choices…</p>
  ) : null;

// ---- Blocked by and Pull request ----

const STATE_TEXT: Record<IssueState | PullRequestState, string> = { OPEN: "Open", CLOSED: "Closed", MERGED: "Merged" };

/** A blocker, the parent or a pull request: its title and number on GitHub, its state, and Show. */
const RefRow = ({
  repo,
  number,
  title,
  url,
  state,
  onShow,
}: {
  repo: string;
  number: number;
  title: string;
  url: string;
  state: string;
  onShow: (() => void) | null;
}) => (
  <li data-ref={`${repo}#${number}`} className="flex items-center gap-2 rounded-md border border-[#30363d] bg-[#0d1117] p-2">
    <span className="min-w-0 flex-1">
      <GithubLink url={url}>
        {title} #{number}
      </GithubLink>{" "}
      <span className={MUTED}>{state}</span>
    </span>
    {onShow && (
      <button type="button" aria-label={`Show ${title} #${number}`} onClick={onShow} className={`${SECONDARY} h-6 px-2`}>
        Show
      </button>
    )}
  </li>
);

/** The ticket's blockers, open and closed, then its parent, each of which Show pins as the terminal's ticket. */
const BlockedByDetail = ({ issue, acting }: DetailProps) => {
  const show = acting.showTicket;
  const row = (ref: IssueRef) => (
    <RefRow
      key={`${ref.repo}#${ref.number}`}
      {...ref}
      state={STATE_TEXT[ref.state]}
      onShow={show && (() => show({ repo: ref.repo, number: ref.number }))}
    />
  );
  return (
    <>
      {issue.blockedBy.length === 0 ? <p className={MUTED}>Nothing blocks this ticket.</p> : <ul className="space-y-1">{issue.blockedBy.map(row)}</ul>}
      {issue.openBlockerCount > issue.blockedBy.filter((b) => b.state === "OPEN").length && (
        <p className={MUTED}>GitHub counts {issue.openBlockerCount} open blockers; see the rest on GitHub.</p>
      )}
      {issue.parent && (
        <>
          <h4 className="font-semibold text-[#8b949e]">Parent</h4>
          <ul>{row(issue.parent)}</ul>
        </>
      )}
    </>
  );
};

/** The pull requests that will close the ticket, each with its state, which Show opens in the companion. */
const PullRequestDetail = ({ issue, acting }: DetailProps) => {
  const show = acting.showPullRequest;
  if (issue.pullRequests.length === 0) return <p className={MUTED}>No pull request will close this ticket yet.</p>;
  return (
    <ul className="space-y-1">
      {issue.pullRequests.map((pr) => (
        <RefRow
          key={`${pr.repo}#${pr.number}`}
          {...pr}
          state={pr.state === "OPEN" ? `Open · ${checkStateText(pr.checkState)}` : STATE_TEXT[pr.state]}
          onShow={show && (() => show({ repo: pr.repo, number: pr.number }))}
        />
      ))}
    </ul>
  );
};
