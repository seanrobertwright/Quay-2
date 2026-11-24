/// <reference types="node" />
// What the operator does with a surface besides answering it (#716), with only Tauri's `invoke` faked:
// dismissing it from its frame, and answering one the agent has changed since.
import { emitEvent, fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { SurfaceRecord, Verdict } from "./surfaceTypes.ts";
import { terminalInfo } from "../companion/fixtures/companionFixtures.ts";

const { startSurfaces, useSurfacesOf } = await import("./surfaceHost.ts");
const { SurfaceView } = await import("./SurfaceView.tsx");

const TERMINAL = { ...terminalInfo("t1", "E:/alpha"), name: "fix-75" };
const ASK = {
  questions: [
    {
      question: "Which base should this branch take?",
      options: [
        { label: "Rebase onto master", recommended: false },
        { label: "Merge master in", recommended: false },
      ],
    },
  ],
};
const ANSWER = { answers: [{ question: "Which base should this branch take?", chosen: ["Rebase onto master"] }] };

/** What Rust holds, and what the two commands under test do. */
let list: SurfaceRecord[];
let calls: { cmd: string; args: Record<string, unknown> }[];
let onAnswer: () => Promise<void>;
let onDismiss: () => Promise<void>;
let stop: (() => void) | null = null;
let root: Root;
let container: HTMLElement;

beforeEach(() => {
  list = [];
  calls = [];
  onAnswer = async () => {};
  onDismiss = async () => {};
  fakeInvoke(async (cmd, args) => {
    calls.push({ cmd, args });
    if (cmd === "surface_list") return list;
    if (cmd === "surface_checks") return [];
    if (cmd === "surface_answer") return onAnswer();
    if (cmd === "surface_dismiss") return onDismiss();
    return null;
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  stop?.();
  stop = null;
});

const settle = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 20))));
const called = (cmd: string) => calls.filter((c) => c.cmd === cmd).map((c) => c.args);

/** Waits, for up to two seconds, until `holds`. */
async function until(holds: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 100 && !holds(); i += 1) await settle();
  assert.ok(holds(), what);
}

/** The question `id`, as Rust holds it once the webview has accepted it. */
async function accepted(id: string, order = 1): Promise<SurfaceRecord> {
  stop ??= startSurfaces();
  await settle();
  emitEvent("surface-check", { call: order, tool: "quay_ask", surface_id: id, arguments: ASK });
  const verdicts = () => called("surface_verdict") as unknown as { call: number; verdict: Verdict }[];
  await until(() => verdicts().some((v) => v.call === order), "no verdict was given");
  const { verdict } = verdicts().find((v) => v.call === order)!;
  assert.ok("state" in verdict);
  return { terminal_id: "t1", id, tool: "quay_ask", state: verdict.state, revision: 1, order, change: order, asks: true, answer: null };
}

const View = () => createElement(SurfaceView, { terminal: TERMINAL, surfaces: useSurfacesOf("t1") });

/** Loads the page with what Rust holds. */
async function open(): Promise<void> {
  stop?.();
  stop = startSurfaces();
  await act(async () => root.render(createElement(View)));
  await until(() => regions().length === list.length && !container.textContent?.includes("Loading"), "the surfaces were never drawn");
}

const regions = () => [...container.querySelectorAll<HTMLElement>("section[data-surface]")];
const ids = () => regions().map((region) => region.dataset.surface);
const dismissOf = (region: HTMLElement) => region.querySelector<HTMLButtonElement>('header button[aria-label="Dismiss this question"]')!;
const alertOf = (region: HTMLElement) => region.querySelector('[role="alert"]')?.textContent;
const radios = () => [...container.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
const send = () => [...container.querySelectorAll("button")].find((b) => b.textContent === "Send")!;

test("a question is dismissed from its frame, once, and leaves when Quay says so", async () => {
  list = [await accepted("ask_1"), await accepted("ask_2", 2)];
  await open();
  let taken = () => {};
  onDismiss = () => new Promise((resolve) => (taken = resolve));

  const button = dismissOf(regions()[0]);
  assert.equal(button.tagName === "BUTTON" && button.type, "button");
  await act(async () => {
    button.click();
    button.click();
  });
  await act(async () => button.click());
  assert.deepEqual(called("surface_dismiss"), [{ terminalId: "t1", id: "ask_1" }]);
  assert.deepEqual(ids(), ["ask_1", "ask_2"], "Rust decides that it leaves");

  await act(async () => taken());
  await act(async () => button.click());
  assert.equal(called("surface_dismiss").length, 1, "what has been dismissed takes no more");
  await act(async () => emitEvent("surface-removed", { terminal_id: "t1", id: "ask_1" }));
  assert.deepEqual(ids(), ["ask_2"]);
});

test("a dismissal that is refused says why, and can be tried again", async () => {
  list = [await accepted("ask_1")];
  await open();
  onDismiss = () => Promise.reject("Not dismissed: its answer is being sent.");
  await act(async () => dismissOf(regions()[0]).click());
  await settle();
  assert.equal(alertOf(regions()[0]), "Not dismissed: its answer is being sent.");
  assert.equal(radios().length, 2, "it can still be answered");

  onDismiss = async () => {};
  await act(async () => dismissOf(regions()[0]).click());
  await settle();
  assert.equal(called("surface_dismiss").length, 2);
  assert.equal(alertOf(regions()[0]), undefined);
});

test("an answered question can be dismissed", async () => {
  list = [{ ...(await accepted("ask_1")), answer: ANSWER }];
  await open();
  await act(async () => dismissOf(regions()[0]).click());
  assert.deepEqual(called("surface_dismiss"), [{ terminalId: "t1", id: "ask_1" }]);
});

test("the keyboard reaches Dismiss, in the frame and before what the agent asked", async () => {
  list = [await accepted("ask_1")];
  await open();
  const [first, ...rest] = [...regions()[0].querySelectorAll<HTMLElement>("button, input, textarea")];
  assert.ok(first === dismissOf(regions()[0]) && !first.hasAttribute("tabindex"));
  assert.ok(rest.every((control) => control.closest("[data-surface-content]") !== null));
});

test("an answer to an older revision is refused in words, the question is drawn again, and the next click answers it", async () => {
  const asked = await accepted("ask_1");
  list = [asked];
  await open();
  const changed = structuredClone(asked);
  changed.revision = 2;
  changed.change = 2;
  const label = changed.state.createSurface.components.find((component) => component.id === "q0_question")!;
  label.text = "Which base now?";
  const refusal = "Not sent: the agent has changed this since. Check it and send again.";
  onAnswer = () => {
    emitEvent("surface-changed", changed);
    return Promise.reject(refusal);
  };

  await act(async () => radios()[0].click());
  await act(async () => send().click());
  await until(() => container.textContent!.includes("Which base now?"), "it was not drawn again");
  assert.equal(alertOf(regions()[0]), refusal);
  assert.ok(radios().every((radio) => !radio.checked) && send().disabled, "a click is for the version on screen");

  onAnswer = async () => {};
  await act(async () => radios()[0].click());
  await act(async () => send().click());
  await settle();
  assert.deepEqual(
    called("surface_answer").map(({ revision }) => revision),
    [1, 2],
  );
  assert.equal(alertOf(regions()[0]), undefined);
});
