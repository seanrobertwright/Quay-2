import { test } from "node:test";
import assert from "node:assert/strict";
import { createNewestRequest } from "./newestRequest.ts";

test("only the newest request's answer is kept", () => {
  const requests = createNewestRequest();
  const first = requests.begin();
  const second = requests.begin();
  assert.equal(requests.isNewest(first), false);
  assert.equal(requests.isNewest(second), true);
});

test("dropping makes every request asked before it stale", () => {
  const requests = createNewestRequest();
  const asked = requests.begin();
  requests.drop();
  assert.equal(requests.isNewest(asked), false);
  assert.equal(requests.isNewest(requests.begin()), true);
});
