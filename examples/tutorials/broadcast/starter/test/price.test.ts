import { expect, test } from "vitest";
import { formatPrice } from "../src/price.ts";

test("formats dollars", () => {
  expect(formatPrice(1999, "USD")).toBe("$19.99");
});

test("pads cents under ten with a zero", () => {
  expect(formatPrice(5, "USD")).toBe("$0.05");
});

test("formats euros", () => {
  expect(formatPrice(1999, "EUR")).toBe("19,99 €");
});

test("keeps the minus sign first", () => {
  expect(formatPrice(-250, "USD")).toBe("-$2.50");
});

test("rejects fractional cents", () => {
  expect(() => formatPrice(1.5, "USD")).toThrow(RangeError);
});
