/// <reference types="node" />
// What the operator does with a surface besides answering it (#716), with only Tauri's `invoke` faked:
// dismissing it from its frame, and answering one the agent has changed since.
import { emitEvent } from "../../test-support/dom.ts";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { SurfaceRecord } from "./surfaceTypes.ts";
import { terminalInfo } from "../companion/fixtures/companionFixtures.ts";
import { acceptedAsk, called, loadSurfaces, settle, startRust, unloadSurfaces, until } from "./fixtures/fakeRust.ts";

const { useSurfacesOf } = await import("./surfaceHost.ts");
const { earlierButton, openLocked } = await import("./fixtures/askFixtures.ts");
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
let onAnswer: () => Promise<void>;
let onDismiss: () => Promise<void>;
let root: Root;
let container: HTMLElement;

beforeEach(() => {
  list = [];
  onAnswer = async () => {};
  onDismiss = async () => {};
  startRust({ surface_list: () => list, surface_checks: () => [], surface_answer: () => onAnswer(), surface_dismiss: () => onDismiss() });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  unloadSurfaces();
});

/** The question `id`, as Rust holds it once the webview has accepted it. */
const accepted = (id: string, order = 1) => acceptedAsk(id, ASK, "t1", order);

const View = () => createElement(SurfaceView, { terminal: TERMINAL, surfaces: useSurfacesOf("t1") });

/** Loads the page with what Rust holds. */
async function open(): Promise<void> {
  loadSurfaces();
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
  loadSurfaces();
  await act(async () => root.render(createElement(View)));
  await until(() => earlierButton(container) !== undefined, "the surface was never drawn");
  await openLocked(container, "ask_1");
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
  changed.carried = { from: 2, set: {} };
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
