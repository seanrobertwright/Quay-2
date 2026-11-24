/// <reference types="node" />
// Locked surfaces (#720), in the companion's Surface view with only Tauri's `invoke` faked: where
// they fold, what a line and an opened one say, and what was typed and not sent.
import { emitEvent } from "../../test-support/dom.ts";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { SurfaceRecord } from "./surfaceTypes.ts";
import type { Mounted } from "./fixtures/askFixtures.ts";
import { acceptedAsk, called, loadSurfaces, settle, startRust, unloadSurfaces, until } from "./fixtures/fakeRust.ts";

const { SurfaceView } = await import("./SurfaceView.tsx");
const { useSurfacesOf } = await import("./surfaceHost.ts");
const { formatClock } = await import("../../lib/dates.ts");
const { companion, earlierButton, findButton, lockedLine, mountCompanion, openLocked, TERMINAL, typeInto, unmount, viewEntry } = await import("./fixtures/askFixtures.ts");

const AT = Date.UTC(2026, 10, 24, 19, 42, 5);

let list: SurfaceRecord[];
/** What Rust holds unsent for a page that loads. */
let held: object[];
let onDismissLocked: () => Promise<void>;
let onAnswer: () => Promise<void>;
let mounted: Mounted | null = null;

beforeEach(() => {
  list = [];
  held = [];
  onDismissLocked = async () => {};
  onAnswer = async () => {};
  startRust({
    surface_answer: () => onAnswer(),
    surface_list: () => list,
    surface_checks: () => [],
    surface_open_page: () => ({ page: 1, unsent: structuredClone(held) }),
    surface_dismiss_locked: () => onDismissLocked(),
  });
});
afterEach(async () => {
  if (mounted) await unmount(mounted);
  mounted = null;
  unloadSurfaces();
});

const question = (text: string, ...labels: string[]) => ({
  question: text,
  options: labels.map((label) => ({ label, description: `About ${label}`, recommended: false })),
  multiple: false,
});

/** The question `ask_<n>`, as Rust holds it. One with a higher `n` came later. */
const asked = (n: number, text = `Question ${n}?`) => acceptedAsk(`ask_${n}`, { questions: [question(text, "Yes", "No")] }, "t1", n);

const ANSWERS = (text: string, chosen: string[], note?: string) => ({ answers: [{ question: text, chosen, ...(note ? { text: note } : {}) }] });

let change = 1_000;
function nextChange(): Pick<SurfaceRecord, "change" | "locked_order"> {
  change += 1;
  return { change, locked_order: change };
}
const settled = (record: SurfaceRecord, answer: object, at = AT): SurfaceRecord => ({ ...record, ...nextChange(), answer, answered_at: at });
const ended = (record: SurfaceRecord, at = AT): SurfaceRecord => ({ ...record, ...nextChange(), ended_at: at });

const container = () => mounted!.container;
const button = (name: string) => findButton(container(), name)!;
const regions = () => [...container().querySelectorAll<HTMLElement>("section[data-surface]")];
const region = (id: string) => regions().find((section) => section.dataset.surface === id)!;
const earlier = () => earlierButton(container());
const lines = () => [...container().querySelectorAll<HTMLElement>("[data-locked]")];
const lineOf = (id: string) => lockedLine(container(), id);
const click = (element: HTMLElement) => act(async () => element.click());
const changes = async (record: SurfaceRecord) => {
  await act(async () => emitEvent("surface-changed", record));
  await settle();
};

async function showView(): Promise<void> {
  await act(async () => viewEntry(container(), "Surface")?.click());
  await settle();
  await until(() => !container().textContent?.includes("Loading"), "a surface was never drawn");
}

/** Loads the page on the Surface view, with `records` in Rust's list. */
async function load(...records: SurfaceRecord[]): Promise<void> {
  if (mounted) await unmount(mounted);
  list = structuredClone(records).reverse();
  loadSurfaces();
  mounted = await mountCompanion(TERMINAL);
  await showView();
}

/** Loads `records` and opens the locked one `id`, under Earlier. */
async function open(id: string, ...records: SurfaceRecord[]): Promise<HTMLElement> {
  await load(...records);
  await openLocked(container(), id);
  return region(id);
}

test("locked ones fold under Earlier, beneath what waits, newest first, each a line with its state and its answer", async () => {
  const [one, two, three] = [await asked(1), await asked(2), await asked(3)];
  const last = settled(one, ANSWERS("Question 1?", ["Yes"], "skip the suite"));
  // The one that was asked first is answered last
  const first = settled(three, ANSWERS("Question 3?", ["No"]));
  const middle = ended(two);
  const waits = await asked(4);
  await load({ ...first, locked_order: 1_001 }, { ...middle, locked_order: 1_002 }, { ...last, locked_order: 1_003 }, waits);

  assert.deepEqual(regions().map((section) => section.dataset.surface), ["ask_4"]);
  assert.equal(earlier()?.textContent, "Earlier (3)");
  assert.equal(earlier()!.getAttribute("aria-expanded"), "false");
  assert.ok(!earlier()!.hasAttribute("aria-controls") && lines().length === 0, "folded until it is opened");
  assert.ok((region("ask_4").compareDocumentPosition(earlier()!) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0, "beneath the question that waits");

  await click(earlier()!);
  assert.equal(earlier()!.getAttribute("aria-expanded"), "true");
  assert.ok(document.getElementById(earlier()!.getAttribute("aria-controls")!)!.contains(lines()[0]));
  assert.deepEqual(
    lines().map((line) => [line.dataset.locked, line.textContent]),
    [
      ["ask_1", `Answered: Question 1? Yes · skip the suite, ${formatClock(AT)}`],
      ["ask_2", `Ended: Question 2?, ${formatClock(AT)}`],
      ["ask_3", `Answered: Question 3? No, ${formatClock(AT)}`],
    ],
  );
  const icons = lines().map((line) => line.querySelector("svg")!.getAttribute("class"));
  assert.ok(icons[0] === icons[2] && icons[0] !== icons[1], "each state has an icon of its own");
  assert.ok(lines().every((line) => line.querySelector("svg")!.getAttribute("aria-hidden") === "true"));
  await click(earlier()!);
  assert.equal(lines().length, 0);
});

/** The band under the header: its words, its time and its icon's class. */
const bandOf = (section: HTMLElement) => {
  const status = section.querySelector('[role="status"]')!;
  return [status.textContent, status.parentElement!.querySelector("time")?.textContent, status.querySelector("svg")?.getAttribute("aria-hidden")];
};

test("a line opens its surface in place, with the reason and the time in a band, and folds it again", async () => {
  const [one, two] = [await asked(1), await asked(2)];
  await load(settled(one, ANSWERS("Question 1?", ["Yes"])), settled(two, ANSWERS("Question 2?", ["No"])));
  await click(earlier()!);
  await click(lineOf("ask_1"));
  assert.equal(lineOf("ask_1").getAttribute("aria-expanded"), "true");
  assert.deepEqual(regions().map((section) => section.dataset.surface), ["ask_1"]);
  assert.deepEqual(bandOf(region("ask_1")), ["Answered and sent to the agent.", formatClock(AT), "true"]);
  assert.ok(region("ask_1").textContent?.includes("Yes"));
  assert.equal(region("ask_1").getAttribute("aria-label"), "Question from fix-75");
  assert.equal(region("ask_1").querySelectorAll("input, textarea").length, 0, "nothing in it can be answered");

  await click(lineOf("ask_2"));
  assert.deepEqual(regions().map((section) => section.dataset.surface), ["ask_2"], "one is open");
  await click(lineOf("ask_2"));
  assert.equal(regions().length, 0);
});

test("the answer stays and what was asked folds", async () => {
  const ask = { context: "The **branch** is behind.", questions: [question("Which base?", "Rebase", "Merge"), question("Squash?", "Yes", "No")] };
  const record = await acceptedAsk("ask_1", ask, "t1", 1);
  const answer = { answers: [{ question: "Which base?", chosen: ["Rebase"] }, { question: "Squash?", chosen: [], text: "only the fixes" }] };
  const section = await open("ask_1", settled(record, answer));
  for (const text of ["Which base?", "Rebase", "Squash?", "only the fixes"]) assert.ok(section.textContent?.includes(text), text);
  const fold = button("What was asked");
  assert.equal(fold.getAttribute("aria-expanded"), "false");
  for (const text of ["The **branch** is behind.", "Merge", "About Rebase"]) assert.ok(!section.textContent?.includes(text), text);

  await click(fold);
  assert.equal(fold.getAttribute("aria-expanded"), "true");
  const shown = document.getElementById(fold.getAttribute("aria-controls")!)!;
  for (const text of ["The **branch** is behind.", "Which base?", "Rebase", "About Rebase", "Merge", "Squash?"]) assert.ok(shown.textContent?.includes(text), text);
  assert.equal(shown.querySelectorAll("input, textarea, button, a, img").length, 0);
  await click(fold);
  assert.ok(!section.textContent?.includes("About Rebase"));
});

/** Has the clipboard take what is written to it, or refuse it. */
function clipboard(takes: boolean): string[] {
  const written: string[] = [];
  const writeText = async (text: string) => {
    if (!takes) throw new Error("no clipboard");
    written.push(text);
  };
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  return written;
}

test("an ended question says that the terminal exited, what it asked, and keeps what was typed, with Copy", async () => {
  const record = await asked(1, "Which base?");
  held = [{ terminal_id: "t1", id: "ask_1", order: 1, revision: 1, values: { "/answers/0/text": "Rebase, but\n  leave the drawer", "/answers/0/chosen": ["Yes"] } }];
  const section = await open("ask_1", ended(record));
  assert.deepEqual(bandOf(section), ["The terminal exited before this was answered.", formatClock(AT), "true"]);
  assert.ok(section.textContent?.includes("Which base?"));
  assert.ok(section.textContent?.includes("You had typed, not sent") && section.textContent.includes("Rebase, but\n  leave the drawer"));
  assert.equal(section.querySelectorAll("input, textarea").length, 0);
  assert.equal(findButton(section, "Send"), undefined);

  const written = clipboard(true);
  assert.deepEqual(written, [], "nothing is copied without a click");
  await click(button("Copy"));
  assert.deepEqual(written, ["Rebase, but\n  leave the drawer"]);
  const says = () => [...section.querySelectorAll('[role="status"]')].map((status) => status.textContent);
  assert.ok(says().includes("Copied"));

  clipboard(false);
  await click(button("Copy"));
  assert.ok(says().includes("Not copied: select the text and press Ctrl+C."));
});

test("what was typed in each of several questions is kept under its own, and copied together", async () => {
  const record = await acceptedAsk("ask_1", { questions: [question("One?", "Yes", "No"), question("Two?", "Yes", "No"), question("Three?", "Yes", "No")] }, "t1", 1);
  held = [{ terminal_id: "t1", id: "ask_1", order: 1, revision: 1, values: { "/answers/0/text": "first", "/answers/1/text": "  ", "/answers/2/text": "third", "/frame/open": 2 } }];
  const section = await open("ask_1", ended(record));
  assert.deepEqual([...section.querySelectorAll("dt")].map((dt) => dt.textContent), ["One?", "Three?"]);
  assert.deepEqual([...section.querySelectorAll("dd")].map((dd) => dd.textContent), ["first", "third"]);
  const written = clipboard(true);
  await click(button("Copy"));
  assert.deepEqual(written, ["first\n\nthird"]);
});

test("an ended question that nothing was typed in has no Copy", async () => {
  const record = await asked(1);
  held = [{ terminal_id: "t1", id: "ask_1", order: 1, revision: 1, values: { "/answers/0/chosen": ["Yes"] } }];
  const section = await open("ask_1", ended(record));
  assert.equal(findButton(section, "Copy"), undefined);
  assert.ok(!section.textContent?.includes("not sent"));
});

test("what was typed up to the exit is kept, also what had not been sent to Rust yet", async () => {
  const record = await asked(1);
  await load(record);
  await typeInto(region("ask_1").querySelector("textarea")!, "half a thought");
  assert.equal(called("surface_save_unsent").length, 0);

  await changes(ended(record));
  await showView();
  assert.equal(findButton(container(), "Send"), undefined, "it cannot be answered");
  assert.deepEqual(
    called("surface_save_unsent").map(({ id, unsent }) => [id, (unsent as { values: object }).values]),
    [["ask_1", { "/answers/0/text": "half a thought" }]],
  );
  await openLocked(container(), "ask_1");
  assert.ok(region("ask_1").textContent?.includes("half a thought"));
  await act(async () => emitEvent("surface-removed", { terminal_id: "t1", id: "ask_1" }));
  assert.equal(earlier(), undefined);
});

test("a surface that asked for nothing ended as its terminal exited, and no text of an agent's is read as anything but text", async () => {
  const hostile = '<img src="https://a.example/x.png" onerror="alert(1)"> [a](javascript:alert(1))';
  const record = await acceptedAsk("ask_1", { context: hostile, questions: [question(hostile, "<b>Yes</b>", "No")] }, "t1", 1);
  const section = await open("ask_1", ended({ ...record, asks: false }));
  assert.equal(bandOf(section)[0], "Stopped: the terminal exited.");
  assert.ok(lineOf("ask_1").textContent?.startsWith("Ended: "));
  await click(button("What was asked"));
  assert.ok(section.textContent?.includes("<b>Yes</b>") && section.textContent.includes(hostile));
  assert.equal(section.querySelectorAll("img, a, b, script, iframe, [onerror]").length, 0);
});

const removed = (...ids: string[]) =>
  act(async () => ids.forEach((id) => emitEvent("surface-removed", { terminal_id: "t1", id })));
const alerts = () => [...container().querySelectorAll('[role="alert"]')].map((alert) => alert.textContent);

test("Dismiss all is there while Earlier is open, and takes the locked ones once", async () => {
  const records = [settled(await asked(1), ANSWERS("Question 1?", ["Yes"])), ended(await asked(2)), await asked(3)];
  await load(...records);
  assert.equal(button("Dismiss all"), undefined);
  await click(earlier()!);
  let taken = () => {};
  onDismissLocked = () => new Promise((resolve) => (taken = resolve));
  const all = button("Dismiss all");
  await act(async () => {
    all.click();
    all.click();
  });
  assert.deepEqual(called("surface_dismiss_locked"), [{ terminalId: "t1", ids: ["ask_2", "ask_1"] }]);
  assert.equal(called("surface_dismiss").length, 0);
  assert.equal(lines().length, 2, "Rust decides that they leave");
  await removed("ask_1", "ask_2");
  await act(async () => taken());
  assert.equal(earlier(), undefined);
  assert.deepEqual(regions().map((section) => section.dataset.surface), ["ask_3"]);
});

test("a Dismiss all that fails says why, and can be tried again", async () => {
  await load(ended(await asked(1)));
  await click(earlier()!);
  onDismissLocked = () => Promise.reject("Not dismissed: Quay is closing.");
  await click(button("Dismiss all"));
  await settle();
  assert.deepEqual(alerts(), ["Not dismissed: Quay is closing."]);
  onDismissLocked = async () => {};
  await click(button("Dismiss all"));
  await settle();
  assert.equal(called("surface_dismiss_locked").length, 2);
  assert.deepEqual(alerts(), []);
});

test("one locked surface is dismissed from its own frame", async () => {
  await open("ask_2", ended(await asked(1)), ended(await asked(2)));
  await click(region("ask_2").querySelector<HTMLButtonElement>('button[aria-label="Dismiss this question"]')!);
  assert.deepEqual(called("surface_dismiss"), [{ terminalId: "t1", id: "ask_2" }]);
  await removed("ask_2");
  assert.equal(earlier()!.textContent, "Earlier (1)");
});

/** What has the focus, in words a failure can print. */
function focused(): string {
  const active = document.activeElement;
  if (!active || active === document.body) return "nothing";
  const section = active.closest<HTMLElement>("[data-surface]");
  if (section === active) return `the frame of ${section.dataset.surface}`;
  return section ? `in ${section.dataset.surface}` : (active.textContent ?? active.tagName);
}

const ANSWER = ANSWERS("Question 1?", ["Yes"]);

test("after a question settles the focus goes to the next one's frame, when it was in the settled one", async () => {
  const [one, two, three] = [await asked(1), await asked(2), await asked(3)];
  await load(one, two, three);
  await act(async () => region("ask_1").querySelector<HTMLInputElement>("input")!.click());
  const send = findButton(region("ask_1"), "Send")!;
  onAnswer = () => new Promise(() => {});
  await act(async () => send.focus());
  await act(async () => send.click());
  // The browser takes the focus off a button that is disabled, as Send is while its answer is on its way
  assert.ok(send.disabled);
  await act(async () => void send.dispatchEvent(new window.FocusEvent("focusout", { bubbles: true, relatedTarget: null })));
  await changes(settled(one, ANSWER));
  assert.equal(focused(), "the frame of ask_2");

  // Also when the agent's question leaves by a dismissal, with the focus in it
  await act(async () => region("ask_2").querySelector("textarea")!.focus());
  await removed("ask_2");
  assert.equal(focused(), "the frame of ask_3");
});

test("the focus stays where it is when it was not in the settled one", async () => {
  const [one, two] = [await asked(1), await asked(2)];
  await load(one, two);
  const outside = document.createElement("textarea");
  document.body.append(outside);
  try {
    await act(async () => region("ask_1").querySelector("textarea")!.focus());
    await act(async () => outside.focus());
    await changes(settled(one, ANSWER));
    assert.ok(document.activeElement === outside, focused());
  } finally {
    outside.remove();
  }
});

test("a focus that was nowhere is not moved", async () => {
  const [one, two] = [await asked(1), await asked(2)];
  await load(one, two);
  await act(async () => region("ask_1").querySelector("textarea")!.focus());
  await act(async () => region("ask_1").querySelector("textarea")!.blur());
  await changes(settled(one, ANSWER));
  assert.equal(focused(), "nothing");
});

const View = () => createElement(SurfaceView, { terminal: TERMINAL, surfaces: useSurfacesOf("t1") });

test("with no question left the focus goes to Earlier, and with nothing left to the view", async () => {
  const records = [await asked(1), await asked(2)];
  list = [records[0], ended(records[1])];
  loadSurfaces();
  // The view alone, which no settled question has the companion leave
  const element = document.createElement("div");
  document.body.append(element);
  mounted = { root: createRoot(element), container: element };
  await act(async () => mounted!.root.render(createElement(View)));
  await until(() => element.querySelector("textarea") !== null, "the question was never drawn");
  await act(async () => region("ask_1").querySelector("textarea")!.focus());
  await changes(settled(records[0], ANSWER));
  assert.equal(focused(), "Earlier (2)");

  await click(earlier()!);
  await act(async () => lineOf("ask_1").focus());
  await removed("ask_1");
  assert.equal(focused(), "Earlier (1)");
  await act(async () => button("Dismiss all").focus());
  await removed("ask_2");
  assert.ok(document.activeElement === element.firstElementChild, focused());
});

test("a locked one that leaves gives the focus to Earlier, and the last one to the view, though a question waits", async () => {
  await open("ask_1", ended(await asked(1)), ended(await asked(2)), await asked(3));
  await act(async () => region("ask_1").querySelector<HTMLButtonElement>("header button")!.focus());
  await removed("ask_1");
  assert.equal(focused(), "Earlier (1)");

  const view = earlier()!.closest('[tabindex="-1"]');
  await act(async () => button("Dismiss all").focus());
  await removed("ask_2");
  assert.ok(view !== null && document.activeElement === view, focused());
});

test("when the Surface view itself leaves with the focus, the focus goes to the view that shows instead", async () => {
  const shown = () => container().querySelector('[aria-label="Companion view"] [aria-checked="true"]');
  const record = await asked(1);
  await load(record);
  await act(async () => region("ask_1").querySelector("textarea")!.focus());
  await changes(settled(record, ANSWER));
  assert.equal(container().querySelector("[data-surface-view]") === null, true, "the last question settled, so its view gave way");
  assert.ok(shown() !== null && document.activeElement === shown(), focused());

  await showView();
  await click(earlier()!);
  await act(async () => button("Dismiss all").focus());
  await removed("ask_1");
  assert.ok(shown() !== null && document.activeElement === shown(), focused());
});

test("the focus is not taken by another terminal's questions", async () => {
  const [one, two] = [await asked(1), { ...(await asked(2)), terminal_id: "t2", id: "ask_1" }];
  await load(one, two);
  await act(async () => region("ask_1").querySelector("textarea")!.focus());
  await act(async () => mounted!.root.render(companion({ ...TERMINAL, id: "t2", name: "other" })));
  await settle();
  assert.equal(focused(), "nothing");
});

test("everything in Earlier is a native control the keyboard reaches, and says what it is", async () => {
  const record = await asked(1);
  held = [{ terminal_id: "t1", id: "ask_1", order: 1, revision: 1, values: { "/answers/0/text": "half" } }];
  await open("ask_1", ended(record));
  const controls = [...container().querySelectorAll<HTMLElement>("button")].filter((b) => b.closest("[data-locked]") ?? b === earlier());
  assert.deepEqual(
    controls.map((control) => control.getAttribute("aria-label") ?? control.textContent),
    ["Earlier (1)", `Ended: Question 1?, ${formatClock(AT)}`, "Dismiss this question", "Copy", "What was asked"],
  );
  assert.ok(controls.every((control) => !control.hasAttribute("tabindex") && (control as HTMLButtonElement).type === "button"));
});
