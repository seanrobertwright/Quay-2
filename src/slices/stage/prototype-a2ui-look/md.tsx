// PROTOTYPE (#696), throwaway. Enough Markdown to show a surface's text in Quay's look. The real one
// is @a2ui/markdown-it (#691).
import { Fragment, useContext, type ReactNode } from "react";
import { FileLink, ImageBox, LooksContext, WebLink } from "./frame.tsx";

const inline = (s: string): ReactNode[] =>
  s.split(/(!\[[^\]]*\]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g).map((part, i) => {
    if (part.startsWith("`")) return <code key={i} className="px-1 rounded bg-[#30363d]/60 text-[0.92em] break-words">{part.slice(1, -1)}</code>;
    if (part.startsWith("**")) return <strong key={i} className="font-semibold text-[#f0f6fc]">{part.slice(2, -2)}</strong>;
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (link && /^https?:/.test(link[2])) return <WebLink key={i} label={link[1]} href={link[2]} />;
    if (link && /^[a-z]{2,}:/i.test(link[2])) return <Fragment key={i}>{link[1]}</Fragment>;
    if (link) return <FileLink key={i} label={link[1]} path={link[2]} />;
    const image = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(part);
    if (image) return <ImageBox key={i} alt={image[1]} src={image[2]} />;
    return <Fragment key={i}>{part}</Fragment>;
  });

const DIFF_TONE: Record<string, [string, string]> = { "+": ["bg-[#238636]/25", "text-[#7ee787]"], "-": ["bg-[#da3633]/20", "text-[#ffa198]"] };
const Diff = ({ lines }: { lines: string[] }) => {
  const { diff } = useContext(LooksContext);
  return (
    <pre className="my-2 py-2 rounded-md border border-[#30363d] bg-[#161b22] text-[11px] leading-5 overflow-x-auto font-mono text-[#c9d1d9]">
      <code className="block min-w-max">
        {lines.map((l, i) => {
          const [ground, tone] = DIFF_TONE[l[0]] ?? ["", ""];
          return (
            <span key={`${i} ${l}`} className={`block px-3 ${diff === "B" ? tone : ground} ${diff === "C" && ground ? `border-l-[3px] ${l[0] === "+" ? "border-[#3fb950]" : "border-[#f85149]"} pl-[9px]` : ""}`}>
              {diff === "C" && ground ? (
                <>
                  <span className="sr-only">{l[0] === "+" ? "added " : "removed "}</span>
                  {l.slice(1)}
                </>
              ) : (
                l || " "
              )}
            </span>
          );
        })}
      </code>
    </pre>
  );
};

const Table = ({ rows }: { rows: string[][] }) => {
  const { table } = useContext(LooksContext);
  if (table === "C")
    return (
      <div className="@container my-2">
        <dl className="@md:hidden flex flex-col gap-2">
          {rows.slice(1).map((r) => (
            <div key={r.join()} className="rounded-md border border-[#30363d] px-2.5 py-1.5 grid grid-cols-[auto_1fr] gap-x-3 text-[11px]">
              {r.map((c, j) => (
                <Fragment key={rows[0][j]}>
                  <dt className="text-[#8b949e]">{inline(rows[0][j])}</dt>
                  <dd>{inline(c)}</dd>
                </Fragment>
              ))}
            </div>
          ))}
        </dl>
        <div className="hidden @md:block">
          <Grid rows={rows} className="" />
        </div>
      </div>
    );
  return (
    <div className="my-2 overflow-x-auto">
      <Grid rows={rows} className={table === "B" ? "w-full table-fixed text-[10px]" : "[&_th]:whitespace-nowrap [&_td]:whitespace-nowrap"} />
    </div>
  );
};
const Grid = ({ rows, className }: { rows: string[][]; className: string }) => (
  <table className={`text-[0.95em] border-collapse ${className}`}>
    <thead>
      <tr>
        {rows[0].map((c) => (
          <th key={c} className="text-left font-medium text-[#8b949e] border border-[#30363d] px-2 py-1 bg-[#161b22] break-words">
            {inline(c)}
          </th>
        ))}
      </tr>
    </thead>
    <tbody>
      {rows.slice(1).map((r) => (
        <tr key={r.join()}>
          {r.map((c, j) => (
            <td key={rows[0][j]} className="border border-[#30363d] px-2 py-1 break-words align-top">
              {inline(c)}
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  </table>
);

export const Md = ({ text, className = "", tone = "text-[#c9d1d9]" }: { text: string; className?: string; tone?: string }) => {
  const lines = text.split("\n");
  const out: ReactNode[] = [];
  for (let i = 0; i < lines.length; ) {
    const line = lines[i];
    const key = i;
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith("```")) {
      const code: string[] = [];
      const isDiff = line.startsWith("```diff");
      for (i++; i < lines.length && !lines[i].startsWith("```"); i++) code.push(lines[i]);
      i++;
      if (isDiff) out.push(<Diff key={key} lines={code} />);
      else out.push(
        <pre key={key} className="my-2 p-3 rounded-md border border-[#30363d] bg-[#161b22] text-[12px] leading-5 overflow-x-auto font-mono text-[#c9d1d9]">
          {code.join("\n")}
        </pre>,
      );
    } else if (/^#+ /.test(line)) {
      out.push(
        <h4 key={key} className="mt-5 mb-1.5 text-[15px] font-semibold text-[#f0f6fc]">
          {inline(line.replace(/^#+ /, ""))}
        </h4>,
      );
      i++;
    } else if (line.startsWith("|")) {
      const rows: string[][] = [];
      for (; i < lines.length && lines[i].startsWith("|"); i++) if (!/^\|[-| ]+\|$/.test(lines[i])) rows.push(lines[i].split("|").slice(1, -1).map((c) => c.trim()));
      out.push(<Table key={key} rows={rows} />);
    } else if (/^(- |\d+\. )/.test(line)) {
      const items: string[] = [];
      const ordered = /^\d/.test(line);
      for (; i < lines.length && /^(- |\d+\. )/.test(lines[i]); i++) items.push(lines[i].replace(/^(- |\d+\. )/, ""));
      const List = ordered ? "ol" : "ul";
      out.push(
        <List key={key} className={`my-1.5 pl-5 ${ordered ? "list-decimal" : "list-disc"} marker:text-[#6e7681]`}>
          {items.map((t) => (
            <li key={t} className="my-0.5">
              {inline(t)}
            </li>
          ))}
        </List>,
      );
    } else {
      out.push(
        <p key={key} className="my-1.5">
          {inline(line)}
        </p>,
      );
      i++;
    }
  }
  return <div className={`[&>:first-child]:mt-0 [&>:last-child]:mb-0 break-words ${tone} ${className}`}>{out}</div>;
};
