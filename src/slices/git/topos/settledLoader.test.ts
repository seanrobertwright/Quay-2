/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { SettledLoader, type LoadState, type Timers } from "./settledLoader.ts";

/** Timers that run only when the test advances them. */
function fakeTimers(): Timers & { advance: (ms: number) => void; pending: () => number } {
  let now = 0;
  let next = 1;
  const queue = new Map<number, { at: number; fn: () => void }>();
  return {
    set(fn, ms) {
      const id = next++;
      queue.set(id, { at: now + ms, fn });
      return id;
    },
    clear(id) {
      queue.delete(id as number);
    },
    advance(ms) {
      now += ms;
      for (const [id, t] of [...queue].sort((a, b) => a[1].at - b[1].at)) {
        if (t.at > now) continue;
        queue.delete(id);
        t.fn();
      }
    },
    pending: () => queue.size,
  };
}

/** A fetch whose answers the test resolves by key, recording each key asked for. */
function fakeFetch() {
  const asked: string[] = [];
  const waiting = new Map<string, { resolve: (v: string) => void; reject: (e: unknown) => void }[]>();
  return {
    asked,
    fetch: (key: string) =>
      new Promise<string>((resolve, reject) => {
        asked.push(key);
        waiting.set(key, [...(waiting.get(key) ?? []), { resolve, reject }]);
      }),
    answer(key: string, value = `details of ${key}`) {
      for (const w of waiting.get(key) ?? []) w.resolve(value);
      waiting.delete(key);
    },
    fail(key: string, error: unknown) {
      for (const w of waiting.get(key) ?? []) w.reject(error);
      waiting.delete(key);
    },
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

function setup() {
  const timers = fakeTimers();
  const remote = fakeFetch();
  const states: LoadState<string>[] = [];
  const loader = new SettledLoader<string>({ fetch: remote.fetch, delayMs: 120, capacity: 200, timers, onState: (s) => states.push(s) });
  const last = () => states[states.length - 1];
  return { timers, remote, loader, last };
}

test("details load only once the selection has settled for the delay", async () => {
  const { timers, remote, loader, last } = setup();
  loader.select("a");
  timers.advance(119);
  assert.deepEqual(remote.asked, [], "nothing is read before 120 ms");
  loader.select("b");
  timers.advance(119);
  assert.deepEqual(remote.asked, [], "a new selection restarts the wait");
  timers.advance(1);
  assert.deepEqual(remote.asked, ["b"], "only the settled selection is read");
  remote.answer("b");
  await flush();
  assert.deepEqual(last(), { key: "b", shown: "details of b", shownKey: "b", pending: false, error: null });
});

test("the previous commit stays shown, marked pending, until the new one arrives", async () => {
  const { timers, remote, loader, last } = setup();
  loader.select("a");
  timers.advance(120);
  remote.answer("a");
  await flush();
  loader.select("b");
  assert.deepEqual(last(), { key: "b", shown: "details of a", shownKey: "a", pending: true, error: null });
  timers.advance(120);
  remote.answer("b");
  await flush();
  assert.deepEqual(last(), { key: "b", shown: "details of b", shownKey: "b", pending: false, error: null });
});

test("a stale response is dropped when a newer request is out", async () => {
  const { timers, remote, loader, last } = setup();
  loader.select("a");
  timers.advance(120);
  loader.select("b");
  timers.advance(120);
  assert.deepEqual(remote.asked, ["a", "b"]);
  remote.answer("b");
  await flush();
  remote.answer("a");
  await flush();
  assert.equal(last().shown, "details of b", "a's late answer doesn't replace b's");
  assert.equal(last().key, "b");
});

test("a cached commit shows at once without a read", async () => {
  const { timers, remote, loader, last } = setup();
  loader.select("a");
  timers.advance(120);
  remote.answer("a");
  await flush();
  loader.select("b");
  timers.advance(120);
  remote.answer("b");
  await flush();
  loader.select("a");
  assert.deepEqual(last(), { key: "a", shown: "details of a", shownKey: "a", pending: false, error: null });
  timers.advance(500);
  assert.deepEqual(remote.asked, ["a", "b"], "a came from the cache");
});

test("a failed read says why and keeps nothing pending", async () => {
  const { timers, remote, loader, last } = setup();
  loader.select("a");
  timers.advance(120);
  remote.fail("a", new Error("not a commit id"));
  await flush();
  assert.equal(last().pending, false);
  assert.match(last().error ?? "", /not a commit id/);
});

test("clearing the selection or disposing cancels the wait and drops answers", async () => {
  const { timers, remote, loader, last } = setup();
  loader.select("a");
  loader.select(null);
  timers.advance(500);
  assert.deepEqual(remote.asked, []);
  assert.deepEqual(last(), { key: null, shown: null, shownKey: null, pending: false, error: null });

  loader.select("b");
  timers.advance(120);
  loader.select("c");
  loader.dispose();
  assert.equal(timers.pending(), 0, "the timer is cleared");
  const count = remote.asked.length;
  remote.answer("b");
  await flush();
  timers.advance(500);
  assert.equal(remote.asked.length, count, "nothing is read after dispose");
  assert.equal(last().key, "c", "no state lands after dispose");
});
