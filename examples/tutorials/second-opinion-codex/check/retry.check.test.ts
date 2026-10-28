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

it("rules 3 and 4: retries wait 200 then 400 ms, and nothing after the last failure", async () => {
  vi.useFakeTimers();
  const fn = vi.fn(async () => {
    throw new Error("down");
  });
  let settled = false;
  const result = retry(fn, { attempts: 3, delayMs: 200 }).catch((error: unknown) => {
    settled = true;
    return error;
  });
  await vi.advanceTimersByTimeAsync(199);
  expect(fn).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(fn).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(399);
  expect(fn).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(fn).toHaveBeenCalledTimes(3);
  expect(settled).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
  await result;
});
