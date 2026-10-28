// The check suite: tests the agents never saw, each named for the SPEC.md rule it checks. Unzip
// it into the project so check/ sits beside src/.
import { afterEach, expect, it, vi } from "vitest";
import { retry } from "../src/retry.ts";

afterEach(() => {
  vi.useRealTimers();
});

it("rule 1: attempts 3 calls fn exactly three times", async () => {
  const fn = vi.fn(async () => {
    throw new Error("down");
  });
  await expect(retry(fn, { attempts: 3 })).rejects.toThrow("down");
  expect(fn).toHaveBeenCalledTimes(3);
});

it("rule 2: an error with retryable false is thrown after one call", async () => {
  const error = Object.assign(new Error("bad request"), { retryable: false });
  const fn = vi.fn(async () => {
    throw error;
  });
  await expect(retry(fn, { attempts: 3 })).rejects.toBe(error);
  expect(fn).toHaveBeenCalledTimes(1);
});

it("rule 4: no delay is waited after the last failed attempt", async () => {
  vi.useFakeTimers();
  const fn = vi.fn(async () => {
    throw new Error("down");
  });
  let settled = false;
  const result = retry(fn, { attempts: 3, delayMs: 200 }).catch((error: unknown) => {
    settled = true;
    return error;
  });
  // Two retries wait 200 ms and 400 ms; nothing may wait after the third call fails.
  await vi.advanceTimersByTimeAsync(600);
  expect(settled).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
  await result;
});
