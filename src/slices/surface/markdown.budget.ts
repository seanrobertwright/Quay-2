/// <reference types="node" />
// Markdown's worst cases (#721): the largest text a typed tool takes, spelled to nest as deep and to
// make as many elements as it can. Not a `*.test.ts` file, so it runs by itself (`test:budget`) and
// the budget measures Markdown and not the other test files.
import "../../test-support/dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

const { Markdown } = await import("./a2ui/markdown/Markdown.tsx");
const { InsideButton } = await import("./a2ui/insideButton.ts");
const { SurfaceLinksProvider } = await import("./SurfaceLinksProvider.tsx");

/** A review's `body` at its limit. */
const CHARACTERS = 20_000;

/** The budget to parse and draw one text, on the test machine. It leaves out the webview's layout. */
const BUDGET_MS = 2500;

/** How deep an element may be in what one text draws. */
const DEEPEST = 60;

const fill = (unit: string) => unit.repeat(Math.ceil(CHARACTERS / unit.length)).slice(0, CHARACTERS);
const halves = (open: string, close: string) => open.repeat(CHARACTERS / 2 / open.length) + close.repeat(CHARACTERS / 2 / close.length);
const COLUMNS = 2400;

const WORST: Record<string, string> = {
  "nested quotes": fill(">"),
  "nested quotes, spaced": fill("> "),
  "nested lists": Array.from({ length: 190 }, (_, i) => `${" ".repeat(i)}- x`).join("\n"),
  "lists on one line": fill("- "),
  "ordered lists on one line": fill("1. "),
  "quotes and lists": fill("> - "),
  "opening emphasis": fill("*a "),
  "nested emphasis": halves("*a ", " a*"),
  "nested strong": halves("**a ", " a**"),
  "alternating emphasis": halves("*_", "_*"),
  "asterisks": fill("*"),
  "underscores": fill("_a"),
  "strikethroughs": fill("~~a"),
  "open brackets": fill("["),
  "open images": fill("!["),
  "nested brackets": halves("[", "]"),
  "open links": fill("[a]("),
  "open links with angles": fill("[a](<b"),
  "links": fill("[a](b)"),
  "long paths": fill(`[a](${"./".repeat(1000)}:) `),
  "long escapes": fill(`[a](${"%25".repeat(660)}) `),
  "reference uses": `[a]: b\n\n${fill("[a]").slice(0, CHARACTERS - 10)}`,
  "reference definitions": fill("[a]: b\n"),
  "backticks of every length": Array.from({ length: 198 }, (_, i) => "`".repeat(i + 1)).join(" "),
  "open code": fill("`a"),
  "entities": fill("&#0;"),
  "open entities": fill("&"),
  "autolinks": fill("<a:b>"),
  "open tags": fill("<a "),
  "open comments": fill("<!--"),
  "backslashes": fill("\\"),
  "hard breaks": fill("a\\\n"),
  "list items": fill("- a\n"),
  "loose list items": fill("- a\n\n"),
  "paragraphs": fill("a\n\n"),
  "headings": fill("# a\n"),
  "underlined headings": fill("a\n=\n"),
  "rules": fill("---\n\n"),
  "fences": fill("```\n"),
  "diff lines": `\`\`\`diff\n${fill("+\n")}`,
  "emphasised letters": fill("*a* "),
  "a wide table": `${"|a".repeat(COLUMNS)}\n${"|-".repeat(COLUMNS)}\n${"a\n".repeat((CHARACTERS - 4 * COLUMNS - 2) / 2)}`,
  "a square table": `${"|a".repeat(120)}\n${"|-".repeat(120)}\n${"a\n".repeat(9_700)}`,
  "a tall table": fill("|a|\n|-|\n|a|\n"),
  "one long word": fill("a"),
};

/** `text` as a `Text` draws it, or a `Text` inside a button. */
const draw = (text: string, inline: boolean) => createElement(InsideButton.Provider, { value: inline }, createElement(Markdown, { text, inline }));

/** How many elements deep the deepest one in `root` is, told without recursion. */
function depthOf(root: Element): number {
  let deepest = 0;
  let level: Element[] = [...root.children];
  while (level.length > 0) {
    deepest += 1;
    level = level.flatMap((el) => [...el.children]);
  }
  return deepest;
}

for (const inline of [false, true]) {
  test(`no text of ${CHARACTERS} characters takes ${BUDGET_MS} ms or nests past ${DEEPEST} elements${inline ? ", inside a button" : ""}`, async () => {
    const over: string[] = [];
    let slowest = { name: "", ms: 0 };
    for (const [name, text] of Object.entries(WORST)) {
      const container = document.createElement("div");
      const root = createRoot(container);
      const started = performance.now();
      await act(async () => root.render(createElement(SurfaceLinksProvider, { terminalId: "t1", children: draw(text, inline) })));
      const ms = performance.now() - started;
      if (ms > slowest.ms) slowest = { name, ms };
      const depth = depthOf(container);
      if (ms > BUDGET_MS || depth > DEEPEST) over.push(`${name}: ${ms.toFixed(0)} ms, ${depth} deep`);
      await act(async () => root.unmount());
    }
    console.log(`slowest: ${slowest.name}, ${slowest.ms.toFixed(0)} ms`);
    assert.deepEqual(over, []);
  });
}
