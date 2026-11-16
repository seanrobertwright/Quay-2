/// <reference types="node" />
// The pie menu host: one set of document listeners that opens the pie where the surface's rules
// say, at the pointer, and reports the stroke chosen with what it acts on. Real DOM events in
// happy-dom; a press's default being prevented is what keeps WebView2's middle-click auto-scroll
// and native menu away, and propagation stopping is what keeps the press from the surface below.
import "../../test-support/dom.ts";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PieAction, PieTarget } from "./pieRing.ts";
import type { PieStrokeRecord } from "./pieStrokeLog.ts";

const { PieMenuHost } = await import("./PieMenuHost.tsx");

let mounted: { root: Root; container: HTMLElement } | null = null;
afterEach(() => {
  if (mounted) {
    act(() => mounted?.root.unmount());
    mounted.container.remove();
    mounted = null;
  }
  document.body.innerHTML = "";
});

const PAGE = `
  <section data-pie-surface="pie" data-pie-target="companion"><p class="companion">PR</p><input class="field"></section>
  <div data-pie-terminal="t1" data-pie-zoomable><div class="xterm"><div class="screen"></div></div></div>
  <div data-pie-terminal="t2"><div class="xterm enable-mouse-events"><div class="reporting"></div></div></div>
  <nav data-pie-target="panel"><div data-pie-surface="list" data-pie-row data-pie-folder="C:\\repo"><span class="row">repo</span></div></nav>`;

async function mount(delayMs = 0) {
  const chosen: [PieAction, PieTarget][] = [];
  document.body.innerHTML = PAGE;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted = { root, container };
  await act(async () =>
    root.render(
      createElement(PieMenuHost, {
        palette: "cyber",
        labelOutline: true,
        displayDelayMs: delayMs,
        onChoose: (action: PieAction, target: PieTarget) => chosen.push([action, target]),
      })
    )
  );
  return chosen;
}

const el = (selector: string) => document.querySelector(selector)!;
const pie = () => document.querySelector('svg[role="menu"]');

/** Fires `type` on `target` at `x`, `y`; says whether its default was prevented. */
async function fire(target: Element, type: string, init: MouseEventInit = {}): Promise<{ prevented: boolean; reached: boolean }> {
  let reached = false;
  const listener = () => (reached = true);
  target.addEventListener(type, listener);
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 400, clientY: 300, ...init });
  await act(async () => void target.dispatchEvent(e));
  target.removeEventListener(type, listener);
  return { prevented: e.defaultPrevented, reached };
}

test("middle-click on the companion opens the pie at once with no delay, and its default is prevented so auto-scroll never starts", async () => {
  await mount(0);
  const down = await fire(el(".companion"), "mousedown", { button: 1 });
  assert.equal(down.prevented, true);
  assert.equal(down.reached, false, "the press stops at the pie");
  assert.ok(pie(), "the pie is drawn");
  assert.equal((await fire(el(".companion"), "auxclick", { button: 1 })).prevented, true);
});

test("hold, drag and release runs the stroke on what the pie opened over", async () => {
  const chosen = await mount(0);
  await fire(el(".row"), "mousedown", { button: 1 });
  await fire(document.body, "mousemove", { button: 1, clientX: 340, clientY: 240 });
  await fire(document.body, "mouseup", { button: 1, clientX: 340, clientY: 240 });
  assert.deepEqual(chosen, [["open-folder", { surface: "panel", row: { kind: "folder", folder: "C:\\repo" } }]]);
  assert.equal(pie(), null, "the pie closes");
});

test("with a display delay the pie draws only once the delay passes, and a stroke released before then still runs", async () => {
  const chosen = await mount(40);
  await fire(el(".companion"), "mousedown", { button: 2 });
  assert.equal(pie(), null, "not drawn yet");
  await act(() => new Promise((done) => setTimeout(done, 80)));
  assert.ok(pie(), "drawn after the delay");
  await fire(document.body, "mouseup", { button: 2, clientX: 400, clientY: 360 });
  const menu = await fire(el(".companion"), "contextmenu", { button: 2 });
  assert.equal(menu.prevented, true, "no native or list menu after the stroke");
  assert.equal(menu.reached, false);
  assert.deepEqual(chosen, [["palette", { surface: "companion" }]]);

  await fire(el(".companion"), "mousedown", { button: 1 });
  await fire(document.body, "mouseup", { button: 1, clientX: 400, clientY: 240 });
  assert.deepEqual(chosen[chosen.length - 1], ["next-wait", { surface: "companion" }]);
});

test("a plain click leaves the pie open; a letter then chooses, and Escape closes", async () => {
  const chosen = await mount(150);
  await fire(el(".screen"), "mousedown", { button: 1 });
  await fire(document.body, "mouseup", { button: 1 });
  assert.ok(pie(), "open to read, drawn at once");
  const key = new KeyboardEvent("keydown", { key: "z", bubbles: true, cancelable: true });
  await act(async () => void document.body.dispatchEvent(key));
  assert.equal(key.defaultPrevented, true);
  assert.deepEqual(chosen, [["zoom", { surface: "terminal", terminalId: "t1", zoomable: true }]]);

  await fire(el(".screen"), "mousedown", { button: 1 });
  await fire(document.body, "mouseup", { button: 1 });
  await act(async () => void document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  assert.equal(pie(), null);
  assert.equal(chosen.length, 1);
});

test("an open pie takes the next left click: on a wedge it chooses, and the click goes no further", async () => {
  const chosen = await mount(0);
  await fire(el(".screen"), "mousedown", { button: 1 });
  await fire(document.body, "mouseup", { button: 1 });
  const click = await fire(el(".screen"), "mousedown", { button: 0, clientX: 300, clientY: 300 });
  assert.equal(click.reached, false);
  assert.deepEqual(chosen, [["new-term", { surface: "terminal", terminalId: "t1", zoomable: true }]]);
});

test("terminal right-click, Shift+right-click and text fields are left alone", async () => {
  await mount(0);
  for (const [selector, init] of [
    [".screen", { button: 2 }],
    [".companion", { button: 2, shiftKey: true }],
    [".field", { button: 2 }],
    [".field", { button: 1 }],
  ] as const) {
    const down = await fire(el(selector), "mousedown", init);
    assert.deepEqual(down, { prevented: false, reached: true }, `${selector} ${JSON.stringify(init)}`);
    const menu = await fire(el(selector), "contextmenu", init);
    assert.equal(menu.reached, true);
    assert.equal(pie(), null);
  }
});

test("with mouse reporting on, middle-click is the program's and Shift+Middle-click or Alt+Right-click open the pie", async () => {
  await mount(0);
  assert.deepEqual(await fire(el(".reporting"), "mousedown", { button: 1 }), { prevented: false, reached: true });
  assert.equal(pie(), null);
  await fire(document.body, "mouseup", { button: 1 });
  assert.equal((await fire(el(".reporting"), "mousedown", { button: 1, shiftKey: true })).reached, false);
  assert.ok(pie());
  await act(async () => void document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  assert.equal((await fire(el(".reporting"), "mousedown", { button: 2, altKey: true })).reached, false);
  assert.ok(pie());
});

test("near a window edge the pie draws moved in, but strokes still count from where the button went down", async () => {
  const chosen = await mount(0);
  await fire(el(".row"), "mousedown", { button: 1, clientX: 10, clientY: 300 });
  await fire(document.body, "mouseup", { button: 1, clientX: 10, clientY: 300 });
  assert.ok(pie(), "a plain click by the edge leaves the pie open to read");
  assert.deepEqual(chosen, []);
  await act(async () => void document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));

  await fire(el(".row"), "mousedown", { button: 1, clientX: 10, clientY: 300 });
  await fire(document.body, "mousemove", { button: 1, clientX: 10, clientY: 240 });
  await fire(document.body, "mouseup", { button: 1, clientX: 10, clientY: 240 });
  assert.equal(chosen.length, 1);
  assert.equal(chosen[0][0], "next-wait", "a stroke straight up from the press is N");
});

// The second ring through the host: past 132 px a stroke runs the locked parent's slice, Palette's
// slices run the recent palette commands, and each stroke is handed on for the stroke log.
async function mountWith(recent: { id: string; title: string }[]) {
  const chosen: [PieAction, PieTarget, string | undefined][] = [];
  const strokes: PieStrokeRecord[] = [];
  document.body.innerHTML = PAGE;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted = { root, container };
  await act(async () =>
    root.render(
      createElement(PieMenuHost, {
        palette: "cyber",
        labelOutline: true,
        displayDelayMs: 0,
        recentCommands: recent,
        onChoose: (action: PieAction, target: PieTarget, commandId?: string) => chosen.push([action, target, commandId]),
        onStroke: (record: PieStrokeRecord) => strokes.push(record),
      })
    )
  );
  return { chosen, strokes };
}

test("a stroke past the second ring's start runs a slice: Split's Grid, Palette's recent command, New term's Claude", async () => {
  const { chosen, strokes } = await mountWith([{ id: "layout-grid", title: "2x2 Quad Grid Layout" }]);
  const drag = async (x: number, y: number) => {
    await fire(el(".companion"), "mousedown", { button: 1 });
    await fire(document.body, "mousemove", { button: 1, clientX: x, clientY: y });
    await fire(document.body, "mouseup", { button: 1, clientX: x, clientY: y });
  };
  // 150 px out at 110°: SE's wedge, but 20° from E, so Split's last slice.
  await drag(400 + 150 * Math.sin((110 * Math.PI) / 180), 300 - 150 * Math.cos((110 * Math.PI) / 180));
  // 150 px out at 160°: Palette's first slice, the most recent palette command.
  await drag(400 + 150 * Math.sin((160 * Math.PI) / 180), 300 - 150 * Math.cos((160 * Math.PI) / 180));
  await drag(250, 300); // New term's middle slice is Codex; 150 px straight left
  await drag(400, 200); // short of the second ring: Next wait itself
  assert.deepEqual(
    chosen.map(([action, , id]) => [action, id]),
    [
      ["split-grid", undefined],
      ["palette-command", "layout-grid"],
      ["new-codex", undefined],
      ["next-wait", undefined],
    ]
  );
  assert.deepEqual(
    strokes.map((s) => [s.wedge, s.slice, s.distancePx]),
    [
      ["E", 2, 150],
      ["S", 0, 150],
      ["W", 1, 150],
      ["N", null, 100],
    ]
  );
});
