/// <reference types="node" />
// Markdown, web links and file links in a surface (#721), with only Tauri's `invoke` faked: what a
// `Text` and a `FileLink` draw, and what a click on one does.
import { fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { SurfaceComponent, SurfaceRecord } from "./surfaceTypes.ts";
import { terminalInfo } from "../companion/fixtures/companionFixtures.ts";
import { called, calls, loadSurfaces, settle, startRust, unloadSurfaces } from "./fixtures/fakeRust.ts";

const { SurfaceView } = await import("./SurfaceView.tsx");

let mounted: { root: Root; container: HTMLElement } | null = null;

beforeEach(async () => {
  startRust({ surface_list: () => [], surface_checks: () => [] });
  loadSurfaces();
  await settle();
  // What loading the page called
  calls.length = 0;
});
/** What was called but to record that a function fired, which `fired.test.ts` covers. */
const caused = () => calls.filter(({ cmd }) => cmd !== "surface_function_fired");

/** Takes what is drawn off the page. */
async function undraw(): Promise<void> {
  if (!mounted) return;
  const { root, container } = mounted;
  await act(async () => root.unmount());
  container.remove();
  mounted = null;
}
afterEach(async () => {
  await undraw();
  unloadSurfaces();
});

/** A surface of `components` under a root Column, with `data` as its data model. */
function surfaceOf(components: SurfaceComponent[], data: Record<string, unknown> = {}): SurfaceRecord {
  const inside = new Set(components.flatMap(({ child, children }) => [child, children].flat()));
  const children = components.map(({ id }) => id).filter((id) => !inside.has(id));
  return {
    terminal_id: "t1",
    id: "plan",
    tool: "quay_surface",
    title: "",
    place: "companion",
    as_tab: false,
    state: {
      version: "1.0",
      createSurface: {
        surfaceId: "plan",
        catalogId: "urn:quay:a2ui:catalog:v1",
        components: [{ id: "root", component: "Column", children }, ...components],
        dataModel: data,
      },
    },
    revision: 1,
    order: 1,
    change: 1,
    locked_order: 1,
    asks: false,
    shown_at: 0,
    answer: null,
    answered_at: null,
    ended_at: null,
    withdrawn_at: null,
    began: 1,
    updated_at: 0,
    carried: { from: 1, set: {} },
    reopened: null,
    board: null,
  };
}

/** Draws `record` in its frame, as the Surface view does. */
async function draw(record: SurfaceRecord): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted = { root, container };
  const terminal = { ...terminalInfo("t1", "E:/alpha"), name: "fix-75" };
  await act(async () => root.render(createElement(SurfaceView, { terminal, surfaces: [record] })));
  for (let i = 0; i < 100 && container.textContent?.includes("Loading"); i += 1) await settle();
  return container;
}

/** Draws one `Text` of `text`, and gives the box the agent's content is in. */
async function drawText(text: string): Promise<HTMLElement> {
  const container = await draw(surfaceOf([{ id: "text", component: "Text", text }]));
  const content = container.querySelector<HTMLElement>("[data-surface-content]");
  assert.ok(content, "the surface was never drawn");
  return content;
}

const texts = (within: HTMLElement, selector: string) => [...within.querySelectorAll(selector)].map((el) => el.textContent);

test("headings, emphasis, lists, quotes and code are drawn", async () => {
  const content = await drawText(
    "# Plan\n\n## Steps\n\nSome *new*, **bold** and `inline` text,\nsoftly broken.\n\n- one\n- two\n  1. nested\n\n> quoted\n\n```ts\nconst a = 1;\n```\n\n4. four\n5. five",
  );

  assert.deepEqual(texts(content, "h3, h4"), ["Plan", "Steps"]);
  assert.deepEqual(texts(content, "em"), ["new"]);
  assert.deepEqual(texts(content, "strong"), ["bold"]);
  assert.deepEqual(texts(content, "p > code"), ["inline"]);
  assert.deepEqual(texts(content, "ul > li > ol > li"), ["nested"]);
  assert.deepEqual(texts(content, "blockquote"), ["quoted"]);
  assert.deepEqual(texts(content, "pre > code"), ["const a = 1;\n"]);
  assert.equal(content.querySelectorAll("ol")[1].getAttribute("start"), "4");
  assert.ok(content.textContent?.includes("text, softly broken."), "a line break in a paragraph is a space");
});

test("a table scrolls in its own box, and takes no more room than the surface has", async () => {
  const content = await drawText("| Step | Time | Note |\n| :--- | ---: | --- |\n| a | 1 |\n| b | 2 | c |");
  const table = content.querySelector("table")!;

  assert.deepEqual(texts(table, "th"), ["Step", "Time", "Note"]);
  assert.deepEqual(
    [...table.querySelectorAll("tbody tr")].map((row) => texts(row as HTMLElement, "td")),
    [
      ["a", "1"],
      ["b", "2", "c"],
    ],
    "the cells a row leaves out are not drawn",
  );
  assert.ok(table.querySelectorAll("th")[1].className.includes("text-right"));
  const box = table.parentElement!;
  for (const name of ["overflow-x-auto", "max-w-full"]) assert.ok(box.className.split(" ").includes(name), name);
  assert.ok(table.className.split(" ").includes("w-max"), "it is not squeezed into the surface");
  assert.equal(table.querySelector("[style]"), null);
});

test("a diff block has its added and removed lines tinted, with their signs", async () => {
  const content = await drawText("```diff\n@@ -1 +1 @@\n-old line\n+new line\n same\n```");
  const lines = [...content.querySelectorAll<HTMLElement>("pre code > span")];

  assert.deepEqual(
    lines.map((line) => line.textContent),
    ["@@ -1 +1 @@\n", "-old line\n", "+new line\n", " same\n"],
  );
  const tint = (line: HTMLElement) => /bg-\[(#\w+)\]/.exec(line.className)?.[1];
  assert.equal(tint(lines[1]), "#da3633");
  assert.equal(tint(lines[2]), "#238636");
  assert.deepEqual([tint(lines[0]), tint(lines[3])], [undefined, undefined]);
});

test("plain text a typed tool puts in a Text is shown as it is written", async () => {
  const { plainText } = await import("./typed/plainText.ts");
  for (const text of [
    "Use `foo_bar` or **baz**, [this](https://a.example) or <b>that</b>?",
    "# not a heading",
    "- not a list",
    "1. not a list either",
    "    not code\n\tnor this",
    "a\nb\n\n\nc  \nd",
    "    ",
    "===\n---\n| a | b |\n| - | - |\n> q",
    "back\\slash \\* &amp; &#42; ${openUrl('x')}",
    "```\nfence",
    "[x]: https://a.example",
    "~~no~~ ***no*** _no_",
  ]) {
    const content = await drawText(plainText(text));
    assert.equal(content.textContent, text);
    assert.equal(content.querySelectorAll("p").length, 1, text);
    assert.equal(content.querySelectorAll("h3, ul, ol, pre, code, strong, em, table, blockquote, hr, br, button").length, 0, text);
    await undraw();
  }
});

test("a question is plain text, whatever it holds", async () => {
  const { expand } = await import("./typed/ask.ts");
  const question = "Use **bold** or [this](https://a.example)?";
  const { createSurface } = expand({ questions: [{ question, options: [{ label: "Yes", recommended: false }], multiple: false }] }, "ask_1");
  const part = createSurface.components.find(({ id }) => id === "q0_question")!;
  const content = await drawText(String(part.text));

  assert.equal(content.textContent, question);
  assert.equal(content.querySelectorAll("strong, button").length, 0);
});

const links = (within: HTMLElement) => [...within.querySelectorAll<HTMLElement>('[role="link"]')];
const foot = () => mounted!.container.querySelector<HTMLElement>("[data-surface-foot]")!;
const OPEN_URL = "plugin:opener|open_url";
const point = (el: HTMLElement, type: "mouseover" | "mouseout") =>
  act(async () => void el.dispatchEvent(new MouseEvent(type, { bubbles: true, relatedTarget: document.body })));

test("a web link shows its real host beside it and its full address at the frame's foot, and opens on a click", async () => {
  const content = await drawText("See [google.com](https://google.com@evil.example/a?b=c#d), [plain](http://b.example:8080/x) and <https://c.example/>.");
  const [first, second, third] = links(content);

  assert.deepEqual(links(content).map((link) => link.textContent), ["google.com evil.example", "plain b.example:8080", "https://c.example/ c.example"]);
  assert.equal(content.querySelectorAll("a, [href]").length, 0, "nothing the webview could follow by itself");
  assert.ok(links(content).every((link) => link.tagName === "BUTTON"), "reached and pressed by the keyboard");
  assert.equal(foot().textContent, "");

  await point(first, "mouseover");
  assert.equal(foot().textContent, "https://google.com@evil.example/a?b=c#d");
  await act(async () => second.focus());
  assert.equal(foot().textContent, "https://google.com@evil.example/a?b=c#d", "the pointer's link, while it is on one");
  await point(first, "mouseout");
  assert.equal(foot().textContent, "http://b.example:8080/x");
  assert.equal(second.getAttribute("aria-describedby"), foot().id);
  await act(async () => second.blur());
  assert.equal(foot().textContent, "");
  assert.deepEqual(calls, [], "nothing has been opened or asked for");

  await act(async () => first.click());
  await act(async () => third.click());
  assert.deepEqual(called(OPEN_URL).map(({ url }) => url), ["https://google.com@evil.example/a?b=c#d", "https://c.example/"]);
  assert.equal(caused().length, 2);
});

test("the address shown is the one opened, in the letters the network uses", async () => {
  const content = await drawText("[a](https://еxample.com/a%20b) [b](HTTPS://EXAMPLE.com\\\\@c.example) [c](<https://d.example/\u202egnp.exe>)");

  assert.deepEqual(links(content).map((link) => link.textContent), ["a xn--xample-2of.com", "b example.com", "c d.example"]);
  for (const link of links(content)) {
    await point(link, "mouseover");
    await act(async () => link.click());
    const [{ url }] = called(OPEN_URL).slice(-1);
    assert.equal(foot().textContent, url);
    assert.ok(/^[\x20-\x7e]+$/.test(String(url)), String(url));
    await point(link, "mouseout");
  }
});

const SCRIPT = "javascript:alert(1)";
/** Every spelling of a hostile link's address: none may be drawn as a link. */
const HOSTILE: readonly string[] = [
  ...[SCRIPT, "JaVaScRiPt:alert(1)", "javascript://a.example/%0aalert(1)", "vbscript:msgbox(1)", "livescript:x", "mocha:x"],
  ...["data:text/html,<script>alert(1)</script>", "data:text/html;base64,PHNjcmlwdD4=", "DATA:image/svg+xml,<svg/onload=alert(1)>"],
  ...["blob:http://a.example/1", "about:blank", "view-source:https://a.example", "ftp://a.example/x", "ws://a.example", "mailto:a@a.example", "tel:123"],
  ...["tauri://localhost/x", "asset://localhost/x", "ipc://localhost/x", "chrome:settings", "edge:x", "ms-msdt:/id x", "search-ms:query=x", "ms-settings:x"],
  ...["shell:startup", "vscode://file/c:/x", "smb://host/share", "http:a.example", "https:a.example", "https:/a.example", "http:\\\\a.example", "https://", "https://%00"],
  // Character references
  ...["&#106;avascript:alert(1)", "&#x6A;avascript:alert(1)", "&#0000106;avascript:alert(1)", "javascript&colon;alert(1)", "javascript&#58;alert(1)"],
  ...["javascript&#x3A;alert(1)", "java&Tab;script:alert(1)", "java&NewLine;script:alert(1)", "java&#9;script:alert(1)", "java&#13;script:alert(1)"],
  ...["&#1;javascript:alert(1)", "&#32;javascript:alert(1)", "javascript&amp;colon;alert(1):"],
  // Percent escapes, once and more
  ...["javascript%3Aalert(1)", "%6Aavascript:alert(1)", "%6aavascript%3aalert(1)", "javascript%253Aalert(1)", "java%09script%3Aalert(1)"],
  ...["java%0ascript:alert(1)", "%01javascript%3Aalert(1)", "%20javascript%3Aalert(1)", "javascript%25253Aalert(1)", "data%3Atext/html,x", "https%3A//a.example"],
  // Backslash escapes
  ...["javascript\\:alert(1)", "javascript\\:alert\\(1\\)"],
  // Characters written as they are
  ...["java\tscript:alert(1)", "java\nscript:alert(1)", "java\rscript:alert(1)", "java\u0000script:alert(1)", "\u0001javascript:alert(1)"],
  ...["\u00a0javascript:alert(1)", "\ufeffjavascript:alert(1)", "java\u200bscript:alert(1)", "java\u00adscript:alert(1)", "java\u2028script:alert(1)"],
  ...["javascript\u200b:alert(1)", "javascript :alert(1)", "javascript\uff1aalert(1)", "\u202ejavascript:alert(1)", "java\u0085script:alert(1)"],
  ...["ｊａｖａｓｃｒｉｐｔ：alert(1)", "javascript\ufe55alert(1)", "javascript\ufe13alert(1)"],
];

test("a hostile link is text, however its address is spelled and whatever form the link takes", async () => {
  const forms: ((address: string) => string)[] = [
    (a) => `[label](${a})`,
    (a) => `[label](<${a}>)`,
    (a) => `[label]( ${a} "title")`,
    (a) => `<${a}>`,
    (a) => `[label][ref]\n\n[ref]: ${a}`,
    (a) => `[label][ref]\n\n[ref]: <${a}>`,
    (a) => `![label](${a})`,
    (a) => `[![label](${a})](${a})`,
    (a) => a,
  ];
  const drawn: string[] = [];
  for (const address of HOSTILE) {
    for (const form of forms) {
      const content = await drawText(`before ${form(address)} after`);
      // Emphasis, code and the box of an image that is not shown are all that a spelling may come to:
      // nothing that acts, loads or is named.
      // The room around such a box is a span that holds the box alone
      const roomAround = (el: Element) =>
        el.tagName === "SPAN" && el.getAttributeNames().join() === "class" && el.children.length === 1 && el.children[0].matches("[data-image-refused]");
      const elements = [...content.querySelectorAll("*")].filter((el) => !el.closest("[data-image-refused]") && !roomAround(el));
      // Quay's own icon in such a box is one hidden svg in it, which nothing the agent wrote is drawn into
      const icon = (el: Element) => el.closest("[data-image-refused] > svg[aria-hidden='true']") !== null;
      const boxed = [...content.querySelectorAll("[data-image-refused], [data-image-refused] *")].filter((el) => !icon(el));
      const icons = [...content.querySelectorAll("[data-image-refused]")].map((box) => box.querySelectorAll("svg").length);
      if (icons.some((count) => count !== 1) || [...content.querySelectorAll("[data-image-refused] svg")].some((svg) => svg.textContent !== "")) drawn.push(form(address));
      if (boxed.some((el) => !/^(span|bdi)$/i.test(el.tagName) || el.getAttributeNames().some((name) => !["class", "dir", "data-image-refused"].includes(name)))) drawn.push(form(address));
      const bad = elements.filter((el) => !/^(a2ui-react-.*|div|p|em|strong|code|s|br|h3)$/i.test(el.tagName) || el.getAttributeNames().some((name) => name !== "class"));
      if (bad.length > 0 || content.querySelector("[role]")) drawn.push(form(address));
      await undraw();
    }
  }
  // A line break ends a reference, so these two lead to a local file named `java`, and the rest is text.
  assert.deepEqual(drawn, ["[label][ref]\n\n[ref]: java\nscript:alert(1)", "[label][ref]\n\n[ref]: java\rscript:alert(1)"]);
  assert.deepEqual(calls, []);
});

test("raw HTML is shown as text", async () => {
  for (const html of [
    "<script>alert(1)</script>",
    '<img src="https://a.example/x.png" onerror="alert(1)">',
    "<IMG SRC=x OnErRoR=alert(1)>",
    '<a href="javascript:alert(1)" onclick="alert(1)">x</a>',
    '<div style="position:fixed" onmouseover="alert(1)">x</div>',
    '<iframe src="https://a.example"></iframe>',
    "<svg/onload=alert(1)>",
    "<style>@import 'https://a.example';</style>",
    "<base href='https://a.example'><form action=https://a.example><button>x</button></form>",
    "<!-- <b>hidden</b> -->",
    "<![CDATA[x]]>",
    "<?php x ?>",
    "&lt;script&gt;alert(1)&lt;/script&gt;",
  ]) {
    for (const text of [html, `para ${html} graph`, `- ${html}`, `# ${html}`, `| ${html} |\n| --- |\n| ${html} |`, `*${html}*`, `> ${html}`]) {
      const content = await drawText(text);
      const bad = [...content.querySelectorAll("*")].filter(
        (el) => !/^(a2ui-react-.*|div|p|em|ul|li|h3|table|thead|tbody|tr|th|td|blockquote)$/i.test(el.tagName) || el.getAttributeNames().some((name) => name !== "class"),
      );
      assert.equal(bad.length, 0, `${text}: ${bad.map((el) => el.tagName).join()}`);
      assert.ok(content.textContent?.includes(html.replace("&lt;", "<").slice(0, 6).split("&")[0]), text);
      await undraw();
    }
  }
  assert.deepEqual(calls, []);
});

const SHOW_FILE = "surface_show_file";
const notice = () => mounted!.container.querySelector('[role="alert"]')?.textContent ?? null;

test("a Markdown link to a local path shows the file on a click, in the surface's own terminal", async () => {
  fakeInvoke(async (cmd, args) => {
    calls.push({ cmd, args });
    return { kind: "revealed" };
  });
  const content = await drawText(
    "[a](src/a.ts:12) [b](README.md:3) [c](<C:/Program Files/x y.txt>) [d](docs/a%20b.md) [e](../up.txt) [f](//host/share/x) [g](file://host/x) [h](<\\\\\\\\host\\\\x>)",
  );
  const paths = ["src/a.ts:12", "README.md:3", "C:/Program Files/x y.txt", "docs/a b.md", "../up.txt", "//host/share/x", "file://host/x", "\\\\host\\x"];

  assert.deepEqual(links(content).map((link) => link.textContent), ["a", "b", "c", "d", "e", "f", "g", "h"]);
  assert.deepEqual(calls, [], "a path is judged at the click");
  for (const [i, link] of links(content).entries()) {
    await point(link, "mouseover");
    assert.equal(foot().textContent, paths[i]);
    await act(async () => link.click());
    await point(link, "mouseout");
  }
  assert.deepEqual(caused().map(({ cmd, args }) => [cmd, args]), paths.map((path) => [SHOW_FILE, { terminalId: "t1", path, line: null }]));
  assert.equal(notice(), null);
});

test("a link to a path with characters nobody sees is text", async () => {
  const content = await drawText("[a](docs/a\u202egnp.exe) [b](docs/\u200bx) [c](#part) [d](?x) [e]() [f](a%E2%80%AEb)");
  assert.equal(links(content).length, 0);
});

test("a FileLink shows its file on a click", async () => {
  const container = await draw(
    surfaceOf(
      [
        { id: "a", component: "FileLink", path: "src/a.ts", line: 12, label: "The parser" },
        { id: "b", component: "FileLink", path: { "@path": "/file" } },
        { id: "c", component: "FileLink", path: "src/c.ts", line: 4 },
      ],
      { file: "docs/**b**.md" },
    ),
  );
  assert.deepEqual(links(container).map((link) => link.textContent), ["The parser", "docs/**b**.md", "src/c.ts:4"]);
  await point(links(container)[0], "mouseover");
  assert.equal(foot().textContent, "src/a.ts:12");
  assert.deepEqual(calls, []);

  for (const link of links(container)) await act(async () => link.click());
  assert.deepEqual(called(SHOW_FILE), [
    { terminalId: "t1", path: "src/a.ts", line: 12 },
    { terminalId: "t1", path: "docs/**b**.md", line: null },
    { terminalId: "t1", path: "src/c.ts", line: 4 },
  ]);
});

test("a file with uncommitted changes opens the diff view of its worktree", async () => {
  const { onFileDiffRequest } = await import("../git/fileDiffRequest.ts");
  const asked: unknown[] = [];
  const stop = onFileDiffRequest((request) => (asked.push(request), true));
  fakeInvoke(async () => ({ kind: "diff", worktree: "E:/alpha", path: "src/a.ts", side: "staged", line: 12 }));
  const content = await drawText("[a](src/a.ts:12)");
  await act(async () => links(content)[0].click());
  stop();

  assert.deepEqual(asked, [{ terminalId: "t1", worktree: "E:/alpha", path: "src/a.ts", side: "staged", line: 12 }]);
  assert.equal(notice(), null);
  // Nothing in the window takes the request
  await act(async () => links(content)[0].click());
  assert.equal(notice(), "Not opened: the diff view is not there for src/a.ts. Select its terminal and try again.");
});

test("a path that is not opened says so at the frame's foot, until the next click", async () => {
  fakeInvoke(() => Promise.reject("Not opened: there is no gone.ts."));
  const content = await drawText("[a](gone.ts) [b](https://b.example)");
  await act(async () => links(content)[0].click());
  assert.equal(notice(), "Not opened: there is no gone.ts.");
  assert.ok(!content.contains(mounted!.container.querySelector('[role="alert"]')), "in Quay's part of the frame");

  fakeInvoke(async () => null);
  await act(async () => links(content)[1].click());
  assert.equal(notice(), null);
  fakeInvoke(() => Promise.reject("no browser"));
  await act(async () => links(content)[1].click());
  assert.equal(notice(), "Not opened: the browser could not be started (no browser).");
});

test("a slower answer to an earlier click does not replace what a later one said", async () => {
  const answers: ((why: string) => void)[] = [];
  fakeInvoke((cmd) => (cmd === SHOW_FILE ? new Promise((_, reject) => answers.push(reject)) : Promise.resolve(null)));
  const content = await drawText("[a](a.ts) [b](b.ts)");
  for (const link of links(content)) await act(async () => link.click());
  await act(async () => answers[1]("Not opened: there is no b.ts."));
  await act(async () => answers[0]("Not opened: there is no a.ts."));
  assert.equal(notice(), "Not opened: there is no b.ts.");
});

const button = (within: HTMLElement, name: string) => [...within.querySelectorAll("button")].find((b) => b.textContent === name)!;
/** A Button reading `name` whose action is `action`. */
const buttonOf = (id: string, name: string, action: unknown): SurfaceComponent[] => [
  { id, component: "Button", child: `${id}_label`, action },
  { id: `${id}_label`, component: "Text", text: name },
];
const OPEN = { "@call": "openUrl", args: { url: "https://a.example/x" } };
const SHOW = { "@call": "showFile", args: { path: "src/a.ts", line: 3 } };

test("a Button's own action opens an address or shows a file on the click, and only then", async () => {
  const container = await draw(
    surfaceOf([
      ...buttonOf("a", "Open", { functionCall: OPEN }),
      ...buttonOf("b", "Show", { functionCall: SHOW }),
      ...buttonOf("c", "Bad", { functionCall: { "@call": "openUrl", args: { url: "javascript:alert(1)" } } }),
    ]),
  );
  assert.deepEqual(calls, []);
  await act(async () => button(container, "Open").click());
  await act(async () => button(container, "Show").click());
  assert.deepEqual(called(OPEN_URL).map(({ url }) => url), ["https://a.example/x"]);
  assert.deepEqual(called(SHOW_FILE), [{ terminalId: "t1", path: "src/a.ts", line: 3 }]);
  await act(async () => button(container, "Bad").click());
  assert.equal(caused().length, 2, "an address of another kind opens nothing");
});

test("an effect runs nowhere but in a click on its own control, whatever calls it", async () => {
  const errors: unknown[] = [];
  const { error, warn } = console;
  console.error = console.warn = (...args) => void errors.push(args);
  try {
    const container = await draw(
      surfaceOf(
        [
          { id: "value", component: "Text", text: OPEN },
          { id: "shown", component: "Text", text: SHOW },
          { id: "path", component: "FileLink", path: SHOW, label: OPEN },
          { id: "field", component: "TextField", label: "Note", value: { "@path": "/note" }, "@checks": [{ condition: OPEN, message: "no" }] },
          ...buttonOf("event", "Send", { event: { name: "go", context: { x: OPEN, y: [SHOW] } } }),
          ...buttonOf("nested", "Nested", { functionCall: { "@call": "showFile", args: { path: OPEN } } }),
          ...buttonOf("twice", "Twice", { functionCall: { "@call": "openUrl", args: { url: OPEN } } }),
          { id: "bound", component: "Text", text: { "@call": "openUrl", args: { url: { "@path": "/note" } } } },
        ],
        { note: "https://a.example/y" },
      ),
    );
    await settle();
    assert.deepEqual(calls, [], "drawing causes nothing");

    const field = container.querySelector("input, textarea") as HTMLInputElement;
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")!.set!.call(field, "https://a.example/z");
    await act(async () => void field.dispatchEvent(new Event("input", { bubbles: true })));
    await act(async () => button(container, "Send").click());
    await act(async () => button(container, "Nested").click());
    await settle();
    assert.deepEqual(
      calls.filter(({ cmd }) => cmd === OPEN_URL),
      [],
      "nor does typing, an event's context or another effect's argument",
    );
    await act(async () => button(container, "Twice").click());
    await settle();
    assert.ok(called(OPEN_URL).length <= 1, "one click, one effect");
  } finally {
    Object.assign(console, { error, warn });
  }
});

test("an effect called after its click, or with no click, throws", async () => {
  const { duringClick, spendClick } = await import("./clickOnly.ts");
  const { surfaceEffects } = await import("./surfaceEffects.ts");
  const effects = surfaceEffects({ terminal_id: "t1", id: "ask_1" }, () => {});
  const refused = /runs only on the operator's click/;

  assert.throws(() => effects.openUrl("https://a.example"), refused);
  assert.throws(() => effects.showFile("a.ts"), refused);
  duringClick("openUrl", () => assert.throws(() => effects.showFile("a.ts"), refused));
  await duringClick("openUrl", async () => {
    await null;
    assert.throws(() => effects.openUrl("https://a.example"), refused);
  });
  duringClick("showFile", () => {
    spendClick("showFile");
    assert.throws(() => effects.showFile("a.ts"), refused);
  });
  assert.throws(() => duringClick("openUrl", () => { throw new Error("handler"); }), /handler/);
  assert.throws(() => effects.openUrl("https://a.example"), refused);
  assert.deepEqual(calls, []);
});

test("inside a Button only inline formatting is drawn, and no link", async () => {
  const label = "# **Open** *the* `plan` [here](https://a.example) [file](a.ts)\n\n- one\n\n> two\n\n| a |\n| - |";
  const container = await draw(
    surfaceOf([
      { id: "a", component: "Button", child: "a_label", action: { event: { name: "go" } } },
      { id: "a_label", component: "Text", text: label },
      { id: "b", component: "Button", child: "b_column", action: { event: { name: "go" } } },
      { id: "b_column", component: "Column", children: ["b_label", "b_file"] },
      { id: "b_label", component: "Text", text: "1. Show" },
      { id: "b_file", component: "FileLink", path: "a.ts" },
    ]),
  );
  const [first, second, ...others] = container.querySelectorAll<HTMLElement>("[data-surface-content] button");
  assert.equal(others.length, 0, "no link is in one");
  assert.equal(first.textContent?.replace(/\s+/g, " "), "# Open the plan here file - one > two | a | | - |");
  assert.equal(second.textContent, "1. Showa.ts");
  assert.deepEqual(texts(first, "strong, em, code"), ["Open", "the", "plan"]);
  for (const button of [first, second]) assert.equal(button.querySelectorAll("h3, ol, ul, li, blockquote, table, p, pre, [role]").length, 0);
});

test("a text nested too deep or too long to draw at once is shown whole, as it is written", async () => {
  const deep = `${">".repeat(150)} end`;
  assert.equal((await drawText(deep)).textContent, deep);
  await undraw();
  const long = `**bold** ${"x".repeat(20_000)}`;
  const content = await drawText(long);
  assert.equal(content.textContent, long);
  assert.equal(content.querySelectorAll("strong").length, 0);
  await undraw();
  // The limit counts characters, which some alphabets spell with two units each
  const atLimit = await drawText(`**b**${"😀".repeat(19_995)}`);
  assert.equal(atLimit.querySelectorAll("strong").length, 1);
  await undraw();
  const emphasis = await drawText(`${"*a ".repeat(100)}end${" a*".repeat(100)}`);
  assert.equal(emphasis.textContent, `${"a ".repeat(100)}end${" a".repeat(100)}`);
});
