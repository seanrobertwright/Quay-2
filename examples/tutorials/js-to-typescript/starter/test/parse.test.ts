import { describe, expect, test } from "vitest";
import { parseDocument, parseLine } from "../src/parse/index.js";

describe("parseLine", () => {
  test("reads the quantity, name and unit price", () => {
    expect(parseLine("2 x Apples @ 0.40")).toEqual({ qty: 2, name: "Apples", unitPrice: 0.4 });
  });

  test("keeps a name that has spaces in it", () => {
    expect(parseLine("6 x Free range eggs @ 0.35")).toEqual({ qty: 6, name: "Free range eggs", unitPrice: 0.35 });
  });

  test("returns null for a line that isn't an item", () => {
    expect(parseLine("Apples, two of them")).toBeNull();
  });
});

describe("parseDocument", () => {
  test("skips blank lines and # comments", () => {
    const list = parseDocument("# Saturday shop\n\n2 x Apples @ 0.40\n1 x Bread @ 2.25\n");
    expect(list.items.map((item) => item.name)).toEqual(["Apples", "Bread"]);
    expect(list.errors).toEqual([]);
  });

  test("reports a line that isn't an item by its line number", () => {
    const list = parseDocument("2 x Apples @ 0.40\nsome bread\n");
    expect(list.items).toHaveLength(1);
    expect(list.errors).toHaveLength(1);
    expect(list.errors[0].line).toBe(2);
  });
});
