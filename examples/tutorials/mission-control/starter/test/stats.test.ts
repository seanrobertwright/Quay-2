import { describe, expect, it } from "vitest";
import { countLines, countWords, topWord } from "../src/stats.ts";

describe("countLines", () => {
  it("counts no lines in empty text", () => {
    expect(countLines("")).toBe(0);
  });

  it("does not start a line after a trailing newline", () => {
    expect(countLines("a\nb\n")).toBe(2);
  });
});

describe("countWords", () => {
  it("splits on runs of spaces and tabs", () => {
    expect(countWords("  one two\tthree ")).toBe(3);
  });
});

describe("topWord", () => {
  it("finds the most frequent word and its count", () => {
    expect(topWord("the cat and the hat")).toEqual({ word: "the", count: 2 });
  });

  it("ignores case and punctuation", () => {
    expect(topWord("Quay, quay! QUAY.")).toEqual({ word: "quay", count: 3 });
  });

  it("throws \"no words\" on text with no words", () => {
    expect(() => topWord("")).toThrow("no words");
  });
});
