/// <reference types="node" />
// What a Button of a surface may cause (#726), with only Tauri's `invoke` and the clipboard faked: what is
// said before the click, and what the click does.
import "../../test-support/dom.ts";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement, Fragment } from "react";
import type { TerminalInfo } from "../terminal/types.ts";
import { acceptedRaw, create, errorsIn, text, told, type Component } from "./fixtures/rawFixtures.ts";
import { called, calls, settle, until } from "./fixtures/fakeRust.ts";
import { mount } from "./fixtures/surfaceFixtures.ts";
import { buttonOf, click, describedBy, drawTree, leavePage, put, startPage, TERMINAL } from "./fixtures/catalogFixtures.ts";

const { SurfaceView } = await import("./SurfaceView.tsx");
const { useTerminalSelectionRequests } = await import("../terminal/useTerminalSelectionRequests.ts");

let copied: string[];
let copy: (text: string) => Promise<void>;

beforeEach(async () => {
  copied = [];
  copy = async (words) => void copied.push(words);
  Object.defineProperty(navigator, "clipboard", { value: { writeText: (words: string) => copy(words) }, configurable: true });
  await startPage();
});
afterEach(leavePage);

const OPEN_URL = "plugin:opener|open_url";
const at = (path: string) => ({ "@path": path });
const call = (name: string, args: Record<string, unknown>) => ({ "@call": name, args });
/** A Button that reads `id`, and calls `name`. */
const calling = (id: string, name: string, args: Record<string, unknown>, more: Component = {}): Component[] => [
  { id, component: "Button", child: `${id}_label`, action: { functionCall: call(name, args) }, ...more },
  text(`${id}_label`, id),
];
const opened = () => called(OPEN_URL).map(({ url }) => url);
const foot = () => document.querySelector("[data-surface-foot]")?.textContent;
const notice = () => document.querySelector('[role="alert"]')?.textContent ?? null;
const point = (element: Element, type: "mouseover" | "mouseout") => act(async () => void element.dispatchEvent(new MouseEvent(type, { bubbles: true, relatedTarget: document.body })));

/** Runs `run` with what the engine says of calls it refuses kept off the console. */
async function quietly(run: () => Promise<void>): Promise<void> {
  const { error, warn } = console;
  console.error = console.warn = () => {};
  try {
    await run();
  } finally {
    Object.assign(console, { error, warn });
  }
}

test("a Button that opens a link shows its full address at the frame's foot while the pointer or the focus is on it", async () => {
  const content = await drawTree(["a", "b"], [...calling("a", "openUrl", { url: "https://google.com@EVIL.example/a?b=c#d" }), ...calling("b", "openUrl", { url: at("/url") })], { url: "http://b.example:8080/x" });
  const [a, b] = [buttonOf(content, "a"), buttonOf(content, "b")];
  assert.equal(foot(), "");
  await point(a, "mouseover");
  assert.equal(foot(), "https://google.com@evil.example/a?b=c#d");
  await point(a, "mouseout");
  assert.equal(foot(), "");
  await act(async () => b.focus());
  assert.equal(foot(), "http://b.example:8080/x");
  assert.deepEqual(describedBy(b), ["http://b.example:8080/x"], "the foot describes it");
  await act(async () => b.blur());
  assert.equal(foot(), "");
  assert.deepEqual(calls, [], "nothing has been opened or asked for");
  await click(a);
  assert.deepEqual(opened(), ["https://google.com@evil.example/a?b=c#d"]);
});

test("the foot follows the address as it changes, and the click opens what it says", async () => {
  const content = await drawTree(["field", "a"], [{ id: "field", component: "TextField", label: "Address", value: at("/url") }, ...calling("a", "openUrl", { url: at("/url") })], { url: "https://a.example/" });
  const a = buttonOf(content, "a");
  await point(a, "mouseover");
  assert.equal(foot(), "https://a.example/");
  await put(content.querySelector("input")!, "https://b.example/");
  assert.equal(foot(), "https://b.example/");
  await click(a);
  assert.deepEqual(opened(), ["https://b.example/"]);
});

test("a Button whose address is no web address has none at the foot, opens nothing and says so", async () => {
  const content = await drawTree(["a"], calling("a", "openUrl", { url: "javascript:alert(1)" }));
  assert.equal(foot(), undefined);
  await click(buttonOf(content, "a"));
  await settle();
  assert.deepEqual([opened(), notice()], [[], "Not opened: the link is not to a web address."]);
});

test("an effect written inside another's argument never runs, so the click opens the address that was shown", async () => {
  await quietly(async () => {
    const evil = "${openUrl(url: 'https://evil.example/')}";
    const copies = "${copyText(text: 'evil')}";
    const content = await drawTree(
      ["a", "b", "c", "d", "said"],
      [
        ...calling("a", "openUrl", { url: call("formatString", { value: `${evil}https://good.example/` }) }),
        ...calling("b", "copyText", { text: call("formatString", { value: `${copies}good` }) }),
        ...calling("c", "copyText", { text: call("formatString", { value: `${evil}good` }) }),
        { id: "d", component: "Button", child: "d_label", action: { event: { name: "go", context: { x: call("formatString", { value: evil + copies }) } } } },
        text("d_label", "d"),
        text("said", call("formatString", { value: evil + copies })),
      ],
    );
    await settle();
    assert.deepEqual([opened(), copied], [[], []], "drawing causes nothing");
    const a = buttonOf(content, "a");
    await point(a, "mouseover");
    assert.equal(foot(), "https://good.example/");
    for (const name of ["a", "b", "c", "d"]) await click(buttonOf(content, name));
    await settle();
    assert.deepEqual([opened(), copied], [["https://good.example/"], ["good", "good"]]);
  });
});

test("copyText puts its text on the clipboard on the click, and only then", async () => {
  const content = await drawTree(["a", "b"], [...calling("a", "copyText", { text: at("/text") }), ...calling("b", "copyText", { text: at("/none") })], { text: "git rebase\n--continue" });
  assert.deepEqual(copied, []);
  await click(buttonOf(content, "a"));
  assert.deepEqual([copied, notice()], [["git rebase\n--continue"], null]);
  await click(buttonOf(content, "b"));
  await settle();
  assert.deepEqual([copied.length, notice()], [1, "Not copied: there is no text to copy."]);
});

test("a clipboard that cannot be written says so", async () => {
  copy = () => Promise.reject(new Error("denied"));
  const content = await drawTree(["a"], calling("a", "copyText", { text: "x" }));
  await click(buttonOf(content, "a"));
  await settle();
  assert.equal(notice(), "Not copied: the clipboard could not be written (Error: denied).");
});

test("one click allows one effect, and its own only", async () => {
  const { duringClick } = await import("./clickOnly.ts");
  const { surfaceEffects } = await import("./surfaceEffects.ts");
  const effects = surfaceEffects("t1", () => {});
  const refused = /runs only on the operator's click/;
  assert.throws(() => effects.copyText("x"), refused);
  assert.throws(() => effects.focusTerminal("x"), refused);
  duringClick("openUrl", () => assert.throws(() => effects.copyText("x"), refused));
  duringClick("copyText", () => {
    effects.copyText("once");
    assert.throws(() => effects.copyText("twice"), refused);
  });
  await duringClick("focusTerminal", async () => {
    await null;
    assert.throws(() => effects.focusTerminal("x"), refused);
  });
  assert.deepEqual(copied, ["once"]);
});

test("a Button whose checks fail causes nothing", async () => {
  const content = await drawTree(["a"], calling("a", "copyText", { text: "x" }, { "@checks": [{ condition: at("/ready"), message: "no" }] }));
  const a = buttonOf(content, "a");
  assert.equal(a.disabled, true);
  a.disabled = false;
  await click(a);
  assert.deepEqual(copied, []);
});

test("a Button that causes something stays in the operator's hands: it keeps the focus, and works again", async () => {
  const content = await drawTree(["a"], calling("a", "copyText", { text: "x" }));
  const a = buttonOf(content, "a");
  await act(async () => a.focus());
  await click(a);
  await click(a);
  assert.deepEqual([copied, a.disabled, document.activeElement === a], [["x", "x"], false, true]);
});

test("a borderless Button has no border and no ground", async () => {
  const content = await drawTree(["a"], calling("a", "copyText", { text: "x" }, { variant: "borderless" }));
  const look = buttonOf(content, "a").className.split(" ");
  assert.deepEqual(look.filter((name) => /^(border|bg-)/.test(name)), []);
});

test("focusTerminal and copyText are rejected anywhere but as a Button's action", async () => {
  for (const said of [call("focusTerminal", { terminal: "x" }), call("copyText", { text: "x" })]) {
    const [[code, path, message]] = told(await errorsIn([create([{ ...text("root", said) }])]));
    assert.deepEqual([code, path, message], ["VALIDATION_FAILED", "/messages/0/createSurface/components/0/text", `${said["@call"]} runs only as a Button's action.`]);
  }
});

const terminal = (id: string, name: string, project = TERMINAL.project_path): TerminalInfo => ({ ...TERMINAL, id, name, project_path: project });
const TERMINALS = [
  TERMINAL,
  terminal("t2", "server", "e:\\alpha\\"),
  terminal("t3", "twin"),
  terminal("t4", "twin"),
  terminal("t5", "other", "E:/beta"),
  terminal("t6", "server", "E:/beta"),
  terminal("t7", "t2"),
];

let shown: string[];
/** The window's part in it: what selects a terminal. */
const Window = ({ terminals }: { terminals: readonly TerminalInfo[] }) => {
  useTerminalSelectionRequests(terminals, (id) => void shown.push(id));
  return null;
};

/** Draws Buttons that focus each of `targets`, in a window of `terminals`, or of none when that is null. */
async function drawFocusing(targets: readonly string[], terminals: readonly TerminalInfo[] | null): Promise<HTMLElement> {
  shown = [];
  const components = targets.flatMap((target, i) => calling(`b${i}`, "focusTerminal", { terminal: target }));
  const record = await acceptedRaw([create([{ id: "root", component: "Column", children: targets.map((_, i) => `b${i}`) }, ...components])]);
  const view = createElement(SurfaceView, { terminal: TERMINAL, surfaces: [record] });
  const container = await mount(createElement(Fragment, null, terminals && createElement(Window, { terminals }), view));
  await until(() => container.querySelector("a2ui-react-column") !== null, "the surface was never drawn");
  return container;
}

test("focusTerminal selects a terminal of the surface's own project, by its id or its exact name, on the click", async () => {
  const container = await drawFocusing(["t3", "server", "fix-75", "t2"], TERMINALS);
  assert.deepEqual(shown, []);
  for (const name of ["b0", "b1", "b2", "b3"]) await click(buttonOf(container, name));
  assert.deepEqual([shown, notice()], [["t3", "t2", "t1", "t2"], null], "an id comes before a name");
});

test("focusTerminal reaches no terminal of another project, and refuses a name that two have", async () => {
  const cases: [string, string][] = [
    ["t5", 'Not shown: this project has no terminal "t5".'],
    ["other", 'Not shown: this project has no terminal "other".'],
    ["Server", 'Not shown: this project has no terminal "Server".'],
    ["serv", 'Not shown: this project has no terminal "serv".'],
    ["twin", 'Not shown: 2 terminals of this project are named "twin".'],
    ["a\u202eb", 'Not shown: this project has no terminal "a b".'],
    ["", "Not shown: no terminal is named."],
  ];
  const container = await drawFocusing(cases.map(([target]) => target), TERMINALS);
  for (const [i, [, said]] of cases.entries()) {
    await click(buttonOf(container, `b${i}`));
    await settle();
    assert.equal(notice(), said);
  }
  assert.deepEqual(shown, []);
});

test("focusTerminal says why when its own terminal is gone, or the window is not there to ask", async () => {
  const gone = await drawFocusing(["server"], TERMINALS.slice(1));
  await click(buttonOf(gone, "b0"));
  await settle();
  assert.equal(notice(), "Not shown: Quay no longer has this terminal.");
  await leavePage();
  await startPage();
  const alone = await drawFocusing(["server"], null);
  await click(buttonOf(alone, "b0"));
  await settle();
  assert.deepEqual([notice(), shown], ["Not shown: Quay could not be asked to show a terminal.", []]);
});
