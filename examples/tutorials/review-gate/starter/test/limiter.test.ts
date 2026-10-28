import { describe, expect, it } from "vitest";
import { createLimiter } from "../src/limiter.ts";

describe("createLimiter", () => {
  it("allows the first three checks for one key with remaining decreasing", () => {
    let t = 0;
    const limiter = createLimiter({ limit: 3, windowMs: 1000, now: () => t });

    expect(limiter.check("user-1")).toEqual({ allowed: true, remaining: 2, retryAfterMs: 0 });
    expect(limiter.check("user-1")).toEqual({ allowed: true, remaining: 1, retryAfterMs: 0 });
    expect(limiter.check("user-1")).toEqual({ allowed: true, remaining: 0, retryAfterMs: 0 });
  });

  it("refuses the fourth check in the same window with retryAfterMs", () => {
    let t = 0;
    const limiter = createLimiter({ limit: 3, windowMs: 1000, now: () => t });

    limiter.check("user-1");
    limiter.check("user-1");
    limiter.check("user-1");

    t = 400;
    expect(limiter.check("user-1")).toEqual({ allowed: false, remaining: 0, retryAfterMs: 600 });
  });

  it("ensures two keys never affect each other", () => {
    let t = 0;
    const limiter = createLimiter({ limit: 3, windowMs: 1000, now: () => t });

    limiter.check("user-1");
    limiter.check("user-1");
    limiter.check("user-1");

    expect(limiter.check("user-1").allowed).toBe(false);
    expect(limiter.check("user-2")).toEqual({ allowed: true, remaining: 2, retryAfterMs: 0 });
  });

  it("allows checks again in a new window after windowMs", () => {
    let t = 0;
    const limiter = createLimiter({ limit: 3, windowMs: 1000, now: () => t });

    limiter.check("user-1");
    limiter.check("user-1");
    limiter.check("user-1");

    t = 1500;
    expect(limiter.check("user-1")).toEqual({ allowed: true, remaining: 2, retryAfterMs: 0 });
  });
});
