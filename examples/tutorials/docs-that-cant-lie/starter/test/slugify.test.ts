import { describe, expect, it } from "vitest";
import { slugify } from "../src/slugify.ts";

describe("slugify", () => {
  it("lowercases and strips accents", () => {
    expect(slugify("Crème Brûlée Recipes")).toBe("creme-brulee-recipes");
  });

  it("joins every run of letters and digits with the separator", () => {
    expect(slugify("  Hello, World! 2026  ")).toBe("hello-world-2026");
    expect(slugify("Hello World", { separator: "_" })).toBe("hello_world");
  });

  it("returns an empty slug for text with no letters or digits", () => {
    expect(slugify("¿!?")).toBe("");
  });

  it("cuts at a word boundary, never inside a word", () => {
    expect(slugify("The quick brown fox", { maxLength: 12 })).toBe("the-quick");
    expect(slugify("The quick brown fox", { maxLength: 15 })).toBe("the-quick-brown");
  });

  it("cuts a first word that is longer than maxLength on its own", () => {
    expect(slugify("Supercalifragilistic", { maxLength: 5 })).toBe("super");
  });

  it("refuses a maxLength that is not a whole number of 1 or more", () => {
    expect(() => slugify("a", { maxLength: 0 })).toThrow(RangeError);
    expect(() => slugify("a", { maxLength: 2.5 })).toThrow(RangeError);
  });
});
