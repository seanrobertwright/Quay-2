import { afterEach, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { createPoller } from "./poller.ts";

beforeEach(() => mock.timers.enable({ apis: ["setTimeout"] }));
afterEach(() => mock.timers.reset());

/** Lets the poller's promise callbacks run. */
const settle = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

test("starting reads at once, then again after the delay each read returns", async () => {
  const delays = [15_000, 60_000, 15_000];
  let reads = 0;
  const poller = createPoller(async () => delays[reads++] ?? null);
  poller.set(true);
  await settle();
  assert.equal(reads, 1);
  mock.timers.tick(14_999);
  await settle();
  assert.equal(reads, 1);
  mock.timers.tick(1);
  await settle();
  assert.equal(reads, 2);
  mock.timers.tick(59_999);
  await settle();
  assert.equal(reads, 2);
  mock.timers.tick(1);
  await settle();
  assert.equal(reads, 3);
  poller.stop();
});

test("a read that returns null ends the polling", async () => {
  let reads = 0;
  const poller = createPoller(async () => {
    reads += 1;
    return null;
  });
  poller.set(true);
  await settle();
  mock.timers.tick(600_000);
  await settle();
  assert.equal(reads, 1);
});

test("stopping aborts the read in flight and clears the timer", async () => {
  const signals: AbortSignal[] = [];
  let finish: () => void = () => {};
  const poller = createPoller((signal) => {
    signals.push(signal);
    return new Promise((resolve) => (finish = () => resolve(15_000)));
  });
  poller.set(true);
  await settle();
  poller.stop();
  assert.equal(signals[0].aborted, true);
  finish();
  await settle();
  mock.timers.tick(60_000);
  await settle();
  assert.equal(signals.length, 1);
});

test("a stop between reads leaves no timer behind", async () => {
  let reads = 0;
  const poller = createPoller(async () => {
    reads += 1;
    return 15_000;
  });
  poller.set(true);
  await settle();
  poller.stop();
  mock.timers.tick(60_000);
  await settle();
  assert.equal(reads, 1);
});

test("a read left over from before a restart schedules nothing; the restart reads at once", async () => {
  const finishes: (() => void)[] = [];
  const poller = createPoller(() => new Promise((resolve) => finishes.push(() => resolve(15_000))));
  poller.set(true);
  await settle();
  poller.set(false);
  poller.set(true);
  await settle();
  assert.equal(finishes.length, 2);
  finishes[0]();
  finishes[1]();
  await settle();
  mock.timers.tick(15_000);
  await settle();
  assert.equal(finishes.length, 3, "only the restart's read schedules the next");
  poller.stop();
});

test("a rejected read keeps polling at the delay of the last good read", async () => {
  let reads = 0;
  const poller = createPoller(async () => {
    reads += 1;
    if (reads === 2) throw new Error("boom");
    return 15_000;
  });
  poller.set(true);
  await settle();
  mock.timers.tick(15_000);
  await settle();
  assert.equal(reads, 2);
  mock.timers.tick(15_000);
  await settle();
  assert.equal(reads, 3);
  poller.stop();
});

test("asking for a read now replaces the wait", async () => {
  let reads = 0;
  const poller = createPoller(async () => {
    reads += 1;
    return 15_000;
  });
  poller.set(true);
  await settle();
  poller.now();
  await settle();
  assert.equal(reads, 2);
  mock.timers.tick(14_999);
  await settle();
  assert.equal(reads, 2, "the wait restarts from the read now");
  mock.timers.tick(1);
  await settle();
  assert.equal(reads, 3);
  poller.stop();
});
