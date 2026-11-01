/// <reference types="node" />
import { afterEach, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { createHostRecheck } from "./hostRecheck.ts";

beforeEach(() => mock.timers.enable({ apis: ["setTimeout"] }));
afterEach(() => mock.timers.reset());

/** Lets a settled check's follow-up run; setImmediate isn't mocked. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test("while active it checks every 60 s, and never before the first 60 s", async () => {
  let checks = 0;
  const recheck = createHostRecheck(async () => {
    checks += 1;
  });
  recheck.set(true);
  mock.timers.tick(59_999);
  await settle();
  assert.equal(checks, 0);
  mock.timers.tick(1);
  await settle();
  assert.equal(checks, 1);
  mock.timers.tick(60_000);
  await settle();
  assert.equal(checks, 2);
  recheck.stop();
});

test("stopping clears the timer, so no check runs after it", async () => {
  let checks = 0;
  const recheck = createHostRecheck(async () => {
    checks += 1;
  });
  recheck.set(true);
  mock.timers.tick(30_000);
  recheck.set(false);
  mock.timers.tick(10 * 60_000);
  await settle();
  assert.equal(checks, 0);
});

test("stopping while a check runs aborts it and schedules no other", async () => {
  const signals: AbortSignal[] = [];
  let finish = () => {};
  const recheck = createHostRecheck(
    (signal) =>
      new Promise<void>((resolve) => {
        signals.push(signal);
        finish = resolve;
      }),
  );
  recheck.set(true);
  mock.timers.tick(60_000);
  await settle();
  assert.equal(signals.length, 1);
  recheck.stop();
  assert.equal(signals[0].aborted, true);
  finish();
  await settle();
  mock.timers.tick(10 * 60_000);
  await settle();
  assert.equal(signals.length, 1);
});

test("restarting while a stopped check is still running keeps one 60 s cycle", async () => {
  let checks = 0;
  let finish = () => {};
  const recheck = createHostRecheck(
    () =>
      new Promise<void>((resolve) => {
        checks += 1;
        finish = resolve;
      }),
  );
  recheck.set(true);
  mock.timers.tick(60_000);
  await settle();
  recheck.set(false);
  recheck.set(true);
  finish();
  await settle();
  mock.timers.tick(60_000);
  await settle();
  assert.equal(checks, 2);
  finish();
  await settle();
  mock.timers.tick(60_000);
  await settle();
  assert.equal(checks, 3);
  recheck.stop();
});
