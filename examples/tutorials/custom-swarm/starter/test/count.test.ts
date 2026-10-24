import { describe, expect, test } from "vitest";
import { tally } from "../src/count.ts";

describe("tally", () => {
  test("counts nothing in an empty string", () => {
    expect(tally("")).toEqual({ lines: 0, words: 0, chars: 0 });
  });

  test("counts one line with no newline at the end", () => {
    expect(tally("hello world")).toEqual({ lines: 1, words: 2, chars: 11 });
  });

  test("counts several lines, a final newline adding no empty one", () => {
    expect(tally("one\ntwo\nthree\n")).toEqual({ lines: 3, words: 3, chars: 14 });
  });

  test("splits words on any run of spaces, tabs and newlines", () => {
    expect(tally("  alpha\tbeta \n\n  gamma  ").words).toBe(3);
  });
});
