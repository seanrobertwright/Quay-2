import { describe, expect, test } from "vitest";
import { calculateTip, calculateTotal, splitBill } from "../src/tip.ts";

describe("calculateTip", () => {
  test("15% of a $100 bill is $15", () => {
    expect(calculateTip(100, 15)).toBe(15);
  });

  test("rounds the tip to the nearest cent", () => {
    expect(calculateTip(42.5, 18)).toBe(7.65);
  });

  test("throws a RangeError for a negative bill", () => {
    expect(() => calculateTip(-1, 15)).toThrow(RangeError);
  });
});

describe("calculateTotal", () => {
  test("adds the tip to the bill", () => {
    expect(calculateTotal(42.5, 18)).toBe(50.15);
  });
});

describe("splitBill", () => {
  test("rounds each share up so the bill is covered", () => {
    expect(splitBill(50.15, 3)).toBe(16.72);
  });
});
