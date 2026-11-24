/// <reference types="node" />
// quay_review in the webview (#723), with only Tauri's `invoke` faked: the tab it is drawn on, the
// rail that decides it, and what the agent gets.
import "../../test-support/dom.ts";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import type { SurfaceRecord } from "./surfaceTypes.ts";
import type { MountedStage } from "./fixtures/reviewFixtures.ts";
import { called, loadSurfaces, startRust, unloadSurfaces, verdictOn } from "./fixtures/fakeRust.ts";

const { findButton, typeInto, unmount } = await import("./fixtures/askFixtures.ts");
const { acceptedReview, mountStage, openTab, REVIEW } = await import("./fixtures/reviewFixtures.ts");

let list: SurfaceRecord[];
/** What each `surface_answer` sent. */
let sent: unknown[];
let mounted: MountedStage | null = null;

beforeEach(() => {
  list = [];
  sent = [];
  startRust({ surface_list: () => list, surface_checks: () => [], surface_answer: ({ answer }) => void sent.push(answer) });
});
afterEach(async () => {
  if (mounted) await unmount(mounted);
  mounted = null;
  unloadSurfaces();
});

/** The frame of `review`'s tab, in front. */
async function draw(review: unknown = REVIEW): Promise<HTMLElement> {
  list = [await acceptedReview("review_1", review)];
  loadSurfaces();
  mounted = await mountStage();
  return openTab(mounted.container, (review as typeof REVIEW).title);
}

const click = (element: HTMLElement | undefined | null) => act(async () => element!.click());
const button = (region: HTMLElement, name: string) => findButton(region, name)!;
const checkbox = (region: HTMLElement, title: string) =>
  [...region.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((box) => box.labels?.[0]?.textContent === title)!;
const comment = (region: HTMLElement) => region.querySelector("textarea")!;
const type = (region: HTMLElement, text: string) => typeInto(comment(region), text);

test("a review is accepted as a surface that asks, with its parts under one root", async () => {
  const verdict = await verdictOn({ call: 1, tool: "quay_review", surface_id: "review_1", arguments: REVIEW });
  assert.ok("state" in verdict, JSON.stringify(verdict));
  assert.ok(verdict.asks);
  const kinds = new Map(verdict.state.createSurface.components.map(({ id, component }) => [id, component]));
  assert.equal(kinds.get("body"), "Text");
  assert.equal(kinds.get("comment"), "TextField");
  assert.deepEqual(
    ["CheckBox", "FileLink", "Button"].map((kind) => [...kinds.values()].filter((other) => other === kind).length),
    [3, 1, 3],
  );
});

test("every item starts kept, and Approve sends the verdict with nothing dropped", async () => {
  const region = await draw();
  assert.deepEqual(
    REVIEW.items.map(({ title }) => checkbox(region, title).checked),
    [true, true, true],
  );
  await click(button(region, "Approve"));
  assert.deepEqual(sent, [{ title: REVIEW.title, verdict: "approved", dropped: [] }]);
});

test("the button counts what is dropped, and the result names it with the comment", async () => {
  const region = await draw();
  await click(checkbox(region, "Drop answers whose turn has gone"));
  assert.ok(button(region, "Approve without 1 item"));
  await click(checkbox(region, "Write it down"));
  await type(region, "Log it instead.");
  await click(button(region, "Approve without 2 items"));
  assert.deepEqual(sent, [
    { title: REVIEW.title, verdict: "approved", dropped: ["Drop answers whose turn has gone", "Write it down"], comment: "Log it instead." },
  ]);
});

test("an item that is kept again is not dropped", async () => {
  const region = await draw();
  await click(checkbox(region, "Write it down"));
  await click(checkbox(region, "Write it down"));
  await click(button(region, "Approve"));
  assert.deepEqual((sent[0] as { dropped: string[] }).dropped, []);
});

test("Request changes needs a comment, and says so", async () => {
  const region = await draw();
  const request = () => button(region, "Request changes");
  assert.ok(request().disabled);
  assert.ok(region.textContent?.includes("To request changes, say what should change."));
  await type(region, "  \n ");
  assert.ok(request().disabled, "spaces are no comment");
  await type(region, "Split step 2.");
  assert.ok(!request().disabled);
  assert.ok(!region.textContent?.includes("To request changes, say what should change."));
  await click(request());
  assert.deepEqual(sent, [{ title: REVIEW.title, verdict: "changes_requested", dropped: [], comment: "Split step 2." }]);
});

test("Reject needs none, and a comment of spaces is left out", async () => {
  const region = await draw();
  await type(region, "   ");
  await click(button(region, "Reject"));
  assert.deepEqual(sent, [{ title: REVIEW.title, verdict: "rejected", dropped: [] }]);
});

test("a verdict is sent once, however often it is clicked", async () => {
  let taken = () => {};
  list = [await acceptedReview("review_1")];
  startRust({
    surface_list: () => list,
    surface_checks: () => [],
    surface_answer: ({ answer }) => {
      sent.push(answer);
      return new Promise<void>((resolve) => (taken = resolve));
    },
  });
  loadSurfaces();
  mounted = await mountStage();
  const region = await openTab(mounted.container);
  const approve = button(region, "Approve");
  await act(async () => {
    approve.click();
    approve.click();
  });
  await click(approve);
  assert.equal(sent.length, 1);
  await act(async () => taken());
});

const row = (region: HTMLElement, title: string) => checkbox(region, title).closest("li")!;

test("a dropped item is struck through, and the count says how many are kept", async () => {
  const region = await draw();
  const struck = () => REVIEW.items.map(({ title }) => row(region, title).querySelector('[class*="[&_label]:line-through"] label') !== null);
  const counted = () => /\d of \d kept/.exec(region.textContent ?? "")?.[0];
  assert.deepEqual([struck(), counted()], [[false, false, false], "3 of 3 kept"]);
  await click(checkbox(region, "Write it down"));
  assert.deepEqual([struck(), counted()], [[false, false, true], "2 of 3 kept"]);
});

test("the title is the first line, as plain text, and the body is Markdown", async () => {
  const region = await draw({ ...REVIEW, title: "Plan: *pair* <b>each</b> answer" });
  const content = region.querySelector<HTMLElement>("[data-surface-content]")!;
  assert.ok(content.textContent?.startsWith("Plan: *pair* <b>each</b> answer"));
  assert.equal(content.querySelectorAll("b, em").length, 0);
  assert.equal(content.querySelector("strong")?.textContent, "outlive");
});

test("an item's texts are plain text, whatever they say", async () => {
  const items = [{ title: "Approve **now**", detail: "a *b*\nc" }, { title: "comment" }];
  const region = await draw({ title: "Plan", body: "Steps.", items });
  assert.ok(checkbox(region, "Approve **now**"));
  assert.ok(row(region, "Approve **now**").textContent?.includes("a *b*\nc"));
  assert.equal(region.querySelectorAll("em").length, 0);
  await click(checkbox(region, "comment"));
  await click(button(region, "Approve without 1 item"));
  assert.deepEqual((sent[0] as { dropped: string[] }).dropped, ["comment"]);
});

/** Draws with a layout in which a box is as many pixels high as its text is long. */
async function withHeights(run: () => Promise<void>): Promise<void> {
  const proto = HTMLElement.prototype;
  const original = Object.getOwnPropertyDescriptor(proto, "offsetHeight");
  Object.defineProperty(proto, "offsetHeight", { configurable: true, get(this: HTMLElement) { return this.textContent?.length ?? 0; } });
  try {
    await run();
  } finally {
    if (original) Object.defineProperty(proto, "offsetHeight", original);
    else delete (proto as { offsetHeight?: number }).offsetHeight;
  }
}

test("a long detail folds to two lines behind More, which names its item", async () => {
  const items = [{ title: "One", detail: "x".repeat(33) }, { title: "Two", detail: "x".repeat(32) }];
  await withHeights(async () => {
    const region = await draw({ title: "Plan", body: "Steps.", items });
    const more = row(region, "One").querySelector<HTMLButtonElement>("button")!;
    assert.equal(row(region, "Two").querySelectorAll("button").length, 0, "two lines are not folded");
    const folded = document.getElementById(more.getAttribute("aria-controls")!)!;
    assert.deepEqual([more.textContent, more.getAttribute("aria-expanded"), folded.style.maxHeight], ["More: One", "false", "32px"]);
    await click(more);
    assert.deepEqual([more.textContent, more.getAttribute("aria-expanded"), folded.style.maxHeight], ["Less: One", "true", ""]);
  });
});

test("an item's file is a file link, which shows its line on a click and says where it leads before", async () => {
  const region = await draw();
  const link = row(region, "Give every turn an id").querySelector<HTMLElement>('[role="link"]')!;
  assert.equal(link.textContent, "src/turns.ts:12");
  assert.equal(called("surface_show_file").length, 0);
  await act(async () => link.focus());
  assert.equal(region.querySelector("[data-surface-foot]")?.textContent, "src/turns.ts:12");
  await click(link);
  assert.deepEqual(called("surface_show_file"), [{ terminalId: "t1", path: "src/turns.ts", line: 12 }]);
});

test("a file that names no line, or a drive, is all path", async () => {
  const items = ["src/a.ts", "C:\\work\\a.ts", "C:\\work\\a.ts:7", "C:12", "a.ts:0"].map((file) => ({ title: file, file }));
  const region = await draw({ title: "Plan", body: "Steps.", items });
  for (const { title } of items) await click(row(region, title).querySelector<HTMLElement>('[role="link"]'));
  assert.deepEqual(
    called("surface_show_file").map(({ path, line }) => [path, line]),
    [["src/a.ts", null], ["C:\\work\\a.ts", null], ["C:\\work\\a.ts", 7], ["C:12", null], ["a.ts:0", null]],
  );
});

test("everything that decides is a native control the keyboard reaches, in reading order, and each verdict has its own words", async () => {
  const region = await draw();
  await type(region, "Log it.");
  const controls = [...region.querySelectorAll<HTMLElement>("[data-surface-content] :is(input, textarea, button, a)")];
  assert.ok(controls.every((control) => !control.hasAttribute("tabindex") && !control.matches(":disabled")));
  assert.deepEqual(
    controls.map((control) => (control.tagName === "BUTTON" ? control.textContent : control.tagName)),
    ["INPUT", "src/turns.ts:12", "INPUT", "INPUT", "TEXTAREA", "Approve", "Request changes", "Reject"],
  );
  assert.equal(comment(region).labels?.[0]?.textContent, "Comment for the agent");
  assert.equal(region.getAttribute("aria-label"), "Review from fix-75");
  // The text scrolls by the keyboard, though nothing in it takes the focus
  const content = region.querySelector<HTMLElement>("[data-surface-content]")!;
  assert.deepEqual([content.tabIndex, content.getAttribute("aria-label")], [0, "Review"]);
});

test("the rail is beside the text and stays in view, or under it on a narrow stage, with the items in a box of their own", async () => {
  const region = await draw();
  const rail = region.querySelector<HTMLElement>("[data-review-rail]")!;
  const text = region.querySelector<HTMLElement>("[data-review-text]")!;
  const content = region.querySelector<HTMLElement>("[data-surface-content]")!;
  const has = (element: HTMLElement, ...names: string[]) => names.every((name) => element.className.split(" ").includes(name));
  assert.ok((text.compareDocumentPosition(rail) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0);
  assert.ok(has(rail.parentElement!, "grid", "@3xl:grid-cols-[minmax(0,1fr)_340px]"), "two columns only where there is room");
  assert.ok(has(content, "overflow-y-auto", "[container-type:size]"), "the frame's content scrolls, not the frame");
  assert.ok(has(rail, "@3xl:sticky", "@3xl:top-0", "@3xl:max-h-[100cqh]"));
  assert.ok(has(rail.querySelector<HTMLElement>("[data-review-items]")!, "overflow-y-auto"));
  assert.equal(rail.getAttribute("aria-label"), "Your decision");
  assert.ok(!content.contains(region.querySelector("header")) && content.querySelector("[data-surface-foot]") === null, "the header and the foot stay");
  assert.ok(!region.textContent?.includes("QUAY") && region.querySelector("[data-neon]") === null, "no surface carries the Quay mark");
});

test("a verdict that is not taken says why, and can be sent again", async () => {
  list = [await acceptedReview("review_1")];
  startRust({ surface_list: () => list, surface_checks: () => [], surface_answer: () => Promise.reject("Not sent: the terminal has exited.") });
  loadSurfaces();
  mounted = await mountStage();
  const region = await openTab(mounted.container);
  await click(checkbox(region, "Write it down"));
  await click(button(region, "Reject"));
  assert.equal(region.querySelector('[role="alert"]')?.textContent, "Not sent: the terminal has exited.");
  assert.ok(!checkbox(region, "Write it down").checked && !button(region, "Reject").disabled);
});
