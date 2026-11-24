// The one Markdown dialect every `Text` draws: markdown-it's tokens, turned into React elements. No
// HTML string is made or injected, and nothing here loads anything or reads a file.
import { createElement, Fragment, memo, type ReactNode } from "react";
import type { Token } from "markdown-it";
import { blockTokens, inlineTokens } from "./parse.ts";
import { ELEMENTS } from "./elements.tsx";

/** Draws tokens, each opening one as an element of `ELEMENTS` around what comes before its close. */
function drawTokens(tokens: readonly Token[]): ReactNode {
  const root: ReactNode[] = [];
  const open: { token: Token; children: ReactNode[] }[] = [];
  const add = (node: ReactNode) => void (open[open.length - 1]?.children ?? root).push(node);
  for (const token of tokens) {
    if (token.nesting === 1) {
      open.push({ token, children: [] });
    } else if (token.nesting === -1) {
      const closed = open.pop();
      if (closed) add(drawElement(closed.token, closed.children));
    } else {
      add(drawElement(token, []));
    }
  }
  return createElement(Fragment, null, ...root);
}

function drawElement(token: Token, children: ReactNode[]): ReactNode {
  if (token.type === "inline") return drawTokens(token.children ?? []);
  const element = ELEMENTS.get(token.type.replace(/_open$/, ""));
  // What this dialect does not name is shown as the text it was written with.
  if (!element) return createElement(Fragment, null, token.content, ...children);
  return element(token, children);
}

interface MarkdownProps {
  text: string;
  /** Whether only inline formatting is drawn, as inside a button. */
  inline: boolean;
}

/** `text` as Markdown. */
export const Markdown = memo(({ text, inline }: MarkdownProps) => drawTokens(inline ? inlineTokens(text) : blockTokens(text)));
Markdown.displayName = "Markdown";
