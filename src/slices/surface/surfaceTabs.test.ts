/// <reference types="node" />
// The stage tabs of reviews (#723), with only Tauri's `invoke` faked: how a tab arrives, opens, closes
// and folds under Earlier, and how a review that is over looks.
import { emitEvent } from "../../test-support/dom.ts";
import { afterEach, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { SurfaceRecord } from "./surfaceTypes.ts";
import type { Mounted } from "./fixtures/askFixtures.ts";
import type { MountedStage } from "./fixtures/reviewFixtures.ts";
import { acceptedAsk, called, loadSurfaces, settle, startRust, unloadSurfaces, until } from "./fixtures/fakeRust.ts";

const { findButton, mountCompanion, typeInto, unmount, viewEntry } = await import("./fixtures/askFixtures.ts");
const { acceptedReview, frame, mountStage, openTab, REVIEW, tab, tabs, TERMINAL } = await import("./fixtures/reviewFixtures.ts");
const { AskingButton } = await import("./AskingButton.tsx");
const { SurfaceChips } = await import("./SurfaceChips.tsx");
const { formatClock } = await import("../../lib/dates.ts");

const AT = Date.UTC(2026, 10, 24, 19, 42, 5);

let list: SurfaceRecord[];
/** What Rust holds unsent for a page that loads. */
let held: object[];
let onDismiss: () => Promise<void>;
let stage: MountedStage | null = null;
let others: Mounted[] = [];

beforeEach(() => {
  list = [];
  held = [];
  onDismiss = async () => {};
  startRust({
    surface_list: () => list,
    surface_checks: () => [],
    surface_open_page: () => ({ page: 1, unsent: structuredClone(held) }),
    surface_dismiss: () => onDismiss(),
  });
});
afterEach(async () => {
  mock.timers.reset();
  for (const mounted of stage ? [...others, stage] : others) await unmount(mounted);
  stage = null;
  others = [];
  unloadSurfaces();
});

/** Loads the page with `records` in Rust's list, on the stage of `terminals`. */
async function load(records: SurfaceRecord[], terminals = [TERMINAL]): Promise<HTMLElement> {
  if (stage) await unmount(stage);
  list = structuredClone(records);
  loadSurfaces();
  stage = await mountStage(terminals);
  return stage.container;
}

const change = async (record: SurfaceRecord) => {
  await act(async () => emitEvent("surface-changed", record));
  await settle();
};
const leaves = async ({ terminal_id, id }: SurfaceRecord) => {
  await act(async () => emitEvent("surface-removed", { terminal_id, id }));
  await settle();
};
const click = async (element: HTMLElement | undefined | null) => {
  await act(async () => element!.click());
  await settle();
};

let changes = 1_000;
function nextChange(): Pick<SurfaceRecord, "change" | "locked_order"> {
  changes += 1;
  return { change: changes, locked_order: changes };
}
const decided = (record: SurfaceRecord, answer: object, at = AT): SurfaceRecord => ({
  ...record,
  ...nextChange(),
  answer: { title: REVIEW.title, dropped: [], ...answer },
  answered_at: at,
});
const ended = (record: SurfaceRecord): SurfaceRecord => ({ ...record, ...nextChange(), ended_at: AT });

const inFront = (container: HTMLElement) => frame(container)?.dataset.surface ?? null;
const current = (container: HTMLElement) => tabs(container).filter((button) => button.getAttribute("aria-current") === "true").length;
const pulses = (button: HTMLElement) => button.querySelector('[class*="animate-pulse"]') !== null;
const closer = (button: HTMLElement) => button.parentElement!.querySelector<HTMLButtonElement>('button[aria-label^="Close "]');
const earlier = (container: HTMLElement) => [...container.querySelectorAll("button")].find((button) => button.textContent?.startsWith("Earlier"));
const menuItems = () => [...document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]')];
const band = (container: HTMLElement) => frame(container)!.querySelector('[role="status"]')?.textContent;
const comment = (container: HTMLElement) => frame(container)!.querySelector("textarea")!;
const checkbox = (container: HTMLElement, title: string) =>
  [...frame(container)!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((box) => box.labels?.[0]?.textContent === title)!;

test("a review that arrives has a pulsing tab that waits, and does not take the stage", async () => {
  const container = await load([]);
  await change(await acceptedReview("review_1"));

  const [button] = tabs(container);
  assert.ok(button.textContent?.includes(REVIEW.title));
  assert.equal(button.getAttribute("aria-label"), `${REVIEW.title}, review from fix-75, waiting on you`);
  assert.ok(pulses(button) && button.querySelector("[data-waiting-dot]") !== null);
  assert.ok(current(container) === 0 && inFront(container) === null);
  assert.equal(container.querySelectorAll("section[data-surface]").length, 0, "nothing of it is drawn");

  await openTab(container);
  assert.equal(current(container), 1);
  assert.ok(!pulses(tabs(container)[0]), "in front it does not pulse");
});

test("a review's tab shows the name of the terminal it is from after its title, and cuts it short where it is long", async () => {
  const long = { ...TERMINAL, name: "fix-75-a-terminal-name-that-goes-on-and-on" };
  const container = await load([await acceptedReview("review_1")], [long]);
  const [button] = tabs(container);
  const from = button.querySelector<HTMLElement>("[data-tab-from]");
  assert.equal(from?.textContent, long.name);
  assert.ok(button.textContent?.startsWith(REVIEW.title), "the title comes first");
  assert.equal(from?.getAttribute("aria-hidden"), "true", "the tab's name already says it");
  assert.equal(button.getAttribute("aria-label"), `${REVIEW.title}, review from ${long.name}, waiting on you`);
  assert.ok(from!.className.split(" ").includes("truncate"));
});

test("a second review leaves the first one in front", async () => {
  const container = await load([await acceptedReview("review_1")]);
  await openTab(container);
  await change(await acceptedReview("review_2", { ...REVIEW, title: "Findings" }, "t1", 2));
  assert.equal(inFront(container), "review_1");
  assert.deepEqual(
    tabs(container).map((button) => pulses(button)),
    [false, true],
  );
});

test("its terminal's row has a chip for it, and its pane's button counts it and opens it", async () => {
  await load([await acceptedReview("review_1")]);
  const opened: string[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  others.push({ root, container });
  const onOpen = ({ id }: { id: string }) => void opened.push(id);
  await act(async () =>
    root.render([
      createElement(SurfaceChips, { key: "chips", terminalId: "t1", terminalName: "fix-75", onOpen }),
      createElement(AskingButton, { key: "button", terminalId: "t1", onOpen }),
    ]),
  );
  const [chip, button] = [...container.querySelectorAll("button")];
  assert.equal(chip.getAttribute("aria-label"), "Review, surface 1 of 1 from fix-75, waiting on you");
  assert.equal(button.getAttribute("aria-label"), "1 question for you");
  assert.equal(button.title, "1 question for you. Open the oldest");
  await click(chip);
  await click(button);
  assert.deepEqual(opened, ["review_1", "review_1"]);
});

test("the companion has no Surface view for a review, and one that arrives does not switch it", async () => {
  await load([await acceptedReview("review_1")]);
  const companion = await mountCompanion(TERMINAL);
  others.push(companion);
  assert.ok(viewEntry(companion.container, "Surface") === undefined);

  await change(await acceptedAsk("ask_1", { questions: [{ question: "Which?", options: [], multiple: false }] }, "t1", 2));
  assert.deepEqual(
    [...companion.container.querySelectorAll<HTMLElement>("section[data-surface]")].map((section) => section.dataset.surface),
    ["ask_1"],
  );
  assert.ok(!companion.container.textContent?.includes(REVIEW.title));
});

test("a review beside three questions is no fourth question waiting", async () => {
  const records: SurfaceRecord[] = [];
  for (const n of [1, 2, 3]) records.push(await acceptedAsk(`ask_${n}`, { questions: [{ question: `Question ${n}?`, options: [], multiple: false }] }, "t1", n));
  records.push(await acceptedReview("review_1", REVIEW, "t1", 4));
  await load(records);
  const companion = await mountCompanion(TERMINAL);
  others.push(companion);
  await click(viewEntry(companion.container, "Surface"));
  assert.ok(companion.container.textContent?.includes("Question 1?"));
  assert.ok(!companion.container.textContent?.includes("questions waiting"));
});

test("opening a review from elsewhere brings its tab in front and takes the focus to it", async () => {
  const container = await load([await acceptedReview("review_1"), await acceptedAsk("ask_1", { questions: [{ question: "Which?", options: [], multiple: false }] }, "t1", 2)]);
  assert.equal(await stage!.open({ terminal_id: "t1", id: "review_1" }), true);
  await until(() => inFront(container) === "review_1", "its tab is not in front");
  assert.ok(document.activeElement === frame(container));

  await stage!.showTerminals();
  assert.equal(await stage!.open({ terminal_id: "t1", id: "ask_1" }), false, "a question has no tab");
  assert.equal(await stage!.open({ terminal_id: "t1", id: "review_9" }), false);
  assert.equal(inFront(container), null);
});

test("picking a review's tab takes the focus to it, so the keyboard goes on from there", async () => {
  const container = await load([await acceptedReview("review_1"), await acceptedReview("review_2", { ...REVIEW, title: "Findings" }, "t1", 2)]);
  for (const [at, id] of ["review_1", "review_2", "review_1"].entries()) {
    const button = tabs(container)[at % 2];
    await act(async () => button.focus());
    await click(button);
    assert.equal(document.activeElement?.getAttribute("data-surface"), id);
  }
});

test("the tab bar has the active project's reviews, and opening another's makes its project active", async () => {
  const beta = { ...TERMINAL, id: "t2", name: "docs", project_path: "E:/beta" };
  const container = await load([await acceptedReview("review_1"), await acceptedReview("review_1", { ...REVIEW, title: "Findings" }, "t2", 2)], [TERMINAL, beta]);
  const labels = () => tabs(container).map((button) => button.querySelector(".truncate")?.textContent);
  assert.deepEqual(labels(), [REVIEW.title]);

  await stage!.open({ terminal_id: "t2", id: "review_1" });
  assert.deepEqual(labels(), ["Findings"]);
  assert.equal(inFront(container), "review_1");

  await stage!.showProject("E:/alpha");
  assert.equal(inFront(container), null);
  await stage!.showProject("E:/beta");
  assert.equal(inFront(container), null, "it was left, and does not come back in front by itself");
});

test("closing the tab dismisses the review, once, and the terminals are in front again", async () => {
  const record = await acceptedReview("review_1");
  const container = await load([record]);
  await openTab(container);
  await click(closer(tabs(container)[0]));
  assert.deepEqual(called("surface_dismiss"), [{ terminalId: "t1", id: "review_1" }]);
  await leaves(record);
  assert.equal(tabs(container).length, 0);
  assert.equal(container.querySelectorAll("section[data-surface]").length, 0);

  await change({ ...(await acceptedReview("review_1", REVIEW, "t1", 5)), change: 5 });
  assert.equal(inFront(container), null, "a later surface of that id does not take its place in front");
});

test("a review whose tab could not be closed says why, and stays", async () => {
  onDismiss = () => Promise.reject("Not dismissed: its answer is being sent.");
  const container = await load([await acceptedReview("review_1")]);
  await openTab(container);
  await click(closer(tabs(container)[0]));
  assert.equal(frame(container)!.querySelector('[role="alert"]')?.textContent, "Not dismissed: its answer is being sent.");
  assert.equal(tabs(container).length, 1);
});

/** The button that closes the notice in the frame in front, if there is one. */
const noticeCloser = (container: HTMLElement) => frame(container)?.querySelector<HTMLButtonElement>('[role="alert"] button[aria-label="Dismiss this notice"]') ?? null;
const alertsIn = (container: HTMLElement) => [...frame(container)!.querySelectorAll('[role="alert"]')].map((alert) => alert.textContent);

test("a notice of why the review was not dismissed closes with its ×, gives the focus to the frame and keeps what was typed", async () => {
  onDismiss = () => Promise.reject("Not dismissed: its answer is being sent.");
  const container = await load([await acceptedReview("review_1")]);
  await openTab(container);
  await typeInto(comment(container), "Keep the second one");
  await click(frame(container)!.querySelector<HTMLButtonElement>('button[aria-label="Dismiss this review"]'));
  assert.deepEqual(alertsIn(container), ["Not dismissed: its answer is being sent."]);

  await click(noticeCloser(container));
  assert.deepEqual(alertsIn(container), []);
  assert.equal(document.activeElement, frame(container), "the focus goes to the frame");
  assert.equal(comment(container).value, "Keep the second one");
  assert.equal(tabs(container).length, 1);

  await click(frame(container)!.querySelector<HTMLButtonElement>('button[aria-label="Dismiss this review"]'));
  assert.deepEqual(alertsIn(container), ["Not dismissed: its answer is being sent."], "a later refusal is told again");
});

test("a notice of why a tab could not be closed closes with its ×, and only that review's", async () => {
  onDismiss = () => Promise.reject("Not dismissed: its answer is being sent.");
  const container = await load([await acceptedReview("review_1"), await acceptedReview("review_2", { ...REVIEW, title: "Findings" }, "t1", 2)]);
  for (const title of [REVIEW.title, "Findings"]) {
    await openTab(container, title);
    await click(closer(tab(container, title)!));
  }
  assert.deepEqual(alertsIn(container), ["Not dismissed: its answer is being sent."]);
  await click(noticeCloser(container));
  assert.deepEqual(alertsIn(container), []);
  assert.equal(document.activeElement, frame(container));
  assert.equal(tabs(container).length, 2);
  await openTab(container, REVIEW.title);
  assert.deepEqual(alertsIn(container), ["Not dismissed: its answer is being sent."], "the other review's notice stays");
});

test("why a tab could not be closed is no longer said once its review is decided", async () => {
  onDismiss = () => Promise.reject("Not dismissed: its answer is being sent.");
  const record = await acceptedReview("review_1");
  const container = await load([record]);
  await openTab(container);
  await click(closer(tabs(container)[0]));
  await change(decided(record, { verdict: "approved" }));
  assert.equal(band(container), "Approved and sent to the agent.");
  assert.ok(frame(container)!.querySelector('[role="alert"]') === null);
});

test("what was put in a review is saved when its tab is left, is there when it is back, and after a reload", async () => {
  const record = await acceptedReview("review_1", REVIEW, "t1", 7);
  const container = await load([record]);
  await openTab(container);
  mock.timers.enable({ apis: ["setTimeout"] });
  await typeInto(comment(container), "Log it instead.");
  await act(async () => checkbox(container, "Write it down").click());
  const saves = () => called("surface_save_unsent");
  assert.deepEqual(saves(), []);
  await stage!.showTerminals();
  const values = { "/items/2/kept": false, "/comment": "Log it instead." };
  assert.deepEqual(saves(), [{ terminalId: "t1", id: "review_1", unsent: { page: 1, save: (saves()[0].unsent as { save: number }).save, order: 7, revision: 1, values } }]);
  mock.timers.reset();

  await openTab(container);
  assert.equal(comment(container).value, "Log it instead.");
  held = [{ terminal_id: "t1", id: "review_1", order: 7, revision: 1, values }];
  const again = await load([record]);
  await openTab(again);
  assert.equal(comment(again).value, "Log it instead.");
  assert.deepEqual(
    REVIEW.items.map(({ title }) => checkbox(again, title).checked),
    [true, true, false],
  );
  assert.ok(findButton(again, "Approve without 1 item"), "worked out again");
});

test("decided, its tab stays while the operator is on it, then folds under Earlier with its state, and opens from there", async () => {
  const record = await acceptedReview("review_1");
  const container = await load([record]);
  await openTab(container);
  await change(decided(record, { verdict: "approved" }));
  assert.equal(inFront(container), "review_1");
  assert.ok(tab(container) && earlier(container) === undefined);
  assert.ok(tabs(container)[0].querySelector("[data-waiting-dot]") === null);

  await stage!.showTerminals();
  assert.equal(tabs(container).length, 0);
  assert.equal(earlier(container)?.textContent, "Earlier (1)");
  await click(earlier(container));
  assert.deepEqual(
    menuItems().map((item) => item.textContent),
    [`${REVIEW.title}Approved, ${formatClock(AT)}`],
  );
  await click(menuItems()[0]);
  assert.equal(inFront(container), "review_1");
  assert.ok(earlier(container) === undefined && tabs(container).length === 1);
});

test("one that is decided or ends while it is not in front folds at once, newest first", async () => {
  const [one, two, three] = [await acceptedReview("review_1"), await acceptedReview("review_2", REVIEW, "t1", 2), await acceptedReview("review_3", REVIEW, "t1", 3)];
  const container = await load([one, two, three]);
  await change(decided(three, { verdict: "rejected" }));
  await change(ended(one));
  await change(decided(two, { verdict: "changes_requested", comment: "Split it." }));
  assert.equal(tabs(container).length, 0);
  await click(earlier(container));
  assert.deepEqual(
    menuItems().map((item) => item.textContent?.replace(REVIEW.title, "")),
    ["Changes requested", "Ended", "Rejected"].map((word) => `${word}, ${formatClock(AT)}`),
  );
});

test("closing a decided review's tab takes it away", async () => {
  const record = await acceptedReview("review_1");
  const container = await load([record]);
  await openTab(container);
  const locked = decided(record, { verdict: "approved" });
  await change(locked);
  await click(closer(tabs(container)[0]));
  assert.deepEqual(called("surface_dismiss"), [{ terminalId: "t1", id: "review_1" }]);
  await leaves(locked);
  assert.ok(tabs(container).length === 0 && earlier(container) === undefined);
});

test("decided, it shows the verdict, the dropped items and the comment, with the text folded", async () => {
  const record = await acceptedReview("review_1");
  const container = await load([record]);
  await openTab(container);
  await change(decided(record, { verdict: "approved", dropped: ["Drop answers whose turn has gone", "Write it down"], comment: "Log it\ninstead." }));
  const region = frame(container)!;
  assert.equal(band(container), "Approved and sent to the agent.");
  const said = [...region.querySelectorAll("dt, dd")].map((element) => element.textContent);
  assert.deepEqual(said, ["Verdict", "Approved", "Dropped", "Drop answers whose turn has gone", "Write it down", "Comment", "Log it\ninstead."]);
  assert.ok(region.textContent?.includes(REVIEW.title));
  assert.ok(!region.textContent?.includes("outlive"), "folded");
  assert.equal(region.querySelectorAll("[data-surface-content] :is(input, textarea)").length, 0);

  const fold = findButton(region, "What was reviewed")!;
  assert.equal(fold.getAttribute("aria-expanded"), "false");
  await click(fold);
  await until(() => region.querySelector("strong") !== null, "the text was not drawn as Markdown");
  assert.ok(region.textContent?.includes("An answer can outlive its turn."));
  assert.equal(region.querySelector("h4")?.textContent, "Why");
  for (const { title } of REVIEW.items) assert.ok(region.textContent?.includes(title), title);
  assert.ok(region.textContent?.includes("In the *bridge*") && region.textContent.includes("src/turns.ts:12"), "plain text");
});

test("with nothing dropped and no comment it says so", async () => {
  const record = await acceptedReview("review_1");
  const container = await load([record]);
  await openTab(container);
  await change(decided(record, { verdict: "approved" }));
  assert.deepEqual(
    [...frame(container)!.querySelectorAll("dt, dd")].map((element) => element.textContent),
    ["Verdict", "Approved", "Dropped", "Nothing"],
  );
});

test("a review without items says nothing of dropping", async () => {
  const review = { title: "Findings", body: "All well." };
  const record = await acceptedReview("review_1", review);
  const container = await load([record]);
  const region = await openTab(container, "Findings");
  assert.ok(!region.textContent?.includes("Keep or drop"));
  await change(decided(record, { title: "Findings", verdict: "approved" }));
  assert.ok(!frame(container)!.textContent?.includes("Dropped"));
});

test("each verdict has a band, an icon and a colour of its own", async () => {
  const looks = new Set<string>();
  for (const [verdict, words] of [["approved", "Approved and sent to the agent."], ["changes_requested", "Changes requested and sent to the agent."], ["rejected", "Rejected and sent to the agent."]]) {
    const record = await acceptedReview("review_1");
    const container = await load([decided(record, { verdict })]);
    await click(earlier(container));
    await click(menuItems()[0]);
    assert.equal(band(container), words);
    const line = frame(container)!.querySelector('[role="status"]')!;
    looks.add(line.querySelector("svg")!.getAttribute("class")!);
    // The band is in the verdict's colour
    looks.add(line.parentElement!.className);
  }
  assert.equal(looks.size, 6);
});

test("ended, it says so, keeps the comment that was not sent with Copy, and takes nothing", async () => {
  const record = await acceptedReview("review_1");
  const container = await load([record]);
  await openTab(container);
  await typeInto(comment(container), "Log it instead.");
  await change(ended(record));
  const region = frame(container)!;
  assert.equal(band(container), "The terminal exited before this was answered.");
  assert.ok(region.textContent?.includes("You had typed, not sent") && region.textContent.includes("Log it instead."));
  assert.ok(findButton(region, "Copy") && findButton(region, "What was reviewed"));
  assert.ok(findButton(region, "Approve") === undefined);
});

test("a verdict takes the focus to the frame, not away from it", async () => {
  const record = await acceptedReview("review_1");
  const container = await load([record]);
  const region = await openTab(container);
  const approve = findButton(region, "Approve")!;
  await act(async () => approve.focus());
  await change(decided(record, { verdict: "approved" }));
  assert.ok(document.activeElement === frame(container));
});
