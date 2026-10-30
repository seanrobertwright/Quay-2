/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { trapTabTarget } from "./focusTrap.ts";

const controls = ["first", "middle", "last"];

test("Tab from the last control wraps to the first, and Shift+Tab from the first to the last", () => {
  assert.equal(trapTabTarget(controls, "last", false), "first");
  assert.equal(trapTabTarget(controls, "first", true), "last");
});

test("Tab between inner controls is left to the browser", () => {
  assert.equal(trapTabTarget(controls, "first", false), null);
  assert.equal(trapTabTarget(controls, "middle", true), null);
});

test("focus outside the controls is pulled back to the near end", () => {
  assert.equal(trapTabTarget(controls, "elsewhere", false), "first");
  assert.equal(trapTabTarget(controls, "elsewhere", true), "last");
});

test("with no enabled controls the browser keeps Tab", () => {
  assert.equal(trapTabTarget([], "elsewhere", false), null);
});
