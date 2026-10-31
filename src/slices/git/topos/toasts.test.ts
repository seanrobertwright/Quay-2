/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { dismissToast, MAX_TOASTS, pushToast, type Toast } from "./toasts.ts";

const toast = (id: number, text = `toast ${id}`): Toast => ({ id, tone: "done", text });

test("the queue keeps the newest toasts, dropping the oldest past the bound", () => {
  let queue: Toast[] = [];
  for (let id = 1; id <= 7; id++) queue = pushToast(queue, toast(id));
  assert.equal(MAX_TOASTS, 4);
  assert.deepEqual(
    queue.map((t) => t.id),
    [4, 5, 6, 7]
  );
});

test("dismissing a toast removes only that one, and an unknown id changes nothing", () => {
  const queue = [toast(1), toast(2), toast(3)];
  assert.deepEqual(
    dismissToast(queue, 2).map((t) => t.id),
    [1, 3]
  );
  assert.equal(dismissToast(queue, 9), queue);
});
