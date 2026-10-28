import { describe, expect, it } from "vitest";
import { uniqueSlug } from "../src/unique.ts";

describe("uniqueSlug", () => {
  it("returns the plain slug when it is free", () => {
    expect(uniqueSlug("My Post", [])).toBe("my-post");
  });

  it("starts numbering at -2", () => {
    expect(uniqueSlug("My Post", ["my-post"])).toBe("my-post-2");
  });

  it("takes the first number not in use", () => {
    expect(uniqueSlug("My Post", new Set(["my-post", "my-post-2", "my-post-3"]))).toBe("my-post-4");
  });
});
