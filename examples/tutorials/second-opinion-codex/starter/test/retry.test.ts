import { afterEach, describe, expect, it, vi } from "vitest";
import { retry } from "../src/retry.ts";

afterEach(() => {
  vi.useRealTimers();
});

describe("retry", () => {
  it("returns the value when the first call succeeds", async () => {
    const fn = vi.fn(async () => "ok");
    await expect(retry(fn, { attempts: 3 })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries after one failure, then returns the value", async () => {
    let failed = false;
    const fn = vi.fn(async () => {
      if (!failed) {
        failed = true;
        throw new Error("flaky");
      }
      return "ok";
    });
    await expect(retry(fn, { attempts: 3 })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("exhausts its attempts and throws", async () => {
    const fn = vi.fn(async () => {
      throw new Error("down");
    });
    await expect(retry(fn, { attempts: 3 })).rejects.toThrow("down");
  });

  it("awaits the delay before retrying", async () => {
    vi.useFakeTimers();
    let failed = false;
    const fn = vi.fn(async () => {
      if (!failed) {
        failed = true;
        throw new Error("flaky");
      }
      return "ok";
    });
    const result = retry(fn, { attempts: 3, delayMs: 100 });
    await vi.advanceTimersByTimeAsync(99);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fn).toHaveBeenCalledTimes(2);
    await expect(result).resolves.toBe("ok");
  });
});
