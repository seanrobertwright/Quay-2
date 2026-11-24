// What each Markdown token is drawn as. Children are positional, so none needs a key, and no
// attribute a token carries is copied.
import { createElement, Fragment, type ReactNode } from "react";
import type { Token } from "markdown-it";
import { MarkdownLink } from "./MarkdownLink.tsx";

type Draw = (token: Token, children: ReactNode[]) => ReactNode;

const BOX = "rounded border border-[#30363d] bg-[#161b22]";
const HEADING_SIZE = ["text-base", "text-sm", "text-[13px]", "text-xs", "text-xs", "text-xs"];

const element =
  (tag: string, className?: string): Draw =>
  (_token, children) =>
    createElement(tag, { className }, ...children);

/** Headings start at the third level, below those of Quay's own window. */
const heading: Draw = ({ tag }, children) => {
  const level = Number(tag.slice(1));
  return createElement(`h${Math.min(6, level + 2)}`, { className: `font-semibold text-white ${HEADING_SIZE[level - 1]}` }, ...children);
};

/** A paragraph of a tight list is drawn without one's spacing. */
const paragraph: Draw = ({ hidden }, children) => (hidden ? createElement(Fragment, null, ...children) : createElement("p", null, ...children));

const orderedList: Draw = (token, children) => {
  const start = Number(token.attrGet("start") ?? 1);
  return createElement("ol", { className: "flex list-decimal flex-col gap-1 pl-6", ...(start === 1 ? {} : { start }) }, ...children);
};

const codeBlock: Draw = ({ content }) => (
  <pre className={`max-w-full overflow-x-auto p-2 font-mono text-[11px] whitespace-pre ${BOX}`}>
    <code>{content}</code>
  </pre>
);

/** A removed or added line's tint. The line keeps its sign, so it is told without colour too. */
const DIFF_TINT: ReadonlyMap<string, string> = new Map([
  ["-", "bg-[#da3633]/20 text-[#ffa198]"],
  ["+", "bg-[#238636]/20 text-[#7ee787]"],
]);

const diffBlock = (content: string) => {
  const lines = content.replace(/\n$/, "").split("\n");
  const spans = lines.map((line) => createElement("span", { className: `block ${DIFF_TINT.get(line.charAt(0)) ?? ""}` }, `${line}\n`));
  return (
    <pre className={`max-w-full overflow-x-auto p-2 font-mono text-[11px] whitespace-pre ${BOX}`}>
      {createElement("code", { className: "block w-fit min-w-full" }, ...spans)}
    </pre>
  );
};

/** A fence, whose first word says what it holds. */
const fence: Draw = (token, children) =>
  token.info.trim().split(/\s/)[0] === "diff" ? diffBlock(token.content) : codeBlock(token, children);

/** A table, as wide as what it holds, in a box of its own that scrolls. A long cell wraps at words. */
const table: Draw = (_token, children) => (
  <div className={`max-w-full overflow-x-auto ${BOX}`}>{createElement("table", { className: "w-max border-collapse text-left wrap-normal" }, ...children)}</div>
);

const ALIGN: ReadonlyMap<string, string> = new Map([
  ["text-align:right", "text-right"],
  ["text-align:center", "text-center"],
]);

const cell =
  (tag: "th" | "td"): Draw =>
  (token, children) => {
    const align = ALIGN.get(String(token.attrGet("style"))) ?? "";
    return createElement(tag, { className: `max-w-64 px-2 py-1 align-top wrap-break-word ${tag === "th" ? "font-semibold text-white" : ""} ${align}` }, ...children);
  };

/** How each token type is drawn, opening ones without their `_open`. */
export const ELEMENTS: ReadonlyMap<string, Draw> = new Map<string, Draw>([
  ["text", ({ content }) => content],
  // In a paragraph a line break is a space.
  ["softbreak", () => " "],
  ["hardbreak", () => <br />],
  ["em", element("em", "italic")],
  ["strong", element("strong", "font-semibold text-white")],
  ["s", element("s")],
  ["code_inline", ({ content }) => <code className={`px-1 font-mono text-[11px] ${BOX}`}>{content}</code>],
  ["link", (token, children) => createElement(MarkdownLink, { href: String(token.attrGet("href")) }, ...children)],
  // Named as it was written. Nothing is loaded.
  ["image", (token) => `![${token.content}](${token.attrGet("src")})`],
  ["paragraph", paragraph],
  ["heading", heading],
  ["bullet_list", element("ul", "flex list-disc flex-col gap-1 pl-5")],
  ["ordered_list", orderedList],
  ["list_item", element("li")],
  ["blockquote", element("blockquote", "flex flex-col gap-2 border-l-2 border-[#30363d] pl-3 text-[#8b949e]")],
  ["hr", () => <hr className="border-[#30363d]" />],
  ["code_block", codeBlock],
  ["fence", fence],
  ["table", table],
  ["thead", element("thead")],
  ["tbody", element("tbody")],
  ["tr", element("tr", "border-b border-[#30363d] last:border-b-0")],
  ["th", cell("th")],
  ["td", cell("td")],
]);
