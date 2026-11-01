/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { createModalLayer } from "./modalLayer.ts";

/** The rest of Topos as the layer sees it, recording what happens to it in order. */
function fakeContent(log: string[]) {
  return { setInert: (on: boolean) => log.push(on ? "inert" : "live") };
}

function fakeOpener(log: string[], connected = true) {
  return { isConnected: connected, focus: () => log.push("focus opener") };
}

test("opening a confirm makes the rest of Topos inert until it closes", () => {
  const log: string[] = [];
  const layer = createModalLayer(fakeContent(log));
  const close = layer.open(null);
  assert.deepEqual(log, ["inert"]);
  assert.equal(layer.isOpen(), true);
  close();
  assert.deepEqual(log, ["inert", "live"]);
  assert.equal(layer.isOpen(), false);
});

test("on close focus goes back to the control that opened it, after the rest of Topos is live again", () => {
  const log: string[] = [];
  const layer = createModalLayer(fakeContent(log));
  const close = layer.open(fakeOpener(log));
  close();
  // An inert control can't take focus, so the order matters.
  assert.deepEqual(log, ["inert", "live", "focus opener"]);
});

test("an opener that has gone since is left alone", () => {
  const log: string[] = [];
  const layer = createModalLayer(fakeContent(log));
  layer.open(fakeOpener(log, false))();
  assert.deepEqual(log, ["inert", "live"]);
});

test("with two confirms open, Topos stays inert until both close", () => {
  const log: string[] = [];
  const layer = createModalLayer(fakeContent(log));
  const first = layer.open(null);
  const second = layer.open(null);
  first();
  assert.deepEqual(log, ["inert"]);
  second();
  assert.deepEqual(log, ["inert", "live"]);
});

test("closing the same confirm twice counts once", () => {
  const log: string[] = [];
  const layer = createModalLayer(fakeContent(log));
  const first = layer.open(null);
  const second = layer.open(null);
  first();
  first();
  assert.equal(layer.isOpen(), true);
  second();
  assert.equal(layer.isOpen(), false);
});
