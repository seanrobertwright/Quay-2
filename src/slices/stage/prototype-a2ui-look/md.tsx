// PROTOTYPE (#696), throwaway. Enough Markdown to show a surface's text in Quay's look. The real one
// is @a2ui/markdown-it (#691).
import { Fragment, type ReactNode } from "react";
import { WebLink } from "./frame.tsx";

const inline = (s: string): ReactNode[] =>
  s.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g).map((part, i) => {
    if (part.startsWith("`")) return <code key={i} className="px-1 rounded bg-[#30363d]/60 text-[0.92em] break-words">{part.slice(1, -1)}</code>;
    if (part.startsWith("**")) return <strong key={i} className="font-semibold text-[#f0f6fc]">{part.slice(2, -2)}</strong>;
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (link) return <WebLink key={i} label={link[1]} href={link[2]} />;
    return <Fragment key={i}>{part}</Fragment>;
  });

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
      for (i++; i < lines.length && !lines[i].startsWith("```"); i++) code.push(lines[i]);
      i++;
      out.push(
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
      out.push(
        <div key={key} className="my-2 overflow-x-auto">
          <table className="text-[0.95em] border-collapse">
            <thead>
              <tr>
                {rows[0].map((c) => (
                  <th key={c} className="text-left font-medium text-[#8b949e] border border-[#30363d] px-2.5 py-1 bg-[#161b22]">
                    {inline(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(1).map((r) => (
                <tr key={r.join()}>
                  {r.map((c, j) => (
                    <td key={rows[0][j]} className="border border-[#30363d] px-2.5 py-1">
                      {inline(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
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
