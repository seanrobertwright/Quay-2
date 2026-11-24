/// <reference types="node" />
// Agent surfaces in the webview (#715), with only Tauri's `invoke` faked: what the webview answers to
// Rust's checks, and what the operator sees and sends in the companion's Surface view.
import { emitEvent, fakeInvoke } from "../../test-support/dom.ts";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import type { CheckRequest, SurfaceRecord, Verdict } from "./surfaceTypes.ts";
import type { Mounted } from "./fixtures/askFixtures.ts";
import type { TerminalInfo } from "../terminal/types.ts";

const { startSurfaces } = await import("./surfaceHost.ts");
const { askCheck, askRecord, companion, findButton, mountCompanion, settle, TERMINAL, typeInto: type, unmount, until, viewEntry } = await import("./fixtures/askFixtures.ts");

/** What Rust holds, as the fake `invoke` answers it. */
let list: SurfaceRecord[];
let checks: CheckRequest[];
/** Every command the webview called, in order. */
let calls: { cmd: string; args: Record<string, unknown> }[];
/** What `surface_answer` does. */
let onAnswer: () => Promise<void>;
let stop: (() => void) | null = null;
let mounted: Mounted | null = null;

beforeEach(() => {
  list = [];
  checks = [];
  calls = [];
  onAnswer = async () => {};
  fakeInvoke(async (cmd, args) => {
    calls.push({ cmd, args });
    if (cmd === "surface_list") return list;
    if (cmd === "surface_checks") return checks;
    if (cmd === "surface_answer") return onAnswer();
    return null;
  });
});
afterEach(async () => {
  if (mounted) await unmount(mounted);
  mounted = null;
  stop?.();
  stop = null;
});

const ASK = {
  questions: [
    {
      question: "Which base should this branch take?",
      options: [
        { label: "Rebase onto master", description: "Two conflicts", recommended: true },
        { label: "Merge master in", recommended: false },
      ],
    },
  ],
};
const check = (call: number, args: unknown = ASK) => askCheck(call, args);

const called = (cmd: string) => calls.filter((c) => c.cmd === cmd).map((c) => c.args);

/** The verdicts the webview gave, by call. */
const verdicts = () => called("surface_verdict") as unknown as { call: number; verdict: Verdict }[];

/** The verdict on `request`, from a webview that has loaded. */
async function verdictOn(request: CheckRequest): Promise<Verdict> {
  stop ??= startSurfaces();
  await settle();
  emitEvent("surface-check", request);
  await until(() => verdicts().some((v) => v.call === request.call), "no verdict was given");
  return verdicts().find((v) => v.call === request.call)!.verdict;
}

test("a check the webview missed while it loaded is answered, after it listens and reads the list", async () => {
  checks = [check(7)];
  stop = startSurfaces();
  await until(() => verdicts().length > 0, "no verdict was given");

  assert.deepEqual(
    calls.map((c) => c.cmd),
    ["surface_list", "surface_checks", "surface_verdict"],
  );
  assert.equal(verdicts()[0].call, 7);
  assert.ok("state" in verdicts()[0].verdict, "accepted");
});

test("a check is answered with the surface's state, as one createSurface under Quay's catalog", async () => {
  const verdict = await verdictOn(check(1));
  assert.ok("state" in verdict, JSON.stringify(verdict));
  assert.deepEqual({ asks: verdict.asks, images: verdict.images, components: verdict.components }, { asks: true, images: 0, components: 6 });
  assert.equal(verdict.state.version, "1.0");
  assert.equal(verdict.state.createSurface.surfaceId, "ask_1");
  assert.equal(verdict.state.createSurface.catalogId, "urn:quay:a2ui:catalog:v1");
  assert.equal(called("surface_answer").length, 0, "a check applies nothing");
});

test("what comes while the list is read is not missed", async () => {
  fakeInvoke(async (cmd, args) => {
    calls.push({ cmd, args });
    if (cmd !== "surface_list") return cmd === "surface_checks" ? [] : null;
    emitEvent("surface-check", check(3));
    return [];
  });
  // Tauri takes a moment to register a listener
  const internals = (window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string, args: object) => Promise<unknown> } }).__TAURI_INTERNALS__;
  const { invoke } = internals;
  internals.invoke = async (cmd, args) => {
    if (cmd === "plugin:event|listen") await new Promise((resolve) => setTimeout(resolve, 10));
    return invoke(cmd, args);
  };
  try {
    stop = startSurfaces();
    await until(() => verdicts().length > 0, "the check was missed");
  } finally {
    internals.invoke = invoke;
  }
  assert.equal(verdicts()[0].call, 3);
});

test("what the engine refuses is the verdict, as its own error mapping words it", async () => {
  const verdict = await verdictOn(check(1, { questions: [{ question: "Which?", options: [{ label: 5, recommended: false }] }] }));
  assert.ok("errors" in verdict);
  assert.deepEqual(
    verdict.errors.map(({ code }) => code),
    ["VALIDATION_FAILED"],
  );
  assert.equal(verdict.errors[0].path, "/components/2", "the ChoicePicker");
  assert.notEqual(verdict.errors[0].message, "");
});

test("a call of the wrong shape, or of a tool Quay does not have, gets a verdict too", async () => {
  for (const [call, request] of [check(1, null), check(2, { questions: 3 }), { ...check(3), tool: "quay_dance" }].entries()) {
    const verdict = await verdictOn(request);
    assert.ok("errors" in verdict && verdict.errors.length === 1, `case ${call}`);
  }
});

/** The surface `id` of `terminal`, as Rust holds it once the webview has accepted `ask`. */
async function accepted(id: string, { ask = ASK as unknown, terminal = "t1", order = 1 } = {}): Promise<SurfaceRecord> {
  const verdict = await verdictOn({ ...check(order, ask), surface_id: id });
  assert.ok("state" in verdict, JSON.stringify(verdict));
  return askRecord(verdict.state, { id, terminal, order });
}

/** Loads the page: what Rust holds is read, and the companion drawn on `terminal`'s Surface view, if it has one. */
async function open(terminal: TerminalInfo = TERMINAL): Promise<HTMLElement> {
  stop?.();
  stop = startSurfaces();
  mounted = await mountCompanion(terminal);
  const { container } = mounted;
  await act(async () => viewEntry(container, "Surface")?.click());
  await until(() => !container.textContent?.includes("Loading"), "the surface was never drawn");
  return container;
}

const regions = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>("section[data-surface]")];
const radios = (container: HTMLElement) => [...container.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
const button = (container: HTMLElement, name: string) => findButton(container, name)!;
/** The text of what `element`'s aria-describedby names. */
const description = (element: Element) =>
  (element.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean).map((id) => document.getElementById(id)?.textContent);

const REBASE = { answers: [{ question: "Which base should this branch take?", chosen: ["Rebase onto master"], text: "skip the suite" }] };

test("a question is drawn in the Surface view, in a frame that says who asks, with nothing selected", async () => {
  list = [await accepted("ask_1")];
  const container = await open();

  const [region, ...others] = regions(container);
  assert.equal(others.length, 0);
  assert.equal(region.getAttribute("aria-label"), "Question from fix-75");
  const header = region.querySelector("header")!;
  assert.equal(header.textContent, "fix-75Claude Code");
  assert.equal(header.querySelectorAll("svg").length, 2, "the kind's icon and the CLI's");

  assert.ok(region.textContent?.includes("Which base should this branch take?"));
  assert.deepEqual(
    radios(region).map((radio) => [radio.labels?.[0]?.textContent, radio.checked, description(radio)]),
    [
      ["Rebase onto master", false, ["agent's pick", "Two conflicts"]],
      ["Merge master in", false, []],
    ],
  );
  assert.equal(region.querySelector("fieldset legend")?.textContent, "Which base should this branch take?");
  const box = region.querySelector("textarea")!;
  assert.equal(box.labels?.[0]?.textContent, "Other, or a note");
  assert.equal(box.value, "");
  assert.ok(button(region, "Send").disabled);
  assert.ok(!region.textContent?.includes("QUAY") && !region.querySelector("[data-neon]"), "no surface carries the Quay mark");
});

test("content cannot draw outside the frame", async () => {
  list = [await accepted("ask_1")];
  const container = await open();
  const region = regions(container)[0];
  const content = region.querySelector<HTMLElement>("[data-surface-content]")!;
  // Paint containment clips what overflows and holds fixed and absolute elements inside.
  for (const name of ["contain-paint", "overflow-clip", "relative", "isolate"]) assert.ok(content.className.split(" ").includes(name), name);
  assert.ok(content.contains(button(region, "Send")));
  assert.ok(!content.contains(region.querySelector("header")));
});

test("an option and a note are sent once, as the call's result, and only when the question is answered", async () => {
  list = [await accepted("ask_1")];
  const container = await open();
  const send = button(container, "Send");
  let taken = () => {};
  onAnswer = () => new Promise((resolve) => (taken = resolve));

  await act(async () => send.click());
  assert.equal(called("surface_answer").length, 0, "nothing is answered yet");
  await type(container.querySelector("textarea")!, "  ");
  assert.ok(send.disabled, "spaces are no answer");
  await act(async () => radios(container)[0].click());
  await type(container.querySelector("textarea")!, "skip the suite");
  assert.ok(!send.disabled);

  await act(async () => {
    send.click();
    send.click();
  });
  await settle();
  await act(async () => send.click());
  assert.deepEqual(called("surface_answer"), [{ terminalId: "t1", id: "ask_1", revision: 1, answer: REBASE }]);
  assert.ok(send.disabled, "held until the first click is answered");
  await act(async () => taken());
});

test("a note alone answers, and a choice alone is sent without a text", async () => {
  list = [await accepted("ask_1"), await accepted("ask_2", { order: 2 })];
  const container = await open();
  const [first, second] = regions(container);

  await type(first.querySelector("textarea")!, "Neither: wait for CI");
  await act(async () => button(first, "Send").click());
  await act(async () => radios(second)[1].click());
  await act(async () => button(second, "Send").click());
  await settle();

  const question = "Which base should this branch take?";
  assert.deepEqual(
    called("surface_answer").map(({ id, answer }) => [id, answer]),
    [
      ["ask_1", { answers: [{ question, chosen: [], text: "Neither: wait for CI" }] }],
      ["ask_2", { answers: [{ question, chosen: ["Merge master in"] }] }],
    ],
  );
});

test("everything that answers is a native control the keyboard reaches, in reading order", async () => {
  list = [await accepted("ask_1")];
  const container = await open();
  await act(async () => radios(container)[0].click());
  const region = regions(container)[0];

  const controls = [...region.querySelectorAll<HTMLElement>("input, textarea, button, [tabindex], a")];
  assert.deepEqual(
    controls.map((control) => control.tagName),
    ["INPUT", "INPUT", "TEXTAREA", "BUTTON"],
  );
  assert.ok(controls.every((control) => !control.hasAttribute("tabindex") && !control.matches(":disabled")));
  const [first, second] = radios(region);
  assert.ok(first.name !== "" && first.name === second.name, "the arrow keys move between the options");
});

test("an answer that is not taken says why, and can be sent again", async () => {
  list = [await accepted("ask_1")];
  onAnswer = () => Promise.reject("Not sent: the agent's call has ended, so the answer would not reach it.");
  const container = await open();
  await act(async () => radios(container)[0].click());
  await act(async () => button(container, "Send").click());
  await settle();

  const alert = regions(container)[0].querySelector('[role="alert"]');
  assert.equal(alert?.textContent, "Not sent: the agent's call has ended, so the answer would not reach it.");
  assert.ok(radios(container)[0].checked, "what was picked is kept");
  onAnswer = async () => {};
  await act(async () => button(container, "Send").click());
  await settle();
  assert.equal(called("surface_answer").length, 2);
  assert.equal(regions(container)[0].querySelector('[role="alert"]'), null);
});

test("an answered question is locked with its answer, and an older record does not open it again", async () => {
  const asked = await accepted("ask_1");
  list = [asked];
  const container = await open();

  await act(async () => emitEvent("surface-changed", { ...asked, change: 2, answer: REBASE }));
  await act(async () => emitEvent("surface-changed", asked));
  await settle();
  // The companion went back to its earlier view
  await act(async () => viewEntry(container, "Surface")!.click());
  const region = regions(container)[0];
  assert.equal(region.querySelector('[role="status"]')?.textContent, "Answered and sent to the agent.");
  for (const text of ["Which base should this branch take?", "Rebase onto master", "skip the suite"]) assert.ok(region.textContent?.includes(text), text);
  assert.equal(region.querySelectorAll("input, textarea, button").length, 0);
});

test("a surface Quay no longer has leaves the screen", async () => {
  list = [await accepted("ask_1"), await accepted("ask_2", { order: 2 })];
  const container = await open();
  await act(async () => emitEvent("surface-removed", { terminal_id: "t2", id: "ask_2" }));
  await act(async () => emitEvent("surface-removed", { terminal_id: "t1", id: "ask_1" }));
  assert.deepEqual(
    regions(container).map((region) => region.dataset.surface),
    ["ask_2"],
  );
});

test("a surface that left while the list was read is not drawn", async () => {
  const asked = [await accepted("ask_1"), await accepted("ask_2", { order: 2 })];
  fakeInvoke(async (cmd) => {
    if (cmd !== "surface_list") return cmd === "surface_checks" ? [] : null;
    emitEvent("surface-removed", { terminal_id: "t1", id: "ask_1" });
    return asked;
  });
  const container = await open();
  assert.deepEqual(
    regions(container).map((region) => region.dataset.surface),
    ["ask_2"],
  );
});

test("an action Quay has no way to send is refused in words", async () => {
  const asked = await accepted("ask_1");
  // What holds Send is the ask's own look, so nothing holds it here
  for (const component of asked.state.createSurface.components) delete component["@checks"];
  list = [{ ...asked, tool: "quay_dance" }];
  const container = await open();
  await act(async () => button(container, "Send").click());
  await settle();

  assert.equal(regions(container)[0].querySelector('[role="alert"]')?.textContent, "Not sent: Quay cannot send an answer to this kind of surface.");
  assert.equal(called("surface_answer").length, 0);
});

test("a reload draws the question again", async () => {
  const asked = await accepted("ask_1");
  list = [asked];
  await open();
  assert.equal(regions(mounted!.container).length, 1);
  // The page goes, and a new one reads the list
  await act(async () => mounted!.root.unmount());
  mounted!.container.remove();
  list = [structuredClone(asked)];

  const container = await open();
  assert.equal(regions(container).length, 1);
  assert.equal(radios(container).length, 2);
});

test("what was typed is kept while the question is off screen", async () => {
  list = [await accepted("ask_1")];
  const container = await open();
  await act(async () => radios(container)[1].click());
  await type(container.querySelector("textarea")!, "half a thought");

  await act(async () => viewEntry(container, "Repository")!.click());
  assert.equal(regions(container).length, 0);
  await act(async () => viewEntry(container, "Surface")!.click());
  await settle();
  assert.deepEqual(
    radios(container).map((radio) => radio.checked),
    [false, true],
  );
  assert.equal(container.querySelector("textarea")!.value, "half a thought");
  assert.ok(!button(container, "Send").disabled);
});

test("a terminal shows its own surfaces, and no Surface view without one", async () => {
  list = [await accepted("ask_1", { terminal: "t2" })];
  const container = await open();
  assert.equal(viewEntry(container, "Surface"), undefined);
  await act(async () => mounted!.root.render(companion({ ...TERMINAL, id: "t2", name: "other" })));
  assert.ok(viewEntry(container, "Surface"));
});

test("what an agent writes is shown as it is written, and loads nothing", async () => {
  const hostile = '<img src="https://a.example/x.png" onerror="alert(1)"> **bold** ![i](https://a.example/i.png) ${openUrl("x")}';
  const ask = { questions: [{ question: hostile, options: [{ label: "<b>Yes</b>", description: "[no](javascript:alert(1))", recommended: false }, { label: "__proto__", recommended: false }] }] };
  list = [await accepted("ask_1", { ask })];
  const container = await open();
  const region = regions(container)[0];

  for (const text of [hostile, "<b>Yes</b>", "[no](javascript:alert(1))", "__proto__"]) assert.ok(region.textContent?.includes(text), text);
  assert.equal(region.querySelectorAll("img, a, b, script, iframe, [onerror]").length, 0);
  await act(async () => radios(region)[1].click());
  await act(async () => button(region, "Send").click());
  await settle();
  assert.deepEqual(called("surface_answer")[0].answer, { answers: [{ question: hostile, chosen: ["__proto__"] }] });
});

test("a surface that cannot be drawn says so in its frame and leaves the others", async () => {
  const good = await accepted("ask_2", { order: 2 });
  const bad = await accepted("ask_1");
  bad.state.createSurface.components = [];
  list = [bad, good];
  const logged: unknown[] = [];
  const { error } = console;
  console.error = (...args) => void logged.push(args);
  try {
    const container = await open();
    const [first, second] = regions(container);
    assert.equal(first.querySelector('[role="alert"]')?.textContent, "Quay could not draw this.");
    assert.ok(first.querySelector("header")?.textContent?.includes("fix-75"));
    assert.equal(radios(second).length, 2);
  } finally {
    console.error = error;
  }
  assert.ok(logged.length > 0, "why is in the console");
});
