import type { ReactNode } from "react";
import type { PullRequestFile } from "../github/types.ts";

const PATCH_LINE: Record<string, string> = { "+": "text-[#3fb950]", "-": "text-[#f85149]", "@": "text-[#58a6ff]" };

/** A patch's lines, each with the offset it starts at in the patch, which names it. */
const patchLines = (patch: string) => {
  let at = 0;
  return patch.split("\n").map((line) => {
    const entry = { at, line };
    at += line.length + 1;
    return entry;
  });
};

/**
 * One changed file's diff: its path and diffstat, then its patch. `capped` keeps a long patch to a
 * scrolling box, as the Files detail does; the diff lens stacks patches at full height. `controls`
 * go at the end of the header.
 */
export const FileDiff = ({ file, capped = true, controls }: { file: PullRequestFile; capped?: boolean; controls?: ReactNode }) => (
  <article data-file={file.path} aria-label={file.path} className="rounded-md border border-[#30363d] bg-[#0d1117]">
    <header className="flex flex-wrap items-baseline gap-2 border-b border-[#30363d] px-2 py-1">
      <code className="break-all text-[#c9d1d9]">
        {file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}
      </code>
      <span className="ml-auto font-mono">
        <span className="text-[#3fb950]">+{file.additions}</span> <span className="text-[#f85149]">−{file.deletions}</span>
      </span>
      {controls}
    </header>
    {file.patch === null ? (
      <p className="p-2 text-[#8b949e]">No diff to show: the file is binary, or too large for GitHub to show.</p>
    ) : (
      <pre className={`${capped ? "max-h-96 " : ""}overflow-auto p-2 font-mono text-[11px] leading-4`}>
        {patchLines(file.patch).map(({ at, line }) => (
          <div key={at} className={PATCH_LINE[line[0]] ?? "text-[#c9d1d9]"}>
            {line === "" ? " " : line}
          </div>
        ))}
      </pre>
    )}
  </article>
);
