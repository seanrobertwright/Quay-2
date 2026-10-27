import { describe, expect, test } from "vitest";
import { formatMoney, renderReceipt } from "../src/format/index.js";

describe("formatMoney", () => {
  test("always shows two decimals", () => {
    expect(formatMoney(0.4)).toBe("0.40");
    expect(formatMoney(12)).toBe("12.00");
  });

  test("rounds to the nearest cent", () => {
    expect(formatMoney(3.3000000000000003)).toBe("3.30");
  });
});

describe("renderReceipt", () => {
  const groceries = [
    { qty: 2, name: "Apples", unitPrice: 0.4 },
    { qty: 1, name: "Bread", unitPrice: 2.25 },
    { qty: 3, name: "Milk", unitPrice: 1.1 },
  ];

  test("prints one row per item with its line total", () => {
    const rows = renderReceipt(groceries).split("\n");
    expect(rows[0]).toMatch(/^2 x Apples @ 0\.40 +0\.80$/);
    expect(rows[2]).toMatch(/^3 x Milk @ 1\.10 +3\.30$/);
  });

  test("ends with a TOTAL line that adds up every item", () => {
    expect(renderReceipt(groceries).split("\n").at(-1)).toMatch(/^TOTAL +6\.35$/);
  });
});
