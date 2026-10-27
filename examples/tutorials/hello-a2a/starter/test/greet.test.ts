import { describe, expect, it } from "vitest";
import { greet } from "../src/greet.ts";

describe("greet", () => {
  it("greets in English", () => {
    expect(greet("Ada", "en")).toBe("Hello, Ada!");
  });

  it("greets in Spanish", () => {
    expect(greet("Ada", "es")).toBe("Hola, Ada!");
  });

  it("greets in French", () => {
    expect(greet("Ada", "fr")).toBe("Bonjour, Ada!");
  });
});
