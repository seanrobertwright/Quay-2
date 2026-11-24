// PROTOTYPE (#696), throwaway. The review surface on a stage tab, three layouts: A document with a
// decision rail, B one column with a docked decision bar, C three pages.
import { useId, useState, type ReactNode } from "react";
import { FileText } from "lucide-react";
import { PRIMARY, SECONDARY } from "../../companion/buttonStyles.ts";
import type { Review } from "./content.ts";
import { Frame, Settled, type Key } from "./frame.tsx";
import { Md } from "./md.tsx";

const DANGER = "h-7 px-3 rounded-md text-xs border border-[#da3633]/50 bg-[#da3633]/10 text-[#ff7b72] hover:bg-[#da3633]/25";
const toggled = (s: ReadonlySet<string>, t: string) => {
  const next = new Set(s);
  if (!next.delete(t)) next.add(t);
  return next;
};

export const ReviewSurface = ({ review, layout, onVerdict, onDismiss }: { review: Review; layout: Key; onVerdict: (text: string) => void; onDismiss: () => void }) => {
  const items = review.items ?? [];
  const id = useId();
  const [dropped, setDropped] = useState<ReadonlySet<string>>(new Set());
  const [openDetail, setOpenDetail] = useState<ReadonlySet<string>>(new Set());
  const [comment, setComment] = useState("");
  const [need, setNeed] = useState(false);
  const [page, setPage] = useState(0);
  const [verdict, setVerdict] = useState<string | null>(null);
  const give = (v: string) => {
    if (v === "Changes requested" && !comment.trim()) {
      setNeed(true);
      return;
    }
    setVerdict(v);
    onVerdict(`${v}${dropped.size ? `, dropped ${dropped.size}` : ""}${comment ? `, "${comment}"` : ""}`);
  };

  const list = items.length > 0 && (
    <div>
      <div className="flex items-baseline gap-2 mb-1.5">
        <h4 className="text-xs font-semibold text-[#f0f6fc]">Keep or drop</h4>
        <span className="text-[11px] text-[#8b949e]">
          {items.length - dropped.size} of {items.length} kept
        </span>
      </div>
      <ul className="flex flex-col rounded-md border border-[#30363d] divide-y divide-[#30363d]">
        {items.map((it) => {
          const off = dropped.has(it.title);
          const open = openDetail.has(it.title);
          return (
            <li key={it.title} className="flex items-start gap-2 px-2.5 py-2">
              <input id={`${id}${it.title}`} type="checkbox" checked={!off} onChange={() => setDropped(toggled(dropped, it.title))} className="mt-0.5 accent-[#58a6ff] shrink-0" />
              <div className={`min-w-0 flex-1 ${off ? "opacity-55" : ""}`}>
                <label htmlFor={`${id}${it.title}`} className={`block text-xs text-[#f0f6fc] cursor-pointer break-words ${off ? "line-through" : ""}`}>
                  {it.title}
                </label>
                {it.detail && <p className={`text-[11px] leading-4 text-[#8b949e] break-words ${open ? "" : "line-clamp-2"}`}>{it.detail}</p>}
                {it.detail && it.detail.length > 140 && (
                  <button type="button" aria-expanded={open} onClick={() => setOpenDetail(toggled(openDetail, it.title))} className="text-[11px] text-[#58a6ff] hover:underline">
                    {open ? "Less" : "More"}
                  </button>
                )}
                {it.file && (
                  <button type="button" title={`Show ${it.file}`} className="mt-0.5 flex items-center gap-1 max-w-full text-[11px] font-mono text-[#58a6ff] hover:underline">
                    <FileText className="w-3 h-3 shrink-0" aria-hidden />
                    <span className="break-all text-left">{it.file}</span>
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
  const commentBox = (rows: number): ReactNode => (
    <div>
      <label htmlFor={`${id}c`} className="text-[11px] text-[#8b949e]">
        Comment for the agent
      </label>
      <textarea
        id={`${id}c`}
        rows={rows}
        value={comment}
        aria-invalid={need}
        onChange={(e) => {
          setComment(e.target.value);
          setNeed(false);
        }}
        className={`mt-0.5 block w-full px-2 py-1.5 rounded-md bg-[#010409] border text-xs text-[#c9d1d9] resize-y ${need ? "border-[#da3633]" : "border-[#30363d]"}`}
      />
      {need && (
        <p role="alert" className="text-[11px] text-[#ff7b72]">
          Say what should change.
        </p>
      )}
    </div>
  );
  const buttons = (
    <div className="flex flex-wrap gap-2">
      <button type="button" className={PRIMARY} onClick={() => give("Approved")}>
        {dropped.size ? `Approve without ${dropped.size} item${dropped.size > 1 ? "s" : ""}` : "Approve"}
      </button>
      <button type="button" className={SECONDARY} onClick={() => give("Changes requested")}>
        Request changes
      </button>
      <button type="button" className={DANGER} onClick={() => give("Rejected")}>
        Reject
      </button>
    </div>
  );
  const body = <Md text={review.body} className="text-[13px] leading-[21px] max-w-[72ch] min-w-0" />;
  const frame = (children: ReactNode) => (
    <Frame terminal="fix-75" cli="claude" kind="review" title={review.title} onDismiss={onDismiss}>
      {children}
    </Frame>
  );

  if (verdict)
    return (
      <div className="h-full overflow-y-auto p-4">
        <div className="max-w-3xl mx-auto">
          {frame(
            <>
              <Settled
                verb={`${verdict}, sent`}
                lines={[["Verdict", verdict], ["Dropped", [...dropped].join("; ") || "Nothing"], ...(comment ? ([["Comment", comment]] as [string, string][]) : [])]}
              />
              <details className="text-xs text-[#8b949e]">
                <summary className="cursor-pointer">What was reviewed</summary>
                <div className="mt-2">{body}</div>
              </details>
            </>,
          )}
        </div>
      </div>
    );
  if (layout === "A")
    return (
      <div className="p-4 @container h-full overflow-y-auto">
        <div className="max-w-[1180px] mx-auto">
          {frame(
            <div className="grid gap-6 @3xl:grid-cols-[minmax(0,1fr)_340px]">
              {body}
              <aside aria-label="Your decision" className="@3xl:sticky @3xl:top-2 self-start flex flex-col gap-3">
                <div className="@3xl:max-h-[44vh] overflow-y-auto">{list}</div>
                {commentBox(3)}
                {buttons}
              </aside>
            </div>,
          )}
        </div>
      </div>
    );
  if (layout === "B")
    return (
      <div className="h-full flex flex-col">
        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          <div className="max-w-3xl mx-auto">
            {frame(
              <>
                {body}
                {list}
              </>,
            )}
          </div>
        </div>
        <div className="shrink-0 border-t border-[#30363d] bg-[#161b22] px-4 py-2.5">
          <div className="max-w-3xl mx-auto flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-48">{commentBox(1)}</div>
            {buttons}
          </div>
        </div>
      </div>
    );
  const pages = ["Read", ...(items.length ? ["Items"] : []), "Verdict"];
  const name = pages[page];
  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="max-w-3xl mx-auto">
        {frame(
          <>
            <div className="flex gap-1">
              {pages.map((p, i) => (
                <button
                  key={p}
                  type="button"
                  aria-pressed={i === page}
                  onClick={() => setPage(i)}
                  className={`h-7 px-3 rounded-full text-xs border ${i === page ? "border-[#58a6ff] bg-[#1f6feb26] text-white" : "border-[#30363d] text-[#8b949e]"}`}
                >
                  {i + 1}. {p}
                  {p === "Items" ? ` (${items.length - dropped.size} of ${items.length})` : ""}
                </button>
              ))}
            </div>
            {name === "Read" && body}
            {name === "Items" && list}
            {name === "Verdict" && (
              <>
                {commentBox(4)}
                {buttons}
              </>
            )}
            {page < pages.length - 1 && (
              <button type="button" className={`${SECONDARY} self-end`} onClick={() => setPage(page + 1)}>
                Next
              </button>
            )}
          </>,
        )}
      </div>
    </div>
  );
};
