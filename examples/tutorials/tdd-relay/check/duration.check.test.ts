// The check suite: tests the agents never saw, one or more per rule in AGENTS.md. Unzip it into
// the project so check/ sits beside src/.
import { describe, expect, it } from "vitest";
import { parseDuration } from "../src/duration.ts";

describe("valid durations", () => {
  it.each([
    ["1h30m", 5400],
    ["45s", 45],
    ["2h5s", 7205],
    ["90m", 5400],
    ["0s", 0],
    ["05m", 300],
    ["1h2m3s", 3723],
  ])("%s is %i seconds", (text, seconds) => {
    expect(parseDuration(text)).toBe(seconds);
  });
});

describe("invalid durations", () => {
  it.each(["", "1m2m", "30m1h", "-5m", "+5m", "1.5h", "5M", "1h 30m", "90", "h", "1d"])(
    "%j throws a RangeError naming the input",
    (text) => {
      expect(() => parseDuration(text)).toThrow(RangeError);
      expect(() => parseDuration(text)).toThrow(`invalid duration: ${text}`);
    },
  );
});
