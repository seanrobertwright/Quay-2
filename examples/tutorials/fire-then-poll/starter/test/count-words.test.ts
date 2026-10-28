import { describe, expect, test } from "vitest";
import { countWordsMap, countWordsNaive } from "../src/count-words.ts";

describe.each([
  ["naive", countWordsNaive],
  ["map", countWordsMap],
])("%s", (_name, countWords) => {
  test("counts words, most frequent first, ties in alphabetical order", () => {
    expect(countWords("b a c b a b")).toEqual([["b", 3], ["a", 2], ["c", 1]]);
  });

  test("ignores case and strips punctuation", () => {
    expect(countWords("Hello, world! hello. WORLD? Hello")).toEqual([["hello", 3], ["world", 2]]);
  });

  test("returns [] for an empty string", () => {
    expect(countWords("")).toEqual([]);
  });
});
