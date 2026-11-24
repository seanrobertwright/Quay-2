// The one Markdown dialect every `Text` draws: markdown-it's tokens, turned into React elements. No
// HTML string is made or injected, and nothing here loads anything: an image is a file Rust reads.
import { createElement, Fragment, memo, type ReactNode } from "react";
import type { Token } from "markdown-it";
import { blockTokens, inlineTokens } from "./parse.ts";
import { ELEMENTS } from "./elements.tsx";

/** How many elements deep a text is drawn. Emphasis past it is drawn as its text. */
const DEEPEST = 40;

/** Draws tokens, each opening one as an element of `ELEMENTS` around what comes before its close. */
function drawTokens(tokens: readonly Token[]): ReactNode {
  const root: ReactNode[] = [];
  const open: { token: Token; children: ReactNode[] }[] = [];
  const add = (...nodes: ReactNode[]) => {
    const siblings = open[open.length - 1]?.children ?? root;
    for (const node of nodes) siblings.push(node);
  };
  for (const token of tokens) {
    if (token.nesting === 1) {
      open.push({ token, children: [] });
    } else if (token.nesting === -1) {
      const closed = open.pop();
      if (!closed) continue;
      if (open.length < DEEPEST) add(drawElement(closed.token, closed.children));
      else for (const child of closed.children) add(child);
    } else {
      add(drawElement(token, []));
    }
  }
  return createElement(Fragment, null, ...root);
}

function drawElement(token: Token, children: ReactNode[]): ReactNode {
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

/** `text` as Markdown, or as it is written where it is too long or nested too deep to be drawn at once. */
export const Markdown = memo(({ text, inline }: MarkdownProps) => {
  const tokens = inline ? inlineTokens(text) : blockTokens(text);
  return tokens ? drawTokens(tokens) : text;
});
Markdown.displayName = "Markdown";
