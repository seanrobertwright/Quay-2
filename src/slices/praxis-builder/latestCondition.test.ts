/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { createLatestCondition } from "./latestCondition.ts";

test("a read answered after a newer one is dropped", () => {
  const latest = createLatestCondition();
  latest.project("E:/work/app");
  const first = latest.beginRead();
  const second = latest.beginRead();
  assert.equal(latest.readDone(second, { state: "hostUnreachable" }), true);
  assert.equal(latest.readDone(first, { state: "signedIn" }), false);
  assert.deepEqual(latest.current(), { state: "hostUnreachable" });
});

test("a change event for the project wins over a read that was asked before it", () => {
  const latest = createLatestCondition();
  latest.project("E:/work/app");
  const read = latest.beginRead();
  assert.equal(latest.changed({ projectPath: "E:\\work\\app", condition: { state: "notSignedIn" } }), true);
  assert.equal(latest.readDone(read, { state: "signedIn" }), false);
  assert.deepEqual(latest.current(), { state: "notSignedIn" });
});

test("another project's change, or a read from before a project switch, is ignored", () => {
  const latest = createLatestCondition();
  latest.project("E:/work/app");
  const read = latest.beginRead();
  latest.project("E:/work/other");
  assert.deepEqual(latest.current(), { state: "notCheckedYet" });
  assert.equal(latest.readDone(read, { state: "signedIn" }), false);
  assert.equal(latest.changed({ projectPath: "E:\\work\\app", condition: { state: "signedIn" } }), false);
  assert.deepEqual(latest.current(), { state: "notCheckedYet" });
});
