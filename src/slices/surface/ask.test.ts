/// <reference types="node" />
// The whole of quay_ask in the webview (#717), with only Tauri's `invoke` faked: one to four questions
// of each kind, what holds Send, and what the agent gets.
import { emitEvent, fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { epochMsFromLocalParts, parseUtcTimestamp } from "../../lib/dates.ts";
import type { SurfaceRecord, Verdict } from "./surfaceTypes.ts";
import type { Mounted } from "./fixtures/askFixtures.ts";

const { startSurfaces } = await import("./surfaceHost.ts");
const { askCheck, askRecord, findButton: button, mountCompanion, settle, TERMINAL, typeInto, unmount, until, viewEntry } = await import("./fixtures/askFixtures.ts");

let list: SurfaceRecord[];
let verdicts: { call: number; verdict: Verdict }[];
/** What each `surface_answer` sent. */
let sent: unknown[];
let stop: (() => void) | null = null;
let mounted: Mounted | null = null;

beforeEach(() => {
  list = [];
  verdicts = [];
  sent = [];
  fakeInvoke(async (cmd, args) => {
    if (cmd === "surface_verdict") verdicts.push(args as (typeof verdicts)[number]);
    if (cmd === "surface_answer") sent.push(args.answer);
    if (cmd === "surface_open_page") return { page: 1, unsent: [] };
    if (cmd === "surface_list") return list;
    return cmd === "surface_checks" ? [] : null;
  });
});
afterEach(async () => {
  if (mounted) await unmount(mounted);
  mounted = null;
  stop?.();
  stop = null;
});

/** The surface `ask` makes, as Rust holds it once the webview has accepted it. */
async function accepted(ask: unknown): Promise<SurfaceRecord> {
  stop ??= startSurfaces();
  await settle();
  emitEvent("surface-check", askCheck(1, ask));
  await until(() => verdicts.length > 0, "no verdict was given");
  const { verdict } = verdicts[0];
  assert.ok("state" in verdict, JSON.stringify(verdict));
  return askRecord(verdict.state);
}

/** The frame of `record` in the companion's Surface view. */
async function draw(record: SurfaceRecord): Promise<HTMLElement> {
  list = [record];
  stop?.();
  stop = startSurfaces();
  mounted = await mountCompanion(TERMINAL);
  const { container } = mounted;
  await view("Surface");
  await until(() => container.querySelector("[data-surface]") !== null && !container.textContent?.includes("Loading"), "the surface was never drawn");
  return container.querySelector<HTMLElement>("[data-surface]")!;
}

/** Shows the companion view `name`. */
async function view(name: string): Promise<void> {
  await act(async () => viewEntry(mounted!.container, name)?.click());
  await settle();
}

const ask = async (call: unknown) => draw(await accepted(call));

/** What an element says, by words: each text in it, apart. */
function words(element: Element): string {
  const texts: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === 3) texts.push(node.textContent ?? "");
    else node.childNodes.forEach(walk);
  };
  walk(element);
  return texts.join(" ").replace(/\s+/g, " ").trim();
}

/** The rows of a listed ask: the button that opens each question. */
const rows = (region: HTMLElement) => [...region.querySelectorAll<HTMLButtonElement>("button[aria-expanded]")].filter((row) => row.closest("li"));
const openRows = (region: HTMLElement) => rows(region).map((row) => row.getAttribute("aria-expanded") === "true");
const click = (element: HTMLElement | undefined) => act(async () => element!.click());
/** The options drawn, each with its kind. */
const options = (region: HTMLElement) => [...region.querySelectorAll<HTMLInputElement>('input[type="radio"], input[type="checkbox"]')];
const option = (region: HTMLElement, label: string) => options(region).find((input) => input.labels?.[0]?.textContent === label);
const boxes = (region: HTMLElement) => [...region.querySelectorAll("textarea")];
/** The line at the foot that counts what is answered. */
const counted = (region: HTMLElement) => /\d of \d answered/.exec(region.textContent ?? "")?.[0];

/** Types `text` into the one text box drawn. */
const type = (region: HTMLElement, text: string) => typeInto(boxes(region)[0], text);

const BASE = {
  question: "Which base should this branch take?",
  options: [{ label: "Rebase onto master", recommended: true }, { label: "Merge master in", recommended: false }],
  multiple: false,
};
const SUITES = {
  question: "Which suites should I run?",
  options: [{ label: "Rust", recommended: false }, { label: "Front end", recommended: false }, { label: "Docs", recommended: false }],
  multiple: true,
};
const NAME = { question: "What should the branch be called?", options: [], multiple: false };
const THREE = { questions: [BASE, SUITES, NAME] };

test("several questions are listed with the first one open, each kind with its own inputs and a text box", async () => {
  const region = await ask(THREE);
  assert.deepEqual(rows(region).map(words).map((row) => row.replace(/^\d /, "")), [BASE.question, SUITES.question, NAME.question]);
  assert.deepEqual(openRows(region), [true, false, false]);
  const drawn = () => [options(region).map((input) => [input.type, input.labels?.[0]?.textContent]), boxes(region).map((box) => box.labels?.[0]?.textContent)];
  assert.deepEqual(drawn(), [[["radio", "Rebase onto master"], ["radio", "Merge master in"]], ["Other, or a note"]]);

  await click(rows(region)[1]);
  assert.deepEqual(openRows(region), [false, true, false]);
  assert.deepEqual(drawn(), [[["checkbox", "Rust"], ["checkbox", "Front end"], ["checkbox", "Docs"]], ["Other, or a note"]]);

  await click(rows(region)[2]);
  assert.deepEqual(openRows(region), [false, false, true]);
  assert.deepEqual(drawn(), [[], ["Your answer"]]);
});

test("Next opens the question after it, which takes the focus, and the last has none", async () => {
  const region = await ask(THREE);
  await click(button(region, "Next"));
  assert.deepEqual(openRows(region), [false, true, false]);
  assert.ok(document.activeElement === rows(region)[1], "the focus is on the row that opened");
  await click(button(region, "Next"));
  assert.deepEqual(openRows(region), [false, false, true]);
  assert.equal(button(region, "Next"), undefined);
});

test("a closed row shows its answer, and the open one its inputs only", async () => {
  const region = await ask(THREE);
  const shown = () => rows(region).map((row) => words(row).replace(/^\d /, ""));
  await click(option(region, "Rebase onto master"));
  await type(region, " skip the suite ");
  assert.deepEqual(shown(), [BASE.question, SUITES.question, NAME.question]);

  await click(button(region, "Next"));
  assert.deepEqual(shown(), [`${BASE.question} Answered: Rebase onto master · skip the suite`, SUITES.question, NAME.question]);
  await click(option(region, "Rust"));
  await click(option(region, "Docs"));
  await click(option(region, "Docs"));
  await click(button(region, "Next"));
  assert.equal(shown()[1], `${SUITES.question} Answered: Rust`);
  assert.equal(shown()[2], NAME.question, "with no answer yet, a row says no more than its question");

  await click(rows(region)[0]);
  assert.ok(option(region, "Rebase onto master")!.checked, "what was picked is kept");
  assert.equal(boxes(region)[0].value, " skip the suite ");
});

test("Send needs every question opened and answered, and a multiple choice is answered with nothing ticked", async () => {
  const region = await ask(THREE);
  const state = () => [counted(region), !button(region, "Send")!.disabled];
  assert.deepEqual(state(), ["0 of 3 answered", false]);
  await click(option(region, "Merge master in"));
  assert.deepEqual(state(), ["1 of 3 answered", false]);
  await click(rows(region)[2]);
  await type(region, "fix/717");
  assert.deepEqual(state(), ["2 of 3 answered", false], "the multiple choice has not been opened");
  await click(button(region, "Send"));
  assert.deepEqual(sent, []);

  await click(rows(region)[1]);
  assert.deepEqual(state(), ["3 of 3 answered", true]);
  await click(rows(region)[2]);
  await type(region, "  ");
  assert.deepEqual(state(), ["2 of 3 answered", false], "a question in words needs some");
  await type(region, "fix/717");
  await click(button(region, "Send"));
  await settle();
  assert.deepEqual(sent, [
    {
      answers: [
        { question: BASE.question, chosen: ["Merge master in"] },
        { question: SUITES.question, chosen: [] },
        { question: NAME.question, chosen: [], text: "fix/717" },
      ],
    },
  ]);
});

test("every option ticked in a multiple choice is sent, with the note", async () => {
  const region = await ask({ questions: [SUITES] });
  assert.equal(rows(region).length, 0, "one question has no list");
  assert.equal(counted(region), undefined);
  assert.ok(!button(region, "Send")!.disabled, "it is open, and nothing need be ticked");
  await click(option(region, "Rust"));
  await click(option(region, "Docs"));
  await type(region, "and lint");
  await click(button(region, "Send"));
  await settle();
  assert.deepEqual(sent, [{ answers: [{ question: SUITES.question, chosen: ["Rust", "Docs"], text: "and lint" }] }]);
});

test("a question in words needs some, and its text box is named by it", async () => {
  const region = await ask({ questions: [NAME] });
  assert.ok(button(region, "Send")!.disabled);
  const group = boxes(region)[0].closest('[role="group"]')!;
  assert.equal(document.getElementById(group.getAttribute("aria-labelledby")!)?.textContent, NAME.question);
  await type(region, "fix/717");
  assert.ok(!button(region, "Send")!.disabled);
});

test("two questions with the same words are two questions", async () => {
  const region = await ask({ questions: [NAME, NAME] });
  assert.deepEqual(openRows(region), [true, false]);
  await type(region, "first");
  await click(button(region, "Next"));
  assert.equal(boxes(region)[0].value, "");
  await type(region, "second");
  await click(button(region, "Send"));
  await settle();
  assert.deepEqual(sent, [{ answers: [{ question: NAME.question, chosen: [], text: "first" }, { question: NAME.question, chosen: [], text: "second" }] }]);
});

test("what was picked, typed and opened is kept while the questions are off screen", async () => {
  const region = await ask(THREE);
  await click(option(region, "Merge master in"));
  await click(rows(region)[1]);
  await click(rows(region)[2]);
  await type(region, "fix/717");
  await view("Repository");
  await view("Surface");
  const again = mounted!.container.querySelector<HTMLElement>("[data-surface]")!;
  assert.deepEqual(openRows(again), [false, false, true]);
  assert.equal(counted(again), "3 of 3 answered");
  assert.ok(!button(again, "Send")!.disabled);
});

test("everything in a list is a native control with no tab order of its own, and the open row says it stays open", async () => {
  const region = await ask(THREE);
  const controls = [...region.querySelectorAll<HTMLElement>("input, textarea, button, [tabindex], a")];
  assert.deepEqual(
    controls.map((control) => `${control.tagName} ${control.tagName === "BUTTON" ? words(control).replace(/^\d /, "") : ""}`.trim()),
    [`BUTTON ${BASE.question}`, "INPUT", "INPUT", "TEXTAREA", "BUTTON Next", `BUTTON ${SUITES.question}`, `BUTTON ${NAME.question}`, "BUTTON Send"],
  );
  assert.ok(controls.every((control) => !control.hasAttribute("tabindex")));
  assert.deepEqual(rows(region).map((row) => row.getAttribute("aria-disabled")), ["true", "false", "false"]);
  await click(rows(region)[0]);
  assert.deepEqual(openRows(region), [true, false, false], "one is always open");
});

/** Draws with a layout in which a box is as many pixels high as `heightOf` says of its text. */
async function withHeights(heightOf: (text: string) => number, run: () => Promise<void>): Promise<void> {
  const proto = HTMLElement.prototype;
  const original = Object.getOwnPropertyDescriptor(proto, "offsetHeight");
  Object.defineProperty(proto, "offsetHeight", { configurable: true, get(this: HTMLElement) { return heightOf(this.textContent ?? ""); } });
  try {
    await run();
  } finally {
    if (original) Object.defineProperty(proto, "offsetHeight", original);
    else delete (proto as { offsetHeight?: number }).offsetHeight;
  }
}

test("long context folds behind Show all", async () => {
  const context = "Two branches moved under this one. ".repeat(17).trim();
  await withHeights((text) => text.length, async () => {
    const region = await ask({ context, questions: [BASE] });
    assert.ok(words(region).includes(`${context} Show all ${BASE.question}`), "it is above the question, whole");
    const all = button(region, "Show all")!;
    const folded = document.getElementById(all.getAttribute("aria-controls")!)!;
    const height = () => folded.style.maxHeight;
    assert.equal(folded.textContent, context);
    assert.deepEqual([all.getAttribute("aria-expanded"), height()], ["false", "88px"]);

    await click(all);
    const less = button(region, "Show less")!;
    assert.deepEqual([less.getAttribute("aria-expanded"), height()], ["true", ""]);
    await click(less);
    assert.deepEqual([button(region, "Show all")?.getAttribute("aria-expanded"), height()], ["false", "88px"]);
  });
});

test("a few lines of context are drawn whole, and no context draws nothing", async () => {
  await withHeights((text) => text.length, async () => {
    const region = await ask({ context: "Two branches moved.", questions: [BASE] });
    assert.ok(words(region).includes(`Two branches moved. ${BASE.question}`));
    assert.equal(button(region, "Show all"), undefined);
  });
});

test("blank context draws nothing", async () => {
  const { state } = await accepted({ context: " \n", questions: [BASE] });
  assert.ok(!state.createSurface.components.some(({ id }) => id === "context"));
});

test("context is shown as it is written", async () => {
  const context = '<img src="https://a.example/x.png" onerror="alert(1)"> **bold** [no](javascript:alert(1))';
  const region = await ask({ context, questions: [BASE] });
  assert.ok(region.textContent?.includes(context));
  assert.equal(region.querySelectorAll("img, a, b, strong, script, [onerror]").length, 0);
});

test("Send and the count stay at the foot of the frame", async () => {
  const region = await ask(THREE);
  const foot = button(region, "Send")!.closest<HTMLElement>("[data-foot]")!;
  assert.equal(words(foot), "Send 0 of 3 answered");
  assert.ok(foot.classList.contains("sticky") && foot.classList.contains("bottom-0"));
  // A box that scrolls, or hides what is past its edge by scrolling, would hold the foot inside itself
  for (let box = foot.parentElement!; box !== region.parentElement; box = box.parentElement!) {
    assert.ok(![...box.classList].some((name) => /^overflow-(x-|y-)?(hidden|auto|scroll)$/.test(name)), box.className);
  }
});

test("once sent, the frame shows each question with its answer, and when it was sent", async () => {
  const asked = await accepted(THREE);
  await draw(asked);
  const answer = {
    answers: [
      { question: BASE.question, chosen: ["Merge master in"], text: "skip the suite" },
      { question: SUITES.question, chosen: [] },
      { question: NAME.question, chosen: [], text: "fix/717" },
    ],
  };
  const at = epochMsFromLocalParts({ year: 2026, month: 11, day: 24, hour: 19, minute: 42 })! + 5_000;
  await act(async () => emitEvent("surface-changed", { ...asked, change: 2, answer, answered_at: at }));
  await settle();
  // The companion went back to its earlier view
  await act(async () => viewEntry(mounted!.container, "Surface")!.click());

  const settled = mounted!.container.querySelector<HTMLElement>("[data-surface]")!;
  assert.deepEqual(
    [...settled.querySelectorAll("dl > div")].map((entry) => [...entry.children].map((line) => line.textContent)),
    [
      [BASE.question, "Merge master in", "skip the suite"],
      [SUITES.question, "None of these"],
      [NAME.question, "fix/717"],
    ],
  );
  assert.equal(settled.querySelector('[role="status"]')?.textContent, "Answered and sent to the agent.");
  const time = settled.querySelector("time")!;
  assert.equal(time.textContent, "19:42:05");
  assert.equal(parseUtcTimestamp(time.dateTime), at);
  assert.equal(settled.querySelectorAll("input, textarea, button").length, 0);
});

test("an ask at every limit is drawn whole", async () => {
  const of = (start: string, length: number) => `${start} ${"wide ".repeat(length)}`.slice(0, length - 1) + "!";
  const question = (i: number) => ({
    question: of(`Question ${i}`, 200),
    options: [1, 2, 3, 4, 5, 6].map((o) => ({ label: of(`Option ${i}.${o}`, 60), description: of(`Description ${i}.${o}`, 120), recommended: o === 6 })),
    multiple: i === 4,
  });
  const questions = [1, 2, 3, 4].map(question);
  const context = of("Context", 600);
  const region = await ask({ context, questions });
  assert.ok(region.textContent?.includes(context));
  assert.deepEqual(rows(region).map((row) => row.textContent?.slice(1)), questions.map((q) => q.question));
  for (const [i, { options: offered }] of questions.entries()) {
    await click(rows(region)[i]);
    assert.deepEqual(options(region).map((input) => input.labels?.[0]?.textContent), offered.map(({ label }) => label));
    for (const { description } of offered) assert.ok(region.textContent?.includes(description));
    await click(options(region)[5]);
  }
  await click(button(region, "Send"));
  await settle();
  assert.deepEqual(sent, [{ answers: questions.map((q) => ({ question: q.question, chosen: [q.options[5].label] })) }]);
});
