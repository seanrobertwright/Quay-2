import { describe, expect, it } from "vitest";
import { truncate } from "../src/truncate.ts";

describe("truncate", () => {
  it("returns a text that already fits as it is", () => {
    expect(truncate("Hello", 5)).toBe("Hello");
  });

  it("counts the ellipsis inside the limit", () => {
    const short = truncate("Hello world", 8);
    expect(short).toBe("Hello w…");
    expect(short).toHaveLength(8);
  });

  it("takes another ellipsis", () => {
    expect(truncate("Hello world", 8, { ellipsis: "..." })).toBe("Hello...");
  });

  it("refuses a limit shorter than the ellipsis", () => {
    expect(() => truncate("Hello", 2, { ellipsis: "..." })).toThrow(RangeError);
  });
});
